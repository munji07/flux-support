# 관리(Moderation) 도메인 추출 설계

날짜: 2026-10-12
상태: 승인됨
대상: `index.js` (3,406줄)

## 1. 목적

`index.js`가 3,406줄 단일 파일로 10개 이상의 무관한 책임을 담당하고 있다. 커맨드 55개가 `index.js:1583–3300`에 걸친 순차 `if (interaction.commandName === ...)` 체인으로 존재하며, 테스트 커버리지는 `index.js`에 0%다.

이 설계는 그 monolith에서 **도메인 하나를 수직으로 추출**해 모듈 경계와 테스트 가능한 기반을 만드는 것이 목표다. 전체 구조 개선의 첫 단계이며, 이 단계의 패턴이 나머지 도메인에 반복 적용된다.

## 2. 범위

이번 단계에서 **하는 것**:

- 관리 도메인(경고·제재·제재 채널 알림)을 `src/moderation/`으로 추출
- 추출된 로직에 `node --test` 단위 테스트 추가
- `index.js`는 해당 커맨드들을 모듈에 위임만 하도록 변경

이번 단계에서 **하지 않는 것** (명시적으로 제외):

- `interactionCreate` if-chain을 디스패치 맵으로 변환 — 전체 구조가 안정된 뒤 별도 단계
- `initSqlite`(`index.js:396`)와 `lib/database.js:22`의 스키마 중복 정의 정리 — 별도 단계
- 하드코딩된 서버 ID(`index.js:1250`, `1642`) 상수화 — 별도 단계
- `src/secret/commands/admin.js`(1,001줄), `deploy-commands.js`(811줄) — 별도 단계
- `messageCreate` / `voiceStateUpdate` / `presenceUpdate` 이벤트 추출 — 별도 단계

**제외 사유**: 각 항목은 서로 다른 도메인 경계를 건드리므로, 한 커밋에서 함께 다루면 "무엇이 깨뜨렸는지" 추적이 불가능해진다.

## 3. 동작 보존 계약

사용자에게 노출되는 동작은 **어떤 경우에도 변하지 않는다.** 리팩토링의 성공 기준은 "코드가 달라졌지만 사용자는 아무 차이를 모르felt 못함"이다.

변경 금지 대상:

| 대상 | 현재 위치 |
| --- | --- |
| 커맨드 이름 (경고, 추방, 타임아웃, 제제채널) | `index.js:3090`, `3115`, `3173`, `3222`, `3259` |
| 임베드 제목·본문·필드 문구 | `sendPenaltyNotification` 및 각 커맨드 |
| 임베드 색상 값 | `0xed4245`, `0xffc857`, `0x57f287` |
| 권한 거부 메시지 | 각 커맨드별 `errorEmbed` 호출 |
| 제재 임계값 (경고 2·3·4·5·6) | `warningPunishmentFor` `index.js:309` |
| `bot_settings` 키 이름 (`penalty_channel_id`, `admin_role_id`) | `index.js:300`, `304` |
| `warnings` 테이블 스키마 | `index.js:419` |
| `hasModeratorRole`의 판정 로직 | `index.js:262` |
| 에phemeral 플래그 적용 위치 | 각 커맨드 |

허용되는 유일한 예외: **동작을 바꾸지 않는 한 종류의 수정** — 이미 상수로 존재하는 값의 참조 통일. 예: `index.js:1642`의 리터럴 `"1538513625730383902"`를 `COMMUNITY_GUILD_ID`로 교체. 값은 동일하며 결과가 달라지지 않는다. 단, 이 변경은 §2에서 다른 도메인으로 분류했으므로 이번 단계에서는 수행하지 않는다.

## 4. 모듈 구조

`src/conflict/`가 이미 사용하는 구조를 따른다: 의존성 주입 생성자 또는 팩토리 함수, 단일 진입점, 외부 상태에 의존하지 않는 순수 로직.

