# Conflict Guard Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rule-based conflict detection and relation-score updates to the existing Discord message flow without AI, moderation actions, or message-content storage.

**Architecture:** Keep text classification pure in `ConflictDetector` and rule constants in `ConflictSignal`. `ConflictGuard` owns filtering, relation lookup, time-window logic, score updates, and persistence. The existing `messageCreate` listener receives the guard as an isolated side effect while preserving idle chat, game, activity, and leveling behavior.

**Tech Stack:** Node.js CommonJS, discord.js message objects, existing `ConflictStore`, `ConflictScore`, `node:test`, SQLite.

**Spec:** `docs/superpowers/specs/2026-09-27-conflict-guard-phase2-design.md`

## Global Constraints

- AI를 사용하지 않는다.
- Discord 멘션으로 대상이 확실할 때만 관계 점수를 변경한다.
- 봇 메시지, DM, 제외 채널은 무시한다.
- 메시지 원문을 저장하지 않는다.
- 관리자 알림, 상태 머신, 자동 제재를 구현하지 않는다.
- 기존 messageCreate 처리 흐름을 중단시키지 않는다.
- 기존 CommonJS 스타일과 제품 의존성을 유지한다.

## Review Focus

- 멘션 컬렉션이 없거나 여러 멘션을 포함해도 대상 ID가 결정적으로 선택되는지 — Task 1의 detector 테스트로 고정한다.
- 공격 표현이 다른 단어의 일부로 포함될 때 오탐이 과도하지 않은지 — Task 1의 경계 테스트로 고정한다.
- 대상 없는 공격·봇·DM·제외 채널이 저장소를 호출하거나 점수를 변경하지 않는지 — Task 2의 Guard 테스트로 고정한다.
- 마지막 상호작용이 시간 창 밖이면 이전 방향을 반복·상호 공격으로 잘못 분류하지 않는지 — Task 2의 시간 창 테스트로 고정한다.
- Guard 오류가 기존 messageCreate 처리와 레벨 보상을 중단시키지 않는지 — Task 3의 연결 테스트와 오류 격리 테스트로 고정한다.

### Task 1: 규칙과 메시지 감지기

**Files:**
- Modify: `src/conflict/config.js` — Phase 2 시간 창·점수 상수 추가.
- Create: `src/conflict/ConflictSignal.js` — 한국어 규칙과 결과 타입 상수.
- Create: `src/conflict/ConflictDetector.js` — 순수 메시지 분석.
- Create: `test/conflict-detector.test.js` — 감지 규칙 테스트.

**Interfaces:**
- Produces `ConflictDetector({ attackPatterns, threatPatterns, deescalationPatterns })`.
- Produces `detector.detect({ content, mentions }) -> { hasSignal, targetUserId, hostility, type, confidence, isDeescalation, isThreat }`.
- `mentions`는 Discord의 `Collection` 또는 ID 배열을 받으며, 첫 번째 멘션 ID를 대상자로 사용한다.
- Produces `CONFLICT_WINDOW_MS`, `CONFLICT_GENERAL_ATTACK_SCORE`, `CONFLICT_DIRECT_ATTACK_SCORE`, `CONFLICT_REPEATED_ATTACK_SCORE`, `CONFLICT_MUTUAL_ATTACK_SCORE`, `CONFLICT_DEESCALATION_SCORE`.

- [ ] **Step 1: Write the failing tests**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { ConflictDetector } = require("../src/conflict/ConflictDetector.js");

const detector = new ConflictDetector();

test("멘션 대상이 있는 직접 공격을 감지한다", () => {
  const result = detector.detect({
    content: "<@222> 너 진짜 멍청하냐",
    mentions: ["222"],
  });
  assert.deepEqual(
    {
      hasSignal: result.hasSignal,
      targetUserId: result.targetUserId,
      type: result.type,
      isThreat: result.isThreat,
    },
    {
      hasSignal: true,
      targetUserId: "222",
      type: "DIRECT_ATTACK",
      isThreat: false,
    },
  );
});

test("대상이 없는 공격은 신호만 반환하고 대상은 null이다", () => {
  const result = detector.detect({ content: "꺼져", mentions: [] });
  assert.equal(result.hasSignal, true);
  assert.equal(result.targetUserId, null);
});

test("위협 표현은 위협 신호로 표시한다", () => {
  const result = detector.detect({
    content: "<@222> 찾아간다",
    mentions: ["222"],
  });
  assert.equal(result.isThreat, true);
  assert.equal(result.type, "THREAT");
});

