"use strict";

const { getReactionRole } = require("./db");

function emojiKey(emoji) {
  return emoji.id ? `${emoji.name}:${emoji.id}` : emoji.name;
}

async function updateRole(reaction, user, db, add) {
  if (user.bot || !reaction.guild) return;
  const mapping = getReactionRole(
    db,
    reaction.guild.id,
    reaction.message.id,
    emojiKey(reaction.emoji),
  );
  if (!mapping) return;
  const member = await reaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return;
  const role = reaction.guild.roles.cache.get(mapping.role_id);
  if (!role || !role.editable) {
    console.error(
      `[reaction-role] 역할을 관리할 수 없습니다 guild=${reaction.guild.id} role=${mapping.role_id}`,
    );
    return;
  }
  await (add ? member.roles.add(role) : member.roles.remove(role)).catch(
    (error) => {
      console.error(
        `[reaction-role] 역할 변경 실패 guild=${reaction.guild.id} user=${user.id} error=${error.message}`,
      );
    },
  );
}

function registerReactionRoles(client, db) {
  client.on(
    "messageReactionAdd",
    (reaction, user) => void updateRole(reaction, user, db, true),
  );
  client.on(
    "messageReactionRemove",
    (reaction, user) => void updateRole(reaction, user, db, false),
  );
}

module.exports = { registerReactionRoles };
