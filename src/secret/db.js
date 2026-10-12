'use strict';

const Database = require('better-sqlite3');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS welcome_config (
    guild_id   TEXT PRIMARY KEY,
    channel_id TEXT,
    baseline   INTEGER,
    seq        INTEGER,
    updated_at TEXT NOT NULL,
    leave_channel_id TEXT,
    punishment_channel_id TEXT,
    quarantine_channel_id TEXT
  );
  CREATE TABLE IF NOT EXISTS warnings (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS warning_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT,
    count INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reaction_roles (
    guild_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    role_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, message_id, emoji)
  );
  CREATE TABLE IF NOT EXISTS member_roles (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    role_ids TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS isolated_members (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role_ids TEXT NOT NULL,
    isolated_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
`;

const INSERT_IF_ABSENT = `
  INSERT OR IGNORE INTO welcome_config (guild_id, channel_id, baseline, seq, updated_at)
  VALUES (@guild_id, @channel_id, @baseline, NULL, @updated_at)
`;

const UPSERT_CHANNEL_ONLY = `
  INSERT INTO welcome_config (guild_id, channel_id, baseline, seq, updated_at)
  VALUES (@guild_id, @channel_id, NULL, NULL, @updated_at)
  ON CONFLICT(guild_id) DO UPDATE SET
    channel_id = @channel_id,
    updated_at = @updated_at
`;

function now() {
  return new Date().toISOString();
}

function createDatabase(filename) {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  for (const column of [
    'leave_channel_id',
    'punishment_channel_id',
    'base_role_id',
    'admin_role_id',
    'bot_role_id',
    'quarantine_role_id',
    'super_admin_role_id',
    'quarantine_channel_id',
  ]) {
    try { db.exec(`ALTER TABLE welcome_config ADD COLUMN ${column} TEXT`); } catch (error) {
      if (!error.message.includes('duplicate column name')) throw error;
    }
  }
  return db;
}

function getConfig(db, guildId) {
  return db
    .prepare('SELECT guild_id, channel_id, leave_channel_id, punishment_channel_id, quarantine_channel_id, baseline, seq FROM welcome_config WHERE guild_id = ?')
    .get(guildId);
}

function setChannel(db, { guildId, channelId, baseline }) {
  // 최초 설정일 때만 baseline을 기록한다. 이후에는 기존 값을 그대로 둔다.
  db.prepare(INSERT_IF_ABSENT).run({
    guild_id: guildId,
    channel_id: channelId,
    baseline,
    updated_at: now(),
  });

  db.prepare(UPSERT_CHANNEL_ONLY).run({
    guild_id: guildId,
    channel_id: channelId,
    updated_at: now(),
  });
}

function clearChannel(db, guildId) {
  db.prepare('UPDATE welcome_config SET channel_id = NULL, updated_at = ? WHERE guild_id = ?').run(
    now(),
    guildId
  );
}

function nextJoinSeq(db, guildId) {
  const allocate = db.transaction((id) => {
    const row = db.prepare('SELECT baseline, seq FROM welcome_config WHERE guild_id = ?').get(id);

    if (!row || row.baseline == null) return 0;

    const next = (row.seq == null ? row.baseline : row.seq) + 1;

    db.prepare('UPDATE welcome_config SET seq = ?, updated_at = ? WHERE guild_id = ?').run(
      next,
      now(),
      id
    );

    return next;
  });

  return allocate(guildId);
}

function setNoticeChannel(db, guildId, type, channelId) {
  const columns = { leave: 'leave_channel_id', punishment: 'punishment_channel_id', quarantine: 'quarantine_channel_id' };
  const column = columns[type];
  if (!column) throw new Error(`알 수 없는 채널 종류입니다: ${type}`);
  db.prepare(`INSERT INTO welcome_config (guild_id, ${column}, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET ${column} = excluded.${column}, updated_at = excluded.updated_at`)
    .run(guildId, channelId, now());
}

function clearNoticeChannel(db, guildId, type) {
  const columns = { leave: 'leave_channel_id', punishment: 'punishment_channel_id', quarantine: 'quarantine_channel_id' };
  const column = columns[type];
  if (!column) throw new Error(`알 수 없는 채널 종류입니다: ${type}`);
  db.prepare(`UPDATE welcome_config SET ${column} = NULL, updated_at = ? WHERE guild_id = ?`).run(now(), guildId);
}

function getWarningCount(db, guildId, userId) {
  return db.prepare('SELECT count FROM warnings WHERE guild_id = ? AND user_id = ?').get(guildId, userId)?.count ?? 0;
}

function changeWarningCount(db, guildId, userId, delta, reason = null) {
  const update = db.transaction(() => {
    const count = Math.max(0, getWarningCount(db, guildId, userId) + delta);
    db.prepare(`INSERT INTO warnings (guild_id, user_id, count, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET count = excluded.count, updated_at = excluded.updated_at`)
      .run(guildId, userId, count, now());
    db.prepare('INSERT INTO warning_history (guild_id, user_id, action, reason, count, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(guildId, userId, delta > 0 ? '추가' : '제거', reason, count, now());
    return count;
  });
  return update();
}

function setReactionRole(db, guildId, messageId, emoji, roleId) {
  db.prepare(`INSERT INTO reaction_roles (guild_id, message_id, emoji, role_id) VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, message_id, emoji) DO UPDATE SET role_id = excluded.role_id`)
    .run(guildId, messageId, emoji, roleId);
}

function deleteReactionRole(db, guildId, messageId, emoji) {
  return db.prepare('DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?').run(guildId, messageId, emoji);
}

function getReactionRole(db, guildId, messageId, emoji) {
  return db.prepare('SELECT message_id, emoji, role_id FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?').get(guildId, messageId, emoji);
}

function getReactionRoles(db, guildId, messageId) {
  return db.prepare('SELECT message_id, emoji, role_id FROM reaction_roles WHERE guild_id = ? AND message_id = ?').all(guildId, messageId);
}

const ROLE_COLUMNS = {
  base: 'base_role_id',
  admin: 'admin_role_id',
  bot: 'bot_role_id',
  quarantine: 'quarantine_role_id',
  super_admin: 'super_admin_role_id',
};

function roleColumn(type) {
  const column = ROLE_COLUMNS[type];
  if (!column) throw new Error(`알 수 없는 역할 종류입니다: ${type}`);
  return column;
}

function getRoles(db, guildId) {
  const row = db
    .prepare(
      'SELECT base_role_id, admin_role_id, bot_role_id, quarantine_role_id, super_admin_role_id FROM welcome_config WHERE guild_id = ?',
    )
    .get(guildId);
  return {
    base_role_id: row?.base_role_id ?? null,
    admin_role_id: row?.admin_role_id ?? null,
    bot_role_id: row?.bot_role_id ?? null,
    quarantine_role_id: row?.quarantine_role_id ?? null,
    super_admin_role_id: row?.super_admin_role_id ?? null,
  };
}

function setRole(db, guildId, type, roleId) {
  const column = roleColumn(type);
  db.prepare(`INSERT INTO welcome_config (guild_id, ${column}, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET ${column} = excluded.${column}, updated_at = excluded.updated_at`)
    .run(guildId, roleId, now());
}

function clearRole(db, guildId, type) {
  const column = roleColumn(type);
  db.prepare(`UPDATE welcome_config SET ${column} = NULL, updated_at = ? WHERE guild_id = ?`).run(now(), guildId);
}

function saveMemberRoles(db, guildId, memberRoles) {
  const insert = db.prepare(
    'INSERT INTO member_roles (guild_id, user_id, role_ids, saved_at) VALUES (?, ?, ?, ?)',
  );
  const stamp = now();
  const write = db.transaction(() => {
    db.prepare('DELETE FROM member_roles WHERE guild_id = ?').run(guildId);
    for (const [userId, roleIds] of memberRoles) {
      insert.run(guildId, userId, JSON.stringify(roleIds), stamp);
    }
  });
  write();
}

function getSavedMemberRoles(db, guildId) {
  return db
    .prepare('SELECT user_id, role_ids FROM member_roles WHERE guild_id = ? ORDER BY user_id')
    .all(guildId)
    .map((row) => ({ user_id: row.user_id, role_ids: JSON.parse(row.role_ids) }));
}

function getSavedMemberCount(db, guildId) {
  return db
    .prepare('SELECT COUNT(*) AS count FROM member_roles WHERE guild_id = ?')
    .get(guildId).count;
}

function clearSavedMemberRoles(db, guildId) {
  return db.prepare('DELETE FROM member_roles WHERE guild_id = ?').run(guildId);
}

function saveIsolatedMember(db, guildId, userId, roleIds) {
  db.prepare(`INSERT INTO isolated_members (guild_id, user_id, role_ids, isolated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET role_ids = excluded.role_ids, isolated_at = excluded.isolated_at`)
    .run(guildId, userId, JSON.stringify(roleIds), now());
}

function getIsolatedMember(db, guildId, userId) {
  const row = db.prepare('SELECT user_id, role_ids FROM isolated_members WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  return row ? { user_id: row.user_id, role_ids: JSON.parse(row.role_ids) } : null;
}

function clearIsolatedMember(db, guildId, userId) {
  return db.prepare('DELETE FROM isolated_members WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

module.exports = {
  createDatabase,
  getConfig,
  setChannel,
  clearChannel,
  nextJoinSeq,
  setNoticeChannel,
  clearNoticeChannel,
  changeWarningCount,
  getWarningCount,
  setReactionRole,
  deleteReactionRole,
  getReactionRole,
  getReactionRoles,
  getRoles,
  setRole,
  clearRole,
  saveMemberRoles,
  getSavedMemberRoles,
  getSavedMemberCount,
  clearSavedMemberRoles,
  saveIsolatedMember,
  getIsolatedMember,
  clearIsolatedMember,
};
