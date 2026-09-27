const test = require("node:test");
const assert = require("node:assert/strict");
const { createConflictRelation } = require("../src/conflict/ConflictRelation.js");
const { CONFLICT_STATES, normalizeState } = require("../src/conflict/ConflictState.js");
const { transitionConflictState } = require("../src/conflict/ConflictStateMachine.js");

function relation(state = CONFLICT_STATES.NORMAL) {
  return { ...createConflictRelation("guild", "111", "222"), state, conflictScore: 0, lastInteractionAt: 100000, consecutiveEscalations: 0 };
}
const attack = { hasSignal: true, type: "DIRECT_ATTACK", isDeescalation: false, isThreat: false };
const mutualAttack = { ...attack, type: "MUTUAL_ATTACK" };
const calm = { hasSignal: true, type: "DEESCALATION", isDeescalation: true, isThreat: false };

test("새 관계의 기본 상태는 NORMAL이다", () => assert.equal(createConflictRelation("guild", "111", "222").state, CONFLICT_STATES.NORMAL));
test("알 수 없는 상태는 NORMAL로 정규화된다", () => assert.equal(normalizeState("BROKEN"), CONFLICT_STATES.NORMAL));
test("갈등 신호는 NORMAL에서 SUSPICIOUS로 전이한다", () => assert.equal(transitionConflictState(relation(), attack, 100000), CONFLICT_STATES.SUSPICIOUS));
test("추가 공격은 SUSPICIOUS에서 ESCALATING으로 전이한다", () => {
  const value = relation(CONFLICT_STATES.SUSPICIOUS); value.consecutiveEscalations = 1;
  assert.equal(transitionConflictState(value, attack, 100001), CONFLICT_STATES.ESCALATING);
});
test("상호 공격은 CONFLICT로 전이한다", () => assert.equal(transitionConflictState(relation(CONFLICT_STATES.ESCALATING), mutualAttack, 100001), CONFLICT_STATES.CONFLICT));
test("진정 표현은 COOLING으로 전이하고 연속 상승을 초기화한다", () => {
  const value = relation(CONFLICT_STATES.CONFLICT); value.consecutiveEscalations = 3;
  assert.equal(transitionConflictState(value, calm, 100001), CONFLICT_STATES.COOLING); assert.equal(value.consecutiveEscalations, 0);
});
test("COOLING 상태에서 점수 0이면 NORMAL로 회복한다", () => assert.equal(transitionConflictState(relation(CONFLICT_STATES.COOLING), { hasSignal: false }, 200000), CONFLICT_STATES.NORMAL));
