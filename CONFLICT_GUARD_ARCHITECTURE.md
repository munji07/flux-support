# DISHOUSE Conflict Guard

## 1. 개요

DISHOUSE 서버 내에서 사용자 간의 갈등이 실제 싸움으로 발전하기 전에 감지하고 완화하기 위한 내부 시스템.

이 시스템은 AI를 사용하지 않는다.

사용자에게 갈등 점수나 내부 상태를 직접 노출하지 않으며, 특정 사용자를 "위험한 사용자"로 평가하는 시스템이 아니다.

핵심 목적은 다음과 같다.

* 사용자 간 갈등의 진행 상황 감지
* 짧은 시간 동안 반복되는 공격 패턴 감지
* 상호 공격 여부 감지
* 갈등 상태의 자연스러운 감소
* 필요한 경우에만 관리자에게 알림
* 사소한 장난이나 일반적인 대화에 대한 오탐 최소화

---

# 2. 핵심 설계 원칙

## 2.1 단일 메시지로 싸움을 판단하지 않는다

다음과 같은 단일 메시지만으로 사용자를 제재하거나 싸움으로 판단하지 않는다.

```text
"꺼져"
"병신"
"뭐하냐"
```

이러한 표현은 친구 간 장난일 가능성이 있기 때문이다.

대신 다음 요소를 함께 고려한다.

```text
공격성
+
반복성
+
상호성
+
시간 밀도
+
대상 명확성
```

---

## 2.2 사용자 자체가 아니라 관계를 추적한다

개인별 "위험도"를 저장하지 않는다.

대신 특정 두 사용자 사이의 관계 상태를 추적한다.

```text
A ↔ B
```

예:

```text
A ↔ B = conflictScore 65

A ↔ C = conflictScore 0
```

A가 B와 싸웠다는 이유로 A를 위험 사용자로 취급하지 않는다.

---

## 2.3 Conflict Score는 사용자에게 공개하지 않는다

내부적으로만 사용하는 상태값이다.

```js
conflictScore
```

는 다음 의미를 가진다.

> 특정 두 사용자 사이의 최근 대화에서 갈등 신호가 얼마나 누적되고 있는가.

사람에 대한 평판 점수나 위험도 점수가 아니다.

---

## 2.4 감지와 제재를 분리한다

감지 시스템이 직접 타임아웃, 킥, 밴 등의 처벌을 결정하지 않는다.

```text
ConflictDetector
        ↓
ConflictState
        ↓
InterventionManager
        ↓
ModeratorNotifier
```

감지 로직과 실제 행동을 분리하여 오탐 발생 시 피해를 최소화한다.

---

# 3. 전체 아키텍처

```text
Discord Gateway
      │
      ▼
messageCreate
      │
      ▼
┌─────────────────────┐
│   ConflictGuard     │
│  시스템 진입점       │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ ConflictDetector     │
│ 갈등 신호 분석       │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ ConflictRelation     │
│ A ↔ B 상태 관리      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ ConflictScore        │
│ 점수 계산             │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ InterventionManager  │
│ 개입 여부 판단       │
└───────┬────────┬────┘
        │        │
        ▼        ▼
   관리자 알림   사용자 개입
```

---

# 4. 디렉터리 구조

현재 Discord 봇 프로젝트에 다음과 같은 구조로 추가한다.

```text
src/
├── conflict/
│   ├── ConflictGuard.js
│   ├── ConflictDetector.js
│   ├── ConflictRelation.js
│   ├── ConflictScore.js
│   ├── ConflictStore.js
│   ├── InterventionManager.js
│   ├── ConflictLogger.js
│   └── config.js
│
├── commands/
├── events/
├── utils/
└── index.js
```

프로젝트의 기존 구조가 다르다면 `conflict` 모듈의 위치만 변경하고 내부 구조는 유지한다.

---

# 5. 모듈 책임

## 5.1 ConflictGuard

전체 Conflict Guard 시스템의 진입점.

역할:

* Discord 메시지 수신
* 분석 대상 여부 확인
* ConflictDetector 호출
* 관계 상태 조회
* 점수 계산
* 개입 판단

예상 구조:

```js
class ConflictGuard {
    async handleMessage(message) {}
}
```

---

# 6. ConflictDetector

메시지 자체에서 갈등 관련 신호를 추출한다.

AI를 사용하지 않는다.

분석 대상:

```text
- 공격 표현
- 직접적인 상대방 언급
- 반복 공격
- 도발
- 위협 표현
- 상호 공격
- 진정 표현
```

결과 예시:

```js
{
    hasSignal: true,

    targetUserId: "222222222222222222",

    hostility: 0.7,

    type: "DIRECT_ATTACK",

    confidence: 1.0
}
```

`confidence`는 AI의 확률값이 아니다.

규칙 기반 시스템에서 해당 판단이 얼마나 명확한지를 나타내는 내부 값이다.

---

# 7. 대상 사용자 식별

