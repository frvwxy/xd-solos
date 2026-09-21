import assert from 'node:assert/strict';
import test from 'node:test';
import { ACCEPT_LOG_CHANNEL_ID, acceptanceLogEmbed, postAcceptanceLog } from '../src/acceptlogs.js';

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
  const embed = acceptanceLogEmbed(guild, event).toJSON();
  assert.equal(embed.title, 'Member Accepted into xd');
  assert.equal(embed.thumbnail.url, guild.iconURL());
  assert.deepEqual(embed.fields.map(field => [field.name, field.value]), [
    ['Member', '<@123456789012345678> (`123456789012345678`)'],
    ['Accepted by', '<@234567890123456789> (`234567890123456789`)'],
    ['Roles added', '<@&1551356027973148802>, <@&1551356053168459867>'],
    ['Channel announcement', 'Sent'],
    ['DM', 'Could not be delivered'],
  ]);
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
  assert.equal(sent.embeds[0].toJSON().title, 'Member Accepted into xd');
});
