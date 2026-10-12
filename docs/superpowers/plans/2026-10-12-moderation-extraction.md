# 관리(Moderation) 도메인 추출 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `index.js`(3,406줄) 단일 파일에 갇힌 관리 도메인(경고·제재·제재 채널 알림)을 `src/moderation/`으로 추출하고, 이 영역에 처음으로 단위 테스트를 부여한다.

**Architecture:** `src/conflict/`가 사용하는 의존성 주입 패턴을 따른다. DB 핸들러와 설정 접근자를 생성자에 주입받아 순수하게 테스트 가능하게 만들고, `index.js`는 커맨드 핸들러에서 모듈 메서드를 호출만 한다. 커맨드 핸들러 자체는 `index.js`에 그대로 남는다 — 본 계획은 로직 추출만 다루고 커맨드 재배치는 다루지 않는다.

**Tech Stack:** Node.js CommonJS, `discord.js` v14, `better-sqlite3`, `node:test` (내장 테스트 러너, 외부 의존성 없음)

**Spec:** `docs/superpowers/specs/2026-10-12-moderation-extraction-design.md`

## Global Constraints

- **사용자 노출 동작 변경 금지.** 커맨드 이름, 임베드 제목·본문·필드 문구, 임베지 색상 값, 권한 거부 메시지, 제재 임계값, `bot_settings` 키 이름, `warnings` 테이블 스키마, `hasModeratorRole` 판정 로직 — 이 중 무엇도 바뀌지 않는다. 스펙 §3 참조.
- **이동하지 않는 것 (명시적):** `hasModeratorRole` (`index.js:262`), `/추방` 커맨드 핸들러 (`index.js:3222–3257`), `/타임아웃` 커맨드 핸들러 (`index.js:3259–3295`), `/제제채널` 커맨드 핸들러 (`index.js:3115–3170`). 이 코드는 한 줄도 바뀌지 않는다. 스펙 §4.5 참조.
- **모듈 순수성:** `src/moderation/`의 어떤 파일도 `client`를 import하거나 참조하지 않는다. `index.js`도 import하지 않는다. Discord `Client` 객체가 아니라 `guild`, `member`, `interaction` 같은 객체만 받는다.
- **`now` 주입:** 시간 의존 로직은 `now = Date.now` 파라미터를 받는다. 기본값이 `Date.now`여서 호출부는 인자를 생략할 수 있다.
- **테스트 스타일:** `node:test` + `node:assert/strict`를 사용한다. `test/conflict-detector.test.js`가 이 스타일을 쓰므로 따르는 것. 외부 테스트 프레임워크를 추가하지 않는다.
- **커밋 규칙:** 커밋 1–4는 신규 파일만 추가한다. `index.js`를 건드리지 않으므로 각각 되돌려도 기존 동작에 영향이 없다. 리스크는 전부 커밋 5에 집중된다.
- **Windows 주의:** 작업 디렉터리 경로는 `D:\munji\00_projects\01_FLUX\help-bot`. 셸은 PowerShell이다. `ls -la`, `head` 등 유닉스 명령은 동작하지 않는다. 대신 `Get-Content`, `Select-String`, `Get-ChildItem`을 쓴다.

## Review Focus

스펙이 요구하지만 어떤 태스크의 명시적 테스트도 직접 다루지 않는 입력·상황. 각 항목은 소유 태스크에 테스트로 고정된다.

1. **경고 횟수가 0일 때 `/경고` 추가 실행** → `updateWarning`가 카운트 1을 반환하고 1회 경고에 해당하는 제재 임계값 미달이므로 아무 제재도 적용되지 않는다. 경계값이 1인지 0인지 잘못 가정하면 여기서 무한 루프성 재경고가 발생한다. (Task 1, Task 2)
2. **`delta`가 음수로 카운트를 0 아래로 내리려는 호출** → 하한 0에서 멈춘다. 0 미만이 되면 `warningPunishmentFor`가 `null`이 아닌 잘못된 분기로 빠질 수 있다. (Task 1)
3. **경고 사유가 정확히 20개에서 21개로 넘어가는 순간** → `slice(-20)`이 가장 오래된 것을 버려 카운트가 20으로 유지된다. 경계가 19/21이면 버그가 숨는다. (Task 1)
4. **봇이 `ModerateMembers` 권한이 없는 상태에서 경고 누적 3회 도달** → `applyWarningPunishment`가 `{ applied: false, error }`를 반환하고 `member.timeout`을 호출하지 않는다. 권한 검사를 빠뜨리면 예외로 튕겨 사용자에게 Discord 원본 오류가 노출된다. (Task 2)
5. **제재 채널 ID가 설정 문자열로 저장돼 있으나 해당 채널이 삭제된 상태** → `guild.channels.cache.get()`이 `undefined`를 반환하고 `send`를 시도하지 않고 조용히 return한다. `channel.send`에 접근하면 `TypeError`가 난다. (Task 3)

---

### Task 1: `src/moderation/warning.js` — 경고 기록

`index.js:269–298`의 `getWarningCount`, `updateWarning`를 순수 모듈로 옮긴다. SQLite 핸들러와 시계를 주입받는다.

