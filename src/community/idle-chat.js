function createIdleChat({ client, readSetting, guildId, fallbackChannelId, model }) {
  let timer;
  let inProgress = false;
  let recentMessageTimes = [];
  let questionScheduled = false;

  const ACTIVITY_WINDOW_MS = 10 * 60 * 1000;
  const ACTIVITY_THRESHOLD = 6;
  const MIN_DELAY_MS = 30 * 60 * 1000;
  const MAX_DELAY_MS = 60 * 60 * 1000;

  function getChannelId() {
    const configured = readSetting(guildId, 'chat_channel_id');
    if (configured === 'disabled') return null;
    return configured || fallbackChannelId;
  }

  async function createQuestion(recentContext = '') {
    if (!process.env.HF_TOKEN) throw new Error('HF_TOKEN is not configured');
    
    const userPrompt = recentContext
      ? `다음은 최근 채널 대화 내용입니다:\n---\n${recentContext}\n---\n위 대화 흐름을 자연스럽게 받거나 이어받아서(또는 대화가 끊겼다면 관련있는 흥미로운 주제나 새로운 스몰토크 주제로) 다른 유저들이 답하기 좋은 질문 1개를 작성해 주세요.`
      : '일상, 음식/맛집, 추천 영화/드라마/음악, 주말 계획, 최신 게임, 취미 생활 중 하나의 주제로 대화를 유도하는 친근한 질문 1개를 만들어주세요.';

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
              '너는 디스코드 친목 채널에서 사람들과 자연스럽게 대화를 이어주는 정답고 예의 바른 한국인 봇이다. 최근 대화 내용이 있다면 그 주제에 호응하며 이어지는 질문을 하고, 대화가 없으면 흥미로운 스몰토크를 시작해라. 너무 짧지 않게 2~3문장 정도로 구체적인 상황이나 본인 의견을 곁들여 다른 유저들이 댓글 달기 좋은 질문을 존댓말(~해요, ~인가요?, ~ 있으신가요?)로 작성해라. 불필요한 인사말, 해시태그, 인용부호는 제외하고 질문 내용만 출력해라.',
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        max_tokens: 180,
        temperature: 0.85,
      }),
    }).finally(() => clearTimeout(timeoutId));
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

      // 최근 메시지 10개 가져오기
      let recentContext = '';
      try {
        const fetchedMessages = await channel.messages.fetch({ limit: 10 });
        const textMessages = fetchedMessages
          .filter((msg) => !msg.author?.bot && msg.content?.trim())
          .reverse()
          .map((msg) => `${msg.author.displayName || msg.author.username}: ${msg.content.slice(0, 100)}`);
        
        if (textMessages.length > 0) {
          recentContext = textMessages.join('\n');
        }
      } catch (e) {
        console.warn('Failed to fetch recent messages for context:', e.message);
      }

      const question = await createQuestion(recentContext);
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
    questionScheduled = false;
    recentMessageTimes = [];
  }

  function handleMessage(message) {
    if (message.author?.bot || message.channelId !== getChannelId()) return;

    const now = Date.now();
    recentMessageTimes = recentMessageTimes.filter((time) => now - time <= ACTIVITY_WINDOW_MS);
    recentMessageTimes.push(now);

    if (questionScheduled || recentMessageTimes.length < ACTIVITY_THRESHOLD) return;

    questionScheduled = true;
    const delay = MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1));
    timer = setTimeout(sendQuestion, delay);
  }

  return { getChannelId, schedule, sendQuestion, handleMessage };
}

module.exports = { createIdleChat };