대상을 확실하게 식별할 수 있을 때만 관계 점수를 적용한다.

가장 확실한 방법:

```text
Discord 멘션
```

예:

```text
@사용자 너 뭐함?
```

이면:

```js
author = A
target = B
```

로 처리한다.

대상을 확실하게 알 수 없는 경우:

```js
targetUserId = null
```

로 처리한다.

억지로 최근 대화 상대를 공격 대상으로 추정하지 않는다.

---

# 8. ConflictRelation

두 사용자 사이의 관계 상태를 표현한다.

예:

```js
class ConflictRelation {
    constructor(userA, userB) {
        this.userA = userA;
        this.userB = userB;

        this.conflictScore = 0;

        this.lastInteractionAt = null;
        this.lastIncreaseAt = null;
        this.lastInterventionAt = null;

        this.consecutiveEscalations = 0;

        this.recentAttacks = {
            [userA]: 0,
            [userB]: 0
        };

        this.exchanges = 0;
    }
}
```

---

# 9. Relation Key

A → B와 B → A를 동일한 관계로 취급한다.

```js
function getRelationKey(userA, userB) {
    return [userA, userB]
        .sort()
        .join(":");
}
```

예:

```text
A = 111
B = 222

111:222
```

A가 B에게 메시지를 보내거나 B가 A에게 메시지를 보내더라도 같은 관계로 저장한다.

---

# 10. Conflict Score

범위:

```text
0 ~ 100
```

단, 100은 "위험한 사람"이라는 의미가 아니다.

특정 관계에서 최근 갈등 신호가 얼마나 누적되었는지를 나타낸다.

---

# 11. 점수 증가 요소

초기 버전에서는 다음 신호를 사용한다.

### 일반적인 공격

```text
+3 ~ +5
```

### 직접적인 공격

```text
+5 ~ +10
```

### 반복 공격

```text
+5 ~ +15
```

### 상호 공격

```text
+10 ~ +20
```

### 짧은 시간 내 반복

```text
추가 가중치
```

### 심각한 위협

일반적인 Conflict Score와 별도의 관리자 알림 대상으로 취급한다.

---

# 12. 점수 감소 요소

### 시간 경과

갈등이 계속되지 않으면 자연스럽게 감소한다.

```text
시간 경과
    ↓
Conflict Score 감소
```

예:

```js
function decayScore(score, elapsedMinutes) {
    const decay = elapsedMinutes * 0.5;

    return Math.max(0, score - decay);
}
```

실제 값은 운영 데이터를 보고 조정한다.

---

## 12.1 진정 표현

다음과 같은 표현은 갈등 종료 신호로 사용할 수 있다.

```text
미안
내가 예민했음
그만하자
알겠음
됐어
괜찮음
```

감지 시 점수를 감소시키거나 `consecutiveEscalations`를 초기화한다.

---

# 13. 상호 공격 감지

싸움 감지에서 가장 중요한 요소 중 하나.

다음 패턴을 높은 우선순위로 본다.

```text
A → B 공격
B → A 공격
A → B 공격
B → A 공격
```

반대로:

```text
A → B 공격
B → 무반응
```

은 상대적으로 낮은 위험도로 취급한다.

---

# 14. 시간 창

갈등 여부는 최근 대화 흐름을 기준으로 판단한다.

초기 설정:

```text
30 ~ 60초
```

예:

```text
A 공격
↓ 5초
B 반격
↓ 8초
A 반격
```

이 경우 갈등 가능성을 높게 평가한다.

반면:

```text
A 공격
↓ 20분
B 일반적인 대화
```

라면 동일한 갈등으로 계속 유지하지 않는다.

---

# 15. 상태 머신

Conflict Guard는 다음 상태를 가진다.

```text
NORMAL
   │
   │ 갈등 신호
   ▼
SUSPICIOUS
   │
   │ 추가 공격 / 반격
   ▼
ESCALATING
   │
   │ 지속적인 갈등
   ▼
CONFLICT
   │
   ├──────────────┐
   │              │
   ▼              ▼
COOLING       MODERATOR_ALERT
   │
   ▼
NORMAL
```

---

# 16. 상태 설명

## NORMAL

일반적인 상태.

아무런 개입도 하지 않는다.

---

## SUSPICIOUS

갈등 신호가 발견됐지만 싸움이라고 판단하기에는 부족한 상태.

사용자에게 아무런 메시지도 보내지 않는다.

---

## ESCALATING

갈등 신호가 연속적으로 발생하는 상태.

내부적으로 집중 관찰한다.

---

## CONFLICT

명확한 갈등 패턴이 확인된 상태.

필요할 경우 InterventionManager가 개입을 결정한다.

---

## COOLING

공격이 중단되고 대화가 안정되는 상태.

시간 경과와 일반적인 대화를 통해 NORMAL로 돌아간다.

---

# 17. InterventionManager

Conflict Score를 실제 행동으로 변환한다.

