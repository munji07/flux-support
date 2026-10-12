const test = require("node:test");
const assert = require("node:assert/strict");
const { increaseScore, decayScore } = require("../src/conflict/ConflictScore.js");
const { transitionConflictState } = require("../src/conflict/ConflictStateMachine.js");

test("clamps increases and decays at the score boundaries", () => {
  assert.equal(increaseScore(95, 10), 100);
  assert.equal(decayScore(3, 10), 0);
});

test("moves a relation from normal to escalating attacks within the window", () => {
  const relation = { state: "NORMAL", conflictScore: 8, lastInteractionAt: 1000 };
  const first = transitionConflictState(relation, { hasSignal: true, type: "DIRECT_ATTACK" }, 2000);
  assert.equal(first, "SUSPICIOUS");

  relation.state = first;
  relation.lastInteractionAt = 2000;
  assert.equal(
    transitionConflictState(relation, { hasSignal: true, type: "DIRECT_ATTACK" }, 3000),
    "ESCALATING",
  );
});
