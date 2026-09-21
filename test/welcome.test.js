import assert from 'node:assert/strict';
import test from 'node:test';
import { ButtonStyle, ComponentType, MessageFlags } from 'discord.js';
import { postWelcome, VERIFY_URL, WELCOME_CHANNEL_ID, welcomeMessage } from '../src/welcome.js';

const guild = {
  id: '1547021317193080882',
  name: 'Example Server',
  iconURL: () => 'https://cdn.discordapp.com/icons/123/server.png',
};
const member = { id: '123', user: { username: 'new_member' }, guild };

test('welcome card has the server icon, native divider, and Verify link', () => {
  const message = welcomeMessage(member);
  const card = message.components[0].toJSON();
  const section = card.components[0];
  const divider = card.components[2];
  const button = card.components[3].components[0];
  assert.equal(message.flags, MessageFlags.IsComponentsV2);
  assert.equal(message.embeds, undefined);
  assert.equal(card.type, ComponentType.Container);
  assert.equal(section.accessory.media.url, guild.iconURL());
  assert.match(section.components[0].content, /Welcome to Example Server/);
  assert.match(section.components[0].content, /new\\_member/);
  assert.match(section.components[0].content, /Click \*\*Verify\*\* to get started\./);
  assert.equal(card.components[1].content, '*be comp. be xd.*');
  assert.equal(divider.type, ComponentType.Separator);
  assert.equal(divider.divider, true);
  assert.equal(button.label, 'Verify');
  assert.equal(button.style, ButtonStyle.Link);
  assert.equal(button.url, VERIFY_URL);
  assert.deepEqual(message.allowedMentions, { parse: [] });
});

test('welcome card works when the server has no icon', () => {
  const noIcon = { ...member, guild: { ...guild, iconURL: () => null } };
  const card = welcomeMessage(noIcon).components[0].toJSON();
  assert.equal(card.components[0].type, ComponentType.TextDisplay);
  assert.match(card.components[0].content, /Welcome to Example Server/);
});

test('welcome posts to the configured channel', async () => {
  let sent;
  let fetched;
  const channel = { guildId: guild.id, isTextBased: () => true, send: async message => { sent = message; } };
  const target = { ...member, guild: { ...guild, channels: { fetch: async id => { fetched = id; return channel; } } } };
  assert.equal(await postWelcome(target), true);
  assert.equal(fetched, WELCOME_CHANNEL_ID);
  assert.equal(sent.flags, MessageFlags.IsComponentsV2);
  assert.equal(sent.components[0].toJSON().components[3].components[0].url, VERIFY_URL);
});
