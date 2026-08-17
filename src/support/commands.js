const { ChannelType, MessageFlags } = require('discord.js');

const SUPPORT_GUILD_ID = '1525458537139146812';
const ADMIN_USER_ID = '1269575955626725390';

async function publishRankingChannel(db, guild, channel) {
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
    `INSERT INTO donation_ranking_channels (guild_id, channel_id, message_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (guild_id) DO UPDATE SET channel_id = EXCLUDED.channel_id, message_id = EXCLUDED.message_id`,
    [guild.id, channel.id, message.id]
  );
}

async function handleSupportInteraction(interaction, db) {
  if (!['랭킹채널', '후원금액'].includes(interaction.commandName)) return false;

  if (interaction.guildId !== SUPPORT_GUILD_ID) {
    await interaction.reply({ content: '지정된 서버에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (interaction.user.id !== ADMIN_USER_ID) {
    await interaction.reply({ content: '관리자만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!db) {
    await interaction.reply({ content: 'DATABASE_URL이 설정되어 있지 않습니다.', flags: MessageFlags.Ephemeral });
    return true;
  }

  try {
    if (interaction.commandName === '랭킹채널') {
      const channel = interaction.options.getChannel('채널');
      await publishRankingChannel(db, interaction.guild, channel);
      await interaction.reply({ content: `${channel} 채널에 랭킹 게시를 설정했습니다.`, flags: MessageFlags.Ephemeral });
      return true;
    }

    const target = interaction.options.getUser('유저');
    const action = interaction.options.getSubcommand();
    if (action === '조회') {
      const { rows } = await db.query('SELECT donation_amount FROM user_subscriptions WHERE user_id = $1', [target.id]);
      const amount = Number(rows[0]?.donation_amount || 0);
      await interaction.reply({ content: `${target}의 누적 후원금액은 **${amount.toLocaleString('ko-KR')}원** 입니다.`, flags: MessageFlags.Ephemeral });
      return true;
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
    await interaction.reply({ content: `${target}의 후원금액을 ${action === '추가' ? '추가' : '감소'}했습니다.\n- 누적 금액: **${amount.toLocaleString('ko-KR')}원**\n- 적용 티어: **${tier.toUpperCase()}**`, flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error('Donation amount command error:', error);
    await interaction.reply({ content: '후원금액 처리 중 오류가 발생했습니다.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  return true;
}

module.exports = { handleSupportInteraction };
