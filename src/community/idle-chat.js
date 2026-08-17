function createIdleChat({ client, readSetting, guildId, fallbackChannelId, idleMs, model }) {
  let timer;
  let inProgress = false;

  function getChannelId() {
    const configured = readSetting(guildId, 'chat_channel_id');
    if (configured === 'disabled') return null;
    return configured || fallbackChannelId;
  }

  async function createQuestion() {
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
              '너는 디스코드 친목 채널에서 사람들과 자연스럽게 스몰토크를 시작하는 정답고 예의 바른 한국인 봇이다. 너무 짧지 않게 2~3문장 정도로 구체적인 상황이나 본인 의견을 곁들여 다른 유저들이 자연스럽게 경험이나 생각을 이어서 댓글 달기 좋은 질문을 존댓말(~해요, ~인가요?, ~ 있으신가요?)로 작성해라. 불필요한 인사말, 해시태그, 인용부호는 제외하고 질문 내용만 출력해라.',
          },
          {
            role: 'user',
            content:
              '일상, 음식/맛집, 추천 영화/드라마/음악, 주말 계획, 최신 게임, 취미 생활 중 하나의 주제로 대화를 유도하는 친근한 질문 1개를 만들어주세요.',
          },
        ],
        max_tokens: 150,
        temperature: 0.9,
      }),
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Hugging Face request failed: ${response.status} ${details.slice(0, 500)}`);
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Hugging Face returned an empty question');
    return text.replace(/^['"“”]+|['"“”]+$/g, '').trim();
  }

  async function sendQuestion() {
    if (inProgress || !getChannelId()) return;
    inProgress = true;
    try {
      const channel = await client.channels.fetch(getChannelId());
      if (!channel?.isTextBased()) return;
      const question = await createQuestion();
      await channel.send(`💬 **[오늘의 대화 주제]**\n${question}`);
    } catch (error) {
      console.error('Idle question error:', error);
    } finally {
      inProgress = false;
      schedule();
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (getChannelId()) timer = setTimeout(sendQuestion, idleMs);
  }

  function handleMessage(message) {
    if (!message.author?.bot && message.channelId === getChannelId()) schedule();
  }

  return { getChannelId, schedule, sendQuestion, handleMessage };
}

module.exports = { createIdleChat };