```
src/moderation/
  warning.js      경고 카운트·사유 기록
  punishment.js   제재 판정·권한 검사·적용
  notify.js       제재 채널 알림 전송
  index.js        createModeration() 팩토리
```

### 4.1 `warning.js`

`index.js:269–298`의 `getWarningCount`, `updateWarning`를 이동한다.

**의존성**: `getSql`, `runSql` (SQLite 접근). `index.js`를 import하지 않는다.

**유지할 동작:**
- `reasons` 최대 20개 유지 (`reasons.slice(-20)`)
- `delta > 0`일 때만 사유 추가
- `nextCount` 하한 0 (`Math.max(0, ...)`)
- 반환값은 갱신된 카운트
- `updated_at`은 두 분기 모두 `Date.now()`

**확장 지점**: 현재 시각을 주입 가능하게 한다. 기본값 `Date.now`. 테스트에서 시간 의존성을 제거하기 위함이며, 본질적 복잡도 증가가 아니다.

### 4.2 `punishment.js`

`index.js:309–369`의 `warningPunishmentFor`, `punishmentLabel`, `applyWarningPunishment`를 이동한다.

**중요**: `applyWarningPunishment`의 실제 호출 지점은 `/경고` 커맨드 하나뿐이다 (`index.js:3191`).

| 커맨드 | 구현 방식 | 이번 단계 범위 |
| --- | --- | --- |
| `/경고` | `updateWarning` → `warningPunishmentFor` → `applyWarningPunishment` → `sendPenaltyNotification` 호출 | 모듈로 이동 |
| `/추방` | `member.kick(reason)`을 직접 호출 (`:3247`). `applyWarningPunishment` 미사용 | **커맨드 핸들러는 `index.js`에 유지** |
| `/타임아웃` | `member.timeout(...)`을 직접 호출. `applyWarningPunishment` 미사용 | **커맨드 핸들러는 `index.js`에 유지** |
| `/제제채널` | `getPenaltyChannelId` / `setPenaltyChannelId`로 설정만 변경 | `getPenaltyChannelId`만 모듈로 이동, 핸들러는 유지 |

`/추방`과 `/타임아웃`이 `applyWarningPunishment`를 쓰지 않는 것은 §3의 동작 보존 계약에 따른다. 두 커맨드에는 경고 횟수 기반 임계값이 없고, 매번 즉시 실행되는 명령이다. 임계값을 적용하는 것은 **동작 변경**이므로 이번 단계에서 손대지 않는다.

**이 비대칭은 명시적으로 기록한다.** 나중에 `punishment.js`를 읽는 사람은 `applyWarningPunishment`가 모든 제재 경로에 쓰인다고 오해할 수 있다. 추출 시 `punishment.js` 상단에 주석으로 남긴다.

**의존성**: 없음. `PermissionsBitField` 플래그 값만 사용한다.

**유지할 임계값:**
```
count >= 6  → ban
count === 5 → kick
count === 4 → timeout 24h
count === 3 → timeout 1h
count === 2 → timeout 10m
그 외       → null (조치 없음)
```

**유지할 반환 계약** — 호출자가 분기하므로 형식이 중요:
- 제재 없음: `{ type: null, applied: false }`
- timeout 권한 부족: `{ type, minutes, applied: false, error }`
- timeout 성공: `{ type, minutes, applied: true }`
- kick/ban 권한 부족: `{ type, applied: false, error }`
- kick/ban 성공: `{ type, applied: true }`

**주의**: `punishmentLabel`은 `punishment.minutes`를 읽지만 `warningPunishmentFor`는 `ms`를 반환한다 (`index.js:322`). 즉 `punishmentLabel`의 timeout 분기는 현재 항상 `undefined분`을 출력한다. **이것은 기존 버그이며 이번 단계에서 수정하지 않는다** — §3의 동작 보존 계약에 걸린다. §7에서 별도로 다룬다.

