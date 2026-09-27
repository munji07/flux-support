const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { ensureCoreTables } = require("../lib/database.js");

test("conflict_relations 테이블 초기화는 반복 실행해도 안전하다", () => {
  const db = new Database(":memory:");
  assert.doesNotThrow(() => ensureCoreTables(db));
  assert.doesNotThrow(() => ensureCoreTables(db));
  assert.equal(
    db
      .prepare("SELECT name FROM sqlite_master WHERE name = 'conflict_relations'")
      .get().name,
    "conflict_relations",
  );
  assert.equal(
    db.prepare("SELECT name FROM sqlite_master WHERE name = 'conflict_events'").get().name,
    "conflict_events",
  );
  db.close();
});
