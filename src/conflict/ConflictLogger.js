const { clampScore } = require("./ConflictScore.js");
const { normalizeState } = require("./ConflictState.js");

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS conflict_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    relation_key TEXT NOT NULL,
    type TEXT NOT NULL,
    state_before TEXT NOT NULL,
    state_after TEXT NOT NULL,
    score_before REAL NOT NULL,
    score_after REAL NOT NULL,
    timestamp INTEGER NOT NULL
  )`;

class ConflictLogger {
  constructor({ runSql, getSql, allSql }) {
    this.runSql = runSql;
    this.getSql = getSql;
    this.allSql = allSql;
  }

  ensureTable() {
    this.runSql(CREATE_TABLE_SQL);
    this.runSql("CREATE INDEX IF NOT EXISTS idx_conflict_events_guild ON conflict_events (guild_id)");
    this.runSql("CREATE INDEX IF NOT EXISTS idx_conflict_events_relation ON conflict_events (relation_key)");
    this.runSql("CREATE INDEX IF NOT EXISTS idx_conflict_events_timestamp ON conflict_events (timestamp)");
  }

  normalize(event) {
    return {
      guildId: String(event.guildId),
      relationKey: String(event.relationKey),
      type: String(event.type),
      stateBefore: normalizeState(event.stateBefore),
      stateAfter: normalizeState(event.stateAfter),
      scoreBefore: clampScore(event.scoreBefore),
      scoreAfter: clampScore(event.scoreAfter),
      timestamp: Number.isFinite(Number(event.timestamp)) ? Number(event.timestamp) : Date.now(),
    };
  }

  record(event) {
    const normalized = this.normalize(event);
    this.runSql(
      `INSERT INTO conflict_events
       (guild_id, relation_key, type, state_before, state_after, score_before, score_after, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [normalized.guildId, normalized.relationKey, normalized.type, normalized.stateBefore,
        normalized.stateAfter, normalized.scoreBefore, normalized.scoreAfter, normalized.timestamp],
    );
    return normalized;
  }

  list(guildId, { relationKey, from, to, limit = 100 } = {}) {
    const clauses = ["guild_id = ?"];
    const params = [String(guildId)];
    if (relationKey) { clauses.push("relation_key = ?"); params.push(String(relationKey)); }
    if (Number.isFinite(Number(from))) { clauses.push("timestamp >= ?"); params.push(Number(from)); }
    if (Number.isFinite(Number(to))) { clauses.push("timestamp <= ?"); params.push(Number(to)); }
    const safeLimit = Math.max(1, Math.floor(Number(limit) || 100));
    params.push(safeLimit);
    return this.allSql(
      `SELECT guild_id AS guildId, relation_key AS relationKey, type,
              state_before AS stateBefore, state_after AS stateAfter,
              score_before AS scoreBefore, score_after AS scoreAfter, timestamp
       FROM conflict_events WHERE ${clauses.join(" AND ")}
       ORDER BY timestamp DESC, id DESC LIMIT ?`,
      params,
    );
  }

  format(event) {
    const value = this.normalize(event);
    return `[HOUSE GUARD] ${value.type} ${value.relationKey} ${value.stateBefore} → ${value.stateAfter} ${value.scoreBefore} → ${value.scoreAfter}`;
  }
}

module.exports = { ConflictLogger };
