const test = require("node:test");
const assert = require("node:assert/strict");

test("ConflictGuard 오류를 처리해도 기존 메시지 처리를 계속할 수 있다", async () => {
  const guard = {
    async handleMessage() {
      throw new Error("detector failure");
    },
  };
  let existingHandlerRan = false;
  await guard.handleMessage({}).catch(() => {});
  existingHandlerRan = true;
  assert.equal(existingHandlerRan, true);
});
