# Conflict Guard Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Phase 1 relationship state and Conflict Score foundation described in the approved design.

**Architecture:** Keep score calculation and relation construction as pure, dependency-free CommonJS modules. Encapsulate SQLite persistence in `ConflictStore`, using the existing database helpers, and add only the table initialization needed by the existing bot startup path. Do not connect Discord message events or perform intervention in this phase.

**Tech Stack:** Node.js CommonJS, `better-sqlite3`, Node built-in `node:test`, existing SQLite helpers in `lib/database.js`.

**Spec:** `docs/superpowers/specs/2026-09-27-conflict-guard-phase1-design.md`

## Global Constraints

- 사용자 두 명을 정렬된 관계 키(`userA:userB`)로 표현한다.
- 점수는 0~100으로 제한한다.
- 감쇠는 `elapsedMinutes * 0.5`만큼 적용하고 0 아래로 내려가지 않게 한다.
- 메시지 원문은 저장하지 않는다.
- 이번 단계에서는 메시지 감지, 상태 머신, 관리자 알림, 자동 개입을 구현하지 않는다.
- 기존 코드 스타일과 CommonJS 모듈 방식을 유지한다.
- 제품 의존성을 추가하지 않는다.

## Review Focus

- 사용자 ID가 숫자 문자열이 아닌 값이거나 공백을 포함해도 관계 키가 결정적으로 정렬되는지 — Task 1의 관계 키 테스트로 고정한다.
- `NaN`, 음수, 100 초과 점수와 감쇠 시간이 들어와도 점수가 `0~100` 범위를 벗어나지 않는지 — Task 1의 점수 경계 테스트로 고정한다.
- `recentAttacks`가 없거나 손상된 JSON인 저장 행을 읽어도 저장소가 예외를 던지지 않고 기본 객체를 반환하는지 — Task 2의 복원 테스트로 고정한다.
- 같은 서버에서 같은 사용자 쌍을 여러 번 저장해도 중복 행이 생기지 않는지 — Task 2의 upsert 테스트로 고정한다.
- 기존 데이터베이스에 새 테이블이 이미 있어도 봇 초기화가 실패하지 않는지 — Task 3의 초기화 테스트로 고정한다.

### Task 1: 관계 모델과 점수 계산

**Files:**
- Create: `src/conflict/ConflictRelation.js`
- Create: `src/conflict/ConflictScore.js`
- Create: `src/conflict/config.js`
- Create: `test/conflict-score.test.js`

**Interfaces:**
- Produces `getRelationKey(userA, userB) -> string`, exported by `ConflictRelation.js`.
- Produces `createConflictRelation(guildId, userA, userB) -> object`, exported by `ConflictRelation.js`.
- Produces `clampScore(score) -> number`, `increaseScore(score, amount) -> number`, and `decayScore(score, elapsedMinutes) -> number`, exported by `ConflictScore.js`.
- Produces `CONFLICT_SCORE_MIN`, `CONFLICT_SCORE_MAX`, and `CONFLICT_SCORE_DECAY_PER_MINUTE`, exported by `config.js`.

- [ ] **Step 1: Write the failing tests**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getRelationKey,
  createConflictRelation,
} = require("../src/conflict/ConflictRelation.js");
const {
  clampScore,
  increaseScore,
  decayScore,
} = require("../src/conflict/ConflictScore.js");

test("관계 키는 사용자 순서와 무관하게 정렬된다", () => {
  assert.equal(getRelationKey(" 222 ", "111"), "111:222");
  assert.equal(getRelationKey("111", "222"), getRelationKey("222", "111"));
});

test("새 관계는 양방향 공격 카운트를 포함한 기본 상태를 가진다", () => {
  assert.deepEqual(createConflictRelation("guild", "222", "111"), {
    guildId: "guild",
    relationKey: "111:222",
    userA: "111",
    userB: "222",
    conflictScore: 0,
    lastInteractionAt: null,
    lastIncreaseAt: null,
    lastInterventionAt: null,
    consecutiveEscalations: 0,
    recentAttacks: { "111": 0, "222": 0 },
    exchanges: 0,
  });
});

test("점수는 0에서 100 사이로 제한된다", () => {
  assert.equal(clampScore(Number.NaN), 0);
  assert.equal(increaseScore(98, 10), 100);
  assert.equal(increaseScore(-10, 2), 2);
  assert.equal(decayScore(3, 20), 0);
});

