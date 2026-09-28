const {
  CONFLICT_INTERVENTION_THRESHOLD,
  CONFLICT_MODERATOR_THRESHOLD,
  CONFLICT_INTERVENTION_COOLDOWN_MS,
} = require("./config.js");

class InterventionManager {
  constructor({ getChannel, getModeratorChannel, now = Date.now }) {
    this.getChannel = getChannel;
    this.getModeratorChannel = getModeratorChannel;
    this.now = now;
  }

  async handle({ relation, message }) {
    const score = Number(relation.conflictScore || 0);
    if (score < CONFLICT_INTERVENTION_THRESHOLD) return { action: "NONE" };
    const now = this.now();
    if (relation.lastInterventionAt != null && now - Number(relation.lastInterventionAt) < CONFLICT_INTERVENTION_COOLDOWN_MS) {
      return { action: "COOLDOWN" };
    }
    const moderator = score >= CONFLICT_MODERATOR_THRESHOLD;
    const channel = moderator ? this.getModeratorChannel(message) : this.getChannel(message);
    if (!channel?.send) return { action: "NO_CHANNEL" };
    if (moderator) {
      await channel.send({ content: "Conflict Guard 관리자 알림", embeds: [{ title: "갈등 관계 감지", description: `Conflict Score: ${Math.round(score)} (${relation.relationKey})` }] });
      return { action: "MODERATOR_ALERT", at: now };
    }
    await channel.send({ content: "잠시 대화를 멈추고 서로 진정해 주세요. 필요하면 관리자를 호출해 주세요." });
    return { action: "CALMING_MESSAGE", at: now };
  }
}

module.exports = { InterventionManager };
