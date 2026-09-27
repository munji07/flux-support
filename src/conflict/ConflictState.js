const CONFLICT_STATES = Object.freeze({
  NORMAL: "NORMAL",
  SUSPICIOUS: "SUSPICIOUS",
  ESCALATING: "ESCALATING",
  CONFLICT: "CONFLICT",
  COOLING: "COOLING",
});

function normalizeState(state) {
  return Object.values(CONFLICT_STATES).includes(state)
    ? state
    : CONFLICT_STATES.NORMAL;
}

module.exports = { CONFLICT_STATES, normalizeState };
