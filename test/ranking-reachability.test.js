const test = require("node:test");
const assert = require("node:assert");
const { handleSupportInteraction } = require("../src/support/commands.js");

const SUPPORT_GUILD_ID = "1525458537139146812";
const ADMIN_USER_ID = "1269575955626725390";

function fakeInteraction(commandName) {
  const replies = [];
  return {
    commandName,
    guildId: SUPPORT_GUILD_ID,
    guild: { id: SUPPORT_GUILD_ID },
    user: { id: ADMIN_USER_ID },
    replies,
    reply: async (payload) => replies.push(payload),
    options: {
      getChannel: () => ({ id: "1", type: 0 }),
      getUser: () => ({ id: "u1" }),
      getSubcommand: () => "조회",
      getInteger: () => 0,
    },
  };
}

const brokenPg = {
  query: async () => {
    throw new Error("pg down");
  },
};

test("랭킹채널 명령은 support 핸들러가 항상 처리한다", async () => {
  const handled = await handleSupportInteraction(fakeInteraction("랭킹채널"), brokenPg);
  assert.strictEqual(handled, true);
});

test("/후원 명령은 support 핸들러가 항상 처리한다", async () => {
  const handled = await handleSupportInteraction(fakeInteraction("후원"), brokenPg);
  assert.strictEqual(handled, true);
});

test("PG 장애 시에도 index.js로 흘러가지 않는다 — 중복 구현 방지 보장", async () => {
  const interaction = fakeInteraction("후원");
  const handled = await handleSupportInteraction(interaction, brokenPg);
  assert.strictEqual(handled, true, "true가 아니면 index.js에 중복 핸들러가 필요해진다");
  assert.ok(
    interaction.replies.length > 0,
    "오류가 사용자에게 보고되어야 한다",
  );
});
