const { Client, GatewayIntentBits, EmbedBuilder, ChannelType, MessageFlags } = require('discord.js');
const pg = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env' });

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const ROLE_IDS = {
  free: '1525464470967812096',
  basic: '1525464471579922533',
  premium: '1525464472360063096',
};

const ADMIN_USER_ID = '1269575955626725390';
const channelConfigPath = path.join(__dirname, 'channel-config.json');

const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (databaseUrl) {
  databaseUrl.searchParams.delete('sslmode');
  databaseUrl.searchParams.delete('channel_binding');
}

const db = databaseUrl
  ? new pg.Pool({ connectionString: databaseUrl.toString(), ssl: { rejectUnauthorized: false } })
  : null;

function loadChannelConfig() {
  try {
    return JSON.parse(fs.readFileSync(channelConfigPath, 'utf8'));
  } catch {
    return { global: { welcomeChannelId: '', defaultRoleId: '' }, guilds: {} };
  }
}

function saveChannelConfig(config) {
  fs.writeFileSync(channelConfigPath, JSON.stringify(config, null, 2));
}

async function getTier(userId) {
  if (!db) return 'free';
  const { rows } = await db.query('SELECT tier, expires_at FROM user_subscriptions WHERE user_id = $1', [userId]);
  const row = rows[0];
  if (!row || (row.expires_at && new Date(row.expires_at) <= new Date())) return 'free';
  return ROLE_IDS[row.tier] ? row.tier : 'free';
}

