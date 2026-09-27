const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getRelationKey,
  createConflictRelation,
} = require("../src/conflict/ConflictRelation.js");
const {
  clampScore,
  increaseScore,
  decayScore,
} = require("../src/conflict/ConflictScore.js");

test("관계 키는 사용자 순서와 무관하게 정렬된다", () => {
  assert.equal(getRelationKey(" 222 ", "111"), "111:222");
  assert.equal(getRelationKey("111", "222"), getRelationKey("222", "111"));
});

test("새 관계는 양방향 공격 카운트를 포함한 기본 상태를 가진다", () => {
  assert.deepEqual(createConflictRelation("guild", "222", "111"), {
    guildId: "guild",
    relationKey: "111:222",
    userA: "111",
    userB: "222",
    conflictScore: 0,
    lastInteractionAt: null,
    lastIncreaseAt: null,
    lastInterventionAt: null,
    consecutiveEscalations: 0,
    recentAttacks: { "111": 0, "222": 0 },
    exchanges: 0,
  });
});

test("점수는 0에서 100 사이로 제한된다", () => {
  assert.equal(clampScore(Number.NaN), 0);
  assert.equal(increaseScore(98, 10), 100);
  assert.equal(increaseScore(-10, 2), 2);
  assert.equal(decayScore(3, 20), 0);
});

test("점수 감쇠는 분당 0.5를 적용한다", () => {
  assert.equal(decayScore(50, 10), 45);
});
