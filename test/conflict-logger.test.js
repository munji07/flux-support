const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { ConflictLogger } = require("../src/conflict/ConflictLogger.js");

function makeLogger() {
  const db = new Database(":memory:");
  const logger = new ConflictLogger({
    runSql: (sql, params = []) => db.prepare(sql).run(params),
    getSql: (sql, params = []) => db.prepare(sql).get(params),
    allSql: (sql, params = []) => db.prepare(sql).all(params),
  });
  return { db, logger };
}

const event = {
  guildId: "guild",
  relationKey: "111:222",
  type: "DIRECT_ATTACK",
  stateBefore: "NORMAL",
  stateAfter: "SUSPICIOUS",
  scoreBefore: 0,
  scoreAfter: 8,
  timestamp: 1000,
};

test("로그 테이블과 인덱스 초기화는 반복 실행해도 안전하다", () => {
  const { db, logger } = makeLogger();
  logger.ensureTable(); logger.ensureTable();
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'conflict_events'").get().name, "conflict_events");
  assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_conflict_events_%'").get().count >= 3, true);
  db.close();
});

test("로그는 승인된 이벤트 필드만 저장하고 점수를 범위 제한한다", () => {
  const { db, logger } = makeLogger(); logger.ensureTable();
  logger.record({ ...event, scoreBefore: -5, scoreAfter: 130, messageContent: "비공개 원문" });
  const row = db.prepare("SELECT * FROM conflict_events").get();
  assert.equal(row.score_before, 0); assert.equal(row.score_after, 100); assert.equal(Object.hasOwn(row, "message_content"), false); db.close();
});

test("로그를 서버·관계·시간 범위로 조회한다", () => {
  const { db, logger } = makeLogger(); logger.ensureTable();
  logger.record(event); logger.record({ ...event, relationKey: "333:444", timestamp: 2000 });
  assert.equal(logger.list("guild", { relationKey: "111:222", from: 900, to: 1100 }).length, 1); assert.equal(logger.list("other").length, 0); db.close();
});

test("로그를 관리자용 한 줄 형식으로 포맷한다", () => {
  const { logger } = makeLogger();
  assert.match(logger.format(event), /DIRECT_ATTACK/); assert.match(logger.format(event), /NORMAL → SUSPICIOUS/); assert.match(logger.format(event), /0 → 8/);
});