**Files:**
- Create: `src/moderation/warning.js`
- Test: `test/moderation-warning.test.js`
- Read-only (수정하지 않음): `index.js:269–298`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  ```js
  // src/moderation/warning.js
  module.exports = { createWarningStore };

  function createWarningStore({ getSql, runSql, now = Date.now })
    → { getWarningCount(guildId, userId) → Promise<number>,
        updateWarning(guildId, userId, delta, reason) → Promise<number> }
  ```
  `getWarningCount`와 `updateWarning`은 모두 async이고, `updateWarning`은 갱신된 카운트(number)를 반환한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/moderation-warning.test.js`를 생성한다. Review Focus 항목 2와 3이 이 파일에 고정된다.

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createWarningStore } = require("../src/moderation/warning.js");

function createFakeDb(initialRows = []) {
  const rows = new Map();
  for (const row of initialRows) {
    rows.set(`${row.guild_id}:${row.user_id}`, row);
  }
  const writes = [];
  return {
    writes,
    getSql(sql, params) {
      if (sql.includes("SELECT count, reasons")) {
        const row = rows.get(`${params[0]}:${params[1]}`);
        return row ? { count: row.count, reasons: row.reasons } : undefined;
      }
      const row = rows.get(`${params[0]}:${params[1]}`);
      return row ? { count: row.count } : undefined;
    },
    runSql(sql, params) {
      writes.push({ sql, params });
    },
    setRow(guildId, userId, count, reasons) {
      rows.set(`${guildId}:${userId}`, {
        guild_id: guildId,
        user_id: userId,
        count,
        reasons,
      });
    },
  };
}

test("updateWarning increments the count and returns the new total", async () => {
  const db = createFakeDb();
  const store = createWarningStore({ getSql: db.getSql, runSql: db.runSql });

  db.setRow("g1", "u1", 2, "[]");

  const count = await store.updateWarning("g1", "u1", 1, "스팸");

  assert.equal(count, 3);
});

test("updateWarning does not go below zero", async () => {
  const db = createFakeDb();
  const store = createWarningStore({ getSql: db.getSql, runSql: db.runSql });

  db.setRow("g1", "u1", 0, "[]");

  const count = await store.updateWarning("g1", "u1", -1, "잘못된 입력");

  assert.equal(count, 0);
});

test("updateWarning appends a reason only when delta is positive", async () => {
  const db = createFakeDb();
  const store = createWarningStore({ getSql: db.getSql, runSql: db.runSql });

  db.setRow("g1", "u1", 1, "[]");

  await store.updateWarning("g1", "u1", -1, "사유 제거");
  const decreaseWrite = db.writes.at(-1);
  assert.deepEqual(JSON.parse(decreaseWrite.params[2]), []);

  await store.updateWarning("g1", "u1", 1, "새 경고");
  const increaseWrite = db.writes.at(-1);
  assert.equal(JSON.parse(increaseWrite.params[2]).length, 1);
});

test("updateWarning keeps only the newest twenty reasons", async () => {
  const db = createFakeDb();
  const store = createWarningStore({ getSql: db.getSql, runSql: db.runSql });

  const existing = Array.from({ length: 20 }, (_, index) => ({
    reason: `사유-${index}`,
    at: index,
  }));
  db.setRow("g1", "u1", 20, JSON.stringify(existing));

  await store.updateWarning("g1", "u1", 1, "스물한번째");

  const savedReasons = JSON.parse(db.writes.at(-1).params[2]);
  assert.equal(savedReasons.length, 20);
  assert.equal(savedReasons.at(-1).reason, "스물한번째");
  assert.equal(savedReasons[0].reason, "사유-1");
});

test("getWarningCount returns zero for an unknown user", async () => {
  const db = createFakeDb();
  const store = createWarningStore({ getSql: db.getSql, runSql: db.runSql });

  assert.equal(await store.getWarningCount("g1", "nobody"), 0);
});

test("updateWarning uses the injected clock for timestamps", async () => {
  const db = createFakeDb();
  const store = createWarningStore({
    getSql: db.getSql,
    runSql: db.runSql,
    now: () => 1_700_000_000_000,
  });

  db.setRow("g1", "u1", 0, "[]");

  await store.updateWarning("g1", "u1", 1, "스팸");

  const write = db.writes.at(-1);
  assert.equal(write.params[3], 1_700_000_000_000);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test test/moderation-warning.test.js`
Expected: FAIL with `Cannot find module '../src/moderation/warning.js'`

- [ ] **Step 3: 최소 구현 작성**

`src/moderation/warning.js`를 생성한다. 원본 `index.js:277–298`의 SQL과 상수를 그대로 옮기고, `Date.now()` 호출만 주입된 `now`로 바꾼다.

```js
const MAX_REASONS = 20;

function createWarningStore({ getSql, runSql, now = Date.now }) {
  async function getWarningCount(guildId, userId) {
    const row = getSql(
      "SELECT count FROM warnings WHERE guild_id = ? AND user_id = ?",
      [guildId, userId],
    );
    return Number(row?.count || 0);
  }

  async function updateWarning(guildId, userId, delta, reason) {
    const current = getSql(
      "SELECT count, reasons FROM warnings WHERE guild_id = ? AND user_id = ?",
      [guildId, userId],
    );
    const nextCount = Math.max(0, Number(current?.count || 0) + delta);
    const reasons = current ? JSON.parse(current.reasons || "[]") : [];
    if (delta > 0) reasons.push({ reason, at: now() });
    runSql(
      `INSERT INTO warnings (guild_id, user_id, count, reasons, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (guild_id, user_id) DO UPDATE SET count = excluded.count, reasons = excluded.reasons, updated_at = excluded.updated_at`,
      [
        guildId,
        userId,
        nextCount,
        JSON.stringify(reasons.slice(-MAX_REASONS)),
        now(),
      ],
    );
    return nextCount;
  }

  return { getWarningCount, updateWarning };
}

module.exports = { createWarningStore };
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `node --test test/moderation-warning.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: 회귀 확인**

Run: `npm test`
Expected: 기존 11개 + 신규 6개 = 17개 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/moderation/warning.js test/moderation-warning.test.js
git commit -m "feat: add src/moderation/warning.js with tests"
```

---

### Task 2: `src/moderation/punishment.js` — 제재 판정과 적용

`index.js:309–369`의 `warningPunishmentFor`, `punishmentLabel`, `applyWarningPunishment`를 순수 모듈로 옮긴다. 의존성이 없다.

**Files:**
- Create: `src/moderation/punishment.js`
- Test: `test/moderation-punishment.test.js`
- Read-only (수정하지 않음): `index.js:309–369`

**Interfaces:**
- Consumes: 없음 (첫 태스크). `PermissionsBitField`는 `discord.js`에서 import한다.
- Produces:
  ```js
  // src/moderation/punishment.js
  module.exports = { warningPunishmentFor, punishmentLabel, applyWarningPunishment };

  warningPunishmentFor(count: number)
    → null | { type: "ban" }
    → null | { type: "kick" }
    → null | { type: "timeout", ms: number }

  punishmentLabel(punishment) → string

  applyWarningPunishment(guild, member, count, reason) → Promise<PunishmentResult>

  // PunishmentResult 가능한 형태 (호출부가 분기하므로 형식이 중요):
  //   { type: null, applied: false }
  //   { type: "timeout", ms, minutes, applied: true }
  //   { type: "timeout", ms, minutes, applied: false, error: string }
  //   { type: "kick", applied: true }
  //   { type: "kick", applied: false, error: string }
  //   { type: "ban", applied: true }
  //   { type: "ban", applied: false, error: string }
  ```

**이동에 관한 중요 주석:** `applyWarningPunishment`의 유일한 호출 지점은 `/경고` 커맨드다 (`index.js:3191`). `/추방`과 `/타임아웃` 커맨드는 경고 횟수 임계값을 적용하지 않고 `member.kick()` / `member.timeout()`을 직접 호출한다. 이 비대칭은 의도된 동작이므로 반드시 코드에 주석으로 남긴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/moderation-punishment.test.js`를 생성한다. Review Focus 항목 1과 4가 이 파일에 고정된다.

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  warningPunishmentFor,
  punishmentLabel,
  applyWarningPunishment,
} = require("../src/moderation/punishment.js");

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

