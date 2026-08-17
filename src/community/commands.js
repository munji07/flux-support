const COMMUNITY_COMMANDS = new Set([
  '출석',
  '주간활동',
  '잡담채널',
  '관심사',
  '친구추천',
  '친구전송',
  '친구삭제',
  '친구받기',
  '친구목록',
  '친구알림',
  'game',
  'arcade',
  '레벨',
  '코인',
  '별명변경',
  '별명설정',
  '미니게임',
  '경험치',
  '등급역할',
]);

function isCommunityCommand(commandName) {
  return COMMUNITY_COMMANDS.has(commandName);
}

module.exports = { COMMUNITY_COMMANDS, isCommunityCommand };