### 4.3 `notify.js`

`index.js:371–394`의 `sendPenaltyNotification`을 이동한다.

**의존성**: `getPenaltyChannelId`(설정 조회), `EmbedBuilder`, `MessageFlags`.

**유지할 동작:**
- `penalty_channel_id` 미설정 시 아무것도 하지 않고 return
- 채널 ID로 채널을 찾지 못하면 return
- `channel.send` 실패는 `.catch(() => {})`로 무시 (조용히 실패)
- 임베지 필드 순서: 경고 횟수 → 적용 제제 → 사유
- 사유가 빈 문자열이면 `"사유 없음"`

### 4.4 `index.js` (모듈) — 팩토리

`src/secret/integration.js`의 `createSecretIntegration` 패턴을 따른다.

```js
function createModeration({ getSql, runSql, readSetting, writeSetting, deleteSetting }) {
  // warning / punishment / notify 모듈을 생성하고 조합
  return {
    getWarningCount,
    updateWarning,
    warningPunishmentFor,
    punishmentLabel,
    applyWarningPunishment,
    getPenaltyChannelId,
    setPenaltyChannelId,
    sendPenaltyNotification,
  };
}
```

DB 접근(`getSql`, `runSql`)과 설정 접근(`readSetting`, `writeSetting`, `deleteSetting`)을 주입받아, 테스트 시 실제 DB 없이 호출할 수 있게 한다.

`index.js`는 생성 시점에 DB 핸들러를 넘기고, 커맨드 핸들러는 반환된 객체의 메서드만 호출한다.

### 4.5 `index.js`에 남는 것

다음은 **이번 단계에서 이동하지 않는다.** 명시적 결정이며, 근거를 함께 기록한다.

**`hasModeratorRole` (`index.js:262`) — 유지.**

관리 도메인 전용으로 보이지만 호출 지점이 4곳이며, 2곳은 관리 도메인 밖이다.

| 호출 지점 | 소속 |
| --- | --- |
| `index.js:3101` | `/갈등설정` (갈등 도메인) |
| `index.js:3118` | `/제제채널` (관리 도메인) |
| `index.js:1349` | 아케이드 보상 버튼 (아케이드 도메인) |
| `index.js:1672` | `/채널지정` (채널 도메인) |

관리 도메인으로 옮기면 다른 세 도메인이 관리 모듈에 의존하게 되어 경계가 뒤집힌다. 이 함수는 권한 판정이라는 독립적인 관심사이므로 §10의 유틸 통합 단계에서 `src/discord/permissions.js`로 이동하는 것이 맞다. **이번 단계에서는 `index.js`에 그대로 둔다.**

**`getPenaltyChannelId` / `setPenaltyChannelId` (`index.js:300–307`) — 모듈로 이동.**

`getPenaltyChannelId`는 `sendPenaltyNotification`(`:378`)과 `/제제채널` 조회(`:3159`)에서, `setPenaltyChannelId`는 `/제제채널` 설정·해제(`:3136`, `:3148`)에서만 쓰인다. 두 함수 모두 관리 도메인에 완전히 속하므로 함께 이동한다.

## 5. 데이터 흐름

```
사용자가 /경고 실행
  → index.js의 interactionCreate (기존 위치 유지)
    → moderation.updateWarning(guildId, userId, +1, 사유)   [warning.js]
      → SQLite warnings 테이블
    → moderation.warningPunishmentFor(count)                 [punishment.js]
      → 순수 계산, DB 없음
    → moderation.applyWarningPunishment(guild, member, ...) [punishment.js]
      → member.timeout / kick / ban 호출
    → moderation.sendPenaltyNotification(...)                [notify.js]
      → penalty_channel_id 채널로 임베지 전송
```

모듈은 `index.js`의 순서를 그대로 따른다. 이 순서는 사용자에게 보이는 동작이므로 바꿀 수 없다.

## 6. 검증 방법

