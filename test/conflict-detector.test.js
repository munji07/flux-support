const test = require("node:test");
const assert = require("node:assert/strict");
const { ConflictDetector } = require("../src/conflict/ConflictDetector.js");

const detector = new ConflictDetector();

test("멘션 대상이 있는 직접 공격을 감지한다", () => {
  const result = detector.detect({
    content: "<@222> 너 진짜 멍청하냐",
    mentions: ["222"],
  });
  assert.deepEqual(
    {
      hasSignal: result.hasSignal,
      targetUserId: result.targetUserId,
      type: result.type,
      isThreat: result.isThreat,
    },
    {
      hasSignal: true,
      targetUserId: "222",
      type: "DIRECT_ATTACK",
      isThreat: false,
    },
  );
});

test("대상이 없는 공격은 신호만 반환하고 대상은 null이다", () => {
  const result = detector.detect({ content: "꺼져", mentions: [] });
  assert.equal(result.hasSignal, true);
  assert.equal(result.targetUserId, null);
});

test("위협 표현은 위협 신호로 표시한다", () => {
  const result = detector.detect({
    content: "<@222> 찾아간다",
    mentions: ["222"],
  });
  assert.equal(result.isThreat, true);
  assert.equal(result.type, "THREAT");
});

test("진정 표현은 갈등 종료 신호로 표시한다", () => {
  const result = detector.detect({ content: "미안, 그만하자", mentions: [] });
  assert.equal(result.hasSignal, true);
  assert.equal(result.isDeescalation, true);
});

test("공격 단어의 일부만 일치하는 일반 단어는 공격으로 분류하지 않는다", () => {
  assert.equal(
    detector.detect({ content: "멍청이라는 단어의 뜻", mentions: [] }).hasSignal,
    false,
  );
});
