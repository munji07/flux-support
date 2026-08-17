const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'progress.db');

function openDatabase() {
  try {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    // 빠른 무결성 검사
    const check = db.prepare('PRAGMA quick_check').get();
    if (check && check.quick_check !== 'ok') {
      throw new Error(`Database quick_check failed: ${check.quick_check}`);
    }
    return db;
  } catch (error) {
    console.error('SQLite 데이터베이스 손상 감지, 백업 후 재생성합니다:', error.message);
    const corruptBackupPath = `${dbPath}.corrupt_${Date.now()}`;
    try {
      if (fs.existsSync(dbPath)) fs.renameSync(dbPath, corruptBackupPath);
      if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
    } catch (e) {
      console.error('손상 파일 백업 중 오류:', e.message);
    }
    const newDb = new Database(dbPath);
    newDb.pragma('journal_mode = WAL');
    newDb.pragma('synchronous = NORMAL');
    return newDb;
  }
}

let sqlite = openDatabase();

function executeWithRecovery(fn) {
  try {
    return fn();
  } catch (error) {
    if (error.code === 'SQLITE_CORRUPT' || error.message.includes('malformed')) {
      console.error('SQLITE_CORRUPT 발생, 데이터베이스 자동 복구(재생성) 수행 중...');
      try { sqlite.close(); } catch {}
      sqlite = openDatabase();
      return fn();
    }
    throw error;
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
