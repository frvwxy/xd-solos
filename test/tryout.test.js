import assert from 'node:assert/strict';
import test from 'node:test';
import { ButtonStyle } from 'discord.js';
import { TRYOUT_SERVER_URL, deliverTryout, tryoutChannelMessage, tryoutCommand, tryoutMessage } from '../src/tryout.js';

const guild = {
  iconURL: () => 'https://cdn.discordapp.com/icons/123/server.png',
};

test('/tryout requires a user option', () => {
  const command = tryoutCommand.toJSON();
  assert.equal(command.name, 'tryout');
  assert.equal(command.options[0].name, 'user');
  assert.equal(command.options[0].required, true);
});

test('tryout DM includes the instructions and private-server link', () => {
  const message = tryoutMessage(guild);
  const embed = message.embeds[0].toJSON();
  const button = message.components[0].components[0].toJSON();
  assert.match(embed.title, /tryout for xd is starting now/);
  assert.match(embed.description, /leash area/);
  assert.equal(embed.thumbnail.url, guild.iconURL());
  assert.equal(button.style, ButtonStyle.Link);
  assert.equal(button.label, 'Join Private Server');
  assert.equal(button.url, TRYOUT_SERVER_URL);
  assert.deepEqual(message.allowedMentions, { parse: [] });
});

test('channel post pings only the selected member', () => {
  const message = tryoutChannelMessage(guild, '123456789012345678');
  assert.equal(message.content, '<@123456789012345678>');
  assert.deepEqual(message.allowedMentions, { parse: [], users: ['123456789012345678'] });
  assert.equal(message.components[0].components[0].toJSON().url, TRYOUT_SERVER_URL);
});

test('DM and channel post are both attempted even if one fails', async () => {
  let dmAttempted = false;
  let channelMessage;
  const member = {
    id: '123456789012345678', guild,
    send: async () => { dmAttempted = true; throw new Error('DMs closed'); },
  };
  const channel = { send: async message => { channelMessage = message; } };
  const result = await deliverTryout(member, channel);
  assert.equal(dmAttempted, true);
  assert.equal(result.dmSent, false);
  assert.equal(result.channelSent, true);
  assert.equal(channelMessage.content, `<@${member.id}>`);
});

test('DM still sends if the command channel cannot accept messages', async () => {
  let dmMessage;
  const member = {
    id: '123456789012345678', guild,
    send: async message => { dmMessage = message; },
  };
  const result = await deliverTryout(member, null);
  assert.equal(result.dmSent, true);
  assert.equal(result.channelSent, false);
  assert.equal(dmMessage.components[0].components[0].toJSON().url, TRYOUT_SERVER_URL);
});
