import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentType, MessageFlags } from 'discord.js';
import { DEFAULT_MOD_LOG_CHANNEL_ID, modLogMessage, postModLog } from '../src/modlogs.js';

const event = {
  targetId: '123456789012345678', moderatorId: '987654321098765432',
  action: 'mute', reason: 'Spam', duration: '5m', dmSent: true,
};

test('mod log includes the target, moderator, reason, duration, and DM result', () => {
  const guild = { iconURL: () => 'https://cdn.discordapp.com/icons/1/icon.png' };
  const message = modLogMessage(guild, event);
  const card = message.components[0].toJSON();
  assert.equal(message.flags, MessageFlags.IsComponentsV2);
  assert.equal(card.components[0].accessory.media.url, guild.iconURL());
  assert.match(card.components[0].components[0].content, /\*\*Mute\*\*/);
  assert.match(card.components[0].components[0].content, /<@123456789012345678>/);
  assert.match(card.components[0].components[0].content, /<@987654321098765432>/);
  assert.equal(card.components[1].type, ComponentType.Separator);
  assert.equal(card.components[1].divider, true);
  assert.match(card.components[2].content, /\*\*Reason:\*\* Spam/);
  assert.match(card.components[2].content, /\*\*Duration:\*\* 5 Minutes/);
  assert.match(card.components[2].content, /\*\*DM:\*\* Delivered/);
});

test('posts to the configured channel without pinging users', async () => {
  const messages = [];
  const guild = {
    id: 'guild', iconURL: () => null,
    channels: { fetch: async id => {
      assert.equal(id, DEFAULT_MOD_LOG_CHANNEL_ID);
      return { guildId: 'guild', isTextBased: () => true, send: async message => messages.push(message) };
    } },
  };
  assert.equal(await postModLog(guild, event, DEFAULT_MOD_LOG_CHANNEL_ID), true);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].allowedMentions, { parse: [] });
  assert.equal(messages[0].flags, MessageFlags.IsComponentsV2);
  assert.match(messages[0].components[0].toJSON().components[0].content, /\*\*Mute\*\*/);
});

test('automatic unban log identifies the timer', () => {
  const card = modLogMessage({ iconURL: () => null }, {
    targetId: event.targetId, moderatorId: null, action: 'unban',
    reason: 'Timed ban expired', duration: null, dmSent: null,
  }).components[0].toJSON();
  assert.match(card.components[0].content, /Automatic timer/);
  assert.match(card.components[2].content, /\*\*DM:\*\* Not attempted/);
});

test('jail log uses the Jail title and omits a blank reason', () => {
  const card = modLogMessage({ iconURL: () => null }, {
    targetId: event.targetId, moderatorId: event.moderatorId, action: 'jail',
    reason: null, duration: null, dmSent: true,
  }).components[0].toJSON();
  assert.match(card.components[0].content, /\*\*Jail\*\*/);
  assert.doesNotMatch(card.components[2].content, /\*\*Reason:\*\*/);
});

test('unjail log uses the Unjail title', () => {
  const card = modLogMessage({ iconURL: () => null }, {
    targetId: event.targetId, moderatorId: event.moderatorId, action: 'unjail',
    reason: 'Released from jail', duration: null, dmSent: true,
  }).components[0].toJSON();
  assert.match(card.components[0].content, /\*\*Unjail\*\*/);
});
