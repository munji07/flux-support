"use strict";

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const {
  getConfig,
  setChannel,
  setNoticeChannel,
  clearChannel,
  clearNoticeChannel,
  changeWarningCount,
  getWarningCount,
  setReactionRole,
  deleteReactionRole,
  getReactionRoles,
  getRoles,
  setRole,
  clearRole,
  saveMemberRoles,
  getSavedMemberRoles,
  clearSavedMemberRoles,
  saveIsolatedMember,
  getIsolatedMember,
  clearIsolatedMember,
} = require("../db");
const {
  partitionMembers,
  QUARANTINE_DENIES,
  LOCKABLE_TYPES,
} = require("../lock");

const roles = {
  warning: "1557787949951885464",
  three: "1557773019932532797",
  four: "1557776213848883260",
};
const ROLE_TYPES = {
  baseRole: { column: "base", label: "기본 역할" },
  adminRole: { column: "admin", label: "어드민 역할" },
  botRole: { column: "bot", label: "봇 역할" },
  quarantineRole: { column: "quarantine", label: "격리 역할" },
  superAdminRole: { column: "super_admin", label: "최고 관리자 역할" },
};
const admin = (i, db) => {
  const adminRoleId = db && getRoles(db, i.guildId).admin_role_id;
  return Boolean(adminRoleId && i.member?.roles?.cache?.has(adminRoleId));
};
const deny = (i, text) =>
  i.reply({ content: text, flags: MessageFlags.Ephemeral });

function channelPermissions(channel) {
  const me = channel.guild.members.me;
  if (!me) return false;
  const p = channel.permissionsFor(me);
  return (
    p.has(PermissionFlagsBits.ViewChannel) &&
    p.has(PermissionFlagsBits.SendMessages) &&
    p.has(PermissionFlagsBits.EmbedLinks)
  );
}

async function openSettings(interaction, db) {
  if (!admin(interaction, db))
    return deny(interaction, "이 명령어는 서버 관리자만 사용할 수 있습니다.");
  const menu = new StringSelectMenuBuilder()
    .setCustomId("settings:type")
    .setPlaceholder("설정할 알림 종류를 선택하세요")
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("입장 알림")
        .setValue("welcome")
        .setDescription("입장 알림 채널을 관리합니다."),
      new StringSelectMenuOptionBuilder()
        .setLabel("퇴장 알림")
        .setValue("leave")
        .setDescription("퇴장 알림 채널을 관리합니다."),
      new StringSelectMenuOptionBuilder()
        .setLabel("제재 알림")
        .setValue("punishment")
        .setDescription("제재 알림 채널을 관리합니다."),
      new StringSelectMenuOptionBuilder()
        .setLabel("기본 역할")
        .setValue("baseRole")
        .setDescription("서버 기본 역할을 지정합니다."),
      new StringSelectMenuOptionBuilder()
        .setLabel("어드민 역할")
        .setValue("adminRole")
        .setDescription("잠긴 채널을 항상 볼 수 있는 역할을 지정합니다."),
      new StringSelectMenuOptionBuilder()
        .setLabel("봇 역할")
        .setValue("botRole")
        .setDescription("기본 설정 시 채널을 볼 수 있는 봇 역할을 지정합니다."),
      new StringSelectMenuOptionBuilder()
        .setLabel("격리 역할")
        .setValue("quarantineRole")
        .setDescription("잠금 시 모든 유저에게 부여할 역할을 지정합니다."),
      new StringSelectMenuOptionBuilder()
        .setLabel("격리 채널")
        .setValue("quarantineChannel")
        .setDescription("격리된 사용자만 볼 수 있는 채널을 지정합니다."),
      new StringSelectMenuOptionBuilder()
        .setLabel("최고 관리자 역할")
        .setValue("superAdminRole")
        .setDescription("잠금에서 제외할 역할을 지정합니다."),
    );
  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("서버 설정")
        .setDescription("아래 메뉴에서 설정할 항목을 선택하세요.")
        .setColor(0x5865f2),
    ],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

function showRolePicker(interaction, db, type) {
  const { column, label } = ROLE_TYPES[type];
  const current = getRoles(db, interaction.guildId);
  const currentId = current[`${column}_role_id`];
  const select = new RoleSelectMenuBuilder()
    .setCustomId(`settings:role:${type}`)
    .setPlaceholder(`${label}을 선택하세요`);
  if (currentId) select.setDefaultRoles([currentId]);
  return interaction.update({
    content: `${label}을 선택하세요.`,
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`settings:roleclear:${type}`)
          .setLabel("설정 해제")
          .setStyle(ButtonStyle.Danger),
      ),
    ],
  });
}

