const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { ensureCoreTables } = require("../lib/database.js");

test("ensures level and friend alert tables before event handling", () => {
  const db = new Database(":memory:");

  ensureCoreTables(db);

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);

  assert.deepEqual(tables.sort(), ["friend_alerts", "level_settings"]);
  db.close();
});
