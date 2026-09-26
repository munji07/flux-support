const test = require("node:test");
const assert = require("node:assert");
const {
  guildCommands,
  supportCommands,
  communityCommands,
  globalCommandsToRegister,
} = require("../deploy-commands.js");

const names = (list) => list.map((c) => c.name);

test("/후원 커맨드가 존재한다", () => {
  assert.ok(names(guildCommands).includes("후원"));
});

test("/후원금액 커맨드는 삭제되었다", () => {
  assert.ok(
    !names(guildCommands).includes("후원금액"),
    "구 명령어가 남아 있으면 배포 후 둘 다 보인다",
  );
});

test("/후원은 서포트 서버 전용으로 등록된다", () => {
  assert.ok(names(supportCommands).includes("후원"));
  assert.ok(!names(communityCommands).includes("후원"));
  assert.ok(!names(globalCommandsToRegister).includes("후원"));
});

test("/후원은 조회·추가·감소 서브커맨드를 갖는다", () => {
  const cmd = guildCommands.find((c) => c.name === "후원");
  const subs = (cmd.options ?? []).map((o) => o.name);
  assert.deepStrictEqual(subs, ["조회", "추가", "감소"]);
});

test("/후원 추가·감소는 유저와 금액을 필수로 받는다", () => {
  const cmd = guildCommands.find((c) => c.name === "후원");
  for (const name of ["추가", "감소"]) {
    const sub = cmd.options.find((o) => o.name === name);
    assert.ok(sub, `${name} 서브커맨드 필요`);
    const optNames = sub.options.map((o) => o.name);
    assert.ok(optNames.includes("유저"), `${name}에 유저 옵션 필요`);
    assert.ok(optNames.includes("금액"), `${name}에 금액 옵션 필요`);
    for (const opt of sub.options) {
      assert.strictEqual(opt.required, true, `${name}.${opt.name}은 필수여야 함`);
    }
  }
});

test("/후원은 서포트 서버와 전역 어디에도 중복 등록되지 않는다", () => {
  assert.strictEqual(names(supportCommands).filter((n) => n === "후원").length, 1);
  assert.strictEqual(
    names(communityCommands).filter((n) => n === "후원").length,
    0,
  );
  assert.strictEqual(
    names(globalCommandsToRegister).filter((n) => n === "후원").length,
    0,
  );
});

test("/후원하기(사용자 신청)는 admin 전용으로 분류되지 않는다", () => {
  assert.ok(
    names(communityCommands).includes("후원하기"),
    "후원 신청 명령어가 서포트 관리자 전용으로 분류되면 일반 유저가 못 씀",
  );
  assert.ok(!names(supportCommands).includes("후원하기"));
  assert.ok(!names(globalCommandsToRegister).includes("후원하기"));
});

test("/후원과 /후원하기는 서로 다른 명령어로 공존한다", () => {
  assert.notStrictEqual("후원", "후원하기");
  assert.ok(names(communityCommands).includes("후원하기"));
  assert.ok(names(supportCommands).includes("후원"));
});
