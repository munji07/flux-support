const {
  CONFLICT_SCORE_MIN,
  CONFLICT_SCORE_MAX,
  CONFLICT_SCORE_DECAY_PER_MINUTE,
} = require("./config.js");

function clampScore(score) {
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore)) return CONFLICT_SCORE_MIN;
  return Math.min(
    CONFLICT_SCORE_MAX,
    Math.max(CONFLICT_SCORE_MIN, numericScore),
  );
}

function increaseScore(score, amount) {
  return clampScore(clampScore(score) + Number(amount || 0));
}

function decayScore(score, elapsedMinutes) {
  const elapsed = Number(elapsedMinutes);
  const decay = Number.isFinite(elapsed) && elapsed > 0
    ? elapsed * CONFLICT_SCORE_DECAY_PER_MINUTE
    : 0;
  return clampScore(clampScore(score) - decay);
}

module.exports = { clampScore, increaseScore, decayScore };
