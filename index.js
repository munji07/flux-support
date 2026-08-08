const { Client, GatewayIntentBits, EmbedBuilder, ChannelType, SlashCommandBuilder, MessageFlags } = require('discord.js');
const pg = require('pg');
require('dotenv').config({ path: '.env' });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

const ROLE_IDS = {
  free: '1525464470967812096',
  basic: '1525464471579922533',
  premium: '1525464472360063096',
};
const ADMIN_USER_ID = '1269575955626725390';
const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (databaseUrl) {
  databaseUrl.searchParams.delete('sslmode');
  databaseUrl.searchParams.delete('channel_binding');
}
const db = databaseUrl
  ? new pg.Pool({ connectionString: databaseUrl.toString(), ssl: { rejectUnauthorized: false } })
  : null;

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
    throw new Error(`서버에서 역할을 찾을 수 없습니다: ${missingRoles.join(', ')}`);
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
      throw new Error(`봇 역할보다 높은 위치에 있는 역할입니다: ${tier} (${wantedRole.name})`);
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
  if (!db) throw new Error('DATABASE_URL이 설정되지 않았습니다.');

  const { rows: columns } = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'user_subscriptions'
      AND column_name IN ('donation_amount', 'total_donation', 'total_donation_amount')
  `);
  const amountColumn = columns[0]?.column_name;
  if (!amountColumn) {
    throw new Error('user_subscriptions에 후원액 컬럼이 없습니다. donation_amount 컬럼을 추가해 주세요.');
  }

  const members = await guild.members.fetch();
  const { rows } = await db.query(`SELECT user_id, ${amountColumn} AS amount FROM user_subscriptions WHERE ${amountColumn} > 0 ORDER BY ${amountColumn} DESC LIMIT 10`);
  const lines = rows.map((row, index) => {
    const member = members.get(row.user_id);
    return `${index + 1}. ${member ? member : `<@${row.user_id}>`} — ${Number(row.amount).toLocaleString('ko-KR')}원`;
  });
  await channel.send({ content: `🏆 **후원금액 랭킹 TOP 10**\n\n${lines.join('\n') || '등록된 후원자가 없습니다.'}` });
  return channel;
}

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.application.commands.set([
    new SlashCommandBuilder().setName('등급역할').setDescription('모든 유저의 등급에 맞춰 역할을 부여합니다.'),
    new SlashCommandBuilder().setName('랭킹채널').setDescription('선택한 채널에 후원금액 랭킹을 게시합니다.')
      .addChannelOption((option) => option.setName('채널').setDescription('랭킹을 게시할 텍스트 채널').addChannelTypes(ChannelType.GuildText).setRequired(true)),
  ]).catch(console.error);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!['등급역할', '랭킹채널'].includes(interaction.commandName)) return;
  if (interaction.user.id !== ADMIN_USER_ID) {
    await interaction.reply({ content: '관리자만 사용할 수 있는 명령어입니다.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.guild) return interaction.reply({ content: '서버에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (interaction.commandName === '등급역할') {
      const result = await syncGuildRoles(interaction.guild);
      const failureText = result.failures.slice(0, 3).join('\n');
      await interaction.editReply(
        `등급 역할 동기화가 완료되었습니다. 새로 부여한 역할: ${result.updated}명` +
        (result.failed ? `\n실패: ${result.failed}명\n${failureText}` : '')
      );
    } else {
      const channel = interaction.options.getChannel('채널');
      await publishRankingChannel(interaction.guild, channel);
      await interaction.editReply(`${channel} 채널에 랭킹을 갱신했습니다.`);
    }
  } catch (error) {
    console.error('Slash command error:', error);
    await interaction.editReply('명령어 실행 중 오류가 발생했습니다. 봇의 역할 관리 권한과 DB 연결을 확인해 주세요.');
  }
});

client.once('clientReady', async () => {
  if (db) {
    await db.query('ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS donation_amount INTEGER NOT NULL DEFAULT 0').catch(console.error);
  }
  await client.application.commands.create(
    new SlashCommandBuilder()
      .setName('후원금액')
      .setDescription('유저의 누적 후원금액을 관리합니다.')
      .addSubcommand((subcommand) => subcommand.setName('조회').setDescription('누적 후원금액을 조회합니다.')
        .addUserOption((option) => option.setName('유저').setDescription('조회할 유저').setRequired(true)))
      .addSubcommand((subcommand) => subcommand.setName('추가').setDescription('후원금액을 추가합니다.')
        .addUserOption((option) => option.setName('유저').setDescription('대상 유저').setRequired(true))
        .addIntegerOption((option) => option.setName('금액').setDescription('추가할 금액(원)').setMinValue(1).setRequired(true)))
      .addSubcommand((subcommand) => subcommand.setName('감소').setDescription('후원금액을 감소합니다.')
        .addUserOption((option) => option.setName('유저').setDescription('대상 유저').setRequired(true))
        .addIntegerOption((option) => option.setName('금액').setDescription('감소할 금액(원)').setMinValue(1).setRequired(true)))
  ).catch(console.error);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== '후원금액') return;
  if (interaction.user.id !== ADMIN_USER_ID) {
    await interaction.reply({ content: '관리자만 사용할 수 있는 명령어입니다.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!db) return interaction.reply({ content: 'DATABASE_URL이 설정되지 않았습니다.', flags: MessageFlags.Ephemeral });
  const target = interaction.options.getUser('유저');
  const action = interaction.options.getSubcommand();
  try {
    if (action === '조회') {
      const { rows } = await db.query('SELECT donation_amount FROM user_subscriptions WHERE user_id = $1', [target.id]);
      const amount = Number(rows[0]?.donation_amount || 0);
      await interaction.reply({ content: `${target}님의 누적 후원금액은 **${amount.toLocaleString('ko-KR')}원**입니다.`, flags: MessageFlags.Ephemeral });
      return;
    }
    const delta = interaction.options.getInteger('금액') * (action === '감소' ? -1 : 1);
    const { rows } = await db.query(`
      INSERT INTO user_subscriptions (user_id, tier, donation_amount, created_at, updated_at)
      VALUES ($1, 'free', GREATEST($2, 0), NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET donation_amount = GREATEST(user_subscriptions.donation_amount + $3, 0), updated_at = NOW()
      RETURNING donation_amount`, [target.id, Math.max(delta, 0), delta]);
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
    await interaction.reply({ content: `${target}님의 후원금액을 ${action === '추가' ? '추가' : '감소'}했습니다.\n- 누적 금액: **${amount.toLocaleString('ko-KR')}원**\n- 적용 등급: **${tier.toUpperCase()}**`, flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error('Donation amount command error:', error);
    await interaction.reply({ content: '후원금액 처리 중 오류가 발생했습니다.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

client.on('guildMemberAdd', async (member) => {
  const channel = member.guild.channels.cache.get(process.env.WELCOME_CHANNEL_ID);
  if (!channel) return;

  const now = Date.now();
  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('🌸 새로운 멤버가 도착했어요!')
    .setDescription(
      [
        `𐙚˙⋆.˚　　${member}　　.˚⋆˙𐙚`,
        '',
        `**${member.guild.name}** 커뮤니티에 어서 오세요!`,
        '즐거운 시간 보내시길 바랄게요 🎀',
      ].join('\n')
    )
    .addFields(
      {
        name: '✧ · · · · · · · · · · · ✧',
        value:
          `**🆔 태그** \`${member.user.tag}\`\n` +
          `**📅 가입일** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\n` +
          `**🕐 들어온 시간** <t:${Math.floor(now / 1000)}:R>`,
        inline: false,
      },
      {
        name: '✧ · · · · · · · · · · · ✧',
        value:
          `**👥 현재 인원** \`${member.guild.memberCount.toLocaleString()}명\`\n` +
          `**🏆 순서** ${member.guild.memberCount}번째 멤버`,
        inline: false,
      }
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 512 }))
    .setFooter({
      text: `${member.guild.name} • We're happy to have you!`,
      iconURL: member.guild.iconURL(),
    })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
});

