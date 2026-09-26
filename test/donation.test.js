const test = require("node:test");
const assert = require("node:assert");
const {
  canNotify,
  canDecide,
  applyDonationToLedger,
  approvalTargets,
  tierFor,
  recordApprovedDonation,
  applyLedgerDelta,
} = require("../src/support/donation.js");

function fakePg(donationAmount) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ donation_amount: donationAmount }] };
    },
  };
}

test("승인 대기중인 요청은 입금완료 알림을 다시 보낼 수 있다", () => {
  assert.strictEqual(canNotify("awaiting"), true);
});

test("이미 승인된 요청은 입금완료 알림을 다시 보낼 수 없다", () => {
  assert.strictEqual(canNotify("confirmed"), false);
});

test("거절된 요청은 입금완료 알림을 다시 보낼 수 없다", () => {
  assert.strictEqual(canNotify("rejected"), false);
});

test("승인 대기와 미알림 상태는 관리자가 처리할 수 있다", () => {
  assert.strictEqual(canDecide("pending"), true);
  assert.strictEqual(canDecide("awaiting"), true);
});

test("종료된 요청은 다시 처리할 수 없다", () => {
  assert.strictEqual(canDecide("confirmed"), false);
  assert.strictEqual(canDecide("rejected"), false);
});

test("승인 시 후원 원장이 요청 금액만큼 증가한다", () => {
  assert.strictEqual(applyDonationToLedger(3000, 5000), 8000);
});

test("원장이 비어 있어도 승인 금액이 반영된다", () => {
  assert.strictEqual(applyDonationToLedger(0, 5000), 5000);
});

test("승인 버튼은 DM과 채널 양쪽에 동시에 인터랙티브로 노출되지 않는다", () => {
  const result = approvalTargets({ dmAvailable: true, logChannelAvailable: true });
  assert.strictEqual(result.interactive, "dm");
  assert.deepStrictEqual(result.audit, ["channel"]);
});

test("DM이 막혔으면 채널이 유일한 승인 처리 창구가 된다", () => {
  const result = approvalTargets({ dmAvailable: false, logChannelAvailable: true });
  assert.strictEqual(result.interactive, "channel");
  assert.deepStrictEqual(result.audit, []);
});

test("DM도 채널도 없으면 인터랙티브 창구가 없다", () => {
  const result = approvalTargets({ dmAvailable: false, logChannelAvailable: false });
  assert.strictEqual(result.interactive, null);
});

test("티어 경계값이 올바르다", () => {
  assert.strictEqual(tierFor(5000), "premium");
  assert.strictEqual(tierFor(4999), "basic");
  assert.strictEqual(tierFor(3000), "basic");
  assert.strictEqual(tierFor(2999), "free");
});

test("승인된 후원이 PG 원장에 누적되고 티어가 새 누적액으로 재계산된다", async () => {
  const db = fakePg(8000);
  const result = await recordApprovedDonation(db, "u1", 5000);
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.total, 8000);
  assert.strictEqual(result.tier, "premium");
  assert.strictEqual(db.calls.length, 2, "누적 upsert 후 티어 update 2회여야 함");
  assert.ok(
    db.calls[1].sql.includes("tier"),
    "두 번째 쿼리가 티어를 갱신해야 함",
  );
});

test("PG가 없으면 승인 자체는 실패하지 않고 미반영으로 보고된다", async () => {
  const result = await recordApprovedDonation(null, "u1", 5000);
  assert.strictEqual(result.applied, false);
  assert.strictEqual(result.total, 0);
});

test("PG 조회가 실패해도 예외를 던지지 않고 미반영으로 보고된다", async () => {
  const db = {
    query: async () => {
      throw new Error("connection terminated");
    },
  };
  const result = await recordApprovedDonation(db, "u1", 5000);
  assert.strictEqual(result.applied, false);
});

test("원장 증가분은 양수로 전달된다", async () => {
  const db = fakePg(8000);
  const result = await applyLedgerDelta(db, "u1", 5000);
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.total, 8000);
  assert.strictEqual(result.tier, "premium");
});

test("원장 감소분은 음수로 전달되고 결과는 0 미만으로 내려가지 않는다", async () => {
  const db = fakePg(0);
  const result = await applyLedgerDelta(db, "u1", -99999);
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.total, 0, "음수가 되지 않아야 함");
  assert.strictEqual(result.tier, "free");
  assert.ok(
    db.calls[0].sql.includes("GREATEST"),
    "upsert가 GREATEST로 하한을 강제해야 함",
  );
});

test("감소 후 티어도 새 누적액 기준으로 재계산된다", async () => {
  const db = fakePg(3500);
  const result = await applyLedgerDelta(db, "u1", -1000);
  assert.strictEqual(result.total, 3500);
  assert.strictEqual(result.tier, "basic", "3500원은 basic");
});

test("PG가 없으면 원장 조작은 미반영으로 보고되고 예외를 던지지 않는다", async () => {
  const result = await applyLedgerDelta(null, "u1", 5000);
  assert.strictEqual(result.applied, false);
  assert.strictEqual(result.total, 0);
});

test("PG 조회가 실패해도 원장 조작은 예외를 던지지 않는다", async () => {
  const db = {
    query: async () => {
      throw new Error("connection terminated");
    },
  };
  const result = await applyLedgerDelta(db, "u1", 5000);
  assert.strictEqual(result.applied, false);
});

test("수동 /후원 추가와 자동 승인은 완전히 동일한 쿼리를 실행한다", async () => {
  const manualDb = fakePg(8000);
  const autoDb = fakePg(8000);
  const manual = await applyLedgerDelta(manualDb, "u1", 5000);
  const auto = await recordApprovedDonation(autoDb, "u1", 5000);
  assert.deepStrictEqual(manual, auto, "결과 객체가 동일해야 함");
  assert.deepStrictEqual(
    manualDb.calls.map((c) => c.sql),
    autoDb.calls.map((c) => c.sql),
    "실행 SQL이 동일해야 함 — 갈라지면 원래 버그가 재발한다",
  );
  assert.deepStrictEqual(
    manualDb.calls.map((c) => c.params),
    autoDb.calls.map((c) => c.params),
    "파라미터도 동일해야 함",
  );
});
