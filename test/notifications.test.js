import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentType, MessageFlags } from 'discord.js';
import { notificationMessage } from '../src/notifications.js';

const guild = {
  name: 'Example Server',
  iconURL: () => 'https://cdn.discordapp.com/icons/123/server.png',
};
const moderator = { displayName: 'Moderator' };

test('DM notification uses the server icon and moderator details', () => {
  const message = notificationMessage(guild, moderator, 'warn', 'Unattended', null);
  const card = message.components[0].toJSON();
  assert.equal(message.flags, MessageFlags.IsComponentsV2);
  assert.equal(card.components[0].accessory.media.url, guild.iconURL());
  assert.match(card.components[0].components[0].content, /\*\*Warned\*\*/);
  assert.match(card.components[0].components[0].content, /warned in \*\*Example Server\*\*/);
  assert.equal(card.components[1].type, ComponentType.Separator);
  assert.equal(card.components[1].divider, true);
  assert.match(card.components[2].content, /\*\*Moderator:\*\* Moderator/);
  assert.match(card.components[2].content, /\*\*Reason:\*\* Unattended/);
  assert.deepEqual(message.allowedMentions, { parse: [] });
});

test('DM notification formats timed durations and handles servers without icons', () => {
  const card = notificationMessage({ ...guild, iconURL: () => null }, moderator, 'mute', 'Testing', '1d').components[0].toJSON();
  assert.equal(card.components[0].type, ComponentType.TextDisplay);
  assert.match(card.components[2].content, /\*\*Duration:\*\* 1 Day/);
});

test('jail DM explains that the member was jailed', () => {
  const card = notificationMessage(guild, moderator, 'jail', null, null).components[0].toJSON();
  assert.match(card.components[0].components[0].content, /\*\*Jailed\*\*/);
  assert.match(card.components[0].components[0].content, /jailed in \*\*Example Server\*\*/);
  assert.doesNotMatch(card.components[2].content, /\*\*Reason:\*\*/);
});

test('unjail DM explains that the member was released', () => {
  const card = notificationMessage(guild, moderator, 'unjail', 'Released from jail', null).components[0].toJSON();
  assert.match(card.components[0].components[0].content, /Released from Jail/);
  assert.match(card.components[0].components[0].content, /released from jail in \*\*Example Server\*\*/);
});
