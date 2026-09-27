# Conflict Guard Phase 2 설계

## 목표

Discord 메시지에서 AI 없이 규칙 기반 갈등 신호를 추출하고, 대상 사용자가 명확한 경우 Phase 1의 관계 점수에 반영한다.

이번 단계에서는 상태 머신, 관리자 알림, 자동 제재를 구현하지 않는다.

## 모듈 구조

### `src/conflict/ConflictDetector.js`

메시지의 텍스트와 멘션 정보를 받아 다음 결과를 반환한다.

```js
{
  hasSignal: Boolean,
  targetUserId: string | null,
  hostility: number,
  type: string | null,
  confidence: number,
  isDeescalation: Boolean,
  isThreat: Boolean
}
```

대상은 Discord 멘션에서만 추출한다. 멘션이 없으면 `targetUserId`는 `null`이다.

규칙 우선순위는 위협, 상호 공격에 사용할 직접 공격, 일반 공격, 진정 표현 순으로 둔다. 위협 표현은 `isThreat`를 표시하되 Phase 2에서는 알림을 보내지 않는다.

### `src/conflict/ConflictSignal.js`

규칙과 가중치를 한 곳에 둔다.

- 일반 공격: +4
- 직접 공격: +8
- 반복 공격: +10
- 진정 표현: 별도 점수 증가 없음
- 위협: 별도 신호

반복 공격과 상호 공격은 Guard가 관계의 최근 상태를 사용해 추가 가중치를 계산한다.

### `src/conflict/ConflictGuard.js`

메시지 필터링, 감지 결과 처리, 관계 점수 반영을 담당한다.

처리 순서:

1. 봇 메시지, DM, 제외 채널이면 무시한다.
2. `ConflictDetector`로 메시지를 분석한다.
3. 신호가 없으면 무시한다.
4. 대상 사용자가 없으면 관계를 만들거나 점수를 변경하지 않는다.
5. 관계를 조회하고 마지막 상호작용 이후 경과 시간만큼 점수를 감쇠한다.
6. 공격 신호면 기본 가중치와 반복·상호 공격 가중치를 더한다.
7. 진정 표현이면 점수를 소폭 감소시키고 `consecutiveEscalations`를 0으로 초기화한다.
8. 작성자별 공격 횟수, 교환 횟수, 시각 필드를 갱신하고 저장한다.

`handleMessage(message)`는 분석·저장 결과를 반환하며 Discord에 메시지를 보내거나 제재하지 않는다.

## 규칙

초기 규칙은 오탐을 줄이기 위해 짧고 명시적인 한국어 표현만 사용한다.

- 일반 공격: `ㅂㅅ`, `병신`, `멍청`, `꺼져`, `닥쳐`
- 위협: `죽여`, `죽인다`, `가만 안 둬`, `찾아간다`
- 진정: `미안`, `내가 예민했음`, `그만하자`, `알겠음`, `됐어`, `괜찮음`

직접 공격은 공격 표현과 대상 멘션이 함께 있을 때로 정의한다. 공격 표현이 있지만 대상 멘션이 없으면 신호는 반환할 수 있으나 관계 점수는 변경하지 않는다.

## 시간 창과 상호 공격

기본 시간 창은 60초다. 관계의 마지막 상호작용이 60초를 초과하면 이전 공격 방향과 반복 상태를 현재 신호에 사용하지 않는다.

최근 공격 방향이 반대이고 시간 창 안이면 상호 공격으로 분류하여 추가 점수를 적용한다. 같은 작성자가 시간 창 안에 반복 공격하면 반복 공격 가중치를 적용한다.

## 설정 및 저장

`src/conflict/config.js`에 다음 기본값을 추가한다.

- `CONFLICT_WINDOW_MS = 60_000`
- `CONFLICT_GENERAL_ATTACK_SCORE = 4`
- `CONFLICT_DIRECT_ATTACK_SCORE = 8`
- `CONFLICT_REPEATED_ATTACK_SCORE = 10`
- `CONFLICT_MUTUAL_ATTACK_SCORE = 15`
- `CONFLICT_DEESCALATION_SCORE = 5`
- `ignoredChannels = []`

제외 채널은 Guard 생성자 옵션으로 주입한다. 메시지 원문은 저장하지 않는다.

## 기존 봇 연결

기존 `messageCreate` 리스너에서 `ConflictGuard.handleMessage(message)`를 호출한다. 기존 idle chat, balance game, 활동 기록, 레벨 보상 흐름은 변경하지 않는다. Guard 오류는 기존 메시지 처리와 봇 전체를 중단시키지 않도록 로그만 남긴다.

## 검증 기준

- 멘션에서 대상 사용자 ID를 정확히 추출한다.
- 공격·위협·진정 표현을 규칙에 따라 분류한다.
- 대상 없는 공격은 관계 점수를 변경하지 않는다.
- 봇 메시지, DM, 제외 채널은 저장소를 호출하지 않는다.
- 시간 창 내 반복·상호 공격 가중치가 적용된다.
- 60초를 초과한 이전 신호는 현재 관계 점수 계산에 사용되지 않는다.
- 기존 테스트 전체와 Phase 2 테스트가 통과한다.
