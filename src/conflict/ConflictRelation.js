function normalizeUserId(userId) {
  return String(userId).trim();
}

function getRelationKey(userA, userB) {
  return [normalizeUserId(userA), normalizeUserId(userB)]
    .sort()
    .join(":");
}

function createConflictRelation(guildId, userA, userB) {
  const [normalizedA, normalizedB] = [userA, userB]
    .map(normalizeUserId)
    .sort();

  return {
    guildId,
    relationKey: `${normalizedA}:${normalizedB}`,
    userA: normalizedA,
    userB: normalizedB,
    conflictScore: 0,
    lastInteractionAt: null,
    lastIncreaseAt: null,
    lastInterventionAt: null,
    consecutiveEscalations: 0,
    recentAttacks: { [normalizedA]: 0, [normalizedB]: 0 },
    exchanges: 0,
  };
}

module.exports = { getRelationKey, createConflictRelation };