client.on('guildMemberRemove', async (member) => {
  const channel = member.guild.channels.cache.get(process.env.GOODBYE_CHANNEL_ID);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('💔 누군가 떠나셨네요...')
    .setDescription(
      [
        `𐙚˙⋆.˚　　~~${member.user.tag}~~　　.˚⋆˙𐙚`,
        '',
        `**${member.guild.name}** 커뮤니티에서 나가셨습니다.`,
        '함께해 주셔서 감사했습니다 🌷',
      ].join('\n')
    )
    .addFields(
      {
        name: '✧ · · · · · · · · · · · ✧',
        value:
          `**🆔 태그** \`${member.user.tag}\`\n` +
          `**🆔 ID** \`${member.id}\`\n` +
          `**📅 가입일** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\n` +
          `**📆 서버 입장일** <t:${Math.floor(member.joinedTimestamp / 1000)}:R>`,
        inline: false,
      },
      {
        name: '✧ · · · · · · · · · · · ✧',
        value: `**👥 현재 인원** \`${member.guild.memberCount.toLocaleString()}명\``,
        inline: false,
      }
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 512 }))
    .setFooter({
      text: `${member.guild.name} • We'll miss you!`,
      iconURL: member.guild.iconURL(),
    })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
});

client.login(process.env.DISCORD_TOKEN);
