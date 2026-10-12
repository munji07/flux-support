const {
  CONFLICT_WINDOW_MS,
  CONFLICT_GENERAL_ATTACK_SCORE,
  CONFLICT_DIRECT_ATTACK_SCORE,
  CONFLICT_REPEATED_ATTACK_SCORE,
  CONFLICT_MUTUAL_ATTACK_SCORE,
  CONFLICT_DEESCALATION_SCORE,
  CONFLICT_PAIR_WINDOW_MS,
} = require("./config.js");
const { decayScore, increaseScore } = require("./ConflictScore.js");
const { transitionConflictState } = require("./ConflictStateMachine.js");

function mentionIds(mentions) {
  if (mentions?.users) {
    const users = mentions.users;
    if (users?.keys) return [...users.keys()].map(String);
    if (users?.map) return users.map((user) => String(user.id ?? user));
  }
  if (Array.isArray(mentions)) return mentions.map(String);
  if (mentions?.map) return mentions.map((mention) => String(mention.id ?? mention));
  if (mentions?.keys) return [...mentions.keys()].map(String);
  return [];
}

class ConflictGuard {
  constructor({ detector, store, ignoredChannels = [], now = Date.now, logger = null, interventionManager = null }) {
    this.detector = detector;
    this.store = store;
    this.ignoredChannels = typeof ignoredChannels === "function"
      ? ignoredChannels
      : new Set(ignoredChannels.map(String));
    this.now = now;
    this.logger = logger;
    this.interventionManager = interventionManager;
    this.recentSignals = new Map();
  }

  async handleMessage(message) {
    if (
      message?.author?.bot ||
      !message?.guild ||
      !message.channel ||
      (typeof this.ignoredChannels === "function"
        ? this.ignoredChannels(message.guild?.id)
        : this.ignoredChannels
      ).has(String(message.channel.id))
    ) {
      return { ignored: true, detected: false, relation: null };
    }

    const authorId = String(message.author.id);
    let inferredPair = false;
    let replyTargetUserId = null;
    if (message.fetchReference || (message.reference?.messageId && message.channel.messages?.fetch)) {
      const referencedMessage = message.fetchReference
        ? await message.fetchReference().catch(() => null)
        : await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
      if (referencedMessage?.author?.id && !referencedMessage.author.bot) {
        replyTargetUserId = String(referencedMessage.author.id);
      }
    }
    const detected = this.detector.detect({
      content: message.content,
      mentions: mentionIds(message.mentions).filter((id) => id !== authorId),
      targetUserId: replyTargetUserId,
    });
    if (!detected.hasSignal) return { ignored: false, detected: false, relation: null };
    if (!detected.targetUserId && !detected.isDeescalation) {
      const key = `${message.guild.id}:${message.channel.id}`;
      const now = this.now();
      const previous = this.recentSignals.get(key);
      this.recentSignals.set(key, { userId: authorId, timestamp: now });
      if (previous && previous.userId !== authorId && now - previous.timestamp <= CONFLICT_PAIR_WINDOW_MS) {
        detected.targetUserId = previous.userId;
        detected.type = detected.type === "GENERAL_ATTACK" ? "DIRECT_ATTACK" : detected.type;
        inferredPair = true;
      }
    }
    console.log(
      `[Conflict Guard] 갈등 감지: ${detected.type}`,
      detected.targetUserId ? `(대상: ${detected.targetUserId})` : "(대상 없음)",
    );
    if (!detected.targetUserId) {
      return { ignored: false, detected: true, relation: null, signal: detected };
    }

    const targetId = String(detected.targetUserId);
    if (authorId === targetId) {
      return { ignored: false, detected: true, relation: null, signal: detected };
    }

    const now = this.now();
    const relation = this.store.get(message.guild.id, authorId, targetId);
    if (inferredPair && relation.exchanges === 0) {
      relation.conflictScore = CONFLICT_DIRECT_ATTACK_SCORE;
      relation.recentAttacks[targetId] = 1;
      relation.exchanges = 1;
      relation.lastInteractionAt = now;
    }
    const scoreBefore = relation.conflictScore;
    const stateBefore = relation.state || "NORMAL";
    const elapsedMs = relation.lastInteractionAt == null
      ? 0
      : Math.max(0, now - relation.lastInteractionAt);
    relation.conflictScore = decayScore(
      relation.conflictScore,
      elapsedMs / 60000,
    );

    const withinWindow = elapsedMs <= CONFLICT_WINDOW_MS;
    const authorAttacks = Number(relation.recentAttacks[authorId] || 0);
    const targetAttacks = Number(relation.recentAttacks[targetId] || 0);
    if (detected.isDeescalation) {
      relation.conflictScore = Math.max(
        0,
        relation.conflictScore - CONFLICT_DEESCALATION_SCORE,
      );
      relation.consecutiveEscalations = 0;
    } else if (detected.type === "THREAT") {
      relation.conflictScore = increaseScore(relation.conflictScore, CONFLICT_DIRECT_ATTACK_SCORE);
      relation.consecutiveEscalations += 1;
    } else {
      const baseScore = detected.type === "DIRECT_ATTACK"
        ? CONFLICT_DIRECT_ATTACK_SCORE
        : CONFLICT_GENERAL_ATTACK_SCORE;
      let scoreIncrease = baseScore;
      if (withinWindow && authorAttacks > 0) scoreIncrease += CONFLICT_REPEATED_ATTACK_SCORE;
      if (withinWindow && targetAttacks > 0) scoreIncrease += CONFLICT_MUTUAL_ATTACK_SCORE;
      relation.conflictScore = increaseScore(relation.conflictScore, scoreIncrease);
      relation.consecutiveEscalations += 1;
    }

    if (withinWindow && targetAttacks > 0 && !detected.isDeescalation) {
      detected.type = "MUTUAL_ATTACK";
    }
    relation.state = transitionConflictState(relation, detected, now);
    relation.recentAttacks[authorId] = authorAttacks + (detected.isDeescalation ? 0 : 1);
    relation.lastInteractionAt = now;
    if (!detected.isDeescalation) relation.lastIncreaseAt = now;
    relation.exchanges += 1;
    this.store.save(relation);
    let intervention = null;
    if (this.interventionManager) {
      intervention = await this.interventionManager.handle({ relation, message });
      if (intervention.at) {
        relation.lastInterventionAt = intervention.at;
        this.store.save(relation);
      }
    }
    if (this.logger) {
      try {
        this.logger.record({
          guildId: relation.guildId,
          relationKey: relation.relationKey,
          type: detected.type,
          stateBefore,
          stateAfter: relation.state,
          scoreBefore,
          scoreAfter: relation.conflictScore,
          timestamp: now,
        });
      } catch (error) {
        console.error("Conflict Logger error:", error);
      }
    }
    return { ignored: false, detected: true, relation, signal: detected, intervention };
  }
}

module.exports = { ConflictGuard };
