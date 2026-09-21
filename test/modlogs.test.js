import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MOD_LOG_CHANNEL_ID, modLogEmbed, postModLog } from '../src/modlogs.js';

const event = {
  targetId: '123456789012345678', moderatorId: '987654321098765432',
  action: 'mute', reason: 'Spam', duration: '5m', dmSent: true,
};

test('mod log includes the target, moderator, reason, duration, and DM result', () => {
  const guild = { iconURL: () => 'https://cdn.discordapp.com/icons/1/icon.png' };
  const card = modLogEmbed(guild, event).toJSON();
  assert.equal(card.title, 'Mute');
  assert.equal(card.thumbnail.url, guild.iconURL());
  assert.deepEqual(card.fields.map(field => [field.name, field.value]), [
    ['User', '<@123456789012345678> (`123456789012345678`)'],
    ['Moderator', '<@987654321098765432> (`987654321098765432`)'],
    ['Reason', 'Spam'],
    ['DM', 'Delivered'],
    ['Duration', '5 Minutes'],
  ]);
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
  assert.equal(messages[0].embeds[0].toJSON().title, 'Mute');
});

test('automatic unban log identifies the timer', () => {
  const card = modLogEmbed({ iconURL: () => null }, {
    targetId: event.targetId, moderatorId: null, action: 'unban',
    reason: 'Timed ban expired', duration: null, dmSent: null,
  }).toJSON();
  assert.equal(card.fields[1].value, 'Automatic timer');
  assert.equal(card.fields[3].value, 'Not attempted');
});
