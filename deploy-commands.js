const { REST, Routes, SlashCommandBuilder, ChannelType } = require('discord.js');
require('dotenv').config({ path: '.env' });

const guildId = '1538513625730383902';

const globalCommands = [
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
  new SlashCommandBuilder().setName('밸런스게임').setDescription('10~30분마다 무작위 밸런스 게임이 올라올 채널을 설정합니다.')
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
].map((command) => command.toJSON());

const supportCommandNames = new Set(['랭킹채널', '후원금액']);
const supportCommands = guildCommands.filter((command) => supportCommandNames.has(command.name));
const communityCommands = [
  ...globalCommands,
  ...guildCommands.filter((command) => !supportCommandNames.has(command.name)),
];

async function main() {
  if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN이 설정되어 있지 않습니다.');
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const application = await rest.get(Routes.oauth2CurrentApplication());
  console.log('[1/3] 전역 커맨드 초기화 중...');
  await rest.put(Routes.applicationCommands(application.id), { body: [] });
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

