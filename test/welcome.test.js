import assert from 'node:assert/strict';
import test from 'node:test';
import { ButtonStyle } from 'discord.js';
import { postWelcome, VERIFY_URL, WELCOME_CHANNEL_ID, welcomeMessage } from '../src/welcome.js';

const guild = {
  id: '1547021317193080882',
  name: 'Example Server',
  iconURL: () => 'https://cdn.discordapp.com/icons/123/server.png',
};
const member = { id: '123', user: { username: 'new_member' }, guild };

test('welcome embed has server icon and Verify link', () => {
  const message = welcomeMessage(member);
  const embed = message.embeds[0].toJSON();
  const button = message.components[0].components[0].toJSON();
  assert.equal(embed.title, 'Welcome to Example Server!');
  assert.equal(embed.thumbnail.url, guild.iconURL());
  assert.match(embed.description, /new\\_member/);
  assert.equal(button.label, 'Verify');
  assert.equal(button.style, ButtonStyle.Link);
  assert.equal(button.url, VERIFY_URL);
  assert.deepEqual(message.allowedMentions, { parse: [] });
});

test('welcome posts to the configured channel', async () => {
  let sent;
  let fetched;
  const channel = { guildId: guild.id, isTextBased: () => true, send: async message => { sent = message; } };
  const target = { ...member, guild: { ...guild, channels: { fetch: async id => { fetched = id; return channel; } } } };
  assert.equal(await postWelcome(target), true);
  assert.equal(fetched, WELCOME_CHANNEL_ID);
  assert.equal(sent.components[0].components[0].toJSON().url, VERIFY_URL);
});
