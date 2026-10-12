const TERMINAL_STATUSES = new Set(["confirmed", "rejected"]);

function canNotify(status) {
  return !TERMINAL_STATUSES.has(status);
}

function canDecide(status) {
  return !TERMINAL_STATUSES.has(status);
}

function applyDonationToLedger(currentTotal, amount) {
  return Number(currentTotal || 0) + Number(amount || 0);
}

function approvalTargets(options) {
  const interactive = options.dmAvailable
    ? "dm"
    : options.logChannelAvailable
      ? "channel"
      : null;
  const audit =
    interactive === "channel"
      ? []
      : [options.logChannelAvailable ? "channel" : "dm"].filter(Boolean);
  return { interactive, audit };
}

function tierFor(amount) {
  return amount >= 5000 ? "premium" : amount >= 3000 ? "basic" : "free";
}

async function applyLedgerDelta(db, userId, delta) {
  if (!db) return { applied: false, total: 0, tier: "free" };
  const amount = Number(delta) || 0;
  try {
    const { rows } = await db.query(
      `INSERT INTO user_subscriptions (user_id, tier, donation_amount, created_at, updated_at)
       VALUES ($1, 'free', GREATEST($2, 0), NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET donation_amount = GREATEST(user_subscriptions.donation_amount + $3, 0),
             updated_at = NOW()
       RETURNING donation_amount`,
      [userId, Math.max(amount, 0), amount],
    );
    const total = Number(rows[0]?.donation_amount || 0);
    const tier = tierFor(total);
    await db.query(
      "UPDATE user_subscriptions SET tier = $1, updated_at = NOW() WHERE user_id = $2",
      [tier, userId],
    );
    return { applied: true, total, tier };
  } catch (error) {
    return { applied: false, total: 0, tier: "free", error };
  }
}

function recordApprovedDonation(db, userId, amount) {
  return applyLedgerDelta(db, userId, Math.abs(Number(amount) || 0));
}

module.exports = {
  TERMINAL_STATUSES,
  canNotify,
  canDecide,
  applyDonationToLedger,
  approvalTargets,
  tierFor,
  applyLedgerDelta,
  recordApprovedDonation,
};