async function handleSettingsComponent(interaction, db) {
  if (!admin(interaction, db))
    return interaction.reply({
      content: "서버 관리자만 사용할 수 있습니다.",
      flags: MessageFlags.Ephemeral,
    });
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === "settings:type"
  ) {
    const type = interaction.values[0];
    const labels = { welcome: "입장", leave: "퇴장", punishment: "제재", quarantine: "격리" };
    if (ROLE_TYPES[type]) return showRolePicker(interaction, db, type);
    const select = new ChannelSelectMenuBuilder()
      .setCustomId(`settings:channel:${type}`)
      .setPlaceholder(`${labels[type]} 알림 채널을 선택하세요`)
      .addChannelTypes(ChannelType.GuildText);
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`settings:check:${type}`)
        .setLabel("현재 설정 확인")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`settings:clear:${type}`)
        .setLabel("설정 해제")
        .setStyle(ButtonStyle.Danger),
    );
    return interaction.update({
      content: `${labels[type]} 알림을 설정할 채널을 선택하세요.`,
      components: [new ActionRowBuilder().addComponents(select), buttons],
    });
  }
  const [, action, type] = interaction.customId.split(":");

  if (interaction.customId === "basiclock:cancel") return interaction.update({ content: "기본 권한 설정을 취소했습니다.", components: [] });
  if (interaction.customId === "basiclock:apply") return applyBasicSetup(interaction, db);
  if (action === "cancel") return interaction.update({ content: "잠금을 취소했습니다.", components: [] });
  if (action === "apply") return applyQuarantine(interaction, db);

  if (action === "role" && ROLE_TYPES[type]) {
    const role = interaction.roles.first();
    if (!role || role.managed)
      return deny(interaction, "봇이 해당 역할을 사용할 수 없습니다. 역할 순서를 확인해 주세요.");
    setRole(db, interaction.guildId, ROLE_TYPES[type].column, role.id);
    return interaction.update({
      content: `${ROLE_TYPES[type].label}을 ${role}로 설정했습니다.`,
      components: [],
    });
  }
  if (action === "roleclear" && ROLE_TYPES[type]) {
    clearRole(db, interaction.guildId, ROLE_TYPES[type].column);
    return interaction.update({
      content: `${ROLE_TYPES[type].label} 설정을 해제했습니다.`,
      components: [],
    });
  }

  if (type === "quarantineChannel") {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId("settings:channel:quarantine")
      .setPlaceholder("격리 채널을 선택하세요")
      .addChannelTypes(ChannelType.GuildText);
    return interaction.update({ content: "격리 채널을 선택하세요.", components: [new ActionRowBuilder().addComponents(select)] });
  }
  const labels = { welcome: "입장", leave: "퇴장", punishment: "제재", quarantine: "격리" };
  if (!labels[type]) return;
  if (action === "channel") {
    const channel = interaction.channels.first();
    if (!channel || !channelPermissions(channel))
      return interaction.reply({
        content: "봇이 해당 채널에서 메시지와 Embed를 보낼 수 없습니다.",
        flags: MessageFlags.Ephemeral,
      });
    if (type === "welcome") {
      const old = getConfig(db, interaction.guildId);
      setChannel(db, {
        guildId: interaction.guildId,
        channelId: channel.id,
        baseline:
          !old || old.baseline == null ? interaction.guild.memberCount : 0,
      });
    } else setNoticeChannel(db, interaction.guildId, type, channel.id);
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle(`${labels[type]} 알림 채널 설정 완료`).setDescription(`알림 채널: <#${channel.id}>`).setColor(0x57f287).setTimestamp()],
      content: '',
      components: [],
    });
  }
  const row = getConfig(db, interaction.guildId);
  if (action === "clear") {
    type === "welcome"
      ? clearChannel(db, interaction.guildId)
      : clearNoticeChannel(db, interaction.guildId, type);
    return interaction.update({
      content: `${labels[type]} 알림 채널 설정을 해제했습니다.`,
      components: [],
    });
  }
  const ids = {
    welcome: row?.channel_id,
    leave: row?.leave_channel_id,
    punishment: row?.punishment_channel_id,
  };
  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setTitle(`${labels[type]} 알림 채널 확인`)
      .setDescription(ids[type] ? `현재 채널: <#${ids[type]}>` : `${labels[type]} 알림 채널이 설정되지 않았습니다.`)
      .setColor(0x5865f2)],
    flags: MessageFlags.Ephemeral,
  });
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function resolveQuarantineRole(interaction, db) {
  const { quarantine_role_id } = getRoles(db, interaction.guildId);
  if (!quarantine_role_id)
    return { error: "/설정에서 격리 역할을 먼저 지정해 주세요." };
  const role = interaction.guild.roles.cache.get(quarantine_role_id);
  if (!role)
    return { error: "지정한 격리 역할이 서버에서 삭제되었습니다. /설정에서 다시 지정해 주세요." };
  if (role.managed)
    return { error: "격리 역할은 관리 역할(봇 권한 연동 등)을 사용할 수 없습니다." };
  if (role.position >= interaction.guild.members.me?.roles.highest.position)
    return { error: "격리 역할의 높이가 봇 역할보다 높거나 같습니다. 역할 순서를 낮춰 주세요." };
  return { role };
}

async function fetchMembers(guild) {
  try {
    return [...(await guild.members.fetch()).values()];
  } catch {
    return [...(guild.members?.cache?.values() ?? [])];
  }
}

