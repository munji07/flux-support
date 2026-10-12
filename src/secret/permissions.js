"use strict";

const { PermissionFlagsBits } = require("discord.js");

const PERMISSION_LABELS = {
  ViewChannel: "채널 보기",
  SendMessages: "메시지 보내기",
  SendMessagesInThreads: "스레드 메시지 보내기",
  EmbedLinks: "임베드 링크",
  ReadMessageHistory: "메시지 기록 읽기",
  AddReactions: "반응 추가",
  UseApplicationCommands: "슬래시 명령 사용",
  ManageRoles: "역할 관리",
  ManageChannels: "채널 관리",
};

const REQUIRED_PERMISSIONS = Object.keys(PERMISSION_LABELS).map(
  (name) => PermissionFlagsBits[name],
);

function findMissingPermissions(permissions) {
  if (!permissions?.missing) return [...REQUIRED_PERMISSIONS];
  return permissions
    .missing(REQUIRED_PERMISSIONS)
    .map((name) => PERMISSION_LABELS[name] ?? name);
}

module.exports = {
  REQUIRED_PERMISSIONS,
  PERMISSION_LABELS,
  findMissingPermissions,
};
