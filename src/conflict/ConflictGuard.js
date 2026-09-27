const {
  CONFLICT_WINDOW_MS,
  CONFLICT_GENERAL_ATTACK_SCORE,
  CONFLICT_DIRECT_ATTACK_SCORE,
  CONFLICT_REPEATED_ATTACK_SCORE,
  CONFLICT_MUTUAL_ATTACK_SCORE,
  CONFLICT_DEESCALATION_SCORE,
} = require("./config.js");
const { decayScore, increaseScore } = require("./ConflictScore.js");
const { transitionConflictState } = require("./ConflictStateMachine.js");

function mentionIds(mentions) {
  if (Array.isArray(mentions)) return mentions.map(String);
  if (mentions?.map) return mentions.map((mention) => String(mention.id ?? mention));
  if (mentions?.keys) return [...mentions.keys()].map(String);
  return [];
}

class ConflictGuard {
  constructor({ detector, store, ignoredChannels = [], now = Date.now }) {
    this.detector = detector;
    this.store = store;
    this.ignoredChannels = new Set(ignoredChannels.map(String));
    this.now = now;
  }

  async handleMessage(message) {
    if (
      message?.author?.bot ||
      !message?.guild ||
      !message.channel ||
      this.ignoredChannels.has(String(message.channel.id))
    ) {
      return { ignored: true, detected: false, relation: null };
    }

    const detected = this.detector.detect({
      content: message.content,
      mentions: mentionIds(message.mentions),
    });
    if (!detected.hasSignal) return { ignored: false, detected: false, relation: null };
    if (!detected.targetUserId) {
      return { ignored: false, detected: true, relation: null, signal: detected };
    }

    const authorId = String(message.author.id);
    const targetId = String(detected.targetUserId);
    if (authorId === targetId) {
      return { ignored: false, detected: true, relation: null, signal: detected };
    }

    const relation = this.store.get(message.guild.id, authorId, targetId);
    const now = this.now();
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

    relation.recentAttacks[authorId] = authorAttacks + (detected.isDeescalation ? 0 : 1);
    relation.lastInteractionAt = now;
    if (!detected.isDeescalation) relation.lastIncreaseAt = now;
    relation.exchanges += 1;
    relation.state = transitionConflictState(relation, detected, now);
    this.store.save(relation);
    return { ignored: false, detected: true, relation, signal: detected };
  }
}

module.exports = { ConflictGuard };