각 단계마다 아래 세 가지를 실행하고 **모두 통과해야** 다음 단계로 진행한다.

1. **문법 검증** — `node --check index.js`, `node --check src/moderation/*.js`
2. **회귀 검증** — `npm test` (현재 11개 테스트). 리팩토링으로 어떤 기존 테스트도 깨지지 않아야 한다.
3. **신규 단위 테스트** — `npm test`에 추가되는 테스트

**테스트 커버리지 목표**: 이번 단계에서 다루는 도메인에 대해 커버리지 100%. 커버리지 도구는 프로젝트에 없으므로 (package.json에 없음) 테스트가 존재하는 것으로 판단하며, 도구 추가는 이번 단계 범위 밖이다.

**추가할 테스트 케이스:**

`warning.js`
- 경고 추가 시 카운트가 1 증가한다
- 경고 횟수 감소 시 0 아래로 내려가지 않는다
- 사유가 20개를 초과하면 오래된 것부터 버려진다
- delta가 0일 때 사유가 추가되지 않는다

`punishment.js`
- 각 경고 횟수(2·3·4·5·6)가 올바른 제재를 반환한다
- 1회 이하에서는 제재가 없다
- 권한이 없으면 `applied: false`와 `error`를 반환한다
- 권한이 있으면 `applied: true`를 반환한다

`notify.js`
- 채널 ID가 설정되지 않으면 아무것도 보내지 않는다
- 채널을 찾지 못하면 아무것도 보내지 않는다
- 정상 호출 시 임베지가 전송된다
- `setPenaltyChannelId`에 빈 문자열을 넣으면 설정이 삭제된다

테스트는 DB 없이 순수하게 작성한다. `warning.js`는 SQLite 핸들러를 스텁으로 주입하고, `punishment.js`와 `notify.js`는 `guild`/`member` 객체를 스텁으로 만든다.

`notification` 채널 전송 실패는 `.catch(() => {})`로 삼켜지므로, 실패 케이스 테스트는 "예외가 전파되지 않음"을 확인하는 것으로 한다.

## 7. 알려진 버그 — 이번 단계에서 수정하지 않음

`punishmentLabel` (`index.js:318–324`)이 `punishment.minutes`를 읽지만, 같은 파일의 `warningPunishmentFor` (`index.js:309–316`)는 timeout에 대해 `ms`를 반환하고 `minutes`는 없다.

```js
// warningPunishmentFor
if (count === 4) return { type: "timeout", ms: 24 * 60 * 60 * 1000 };

// punishmentLabel
if (punishment.type === "timeout") return `타임아웃 ${punishment.minutes}분`;
```

`punishmentLabel` 호출 지점은 두 곳이며, 각자가 서로 다른 객체를 넘긴다.

| 호출 지점 | 넘기는 객체 | `minutes` 유무 | 실제 출력 |
| --- | --- | --- | --- |
| `index.js:3205` — `/경고` 커맨드 응답 | `applyWarningPunishment`의 반환값 | **있음** (`:337`, `:339`에서 `{...punishment, minutes}` 구성) | 정상. 예: `타임아웃 1440분` |
| `index.js:389` — 제재 채널 알림 | `applyWarningPunishment`의 반환값을 `sendPenaltyNotification`가 전달 (`:3197` → `:370`) | **있음** (동일 객체이므로) | 정상 |

즉 **두 호출 모두 같은 객체를 받으므로 현재 버그가 사용자 노출 화면에 나타나지 않는다.** `warningPunishmentFor`의 원본은 `applyWarningPunishment` 내부(`:327`)에서만 소비되고 밖으로 나가지 않는다.

따라서 이것은 **지연성 잠재 버그**다. 지금은 증상이 없지만, `applyWarningPunishment`가 원본 객체를 그대로 반환하도록 바뀌는 순간 "타임아웃 undefined분"이 노출된다.