async function applyQuarantine(interaction, db) {
  if (!admin(interaction, db))
    return deny(interaction, "이 명령어는 서버 관리자만 사용할 수 있습니다.");

  const resolved = resolveQuarantineRole(interaction, db);
  if (resolved.error) return deny(interaction, resolved.error);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  const quarantineRole = resolved.role;
  const configuredRoles = getRoles(db, guild.id);
  const baseRole = configuredRoles.base_role_id
    ? guild.roles.cache.get(configuredRoles.base_role_id)
    : null;
  const superAdminRole = configuredRoles.super_admin_role_id
    ? guild.roles.cache.get(configuredRoles.super_admin_role_id)
    : null;
  const botRole = configuredRoles.bot_role_id
    ? guild.roles.cache.get(configuredRoles.bot_role_id)
    : null;
  const quarantineConfig = getConfig(db, guild.id);
  const quarantineChannelId = quarantineConfig?.quarantine_channel_id;
  if (!baseRole)
    return interaction.editReply("/설정에서 기본 역할을 먼저 지정해 주세요.");
  const members = await fetchMembers(guild);
  const superAdminRoleId = getRoles(db, guild.id).super_admin_role_id;
  const { target, skipped } = partitionMembers(
    members.filter((member) => !member.user?.bot && !member.roles.cache.has(superAdminRoleId)),
  );

  if (!target.length)
    return interaction.editReply({
      content: "격리할 수 있는 멤버가 없습니다. 봇보다 높은 역할의 멤버만 있는 경우입니다.",
    });

  saveMemberRoles(
    db,
    guild.id,
    new Map(members.map((m) => [m.id, m.roles.cache.map((r) => r.id)])),
  );

  let quarantined = 0;
  const roleFailed = [];
  for (const member of target) {
    try {
      await member.roles.set([quarantineRole.id], "전체 잠금");
      quarantined += 1;
    } catch (error) {
      roleFailed.push(`${member.user.username} (${error.message})`);
    }
  }

  let disconnected = 0;
  for (const channel of guild.channels.cache.values()) {
    if (![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type))
      continue;
    try {
      await channel.permissionOverwrites.edit(
        quarantineRole,
        { ViewChannel: true, ...QUARANTINE_DENIES },
        { reason: "전체 잠금: 음성 차단" },
      );
      for (const member of channel.members) {
        await member.voice.disconnect("전체 잠금").catch(() => {});
        disconnected += 1;
      }
    } catch (error) {
      roleFailed.push(`${channel} (${error.message})`);
    }
  }

  let blocked = 0;
  for (const channel of guild.channels.cache.values()) {
    if (!LOCKABLE_TYPES.has(channel.type)) continue;
    try {
      await channel.permissionOverwrites.edit(
        guild.roles.everyone,
        { ViewChannel: false },
        { reason: "완전잠금: @everyone 보기 차단" },
      );
      await channel.permissionOverwrites.edit(
        baseRole,
        { ViewChannel: true },
        { reason: "완전잠금: 기본 역할 보기 허용" },
      );
      if (superAdminRole)
        await channel.permissionOverwrites.edit(
          superAdminRole,
          { ViewChannel: true },
          { reason: "완전잠금: 최고 관리자 역할 우회" },
        );
      if (botRole)
        await channel.permissionOverwrites.edit(
          botRole,
          { ViewChannel: true },
          { reason: "완전잠금: 봇 역할 보기 허용" },
        );
      if (guild.members.me)
        await channel.permissionOverwrites.edit(
          guild.members.me,
          { ViewChannel: true },
          { reason: "완전잠금: 봇 계정 보기 허용" },
        );
      await channel.permissionOverwrites.edit(
        quarantineRole,
        {
          ViewChannel: channel.id === quarantineChannelId,
          ...QUARANTINE_DENIES,
        },
        { reason: "전체 잠금: 채널 차단" },
      );
      blocked += 1;
    } catch (error) {
      roleFailed.push(`${channel} (${error.message})`);
    }
  }

  return interaction.editReply({
    content: [
      `잠금 완료: ${quarantined}/${target.length}명 격리, ${blocked}개 채널 차단, 음성 퇴장 ${disconnected}명`,
      skipped.length ? `건너뜀 ${skipped.length}명 (봇보다 높은 역할)` : null,
      roleFailed.length ? `실패 ${roleFailed.length}건\n${chunk(roleFailed, 10).join("\n")}` : null,
      `/잠금해제 로 역할과 권한을 되돌릴 수 있습니다.`,
    ]
      .filter((line) => line !== null)
      .join("\n"),
  });
}

