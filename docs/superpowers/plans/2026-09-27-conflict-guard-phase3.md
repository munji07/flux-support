# Conflict Guard Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persisted NORMAL/SUSPICIOUS/ESCALATING/CONFLICT/COOLING state transitions to the Phase 1·2 Conflict Guard without adding interventions.

**Architecture:** Keep state constants and transition rules in pure CommonJS modules. Extend the existing relation model and SQLite store with a backward-compatible `state` field. Let `ConflictGuard` invoke the state machine after score/signal processing and persist the resulting relation in the existing save operation.

**Tech Stack:** Node.js CommonJS, better-sqlite3, existing ConflictGuard/ConflictStore modules, Node built-in `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-27-conflict-guard-phase3-design.md`

## Global Constraints

- 상태 전이는 내부 데이터만 변경하며 사용자 메시지, 관리자 알림, 자동 제재를 수행하지 않는다.
- 신호가 없는 일반 메시지는 점수와 상태를 변경하지 않는다.
- 기존 Phase 1·2 점수 계산과 메시지 필터링을 유지한다.
- 기존 관계 행에 `state` 컬럼이 없어도 초기화·조회가 실패하지 않게 한다.
- 기존 CommonJS 방식과 제품 의존성을 유지한다.

## Review Focus

- 기존 DB에 `state` 컬럼이 없는 경우 초기화가 안전하게 마이그레이션하는지 — Task 2의 migration 테스트로 고정한다.
- 알 수 없는 상태 문자열이 저장된 경우 시스템이 중단되지 않고 NORMAL로 복구하는지 — Task 1의 normalization 테스트로 고정한다.
- 진정 표현이 점수 처리와 상태 전이를 모두 수행하는지 — Task 1·3 테스트로 고정한다.
- 시간 창 밖의 공격이 이전 상태를 ESCALATING/CONFLICT로 잘못 유지하지 않는지 — Task 1·3 테스트로 고정한다.
- 일반 메시지가 상태를 바꾸지 않는지 — Task 3의 Guard 회귀 테스트로 고정한다.

### Task 1: 상태 상수와 순수 상태 머신

**Files:**
- Create: `src/conflict/ConflictState.js`
- Create: `src/conflict/ConflictStateMachine.js`
- Modify: `src/conflict/ConflictRelation.js` — 기본 `state` 추가.
- Create: `test/conflict-state.test.js`

**Interfaces:**
- Produces `CONFLICT_STATES` with `NORMAL`, `SUSPICIOUS`, `ESCALATING`, `CONFLICT`, `COOLING`.
- Produces `normalizeState(state) -> valid state`, defaulting unknown values to `NORMAL`.
- Produces `transitionConflictState(relation, signal, now) -> state` and updates only state-related relation fields.

- [ ] **Step 1: Write the failing tests**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createConflictRelation } = require("../src/conflict/ConflictRelation.js");
const {
  CONFLICT_STATES,
  normalizeState,
} = require("../src/conflict/ConflictState.js");
const {
  transitionConflictState,
} = require("../src/conflict/ConflictStateMachine.js");

function relation(state = CONFLICT_STATES.NORMAL) {
  return {
    ...createConflictRelation("guild", "111", "222"),
    state,
    conflictScore: 0,
    lastInteractionAt: 100000,
    consecutiveEscalations: 0,
  };
}

const attack = { hasSignal: true, type: "DIRECT_ATTACK", isDeescalation: false, isThreat: false };
const mutualAttack = { ...attack, type: "MUTUAL_ATTACK" };
const calm = { hasSignal: true, type: "DEESCALATION", isDeescalation: true, isThreat: false };

test("새 관계의 기본 상태는 NORMAL이다", () => {
  assert.equal(createConflictRelation("guild", "111", "222").state, CONFLICT_STATES.NORMAL);
});

test("알 수 없는 상태는 NORMAL로 정규화된다", () => {
  assert.equal(normalizeState("BROKEN"), CONFLICT_STATES.NORMAL);
});

test("갈등 신호는 NORMAL에서 SUSPICIOUS로 전이한다", () => {
  const value = relation();
  assert.equal(transitionConflictState(value, attack, 100000), CONFLICT_STATES.SUSPICIOUS);
});

test("추가 공격은 SUSPICIOUS에서 ESCALATING으로 전이한다", () => {
  const value = relation(CONFLICT_STATES.SUSPICIOUS);
  value.consecutiveEscalations = 1;
  assert.equal(transitionConflictState(value, attack, 100001), CONFLICT_STATES.ESCALATING);
});

test("상호 공격은 CONFLICT로 전이한다", () => {
  const value = relation(CONFLICT_STATES.ESCALATING);
  assert.equal(transitionConflictState(value, mutualAttack, 100001), CONFLICT_STATES.CONFLICT);
});

test("진정 표현은 COOLING으로 전이하고 연속 상승을 초기화한다", () => {
  const value = relation(CONFLICT_STATES.CONFLICT);
  value.consecutiveEscalations = 3;
  assert.equal(transitionConflictState(value, calm, 100001), CONFLICT_STATES.COOLING);
  assert.equal(value.consecutiveEscalations, 0);
});

