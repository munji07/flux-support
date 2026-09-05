const { ChannelType, PermissionFlagsBits } = require('discord.js');

const HOUSE_GUILD_ID = '1538513625730383902';
const HOUSE_CATEGORY_NAME = '🏠 개인 하우스';
const HOUSE_VISIBILITY = { PRIVATE: 'private', INVITE_ONLY: 'invite_only', PUBLIC: 'public' };

function formatHouseChannelName(floor, displayName) {
  const safe = String(displayName).replace(/[@#:`]/g, '').slice(0, 20).trim() || '익명';
  return `⊹₊˚　　${floor}층・${safe}의 집　　˚₊⊹`;
}

async function ensureHouseTables(db) {
  if (!db) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS dishouse_houses (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      owner_name TEXT NOT NULL DEFAULT '',
      floor INT NOT NULL,
      channel_id TEXT,
      channel_name TEXT,
      visibility TEXT NOT NULL DEFAULT 'invite_only',
      category_id TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(guild_id, owner_id),
      UNIQUE(guild_id, floor)
    )
  `).catch(e => console.error('[houses] create dishouse_houses', e.message));
  await db.query(`
    CREATE TABLE IF NOT EXISTS dishouse_house_invites (
      house_id INT NOT NULL REFERENCES dishouse_houses(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL,
      invited_by TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (house_id, target_id)
    )
  `).catch(e => console.error('[houses] create invites', e.message));
  await db.query(`ALTER TABLE dishouse_houses ADD COLUMN IF NOT EXISTS owner_name TEXT NOT NULL DEFAULT ''`).catch(()=>{});
  await db.query(`ALTER TABLE dishouse_houses ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'invite_only'`).catch(()=>{});
  await db.query(`ALTER TABLE dishouse_houses ADD COLUMN IF NOT EXISTS category_id TEXT`).catch(()=>{});
  // index for guild floor lookup
  await db.query(`CREATE INDEX IF NOT EXISTS idx_houses_guild_owner ON dishouse_houses(guild_id, owner_id)`).catch(()=>{});
  await db.query(`CREATE INDEX IF NOT EXISTS idx_houses_channel ON dishouse_houses(channel_id)`).catch(()=>{});
}

async function getNextFloor(db, guildId) {
  if (!db) return 5;
  const { rows } = await db.query(`SELECT COALESCE(MAX(floor), 4) + 1 AS next_floor FROM dishouse_houses WHERE guild_id=$1`, [guildId]);
  return Number(rows[0]?.next_floor || 5);
}

async function getOrCreateCategory(guild) {
  // try find existing category with name
  const existing = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === HOUSE_CATEGORY_NAME);
  if (existing) return existing;
  const fetched = await guild.channels.fetch().catch(()=>null);
  if (fetched) {
    const cat = [...fetched.values()].find(c => c.type === ChannelType.GuildCategory && c.name === HOUSE_CATEGORY_NAME);
    if (cat) return cat;
  }
  try {
    const cat = await guild.channels.create({ name: HOUSE_CATEGORY_NAME, type: ChannelType.GuildCategory });
    console.log(`[houses] created category ${cat.id} ${cat.name}`);
    return cat;
  } catch (e) {
    console.warn('[houses] category create failed', e.message);
    return null;
  }
}

async function createHouseChannel(guild, floor, displayName, ownerId, visibility = 'invite_only') {
  const category = await getOrCreateCategory(guild);
  const name = formatHouseChannelName(floor, displayName);
  const everyoneRole = guild.roles.everyone;
  const isPublic = visibility === HOUSE_VISIBILITY.PUBLIC;
  const overwrites = isPublic
    ? [
        { id: everyoneRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [] },
        { id: ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
      ]
    : [
        { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      ];
  if (guild.members.me) {
    overwrites.push({ id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles] });
  }
  const ch = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: category?.id ?? null,
    permissionOverwrites: overwrites,
    topic: isPublic ? `${displayName}님의 공용 하우스 — 누구나 입장 가능` : `${displayName}님의 개인 하우스 — 초대받은 사람만 입장 가능`,
  });
  return ch;
}

async function updateHouseChannelPermissions(guild, house) {
  if (!house?.channel_id) return;
  const ch = await guild.channels.fetch(house.channel_id).catch(()=>null);
  if (!ch) return;
  const everyoneRole = guild.roles.everyone;
  const isPublic = house.visibility === HOUSE_VISIBILITY.PUBLIC;
  try {
    if (isPublic) {
      await ch.permissionOverwrites.edit(everyoneRole.id, { ViewChannel: true, ReadMessageHistory: true });
    } else {
      await ch.permissionOverwrites.edit(everyoneRole.id, { ViewChannel: false });
    }
  } catch (e) { console.warn('[houses] update permissions', e.message); }
}

async function ensureHouse(db, guild, ownerId, displayName) {
  if (!db) throw new Error('DATABASE_URL 없음');
  // already exists? check
  const { rows } = await db.query(`SELECT * FROM dishouse_houses WHERE guild_id=$1 AND owner_id=$2`, [guild.id, ownerId]);
  if (rows[0]?.channel_id) {
    // verify channel still exists
    const ch = await guild.channels.fetch(rows[0].channel_id).catch(()=>null);
    if (ch) return rows[0];
    // channel deleted -> recreate
    const floor = rows[0].floor;
    const ch2 = await createHouseChannel(guild, floor, displayName, ownerId);
    await db.query(`UPDATE dishouse_houses SET channel_id=$1, channel_name=$2, owner_name=$3, updated_at=now() WHERE id=$4`, [ch2.id, ch2.name, displayName, rows[0].id]);
    return { ...rows[0], channel_id: ch2.id, channel_name: ch2.name };
  }
  if (rows[0] && !rows[0].channel_id) {
    // row without channel -> create
    const floor = rows[0].floor;
    const ch = await createHouseChannel(guild, floor, displayName, ownerId);
    await db.query(`UPDATE dishouse_houses SET channel_id=$1, channel_name=$2, owner_name=$3, updated_at=now() WHERE id=$4`, [ch.id, ch.name, displayName, rows[0].id]);
    return { ...rows[0], channel_id: ch.id, channel_name: ch.name };
  }
  const floor = await getNextFloor(db, guild.id);
  const ch = await createHouseChannel(guild, floor, displayName, ownerId);
  const ins = await db.query(
    `INSERT INTO dishouse_houses (guild_id, owner_id, owner_name, floor, channel_id, channel_name, visibility, category_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (guild_id, owner_id) DO UPDATE SET channel_id=EXCLUDED.channel_id, channel_name=EXCLUDED.channel_name, owner_name=EXCLUDED.owner_name, updated_at=now()
     RETURNING *`,
    [guild.id, ownerId, displayName, floor, ch.id, ch.name, HOUSE_VISIBILITY.INVITE_ONLY, ch.parentId]
  );
  return ins.rows[0];
}

async function deleteHouse(db, guild, ownerId) {
  if (!db) throw new Error('DATABASE_URL 없음');
  const { rows } = await db.query(`SELECT * FROM dishouse_houses WHERE guild_id=$1 AND owner_id=$2`, [guild.id, ownerId]);
  const house = rows[0];
  if (!house) return null;
  if (house.channel_id) {
    await guild.channels.fetch(house.channel_id).then(ch => ch?.delete().catch(()=>{})).catch(()=>{});
  }
  await db.query(`DELETE FROM dishouse_houses WHERE id=$1`, [house.id]);
  return house;
}

async function setVisibility(db, guildId, ownerId, visibility) {
  if (!db) throw new Error('DATABASE_URL 없음');
  if (!Object.values(HOUSE_VISIBILITY).includes(visibility)) throw new Error('visibility 오류');
  const { rows } = await db.query(`UPDATE dishouse_houses SET visibility=$3, updated_at=now() WHERE guild_id=$1 AND owner_id=$2 RETURNING *`, [guildId, ownerId, visibility]);
  return rows[0] ?? null;
}

async function addInvite(db, houseId, targetId, invitedBy) {
  if (!db) throw new Error('DATABASE_URL 없음');
  await db.query(`INSERT INTO dishouse_house_invites (house_id, target_id, invited_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [houseId, targetId, invitedBy]);
}

async function removeInvite(db, houseId, targetId) {
  if (!db) throw new Error('DATABASE_URL 없음');
  await db.query(`DELETE FROM dishouse_house_invites WHERE house_id=$1 AND target_id=$2`, [houseId, targetId]);
}

async function isInvited(db, houseId, targetId) {
  if (!db) return false;
  const { rows } = await db.query(`SELECT 1 FROM dishouse_house_invites WHERE house_id=$1 AND target_id=$2`, [houseId, targetId]);
  return !!rows[0];
}

async function listInvites(db, houseId) {
  if (!db) return [];
  const { rows } = await db.query(`SELECT target_id, invited_by, created_at FROM dishouse_house_invites WHERE house_id=$1 ORDER BY created_at`, [houseId]);
  return rows;
}

async function canAccess(db, guildId, ownerId, viewerId) {
  if (ownerId === viewerId) return true;
  if (viewerId === '1269575955626725390') return true; // admin bypass
  const { rows } = await db.query(`SELECT * FROM dishouse_houses WHERE guild_id=$1 AND owner_id=$2`, [guildId, ownerId]);
  const house = rows[0];
  if (!house) return false;
  if (house.visibility === HOUSE_VISIBILITY.PUBLIC) return true;
  if (house.visibility === HOUSE_VISIBILITY.PRIVATE) return false;
  return isInvited(db, house.id, viewerId);
}

module.exports = {
  HOUSE_GUILD_ID,
  HOUSE_VISIBILITY,
  HOUSE_CATEGORY_NAME,
  formatHouseChannelName,
  ensureHouseTables,
  getNextFloor,
  ensureHouse,
  deleteHouse,
  setVisibility,
  addInvite,
  removeInvite,
  isInvited,
  listInvites,
  canAccess,
  createHouseChannel,
  getOrCreateCategory,
  updateHouseChannelPermissions,
};