async function basicSetup(interaction, db) {
  if (!admin(interaction, db)) return deny(interaction, "이 명령어는 서버 관리자만 사용할 수 있습니다.");
  const configured = getRoles(db, interaction.guildId);
  const baseRole = configured.base_role_id && interaction.guild.roles.cache.get(configured.base_role_id);
  if (!baseRole) return deny(interaction, "/설정에서 기본 역할을 먼저 지정해 주세요.");
  const allowedOverwriteIds = new Set([
    interaction.guild.id,
    configured.base_role_id,
    configured.admin_role_id,
    configured.super_admin_role_id,
    configured.bot_role_id,
    configured.quarantine_role_id,
    interaction.client.user.id,
  ].filter(Boolean));
  const channels = [...interaction.guild.channels.cache.values()].filter((channel) => LOCKABLE_TYPES.has(channel.type) && !isCustomizedChannel(channel, allowedOverwriteIds));
  const skipped = [...interaction.guild.channels.cache.values()].filter((channel) => LOCKABLE_TYPES.has(channel.type) && isCustomizedChannel(channel, allowedOverwriteIds));
  return interaction.reply({
    embeds: [new EmbedBuilder().setTitle("기본 권한 설정 미리보기").setColor(0xed4245).setDescription([
      `대상 채널: ${channels.length}개`,
      skipped.length ? `기존 권한 보존: ${skipped.length}개 채널` : null,
      "@everyone의 채널 보기를 차단합니다.",
      `기본 역할 ${baseRole}은 모든 채널을 볼 수 있습니다.`,
      "적용을 누르면 카테고리와 하위 채널에도 권한을 적용합니다.",
    ].join("\n"))],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("basiclock:apply").setLabel("적용").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("basiclock:cancel").setLabel("취소").setStyle(ButtonStyle.Secondary),
    )],
    flags: MessageFlags.Ephemeral,
  });
}

async function applyBasicSetup(interaction, db) {
  if (!admin(interaction, db)) return interaction.reply({ content: "지정된 어드민 역할만 사용할 수 있습니다.", flags: MessageFlags.Ephemeral });
  const configured = getRoles(db, interaction.guildId);
  const baseRole = configured.base_role_id && interaction.guild.roles.cache.get(configured.base_role_id);
  if (!baseRole) return interaction.update({ content: "/설정에서 기본 역할을 먼저 지정해 주세요.", components: [] });
  await interaction.update({
    content: "적용 중입니다.",
    embeds: [],
    components: [],
  });
  const everyone = interaction.guild.roles.everyone;
  const superRole = configured.super_admin_role_id && interaction.guild.roles.cache.get(configured.super_admin_role_id);
  const botRole = configured.bot_role_id && interaction.guild.roles.cache.get(configured.bot_role_id);
  const allowedOverwriteIds = new Set([
    interaction.guild.id,
    configured.base_role_id,
    configured.admin_role_id,
    configured.super_admin_role_id,
    configured.bot_role_id,
    configured.quarantine_role_id,
    interaction.client.user.id,
  ].filter(Boolean));
  const channels = [...interaction.guild.channels.cache.values()].filter((channel) => LOCKABLE_TYPES.has(channel.type) && !isCustomizedChannel(channel, allowedOverwriteIds));
  let applied = 0;
  const failed = [];
  for (const channel of channels) {
    try {
      await channel.permissionOverwrites.edit(everyone, { ViewChannel: false }, { reason: "기본설정: @everyone 보기 차단" });
      await channel.permissionOverwrites.edit(baseRole, { ViewChannel: true }, { reason: "기본설정: 기본 역할 보기 허용" });
      if (superRole) await channel.permissionOverwrites.edit(superRole, { ViewChannel: true }, { reason: "기본설정: 최고 관리자 우회" });
      if (botRole) await channel.permissionOverwrites.edit(botRole, { ViewChannel: true }, { reason: "기본설정: 봇 역할 허용" });
      if (interaction.guild.members.me) await channel.permissionOverwrites.edit(interaction.guild.members.me, { ViewChannel: true }, { reason: "기본설정: 봇 계정 허용" });
      applied += 1;
    } catch (error) { failed.push(`${channel.name}: ${error.message}`); }
  }
  return interaction.editReply({ content: `기본 권한 설정이 완료되었습니다. ${applied}개 채널 적용${failed.length ? `\n실패 ${failed.length}건` : ""}`, components: [] });
}

function isCustomizedChannel(channel, allowedOverwriteIds) {
  return [...channel.permissionOverwrites.cache.values()].some((overwrite) => !allowedOverwriteIds.has(overwrite.id));
}

