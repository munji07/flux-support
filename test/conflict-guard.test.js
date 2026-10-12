const test = require("node:test");
const assert = require("node:assert/strict");
const { ConflictDetector } = require("../src/conflict/ConflictDetector.js");
const { ConflictGuard } = require("../src/conflict/ConflictGuard.js");

function makeMessage(content, authorId, targetId = "222", overrides = {}) {
  return {
    author: { id: authorId, bot: false },
    guild: { id: "guild-1" },
    channel: { id: "channel-1" },
    content,
    mentions: targetId ? [targetId] : [],
    ...overrides,
  };
}

function makeGuard({ now = 1000, logger = null, interventionManager = null } = {}) {
  const relations = new Map();
  const store = {
    get(guildId, userA, userB) {
      const key = `${guildId}:${[userA, userB].sort().join(":")}`;
      if (!relations.has(key)) {
        relations.set(key, {
          guildId,
          relationKey: [userA, userB].sort().join(":"),
          userA: [userA, userB].sort()[0],
          userB: [userA, userB].sort()[1],
          conflictScore: 0,
          state: "NORMAL",
          lastInteractionAt: null,
          lastIncreaseAt: null,
          lastInterventionAt: null,
          consecutiveEscalations: 0,
          recentAttacks: { [userA]: 0, [userB]: 0 },
          exchanges: 0,
        });
      }
      return relations.get(key);
    },
    save(relation) { relations.set(`${relation.guildId}:${relation.relationKey}`, relation); },
  };
  return { guard: new ConflictGuard({ detector: new ConflictDetector(), store, now: () => now, logger, interventionManager }), store };
}

test("ignores bot messages and messages without an identified target", async () => {
  const { guard } = makeGuard();
  assert.equal((await guard.handleMessage(makeMessage("병신", "111", "222", { author: { id: "111", bot: true } }))).ignored, true);
  assert.equal((await guard.handleMessage(makeMessage("병신", "111", null))).relation, null);
});

test("persists a targeted attack and records the conflict event", async () => {
  const events = [];
  const { guard, store } = makeGuard({ logger: { record(event) { events.push(event); } } });
  const result = await guard.handleMessage(makeMessage("병신", "111"));

  assert.equal(result.relation.conflictScore, 8);
  assert.equal(result.relation.state, "SUSPICIOUS");
  assert.equal(events.length, 1);
  assert.equal(store.get("guild-1", "222", "111").conflictScore, 8);
});

test("classifies the second attack from the other user as mutual conflict", async () => {
  let now = 1000;
  const { guard } = makeGuard({ now });
  await guard.handleMessage(makeMessage("병신", "111"));
  now = 2000;
  const result = await guard.handleMessage(makeMessage("병신", "222", "111"));

  assert.equal(result.signal.type, "MUTUAL_ATTACK");
  assert.equal(result.relation.state, "CONFLICT");
  assert.equal(result.relation.conflictScore, 31);
});
