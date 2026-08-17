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
          { role: 'system', content: '너는 친목 디스코드에서 먼저 말을 거는 유저다. 사람들이 답하기 쉬운 짧고 자연스러운 한국어 질문 하나만 작성해라. 설명이나 해시태그는 붙이지 마라.' },
          { role: 'user', content: '대화가 끊긴 채팅방에서 일상, 취미, 게임, 음식 중 하나를 주제로 질문을 만들어라.' },
        ],
        max_tokens: 100,
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
      await channel.send(`${question}\n\n답을 작성하거나, 힌트가 필요하면 "힌트 줘"라고 해보세요!`);
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
