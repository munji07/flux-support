const { Client, GatewayIntentBits, EmbedBuilder, ChannelType, MessageFlags, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const pg = require('pg');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env' });

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const ADMIN_USER_ID = '1269575955626725390';
const MODERATOR_ROLE_ID = '1538529402256760884';
const LEVEL_GUILD_ID = '1538513625730383902';
const channelConfigPath = path.join(__dirname, 'channel-config.json');
const sqlitePath = path.join(__dirname, 'progress.db');

const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (databaseUrl) {
  databaseUrl.searchParams.delete('sslmode');
  databaseUrl.searchParams.delete('channel_binding');
}

const db = databaseUrl
  ? new pg.Pool({ connectionString: databaseUrl.toString(), ssl: { rejectUnauthorized: false } })
  : null;

const sqlite = new Database(sqlitePath);
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

function loadChannelConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(channelConfigPath, 'utf8'));
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

function saveChannelConfig(config) {
  fs.writeFileSync(channelConfigPath, JSON.stringify(config, null, 2));
}

function dbGet(sql, params = []) {
  return sqlite.prepare(sql).get(params);
}

function dbAll(sql, params = []) {
  return sqlite.prepare(sql).all(params);
}

function dbRun(sql, params = []) {
  return sqlite.prepare(sql).run(params);
}

function readSetting(guildId, key) {
  const row = dbGet('SELECT value FROM bot_settings WHERE guild_id = ? AND key = ?', [guildId, key]);
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

function writeSetting(guildId, key, value) {
  dbRun(
    `INSERT INTO bot_settings (guild_id, key, value)
     VALUES (?, ?, ?)
     ON CONFLICT (guild_id, key) DO UPDATE SET value = excluded.value`,
    [guildId, key, JSON.stringify(value)]
  );
}

function deleteSetting(guildId, key) {
  dbRun('DELETE FROM bot_settings WHERE guild_id = ? AND key = ?', [guildId, key]);
}

function getEntryRoleIds(guildId) {
  const value = readSetting(guildId, 'entry_role_ids');
  return Array.isArray(value) ? value : [];
}

function setEntryRoleIds(guildId, roleIds) {
  writeSetting(guildId, 'entry_role_ids', roleIds);
}

function getWelcomeChannelId(guildId) {
  return readSetting(guildId, 'welcome_channel_id') || '';
}

function setWelcomeChannelId(guildId, channelId) {
  if (channelId) writeSetting(guildId, 'welcome_channel_id', channelId);
  else deleteSetting(guildId, 'welcome_channel_id');
}

function getGoodbyeChannelId(guildId) {
  return readSetting(guildId, 'goodbye_channel_id') || '';
}

function setGoodbyeChannelId(guildId, channelId) {
  if (channelId) writeSetting(guildId, 'goodbye_channel_id', channelId);
  else deleteSetting(guildId, 'goodbye_channel_id');
}

function makeEmbed(title, description, color = 0x5865f2) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description);
}

function successEmbed(title, description) {
  return makeEmbed(title, description, 0x57f287);
}

function errorEmbed(title, description) {
  return makeEmbed(title, description, 0xed4245);
}

function hasModeratorRole(member) {
  return member?.roles?.cache?.has(MODERATOR_ROLE_ID);
}

