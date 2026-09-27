const {
  getRelationKey,
  createConflictRelation,
} = require("./ConflictRelation.js");
const { normalizeState } = require("./ConflictState.js");

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS conflict_relations (
    guild_id TEXT NOT NULL,
    relation_key TEXT NOT NULL,
    user_a TEXT NOT NULL,
    user_b TEXT NOT NULL,
    conflict_score REAL NOT NULL DEFAULT 0,
    last_interaction_at INTEGER,
    last_increase_at INTEGER,
    last_intervention_at INTEGER,
    consecutive_escalations INTEGER NOT NULL DEFAULT 0,
    recent_attacks TEXT NOT NULL DEFAULT '{}',
    exchanges INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'NORMAL',
    PRIMARY KEY (guild_id, relation_key)
  )`;

class ConflictStore {
  constructor({ runSql, getSql, allSql }) {
    this.runSql = runSql;
    this.getSql = getSql;
    this.allSql = allSql;
  }

  ensureTable() {
    this.runSql(CREATE_TABLE_SQL);
    const columns = this.allSql?.("PRAGMA table_info(conflict_relations)") ?? [];
    if (!columns.some((column) => column.name === "state")) {
      this.runSql(
        "ALTER TABLE conflict_relations ADD COLUMN state TEXT NOT NULL DEFAULT 'NORMAL'",
      );
    }
  }

  get(guildId, userA, userB) {
    const relation = createConflictRelation(guildId, userA, userB);
    const row = this.getSql(
      `SELECT * FROM conflict_relations
       WHERE guild_id = ? AND relation_key = ?`,
      [guildId, relation.relationKey],
    );
    if (!row) return relation;

    let recentAttacks;
    try {
      recentAttacks = JSON.parse(row.recent_attacks || "{}");
    } catch {
      recentAttacks = null;
    }
    if (!recentAttacks || typeof recentAttacks !== "object") {
      recentAttacks = relation.recentAttacks;
    }

    return {
      ...relation,
      conflictScore: Number(row.conflict_score),
      lastInteractionAt: row.last_interaction_at,
      lastIncreaseAt: row.last_increase_at,
      lastInterventionAt: row.last_intervention_at,
      consecutiveEscalations: Number(row.consecutive_escalations),
      recentAttacks,
      exchanges: Number(row.exchanges),
      state: normalizeState(row.state),
    };
  }

  save(relation) {
    this.runSql(
      `INSERT INTO conflict_relations (
        guild_id, relation_key, user_a, user_b, conflict_score,
        last_interaction_at, last_increase_at, last_intervention_at,
        consecutive_escalations, recent_attacks, exchanges, state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (guild_id, relation_key) DO UPDATE SET
        user_a = excluded.user_a,
        user_b = excluded.user_b,
        conflict_score = excluded.conflict_score,
        last_interaction_at = excluded.last_interaction_at,
        last_increase_at = excluded.last_increase_at,
        last_intervention_at = excluded.last_intervention_at,
        consecutive_escalations = excluded.consecutive_escalations,
        recent_attacks = excluded.recent_attacks,
        exchanges = excluded.exchanges,
        state = excluded.state`,
      [
        relation.guildId,
        relation.relationKey || getRelationKey(relation.userA, relation.userB),
        relation.userA,
        relation.userB,
        relation.conflictScore,
        relation.lastInteractionAt,
        relation.lastIncreaseAt,
        relation.lastInterventionAt,
        relation.consecutiveEscalations,
        JSON.stringify(relation.recentAttacks),
        relation.exchanges,
        normalizeState(relation.state),
      ],
    );
    return relation;
  }
}

module.exports = { ConflictStore };