초기 버전에서는 자동 제재를 수행하지 않는다.

예:

```js
if (score >= threshold) {
    notifyModerator();
}
```

관리자에게만 알림을 보낸다.

---

# 18. 초기 개입 단계

```text
Score < 40
→ 아무것도 하지 않음

40 ~ 59
→ 내부 관찰

60 ~ 79
→ 필요 시 중립적인 진정 메시지

80+
→ 관리자 알림
```

실제 기준값은 운영 데이터를 보고 조정한다.

---

# 19. Intervention Cooldown

봇이 반복적으로 개입하는 것을 방지한다.

예:

```text
개입
 ↓
5분간 동일 관계에 대한 자동 개입 제한
```

단, 내부 감지는 계속한다.

---

# 20. 채널 예외

다음과 같은 채널은 서버 설정으로 분석에서 제외할 수 있어야 한다.

```js
ignoredChannels: []
```

예:

```js
ignoredChannels: [
    "123456789",
    "987654321"
]
```

사용 목적에 따라 다음 채널을 제외할 수 있다.

```text
#봇-테스트
#개발
#밈
```

---

# 21. 봇 메시지 제외

봇이 생성한 메시지는 Conflict Guard가 다시 분석하지 않는다.

```js
if (message.author.bot) {
    return;
}
```

---

# 22. 관리자 메시지

관리자의 메시지는 기본적으로 일반 메시지와 동일하게 처리할 수 있다.

단, 관리자 개입 메시지는 Conflict Guard가 분석하지 않도록 별도의 메시지 ID 또는 봇 생성 여부를 확인한다.

---

# 23. 데이터 저장

초기 버전에서는 다음 데이터만 저장한다.

```text
guild_id
user_a
user_b
conflict_score
last_interaction_at
last_increase_at
last_intervention_at
consecutive_escalations
recent_attack_count
exchange_count
```

---

# 24. Conflict Events

운영 중 문제가 발생했을 때 원인을 분석할 수 있도록 별도의 이벤트 로그를 둘 수 있다.

예:

```js
{
    guildId,
    relationKey,

    type: "DIRECT_ATTACK",

    scoreBefore: 35,
    scoreAfter: 43,

    timestamp
}
```

메시지 원문 전체를 장기간 저장하지 않는 것을 기본으로 한다.

필요한 경우 로그 보존 기간을 별도로 설정한다.

---

# 25. 초기 버전에서 하지 않는 것

다음 기능은 초기 버전에서 제외한다.

```text
❌ AI 분석
❌ 자동 밴
❌ 자동 킥
❌ 자동 타임아웃
❌ 개인별 위험도
❌ 공개 Conflict Score
❌ 한 번의 욕설만으로 개입
❌ 대상이 불명확한 메시지의 강제 관계 연결
```

이유는 오탐 가능성이 높기 때문이다.

---

# 26. 개발 단계

## Phase 1 — 상태 시스템

구현:

```text
ConflictRelation
ConflictStore
ConflictScore
```

목표:

```text
A ↔ B 상태 생성
점수 저장
점수 증가
점수 감소
시간 감쇠
```

---

## Phase 2 — 규칙 기반 감지

구현:

```text
ConflictDetector
```

감지:

```text
직접 공격
반복 공격
멘션
상호 공격
진정 표현
시간 밀도
```

---

## Phase 3 — 상태 머신

구현:

```text
NORMAL
SUSPICIOUS
ESCALATING
CONFLICT
COOLING
```

---

## Phase 4 — 로그

관리자 전용 로그를 추가한다.

예:

```text
[HOUSE GUARD]

관계: A ↔ B
상태: ESCALATING

최근 신호:
- DIRECT_ATTACK × 2
- COUNTER_ATTACK × 1
- HIGH_FREQUENCY

자동 제재: 없음
```

---

## Phase 5 — 실제 서버 테스트

최소 며칠간 자동 제재 없이 운영한다.

확인할 항목:

```text
실제 싸움을 놓치는가?
장난을 싸움으로 판단하는가?
점수가 너무 빨리 올라가는가?
점수가 너무 늦게 내려가는가?
같은 사람에게 반복적으로 오탐하는가?
```

---

## Phase 6 — 개입 기능

충분한 테스트 이후에만 사용자 개입 및 관리자 알림을 활성화한다.

---

# 27. 핵심 목표

Conflict Guard의 최종 목표는:

```text
"싸운 사람을 찾아내는 봇"
```

이 아니다.

다음과 같은 흐름을 만드는 것이다.

```text
작은 갈등
   ↓
갈등 신호 감지
   ↓
상태 추적
   ↓
악화 여부 확인
   ↓
필요할 때만 개입
   ↓
진정
   ↓
자연스럽게 상태 초기화
```

DISHOUSE의 친목 분위기를 유지하면서도 봇이 과도하게 대화에 끼어들지 않는 것을 최우선으로 한다.