async function getWarningCount(guildId, userId) {
  const row = dbGet('SELECT count FROM warnings WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  return Number(row?.count || 0);
}

async function updateWarning(guildId, userId, delta, reason) {
  const current = dbGet('SELECT count, reasons FROM warnings WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
  const nextCount = Math.max(0, Number(current?.count || 0) + delta);
  const reasons = current ? JSON.parse(current.reasons || '[]') : [];
  if (delta > 0) reasons.push({ reason, at: Date.now() });
  dbRun(
    `INSERT INTO warnings (guild_id, user_id, count, reasons, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET count = excluded.count, reasons = excluded.reasons, updated_at = excluded.updated_at`,
    [guildId, userId, nextCount, JSON.stringify(reasons.slice(-20)), Date.now()]
  );
  return nextCount;
}

async function initSqlite() {
  await runSql(`
    CREATE TABLE IF NOT EXISTS level_settings (
      guild_id TEXT PRIMARY KEY,
      xp_base INTEGER NOT NULL DEFAULT 20,
      xp_multiplier REAL NOT NULL DEFAULT 1.18,
      xp_exponent REAL NOT NULL DEFAULT 1.9,
      xp_gain_min INTEGER NOT NULL DEFAULT 4,
      xp_gain_max INTEGER NOT NULL DEFAULT 14,
      coin_per_xp REAL NOT NULL DEFAULT 0.75,
      message_cooldown_ms INTEGER NOT NULL DEFAULT 6000,
      nickname_prefix INTEGER NOT NULL DEFAULT 1
    )
  `);
  await runSql(`
    CREATE TABLE IF NOT EXISTS bot_settings (
      guild_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (guild_id, key)
    )
  `);
  await runSql(`
    CREATE TABLE IF NOT EXISTS warnings (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      reasons TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  const userProgressColumns = sqlite.prepare(`PRAGMA table_info(user_progress)`).all().map((row) => row.name);
  if (userProgressColumns.length) {
    if (!userProgressColumns.includes('last_nickname_change_at')) {
      await runSql(`ALTER TABLE user_progress ADD COLUMN last_nickname_change_at INTEGER NOT NULL DEFAULT 0`);
    }
  }
  await runSql(`
    CREATE TABLE IF NOT EXISTS user_progress (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      coins INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      messages INTEGER NOT NULL DEFAULT 0,
      last_message_at INTEGER NOT NULL DEFAULT 0,
      last_nickname_change_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);

  const legacy = loadChannelConfig();
  if (legacy.global?.welcomeChannelId) {
    setWelcomeChannelId(LEVEL_GUILD_ID, legacy.global.welcomeChannelId);
  }
  if (legacy.global?.goodbyeChannelId) {
    setGoodbyeChannelId(LEVEL_GUILD_ID, legacy.global.goodbyeChannelId);
  }
  if (Array.isArray(legacy.global?.entryRoleIds) && legacy.global.entryRoleIds.length) {
    setEntryRoleIds(LEVEL_GUILD_ID, legacy.global.entryRoleIds);
  }
}

async function getLevelSettings(guildId) {
  const defaults = {
    xp_base: 20,
    xp_multiplier: 1.18,
    xp_exponent: 1.9,
    xp_gain_min: 4,
    xp_gain_max: 14,
    coin_per_xp: 0.75,
    message_cooldown_ms: 6000,
    nickname_prefix: 1,
  };
  const row = await getSql('SELECT * FROM level_settings WHERE guild_id = ?', [guildId]);
  return row || defaults;
}

async function ensureUserProgress(guildId, userId) {
  await runSql(
    `INSERT OR IGNORE INTO user_progress (guild_id, user_id) VALUES (?, ?)`,
    [guildId, userId]
  );
  return getSql('SELECT * FROM user_progress WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
}

function getXpRequirement(settings, level) {
  const scaled = settings.xp_base * Math.pow(level, settings.xp_exponent) * Math.pow(settings.xp_multiplier, level - 1);
  return Math.max(settings.xp_base, Math.floor(scaled));
}

function normalizeNicknamePrefix(nickname, level) {
  const base = nickname ? nickname.replace(/^\[LV\.\d+\]\s*/u, '') : '';
  return `[LV.${level}] ${base || ''}`.trim();
}

function stripLevelPrefix(nickname) {
  return nickname ? nickname.replace(/^\[LV\.\d+\]\s*/u, '').trim() : '';
}

function buildPrefixedNickname(level, nickname) {
  return normalizeNicknamePrefix(nickname, level).slice(0, 32);
}

async function applyLevelNickname(member, level, settings) {
  if (!settings.nickname_prefix) return;
  const botMember = member.guild.members.me ?? await member.guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageNicknames)) return;
  const nickname = normalizeNicknamePrefix(stripLevelPrefix(member.displayName), level);
  await member.setNickname(nickname).catch(() => {});
}

async function awardMessageProgress(member, contentLength) {
  if (member.guild.id !== LEVEL_GUILD_ID) return null;
  if (member.user.bot) return null;

  const settings = await getLevelSettings(member.guild.id);
  const now = Date.now();
  const user = await ensureUserProgress(member.guild.id, member.id);
  if (now - user.last_message_at < settings.message_cooldown_ms) return null;

  const xpGain = Math.max(settings.xp_gain_min, Math.min(settings.xp_gain_max, Math.floor(contentLength / 18) + 3));
  const coinGain = Math.max(1, Math.floor(xpGain * settings.coin_per_xp));

  user.last_message_at = now;
  user.messages += 1;
  user.xp += xpGain;
  user.coins += coinGain;

  let leveledUp = false;
  let nextRequirement = getXpRequirement(settings, user.level);
  while (user.xp >= nextRequirement) {
    user.xp -= nextRequirement;
    user.level += 1;
    leveledUp = true;
    nextRequirement = getXpRequirement(settings, user.level);
  }

  await runSql(
    `UPDATE user_progress
     SET xp = ?, coins = ?, level = ?, messages = ?, last_message_at = ?, last_nickname_change_at = last_nickname_change_at
     WHERE guild_id = ? AND user_id = ?`,
    [user.xp, user.coins, user.level, user.messages, user.last_message_at, member.guild.id, member.id]
  );

  if (leveledUp) await applyLevelNickname(member, user.level, settings);
  return { ...user, leveledUp, xpGain, coinGain, nextRequirement };
}

async function getTier(userId) {
  if (!db) return 'free';
  const { rows } = await db.query('SELECT tier, expires_at FROM user_subscriptions WHERE user_id = $1', [userId]);
  const row = rows[0];
  if (!row || (row.expires_at && new Date(row.expires_at) <= new Date())) return 'free';
  return row.tier;
}

async function syncGuildRoles(guild) {
  await guild.members.fetch();
  const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    throw new Error('봇에 Manage Roles 권한이 없습니다.');
  }

  let updated = 0;
  let failed = 0;
  const failures = [];

  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;
    const tier = await getTier(member.id);
    const roleId = { free: '1525464470967812096', basic: '1525464471579922533', premium: '1525464472360063096' }[tier];
    const wantedRole = guild.roles.cache.get(roleId);
    if (!wantedRole) continue;

    if (wantedRole.position >= botMember.roles.highest.position) {
      throw new Error(`역할 ${wantedRole.name} 이 봇의 역할보다 높습니다.`);
    }

    try {
      const tierRoles = ['1525464470967812096', '1525464471579922533', '1525464472360063096'].filter((id) => id !== wantedRole.id);
      await member.roles.remove(tierRoles);
      if (!member.roles.cache.has(wantedRole.id)) {
        await member.roles.add(wantedRole);
        updated += 1;
      }
    } catch (error) {
      failed += 1;
      failures.push(`${member.user.tag}: ${error.message}`);
    }
  }

  return { updated, failed, failures };
}

