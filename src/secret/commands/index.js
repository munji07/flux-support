'use strict';

const admin = require('./admin');

const commands = new Map(admin.commands);
const execute = admin.execute;
const handleSettingsComponent = admin.handleSettingsComponent;

module.exports = { commands, execute, handleSettingsComponent };
