const test = require("node:test");
const assert = require("node:assert/strict");

const { createSecretIntegration } = require("../src/secret/integration");

test("Secret 통합 모듈은 중복 경고 명령을 제외하고 명령을 노출한다", () => {
  const integration = createSecretIntegration({
    client: { on() {} },
    databasePath: ":memory:",
  });

  assert.ok(integration.commands.has("설정"));
  assert.ok(integration.commands.has("완전잠금"));
  assert.ok(!integration.commands.has("경고"));
  integration.close();
});
