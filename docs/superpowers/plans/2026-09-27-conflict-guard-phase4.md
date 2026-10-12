# Conflict Guard Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist meaningful Conflict Guard score/state changes as queryable internal events without storing message content or performing interventions.

**Architecture:** Add a focused `ConflictLogger` over SQLite, initialize its table and indexes through the existing database setup, then inject it into `ConflictGuard`. Guard captures before/after values, persists the relation first, and records events best-effort so logger failures cannot interrupt message handling.

**Tech Stack:** Node.js CommonJS, better-sqlite3, existing conflict modules, Node built-in `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-27-conflict-guard-phase4-design.md`

## Global Constraints

- 메시지 원문, 개인별 위험도, 공개용 Conflict Score를 저장하지 않는다.
- 관리자 채널 전송, 사용자 개입, 자동 제재를 구현하지 않는다.
- 로그 저장 실패는 점수·상태 저장과 메시지 처리를 중단시키지 않는다.
- 의미 있는 신호와 상태 변화만 기록한다.
- 기존 Phase 1~3 동작과 CommonJS 구조를 유지한다.

## Review Focus

- 기존 데이터베이스에 로그 테이블·인덱스가 일부만 존재해도 초기화가 안전한지 — Task 1 migration 테스트.
- 로그 입력에 메시지 원문이나 비정상 점수가 들어와도 저장하지 않거나 정규화하는지 — Task 1 record 테스트.
- 관계 저장이 성공한 뒤 Logger가 실패해도 Guard가 예외를 전파하지 않는지 — Task 3 오류 격리 테스트.
- 대상 없는 신호와 단순 감쇠가 이벤트를 만들지 않는지 — Task 3 Guard 테스트.
- 조회 결과가 서버·관계·시간 필터를 정확히 적용하는지 — Task 1 list 테스트.

### Task 1: ConflictLogger와 로그 스키마

**Files:**
- Create: `src/conflict/ConflictLogger.js`
- Modify: `lib/database.js` — `conflict_events` 테이블과 인덱스 초기화.
- Create: `test/conflict-logger.test.js`
- Modify: `test/database-schema.test.js` — 새 테이블 기대값.

**Interfaces:**
- Produces `new ConflictLogger({ runSql, getSql, allSql })`.
- Produces `ensureTable()`, `record(event)`, `list(guildId, options)`, `format(event)`.
- `list` supports `relationKey`, `from`, `to`, and `limit`; default limit is 100.
- `record` stores only the approved event fields and returns the normalized event.

- [ ] **Step 1: Write the failing tests**

```js
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
  logger.ensureTable();
  logger.ensureTable();
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'conflict_events'").get().name, "conflict_events");
  assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_conflict_events_%'").get().count >= 3, true);
  db.close();
});

test("로그는 승인된 이벤트 필드만 저장하고 점수를 범위 제한한다", () => {
  const { db, logger } = makeLogger();
  logger.ensureTable();
  logger.record({ ...event, scoreBefore: -5, scoreAfter: 130, messageContent: "비공개 원문" });
  const row = db.prepare("SELECT * FROM conflict_events").get();
  assert.equal(row.score_before, 0);
  assert.equal(row.score_after, 100);
  assert.equal(Object.hasOwn(row, "message_content"), false);
  db.close();
});

test("로그를 서버·관계·시간 범위로 조회한다", () => {
  const { db, logger } = makeLogger();
  logger.ensureTable();
  logger.record(event);
  logger.record({ ...event, relationKey: "333:444", timestamp: 2000 });
  assert.equal(logger.list("guild", { relationKey: "111:222", from: 900, to: 1100 }).length, 1);
  assert.equal(logger.list("other").length, 0);
  db.close();
});

test("로그를 관리자용 한 줄 형식으로 포맷한다", () => {
  const { logger } = makeLogger();
  assert.match(logger.format(event), /DIRECT_ATTACK/);
  assert.match(logger.format(event), /NORMAL → SUSPICIOUS/);
  assert.match(logger.format(event), /0 → 8/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/conflict-logger.test.js`

Expected: FAIL because `ConflictLogger.js` does not exist.

- [ ] **Step 3: Implement logger and schema**

Create the table and three indexes with `IF NOT EXISTS`. Normalize event state through `normalizeState` and scores through `clampScore`. Use parameterized SQL. `list` builds only the requested predicates and returns newest events first, capped by the positive integer limit. `format` must include type, relation, state transition, and score transition only.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test test/conflict-logger.test.js; npm test`

Expected: PASS with all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/conflict/ConflictLogger.js lib/database.js test/conflict-logger.test.js test/database-schema.test.js
git commit -m "feat: add conflict event logger"
```

### Task 2: Logger 주입과 이벤트 기록

**Files:**
- Modify: `src/conflict/ConflictGuard.js` — capture and record events.
- Modify: `index.js` — instantiate and inject `ConflictLogger`.
- Modify: `test/conflict-guard.test.js` — event and logger failure tests.

**Interfaces:**
- Consumes `ConflictLogger.record(event)`.
- Produces events with `scoreBefore`, `scoreAfter`, `stateBefore`, `stateAfter`, and no content field.

- [ ] **Step 1: Write the failing tests**

```js
test("공격 처리 후 점수·상태 전후 이벤트를 기록한다", async () => {
  const events = [];
  const { guard, relations } = makeGuard({ logger: { record: (event) => events.push(event) } });
  await guard.handleMessage(makeMessage());
  assert.equal(events.length, 1);
  assert.equal(events[0].scoreBefore, 0);
  assert.equal(events[0].scoreAfter, relations.get("guild:111:222").conflictScore);
  assert.equal(events[0].stateBefore, "NORMAL");
  assert.equal(events[0].stateAfter, "SUSPICIOUS");
  assert.equal("messageContent" in events[0], false);
});

test("Logger 오류는 관계 저장과 메시지 처리를 실패시키지 않는다", async () => {
  const { guard, relations } = makeGuard({ logger: { record: () => { throw new Error("log down"); } } });
  await assert.doesNotReject(() => guard.handleMessage(makeMessage()));
  assert.equal(relations.get("guild:111:222").conflictScore, 8);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/conflict-guard.test.js`

Expected: FAIL because Guard has no logger interface.

- [ ] **Step 3: Implement best-effort event recording**

Accept optional `logger` in `ConflictGuard`. Capture score/state before processing. After relation update and state transition, save the relation, then call `logger.record` only when a target relation changed and the signal is meaningful. Wrap logger calls in `try/catch` and log `Conflict Logger error` without rethrowing. Keep no-target and ignored paths unchanged.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test test/conflict-guard.test.js; npm test`

Expected: PASS with all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/conflict/ConflictGuard.js index.js test/conflict-guard.test.js
git commit -m "feat: record conflict guard events"
```

### Task 3: 초기화·최종 검증

**Files:**
- Modify: `test/conflict-initialization.test.js` — verify conflict event table initialization.

**Interfaces:**
- Consumes the existing database initialization path and logger schema.

- [ ] **Step 1: Add initialization coverage**

Assert that `conflict_events` exists after the existing core initialization and that calling initialization twice does not throw.

- [ ] **Step 2: Run final verification**

Run: `npm test; git diff --check; git status --short`

Expected: all tests pass, no whitespace errors, and only the intentional untracked architecture/planning documents remain.

- [ ] **Step 3: Commit**

```bash
git add test/conflict-initialization.test.js
git commit -m "test: verify conflict event initialization"
```