test("warningPunishmentFor returns no punishment below the threshold", () => {
  assert.equal(warningPunishmentFor(0), null);
  assert.equal(warningPunishmentFor(1), null);
});

test("warningPunishmentFor maps each threshold to its punishment", () => {
  assert.deepEqual(warningPunishmentFor(2), { type: "timeout", ms: 10 * 60 * 1000 });
  assert.deepEqual(warningPunishmentFor(3), { type: "timeout", ms: HOUR });
  assert.deepEqual(warningPunishmentFor(4), { type: "timeout", ms: DAY });
  assert.deepEqual(warningPunishmentFor(5), { type: "kick" });
  assert.deepEqual(warningPunishmentFor(6), { type: "ban" });
});

test("warningPunishmentFor treats seven or more warnings as a ban", () => {
  assert.deepEqual(warningPunishmentFor(7), { type: "ban" });
});

test("punishmentLabel renders each punishment type", () => {
  assert.equal(punishmentLabel(null), "조치 없음");
  assert.equal(punishmentLabel({ type: "timeout", minutes: 60 }), "타임아웃 60분");
  assert.equal(punishmentLabel({ type: "kick" }), "추방");
  assert.equal(punishmentLabel({ type: "ban" }), "서버 밴");
});

function createFakeMember(hasPermission = true) {
  const calls = [];
  return {
    calls,
    permissions: { has: () => hasPermission },
    async timeout(ms, reason) {
      calls.push({ action: "timeout", ms, reason });
    },
    async kick(reason) {
      calls.push({ action: "kick", reason });
    },
    async ban(options) {
      calls.push({ action: "ban", options });
    },
  };
}

function createFakeGuild(hasPermission = true) {
  return {
    members: {
      me: { permissions: { has: () => hasPermission } },
    },
  };
}

test("applyWarningPunishment does nothing below the threshold", async () => {
  const member = createFakeMember();
  const guild = createFakeGuild();

  const result = await applyWarningPunishment(guild, member, 1, "사유");

  assert.deepEqual(result, { type: null, applied: false });
  assert.equal(member.calls.length, 0);
});

test("applyWarningPunishment times out the member when permission is missing", async () => {
  const member = createFakeMember(false);
  const guild = createFakeGuild(false);

  const result = await applyWarningPunishment(guild, member, 3, "반복 스팸");

  assert.equal(result.applied, false);
  assert.equal(result.type, "timeout");
  assert.equal(result.minutes, 60);
  assert.equal(result.error, "봇에 Moderate Members 권한이 없습니다.");
  assert.equal(member.calls.length, 0, "권한이 없으면 timeout을 호출하지 않는다");
});

test("applyWarningPunishment times out the member when permission is granted", async () => {
  const member = createFakeMember(true);
  const guild = createFakeGuild(true);

  const result = await applyWarningPunishment(guild, member, 3, "반복 스팸");

  assert.equal(result.applied, true);
  assert.equal(result.type, "timeout");
  assert.equal(result.minutes, 60);
  assert.deepEqual(member.calls, [{ action: "timeout", ms: HOUR, reason: "반복 스팸" }]);
});

test("applyWarningPunishment reports a missing kick permission", async () => {
  const member = createFakeMember(false);
  const guild = createFakeGuild(false);

  const result = await applyWarningPunishment(guild, member, 5, "심각한 반복");

  assert.deepEqual(result, {
    type: "kick",
    applied: false,
    error: "봇에 Kick Members 권한이 없습니다.",
  });
  assert.equal(member.calls.length, 0);
});

test("applyWarningPunishment reports a missing ban permission", async () => {
  const member = createFakeMember(false);
  const guild = createFakeGuild(false);

  const result = await applyWarningPunishment(guild, member, 6, "중대한 위반");

  assert.deepEqual(result, {
    type: "ban",
    applied: false,
    error: "봇에 Ban Members 권한이 없습니다.",
  });
  assert.equal(member.calls.length, 0);
});

