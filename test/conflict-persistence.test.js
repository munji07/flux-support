const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { ConflictStore } = require("../src/conflict/ConflictStore.js");
const { ConflictLogger } = require("../src/conflict/ConflictLogger.js");
const { InterventionManager } = require("../src/conflict/InterventionManager.js");

function sqlAdapter(db) {
  return {
    runSql: (sql, params = []) => db.prepare(sql).run(params),
    getSql: (sql, params = []) => db.prepare(sql).get(params),
    allSql: (sql, params = []) => db.prepare(sql).all(params),
  };
}

test("persists relations and conflict events in SQLite", () => {
  const db = new Database(":memory:");
  const adapter = sqlAdapter(db);
  const store = new ConflictStore(adapter);
  const logger = new ConflictLogger(adapter);
  store.ensureTable();
  logger.ensureTable();

  const relation = store.get("guild-1", "222", "111");
  relation.conflictScore = 42;
  relation.state = "ESCALATING";
  store.save(relation);
  logger.record({
    guildId: "guild-1",
    relationKey: relation.relationKey,
    type: "DIRECT_ATTACK",
    stateBefore: "SUSPICIOUS",
    stateAfter: "ESCALATING",
    scoreBefore: 34,
    scoreAfter: 42,
    timestamp: 1000,
  });

  assert.equal(store.get("guild-1", "111", "222").conflictScore, 42);
  assert.equal(logger.list("guild-1")[0].type, "DIRECT_ATTACK");
  db.close();
});

test("uses cooldown and safely handles a missing intervention channel", async () => {
  const messages = [];
  let now = 1000;
  const manager = new InterventionManager({
    getChannel: () => ({ send: async (payload) => messages.push(payload) }),
    getModeratorChannel: () => null,
    now: () => now,
  });
  const relation = { conflictScore: 60, relationKey: "111:222", lastInterventionAt: null };
  const message = { channel: {}, guild: { channels: { cache: new Map() } } };

  assert.equal((await manager.handle({ relation, message })).action, "CALMING_MESSAGE");
  relation.lastInterventionAt = 1000;
  assert.equal((await manager.handle({ relation, message })).action, "COOLDOWN");
  relation.conflictScore = 80;
  now = 360000;
  assert.equal((await manager.handle({ relation, message })).action, "NO_CHANNEL");
  assert.equal(messages.length, 1);
});
