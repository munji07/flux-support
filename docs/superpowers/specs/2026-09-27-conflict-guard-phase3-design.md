# Conflict Guard Phase 3 설계

## 목표

Phase 1·2에서 누적한 관계 점수와 갈등 신호를 바탕으로 관계별 상태를 추적한다. 상태 전이는 내부 데이터만 변경하며 사용자 메시지, 관리자 알림, 자동 제재는 수행하지 않는다.

## 상태

- `NORMAL`: 갈등 신호가 없는 기본 상태
- `SUSPICIOUS`: 갈등 신호 1회가 감지된 상태
- `ESCALATING`: 시간 창 내 추가 공격 또는 반격이 감지된 상태
- `CONFLICT`: 상호 공격이 확인되었거나 점수가 60 이상인 상태
- `COOLING`: 공격이 중단되었거나 진정 표현이 감지된 상태

상태 문자열은 `src/conflict/ConflictState.js`에서 상수로 관리한다.

## 전이 규칙

`ConflictStateMachine.transition(relation, signal, now)`는 기존 관계와 현재 감지 신호를 받아 관계를 갱신한 뒤 새 상태를 반환한다.

- `NORMAL → SUSPICIOUS`: 공격·위협 신호가 처음 발생
- `SUSPICIOUS → ESCALATING`: `CONFLICT_WINDOW_MS` 안에 추가 공격이 발생
- `ESCALATING → CONFLICT`: 상호 공격이 감지되거나 점수가 60 이상
- `CONFLICT → COOLING`: 진정 표현 또는 시간 창 밖의 일반 상호작용
- `COOLING → NORMAL`: 점수가 0이 되거나 시간 창 동안 추가 공격이 없음
- 진정 표현은 어떤 상태에서든 `COOLING`으로 전환하고 `consecutiveEscalations`를 0으로 만든다.
- 신호가 없는 일반 메시지는 관계 점수를 변경하지 않으며 상태 전이도 하지 않는다.

상태 머신은 Discord와 데이터베이스에 의존하지 않는 순수 모듈로 만든다.

## 관계 데이터

`ConflictRelation`에 `state` 필드를 추가하고 기본값은 `NORMAL`로 한다. SQLite `conflict_relations` 테이블에는 `state TEXT NOT NULL DEFAULT 'NORMAL'` 컬럼을 추가한다. 기존 데이터는 마이그레이션 시 `NORMAL`로 해석한다.

## Guard 연결

`ConflictGuard`는 점수와 공격 카운트를 갱신한 뒤 상태 머신을 호출하고, 변경된 `state`를 같은 저장 작업으로 저장한다. 상태 전이는 점수 계산과 분리한다.

상태 머신은 관리자 알림이나 자동 제재를 호출하지 않는다. `InterventionManager`는 후속 Phase에서 별도로 추가한다.

## 검증 기준

- 새 관계의 상태가 `NORMAL`이다.
- 다섯 상태가 정확한 문자열로 저장·복원된다.
- 문서에 정의된 모든 상태 전이가 테스트된다.
- 진정 표현과 시간 경과가 `COOLING`을 거쳐 `NORMAL`로 회복시킨다.
- 기존 Phase 1·2 동작과 점수 계산이 변경되지 않는다.
- 기존 관계 행에 `state` 컬럼이 없어도 초기화·조회가 실패하지 않는다.
- 전체 테스트가 통과한다.
