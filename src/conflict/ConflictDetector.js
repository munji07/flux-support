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

  detect({ content = "", mentions = [], targetUserId = null } = {}) {
    const normalized = String(content).trim().toLowerCase();
    const compact = normalized.replace(/[\s~!@#$%^&*()_+\-=\[\]{};:'",.<>/?\\|`]/gu, "");
    const resolvedTargetUserId = targetUserId ? String(targetUserId) : firstMentionId(mentions);
    const matches = (patterns) => patterns.some((pattern) => pattern.test(normalized) || pattern.test(compact));
    const isThreat = matches(this.threatPatterns);
    const isAttack = matches(this.attackPatterns);
    const isDeescalation = matches(this.deescalationPatterns);

    if (isThreat) {
      return {
        hasSignal: true,
        targetUserId: resolvedTargetUserId,
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
        targetUserId: resolvedTargetUserId,
        hostility: resolvedTargetUserId ? 0.8 : 0.5,
        type: resolvedTargetUserId ? "DIRECT_ATTACK" : "GENERAL_ATTACK",
        confidence: resolvedTargetUserId ? 1 : 0.8,
        isDeescalation: false,
        isThreat: false,
      };
    }
    if (isDeescalation && resolvedTargetUserId) {
      return {
        hasSignal: true,
        targetUserId: resolvedTargetUserId,
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
