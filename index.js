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
  let updated = 0;
  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;
    const tier = await getTier(member.id);
    const wantedRole = guild.roles.cache.get(ROLE_IDS[tier]);
    if (!wantedRole) continue;
    const tierRoles = Object.values(ROLE_IDS).filter((id) => id !== wantedRole.id);
    await member.roles.remove(tierRoles).catch(() => {});
    if (!member.roles.cache.has(wantedRole.id)) {
      await member.roles.add(wantedRole).catch(() => {});
      updated += 1;
    }
  }
  return updated;
}

async function publishRankingChannel(guild) {
  const channelName = '후원금액-랭킹';
  let channel = guild.channels.cache.find((item) => item.name === channelName && item.type === ChannelType.GuildText);
  if (!channel) {
    channel = await guild.channels.create({ name: channelName, type: ChannelType.GuildText });
  }

  const tierOrder = { premium: 2, basic: 1, free: 0 };
  const members = await guild.members.fetch();
  const ranking = [];
  for (const member of members.values()) {
    if (member.user.bot) continue;
    const tier = await getTier(member.id);
    ranking.push({ member, tier, score: tierOrder[tier] });
  }
  ranking.sort((a, b) => b.score - a.score || a.member.displayName.localeCompare(b.member.displayName));
  const lines = ranking.slice(0, 10).map((item, index) =>
    `${index + 1}. ${item.member} — ${item.tier.toUpperCase()} 등급`
  );
  await channel.send({ content: `🏆 **후원 등급 랭킹**\n\n${lines.join('\n') || '등록된 유저가 없습니다.'}\n\n※ 현재 DB에는 누적 후원금액이 저장되지 않아 등급 기준으로 표시됩니다.` });
  return channel;
}

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.application.commands.set([
    new SlashCommandBuilder().setName('등급역할').setDescription('모든 유저의 등급에 맞춰 역할을 부여합니다.'),
    new SlashCommandBuilder().setName('랭킹체널').setDescription('후원 등급 랭킹 채널을 만들고 갱신합니다.'),
  ]).catch(console.error);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!['등급역할', '랭킹체널'].includes(interaction.commandName)) return;
  if (interaction.user.id !== ADMIN_USER_ID) {
    await interaction.reply({ content: '관리자만 사용할 수 있는 명령어입니다.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.guild) return interaction.reply({ content: '서버에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (interaction.commandName === '등급역할') {
      const updated = await syncGuildRoles(interaction.guild);
      await interaction.editReply(`등급 역할 동기화가 완료되었습니다. 새로 부여한 역할: ${updated}명`);
    } else {
      const channel = await publishRankingChannel(interaction.guild);
      await interaction.editReply(`${channel} 채널에 랭킹을 갱신했습니다.`);
    }
  } catch (error) {
    console.error('Slash command error:', error);
    await interaction.editReply('명령어 실행 중 오류가 발생했습니다. 봇의 역할 관리 권한과 DB 연결을 확인해 주세요.');
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