async function applyLock(interaction, db) {
  if (!admin(interaction, db))
    return deny(interaction, "이 명령어는 서버 관리자만 사용할 수 있습니다.");

  const resolved = resolveQuarantineRole(interaction, db);
  if (resolved.error) return deny(interaction, resolved.error);

  const members = await fetchMembers(interaction.guild);
  const { target, skipped } = partitionMembers(
    members.filter((member) => !member.user?.bot),
  );
  const channels = Array.from(interaction.guild.channels.cache.values()).filter(
    (channel) => LOCKABLE_TYPES.has(channel.type),
  );

  if (!target.length)
    return interaction.update({
      content: "격리할 수 있는 멤버가 없습니다.",
      components: [],
    });

  return interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle("전체 잠금 미리보기")
        .setColor(0xed4245)
        .setDescription(
          [
            `대상 멤버: ${target.length}명`,
            skipped.length ? `건너뜀: ${skipped.length}명 (봇보다 높은 역할·서버 소유자)` : null,
            `대상 채널: ${channels.length}개`,
            "",
            `적용하면 전원의 역할을 ${resolved.role} 로 교체하고,`,
            "모든 채널에서 메시지·반응·음성 입장과 대화를 차단합니다.",
            "진행 중인 음성 통화는 즉시 종료됩니다.",
            "",
            "/잠금해제 로 원래 역할로 되돌릴 수 있습니다.",
          ]
            .filter((line) => line !== null)
            .join("\n"),
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("lock:apply")
          .setLabel("적용")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("lock:cancel")
          .setLabel("취소")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

async function unlockAll(interaction, db) {
  if (!admin(interaction, db))
    return deny(interaction, "이 명령어는 서버 관리자만 사용할 수 있습니다.");

  const saved = getSavedMemberRoles(db, interaction.guildId);
  if (!saved.length) return deny(interaction, "잠긴 기록이 없습니다.");

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  const { quarantine_role_id } = getRoles(db, interaction.guildId);
  const quarantineRole = quarantine_role_id
    ? guild.roles.cache.get(quarantine_role_id)
    : null;
  const configuredRoles = getRoles(db, guild.id);
  const baseRole = configuredRoles.base_role_id
    ? guild.roles.cache.get(configuredRoles.base_role_id)
    : null;
  const superAdminRole = configuredRoles.super_admin_role_id
    ? guild.roles.cache.get(configuredRoles.super_admin_role_id)
    : null;

  let restored = 0;
  const roleFailed = [];
  for (const { user_id, role_ids } of saved) {
    const member = await guild.members.fetch(user_id).catch(() => null);
    if (!member) {
      roleFailed.push(`${user_id} (멤버를 찾을 수 없음)`);
      continue;
    }
    const roles = role_ids.filter((id) => {
      const role = guild.roles.cache.get(id);
      return role && !role.managed;
    });
    if (member.manageable === false) {
      roleFailed.push(`${member.user?.username ?? user_id} (권한 높이 부족)`);
      continue;
    }
    try {
      await member.roles.set(roles, "잠금 해제");
      restored += 1;
    } catch (error) {
      roleFailed.push(`${member.user?.username ?? user_id} (${error.message})`);
    }
  }

  if (quarantineRole) {
    for (const channel of guild.channels.cache.values()) {
      if (!LOCKABLE_TYPES.has(channel.type)) continue;
      try {
        await channel.permissionOverwrites.edit(
          guild.roles.everyone,
          { ViewChannel: null },
          { reason: "잠금 해제: @everyone 보기 복구" },
        );
        if (baseRole)
          await channel.permissionOverwrites.edit(
            baseRole,
            { ViewChannel: null },
            { reason: "잠금 해제: 기본 역할 권한 복구" },
          );
        if (superAdminRole)
          await channel.permissionOverwrites.edit(
            superAdminRole,
            { ViewChannel: null },
            { reason: "잠금 해제: 최고 관리자 권한 복구" },
          );
        await channel.permissionOverwrites.edit(
          quarantineRole,
          { ViewChannel: null, ...QUARANTINE_DENIES },
          { reason: "잠금 해제: 차단 해제" },
        );
      } catch (error) {
        roleFailed.push(`${channel} (${error.message})`);
      }
    }
  }

  if (!roleFailed.length) clearSavedMemberRoles(db, guild.id);

  return interaction.editReply({
    content: [
      `잠금 해제: ${restored}/${saved.length}명 역할 복원`,
      roleFailed.length
        ? `실패 ${roleFailed.length}건\n${chunk(roleFailed, 10).join("\n")}`
        : null,
      roleFailed.length ? null : "모든 채널의 차단도 해제했습니다.",
      roleFailed.length ? "기록을 유지했습니다. 다시 실행해 주세요." : null,
    ]
      .filter((line) => line !== null)
      .join("\n"),
  });
}

async function chatLock(interaction, db) {
  if (!admin(interaction, db)) return deny(interaction, "이 명령어는 서버 관리자만 사용할 수 있습니다.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const everyone = interaction.guild.roles.everyone;
  const superAdminRoleId = getRoles(db, interaction.guildId).super_admin_role_id;
  const superAdminRole = superAdminRoleId ? interaction.guild.roles.cache.get(superAdminRoleId) : null;
  let locked = 0;
  const failures = [];
  for (const channel of interaction.guild.channels.cache.values()) {
    if (!LOCKABLE_TYPES.has(channel.type)) continue;
    try {
      await channel.permissionOverwrites.edit(everyone, { SendMessages: false, SendMessagesInThreads: false, AddReactions: false }, { reason: "채팅 잠금" });
      if (superAdminRole) await channel.permissionOverwrites.edit(superAdminRole, { SendMessages: true, SendMessagesInThreads: true, AddReactions: true }, { reason: "최고 관리자 채팅 잠금 우회" });
      locked += 1;
    } catch (error) { failures.push(`${channel.name}: ${error.message}`); }
  }
  return interaction.editReply(`채팅 잠금 완료: ${locked}개 채널${failures.length ? `\n실패 ${failures.length}건` : ""}`);
}

async function chatUnlock(interaction, db) {
  if (!admin(interaction, db)) return deny(interaction, "이 명령어는 서버 관리자만 사용할 수 있습니다.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const everyone = interaction.guild.roles.everyone;
  const superAdminRoleId = getRoles(db, interaction.guildId).super_admin_role_id;
  const superAdminRole = superAdminRoleId ? interaction.guild.roles.cache.get(superAdminRoleId) : null;
  let restored = 0;
  for (const channel of interaction.guild.channels.cache.values()) {
    if (!LOCKABLE_TYPES.has(channel.type)) continue;
    await channel.permissionOverwrites.edit(everyone, { SendMessages: null, SendMessagesInThreads: null, AddReactions: null }, { reason: "채팅 잠금 해제" }).catch(() => null);
    if (superAdminRole) await channel.permissionOverwrites.edit(superAdminRole, { SendMessages: null, SendMessagesInThreads: null, AddReactions: null }, { reason: "채팅 잠금 해제" }).catch(() => null);
    restored += 1;
  }
  return interaction.editReply(`채팅 잠금 해제 완료: ${restored}개 채널`);
}

async function help(interaction) {
  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("수아 두목 서버 봇 도움말")
        .setColor(0x5865f2)
        .addFields(
          { name: "일반", value: "/도움말\n/반응역할확인" },
          { name: "서버 관리", value: "/설정\n/기본설정\n/완전잠금\n/잠금해제\n/채팅잠금\n/채팅잠금해제" },
          { name: "격리 관리", value: "/격리 유저:@사용자\n/격리해제 유저:@사용자" },
          { name: "경고 관리", value: "/경고 처리:추가 유저:@사용자 사유:사유\n/경고 처리:제거 유저:@사용자\n/경고 처리:확인 유저:@사용자" },
          { name: "반응 역할 관리", value: "/반응역할설정\n/반응역할해제\n/반응역할확인" },
        )
        .setFooter({ text: "관리 명령어는 지정된 어드민 역할이 필요합니다." })
        .setTimestamp(),
    ],
  });
}

async function isolateMember(interaction, db) {
  if (!admin(interaction, db)) return deny(interaction, "이 명령어는 서버 관리자만 사용할 수 있습니다.");
  const target = await interaction.guild.members.fetch(interaction.options.getUser("유저", true).id).catch(() => null);
  if (!target || target.user.bot) return deny(interaction, "격리할 수 없는 사용자입니다.");
  const resolved = resolveQuarantineRole(interaction, db);
  if (resolved.error) return deny(interaction, resolved.error);
  const config = getConfig(db, interaction.guildId);
  const quarantineChannel = config?.quarantine_channel_id
    ? await interaction.guild.channels.fetch(config.quarantine_channel_id).catch(() => null)
    : null;
  if (!quarantineChannel || quarantineChannel.type !== ChannelType.GuildText)
    return deny(interaction, "/설정에서 격리 채널을 먼저 지정해 주세요.");
  if (!target.manageable) return deny(interaction, "봇보다 높은 역할의 사용자는 격리할 수 없습니다.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  saveIsolatedMember(db, interaction.guildId, target.id, target.roles.cache.filter((role) => role.id !== interaction.guildId).map((role) => role.id));
  const failures = [];
  try { await target.roles.set([resolved.role.id], "개별 격리"); } catch (error) { failures.push(`역할 변경 실패: ${error.message}`); }
  for (const channel of interaction.guild.channels.cache.values()) {
    if (!LOCKABLE_TYPES.has(channel.type)) continue;
    try {
      await channel.permissionOverwrites.edit(target, { ViewChannel: channel.id === quarantineChannel.id }, { reason: "개별 격리" });
    } catch (error) { failures.push(`${channel.name}: ${error.message}`); }
  }
  return interaction.editReply(`격리 완료: ${target}\n격리 채널: <#${quarantineChannel.id}>${failures.length ? `\n실패 ${failures.length}건` : ""}`);
}

async function releaseMember(interaction, db) {
  if (!admin(interaction, db)) return deny(interaction, "이 명령어는 서버 관리자만 사용할 수 있습니다.");
  const user = interaction.options.getUser("유저", true);
  const saved = getIsolatedMember(db, interaction.guildId, user.id);
  if (!saved) return deny(interaction, "해당 사용자의 격리 기록이 없습니다.");
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return deny(interaction, "해당 사용자가 서버에 없습니다.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const failures = [];
  try { await member.roles.set(saved.role_ids.filter((id) => interaction.guild.roles.cache.has(id)), "격리 해제"); } catch (error) { failures.push(`역할 복구 실패: ${error.message}`); }
  for (const channel of interaction.guild.channels.cache.values()) {
    if (!LOCKABLE_TYPES.has(channel.type)) continue;
    await channel.permissionOverwrites.edit(member, { ViewChannel: null }, { reason: "격리 해제" }).catch((error) => failures.push(`${channel.name}: ${error.message}`));
  }
  clearIsolatedMember(db, interaction.guildId, user.id);
  return interaction.editReply(`격리 해제 완료: ${member}${failures.length ? `\n실패 ${failures.length}건` : ""}`);
}

async function warning(interaction, db) {
  if (!admin(interaction, db))
    return deny(interaction, "이 명령어는 서버 관리자만 사용할 수 있습니다.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const action = interaction.options.getString("처리", true);
  const user = interaction.options.getUser("유저", true);
  const reason = interaction.options.getString("사유") || "사유 미입력";
  const current = getWarningCount(db, interaction.guildId, user.id);
  if (action === "확인") {
    const roleText =
      current >= 4
        ? `<@&${roles.four}>`
        : current >= 3
          ? `<@&${roles.three}>`
          : current >= 1
            ? `<@&${roles.warning}>`
            : "없음";
    return interaction.editReply({
      content: `<@${user.id}>님의 현재 경고는 ${current}회입니다.\n적용 역할: ${roleText}`,
      allowedMentions: { parse: [] },
    });
  }
  const count = changeWarningCount(
    db,
    interaction.guildId,
    user.id,
    action === "추가" ? 1 : -1,
    reason,
  );
  const member = await interaction.guild.members.fetch(user.id);
  const target =
    count >= 4
      ? roles.four
      : count >= 3
        ? roles.three
        : count >= 1
          ? roles.warning
          : null;
  for (const id of Object.values(roles)) {
    if (id !== target) await member.roles.remove(id).catch(() => {});
  }
  if (target) await member.roles.add(target).catch(() => {});
  const config = getConfig(db, interaction.guildId);
  if (config?.punishment_channel_id) {
    const channel = await interaction.guild.channels
      .fetch(config.punishment_channel_id)
      .catch(() => null);
    if (channel?.type === ChannelType.GuildText)
      await channel
        .send({
          embeds: [
            new EmbedBuilder()
              .setTitle(action === "추가" ? "제재 경고 추가" : "제재 경고 제거")
              .setColor(0xed4245)
              .addFields(
                { name: "대상", value: `<@${user.id}>` },
                { name: "현재 경고", value: `${count}회` },
                { name: "사유", value: reason },
              )
              .setTimestamp(),
          ],
          allowedMentions: { parse: [] },
        })
        .catch(() => {});
  }
  return interaction.editReply({
    content: `<@${user.id}>님의 경고가 ${action}되었습니다. 현재 ${count}회입니다.\n사유: ${reason}`,
    allowedMentions: { parse: [] },
  });
}

function normalizeEmoji(value) {
  const custom = value.match(/^<a?:([^:>]+):(\d+)>$/);
  return custom ? `${custom[1]}:${custom[2]}` : value;
}

async function reactionRoleSet(interaction, db) {
  if (!admin(interaction, db))
    return deny(interaction, "이 명령어는 서버 관리자만 사용할 수 있습니다.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const messageId = interaction.options.getString("메시지id", true);
  const emoji = normalizeEmoji(interaction.options.getString("이모지", true));
  const role = interaction.options.getRole("역할", true);
  const channel = interaction.channel;
  const message = await channel?.messages.fetch(messageId).catch(() => null);
  if (!message)
    return interaction.editReply("현재 채널에서 해당 메시지를 찾을 수 없습니다. 메시지 ID와 채널을 확인해 주세요.");
  if (!role.editable)
    return interaction.editReply("봇이 해당 역할을 관리할 수 없습니다. 역할 순서를 확인해 주세요.");
  setReactionRole(db, interaction.guildId, messageId, emoji, role.id);
  return interaction.editReply({
    content: `${message}에 ${emoji} 반응 역할을 ${role}로 설정했습니다.`,
  });
}

async function reactionRoleDelete(interaction, db) {
  if (!admin(interaction, db))
    return deny(interaction, "이 명령어는 서버 관리자만 사용할 수 있습니다.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const messageId = interaction.options.getString("메시지id", true);
  const emoji = normalizeEmoji(interaction.options.getString("이모지", true));
  const result = deleteReactionRole(db, interaction.guildId, messageId, emoji);
  return interaction.editReply(
    result.changes
      ? "반응 역할 설정을 해제했습니다."
      : "해당 반응 역할 설정을 찾지 못했습니다.",
  );
}

async function reactionRoleCheck(interaction, db) {
  if (!admin(interaction, db))
    return deny(interaction, "이 명령어는 서버 관리자만 사용할 수 있습니다.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rows = getReactionRoles(
    db,
    interaction.guildId,
    interaction.options.getString("메시지id", true),
  );
  return interaction.editReply(
    rows.length
      ? rows.map((row) => `${row.emoji} → <@&${row.role_id}>`).join("\n")
      : "설정된 반응 역할이 없습니다.",
  );
}

const settingsBuilder = new SlashCommandBuilder()
  .setName("설정")
  .setDescription("알림 설정 메뉴를 엽니다.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
const helpBuilder = new SlashCommandBuilder()
  .setName("도움말")
  .setDescription("사용 가능한 명령어를 확인합니다.");
const lockBuilder = new SlashCommandBuilder()
  .setName("완전잠금")
  .setDescription("모든 멤버를 격리 역할로 교체해 채팅·음성을 차단합니다.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
const basicSetupBuilder = new SlashCommandBuilder()
  .setName("기본설정")
  .setDescription("@everyone의 채널 보기를 차단하고 기본 역할만 허용합니다.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
const chatLockBuilder = new SlashCommandBuilder()
  .setName("채팅잠금")
  .setDescription("모든 채널의 채팅과 반응을 잠급니다.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
const chatUnlockBuilder = new SlashCommandBuilder()
  .setName("채팅잠금해제")
  .setDescription("모든 채널의 채팅 잠금을 해제합니다.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
const unlockBuilder = new SlashCommandBuilder()
  .setName("잠금해제")
  .setDescription("잠금 전 역할과 채널 권한을 되돌립니다.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
const isolateBuilder = new SlashCommandBuilder()
  .setName("격리")
  .setDescription("사용자를 격리 채널만 볼 수 있게 합니다.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((o) => o.setName("유저").setDescription("격리할 사용자").setRequired(true));
const releaseBuilder = new SlashCommandBuilder()
  .setName("격리해제")
  .setDescription("사용자의 격리를 해제하고 기존 역할을 복구합니다.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((o) => o.setName("유저").setDescription("격리 해제할 사용자").setRequired(true));
const warningBuilder = new SlashCommandBuilder()
  .setName("경고")
  .setDescription("사용자 경고를 관리합니다.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) =>
    o
      .setName("처리")
      .setDescription("경고 처리 방법")
      .setRequired(true)
      .addChoices(
        { name: "추가", value: "추가" },
        { name: "제거", value: "제거" },
        { name: "확인", value: "확인" },
      ),
  )
  .addUserOption((o) =>
    o.setName("유저").setDescription("대상 사용자").setRequired(true),
  );
warningBuilder.addStringOption((o) =>
  o.setName("사유").setDescription("경고 사유").setMaxLength(200),
);

const reactionSetBuilder = new SlashCommandBuilder()
  .setName("반응역할설정")
  .setDescription("메시지 반응에 역할을 연결합니다.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) =>
    o.setName("메시지id").setDescription("대상 메시지 ID").setRequired(true),
  )
  .addStringOption((o) =>
    o
      .setName("이모지")
      .setDescription("예: ✅ 또는 <:이름:ID>")
      .setRequired(true),
  )
  .addRoleOption((o) =>
    o.setName("역할").setDescription("지급할 역할").setRequired(true),
  );
const reactionDeleteBuilder = new SlashCommandBuilder()
  .setName("반응역할해제")
  .setDescription("메시지 반응 역할을 해제합니다.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) =>
    o.setName("메시지id").setDescription("대상 메시지 ID").setRequired(true),
  )
  .addStringOption((o) =>
    o.setName("이모지").setDescription("이모지").setRequired(true),
  );
const reactionCheckBuilder = new SlashCommandBuilder()
  .setName("반응역할확인")
  .setDescription("메시지 반응 역할을 확인합니다.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) =>
    o.setName("메시지id").setDescription("대상 메시지 ID").setRequired(true),
  );

module.exports = {
  commands: new Map([
    ["설정", { data: settingsBuilder, execute: openSettings }],
    ["도움말", { data: helpBuilder, execute: help }],
    ["완전잠금", { data: lockBuilder, execute: applyQuarantine }],
    ["기본설정", { data: basicSetupBuilder, execute: basicSetup }],
    ["채팅잠금", { data: chatLockBuilder, execute: chatLock }],
    ["채팅잠금해제", { data: chatUnlockBuilder, execute: chatUnlock }],
    ["잠금해제", { data: unlockBuilder, execute: unlockAll }],
    ["격리", { data: isolateBuilder, execute: isolateMember }],
    ["격리해제", { data: releaseBuilder, execute: releaseMember }],
    ["경고", { data: warningBuilder, execute: warning }],
    ["반응역할설정", { data: reactionSetBuilder, execute: reactionRoleSet }],
    [
      "반응역할해제",
      { data: reactionDeleteBuilder, execute: reactionRoleDelete },
    ],
    [
      "반응역할확인",
      { data: reactionCheckBuilder, execute: reactionRoleCheck },
    ],
  ]),
  execute: {
    설정: openSettings,
    도움말: help,
    완전잠금: applyQuarantine,
    기본설정: basicSetup,
    채팅잠금: chatLock,
    채팅잠금해제: chatUnlock,
    잠금해제: unlockAll,
    격리: isolateMember,
    격리해제: releaseMember,
    경고: warning,
    반응역할설정: reactionRoleSet,
    반응역할해제: reactionRoleDelete,
    반응역할확인: reactionRoleCheck,
  },
  handleSettingsComponent,
};
