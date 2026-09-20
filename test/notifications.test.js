import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationEmbed } from '../src/notifications.js';

const guild = {
  name: 'Example Server',
  iconURL: () => 'https://cdn.discordapp.com/icons/123/server.png',
};
const moderator = { displayName: 'Moderator' };

test('DM notification uses the server icon and moderator details', () => {
  const card = notificationEmbed(guild, moderator, 'warn', 'Unattended', null).toJSON();
  assert.equal(card.title, 'Warned');
  assert.equal(card.thumbnail.url, guild.iconURL());
  assert.match(card.description, /warned in \*\*Example Server\*\*/);
  assert.deepEqual(card.fields.map(field => [field.name, field.value]), [
    ['Moderator', 'Moderator'],
    ['Reason', 'Unattended'],
  ]);
  assert.ok(card.timestamp);
});

test('DM notification formats timed durations and handles servers without icons', () => {
  const card = notificationEmbed({ ...guild, iconURL: () => null }, moderator, 'mute', 'Testing', '1d').toJSON();
  assert.equal(card.thumbnail, undefined);
  assert.equal(card.fields.at(-1).value, '1 Day');
});
