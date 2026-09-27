# Conflict Guard Phase 4 설계

## 목표

Conflict Guard의 점수·상태 변화 원인을 분석할 수 있도록 관리자용 내부 Conflict Event 로그를 저장한다. 이번 단계에서는 관리자 채널 전송, 사용자 개입, 자동 제재를 구현하지 않는다.

## 이벤트 형식

```js
{
  guildId,
  relationKey,
  type,
  stateBefore,
  stateAfter,
  scoreBefore,
  scoreAfter,
  timestamp
}
```

메시지 원문, 개인별 위험도, 공개용 Conflict Score는 저장하지 않는다.

## 모듈

### `src/conflict/ConflictLogger.js`

`ConflictLogger({ runSql, getSql, allSql })`를 제공한다.

- `ensureTable()` — 로그 테이블을 생성한다.
- `record(event)` — 이벤트를 저장한다.
- `list(guildId, options)` — 서버·관계·시간 범위로 로그를 조회한다.
- `format(event)` — 관리자 콘솔용 한 줄 요약을 반환한다.

입력 이벤트의 점수는 0~100으로 제한하고, 상태는 허용된 상태 값으로 정규화한다.

## 데이터베이스

```sql
conflict_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  relation_key TEXT NOT NULL,
  type TEXT NOT NULL,
  state_before TEXT NOT NULL,
  state_after TEXT NOT NULL,
  score_before REAL NOT NULL,
  score_after REAL NOT NULL,
  timestamp INTEGER NOT NULL
)
```

`guild_id`, `relation_key`, `timestamp`에 인덱스를 추가한다. 보존 기간은 Phase 4에서 제한하지 않으며, 운영 관찰 후 별도 정책으로 결정한다.

## Guard 연결

`ConflictGuard`는 관계를 조회한 직후 `scoreBefore`와 `stateBefore`를 복사한다. 점수와 상태를 갱신하고 저장한 뒤, 신호가 실제 관계 변경을 만들었을 때만 `ConflictLogger.record()`를 호출한다.

로그 저장 실패는 메시지 처리 실패로 전파하지 않는다. 로그 오류를 콘솔에 기록하고 기존 점수·상태 저장 결과는 유지한다.

상태가 변하지 않은 일반 감쇠나 대상 없는 메시지는 이벤트 로그를 만들지 않는다. 공격·위협·진정·상태 전이처럼 운영상 의미 있는 신호만 기록한다.

## 검증 기준

- 로그 테이블과 인덱스가 반복 초기화에 안전하다.
- 이벤트의 점수·상태·관계 키가 보존된다.
- 서버와 관계별 조회가 동작한다.
- 메시지 원문이 저장되지 않는다.
- Guard가 점수·상태 변경 전후를 정확히 기록한다.
- Logger 오류가 기존 메시지 처리와 관계 저장을 중단시키지 않는다.
- 기존 Phase 1~3 테스트와 Phase 4 테스트가 모두 통과한다.
