import assert from 'node:assert/strict';
import test from 'node:test';
import { ButtonStyle, ComponentType, MessageFlags } from 'discord.js';
import { accessLevel } from '../src/policy.js';
import {
  ADDITIONAL_TRYOUT_ROLE_ID, TRYOUT_SERVER_URL, canUseTryout, deliverTryout,
  tryoutChannelMessage, tryoutCommand, tryoutMessage,
} from '../src/tryout.js';

const guild = {
  iconURL: () => 'https://cdn.discordapp.com/icons/123/server.png',
};

test('/tryout requires a user option', () => {
  const command = tryoutCommand.toJSON();
  assert.equal(command.name, 'tryout');
  assert.equal(command.options[0].name, 'user');
  assert.equal(command.options[0].required, true);
});

test('/tryout allows existing moderation roles and the additional staff role without granting /user access', () => {
  assert.equal(ADDITIONAL_TRYOUT_ROLE_ID, '1551403954745905222');
  for (const id of [
    '1547023959118192680', '635280852741390348', '1550346816351113356',
    '1547023304219697152', '1547023404157378641', ADDITIONAL_TRYOUT_ROLE_ID,
  ]) assert.equal(canUseTryout([id]), true);
  assert.equal(accessLevel([ADDITIONAL_TRYOUT_ROLE_ID]), 'none');
  assert.equal(canUseTryout(['123']), false);
});

test('tryout DM has a divider before its private-server button', () => {
  const message = tryoutMessage(guild);
  const card = message.components[0].toJSON();
  const button = card.components[2].components[0];
  assert.equal(message.flags, MessageFlags.IsComponentsV2);
  assert.match(card.components[0].components[0].content, /tryout for xd is starting now/);
  assert.match(card.components[0].components[0].content,
    /Join the private server below to begin\.\nPlease make your way to the leash area\./);
  assert.equal(card.components[0].accessory.media.url, guild.iconURL());
  assert.equal(card.components[1].type, ComponentType.Separator);
  assert.equal(card.components[1].divider, true);
  assert.equal(button.style, ButtonStyle.Link);
  assert.equal(button.label, 'Join Private Server');
  assert.equal(button.url, TRYOUT_SERVER_URL);
  assert.deepEqual(message.allowedMentions, { parse: [] });
});

test('channel post pings only the selected member', () => {
  const message = tryoutChannelMessage(guild, '123456789012345678');
  assert.equal(message.components[0].toJSON().content, '<@123456789012345678>');
  assert.deepEqual(message.allowedMentions, { parse: [], users: ['123456789012345678'] });
  assert.equal(message.components[1].toJSON().components[2].components[0].url, TRYOUT_SERVER_URL);
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
  assert.equal(channelMessage.components[0].toJSON().content, `<@${member.id}>`);
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
  assert.equal(dmMessage.components[0].toJSON().components[2].components[0].url, TRYOUT_SERVER_URL);
});