수정 방향은 `punishmentLabel`이 `minutes ?? ms / 60000`을 사용하도록 방어적으로 만드는 것이다. 현재 동작은 동일하게 유지되므로 §3 계약에 저촉되지 않는다. 그러나 **이번 단계의 목표가 구조 추출이지 버그 수정이 아니므로**, §3의 "명백한 버그만 수정" 허용 범위와 충돌하지 않으면서도 범위를 넘지 않도록, 이 수정은 §10의 7번 디스패치 변환 단계에서 함께 수행한다.

모듈로 옮길 때는 **현재 동작을 그대로 보존**한다. 즉 `punishmentLabel`의 `minutes` 참조를 그대로 옮기되, 이 잠재 문제를 코드 주석이 아닌 위 명세로 남긴다.

## 8. 커밋 구성

각 커밋은 독립적으로 되돌릴 수 있어야 한다.

```
1. feat: add src/moderation/warning.js with tests
2. feat: add src/moderation/punishment.js with tests
3. feat: add src/moderation/notify.js with tests
4. feat: add src/moderation/index.js factory
5. refactor: route moderation commands through module
```

5번 커밋이 `index.js`에서 ~150줄을 제거한다. 1–4번은 `index.js`를 건드리지 않으므로 각각은 새 코드 추가에 실패해도 기존 동작에 영향을 주지 않는다.

**커밋 1–4는 신규 파일만 추가하므로 되돌려도 안전하다.** 리스크는 전부 커밋 5에 집중되며, 이는 5번만 되돌리면 원상 복구된다.

## 9. 성공 기준

다음을 **모두** 만족하면 이번 단계가 완료된 것이다.

- [ ] `npm test` 통과 (기존 11개 + 신규 테스트 전부)
- [ ] `node --check index.js` 통과
- [ ] `node --check src/moderation/index.js` 통과
- [ ] `index.js` 라인 수가 3,406에서 3,270 이하로 감소 (§4.5의 유지 결정 반영)
- [ ] `src/moderation/` 전체에 `client` 참조가 없다
- [ ] `src/moderation/`가 `index.js`를 import하지 않는다
- [ ] `/추방`, `/타임아웃` 커맨드 핸들러가 `index.js`에 그대로 남아 있고 코드가 변경되지 않았다
- [ ] `hasModeratorRole`이 `index.js:262`에 그대로 있고 코드가 변경되지 않았다
- [ ] §3의 변경 금지 대상이 어느 것도 바뀌지 않았다
- [ ] 커밋 1–4를 되려도 `index.js`가 정상 동작한다

## 10. 이후 단계 (이번 설계 범위 밖)

추출 완료 후 순서대로 진행할 것을 권한다. 각 단계마다 위와 동일한 절차를 따른다.

1. 스키마 정의 단일화 — `initSqlite`와 `lib/database.js:ensureCoreTables` 중복 제거
2. 권한 판정 유틸 — `hasModeratorRole`을 `src/discord/permissions.js`로 이동
3. 임베드·응답 유틸 통합 — `safeReply`, `safeDefer`, `makeEmbed`을 `src/discord/`로
4. 친구·관심사·알림 → `src/friends/`
5. XP·코인·출석 → `src/progress/`
6. 미니게임·아케이드 → `src/arcade/`
7. 입장·퇴장·음성·Presence 이벤트 → `src/events/`
8. `interactionCreate` if-chain → 디스패치 맵 (§7 지연성 버그 수정 포함)
8. `src/secret/commands/admin.js`, `deploy-commands.js` 분할

`TODO.md`는 `lib/` 디렉터리 구성을 제안하고 있으나, 실제로는 `src/conflict/`와 `src/secret/`가 이미 확립된 패턴이다. 따라서 이 시리즈는 `src/` 아래로 통일한다. `TODO.md`의 항목은 이후 `TODO.md`를 갱신할 때 이 구조에 맞춰 정리한다.