const { CONFLICT_WINDOW_MS } = require("./config.js");
const { CONFLICT_STATES, normalizeState } = require("./ConflictState.js");

function transitionConflictState(relation, signal = {}, now = Date.now()) {
  const current = normalizeState(relation.state);
  const elapsed = relation.lastInteractionAt == null
    ? 0
    : Math.max(0, now - relation.lastInteractionAt);
  const withinWindow = elapsed <= CONFLICT_WINDOW_MS;

  if (signal.isDeescalation) {
    relation.consecutiveEscalations = 0;
    relation.state = CONFLICT_STATES.COOLING;
    return relation.state;
  }

  if (!signal.hasSignal) {
    if (current === CONFLICT_STATES.COOLING && (!withinWindow || relation.conflictScore <= 0)) {
      relation.state = CONFLICT_STATES.NORMAL;
    }
    return relation.state;
  }

  if (current === CONFLICT_STATES.NORMAL) {
    relation.state = CONFLICT_STATES.SUSPICIOUS;
  } else if (current === CONFLICT_STATES.SUSPICIOUS) {
    relation.state = withinWindow
      ? CONFLICT_STATES.ESCALATING
      : CONFLICT_STATES.SUSPICIOUS;
  } else if (current === CONFLICT_STATES.ESCALATING) {
    if (signal.type === "MUTUAL_ATTACK" || relation.conflictScore >= 60) {
      relation.state = CONFLICT_STATES.CONFLICT;
    }
  } else if (current === CONFLICT_STATES.COOLING) {
    relation.state = CONFLICT_STATES.SUSPICIOUS;
  }
  return relation.state;
}

module.exports = { transitionConflictState };
