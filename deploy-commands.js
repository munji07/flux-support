const { REST, Routes, SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
require('dotenv').config({ path: '.env' });

const DISHOUSE_ROOMS = [
  { name: '거실', value: 'living' },
  { name: '침실', value: 'bedroom' },
  { name: '주방', value: 'kitchen' },
  { name: '방 1', value: 'room1' },
  { name: '방 2', value: 'room2' },
  { name: '화장실', value: 'bathroom' },
];

const guildId = '1538513625730383902';

const globalCommands = [
  new SlashCommandBuilder()
    .setName('\uC5B4\uB4DC\uBBFC\uC5ED\uD560')
    .setDescription('\uAD00\uB9AC \uBA85\uB839\uC5B4\uB97C \uC0AC\uC6A9\uD560 \uC5ED\uD560\uC744 \uC124\uC815\uD569\uB2C8\uB2E4.')
    .addSubcommand((subcommand) => subcommand
      .setName('\uC124\uC815')
      .setDescription('\uAD00\uB9AC \uBA85\uB839\uC5B4\uC6A9 \uC5ED\uD560\uC744 \uC124\uC815\uD569\uB2C8\uB2E4.')
      .addRoleOption((option) => option.setName('\uC5ED\uD560').setDescription('\uAD00\uB9AC \uBA85\uB839\uC5B4\uB97C \uC0AC\uC6A9\uD560 \uC5ED\uD560').setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('\uC81C\uAC70').setDescription('\uC124\uC815\uB41C \uAD00\uB9AC \uC5ED\uD560\uC744 \uC81C\uAC70\uD569\uB2C8\uB2E4.'))
    .addSubcommand((subcommand) => subcommand.setName('\uC870\uD68C').setDescription('\uD604\uC7AC \uAD00\uB9AC \uC5ED\uD560\uC744 \uC870\uD68C\uD569\uB2C8\uB2E4.')),
  new SlashCommandBuilder()
    .setName('입장채널')
    .setDescription('입장 로깅 채널을 관리합니다.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('설정')
        .setDescription('입장 로깅 채널을 설정합니다.')
        .addChannelOption((option) =>
          option.setName('채널').setDescription('입장 메시지를 보낼 텍스트 채널').addChannelTypes(ChannelType.GuildText).setRequired(true)
        )
    )
    .addSubcommand((subcommand) => subcommand.setName('제거').setDescription('입장 로깅 채널을 제거합니다.'))
    .addSubcommand((subcommand) => subcommand.setName('조회').setDescription('입장 로깅 채널을 조회합니다.')),
  new SlashCommandBuilder()
    .setName('입장역할')
    .setDescription('새 멤버에게 지급할 역할을 관리합니다.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('추가')
        .setDescription('입장 역할을 추가합니다.')
        .addRoleOption((option) => option.setName('역할').setDescription('자동으로 지급할 역할').setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('제거')
        .setDescription('입장 역할을 제거합니다.')
        .addRoleOption((option) => option.setName('역할').setDescription('제거할 역할').setRequired(true))
    )
    .addSubcommand((subcommand) => subcommand.setName('지급').setDescription('입장 역할이 없는 기존 멤버에게 일괄 지급합니다.'))
    .addSubcommand((subcommand) => subcommand.setName('조회').setDescription('현재 입장 역할 목록을 조회합니다.')),
  new SlashCommandBuilder()
    .setName('퇴장채널')
    .setDescription('퇴장 로깅 채널을 관리합니다.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('설정')
        .setDescription('퇴장 로깅 채널을 설정합니다.')
        .addChannelOption((option) =>
          option.setName('채널').setDescription('퇴장 메시지를 보낼 텍스트 채널').addChannelTypes(ChannelType.GuildText).setRequired(true)
        )
    )
    .addSubcommand((subcommand) => subcommand.setName('제거').setDescription('퇴장 로깅 채널을 제거합니다.'))
    .addSubcommand((subcommand) => subcommand.setName('조회').setDescription('퇴장 로깅 채널을 조회합니다.')),
].map((command) => command.toJSON());

const guildCommands = [
  new SlashCommandBuilder()
    .setName('arcade')
    .setNameLocalizations({ ko: '아케이드' })
    .setDescription('버튼으로 즐기는 코인 미니게임 아케이드')
    .setDescriptionLocalizations({ ko: '버튼으로 즐기는 코인 미니게임 아케이드' }),
  new SlashCommandBuilder().setName('등급역할').setDescription('모든 유저의 등급에 맞춰 역할을 부여합니다.'),
  new SlashCommandBuilder()
    .setName('레벨')
    .setDescription('레벨 시스템을 관리합니다.')
    .addSubcommand((subcommand) => subcommand.setName('조회').setDescription('내 레벨, 경험치, 코인 정보를 확인합니다.'))
    .addSubcommand((subcommand) => subcommand.setName('동기화').setDescription('서버 전체를 DB 기준으로 동기화합니다.')),
  new SlashCommandBuilder()
    .setName('코인')
    .setDescription('내 코인 보유량을 확인합니다.'),
  new SlashCommandBuilder()
    .setName('별명변경')
    .setDescription('서버 별명을 변경합니다.')
    .addStringOption((option) => option.setName('별명').setDescription('새 서버 별명').setRequired(true)),
  new SlashCommandBuilder()
    .setName('별명설정')
    .setDescription('관리자가 유저의 서버 별명을 설정합니다.')
    .addUserOption((option) => option.setName('유저').setDescription('대상 유저').setRequired(true))
    .addStringOption((option) => option.setName('별명').setDescription('설정할 서버 별명').setRequired(true)),
  new SlashCommandBuilder()
    .setName('미니게임')
    .setDescription('코인을 사용해 미니게임을 플레이합니다.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('슬롯')
        .setDescription('코인을 걸고 슬롯을 돌립니다.')
        .addIntegerOption((option) => option.setName('코인').setDescription('배팅할 코인').setMinValue(1).setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('복권')
        .setDescription('복권을 긁어봅니다.')
        .addIntegerOption((option) => option.setName('코인').setDescription('구매할 코인').setMinValue(1).setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('베팅')
        .setDescription('가위바위보에 코인을 걸어봅니다.')
        .addIntegerOption((option) => option.setName('코인').setDescription('배팅할 코인').setMinValue(1).setRequired(true))
        .addStringOption((option) =>
          option
            .setName('선택')
            .setDescription('내 선택')
            .addChoices(
              { name: '가위', value: '가위' },
              { name: '바위', value: '바위' },
              { name: '보', value: '보' }
            )
            .setRequired(true)
        )
    ),
  new SlashCommandBuilder()
    .setName('경험치')
    .setDescription('레벨/코인 데이터를 관리합니다.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('설정')
        .setDescription('유저의 경험치, 코인, 레벨을 직접 설정합니다.')
        .addUserOption((option) => option.setName('유저').setDescription('대상 유저').setRequired(true))
        .addIntegerOption((option) => option.setName('레벨').setDescription('설정할 레벨').setMinValue(1))
        .addIntegerOption((option) => option.setName('경험치').setDescription('설정할 경험치').setMinValue(0))
        .addIntegerOption((option) => option.setName('코인').setDescription('설정할 코인').setMinValue(0))
        .addIntegerOption((option) => option.setName('메시지').setDescription('설정할 메시지 수').setMinValue(0))
    ),
  new SlashCommandBuilder()
    .setName('랭킹채널')
    .setDescription('선택한 채널에 후원금액 랭킹을 게시합니다.')
    .addChannelOption((option) =>
      option
        .setName('채널')
        .setDescription('랭킹을 게시할 텍스트 채널')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('후원금액')
    .setDescription('유저의 누적 후원금액을 관리합니다.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('조회')
        .setDescription('누적 후원금액을 조회합니다.')
        .addUserOption((option) => option.setName('유저').setDescription('조회할 유저').setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('추가')
        .setDescription('후원금액을 추가합니다.')
        .addUserOption((option) => option.setName('유저').setDescription('대상 유저').setRequired(true))
        .addIntegerOption((option) => option.setName('금액').setDescription('추가할 금액(원)').setMinValue(1).setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('감소')
        .setDescription('후원금액을 감소합니다.')
        .addUserOption((option) => option.setName('유저').setDescription('대상 유저').setRequired(true))
        .addIntegerOption((option) => option.setName('금액').setDescription('감소할 금액(원)').setMinValue(1).setRequired(true))
    ),
  new SlashCommandBuilder()
    .setName('경고')
    .setDescription('유저에게 경고를 추가하거나 감소합니다.')
    .addUserOption((option) => option.setName('유저').setDescription('대상 유저').setRequired(true))
    .addStringOption((option) =>
      option
        .setName('작업')
        .setDescription('추가 또는 감소')
        .addChoices(
          { name: '추가', value: '추가' },
          { name: '감소', value: '감소' }
        )
        .setRequired(true)
    )
    .addStringOption((option) => option.setName('사유').setDescription('경고 사유').setRequired(true)),
  new SlashCommandBuilder()
    .setName('추방')
    .setDescription('유저를 서버에서 추방합니다.')
    .addUserOption((option) => option.setName('유저').setDescription('대상 유저').setRequired(true))
    .addStringOption((option) => option.setName('사유').setDescription('추방 사유').setRequired(true)),
  new SlashCommandBuilder()
    .setName('타임아웃')
    .setDescription('유저에게 타임아웃을 부여합니다.')
    .addUserOption((option) => option.setName('유저').setDescription('대상 유저').setRequired(true))
    .addIntegerOption((option) => option.setName('시간').setDescription('타임아웃 시간(분)').setMinValue(1).setRequired(true))
    .addStringOption((option) => option.setName('이유').setDescription('타임아웃 이유').setRequired(true)),
  new SlashCommandBuilder()
    .setName('제제채널')
    .setDescription('경고 누적 제제 알림 채널을 관리합니다.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('설정')
        .setDescription('제제 알림 채널을 설정합니다.')
        .addChannelOption((option) =>
          option.setName('채널').setDescription('제제 알림을 보낼 텍스트 채널').addChannelTypes(ChannelType.GuildText).setRequired(true)
        )
    )
    .addSubcommand((subcommand) => subcommand.setName('제거').setDescription('제제 알림 채널을 제거합니다.'))
    .addSubcommand((subcommand) => subcommand.setName('조회').setDescription('제제 알림 채널을 조회합니다.')),
  new SlashCommandBuilder().setName('출석').setDescription('오늘 출석하고 연속 출석을 확인합니다.'),
  new SlashCommandBuilder().setName('주간활동').setDescription('이번 주 활동 랭킹을 확인합니다.'),
  new SlashCommandBuilder().setName('잡담채널').setDescription('AI가 대화 주제를 던질 잡담 채널을 설정합니다.')
    .addSubcommand((subcommand) => subcommand.setName('설정').setDescription('잡담 채널을 지정합니다.').addChannelOption((option) => option.setName('채널').setDescription('잡담 채널').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('해제').setDescription('잡담 채널 설정을 해제합니다.'))
    .addSubcommand((subcommand) => subcommand.setName('조회').setDescription('현재 잡담 채널을 확인합니다.')),
  new SlashCommandBuilder().setName('밸런스게임').setDescription('대화가 활발할 때만 밸런스 게임이 올라올 채널을 설정합니다.')
    .addSubcommand((subcommand) => subcommand.setName('채널설정').setDescription('밸런스 게임 채널을 지정합니다.').addChannelOption((option) => option.setName('채널').setDescription('밸런스 게임 채널').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('채널해제').setDescription('밸런스 게임 채널 설정을 해제합니다.'))
    .addSubcommand((subcommand) => subcommand.setName('조회').setDescription('현재 설정된 밸런스 게임 채널을 확인합니다.'))
    .addSubcommand((subcommand) => subcommand.setName('즉시실행').setDescription('지금 바로 밸런스 게임 1개를 전송합니다.')),
  new SlashCommandBuilder()
    .setName('관심사')
    .setDescription('관심사 역할을 설정하거나 선택합니다.')
    .addSubcommand((subcommand) => subcommand.setName('설정').setDescription('관리자가 관심사 역할을 연결합니다.').addStringOption((option) => option.setName('관심사').setDescription('관심사').addChoices(...['베틀그라운드', '발로란트', '마인크래프트', '오버워치', '롤', '로블록스', '에니'].map((name) => ({ name, value: name }))).setRequired(true)).addRoleOption((option) => option.setName('역할').setDescription('연결할 역할').setRequired(true)))
.addSubcommand((subcommand) => subcommand.setName('선택').setDescription('관심사 역할을 선택합니다.').addStringOption((option) => option.setName('관심사').setDescription('관심사').addChoices(...['베틀그라운드', '발로란트', '마인크래프트', '오버워치', '롤', '로블록스', '에니'].map((name) => ({ name, value: name }))).setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('제거').setDescription('관심사 역할을 제거합니다.').addStringOption((option) => option.setName('관심사').setDescription('관심사').addChoices(...['베틀그라운드', '발로란트', '마인크래프트', '오버워치', '롤', '로블록스', '에니'].map((name) => ({ name, value: name }))).setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('목록').setDescription('관심사 역할 목록을 확인합니다.')),
  new SlashCommandBuilder().setName('친구전송').setDescription('친구 요청을 보냅니다.').addUserOption((option) => option.setName('유저').setDescription('친구 요청 대상').setRequired(true)),
  new SlashCommandBuilder().setName('친구삭제').setDescription('친구를 삭제합니다.').addUserOption((option) => option.setName('유저').setDescription('삭제할 친구').setRequired(true)),
  new SlashCommandBuilder().setName('친구받기').setDescription('받은 친구 요청을 수락합니다.').addUserOption((option) => option.setName('유저').setDescription('요청한 유저').setRequired(true)),
  new SlashCommandBuilder().setName('친구목록').setDescription('친구 목록을 확인합니다.'),
  new SlashCommandBuilder().setName('친구추천').setDescription('관심사가 같은 친구를 추천받습니다.'),
  new SlashCommandBuilder().setName('친구알림').setDescription('친구 행동 DM 알림을 설정하거나 해제합니다.').addUserOption((option) => option.setName('유저').setDescription('친구').setRequired(true)).addStringOption((option) => option.setName('행동').setDescription('알림 행동').addChoices({ name: '음성 채널 입장', value: 'voice' }, { name: '게임 시작', value: 'game' }).setRequired(true)).addBooleanOption((option) => option.setName('사용').setDescription('알림 사용 여부(생략하면 켜기)')),
  new SlashCommandBuilder().setName('game').setDescription('친구가 특정 게임을 시작할 때 DM 알림을 설정합니다.').addUserOption((option) => option.setName('유저').setDescription('친구').setRequired(true)).addStringOption((option) => option.setName('게임').setDescription('Discord에 표시되는 정확한 게임 이름').setRequired(true)).addBooleanOption((option) => option.setName('사용').setDescription('알림 사용 여부(생략하면 켜기)')),
  // DISHOUSE — only for community guild (1538513625730383902) via communityCommands
  new SlashCommandBuilder().setName('채널지정').setDescription('DISHOUSE 방과 Discord 채널을 연결합니다.').addStringOption((o) => o.setName('방').setDescription('방 이름').setRequired(true).addChoices(...DISHOUSE_ROOMS)).addChannelOption((o) => o.setName('채널').setDescription('연결할 채널').addChannelTypes(ChannelType.GuildText).setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('채널정보').setDescription('DISHOUSE 방-채널 연결 현황을 표시합니다.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('채널초기화').setDescription('DISHOUSE 방 채널 연결을 해제합니다.').addStringOption((o) => o.setName('방').setDescription('방 이름').setRequired(true).addChoices(...DISHOUSE_ROOMS)).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('후원하기').setDescription('DISHOUSE 후원을 신청합니다.').addIntegerOption((o) => o.setName('금액').setDescription('후원 금액(원)').setMinValue(1000).setRequired(true)).addStringOption((o) => o.setName('입금자명').setDescription('입금자명 (예: 홍길동)').setRequired(true)),
  new SlashCommandBuilder().setName('후원랭킹').setDescription('후원 랭킹 채널을 관리합니다').addSubcommand((s) => s.setName('설정').setDescription('랭킹을 게시할 채널을 설정합니다').addChannelOption((o) => o.setName('채널').setDescription('랭킹 채널').addChannelTypes(ChannelType.GuildText).setRequired(true))).addSubcommand((s) => s.setName('제거').setDescription('랭킹 채널을 제거합니다')).addSubcommand((s) => s.setName('조회').setDescription('현재 랭킹 채널을 조회합니다')).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  // 개인 하우스
  new SlashCommandBuilder().setName('집생성').setDescription('내 개인 하우스를 생성합니다. (자동 채널 생성)'),
  new SlashCommandBuilder().setName('집삭제').setDescription('내 개인 하우스를 삭제합니다.'),
  new SlashCommandBuilder().setName('집정보').setDescription('내/다른 유저의 하우스 정보를 봅니다.').addUserOption((o) => o.setName('유저').setDescription('조회할 유저 (없으면 본인)').setRequired(false)),
  new SlashCommandBuilder().setName('집목록').setDescription('서버의 모든 하우스 목록을 봅니다.'),
  new SlashCommandBuilder().setName('집설정').setDescription('내 집 공개 설정을 변경합니다.').addStringOption((o) => o.setName('공개').setDescription('공개 범위').setRequired(true).addChoices({ name: '비공개 (나만)', value: 'private' }, { name: '초대만 (초대받은 사람만 입장)', value: 'invite_only' }, { name: '공용 (누구나 입장)', value: 'public' })),
  new SlashCommandBuilder().setName('집초대').setDescription('내 집에 유저를 초대합니다.').addUserOption((o) => o.setName('유저').setDescription('초대할 유저').setRequired(true)),
  new SlashCommandBuilder().setName('집초대취소').setDescription('초대를 취소합니다.').addUserOption((o) => o.setName('유저').setDescription('취소할 유저').setRequired(true)),
].map((command) => command.toJSON());

const supportCommandNames = new Set(['랭킹채널', '후원금액']);
const supportCommands = guildCommands.filter((command) => supportCommandNames.has(command.name));
const globalCommandNames = new Set([
  '\uC785\uC7A5\uCC44\uB110',
  '\uC785\uC7A5\uC5ED\uD560',
  '\uD1F4\uC7A5\uCC44\uB110',
  '\uB4F1\uAE09\uC5ED\uD560',
  '\uBCC4\uBA85\uBCC0\uACBD',
  '\uBCC4\uBA85\uC124\uC815',
  '\uACBD\uACE0',
  '\uCD94\uBC29',
  '\uD0C0\uC784\uC544\uC6C3',
  '\uC81C\uC81C\uCC44\uB110',
]);
const globalCommandsToRegister = [
  ...globalCommands,
  ...guildCommands.filter((command) => globalCommandNames.has(command.name)),
];
const communityCommands = [
  ...guildCommands.filter((command) => !supportCommandNames.has(command.name) && !globalCommandNames.has(command.name)),
];

async function main() {
  if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN이 설정되어 있지 않습니다.');
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const application = await rest.get(Routes.oauth2CurrentApplication());
  console.log('[1/3] 전역 커맨드 초기화 중...');
  await rest.put(Routes.applicationCommands(application.id), { body: [] });
  await rest.put(Routes.applicationCommands(application.id), { body: globalCommandsToRegister });
  console.log(`[2/3] 친목서버(${guildId}) 커맨드 ${communityCommands.length}개 등록 중...`);
  await rest.put(Routes.applicationGuildCommands(application.id, guildId), { body: communityCommands });
  console.log('[3/3] 서포트 서버(1525458537139146812) 커맨드 등록 중...');
  await rest.put(Routes.applicationGuildCommands(application.id, '1525458537139146812'), { body: supportCommands });
  console.log(`서포트 서버 커맨드 ${supportCommands.length}개 등록 완료.`);
  console.log('서버별 슬래시 커맨드 배포가 완료되었습니다.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

