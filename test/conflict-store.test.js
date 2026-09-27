const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { ConflictStore } = require("../src/conflict/ConflictStore.js");
const { createConflictRelation } = require("../src/conflict/ConflictRelation.js");

function makeStore() {
  const db = new Database(":memory:");
  const runSql = (sql, params = []) => db.prepare(sql).run(params);
  const getSql = (sql, params = []) => db.prepare(sql).get(params);
  return { db, store: new ConflictStore({ runSql, getSql }) };
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
