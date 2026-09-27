const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { ConflictDetector } = require("../src/conflict/ConflictDetector.js");
const { ConflictGuard } = require("../src/conflict/ConflictGuard.js");
const { ConflictStore } = require("../src/conflict/ConflictStore.js");
const { ConflictLogger } = require("../src/conflict/ConflictLogger.js");
const { ATTACK_PATTERNS } = require("../src/conflict/ConflictSignal.js");

const ATTACK_TEXT = ATTACK_PATTERNS[0].source;

function makeHarness() {
  const db = new Database(":memory:");
  const runSql = (sql, params = []) => db.prepare(sql).run(params);
  const getSql = (sql, params = []) => db.prepare(sql).get(params);
  const allSql = (sql, params = []) => db.prepare(sql).all(params);
  const store = new ConflictStore({ runSql, getSql, allSql });
  const logger = new ConflictLogger({ runSql, getSql, allSql });
  store.ensureTable();
  logger.ensureTable();
  let now = 100000;
  const guard = new ConflictGuard({
    detector: new ConflictDetector(),
    store,
    logger,
    now: () => now,
  });
  return {
    db,
    guard,
    store,
    logger,
    setNow(value) { now = value; },
  };
}

function message(authorId, targetId, content) {
  return {
    author: { id: authorId, bot: false },
    guild: { id: "guild" },
    channel: { id: "channel" },
    content,
    mentions: targetId ? [targetId] : [],
  };
}

test("실제 Detector·Guard·SQLite 조합이 상호 공격을 하나의 관계로 누적한다", async () => {
  const harness = makeHarness();
  await harness.guard.handleMessage(message("111", "222", ATTACK_TEXT));
  harness.setNow(101000);
  await harness.guard.handleMessage(message("222", "111", ATTACK_TEXT));

  const relation = harness.store.get("guild", "111", "222");
  assert.equal(relation.relationKey, "111:222");
  assert.equal(relation.state, "ESCALATING");
  assert.equal(relation.exchanges, 2);
  assert.ok(relation.conflictScore > 20);
  assert.equal(harness.logger.list("guild", { relationKey: "111:222" }).length, 2);
  harness.db.close();
});

test("긴 공백 뒤 공격은 이전 공격 가중치 없이 감쇠된 점수에서 시작한다", async () => {
  const harness = makeHarness();
  await harness.guard.handleMessage(message("111", "222", ATTACK_TEXT));
  harness.setNow(100000 + (120 * 60 * 1000));
  await harness.guard.handleMessage(message("111", "222", ATTACK_TEXT));

  const relation = harness.store.get("guild", "111", "222");
  assert.equal(relation.conflictScore, 8);
  assert.equal(relation.exchanges, 2);
  harness.db.close();
});

test("대상 없는 일반 공격은 관계와 이벤트를 만들지 않는다", async () => {
  const harness = makeHarness();
  const result = await harness.guard.handleMessage(message("111", null, ATTACK_TEXT));

  assert.equal(result.relation, null);
  assert.equal(harness.store.get("guild", "111", "222").exchanges, 0);
  assert.equal(harness.logger.list("guild").length, 0);
  harness.db.close();
});