async function publishRankingChannel(guild, channel) {
  if (!channel || channel.type !== ChannelType.GuildText) throw new Error('텍스트 채널을 선택해 주세요.');
  if (!db) throw new Error('DATABASE_URL이 설정되어 있지 않습니다.');

  const { rows: columns } = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'user_subscriptions'
      AND column_name IN ('donation_amount', 'total_donation', 'total_donation_amount')
  `);
  const amountColumn = columns[0]?.column_name;
  if (!amountColumn) throw new Error('후원금액 컬럼이 없습니다.');

  const { rows } = await db.query(
    `SELECT user_id, ${amountColumn} AS amount FROM user_subscriptions WHERE ${amountColumn} > 0 ORDER BY ${amountColumn} DESC LIMIT 10`
  );
  const lines = rows.map((row, index) => `${index + 1}. <@${row.user_id}> - ${Number(row.amount).toLocaleString('ko-KR')}원`);
  const content = `**후원금액 랭킹 TOP 10**\n\n${lines.join('\n') || '등록된 후원자가 없습니다.'}`;

  const existing = await db.query('SELECT message_id FROM donation_ranking_channels WHERE guild_id = $1', [guild.id]);
  let message = existing.rows[0]?.message_id ? await channel.messages.fetch(existing.rows[0].message_id).catch(() => null) : null;
  if (message) await message.edit(content);
  else message = await channel.send(content);

  await db.query(
    `
    INSERT INTO donation_ranking_channels (guild_id, channel_id, message_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (guild_id) DO UPDATE SET channel_id = EXCLUDED.channel_id, message_id = EXCLUDED.message_id
  `,
    [guild.id, channel.id, message.id]
  );
}

async function assignEntryRoles(member) {
  const roleIds = [...new Set(getEntryRoleIds(member.guild.id))];
  if (!roleIds.length) return;

  const botMember = member.guild.members.me ?? await member.guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    console.warn(`[entry-role] missing ManageRoles in guild ${member.guild.id}`);
    return;
  }

  const freshMember = await member.guild.members.fetch(member.id).catch(() => member);

  for (const roleId of roleIds) {
    const role = member.guild.roles.cache.get(roleId) ?? await member.guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      console.warn(`[entry-role] role not found: ${roleId} in guild ${member.guild.id}`);
      continue;
    }
    if (role.position >= botMember.roles.highest.position) {
      console.warn(`[entry-role] role too high: ${roleId} in guild ${member.guild.id}`);
      continue;
    }
    if (freshMember.roles.cache.has(role.id)) continue;
    await freshMember.roles.add(role).catch((error) => {
      console.warn(`[entry-role] failed to add role ${roleId} to ${member.id}: ${error.message}`);
    });
  }
}

async function grantEntryRolesToGuild(guild) {
  const roleIds = [...new Set(getEntryRoleIds(guild.id))];
  if (!roleIds.length) {
    return { updated: 0, skipped: 0, missing: 0 };
  }

  await guild.members.fetch();
  const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    throw new Error('봇에 Manage Roles 권한이 없습니다.');
  }

  let updated = 0;
  let skipped = 0;
  let missing = 0;

  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;

    const freshMember = await guild.members.fetch(member.id).catch(() => member);
    for (const roleId of roleIds) {
      const role = guild.roles.cache.get(roleId) ?? await guild.roles.fetch(roleId).catch(() => null);
      if (!role) {
        missing += 1;
        continue;
      }
      if (role.position >= botMember.roles.highest.position) continue;
      if (freshMember.roles.cache.has(role.id)) {
        skipped += 1;
        continue;
      }
      await freshMember.roles.add(role).then(() => {
        updated += 1;
      }).catch(() => {
        skipped += 1;
      });
    }
  }

  return { updated, skipped, missing };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

async function getPlayer(guildId, userId) {
  return ensureUserProgress(guildId, userId);
}

async function savePlayer(guildId, userId, patch) {
  const current = await ensureUserProgress(guildId, userId);
  const next = { ...current, ...patch };
  await runSql(
    `UPDATE user_progress
     SET xp = ?, coins = ?, level = ?, messages = ?, last_message_at = ?, last_nickname_change_at = ?
     WHERE guild_id = ? AND user_id = ?`,
    [next.xp, next.coins, next.level, next.messages, next.last_message_at, next.last_nickname_change_at, guildId, userId]
  );
  return next;
}

async function syncLevelSystem(guild) {
  const settings = await getLevelSettings(guild.id);
  await guild.members.fetch();
  const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

  let initialized = 0;
  let updatedNicknames = 0;

  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;

    const before = await getSql('SELECT 1 FROM user_progress WHERE guild_id = ? AND user_id = ?', [guild.id, member.id]);
    const user = await ensureUserProgress(guild.id, member.id);
    if (!before) initialized += 1;

    if (settings.nickname_prefix && botMember?.permissions.has(PermissionsBitField.Flags.ManageNicknames)) {
      const desired = buildPrefixedNickname(user.level, stripLevelPrefix(member.displayName));
      if (member.displayName !== desired) {
        await member.setNickname(desired).catch(() => {});
        updatedNicknames += 1;
      }
    }
  }

  return { initialized, updatedNicknames };
}

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await initSqlite();

  if (db) {
    await db.query('ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS donation_amount INTEGER NOT NULL DEFAULT 0').catch(console.error);
    await db.query('CREATE TABLE IF NOT EXISTS donation_ranking_channels (guild_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, message_id TEXT NOT NULL)').catch(console.error);
  }
});

client.on('messageCreate', async (message) => {
  if (!message.guild || message.guild.id !== LEVEL_GUILD_ID) return;
  if (!message.author || message.author.bot) return;
  if (!message.content) return;
  if (!message.member) return;

  await awardMessageProgress(message.member, message.content.length).catch(console.error);
});

const ARCADE_BET = 5;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function arcadePanel(user, coins, title = '🎰 FLUX 도파민 아케이드') {
  return {
    embeds: [makeEmbed(title, `**${user.displayName || user.username}**님, 오늘의 운을 시험해보세요!\n\n💰 보유 코인: **${coins}**\n🎟️ 1회 플레이: **${ARCADE_BET} 코인**\n\n버튼을 누를 때마다 결과가 즉시 갱신됩니다.`, 0xffc857)
      .setFooter({ text: '행운은 준비된 사람에게… 아니, 버튼을 많이 누른 사람에게!' })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`arcade:slots:${user.id}`).setLabel('🎰 슬롯머신').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`arcade:dice:${user.id}`).setLabel('🎲 주사위').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`arcade:coin:${user.id}`).setLabel('🪙 코인 러시').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`arcade:close:${user.id}`).setLabel('🛑 닫기').setStyle(ButtonStyle.Danger)
    )],
  };
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton() || !interaction.customId.startsWith('arcade:')) return;
  const [, game, ownerId] = interaction.customId.split(':');
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: '이 아케이드는 패널을 연 사람만 플레이할 수 있어요!', flags: MessageFlags.Ephemeral });
  }
  if (game === 'close') return interaction.update({ components: [] });

  const user = await getPlayer(interaction.guildId, interaction.user.id);
  if (user.coins < ARCADE_BET) {
    return interaction.reply({ embeds: [errorEmbed('💸 코인이 부족해요', `최소 **${ARCADE_BET} 코인**이 필요합니다. 메시지를 보내 코인을 모아보세요!`)], flags: MessageFlags.Ephemeral });
  }

  await interaction.deferUpdate();
  const animationFrames = game === 'slots'
    ? ['🎰 | ❔ | ❔ | ❔ |', '🎰 | 🍒 | ❔ | ❔ |', '🎰 | 🍒 | 🔔 | ❔ |', '🎰 | 🍒 | 🔔 | 💎 |']
    : game === 'dice'
      ? ['🎲 주사위를 굴리는 중…', '🎲 ⚪ ⚪ ⚪', '🎲 ⚫ ⚪ ⚪', '🎲 ⚫ ⚫ ⚪']
      : ['🪙 코인을 튕기는 중…', '🪙 앞…', '🪙 뒤…', '🪙 빙글빙글…'];
  for (const frame of animationFrames) {
    await interaction.editReply(arcadePanel(interaction.user, user.coins, `✨ ${frame}`));
    await wait(280);
  }

  user.coins -= ARCADE_BET;
  let result;
  let reward = 0;
  if (game === 'slots') {
    const symbols = ['🍒', '🍋', '🔔', '💎', '7️⃣'];
    const spin = Array.from({ length: 3 }, () => symbols[Math.floor(Math.random() * symbols.length)]);
    reward = spin[0] === spin[1] && spin[1] === spin[2] ? ARCADE_BET * 8 : spin[0] === spin[1] || spin[1] === spin[2] ? ARCADE_BET * 2 : 0;
    result = `**| ${spin.join(' | ')} |**\n${reward ? `🎉 잭팟! **+${reward} 코인**` : '💥 아쉽다! 다음 버튼을 눌러보세요.'}`;
  } else if (game === 'dice') {
    const player = Math.floor(Math.random() * 6) + 1;
    const bot = Math.floor(Math.random() * 6) + 1;
    reward = player > bot ? ARCADE_BET * 3 : player === bot ? ARCADE_BET : 0;
    result = `🙋 **${player}**  vs  🤖 **${bot}**\n${reward > ARCADE_BET ? `🏆 승리! **+${reward} 코인**` : reward ? '🤝 무승부! 코인을 돌려받았어요.' : '😵 패배… 다시 도전!'}`;
  } else {
    const choice = Math.random() < 0.5 ? '앞' : '뒤';
    const picked = Math.random() < 0.5 ? '앞' : '뒤';
    reward = choice === picked ? ARCADE_BET * 3 : 0;
    result = `🎯 정답: **${choice}**  /  결과: **${picked}**\n${reward ? `⚡ 적중! **+${reward} 코인**` : '🫠 빗나갔어요!'}`;
  }
  user.coins += reward;
  await savePlayer(interaction.guildId, interaction.user.id, user);
  await interaction.editReply(arcadePanel(interaction.user, user.coins, `✨ ${game === 'slots' ? '슬롯 결과' : game === 'dice' ? '주사위 결과' : '코인 러시 결과'}\n\n${result}`));
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'arcade') {
    if (interaction.guildId !== LEVEL_GUILD_ID) {
      return interaction.reply({ content: '이 명령어는 지정된 서버에서만 사용할 수 있어요.', flags: MessageFlags.Ephemeral });
    }
    const user = await getPlayer(interaction.guildId, interaction.user.id);
    return interaction.reply(arcadePanel(interaction.member, user.coins));
  }

  if (interaction.commandName === '레벨') {
    if (interaction.guildId !== LEVEL_GUILD_ID) {
      return interaction.reply({ content: '이 명령어는 지정된 서버에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === '조회') {
      const settings = await getLevelSettings(interaction.guildId);
      const user = await getPlayer(interaction.guildId, interaction.user.id);
      const next = getXpRequirement(settings, user.level);
      return interaction.reply({
        embeds: [
          successEmbed(
            '레벨 정보',
            `**레벨**: ${user.level}\n**경험치**: ${user.xp}/${next}\n**코인**: ${user.coins}\n**메시지 수**: ${user.messages}`
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (subcommand === '동기화') {
      if (interaction.user.id !== ADMIN_USER_ID) {
        return interaction.reply({ content: '관리자만 사용할 수 있는 명령어입니다.', flags: MessageFlags.Ephemeral });
      }
      if (!interaction.guild) {
        return interaction.reply({ content: '서버에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const result = await syncLevelSystem(interaction.guild);
        await interaction.editReply({
          embeds: [successEmbed('레벨 시스템 동기화 완료', `**초기화된 DB 행**: ${result.initialized}개\n**닉네임 갱신**: ${result.updatedNicknames}명`)],
        });
      } catch (error) {
        console.error('Level sync error:', error);
        await interaction.editReply({ embeds: [errorEmbed('오류', '레벨 시스템 동기화 중 오류가 발생했습니다.')] });
      }
    }
    return;
  }

  if (interaction.commandName === '코인') {
    if (interaction.guildId !== LEVEL_GUILD_ID) {
      return interaction.reply({ content: '이 명령어는 지정된 서버에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
    }
    const user = await getPlayer(interaction.guildId, interaction.user.id);
    return interaction.reply({ embeds: [successEmbed('코인 보유량', `**${user.coins} 코인**`)], flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName === '별명변경') {
    if (interaction.guildId !== LEVEL_GUILD_ID) {
      return interaction.reply({ embeds: [errorEmbed('사용 불가', '이 명령어는 지정된 서버에서만 사용할 수 있습니다.')], flags: MessageFlags.Ephemeral });
    }
    const nickname = interaction.options.getString('별명');
    const member = interaction.member;
    const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);
    if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageNicknames)) {
      return interaction.reply({ embeds: [errorEmbed('권한 부족', '봇에 닉네임 변경 권한이 없습니다.')], flags: MessageFlags.Ephemeral });
    }

    const settings = await getLevelSettings(interaction.guildId);
    const user = await getPlayer(interaction.guildId, interaction.user.id);
    const now = Date.now();
    if (now - user.last_nickname_change_at < 30 * 60 * 1000) {
      return interaction.reply({ embeds: [errorEmbed('쿨다운', '별명은 30분에 한 번만 변경할 수 있습니다.')], flags: MessageFlags.Ephemeral });
    }

    const desired = settings.nickname_prefix ? buildPrefixedNickname(user.level, nickname) : nickname.slice(0, 32);
    user.last_nickname_change_at = now;
    await savePlayer(interaction.guildId, interaction.user.id, user);
    await member.setNickname(desired).catch(() => {});
    return interaction.reply({ embeds: [successEmbed('별명 변경', `**${desired}** 로 변경했습니다.`)], flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName === '별명설정') {
    if (interaction.user.id !== ADMIN_USER_ID) {
      return interaction.reply({ embeds: [errorEmbed('권한 부족', '관리자만 사용할 수 있는 명령어입니다.')], flags: MessageFlags.Ephemeral });
    }
    if (interaction.guildId !== LEVEL_GUILD_ID) {
      return interaction.reply({ embeds: [errorEmbed('사용 불가', '이 명령어는 지정된 서버에서만 사용할 수 있습니다.')], flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getUser('유저');
    const nickname = interaction.options.getString('별명');
    const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);
    if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageNicknames)) {
      return interaction.reply({ embeds: [errorEmbed('권한 부족', '봇에 닉네임 변경 권한이 없습니다.')], flags: MessageFlags.Ephemeral });
    }

    const settings = await getLevelSettings(interaction.guildId);
    const user = await getPlayer(interaction.guildId, target.id);
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) {
      return interaction.reply({ embeds: [errorEmbed('대상 없음', '대상 유저를 서버에서 찾을 수 없습니다.')], flags: MessageFlags.Ephemeral });
    }

    const desired = settings.nickname_prefix ? buildPrefixedNickname(user.level, nickname) : nickname.slice(0, 32);
    await savePlayer(interaction.guildId, target.id, user);
    await member.setNickname(desired).catch(() => {});
    return interaction.reply({ embeds: [successEmbed('별명 설정', `${target}의 서버 별명을 **${desired}** 로 설정했습니다.`)], flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName === '미니게임') {
    if (interaction.guildId !== LEVEL_GUILD_ID) {
      return interaction.reply({ content: '이 명령어는 지정된 서버에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
    }
    const subcommand = interaction.options.getSubcommand();
    const bet = interaction.options.getInteger('코인');
    const user = await getPlayer(interaction.guildId, interaction.user.id);
    const safeBet = clamp(bet, 1, Math.max(1, user.coins));

    if (['슬롯', '복권'].includes(subcommand) && safeBet > user.coins) {
      return interaction.reply({ content: '코인이 부족합니다.', flags: MessageFlags.Ephemeral });
    }

    if (subcommand === '슬롯') {
      user.coins -= safeBet;
      const pool = ['🍒', '🍋', '⭐', '7'];
      const spins = [pool[Math.floor(Math.random() * pool.length)], pool[Math.floor(Math.random() * pool.length)], pool[Math.floor(Math.random() * pool.length)]];
      const win = spins[0] === spins[1] && spins[1] === spins[2];
      const reward = win ? safeBet * 3 : 0;
      user.coins += reward;
      await savePlayer(interaction.guildId, interaction.user.id, user);
      return interaction.reply({
        content: `| ${spins.join(' | ')} |\n${win ? `당첨! +${reward} 코인` : `실패! -${safeBet} 코인`}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (subcommand === '복권') {
      user.coins -= safeBet;
      const ticket = String(Math.floor(Math.random() * 10)).padStart(4, '0');
      const lucky = String(Math.floor(Math.random() * 10)).padStart(4, '0');
      const win = ticket[3] === lucky[3];
      const reward = win ? safeBet * 8 : 0;
      user.coins += reward;
      await savePlayer(interaction.guildId, interaction.user.id, user);
      return interaction.reply({
        content: `복권 번호: **${ticket}**\n당첨 번호: **${lucky}**\n${win ? `당첨! +${reward} 코인` : `꽝! -${safeBet} 코인`}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (subcommand === '베팅') {
      const choice = interaction.options.getString('선택');
      const outcome = ['가위', '바위', '보'][Math.floor(Math.random() * 3)];
      let result = '무승부';
      if (choice === outcome) result = '무승부';
      else if (
        (choice === '가위' && outcome === '보') ||
        (choice === '바위' && outcome === '가위') ||
        (choice === '보' && outcome === '바위')
      ) {
        result = '승리';
        user.coins += safeBet;
      } else {
        result = '패배';
        user.coins -= safeBet;
      }
      await savePlayer(interaction.guildId, interaction.user.id, user);
      return interaction.reply({
        content: `당신: **${choice}**\n봇: **${outcome}**\n결과: **${result}**\n현재 코인: **${user.coins}**`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (subcommand === '가위바위보') {
      return interaction.reply({
        content: '가위바위보는 `/미니게임 베팅`으로 진행합니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  if (interaction.commandName === '경험치') {
    if (interaction.user.id !== ADMIN_USER_ID) {
      return interaction.reply({ content: '관리자만 사용할 수 있는 명령어입니다.', flags: MessageFlags.Ephemeral });
    }
    if (interaction.guildId !== LEVEL_GUILD_ID) {
      return interaction.reply({ content: '이 명령어는 지정된 서버에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === '설정') {
      const target = interaction.options.getUser('유저');
      const level = interaction.options.getInteger('레벨');
      const xp = interaction.options.getInteger('경험치');
      const coins = interaction.options.getInteger('코인');
      const messages = interaction.options.getInteger('메시지');
      const current = await getPlayer(interaction.guildId, target.id);
      const next = {
        ...current,
        level: level ?? current.level,
        xp: xp ?? current.xp,
        coins: coins ?? current.coins,
        messages: messages ?? current.messages,
      };
      await savePlayer(interaction.guildId, target.id, next);
      return interaction.reply({
        content: `${target}의 데이터를 저장했습니다.\n레벨: ${next.level}\n경험치: ${next.xp}\n코인: ${next.coins}\n메시지: ${next.messages}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  if (interaction.commandName === '등급역할') {
    if (interaction.user.id !== ADMIN_USER_ID) {
      return interaction.reply({ content: '관리자만 사용할 수 있는 명령어입니다.', flags: MessageFlags.Ephemeral });
    }
    if (!interaction.guild) return interaction.reply({ content: '서버에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const result = await syncGuildRoles(interaction.guild);
      const failureText = result.failures.slice(0, 3).join('\n');
      await interaction.editReply(`등급 역할 동기화 완료\n- 반영: ${result.updated}명${result.failed ? `\n- 실패: ${result.failed}명\n${failureText}` : ''}`);
    } catch (error) {
      console.error(error);
      await interaction.editReply('등급 역할 동기화 중 오류가 발생했습니다.');
    }
    return;
  }

  if (interaction.commandName === '입장채널') {
    if (interaction.user.id !== ADMIN_USER_ID) return interaction.reply({ content: '관리자만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
    if (!interaction.guild) return interaction.reply({ content: '서버에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === '설정') {
      const channel = interaction.options.getChannel('채널');
      setWelcomeChannelId(interaction.guildId, channel.id);
      return interaction.reply({ content: `입장 로깅 채널을 ${channel} 로 설정했습니다.`, flags: MessageFlags.Ephemeral });
    }
    if (subcommand === '제거') {
      setWelcomeChannelId(interaction.guildId, '');
      return interaction.reply({ content: '입장 로깅 채널을 제거했습니다.', flags: MessageFlags.Ephemeral });
    }
    const channelId = getWelcomeChannelId(interaction.guildId);
    return interaction.reply({ content: channelId ? `현재 입장 로깅 채널: <#${channelId}>` : '설정되어 있지 않습니다.', flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName === '입장역할') {
    if (interaction.user.id !== ADMIN_USER_ID) return interaction.reply({ content: '관리자만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
    if (!interaction.guild) return interaction.reply({ content: '서버에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === '추가') {
      const role = interaction.options.getRole('역할');
      const current = getEntryRoleIds(interaction.guildId);
      if (!current.includes(role.id)) setEntryRoleIds(interaction.guildId, [...current, role.id]);
      return interaction.reply({
        embeds: [successEmbed('입장 역할 추가', `${role} 를 입장 역할에 추가했습니다.`)],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (subcommand === '제거') {
      const role = interaction.options.getRole('역할');
      setEntryRoleIds(interaction.guildId, getEntryRoleIds(interaction.guildId).filter((roleId) => roleId !== role.id));
      return interaction.reply({
        embeds: [successEmbed('입장 역할 제거', `${role} 를 입장 역할에서 제거했습니다.`)],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (subcommand === '지급') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const result = await grantEntryRolesToGuild(interaction.guild);
        await interaction.editReply({
          embeds: [
            successEmbed(
              '입장 역할 일괄 지급',
              `**지급 완료**: ${result.updated}회\n**이미 보유/실패**: ${result.skipped}회\n**누락 역할**: ${result.missing}회`
            ),
          ],
        });
      } catch (error) {
        console.error('Entry role grant error:', error);
        await interaction.editReply({ embeds: [errorEmbed('오류', '입장 역할 일괄 지급 중 오류가 발생했습니다.')] });
      }
      return;
    }
    const names = getEntryRoleIds(interaction.guildId).map((roleId) => interaction.guild.roles.cache.get(roleId)).filter(Boolean).map((r) => r.toString());
    return interaction.reply({
      embeds: [successEmbed('입장 역할 목록', names.length ? `- ${names.join('\n- ')}` : '설정되어 있지 않습니다.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.commandName === '퇴장채널') {
    if (interaction.user.id !== ADMIN_USER_ID) return interaction.reply({ content: '관리자만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
    if (!interaction.guild) return interaction.reply({ content: '서버에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === '설정') {
      const channel = interaction.options.getChannel('채널');
      setGoodbyeChannelId(interaction.guildId, channel.id);
      return interaction.reply({ content: `퇴장 로깅 채널을 ${channel} 로 설정했습니다.`, flags: MessageFlags.Ephemeral });
    }
    if (subcommand === '제거') {
      setGoodbyeChannelId(interaction.guildId, '');
      return interaction.reply({ content: '퇴장 로깅 채널을 제거했습니다.', flags: MessageFlags.Ephemeral });
    }
    const channelId = getGoodbyeChannelId(interaction.guildId);
    return interaction.reply({ content: channelId ? `현재 퇴장 로깅 채널: <#${channelId}>` : '설정되어 있지 않습니다.', flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName === '랭킹채널') {
    if (interaction.user.id !== ADMIN_USER_ID) return interaction.reply({ content: '관리자만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
    if (!interaction.guild) return interaction.reply({ content: '서버에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
    const channel = interaction.options.getChannel('채널');
    await publishRankingChannel(interaction.guild, channel);
    return interaction.reply({ content: `${channel} 채널에 랭킹 게시를 설정했습니다.`, flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName === '경고' || interaction.commandName === '추방' || interaction.commandName === '타임아웃') {
    if (!interaction.guild) return interaction.reply({ embeds: [errorEmbed('사용 불가', '서버에서만 사용할 수 있습니다.')], flags: MessageFlags.Ephemeral });
    if (!hasModeratorRole(interaction.member)) {
      return interaction.reply({ embeds: [errorEmbed('권한 부족', '이 명령어는 지정한 역할을 가진 유저만 사용할 수 있습니다.')], flags: MessageFlags.Ephemeral });
    }
  }

  if (interaction.commandName === '경고') {
    const target = interaction.options.getUser('유저');
    const action = interaction.options.getString('작업');
    const reason = interaction.options.getString('사유');
    const delta = action === '추가' ? 1 : -1;
    const nextCount = await updateWarning(interaction.guildId, target.id, delta, reason);
    return interaction.reply({
      embeds: [successEmbed('경고 처리', `${target}의 경고를 ${action === '추가' ? '추가' : '감소'}했습니다.\n**현재 경고 수**: ${nextCount}\n**사유**: ${reason}`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.commandName === '추방') {
    const target = interaction.options.getUser('유저');
    const reason = interaction.options.getString('사유');
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) {
      return interaction.reply({ embeds: [errorEmbed('대상 없음', '대상 유저를 서버에서 찾을 수 없습니다.')], flags: MessageFlags.Ephemeral });
    }
    const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);
    if (!botMember?.permissions.has(PermissionsBitField.Flags.KickMembers)) {
      return interaction.reply({ embeds: [errorEmbed('권한 부족', '봇에 Kick Members 권한이 없습니다.')], flags: MessageFlags.Ephemeral });
    }
    await member.kick(reason);
    return interaction.reply({ embeds: [successEmbed('추방 완료', `${target} 를 추방했습니다.\n**사유**: ${reason}`)], flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName === '타임아웃') {
    const target = interaction.options.getUser('유저');
    const minutes = interaction.options.getInteger('시간');
    const reason = interaction.options.getString('이유');
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) {
      return interaction.reply({ embeds: [errorEmbed('대상 없음', '대상 유저를 서버에서 찾을 수 없습니다.')], flags: MessageFlags.Ephemeral });
    }
    const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);
    if (!botMember?.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      return interaction.reply({ embeds: [errorEmbed('권한 부족', '봇에 Moderate Members 권한이 없습니다.')], flags: MessageFlags.Ephemeral });
    }
    await member.timeout(minutes * 60 * 1000, reason);
    return interaction.reply({ embeds: [successEmbed('타임아웃 완료', `${target} 에게 ${minutes}분 타임아웃을 적용했습니다.\n**사유**: ${reason}`)], flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName !== '후원금액') return;
  if (interaction.user.id !== ADMIN_USER_ID) return interaction.reply({ content: '관리자만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
  if (!db) return interaction.reply({ content: 'DATABASE_URL이 설정되어 있지 않습니다.', flags: MessageFlags.Ephemeral });

  const target = interaction.options.getUser('유저');
  const action = interaction.options.getSubcommand();

  try {
    if (action === '조회') {
      const { rows } = await db.query('SELECT donation_amount FROM user_subscriptions WHERE user_id = $1', [target.id]);
      const amount = Number(rows[0]?.donation_amount || 0);
      return interaction.reply({ content: `${target}의 누적 후원금액은 **${amount.toLocaleString('ko-KR')}원** 입니다.`, flags: MessageFlags.Ephemeral });
    }
    const delta = interaction.options.getInteger('금액') * (action === '감소' ? -1 : 1);
    const { rows } = await db.query(
      `INSERT INTO user_subscriptions (user_id, tier, donation_amount, created_at, updated_at)
       VALUES ($1, 'free', GREATEST($2, 0), NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET donation_amount = GREATEST(user_subscriptions.donation_amount + $3, 0), updated_at = NOW()
       RETURNING donation_amount`,
      [target.id, Math.max(delta, 0), delta]
    );
    const amount = Number(rows[0].donation_amount);
    const tier = amount >= 5000 ? 'premium' : amount >= 3000 ? 'basic' : 'free';
    await db.query('UPDATE user_subscriptions SET tier = $1, updated_at = NOW() WHERE user_id = $2', [tier, target.id]);
    return interaction.reply({
      content: `${target}의 후원금액을 ${action === '추가' ? '추가' : '감소'}했습니다.\n- 누적 금액: **${amount.toLocaleString('ko-KR')}원**\n- 적용 티어: **${tier.toUpperCase()}**`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error('Donation amount command error:', error);
    await interaction.reply({ content: '후원금액 처리 중 오류가 발생했습니다.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

client.on('guildMemberAdd', async (member) => {
  await assignEntryRoles(member);
  const channel = member.guild.channels.cache.get(getWelcomeChannelId(member.guild.id));
  if (!channel) return;

  const now = Date.now();
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('새로운 멤버가 들어왔어요')
    .setDescription([`환영합니다, ${member}!`, '', `**${member.guild.name}** 커뮤니티에 오신 걸 환영합니다.`, '즐거운 시간 보내세요.'].join('\n'))
    .addFields(
      { name: '회원 정보', value: `**태그** \`${member.user.tag}\`\n**계정 생성일** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\n**입장 시각** <t:${Math.floor(now / 1000)}:R>`, inline: false },
      { name: '서버 정보', value: `**현재 인원** \`${member.guild.memberCount.toLocaleString()}명\`\n**순서** ${member.guild.memberCount}번째 멤버`, inline: false }
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 512 }))
    .setFooter({ text: `${member.guild.name} - We're happy to have you!`, iconURL: member.guild.iconURL() })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
});

client.on('guildMemberRemove', async (member) => {
  const channel = member.guild.channels.cache.get(getGoodbyeChannelId(member.guild.id));
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('멤버가 서버를 떠났어요')
    .setDescription([`안녕히 가세요, ~~${member.user.tag}~~.`, '', `**${member.guild.name}** 커뮤니티에서 떠났습니다.`, '다음에 또 만나요.'].join('\n'))
    .addFields(
      { name: '회원 정보', value: `**태그** \`${member.user.tag}\`\n**ID** \`${member.id}\`\n**계정 생성일** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\n**서버 입장일** <t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: false },
      { name: '서버 정보', value: `**현재 인원** \`${member.guild.memberCount.toLocaleString()}명\``, inline: false }
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 512 }))
    .setFooter({ text: `${member.guild.name} - We'll miss you!`, iconURL: member.guild.iconURL() })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
});

client.login(process.env.DISCORD_TOKEN);
