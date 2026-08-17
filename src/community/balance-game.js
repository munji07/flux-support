const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function createBalanceGame({ client, readSetting, writeSetting, deleteSetting, guildId, model }) {
  let timer = null;
  let inProgress = false;

  // DB에 각 밸런스 게임 투표 결과를 임시 저장 (gameId -> { optionA: number, optionB: number, votedUsers: Map<userId, 'A'|'B'> })
  const activeGames = new Map();

  function getChannelId() {
    const configured = readSetting(guildId, 'balance_game_channel_id');
    if (configured === 'disabled') return null;
    return configured || null;
  }

  function getRandomIntervalMs() {
    // 10분 ~ 30분 무작위 (밀리초)
    const minMs = 10 * 60 * 1000;
    const maxMs = 30 * 60 * 1000;
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  }

  async function generateBalanceQuestion() {
    if (!process.env.HF_TOKEN) throw new Error('HF_TOKEN is not configured');
    const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.HF_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              '너는 딜레마와 흥미진진한 선택지를 만드는 밸런스 게임 전문 AI다. 다음 형식의 JSON만 정확히 출력해라: {"title": "주제 또는 설명", "optionA": "선택지 A", "optionB": "선택지 B"}. 마크다운, 코드블록(```json 등)이나 불필요한 설명은 포함하지 마라.',
          },
          {
            role: 'user',
            content:
              '일상, 초능력, 음주/음식, 연애, 직장/학교, 재밌는 딜레마 중 무작위 주제로 당장 선택하기 극도로 까다롭고 신선한 밸런스 게임 1개를 JSON으로 만들어라.',
          },
        ],
        max_tokens: 150,
        temperature: 0.95,
      }),
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Hugging Face request failed: ${response.status} ${details.slice(0, 500)}`);
    }
    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content?.trim() || '';
    
    // JSON 추출
    const cleanText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    try {
      const parsed = JSON.parse(cleanText);
      if (parsed.optionA && parsed.optionB) {
        return {
          title: parsed.title || '⚖️ 당신의 선택은?',
          optionA: parsed.optionA,
          optionB: parsed.optionB,
        };
      }
    } catch {}

    // 기본 예비 질문 (AI 파싱 실패 시)
    const fallbacks = [
      { title: '⚖️ 평생 하나만 골라야 한다면?', optionA: '평생 치킨 못 먹기', optionB: '평생 피자 못 먹기' },
      { title: '⚖️ 초능력을 가질 수 있다면?', optionA: '투명인간 되기 (옷 제외)', optionB: '시간을 5초 전으로 되돌리기' },
      { title: '⚖️ 극악의 밸런스 게임!', optionA: '여름에 히터 틀기', optionB: '겨울에 에어컨 틀기' },
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }

  async function sendBalanceGame() {
    const channelId = getChannelId();
    if (inProgress || !channelId) return;
    inProgress = true;
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel?.isTextBased()) {
        const question = await generateBalanceQuestion();
        const gameId = `bg_${Date.now()}`;
        
        activeGames.set(gameId, {
          votesA: 0,
          votesB: 0,
          votedUsers: new Map(),
          title: question.title,
          optionA: question.optionA,
          optionB: question.optionB,
        });

        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle(`⚖️ [밸런스 게임] ${question.title}`)
          .setDescription(`**A.** ${question.optionA}\n\n**VS**\n\n**B.** ${question.optionB}`)
          .addFields({ name: '📊 실시간 투표 현황', value: '🅰️ 0표 (0%) vs 🅱️ 0표 (0%)\n*(총 0명 참여)*' })
          .setFooter({ text: '버튼을 눌러 투표하세요! 언제든지 선택을 변경할 수 있습니다.' })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`balance:A:${gameId}`).setLabel(`🅰️ A 선택`).setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`balance:B:${gameId}`).setLabel(`🅱️ B 선택`).setStyle(ButtonStyle.Danger)
        );

        await channel.send({ embeds: [embed], components: [row] });
      }
    } catch (error) {
      console.error('Balance game error:', error);
    } finally {
      inProgress = false;
      schedule();
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (getChannelId()) {
      const delay = getRandomIntervalMs();
      timer = setTimeout(sendBalanceGame, delay);
    }
  }

  async function handleButtonInteraction(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('balance:')) return false;

    const [, choice, gameId] = interaction.customId.split(':');
    const gameData = activeGames.get(gameId);

    if (!gameData) {
      await interaction.reply({ content: '오래되었거나 종료된 밸런스 게임입니다.', ephemeral: true });
      return true;
    }

    const previousChoice = gameData.votedUsers.get(interaction.user.id);
    if (previousChoice === choice) {
      await interaction.reply({ content: `이미 **${choice}**에 투표하셨습니다!`, ephemeral: true });
      return true;
    }

    if (previousChoice === 'A') gameData.votesA--;
    else if (previousChoice === 'B') gameData.votesB--;

    if (choice === 'A') gameData.votesA++;
    else if (choice === 'B') gameData.votesB++;

    gameData.votedUsers.set(interaction.user.id, choice);

    const totalVotes = gameData.votesA + gameData.votesB;
    const percentA = totalVotes > 0 ? Math.round((gameData.votesA / totalVotes) * 100) : 0;
    const percentB = totalVotes > 0 ? Math.round((gameData.votesB / totalVotes) * 100) : 0;

    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setFields({
      name: '📊 실시간 투표 현황',
      value: `🅰️ **${gameData.votesA}표** (${percentA}%)  vs  🅱️ **${gameData.votesB}표** (${percentB}%)\n*(총 ${totalVotes}명 참여)*`,
    });

    await interaction.update({ embeds: [updatedEmbed] });
    return true;
  }

  return { getChannelId, schedule, sendBalanceGame, handleButtonInteraction };
}

module.exports = { createBalanceGame };
