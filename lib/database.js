const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'progress.db');

function isCorruptError(error) {
  return Boolean(error) && (error.code === 'SQLITE_CORRUPT' || error.code === 'SQLITE_NOTADB' || /malformed|not a database/i.test(error.message || ''));
}

function ensureBotSettingsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_settings (
      guild_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (guild_id, key)
    )
  `);
}

function backupAndRecreate() {
  const corruptBackupPath = `${dbPath}.corrupt_${Date.now()}`;
  try {
    if (fs.existsSync(dbPath)) fs.renameSync(dbPath, corruptBackupPath);
    if (fs.existsSync(`${dbPath}-wal`)) fs.renameSync(`${dbPath}-wal`, `${corruptBackupPath}-wal`);
    if (fs.existsSync(`${dbPath}-shm`)) fs.renameSync(`${dbPath}-shm`, `${corruptBackupPath}-shm`);
    console.error(`손상된 데이터베이스를 백업했습니다: ${corruptBackupPath}`);
  } catch (e) {
    console.error('손상 파일 백업 중 오류:', e.message);
  }
}

function openDatabase() {
  try {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    ensureBotSettingsTable(db);
    return db;
  } catch (error) {
    console.error('SQLite 데이터베이스 열기 실패, 백업 후 재생성합니다:', error.message);
    backupAndRecreate();
    const newDb = new Database(dbPath);
    newDb.pragma('journal_mode = WAL');
    newDb.pragma('synchronous = NORMAL');
    ensureBotSettingsTable(newDb);
    return newDb;
  }
}

let sqlite = openDatabase();

function executeWithRecovery(fn) {
  try {
    return fn();
  } catch (error) {
    if (!isCorruptError(error)) throw error;

    console.error('SQLITE_CORRUPT 발생, 같은 파일로 재시도합니다.');
    try { sqlite.close(); } catch {}

    try {
      sqlite = openDatabase();
      return fn();
    } catch (retryError) {
      if (!isCorruptError(retryError)) throw retryError;

      console.error('SQLITE_CORRUPT 재발생, 데이터베이스를 백업 후 재생성합니다.');
      backupAndRecreate();
      sqlite = openDatabase();
      return fn();
    }
  }
}

function runSql(sql, params = []) {
  return executeWithRecovery(() => sqlite.prepare(sql).run(params));
}

function getSql(sql, params = []) {
  return executeWithRecovery(() => sqlite.prepare(sql).get(params));
}

function allSql(sql, params = []) {
  return executeWithRecovery(() => sqlite.prepare(sql).all(params));
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