test("COOLING 상태에서 점수 0이면 NORMAL로 회복한다", () => {
  const value = relation(CONFLICT_STATES.COOLING);
  assert.equal(transitionConflictState(value, { hasSignal: false }, 200000), CONFLICT_STATES.NORMAL);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/conflict-state.test.js`

Expected: FAIL because the state modules and relation state field do not exist.

- [ ] **Step 3: Implement the minimal state model**

Add the constants and `normalizeState`. Add `state: NORMAL` to created relations. Implement transitions using the current relation state, `signal`, score, and `CONFLICT_WINDOW_MS`; do not mutate score or persistence fields. For a signal with `isDeescalation`, set COOLING and reset `consecutiveEscalations`. For a signal from NORMAL, set SUSPICIOUS; from SUSPICIOUS with a second in-window escalation, set ESCALATING; from ESCALATING with `MUTUAL_ATTACK` or score ≥ 60, set CONFLICT. For COOLING with no signal and score 0, set NORMAL.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/conflict-state.test.js`

Expected: PASS with 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/conflict/ConflictState.js src/conflict/ConflictStateMachine.js src/conflict/ConflictRelation.js test/conflict-state.test.js
git commit -m "feat: add conflict relation state machine"
```

### Task 2: SQLite state migration and persistence

**Files:**
- Modify: `lib/database.js` — add/migrate the `state` column.
- Modify: `src/conflict/ConflictStore.js` — serialize and restore state.
- Modify: `test/conflict-store.test.js` — state persistence and legacy migration coverage.

**Interfaces:**
- Consumes `normalizeState` and `CONFLICT_STATES` from Task 1.
- Produces `new ConflictStore({ runSql, getSql, allSql })`, with `get()` relations having a normalized `state` and `save()` rows containing state.

- [ ] **Step 1: Write the failing tests**

```js
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
  const { ConflictStore } = require("../src/conflict/ConflictStore.js");
  const store = new ConflictStore({
    runSql: (sql, params = []) => db.prepare(sql).run(params),
    getSql: (sql, params = []) => db.prepare(sql).get(params),
    allSql: (sql, params = []) => db.prepare(sql).all(params),
  });
  assert.doesNotThrow(() => store.ensureTable());
  assert.equal(db.prepare("PRAGMA table_info(conflict_relations)").all().some((row) => row.name === "state"), true);
  db.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/conflict-store.test.js`

Expected: FAIL because `state` is not yet stored or migrated.

- [ ] **Step 3: Implement state migration and persistence**

Add `state TEXT NOT NULL DEFAULT 'NORMAL'` to the create table SQL and the core table initializer. In `ensureTable()`, inspect `PRAGMA table_info(conflict_relations)` and add the column only when missing. In `get()`, normalize the row state and default missing values to NORMAL. Include state in the upsert columns.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test test/conflict-store.test.js; npm test`

Expected: PASS with all tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/database.js src/conflict/ConflictStore.js test/conflict-store.test.js
git commit -m "feat: persist conflict relation states"
```

### Task 3: Guard 상태 머신 연결

**Files:**
- Modify: `src/conflict/ConflictGuard.js` — pass state signals and persist state transitions.
- Modify: `test/conflict-guard.test.js` — add state integration coverage using its existing helpers.

**Interfaces:**
- Consumes `transitionConflictState` from Task 1.
- Produces Guard results whose `relation.state` reflects the current signal and score.

- [ ] **Step 1: Write the failing tests**

```js
test("첫 공격은 관계를 SUSPICIOUS로 저장한다", async () => {
  const { guard, relations } = makeGuard();
  await guard.handleMessage(makeMessage());
  assert.equal(relations.get("guild:111:222").state, "SUSPICIOUS");
});

test("상호 공격은 관계를 CONFLICT로 저장한다", async () => {
  const { guard, relations } = makeGuard({
    detector: { detect: () => ({ hasSignal: true, targetUserId: "222", type: "MUTUAL_ATTACK", isDeescalation: false, isThreat: false }) },
  });
  await guard.handleMessage(makeMessage());
  assert.equal(relations.get("guild:111:222").state, "CONFLICT");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/conflict-guard.test.js`

Expected: FAIL because Guard does not invoke the state machine.

- [ ] **Step 3: Connect the state machine**

After score and relation counters are updated, call `transitionConflictState(relation, detected, now)`. Before saving, assign the returned state to `relation.state`. Ensure ordinary no-signal and no-target paths keep their existing behavior.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test test/conflict-state.test.js test/conflict-guard.test.js; npm test`

Expected: PASS with all tests passing.

- [ ] **Step 5: Inspect and commit**

Run: `git diff --check; git status --short`

Expected: no whitespace errors; the user-provided architecture document remains untouched.

```bash
git add src/conflict/ConflictGuard.js test/conflict-guard.test.js
git commit -m "feat: connect conflict states to guard"
```
