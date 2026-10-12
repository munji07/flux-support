const test = require("node:test");
const assert = require("node:assert/strict");
const { ConflictDetector } = require("../src/conflict/ConflictDetector.js");

test("detects a direct attack and the mentioned target", () => {
  const signal = new ConflictDetector().detect({
    content: "@상대 병신",
    mentions: ["222"],
  });

  assert.deepEqual(signal, {
    hasSignal: true,
    targetUserId: "222",
    hostility: 0.8,
    type: "DIRECT_ATTACK",
    confidence: 1,
    isDeescalation: false,
    isThreat: false,
  });
});

test("detects threats and de-escalation separately", () => {
  const detector = new ConflictDetector();

  assert.equal(detector.detect({ content: "죽여", mentions: ["222"] }).type, "THREAT");
  assert.equal(detector.detect({ content: "그만하자", mentions: ["222"] }).type, "DEESCALATION");
});

test("returns no signal for ordinary messages", () => {
  assert.equal(new ConflictDetector().detect({ content: "안녕하세요" }).hasSignal, false);
});
