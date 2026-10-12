"use strict";

const path = require("node:path");
const { MessageFlags } = require("discord.js");
const { createDatabase } = require("./db");
const { registerJoinNotice } = require("./notice");
const { registerReactionRoles } = require("./reactionRole");
const { commands: sourceCommands, execute: sourceExecute, handleSettingsComponent } = require("./commands");

const EXCLUDED_COMMANDS = new Set(["경고"]);

function createSecretIntegration({ client, databasePath = path.join(__dirname, "../../secret.sqlite") }) {
  const database = createDatabase(databasePath);
  const commands = new Map(
    [...sourceCommands].filter(([name]) => !EXCLUDED_COMMANDS.has(name)),
  );
  const execute = Object.fromEntries(
    Object.entries(sourceExecute).filter(([name]) => !EXCLUDED_COMMANDS.has(name)),
  );

  registerJoinNotice(client, database);
  registerReactionRoles(client, database);

  async function handleInteraction(interaction) {
    if (interaction.isButton?.() || interaction.isStringSelectMenu?.() ||
        interaction.isChannelSelectMenu?.() || interaction.isRoleSelectMenu?.()) {
      if (!interaction.customId?.startsWith("settings:") &&
          !interaction.customId?.startsWith("lock:") &&
          !interaction.customId?.startsWith("basiclock:")) return false;
      await handleSettingsComponent(interaction, database);
      return true;
    }
    if (!interaction.isChatInputCommand?.()) return false;
    const handler = execute[interaction.commandName];
    if (!handler) return false;
    await handler(interaction, database);
    return true;
  }

  function close() {
    database.close();
  }

  return { database, commands, handleInteraction, close, MessageFlags };
}

module.exports = { createSecretIntegration };