test("점수 감쇠는 분당 0.5를 적용한다", () => {
  assert.equal(decayScore(50, 10), 45);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/conflict-score.test.js`

Expected: FAIL because `src/conflict/ConflictRelation.js` does not exist yet.

- [ ] **Step 3: Implement the minimal model and pure score functions**

Implement `getRelationKey` by trimming both IDs, sorting lexicographically, and joining with `:`. `createConflictRelation` must use the sorted IDs for `userA` and `userB` and initialize every field asserted by the test. `clampScore` must convert non-finite values to `0`, then clamp to the configured range. `increaseScore` and `decayScore` must delegate to that clamp; decay uses `elapsedMinutes * CONFLICT_SCORE_DECAY_PER_MINUTE`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/conflict-score.test.js`

Expected: PASS with 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/conflict test/conflict-score.test.js
git commit -m "feat: add conflict relation and score model"
```

### Task 2: SQLite 관계 저장소

**Files:**
- Modify: `lib/database.js` — export a table initializer or add the relation table to the existing core-table initialization.
- Create: `src/conflict/ConflictStore.js`
- Create: `test/conflict-store.test.js`

**Interfaces:**
- Consumes `createConflictRelation` and `getRelationKey` from Task 1.
- Produces `new ConflictStore({ runSql, getSql })`, with `ensureTable()`, `get(guildId, userA, userB)`, and `save(relation)` methods.
- `get` returns a complete relation object, creating an unsaved default object when no row exists.
- `save` upserts by `(guildId, relationKey)` and returns the saved relation.

- [ ] **Step 1: Write the failing tests**

```js
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
  assert.equal(db.prepare("SELECT count(*) AS count FROM conflict_relations").get().count, 1);
  assert.equal(store.get("guild", "222", "111").conflictScore, 9);
  db.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/conflict-store.test.js`

Expected: FAIL because `ConflictStore` does not exist yet.

- [ ] **Step 3: Implement the table and store**

Add the exact table shape from the spec to `lib/database.js` core initialization. Implement `ConflictStore` with parameterized SQL and JSON serialization for `recentAttacks`. `get` must normalize database rows into the Task 1 relation shape and catch JSON parse failures by restoring `{ [userA]: 0, [userB]: 0 }`. Use `INSERT ... ON CONFLICT (guild_id, relation_key) DO UPDATE` for `save`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/conflict-store.test.js`

Expected: PASS with 4 tests passing.

- [ ] **Step 5: Run the existing test suite**

Run: `npm test`

Expected: PASS with all existing tests passing and no conflict-store regressions.

- [ ] **Step 6: Commit**

```bash
git add lib/database.js src/conflict/ConflictStore.js test/conflict-store.test.js
git commit -m "feat: persist conflict relations in sqlite"
```

### Task 3: 데이터베이스 초기화 연결 검증

**Files:**
- Modify: `index.js` — invoke the conflict relation table initialization through the existing startup initialization path.
- Modify: `lib/database.js` — expose the initializer only if Task 2 did not keep it internal.
- Create: `test/conflict-initialization.test.js`

**Interfaces:**
- Consumes `ConflictStore.ensureTable()` or the existing database core-table initialization from Task 2.
- Produces a startup-safe initialization path that can run repeatedly without errors.

- [ ] **Step 1: Write the failing test**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

test("conflict_relations 테이블 초기화는 반복 실행해도 안전하다", () => {
  const db = new Database(":memory:");
  const initialize = () => db.exec(`
    CREATE TABLE IF NOT EXISTS conflict_relations (
      guild_id TEXT NOT NULL,
      relation_key TEXT NOT NULL,
      user_a TEXT NOT NULL,
      user_b TEXT NOT NULL,
      conflict_score REAL NOT NULL DEFAULT 0,
      last_interaction_at INTEGER,
      last_increase_at INTEGER,
      last_intervention_at INTEGER,
      consecutive_escalations INTEGER NOT NULL DEFAULT 0,
      recent_attacks TEXT NOT NULL DEFAULT '{}',
      exchanges INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, relation_key)
    )`);
  assert.doesNotThrow(initialize);
  assert.doesNotThrow(initialize);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'conflict_relations'").get().name, "conflict_relations");
  db.close();
});
```

- [ ] **Step 2: Run the test to verify the current initialization is not covered**

Run: `node --test test/conflict-initialization.test.js`

Expected: PASS for the isolated SQL shape, establishing the required idempotent contract before wiring startup; the implementation change is verified by the full suite and source inspection in the next steps.

- [ ] **Step 3: Wire initialization into `initSqlite()`**

Call the Task 2 initializer from the existing `initSqlite()` path after the base settings tables are created. Do not add a Discord event listener or any intervention behavior. Keep initialization idempotent.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`

Expected: PASS with all tests passing.

- [ ] **Step 5: Inspect the final diff and commit**

Run: `git diff --check; git status --short`

Expected: no whitespace errors; only the planned Conflict Guard files are changed, with the user-provided untracked `CONFLICT_GUARD_ARCHITECTURE.md` left untouched.

```bash
git add index.js test/conflict-initialization.test.js
git commit -m "feat: initialize conflict guard storage"
```
