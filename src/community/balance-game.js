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
    // 30분 ~ 60분 무작위 (밀리초)
    const minMs = 30 * 60 * 1000;
    const maxMs = 60 * 60 * 1000;
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  }

  async function generateBalanceQuestion() {
    const fallbacks = [
      { title: '⚖️ 평생 하나만 먹어야 한다면?', optionA: '평생 치킨만 먹기', optionB: '평생 피자만 먹기' },
      { title: '⚖️ 진짜 기괴한 능력 딜레마', optionA: '소리 지를 때마다 10만 원 나오기 (귀 찢어지게 지름)', optionB: '조용히 눈 깜빡일 때마다 1천 원 나오기' },
      { title: '⚖️ 주말 극악의 딜레마', optionA: '하루 종일 집에 혼자 있고 아무도 연락 안 옴', optionB: '하루에 약속 5개 잡혀서 쉬지도 못함' },
      { title: '⚖️ 폰 딜레마', optionA: '평생 Wi-Fi / 데이터 없이 살기', optionB: '평생 에어컨 / 히터 없이 살기' },
      { title: '⚖️ 친구 / 연애 딜레마', optionA: '내 흑역사 다 아는 찐친', optionB: '나한테 비밀이 전혀 없는 연인' },
      { title: '⚖️ 수면 딜레마', optionA: '하루 3시간 자고 완전 피곤함 제로', optionB: '하루 12시간 자야만 겨우 안 피곤함' },
      { title: '⚖️ 민트초코 딜레마', optionA: '평생 모든 음식에서 민트맛 나기', optionB: '평생 모든 음식에서 탄맛 나기' },
    ];

    try {
      if (!process.env.HF_TOKEN) throw new Error('HF_TOKEN is not configured');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.HF_TOKEN}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                '너는 10대~20대가 디스코드에서 대화할 때 극적으로 의견이 갈리는 쉬운 밸런스 게임을 만드는 AI다. 어려운 단어나 복잡한 철학적 딜레마는 절대 금지한다. 짧고 굵으며 반응이 폭발적인 질문을 작성해라. 반드시 다음 JSON만 반환해라: {"title": "주제", "optionA": "A선택지", "optionB": "B선택지"}. 마크다운이나 코드블록은 절대 붙이지 마라.',
            },
            {
              role: 'user',
              content:
                '음식, 일상, 수면, 게임, 돈, 초능력 중 유저들의 의견이 정확히 50:50으로 갈릴 만한 직관적이고 쉬운 한국어 밸런스 게임 1개를 JSON으로 만들어라.',
            },
          ],
          max_tokens: 150,
          temperature: 0.9,
        }),
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const details = await response.text();
        throw new Error(`Hugging Face request failed: ${response.status} ${details.slice(0, 500)}`);
      }
      const data = await response.json();
      const rawText = data.choices?.[0]?.message?.content?.trim() || '';
      
      // JSON 추출
      const cleanText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanText);
      if (parsed.optionA && parsed.optionB) {
        return {
          title: parsed.title || '⚖️ 당신의 선택은?',
          optionA: parsed.optionA,
          optionB: parsed.optionB,
        };
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.warn('[BalanceGame] AI 질문 생성 실패, 템플릿 질문을 사용합니다:', error.message);
      }
    }

    // 기본 예비 질문 (AI 타임아웃/오류 발생 시)
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