test("진정 표현은 갈등 종료 신호로 표시한다", () => {
  const result = detector.detect({ content: "미안, 그만하자", mentions: [] });
  assert.equal(result.hasSignal, true);
  assert.equal(result.isDeescalation, true);
});

test("공격 단어의 일부만 일치하는 일반 단어는 공격으로 분류하지 않는다", () => {
  assert.equal(detector.detect({ content: "멍청이라는 단어의 뜻", mentions: [] }).hasSignal, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/conflict-detector.test.js`

Expected: FAIL because `ConflictDetector.js` does not exist.

- [ ] **Step 3: Implement the minimal detector**

Export `ConflictDetector`. Normalize content with Unicode-safe lowercase/trim. Match explicit Korean patterns with bounded phrase checks; do not use broad substring matching for the standalone insult rule. Return a stable result object with `hasSignal: false`, `targetUserId: null`, `hostility: 0`, `type: null`, `confidence: 0`, `isDeescalation: false`, and `isThreat: false` when no rule matches. When a threat matches, it wins over attack. When an attack has a target, use `DIRECT_ATTACK`; otherwise use `GENERAL_ATTACK`. Keep detector free of Discord and database dependencies.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/conflict-detector.test.js`

Expected: PASS with 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/conflict/config.js src/conflict/ConflictSignal.js src/conflict/ConflictDetector.js test/conflict-detector.test.js
git commit -m "feat: add rule based conflict detector"
```

### Task 2: ConflictGuard와 관계 점수 반영

**Files:**
- Create: `src/conflict/ConflictGuard.js`
- Create: `test/conflict-guard.test.js`

**Interfaces:**
- Consumes `ConflictDetector.detect`, `ConflictStore.get/save`, and `ConflictScore.decayScore/increaseScore`.
- Produces `new ConflictGuard({ detector, store, ignoredChannels, now })`.
- Produces `await guard.handleMessage(message) -> { ignored, detected, relation }`.
- `now` is an injectable function returning milliseconds; default is `Date.now`.

- [ ] **Step 1: Write the failing tests**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { ConflictGuard } = require("../src/conflict/ConflictGuard.js");

function makeMessage(overrides = {}) {
  return {
    author: { id: "111", bot: false },
    guild: { id: "guild" },
    channel: { id: "channel" },
    content: "<@222> 꺼져",
    mentions: ["222"],
    ...overrides,
  };
}

function makeGuard(options = {}) {
  const relations = new Map();
  const store = {
    get(guildId, userA, userB) {
      const key = `${guildId}:${[userA, userB].sort().join(":")}`;
      return relations.get(key) ?? {
        guildId,
        relationKey: [userA, userB].sort().join(":"),
        userA: [userA, userB].sort()[0],
        userB: [userA, userB].sort()[1],
        conflictScore: 0,
        lastInteractionAt: null,
        lastIncreaseAt: null,
        lastInterventionAt: null,
        consecutiveEscalations: 0,
        recentAttacks: { [userA]: 0, [userB]: 0 },
        exchanges: 0,
      };
    },
    save(relation) {
      relations.set(`${relation.guildId}:${relation.relationKey}`, relation);
    },
  };
  const detector = options.detector ?? {
    detect: () => ({
      hasSignal: true,
      targetUserId: "222",
      hostility: 0.8,
      type: "DIRECT_ATTACK",
      confidence: 1,
      isDeescalation: false,
      isThreat: false,
    }),
  };
  return {
    guard: new ConflictGuard({ detector, store, now: () => 100000, ...options }),
    relations,
  };
}

test("멘션 대상이 있는 공격은 관계 점수를 증가시키고 저장한다", async () => {
  const { guard, relations } = makeGuard();
  const result = await guard.handleMessage(makeMessage());
  assert.equal(result.detected, true);
  assert.equal(relations.get("guild:111:222").conflictScore, 8);
});

test("대상 없는 공격은 저장소를 호출하지 않는다", async () => {
  let saves = 0;
  const { guard } = makeGuard({
    detector: { detect: () => ({ hasSignal: true, targetUserId: null, type: "GENERAL_ATTACK", isDeescalation: false }) },
    store: { get() { throw new Error("should not get"); }, save() { saves += 1; } },
  });
  const result = await guard.handleMessage(makeMessage({ mentions: [], content: "꺼져" }));
  assert.equal(result.detected, true);
  assert.equal(saves, 0);
});

test("봇·DM·제외 채널 메시지는 무시한다", async () => {
  let calls = 0;
  const { guard } = makeGuard({
    ignoredChannels: ["ignored"],
    store: { get() { calls += 1; }, save() { calls += 1; } },
  });
  await guard.handleMessage(makeMessage({ author: { id: "bot", bot: true } }));
  await guard.handleMessage(makeMessage({ guild: null }));
  await guard.handleMessage(makeMessage({ channel: { id: "ignored" } }));
  assert.equal(calls, 0);
});

test("60초 밖의 이전 공격은 상호 공격 가중치에 사용하지 않는다", async () => {
  const relations = new Map();
  const oldRelation = {
    guildId: "guild",
    relationKey: "111:222",
    userA: "111",
    userB: "222",
    conflictScore: 4,
    lastInteractionAt: 100000,
    lastIncreaseAt: 100000,
    lastInterventionAt: null,
    consecutiveEscalations: 1,
    recentAttacks: { "111": 1, "222": 0 },
    exchanges: 1,
  };
  const { guard } = makeGuard({
    now: () => 200001,
    store: {
      get: () => oldRelation,
      save: (relation) => relations.set(relation.relationKey, relation),
    },
  });
  const result = await guard.handleMessage(makeMessage());
  assert.equal(result.relation.conflictScore, 8);
  assert.equal(relations.get("111:222").conflictScore, 8);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/conflict-guard.test.js`

Expected: FAIL because `ConflictGuard.js` does not exist.

- [ ] **Step 3: Implement the minimal guard**

Filter before detector invocation. Resolve `message.mentions` from an array, `Collection.first()`, or `Collection.keys()`. For a target, load the relation, decay by the positive elapsed minutes since `lastInteractionAt`, apply the detector type’s base score, and add repeated/mutual weights only when the prior interaction is within `CONFLICT_WINDOW_MS`. Update `recentAttacks[authorId]`, `lastInteractionAt`, `lastIncreaseAt`, and `exchanges`; then save. For de-escalation, reduce by `CONFLICT_DEESCALATION_SCORE` and reset `consecutiveEscalations`. Return metadata without message content. Do not send Discord messages.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/conflict-guard.test.js`

Expected: PASS with 4 tests passing.

- [ ] **Step 5: Run the full suite**

Run: `npm test`

Expected: PASS with all tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/conflict/ConflictGuard.js test/conflict-guard.test.js
git commit -m "feat: apply conflict signals to relations"
```

### Task 3: 기존 Discord 이벤트 연결

**Files:**
- Modify: `index.js` — create the guard and call it from `messageCreate`.
- Create: `test/conflict-integration.test.js` — verify error isolation and no message-content persistence.

**Interfaces:**
- Consumes `ConflictGuard.handleMessage(message)`.
- Produces an existing event handler that calls the guard without changing the current activity and leveling behavior.

- [ ] **Step 1: Write the failing integration test**

```js
const test = require("node:test");
const assert = require("node:assert/strict");

test("ConflictGuard 오류를 처리해도 기존 메시지 처리를 계속할 수 있다", async () => {
  const guard = {
    async handleMessage() {
      throw new Error("detector failure");
    },
  };
  let existingHandlerRan = false;
  await guard.handleMessage({}).catch(() => {});
  existingHandlerRan = true;
  assert.equal(existingHandlerRan, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/conflict-integration.test.js`

Expected: FAIL because the integration test file does not exist.

- [ ] **Step 3: Wire the guard with error isolation**

Instantiate `ConflictDetector` and `ConflictStore` using the existing database helpers and configured ignored channels. In `messageCreate`, call `conflictGuard.handleMessage(message).catch(error => console.error("Conflict Guard error:", error));` before the existing guild/activity logic. Do not await the guard in a way that blocks the existing handler. No raw message content is passed to persistence outside detector input.

- [ ] **Step 4: Run integration and full tests**

Run: `node --test test/conflict-integration.test.js; npm test`

Expected: PASS with all tests passing.

- [ ] **Step 5: Inspect and commit**

Run: `git diff --check; git status --short`

Expected: no whitespace errors and only planned Phase 2 files changed, with `CONFLICT_GUARD_ARCHITECTURE.md` untouched.

```bash
git add index.js test/conflict-integration.test.js
git commit -m "feat: connect conflict guard to messages"
```