async function syncGuildRoles(guild) {
  await guild.members.fetch();
  const botMember = guild.members.me;
  const missingRoles = Object.entries(ROLE_IDS)
    .filter(([, roleId]) => !guild.roles.cache.has(roleId))
    .map(([tier, roleId]) => `${tier}(${roleId})`);

  if (!botMember?.permissions.has('ManageRoles')) {
    throw new Error('봇에 Manage Roles 권한이 없습니다.');
  }
  if (missingRoles.length) {
    throw new Error(`서버에 역할이 없습니다: ${missingRoles.join(', ')}`);
  }

  let updated = 0;
  let failed = 0;
  const failures = [];

  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;

    const tier = await getTier(member.id);
    const wantedRole = guild.roles.cache.get(ROLE_IDS[tier]);
    if (!wantedRole) continue;

    if (wantedRole.position >= botMember.roles.highest.position) {
      throw new Error(`역할 ${tier}(${wantedRole.name}) 이 봇의 역할보다 높습니다.`);
    }

    try {
      const tierRoles = Object.values(ROLE_IDS).filter((id) => id !== wantedRole.id);
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
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error('텍스트 채널을 선택해 주세요.');
  }
  if (!db) throw new Error('DATABASE_URL이 설정되어 있지 않습니다.');

  const { rows: columns } = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'user_subscriptions'
      AND column_name IN ('donation_amount', 'total_donation', 'total_donation_amount')
  `);
  const amountColumn = columns[0]?.column_name;
  if (!amountColumn) {
    throw new Error('user_subscriptions 테이블에 금액 컬럼이 없습니다.');
  }

  const members = guild.members.cache;
  const { rows } = await db.query(
    `SELECT user_id, ${amountColumn} AS amount FROM user_subscriptions WHERE ${amountColumn} > 0 ORDER BY ${amountColumn} DESC LIMIT 10`
  );

  const lines = rows.map((row, index) => {
    const member = members.get(row.user_id);
    return `${index + 1}. ${member ?? `<@${row.user_id}>`} - ${Number(row.amount).toLocaleString('ko-KR')}원`;
  });

  const content = `**후원금액 랭킹 TOP 10**\n\n${lines.join('\n') || '등록된 후원자가 없습니다.'}`;
  const existing = await db.query('SELECT message_id FROM donation_ranking_channels WHERE guild_id = $1', [guild.id]);
  let message = existing.rows[0]?.message_id
    ? await channel.messages.fetch(existing.rows[0].message_id).catch(() => null)
    : null;

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

  return channel;
}

async function assignDefaultRole(member) {
  const config = loadChannelConfig();
  const defaultRoleId = config.global.defaultRoleId;
  if (!defaultRoleId) return;

  const role = member.guild.roles.cache.get(defaultRoleId);
  const botMember = member.guild.members.me;
  if (!role || !botMember?.permissions.has('ManageRoles')) return;
  if (role.position >= botMember.roles.highest.position) return;

  await member.roles.add(role).catch(console.error);
}

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  if (db) {
    await db
      .query('ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS donation_amount INTEGER NOT NULL DEFAULT 0')
      .catch(console.error);
    await db
      .query(
        'CREATE TABLE IF NOT EXISTS donation_ranking_channels (guild_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, message_id TEXT NOT NULL)'
      )
      .catch(console.error);
  }

  setInterval(async () => {
    if (!db) return;
    const { rows } = await db.query('SELECT guild_id, channel_id FROM donation_ranking_channels').catch(() => ({ rows: [] }));
    for (const row of rows) {
      const guild = client.guilds.cache.get(row.guild_id);
      const channel = guild?.channels.cache.get(row.channel_id);
      if (guild && channel) await publishRankingChannel(guild, channel).catch(console.error);
    }
  }, 15000);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === '등급역할') {
    if (interaction.user.id !== ADMIN_USER_ID) {
      return interaction.reply({ content: '관리자만 사용할 수 있는 명령어입니다.', flags: MessageFlags.Ephemeral });
    }
    if (!interaction.guild) {
      return interaction.reply({ content: '서버에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const result = await syncGuildRoles(interaction.guild);
      const failureText = result.failures.slice(0, 3).join('\n');
      await interaction.editReply(
        `등급 역할 동기화가 완료되었습니다.\n- 반영된 멤버: ${result.updated}명${
          result.failed ? `\n- 실패: ${result.failed}명\n${failureText}` : ''
        }`
      );
    } catch (error) {
      console.error('Slash command error:', error);
      await interaction.editReply('명령 실행 중 오류가 발생했습니다. 봇의 역할 권한과 DB 연결을 확인해 주세요.');
    }
    return;
  }

  if (interaction.commandName === '입장채널') {
    if (interaction.user.id !== ADMIN_USER_ID) {
      return interaction.reply({ content: '관리자만 사용할 수 있는 명령어입니다.', flags: MessageFlags.Ephemeral });
    }

    const channel = interaction.options.getChannel('채널');
    const config = loadChannelConfig();
    config.global.welcomeChannelId = channel.id;
    saveChannelConfig(config);
    return interaction.reply({ content: `입장 로깅 채널을 ${channel} 로 설정했습니다.`, flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName === '기본역할') {
    if (interaction.user.id !== ADMIN_USER_ID) {
      return interaction.reply({ content: '관리자만 사용할 수 있는 명령어입니다.', flags: MessageFlags.Ephemeral });
    }
    if (!interaction.guild) {
      return interaction.reply({ content: '서버에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
    }

    const role = interaction.options.getRole('역할');
    const config = loadChannelConfig();
    config.global.defaultRoleId = role.id;
    saveChannelConfig(config);
    return interaction.reply({ content: `기본 역할을 ${role} 로 설정했습니다.`, flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName === '랭킹채널' || interaction.commandName === '퇴장채널') {
    if (interaction.user.id !== ADMIN_USER_ID) {
      return interaction.reply({ content: '관리자만 사용할 수 있는 명령어입니다.', flags: MessageFlags.Ephemeral });
    }
    if (!interaction.guild) {
      return interaction.reply({ content: '서버에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
    }

    const channel = interaction.options.getChannel('채널');
    if (interaction.commandName === '랭킹채널') {
      if (!db) {
        return interaction.reply({ content: 'DATABASE_URL이 설정되어 있지 않습니다.', flags: MessageFlags.Ephemeral });
      }
      await publishRankingChannel(interaction.guild, channel);
      return interaction.reply({ content: `${channel} 채널에 랭킹 게시를 설정했습니다.`, flags: MessageFlags.Ephemeral });
    }

    const config = loadChannelConfig();
    config.guilds[interaction.guildId] ??= {};
    config.guilds[interaction.guildId].goodbyeChannelId = channel.id;
    saveChannelConfig(config);
    return interaction.reply({ content: `퇴장 로깅 채널을 ${channel} 로 설정했습니다.`, flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName !== '후원금액') return;

  if (interaction.user.id !== ADMIN_USER_ID) {
    return interaction.reply({ content: '관리자만 사용할 수 있는 명령어입니다.', flags: MessageFlags.Ephemeral });
  }
  if (!db) {
    return interaction.reply({ content: 'DATABASE_URL이 설정되어 있지 않습니다.', flags: MessageFlags.Ephemeral });
  }

  const target = interaction.options.getUser('유저');
  const action = interaction.options.getSubcommand();

  try {
    if (action === '조회') {
      const { rows } = await db.query('SELECT donation_amount FROM user_subscriptions WHERE user_id = $1', [target.id]);
      const amount = Number(rows[0]?.donation_amount || 0);
      await interaction.reply({
        content: `${target}의 누적 후원금액은 **${amount.toLocaleString('ko-KR')}원** 입니다.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const delta = interaction.options.getInteger('금액') * (action === '감소' ? -1 : 1);
    const { rows } = await db.query(
      `
      INSERT INTO user_subscriptions (user_id, tier, donation_amount, created_at, updated_at)
      VALUES ($1, 'free', GREATEST($2, 0), NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET donation_amount = GREATEST(user_subscriptions.donation_amount + $3, 0), updated_at = NOW()
      RETURNING donation_amount
      `,
      [target.id, Math.max(delta, 0), delta]
    );

    const amount = Number(rows[0].donation_amount);
    const tier = amount >= 5000 ? 'premium' : amount >= 3000 ? 'basic' : 'free';
    await db.query('UPDATE user_subscriptions SET tier = $1, updated_at = NOW() WHERE user_id = $2', [tier, target.id]);

    if (interaction.guild) {
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      const role = member && interaction.guild.roles.cache.get(ROLE_IDS[tier]);
      if (member && role) {
        await member.roles.remove(Object.values(ROLE_IDS).filter((roleId) => roleId !== role.id));
        await member.roles.add(role);
      }
    }

    const rankingConfig = await db.query('SELECT channel_id FROM donation_ranking_channels WHERE guild_id = $1', [interaction.guildId]);
    const rankingChannel = interaction.guild?.channels.cache.get(rankingConfig.rows[0]?.channel_id);
    if (rankingChannel) await publishRankingChannel(interaction.guild, rankingChannel);

    await interaction.reply({
      content: `${target}의 후원금액을 ${action === '추가' ? '추가' : '감소'}했습니다.\n- 누적 금액: **${amount.toLocaleString('ko-KR')}원**\n- 적용 티어: **${tier.toUpperCase()}**`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error('Donation amount command error:', error);
    await interaction.reply({ content: '후원금액 처리 중 오류가 발생했습니다.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

client.on('guildMemberAdd', async (member) => {
  const config = loadChannelConfig();
  const channel = member.guild.channels.cache.get(config.global.welcomeChannelId);
  if (!channel) return;

  await assignDefaultRole(member);

  const now = Date.now();
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('새로운 멤버가 들어왔어요')
    .setDescription([`환영합니다, ${member}!`, '', `**${member.guild.name}** 커뮤니티에 오신 걸 환영합니다.`, '즐거운 시간 보내세요.'].join('\n'))
    .addFields(
      {
        name: '회원 정보',
        value:
          `**태그** \`${member.user.tag}\`\n` +
          `**계정 생성일** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\n` +
          `**입장 시각** <t:${Math.floor(now / 1000)}:R>`,
        inline: false,
      },
      {
        name: '서버 정보',
        value:
          `**현재 인원** \`${member.guild.memberCount.toLocaleString()}명\`\n` +
          `**순서** ${member.guild.memberCount}번째 멤버`,
        inline: false,
      }
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 512 }))
    .setFooter({
      text: `${member.guild.name} - We're happy to have you!`,
      iconURL: member.guild.iconURL(),
    })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
});

client.on('guildMemberRemove', async (member) => {
  const config = loadChannelConfig();
  const channel = member.guild.channels.cache.get(config.guilds[member.guild.id]?.goodbyeChannelId);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('멤버가 서버를 떠났어요')
    .setDescription([`안녕히 가세요, ~~${member.user.tag}~~.`, '', `**${member.guild.name}** 커뮤니티에서 떠났습니다.`, '다음에 또 만나요.'].join('\n'))
    .addFields(
      {
        name: '회원 정보',
        value:
          `**태그** \`${member.user.tag}\`\n` +
          `**ID** \`${member.id}\`\n` +
          `**계정 생성일** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\n` +
          `**서버 입장일** <t:${Math.floor(member.joinedTimestamp / 1000)}:R>`,
        inline: false,
      },
      {
        name: '서버 정보',
        value: `**현재 인원** \`${member.guild.memberCount.toLocaleString()}명\``,
        inline: false,
      }
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 512 }))
    .setFooter({
      text: `${member.guild.name} - We'll miss you!`,
      iconURL: member.guild.iconURL(),
    })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
});

client.login(process.env.DISCORD_TOKEN);
