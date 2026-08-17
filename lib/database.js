const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const sqlite = new Database(path.join(__dirname, '..', 'progress.db'));
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('synchronous = NORMAL');

function runSql(sql, params = []) {
  return sqlite.prepare(sql).run(params);
}

function getSql(sql, params = []) {
  return sqlite.prepare(sql).get(params);
}

function allSql(sql, params = []) {
  return sqlite.prepare(sql).all(params);
}

function readSetting(guildId, key) {
  const row = getSql('SELECT value FROM bot_settings WHERE guild_id = ? AND key = ?', [guildId, key]);
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

function writeSetting(guildId, key, value) {
  runSql(
    `INSERT INTO bot_settings (guild_id, key, value)
     VALUES (?, ?, ?)
     ON CONFLICT (guild_id, key) DO UPDATE SET value = excluded.value`,
    [guildId, key, JSON.stringify(value)]
  );
}

function deleteSetting(guildId, key) {
  runSql('DELETE FROM bot_settings WHERE guild_id = ? AND key = ?', [guildId, key]);
}

function loadChannelConfig(filePath) {
  try {
    const config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    config.global ??= {};
    config.global.welcomeChannelId ??= '';
    config.global.goodbyeChannelId ??= '';
    config.global.entryRoleIds ??= [];
    config.guilds ??= {};
    return config;
  } catch {
    return { global: { welcomeChannelId: '', goodbyeChannelId: '', entryRoleIds: [] }, guilds: {} };
  }
}

module.exports = {
  sqlite,
  runSql,
  getSql,
  allSql,
  dbGet: getSql,
  dbAll: allSql,
  dbRun: runSql,
  readSetting,
  writeSetting,
  deleteSetting,
  loadChannelConfig,
};
