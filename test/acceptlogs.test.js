import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentType, MessageFlags } from 'discord.js';
import { ACCEPT_LOG_CHANNEL_ID, acceptanceLogMessage, postAcceptanceLog } from '../src/acceptlogs.js';

const guild = {
  id: '1547021317193080882',
  iconURL: () => 'https://cdn.discordapp.com/icons/123/server.png',
};
const event = {
  targetId: '123456789012345678',
  moderatorId: '234567890123456789',
  addedRoleIds: ['1551356027973148802', '1551356053168459867'],
  channelSent: true,
  dmSent: false,
};

test('acceptance log records member, moderator, roles, and delivery results', () => {
  const message = acceptanceLogMessage(guild, event);
  const card = message.components[0].toJSON();
  assert.equal(message.flags, MessageFlags.IsComponentsV2);
  assert.equal(card.components[0].accessory.media.url, guild.iconURL());
  assert.match(card.components[0].components[0].content, /Member Accepted into xd/);
  assert.match(card.components[0].components[0].content, /<@123456789012345678>/);
  assert.match(card.components[0].components[0].content, /<@234567890123456789>/);
  assert.equal(card.components[1].type, ComponentType.Separator);
  assert.equal(card.components[1].divider, true);
  assert.match(card.components[2].content, /<@&1551356027973148802>, <@&1551356053168459867>/);
  assert.match(card.components[2].content, /\*\*Channel announcement:\*\* Sent/);
  assert.match(card.components[2].content, /\*\*DM:\*\* Could not be delivered/);
});

test('acceptance log posts to its dedicated channel without pinging', async () => {
  let fetched;
  let sent;
  const channel = {
    guildId: guild.id, isTextBased: () => true,
    send: async message => { sent = message; },
  };
  const targetGuild = { ...guild, channels: { fetch: async id => { fetched = id; return channel; } } };
  assert.equal(await postAcceptanceLog(targetGuild, event), true);
  assert.equal(fetched, ACCEPT_LOG_CHANNEL_ID);
  assert.deepEqual(sent.allowedMentions, { parse: [] });
  assert.equal(sent.flags, MessageFlags.IsComponentsV2);
  assert.match(sent.components[0].toJSON().components[0].components[0].content, /Member Accepted into xd/);
});