test("applyWarningPunishment bans the member at six warnings", async () => {
  const member = createFakeMember(true);
  const guild = createFakeGuild(true);

  const result = await applyWarningPunishment(guild, member, 6, "중대한 위반");

  assert.deepEqual(result, { type: "ban", applied: true });
  assert.deepEqual(member.calls, [{ action: "ban", options: { reason: "중대한 위반" } }]);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test test/moderation-punishment.test.js`
Expected: FAIL with `Cannot find module '../src/moderation/punishment.js'`

- [ ] **Step 3: 최소 구현 작성**

`src/moderation/punishment.js`를 생성한다. 원본 `index.js:309–369`를 그대로 옮기되 상수(`10 * 60 * 1000` 등)를 이름 붙은 상수로 치환하고, 상단 주석을 추가한다.

```js
const { PermissionsBitField } = require("discord.js");

const TEN_MINUTES = 10 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

// applyWarningPunishment는 경고 횟수 임계값을 적용한다.
// 호출 지점은 /경고 커맨드 하나뿐이다. /추방과 /타임아웃 커맨드는
// 경고 횟수와 무관하게 member.kick() / member.timeout()을 직접 호출하므로
// 이 함수를 쓰지 않는다. 이 비대칭은 의도된 동작이다.
function warningPunishmentFor(count) {
  if (count >= 6) return { type: "ban" };
  if (count === 5) return { type: "kick" };
  if (count === 4) return { type: "timeout", ms: ONE_DAY };
  if (count === 3) return { type: "timeout", ms: ONE_HOUR };
  if (count === 2) return { type: "timeout", ms: TEN_MINUTES };
  return null;
}

function punishmentLabel(punishment) {
  if (!punishment?.type) return "조치 없음";
  if (punishment.type === "timeout") return `타임아웃 ${punishment.minutes}분`;
  if (punishment.type === "kick") return "추방";
  if (punishment.type === "ban") return "서버 밴";
  return "없음";
}

async function applyWarningPunishment(guild, member, count, reason) {
  const punishment = warningPunishmentFor(count);
  if (!punishment) return { type: null, applied: false };

  const botMember =
    guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (punishment.type === "timeout") {
    if (
      !botMember?.permissions.has(PermissionsBitField.Flags.ModerateMembers)
    ) {
      return {
        ...punishment,
        minutes: punishment.ms / 60000,
        applied: false,
        error: "봇에 Moderate Members 권한이 없습니다.",
      };
    }
    await member.timeout(punishment.ms, reason);
    return { ...punishment, minutes: punishment.ms / 60000, applied: true };
  }
  if (punishment.type === "kick") {
    if (!botMember?.permissions.has(PermissionsBitField.Flags.KickMembers)) {
      return {
        ...punishment,
        applied: false,
        error: "봇에 Kick Members 권한이 없습니다.",
      };
    }
    await member.kick(reason);
    return { ...punishment, applied: true };
  }
  if (punishment.type === "ban") {
    if (!botMember?.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      return {
        ...punishment,
        applied: false,
        error: "봇에 Ban Members 권한이 없습니다.",
      };
    }
    await member.ban({ reason });
    return { ...punishment, applied: true };
  }
  return { ...punishment, applied: false };
}

module.exports = { warningPunishmentFor, punishmentLabel, applyWarningPunishment };
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `node --test test/moderation-punishment.test.js`
Expected: PASS, 9 tests

- [ ] **Step 5: 회귀 확인**

Run: `npm test`
Expected: 기존 11개 + warning 6개 + punishment 9개 = 26개 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/moderation/punishment.js test/moderation-punishment.test.js
git commit -m "feat: add src/moderation/punishment.js with tests"
```

---

### Task 3: `src/moderation/notify.js` — 제재 채널 알림

`index.js:300–307`의 `getPenaltyChannelId`, `setPenaltyChannelId`와 `index.js:371–394`의 `sendPenaltyNotification`을 옮긴다.

**Files:**
- Create: `src/moderation/notify.js`
- Test: `test/moderation-notify.test.js`
- Read-only (수정하지 않음): `index.js:300–307`, `index.js:371–394`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  ```js
  // src/moderation/notify.js
  module.exports = { createPenaltyNotifier };

  function createPenaltyNotifier({ readSetting, writeSetting, deleteSetting })
    → { getPenaltyChannelId(guildId) → string,
        setPenaltyChannelId(guildId, channelId) → void,
        sendPenaltyNotification(guild, target, count, punishment, reason) → Promise<void> }
  ```

`setPenaltyChannelId`는 `channelId`가 truthy면 저장하고, 빈 문자열이면 `deleteSetting`을 호출한다 (원본 `index.js:304–307` 그대로).

- [ ] **Step 1: 실패하는 테스트 작성**

`test/moderation-notify.test.js`를 생성한다. Review Focus 항목 5가 이 파일에 고정된다.

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPenaltyNotifier } = require("../src/moderation/notify.js");

function createFakeSettings(initial = {}) {
  const store = new Map(Object.entries(initial));
  const deletions = [];
  return {
    store,
    deletions,
    readSetting(guildId, key) {
      const value = store.get(`${guildId}:${key}`);
      return value === undefined ? null : value;
    },
    writeSetting(guildId, key, value) {
      store.set(`${guildId}:${key}`, value);
    },
    deleteSetting(guildId, key) {
      deletions.push(`${guildId}:${key}`);
      store.delete(`${guildId}:${key}`);
    },
  };
}

function createFakeGuild(channelId, hasChannel = true) {
  const sent = [];
  const channel = { id: channelId, send: async (payload) => { sent.push(payload); } };
  return {
    sent,
    channels: {
      cache: {
        get: (id) => (hasChannel && id === channelId ? channel : undefined),
      },
    },
  };
}

test("sendPenaltyNotification does nothing when no channel is configured", async () => {
  const settings = createFakeSettings();
  const notifier = createPenaltyNotifier(settings);
  const guild = createFakeGuild("c1");

  await notifier.sendPenaltyNotification(guild, "<@u1>", 1, null, "사유");

  assert.equal(guild.sent.length, 0);
});

test("sendPenaltyNotification does nothing when the channel was deleted", async () => {
  const settings = createFakeSettings({ "g1:penalty_channel_id": "deleted" });
  const notifier = createPenaltyNotifier(settings);
  const guild = createFakeGuild("deleted", false);

  await notifier.sendPenaltyNotification(guild, "<@u1>", 1, null, "사유");

  assert.equal(guild.sent.length, 0);
});

test("sendPenaltyNotification sends an embed with the three fields in order", async () => {
  const settings = createFakeSettings({ "g1:penalty_channel_id": "c1" });
  const notifier = createPenaltyNotifier(settings);
  const guild = createFakeGuild("c1");

  await notifier.sendPenaltyNotification(guild, "<@u1>", 3, { type: "kick" }, "반복 스팸");

  assert.equal(guild.sent.length, 1);
  const embed = guild.sent[0].embeds[0].toJSON();
  assert.deepEqual(
    embed.fields.map((field) => field.name),
    ["경고 횟수", "적용 제제", "사유"],
  );
  assert.equal(embed.fields[0].value, "3회");
  assert.equal(embed.fields[1].value, "추방");
  assert.equal(embed.fields[2].value, "반복 스팸");
});

test("sendPenaltyNotification substitutes a default reason when empty", async () => {
  const settings = createFakeSettings({ "g1:penalty_channel_id": "c1" });
  const notifier = createPenaltyNotifier(settings);
  const guild = createFakeGuild("c1");

  await notifier.sendPenaltyNotification(guild, "<@u1>", 1, null, "");

  const embed = guild.sent[0].embeds[0].toJSON();
  assert.equal(embed.fields[2].value, "사유 없음");
});

test("sendPenaltyNotification swallows channel send failures", async () => {
  const settings = createFakeSettings({ "g1:penalty_channel_id": "c1" });
  const notifier = createPenaltyNotifier(settings);
  const guild = {
    channels: {
      cache: {
        get: () => ({
          id: "c1",
          send: async () => {
            throw new Error("Discord 전송 실패");
          },
        }),
      },
    },
  };

  await notifier.sendPenaltyNotification(guild, "<@u1>", 1, null, "사유");
});

test("setPenaltyChannelId stores a channel and clears it with an empty string", () => {
  const settings = createFakeSettings();
  const notifier = createPenaltyNotifier(settings);

  notifier.setPenaltyChannelId("g1", "c9");
  assert.equal(settings.readSetting("g1", "penalty_channel_id"), "c9");

  notifier.setPenaltyChannelId("g1", "");
  assert.deepEqual(settings.deletions, ["g1:penalty_channel_id"]);
});

test("getPenaltyChannelId returns an empty string when unset", () => {
  const notifier = createPenaltyNotifier(createFakeSettings());

  assert.equal(notifier.getPenaltyChannelId("g1"), "");
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test test/moderation-notify.test.js`
Expected: FAIL with `Cannot find module '../src/moderation/notify.js'`

- [ ] **Step 3: 최소 구현 작성**

`src/moderation/notify.js`를 생성한다.

```js
const { EmbedBuilder } = require("discord.js");

function punishmentLabel(punishment) {
  if (!punishment?.type) return "조치 없음";
  if (punishment.type === "timeout") return `타임아웃 ${punishment.minutes}분`;
  if (punishment.type === "kick") return "추방";
  if (punishment.type === "ban") return "서버 밴";
  return "없음";
}

function createPenaltyNotifier({ readSetting, writeSetting, deleteSetting }) {
  function getPenaltyChannelId(guildId) {
    return readSetting(guildId, "penalty_channel_id") || "";
  }

  function setPenaltyChannelId(guildId, channelId) {
    if (channelId) writeSetting(guildId, "penalty_channel_id", channelId);
    else deleteSetting(guildId, "penalty_channel_id");
  }

  async function sendPenaltyNotification(guild, target, count, punishment, reason) {
    const channelId = getPenaltyChannelId(guild.id);
    if (!channelId) return;
    const channel = guild.channels.cache.get(channelId);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(punishment?.type ? 0xed4245 : 0xffc857)
      .setTitle(punishment?.type ? "⚠️ 경고 누적 제재" : "⚠️ 경고 부여")
      .setDescription(`${target} 님에게 경고가 부여되었습니다.`)
      .addFields(
        { name: "경고 횟수", value: `${count}회`, inline: true },
        { name: "적용 제재", value: punishmentLabel(punishment), inline: true },
        { name: "사유", value: reason || "사유 없음", inline: false },
      )
      .setTimestamp();
    await channel.send({ embeds: [embed] }).catch(() => {});
  }

  return { getPenaltyChannelId, setPenaltyChannelId, sendPenaltyNotification };
}

module.exports = { createPenaltyNotifier };
```

**`punishmentLabel`에 대한 의도적 이중화.** 이 파일과 `src/moderation/punishment.js`가 동일 본문의 `punishmentLabel`을 각각 정의한다. 원본 `index.js`에서도 같은 함수가 두 곳을 서빙했다 — `sendPenaltyNotification`(`:389`)이 알림 임베드에, `/경고` 커맨드(`:3205`)가 응답 문구에 쓴다.

여기서는 일단 복제해 두어 `notify.js`가 `punishment.js`에 의존하지 않도록 한다. Task 4 Step 3에서 이 중복을 제거하고 `require("./punishment.js")`로 교체한다. **Task 4가 끝나면 `punishmentLabel` 정의는 `src/moderation/punishment.js` 한 곳에만 존재해야 한다** — Task 4의 factory 테스트가 이 조건을 검증한다.

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `node --test test/moderation-notify.test.js`
Expected: PASS, 7 tests

- [ ] **Step 5: 회귀 확인**

Run: `npm test`
Expected: 기존 11개 + warning 6개 + punishment 9개 + notify 7개 = 33개 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/moderation/notify.js test/moderation-notify.test.js
git commit -m "feat: add src/moderation/notify.js with tests"
```

---

### Task 4: `src/moderation/index.js` — 팩토리 조합

세 모듈을 조합해 `createModeration`을 노출하고, Task 3의 `punishmentLabel` 중복을 제거한다.

**Files:**
- Create: `src/moderation/index.js`
- Test: `test/moderation-factory.test.js`
- Modify: `src/moderation/notify.js` (중복 함수 제거, 주입으로 교체)

**Interfaces:**
- Consumes:
  ```js
  createWarningStore({ getSql, runSql, now })   → { getWarningCount, updateWarning }
  warningPunishmentFor(count)                   → punishment | null
  punishmentLabel(punishment)                   → string
  applyWarningPunishment(guild, member, count, reason) → Promise<PunishmentResult>
  createPenaltyNotifier({ readSetting, writeSetting, deleteSetting })
                                               → { getPenaltyChannelId, setPenaltyChannelId, sendPenaltyNotification }
  ```
- Produces:
  ```js
  // src/moderation/index.js
  module.exports = { createModeration };

  function createModeration({ getSql, runSql, readSetting, writeSetting, deleteSetting, now = Date.now })
    → { getWarningCount, updateWarning,
        warningPunishmentFor, punishmentLabel, applyWarningPunishment,
        getPenaltyChannelId, setPenaltyChannelId, sendPenaltyNotification }
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

`test/moderation-factory.test.js`를 생성한다. 이 테스트는 Task 4가 중복 제거까지 수행했음을 검증한다.

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createModeration } = require("../src/moderation/index.js");

function createStubs() {
  const writes = [];
  const deletions = [];
  const settings = new Map();

  return {
    writes,
    deletions,
    deps: {
      getSql: (sql, params) => {
        if (sql.includes("SELECT count, reasons")) {
          return { count: 1, reasons: "[]" };
        }
        return { count: 1 };
      },
      runSql: (sql, params) => writes.push({ sql, params }),
      readSetting: (guildId, key) => settings.get(`${guildId}:${key}`) ?? null,
      writeSetting: (guildId, key, value) => settings.set(`${guildId}:${key}`, value),
      deleteSetting: (guildId, key) => {
        deletions.push(`${guildId}:${key}`);
        settings.delete(`${guildId}:${key}`);
      },
    },
  };
}

test("createModeration exposes the full public surface", () => {
  const { deps } = createStubs();
  const moderation = createModeration(deps);

  assert.deepEqual(Object.keys(moderation).sort(), [
    "applyWarningPunishment",
    "getPenaltyChannelId",
    "getWarningCount",
    "punishmentLabel",
    "sendPenaltyNotification",
    "setPenaltyChannelId",
    "updateWarning",
    "warningPunishmentFor",
  ]);
});

test("punishmentLabel is the same function across the module surface", () => {
  const { deps } = createStubs();
  const moderation = createModeration(deps);
  const { punishmentLabel } = require("../src/moderation/punishment.js");

  assert.equal(moderation.punishmentLabel, punishmentLabel);
});

test("createModeration wires the warning store to the injected database", async () => {
  const { deps, writes } = createStubs();
  const moderation = createModeration(deps);

  const count = await moderation.updateWarning("g1", "u1", 1, "스팸");

  assert.equal(count, 2);
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /INSERT INTO warnings/);
});

