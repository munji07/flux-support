const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { ConflictStore } = require("../src/conflict/ConflictStore.js");
const { createConflictRelation } = require("../src/conflict/ConflictRelation.js");

function makeStore() {
  const db = new Database(":memory:");
  const runSql = (sql, params = []) => db.prepare(sql).run(params);
  const getSql = (sql, params = []) => db.prepare(sql).get(params);
  const allSql = (sql, params = []) => db.prepare(sql).all(params);
  return { db, store: new ConflictStore({ runSql, getSql, allSql }) };
}

test("없는 관계는 기본 상태로 조회된다", () => {
  const { db, store } = makeStore();
  store.ensureTable();
  assert.equal(store.get("guild", "222", "111").relationKey, "111:222");
  db.close();
});

test("관계를 저장하고 다시 조회하면 모든 필드가 보존된다", () => {
  const { db, store } = makeStore();
  store.ensureTable();
  const relation = createConflictRelation("guild", "222", "111");
  relation.conflictScore = 42.5;
  relation.recentAttacks["111"] = 2;
  relation.exchanges = 3;
  store.save(relation);
  assert.deepEqual(store.get("guild", "111", "222"), relation);
  db.close();
});

test("손상된 recentAttacks는 빈 양방향 카운트로 복원된다", () => {
  const { db, store } = makeStore();
  store.ensureTable();
  db.prepare(`INSERT INTO conflict_relations
    (guild_id, relation_key, user_a, user_b, recent_attacks)
    VALUES (?, ?, ?, ?, ?)`)
    .run("guild", "111:222", "111", "222", "not-json");
  assert.deepEqual(store.get("guild", "111", "222").recentAttacks, {
    "111": 0,
    "222": 0,
  });
  db.close();
});

test("같은 관계를 다시 저장하면 중복 없이 갱신된다", () => {
  const { db, store } = makeStore();
  store.ensureTable();
  const relation = createConflictRelation("guild", "111", "222");
  store.save(relation);
  relation.conflictScore = 9;
  store.save(relation);
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM conflict_relations").get().count,
    1,
  );
  assert.equal(store.get("guild", "222", "111").conflictScore, 9);
  db.close();
});

test("관계를 저장하고 조회하면 state가 보존된다", () => {
  const { db, store } = makeStore();
  store.ensureTable();
  const relation = createConflictRelation("guild", "111", "222");
  relation.state = "ESCALATING";
  store.save(relation);
  assert.equal(store.get("guild", "111", "222").state, "ESCALATING");
  db.close();
});

test("기존 state 없는 테이블은 NORMAL 기본값으로 마이그레이션된다", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE conflict_relations (
    guild_id TEXT NOT NULL, relation_key TEXT NOT NULL,
    user_a TEXT NOT NULL, user_b TEXT NOT NULL,
    conflict_score REAL NOT NULL DEFAULT 0,
    last_interaction_at INTEGER, last_increase_at INTEGER,
    last_intervention_at INTEGER,
    consecutive_escalations INTEGER NOT NULL DEFAULT 0,
    recent_attacks TEXT NOT NULL DEFAULT '{}', exchanges INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, relation_key)
  )`);
  const store = new ConflictStore({
    runSql: (sql, params = []) => db.prepare(sql).run(params),
    getSql: (sql, params = []) => db.prepare(sql).get(params),
    allSql: (sql, params = []) => db.prepare(sql).all(params),
  });
  assert.doesNotThrow(() => store.ensureTable());
  assert.equal(
    db.prepare("PRAGMA table_info(conflict_relations)").all().some((row) => row.name === "state"),
    true,
  );
  db.close();
});
