const {
  ATTACK_PATTERNS,
  THREAT_PATTERNS,
  DEESCALATION_PATTERNS,
} = require("./ConflictSignal.js");

function firstMentionId(mentions) {
  if (Array.isArray(mentions)) return mentions[0] ? String(mentions[0]) : null;
  if (mentions?.first) return mentions.first()?.id ?? null;
  if (mentions?.keys) return mentions.keys().next().value ?? null;
  return null;
}

class ConflictDetector {
  constructor({
    attackPatterns = ATTACK_PATTERNS,
    threatPatterns = THREAT_PATTERNS,
    deescalationPatterns = DEESCALATION_PATTERNS,
  } = {}) {
    this.attackPatterns = attackPatterns;
    this.threatPatterns = threatPatterns;
    this.deescalationPatterns = deescalationPatterns;
  }

  detect({ content = "", mentions = [] } = {}) {
    const normalized = String(content).trim().toLowerCase();
    const targetUserId = firstMentionId(mentions);
    const isThreat = this.threatPatterns.some((pattern) => pattern.test(normalized));
    const isAttack = this.attackPatterns.some((pattern) => pattern.test(normalized));
    const isDeescalation = this.deescalationPatterns.some((pattern) => pattern.test(normalized));

    if (isThreat) {
      return {
        hasSignal: true,
        targetUserId,
        hostility: 1,
        type: "THREAT",
        confidence: 1,
        isDeescalation: false,
        isThreat: true,
      };
    }
    if (isAttack) {
      return {
        hasSignal: true,
        targetUserId,
        hostility: targetUserId ? 0.8 : 0.5,
        type: targetUserId ? "DIRECT_ATTACK" : "GENERAL_ATTACK",
        confidence: targetUserId ? 1 : 0.8,
        isDeescalation: false,
        isThreat: false,
      };
    }
    if (isDeescalation) {
      return {
        hasSignal: true,
        targetUserId,
        hostility: 0,
        type: "DEESCALATION",
        confidence: 1,
        isDeescalation: true,
        isThreat: false,
      };
    }
    return {
      hasSignal: false,
      targetUserId: null,
      hostility: 0,
      type: null,
      confidence: 0,
      isDeescalation: false,
      isThreat: false,
    };
  }
}

module.exports = { ConflictDetector };
