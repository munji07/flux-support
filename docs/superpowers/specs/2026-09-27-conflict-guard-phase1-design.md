# Conflict Guard Phase 1 설계

## 목표

`CONFLICT_GUARD_ARCHITECTURE.md`의 Phase 1을 구현한다. 단일 메시지를 제재 근거로 사용하지 않고, 같은 서버의 두 사용자 사이 관계 상태를 저장·조회하며 Conflict Score를 시간에 따라 증가·감소시킬 수 있는 기반을 만든다.

이번 단계에서는 메시지 감지, 상태 머신, 관리자 알림, 자동 개입을 구현하지 않는다.

## 범위

- 사용자 두 명을 정렬된 관계 키(`userA:userB`)로 표현한다.
- 관계별 초기 상태와 Conflict Score를 메모리 객체로 표현한다.
- 점수는 0~100으로 제한한다.
- 감쇠는 `elapsedMinutes * 0.5`만큼 적용하고 0 아래로 내려가지 않게 한다.
- SQLite에 관계 상태를 저장하고 조회한다.
- 기존 봇 초기화 시 필요한 테이블을 생성한다.
- Phase 1 핵심 동작을 Node 기본 테스트로 검증한다.

## 모듈 구조

### `src/conflict/ConflictRelation.js`

관계 상태 객체를 생성한다. 다음 정보를 가진다.

- `guildId`
- `userA`, `userB`
- `conflictScore`
- `lastInteractionAt`
- `lastIncreaseAt`
- `lastInterventionAt`
- `consecutiveEscalations`
- `recentAttacks` — 양방향 사용자별 카운트
- `exchanges`

### `src/conflict/ConflictStore.js`

SQLite 접근을 캡슐화한다. 서버 ID와 관계 키를 기준으로 관계를 생성하거나 조회하고, 변경된 관계를 저장한다. 저장 계층은 기존 `lib/database.js`의 헬퍼를 사용한다.

### `src/conflict/ConflictScore.js`

순수 함수로 점수 계산을 담당한다.

- `clampScore(score)`
- `increaseScore(score, amount)`
- `decayScore(score, elapsedMinutes)`

### `src/conflict/config.js`

Phase 1에서 사용할 기본값을 둔다. 감쇠율은 문서 기준 `0.5 / minute`, 점수 범위는 `0~100`으로 한다. 이후 감지·개입 단계에서 사용할 임계값은 이 모듈에 확장 가능하게 둔다.

## 데이터베이스

다음 SQLite 테이블을 추가한다.

```sql
conflict_relations (
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
)
```

`recent_attacks`는 JSON 문자열로 저장하고, 읽을 때 객체로 복원한다. 메시지 원문은 저장하지 않는다.

## 오류 처리

- 존재하지 않는 관계를 조회하면 기본 관계를 반환한다.
- 저장 계층의 SQLite 손상 복구는 기존 `lib/database.js`에 위임한다.
- 잘못된 점수 입력은 순수 계산 함수에서 숫자로 정규화하고 범위를 제한한다.
- 이번 단계에서는 Discord 이벤트에 연결하지 않으므로 사용자 메시지에 응답하거나 제재하지 않는다.

## 검증 기준

- 관계 키가 입력 순서와 무관하게 동일하다.
- 새 관계의 기본 상태가 문서의 필드와 일치한다.
- 점수 증가가 100을 넘지 않는다.
- 점수 감쇠가 0 아래로 내려가지 않는다.
- SQLite 저장 후 조회 시 모든 관계 필드가 보존된다.
- 기존 테스트 전체가 통과한다.

## 후속 단계와의 경계

Phase 2의 `ConflictDetector`는 이 단계의 관계 저장·점수 계산 모듈을 소비한다. Phase 3의 상태 머신은 관계 상태 필드를 확장할 수 있지만, 이번 단계에서는 상태 전이를 수행하지 않는다.
