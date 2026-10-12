'use strict';

const ACCOUNT_STYLE = {
  user: { isBot: false, label: '계정 종류: 일반 멤버', color: 0x57f287 },
  bot: { isBot: true, label: '계정 종류: 봇', color: 0x9ba5b4 },
};

const NOTICE_ALLOWED_MENTIONS = { parse: [] };

function formatCreatedAt(date) {
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const pick = (type) => parts.find((p) => p.type === type).value;

  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  let hour = pick('hour');
  if (hour === '24') hour = '00';

  return `${year}-${month}-${day} ${hour}:${pick('minute')} (KST)`;
}

function formatJoinNumber(seq) {
  return `${seq}번째 조직원`;
}

function describeAccountType(user) {
  return user.bot ? ACCOUNT_STYLE.bot : ACCOUNT_STYLE.user;
}

function buildJoinNoticeData({ member, seq }) {
  const account = describeAccountType(member.user);

  return {
    title: '새로운 조직원이 입장했다.',
    color: account.color,
    fields: [
      { name: '입장한 조직원', value: `<@${member.id}>`, inline: true },
      { name: '계정 생성일', value: formatCreatedAt(member.user.createdAt), inline: true },
      { name: '서버 가입 순서', value: formatJoinNumber(seq), inline: true },
    ],
    footer: account.label,
    thumbnail: member.displayAvatarURL(),
  };
}

module.exports = {
  NOTICE_ALLOWED_MENTIONS,
  formatCreatedAt,
  formatJoinNumber,
  describeAccountType,
  buildJoinNoticeData,
};