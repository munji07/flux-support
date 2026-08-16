const { REST, Routes, SlashCommandBuilder, ChannelType } = require('discord.js');
require('dotenv').config({ path: '.env' });

const guildId = '1525458537139146812';

const globalCommands = [
  new SlashCommandBuilder()
    .setName('입장채널')
    .setDescription('입장 로깅 채널을 전역으로 설정합니다.')
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
    .setName('등급역할')
    .setDescription('모든 유저의 등급에 맞춰 역할을 부여합니다.'),
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
].map((command) => command.toJSON());

async function main() {
  if (!process.env.DISCORD_TOKEN) {
    throw new Error('DISCORD_TOKEN이 설정되어 있지 않습니다.');
  }

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const application = await rest.get(Routes.oauth2CurrentApplication());
  const clientId = application.id;

  await rest.put(Routes.applicationCommands(clientId), { body: globalCommands });
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: guildCommands });
  console.log('슬래시 커맨드 배포가 완료되었습니다.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