test("createModeration wires the notifier to the injected settings", () => {
  const { deps } = createStubs();
  const moderation = createModeration(deps);

  moderation.setPenaltyChannelId("g1", "c1");

  assert.equal(moderation.getPenaltyChannelId("g1"), "c1");
});

test("createModeration accepts an injected clock", async () => {
  const { deps, writes } = createStubs();
  const moderation = createModeration({ ...deps, now: () => 1234567890 });

  await moderation.updateWarning("g1", "u1", 1, "스팸");

  assert.equal(writes[0].params[3], 1234567890);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test test/moderation-factory.test.js`
Expected: FAIL with `Cannot find module '../src/moderation/index.js'`

- [ ] **Step 3: notify.js의 중복 `punishmentLabel` 제거**

`src/moderation/notify.js`를 수정한다. 파일 전체를 아래 내용으로 교체한다.

```js
const { EmbedBuilder } = require("discord.js");
const { punishmentLabel } = require("./punishment.js");

function createPenaltyNotifier({ readSetting, writeSetting, deleteSetting }) {
  function getPenaltyChannelId(guildId) {
    return readSetting(guildId, "penalty_channel_id") || "";
  }

  function setPenaltyChannelId(guildId, channelId) {
    if (channelId) writeSetting(guildId, "penalty_channel_id", channelId);
    else deleteSetting(guildId, "penalty_channel_id");
  }

  async function sendPenaltyNotification(guild, target, count, punishment, reason) {
    const channelId = getPenaltyChannelId(guild.id);
    if (!channelId) return;
    const channel = guild.channels.cache.get(channelId);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(punishment?.type ? 0xed4245 : 0xffc857)
      .setTitle(punishment?.type ? "⚠️ 경고 누적 제재" : "⚠️ 경고 부여")
      .setDescription(`${target} 님에게 경고가 부여되었습니다.`)
      .addFields(
        { name: "경고 횟수", value: `${count}회`, inline: true },
        { name: "적용 제재", value: punishmentLabel(punishment), inline: true },
        { name: "사유", value: reason || "사유 없음", inline: false },
      )
      .setTimestamp();
    await channel.send({ embeds: [embed] }).catch(() => {});
  }

  return { getPenaltyChannelId, setPenaltyChannelId, sendPenaltyNotification };
}

module.exports = { createPenaltyNotifier };
```

- [ ] **Step 4: notify 테스트가 여전히 통과하는지 확인**

Run: `node --test test/moderation-notify.test.js`
Expected: PASS, 7 tests. 중복 제거가 notify 테스트를 깨뜨리지 않아야 한다.

- [ ] **Step 5: 최소 구현 작성**

`src/moderation/index.js`를 생성한다.

```js
const { createWarningStore } = require("./warning.js");
const {
  warningPunishmentFor,
  punishmentLabel,
  applyWarningPunishment,
} = require("./punishment.js");
const { createPenaltyNotifier } = require("./notify.js");

function createModeration({
  getSql,
  runSql,
  readSetting,
  writeSetting,
  deleteSetting,
  now = Date.now,
}) {
  const warnings = createWarningStore({ getSql, runSql, now });
  const notifier = createPenaltyNotifier({
    readSetting,
    writeSetting,
    deleteSetting,
  });

  return {
    getWarningCount: warnings.getWarningCount,
    updateWarning: warnings.updateWarning,
    warningPunishmentFor,
    punishmentLabel,
    applyWarningPunishment,
    getPenaltyChannelId: notifier.getPenaltyChannelId,
    setPenaltyChannelId: notifier.setPenaltyChannelId,
    sendPenaltyNotification: notifier.sendPenaltyNotification,
  };
}

module.exports = { createModeration };
```

- [ ] **Step 6: 테스트가 통과하는지 확인**

Run: `npm test`
Expected: 기존 11개 + warning 6개 + punishment 9개 + notify 7개 + factory 5개 = 38개 전부 PASS

- [ ] **Step 7: 회귀 확인**

Run: `node --check src/moderation/index.js`
Expected: 출력 없음 (exit 0)

- [ ] **Step 8: 커밋**

```bash
git add src/moderation/index.js src/moderation/notify.js test/moderation-factory.test.js
git commit -m "feat: add src/moderation/index.js factory"
```

---

### Task 5: `index.js` 연결 — 관리 커맨드를 모듈로 위임

스펙의 유일한 위험한 커밋. 이 단계에서 `index.js`에서 약 136줄이 제거된다. 되돌리면 원상 복구된다.

**Files:**
- Modify: `index.js:269–307` (함수 정의 제거), `index.js:371–394` (함수 정의 제거), `index.js:1096` 부근 (import 추가), `index.js:3115–3211` (호출부 교체)
- Read-only (한 줄도 바꾸지 않음): `index.js:262–267` (`hasModeratorRole`), `index.js:3222–3295` (`/추방`, `/타임아웃`)

**Interfaces:**
- Consumes: `createModeration({ getSql, runSql, readSetting, writeSetting, deleteSetting })` — Task 4에서 생성. `index.js:38–48`의 `lib/database.js` import에 이미 `getSql`, `runSql`, `readSetting`, `writeSetting`, `deleteSetting`이 모두 들어 있다 (`dbGet`/`dbAll`/`dbRun` 별칭도).
- Produces: `index.js` 내부에서 `moderation` 객체를 통해 위 8개 메서드를 호출한다.

**미리 계산한 라인 수:**
- 제거 (6개 블록): `getWarningCount` 7줄 (269–275), `updateWarning` 22줄 (277–298), `getPenaltyChannelId` 3줄 (300–302), `setPenaltyChannelId` 4줄 (304–307), `warningPunishmentFor`+`punishmentLabel`+`applyWarningPunishment` 61줄 (309–369), `sendPenaltyNotification` 24줄 (371–394) = **121줄**
- 빈 줄 정리: 276, 308, 370, 395 = **4줄**
- 총 제거: **125줄**
- 추가: import 1줄, `createModeration` 호출 8줄 = **9줄**
- 순 감소: **116줄** → `index.js`는 3,406 → **3,290줄**

스펙 §4.5에서 `/추방`·`/타임아웃`·`hasModeratorRole`을 유지하기로 명시했으므로 이 감소량이 정확하다.

- [ ] **Step 1: 현재 상태를 커밋으로 기록**

Plan Task 1–4의 커밋은 전부 신규 파일이므로 `index.js`는 아직 `75d7066` 그대로다. 되돌리기 지점을 확인한다.

Run: `git diff 75d7066 HEAD --stat -- index.js`
Expected: 출력 없음. `index.js`가 아직 손대지지 않았음을 확인한다.

- [ ] **Step 2: import 추가**

`index.js:37` (`src/conflict/InterventionManager.js` require 다음 줄)에 다음을 추가한다.

```js
const { createModeration } = require("./src/moderation/index.js");
```

- [ ] **Step 3: 모듈 인스턴스 생성**

`index.js:112` (`conflictGuard` 생성 블록 다음 줄)에 다음을 추가한다. `client`는 필요하지 않고 DB 핸들러만 필요하다.

```js
const moderation = createModeration({
  getSql,
  runSql,
  readSetting,
  writeSetting,
  deleteSetting,
});
```

- [ ] **Step 4: 사용되지 않는 로컬 함수 제거**

아래 네 블록을 `index.js`에서 **완전히 삭제**한다.

첫 번째 — `getWarningCount` (원본 269–275):

```js
async function getWarningCount(guildId, userId) {
  const row = dbGet(
    "SELECT count FROM warnings WHERE guild_id = ? AND user_id = ?",
    [guildId, userId],
  );
  return Number(row?.count || 0);
}
```

두 번째 — `updateWarning` (원본 277–298):

```js
async function updateWarning(guildId, userId, delta, reason) {
  const current = dbGet(
    "SELECT count, reasons FROM warnings WHERE guild_id = ? AND user_id = ?",
    [guildId, userId],
  );
  const nextCount = Math.max(0, Number(current?.count || 0) + delta);
  const reasons = current ? JSON.parse(current.reasons || "[]") : [];
  if (delta > 0) reasons.push({ reason, at: Date.now() });
  dbRun(
    `INSERT INTO warnings (guild_id, user_id, count, reasons, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET count = excluded.count, reasons = excluded.reasons, updated_at = excluded.updated_at`,
    [
      guildId,
      userId,
      nextCount,
      JSON.stringify(reasons.slice(-20)),
      Date.now(),
    ],
  );
  return nextCount;
}
```

세 번째 — `getPenaltyChannelId`, `setPenaltyChannelId` (원본 300–308):

```js
function getPenaltyChannelId(guildId) {
  return readSetting(guildId, "penalty_channel_id") || "";
}

function setPenaltyChannelId(guildId, channelId) {
  if (channelId) writeSetting(guildId, "penalty_channel_id", channelId);
  else deleteSetting(guildId, "penalty_channel_id");
}
```

네 번째 — `warningPunishmentFor`, `punishmentLabel`, `applyWarningPunishment` (원본 309–369), 그리고 `sendPenaltyNotification` (원본 371–394).

**주의:** `warningPunishmentFor` 바로 앞의 빈 줄과 `sendPenaltyNotification` 앞의 빈 줄도 함께 정리한다. 남겨 두면 빈 줄이 두 줄 연속으로 남는다.

**주의:** `hasModeratorRole` (원본 262–267)은 **절대 삭제하지 않는다.** §4.5에서 유지하기로 결정했고 `/갈등설정`(`:3101`), 아케이드(`:1349`), `/채널지정`(`:1672`)에서 여전히 사용한다.

- [ ] **Step 5: 호출부를 모듈로 교체**

`/제제채널`과 `/경고` 커맨드 안의 호출 이름만 바꾼다. **나머지 코드는 한 글자도 바꾸지 않는다.**

`/제제채널` 커맨드 (원본 3136, 3148, 3159):

```js
// 변경 전
setPenaltyChannelId(interaction.guildId, channel.id);
// 변경 후
moderation.setPenaltyChannelId(interaction.guildId, channel.id);
```

```js
// 변경 전
setPenaltyChannelId(interaction.guildId, "");
// 변경 후
moderation.setPenaltyChannelId(interaction.guildId, "");
```

```js
// 변경 전
const channelId = getPenaltyChannelId(interaction.guildId);
// 변경 후
const channelId = moderation.getPenaltyChannelId(interaction.guildId);
```

`/경고` 커맨드 (원본 3178, 3191, 3197, 3205):

```js
// 변경 전
const nextCount = await updateWarning(interaction.guildId, target.id, delta, reason);
// 변경 후
const nextCount = await moderation.updateWarning(
  interaction.guildId,
  target.id,
  delta,
  reason,
);
```

```js
// 변경 전
const punishment = await applyWarningPunishment(
// 변경 후
const punishment = await moderation.applyWarningPunishment(
```

```js
// 변경 전
await sendPenaltyNotification(
// 변경 후
await moderation.sendPenaltyNotification(
```

```js
// 변경 전
? `\n**적용 제재**: ${punishmentLabel(punishment)}`
// 변경 후
? `\n**적용 제재**: ${moderation.punishmentLabel(punishment)}`
```

**주의:** `/제제채널` 커맨드가 `getPenaltyChannelId`를 통해 이미 임베드를 만들며, 그 안에서 `punishmentLabel`을 쓰지 않는다. `/경고` 커맨드만 `punishmentLabel`을 호출하므로 위 4곳만 교체하면 된다. `/추방`(`:3222`)과 `/타임아웃`(`:3259`) 커맨드는 어떤 것도 호출하지 않으므로 손대지 않는다.

- [ ] **Step 6: 문법 검증**

Run: `node --check index.js`
Expected: 출력 없음 (exit 0)

- [ ] **Step 7: 잔여 참조 확인**

Run: `Select-String -Path index.js -Pattern '^\s*(const|let)\s+\{?\s*(getWarningCount|updateWarning|getPenaltyChannelId|setPenaltyChannelId|warningPunishmentFor|punishmentLabel|applyWarningPunishment|sendPenaltyNotification)\b'`
Expected: 출력 없음. 로컬 함수 정의의 잔존이 없어야 한다.

Run: `Select-String -Path index.js -Pattern '[^.]\b(getWarningCount|updateWarning|getPenaltyChannelId|setPenaltyChannelId|warningPunishmentFor|punishmentLabel|applyWarningPunishment|sendPenaltyNotification)\s*\('`
Expected: `moderation.` 접두사가 붙은 호출만 나와야 한다. `punishmentLabel` 정의가 아니라 호출이므로 앞의 `.` 없음 패턴이 맞다.

- [ ] **Step 8: 유지 대상이 그대로인지 확인**

Run: `node --check index.js` 그리고 `Select-String -Path index.js -Pattern 'hasModeratorRole'`
Expected: `hasModeratorRole` 정의 1건 + 호출 4건 = 총 5건. §4.5 유지 결정 확인.

- [ ] **Step 9: 회귀 확인**

Run: `npm test`
Expected: 38개 전부 PASS. `index.js`는 테스트에서 직접 로드되지 않으므로 이 단계에서 추가 실패는 없어야 한다.

- [ ] **Step 10: 라인 수 확인**

Run: `(Get-Content index.js).Count`
Expected: 3,290. §4.5 유지 결정상 116줄 감소가 정확한 예측값이다. 라인 수 자체가 목표가 아니라, 관리 로직이 `src/moderation/` 한 곳에 모이는 것이 목표다.

- [ ] **Step 11: 커밋**

```bash
git add index.js
git commit -m "refactor: route moderation commands through src/moderation"
```

- [ ] **Step 12: 리모트 동기화**

```bash
git push origin main
```

---

### Task 6: 스펙 성공 기준 최종 검증

스펙 §9의 체크리스트를 항목별로 확인한다. 하나라도 어긋나면 여기서 멈추고 원인을 조사한다.

**Files:**
- Read-only: `docs/superpowers/specs/2026-10-12-moderation-extraction-design.md`

- [ ] **Step 1: 테스트 전체 통과**

Run: `npm test`
Expected: `# pass 38`, `# fail 0`

- [ ] **Step 2: 문법 검증**

Run: `node --check index.js` 그리고 `Get-ChildItem src/moderation/*.js | ForEach-Object { node --check $_.FullName }`
Expected: 두 명령 모두 출력 없음 (exit 0)

- [ ] **Step 3: 모듈 순수성 — client 참조 없음**

Run: `Select-String -Path src/moderation/*.js -Pattern '\bclient\b'`
Expected: 출력 없음

- [ ] **Step 4: 모듈 순수성 — index.js 역참조 없음**

Run: `Select-String -Path src/moderation/*.js -Pattern 'index\.js'`
Expected: 출력 없음

- [ ] **Step 5: 커맨드 핸들러 무변경 확인**

Run: `git diff 75d7066 HEAD -- index.js | Select-String -Pattern '^[-+].*(추방|타임아웃|hasModeratorRole|member\.kick|member\.timeout|ModerateMembers)'`
Expected: 출력 없음. `/추방`과 `/타임아웃` 커맨드와 `hasModeratorRole`의 코드가 변경되지 않았음을 증명한다.

- [ ] **Step 6: 변경 금지 대상 무변경 확인**

Run: `git diff 75d7066 HEAD -- index.js | Select-String -Pattern '^[-+]'`
Expected: 제거된 함수 정의와 `moderation.` 접두사 추가, import 추가 외에 예상 밖의 변경이 없어야 한다. 임베드 문구, 색상 값, 권한 메시지, 임계값 숫자가 `diff`에 나타나면 §3 계약 위반이므로 멈추고 원인을 조사한다.

- [ ] **Step 7: 커밋 1–4 되돌리기 검증**

일시적으로 되돌려 `index.js`가 정상 동작하는지 확인한 뒤 복구한다.

```bash
git stash list
git checkout 75d7066 -- index.js
node --check index.js
git checkout HEAD -- index.js
node --check index.js
```

Expected: 두 `node --check` 모두 출력 없음. `index.js`는 Task 5의 커밋에서만 변경되므로 이전 상태로 되돌려도 문법이 유효해야 한다.

- [ ] **Step 8: 최종 커밋 및 푸시**

Task 1–5에서 커밋했다면 이 단계에서 새 커밋은 필요 없다. 리모트 동기화만 확인한다.

```bash
git status --short
git push origin main
```

Expected: `git status --short` 출력 없음(클린), push 성공

- [ ] **Step 9: TODO.md 갱신**

`TODO.md`의 관리 도메인 관련 항목은 이번에 완료되지 않았다. `lib/` 기반 제안은 `src/` 구조로 대체될 것이므로, 스펙 §10의 목록에 맞춰 TODO.md를 갱신한다. (스펙 §10 참조)

```bash
git add TODO.md
git commit -m "docs: update TODO.md to reflect src/ module layout"
git push origin main
```

---

## 부록: 이 계획이 다루지 않는 것

스펙 §2에서 명시적으로 제외한 항목이다. 각 항목은 별도 설계가 필요하다.

| 항목 | 스펙 참조 | 상태 |
| --- | --- | --- |
| `interactionCreate` if-chain → 디스패치 맵 | §2, §10-8 | 미着手. `index.js:1583–3300`에 그대로 있음 |
| `initSqlite`와 `ensureCoreTables` 스키마 중복 | §2, §10-1 | 미着手. §4.4가 `initSqlite`를 건드리지 않음 |
| 하드코딩 서버 ID (`index.js:1250`, `1642`) | §2, §3 | 미着手. §3에서 이번 단계 제외로 명시 |
| `hasModeratorRole` → `src/discord/permissions.js` | §4.5, §10-2 | 미着手. 의도적으로 유지 |
| `src/secret/commands/admin.js` (1,001줄) | §2 | 미着手 |
| `deploy-commands.js` (811줄) | §2 | 미着手 |
| `punishmentLabel` 지연성 잠재 버그 | §7 | 미着手. §10-8에서 수정 예정 |

**`initSqlite`를 이번에 다루지 않은 이유:** 스펙 §4.4의 `createModeration`은 `lib/database.js`에서 주입받은 핸들러만 사용한다. `initSqlite`(`index.js:396`)는 `warnings` 테이블을 만든다. 이 함수를 건드리지 않고도 Task 5는 완전히 동작한다 — 테이블은 여전히 `initSqlite`가 만든다. 스키마 중복 정리는 `lib/database.js`와 `index.js` 양쪽을 동시에 다루어야 하므로 별도 단계다.