"use strict";

const { ChannelType, PermissionFlagsBits } = require("discord.js");

const LOCKABLE_TYPES = new Set([
  ChannelType.GuildCategory,
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.PublicThread,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
]);

const QUARANTINE_DENIES = {
  SendMessages: false,
  SendMessagesInThreads: false,
  CreatePublicThreads: false,
  CreatePrivateThreads: false,
  AddReactions: false,
  Connect: false,
  Speak: false,
  Stream: false,
};

function everyoneSees(channel, everyoneRole) {
  if (typeof channel.permissionsFor !== "function") return false;
  const permissions = channel.permissionsFor(everyoneRole);
  return Boolean(permissions?.has(PermissionFlagsBits.ViewChannel));
}

function selectLockTargets({ channels, everyoneRole }) {
  return Array.from(channels).filter(
    (channel) =>
      LOCKABLE_TYPES.has(channel.type) && everyoneSees(channel, everyoneRole),
  );
}

function partitionMembers(members) {
  const target = [];
  const skipped = [];
  for (const member of Array.from(members || [])) {
    if (member?.manageable) target.push(member);
    else skipped.push(member);
  }
  return { target, skipped };
}

module.exports = {
  selectLockTargets,
  partitionMembers,
  QUARANTINE_DENIES,
  LOCKABLE_TYPES,
};
