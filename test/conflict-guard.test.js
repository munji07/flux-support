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
  const store = options.store ?? {
    get(guildId, userA, userB) {
      const [userAKey, userBKey] = [userA, userB].sort();
      const key = `${guildId}:${userAKey}:${userBKey}`;
      return (
        relations.get(key) ?? {
          guildId,
          relationKey: `${userAKey}:${userBKey}`,
          userA: userAKey,
          userB: userBKey,
          conflictScore: 0,
          lastInteractionAt: null,
          lastIncreaseAt: null,
          lastInterventionAt: null,
          consecutiveEscalations: 0,
          recentAttacks: { [userAKey]: 0, [userBKey]: 0 },
          exchanges: 0,
        }
      );
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
    guard: new ConflictGuard({
      detector,
      store,
      now: () => 100000,
      ...options,
    }),
    relations,
  };
}

test("멘션 대상이 있는 공격은 관계 점수를 증가시키고 저장한다", async () => {
  const { guard, relations } = makeGuard();
  const result = await guard.handleMessage(makeMessage());
  assert.equal(result.detected, true);
  assert.equal(relations.get("guild:111:222").conflictScore, 8);
});

test("공격 처리 후 점수·상태 전후 이벤트를 기록한다", async () => {
  const events = [];
  const { guard, relations } = makeGuard({ logger: { record: (event) => events.push(event) } });
  await guard.handleMessage(makeMessage());
  assert.equal(events.length, 1);
  assert.equal(events[0].scoreBefore, 0);
  assert.equal(events[0].scoreAfter, relations.get("guild:111:222").conflictScore);
  assert.equal(events[0].stateBefore, "NORMAL");
  assert.equal(events[0].stateAfter, "SUSPICIOUS");
  assert.equal("messageContent" in events[0], false);
});

test("Logger 오류는 관계 저장과 메시지 처리를 실패시키지 않는다", async () => {
  const { guard, relations } = makeGuard({ logger: { record: () => { throw new Error("log down"); } } });
  await assert.doesNotReject(() => guard.handleMessage(makeMessage()));
  assert.equal(relations.get("guild:111:222").conflictScore, 8);
});

test("대상 없는 공격은 저장소를 호출하지 않는다", async () => {
  let saves = 0;
  const { guard } = makeGuard({
    detector: {
      detect: () => ({
        hasSignal: true,
        targetUserId: null,
        type: "GENERAL_ATTACK",
        isDeescalation: false,
      }),
    },
    store: {
      get() {
        throw new Error("should not get");
      },
      save() {
        saves += 1;
      },
    },
  });
  const result = await guard.handleMessage(
    makeMessage({ mentions: [], content: "꺼져" }),
  );
  assert.equal(result.detected, true);
  assert.equal(saves, 0);
});

test("봇·DM·제외 채널 메시지는 무시한다", async () => {
  let calls = 0;
  const { guard } = makeGuard({
    ignoredChannels: ["ignored"],
    store: {
      get() {
        calls += 1;
      },
      save() {
        calls += 1;
      },
    },
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
  const expectedScore = 4 - ((200001 - 100000) / 60000) * 0.5 + 8;
  assert.equal(result.relation.conflictScore, expectedScore);
  assert.equal(relations.get("111:222").conflictScore, expectedScore);
});

test("첫 공격은 관계를 SUSPICIOUS로 저장한다", async () => {
  const { guard, relations } = makeGuard();
  await guard.handleMessage(makeMessage());
  assert.equal(relations.get("guild:111:222").state, "SUSPICIOUS");
});

test("상호 공격은 관계를 CONFLICT로 저장한다", async () => {
  const { guard, relations } = makeGuard({
    detector: {
      detect: () => ({
        hasSignal: true,
        targetUserId: "222",
        type: "MUTUAL_ATTACK",
        isDeescalation: false,
        isThreat: false,
      }),
    },
  });
  await guard.handleMessage(makeMessage());
  assert.equal(relations.get("guild:111:222").state, "CONFLICT");
});
