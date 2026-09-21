import assert from 'node:assert/strict';
import test from 'node:test';
import { ApplicationCommandOptionType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import {
  ACCEPT_COMMAND_ROLE_IDS, ACCEPT_ROLE_IDS, acceptCommand, acceptanceChannelMessage, acceptanceMessage,
  canUseAccept, deliverAcceptance, grantAcceptanceRoles,
} from '../src/accept.js';

const guild = { iconURL: () => 'https://cdn.discordapp.com/icons/123/server.png' };

function roleSetup({ held = [], manageRoles = true, hierarchy = true, missingRole = null } = {}) {
  const calls = [];
  const member = {
    id: '123456789012345678',
    guild: { ...guild, roles: { fetch: async id => id === missingRole ? null : { id, managed: false } } },
    roles: {
      cache: { has: id => held.includes(id) },
      add: async (ids, reason) => { calls.push({ ids, reason }); },
    },
  };
  const bot = {
    permissions: { has: permission => permission === PermissionFlagsBits.ManageRoles && manageRoles },
    roles: { highest: { comparePositionTo: () => hierarchy ? 1 : 0 } },
  };
  return { member, bot, calls };
}

test('/accept requires a user and offers an optional non-negative score count', () => {
  const command = acceptCommand.toJSON();
  assert.equal(command.name, 'accept');
  assert.equal(command.options[0].name, 'user');
  assert.equal(command.options[0].required, true);
  assert.equal(command.options[1].name, 'score_count');
  assert.equal(command.options[1].type, ApplicationCommandOptionType.Integer);
  assert.equal(command.options[1].required, false);
  assert.equal(command.options[1].min_value, 0);
});

test('/accept contains the exact six assigned role IDs', () => {
  assert.deepEqual(ACCEPT_ROLE_IDS, [
    '1551356027973148802', '1551356053168459867',
    '1551356073334804531', '1551356086076969010',
    '1547023363900313620', '1551398064621887528',
  ]);
});

test('/accept is available to exactly the five requested staff roles', () => {
  assert.deepEqual(ACCEPT_COMMAND_ROLE_IDS, [
    '1547023404157378641', '1547023304219697152',
    '1547023959118192680', '1550346816351113356',
    '1551403954745905222',
  ]);
  for (const id of ACCEPT_COMMAND_ROLE_IDS) assert.equal(canUseAccept([id]), true);
  assert.equal(canUseAccept(['635280852741390348']), false);
  assert.equal(canUseAccept(['123']), false);
  assert.equal(canUseAccept(['123', ACCEPT_COMMAND_ROLE_IDS[0]]), true);
});

test('acceptance cards keep the tagline beside the icon without a divider and channel post pings only the selected user', () => {
  const dm = acceptanceMessage(guild);
  const post = acceptanceChannelMessage(guild, '123456789012345678');
  const card = dm.components[0].toJSON();
  assert.equal(dm.flags, MessageFlags.IsComponentsV2);
  assert.match(card.components[0].components[0].content, /Congratulations!\*\*\nWelcome to xd/);
  assert.equal(card.components[0].accessory.media.url, guild.iconURL());
  assert.equal(card.components.length, 1);
  assert.match(card.components[0].components[0].content, /\*be comp\. be xd\.\*/);
  assert.deepEqual(dm.allowedMentions, { parse: [] });
  assert.equal(post.components[0].toJSON().content, '<@123456789012345678>');
  assert.deepEqual(post.allowedMentions, { parse: [], users: ['123456789012345678'] });
});

test('acceptance announcement displays score count only when provided', () => {
  const scored = acceptanceChannelMessage(guild, '123456789012345678', 17);
  const scoredContent = scored.components[1].toJSON().components[0].components[0].content;
  assert.match(scoredContent, /\*\*Score Count:\*\* 17/);

  const unscored = acceptanceMessage(guild);
  const unscoredContent = unscored.components[0].toJSON().components[0].components[0].content;
  assert.doesNotMatch(unscoredContent, /Score Count/);
});

test('role grant adds only missing acceptance roles with an audit reason', async () => {
  const { member, bot, calls } = roleSetup({ held: [ACCEPT_ROLE_IDS[0]] });
  assert.deepEqual(await grantAcceptanceRoles(member, bot, 'moderator-id'), { added: true, addedRoleIds: ACCEPT_ROLE_IDS.slice(1) });
  assert.deepEqual(calls[0].ids, ACCEPT_ROLE_IDS.slice(1));
  assert.match(calls[0].reason, /moderator-id/);
});

test('a member with the original four roles receives later additions', async () => {
  const { member, bot, calls } = roleSetup({ held: ACCEPT_ROLE_IDS.slice(0, 4) });
  assert.deepEqual(await grantAcceptanceRoles(member, bot, 'moderator-id'), {
    added: true, addedRoleIds: ['1547023363900313620', '1551398064621887528'],
  });
  assert.deepEqual(calls[0].ids, ['1547023363900313620', '1551398064621887528']);
});

test('a member with the first five roles receives the new sixth role', async () => {
  const { member, bot, calls } = roleSetup({ held: ACCEPT_ROLE_IDS.slice(0, 5) });
  assert.deepEqual(await grantAcceptanceRoles(member, bot, 'moderator-id'), {
    added: true, addedRoleIds: ['1551398064621887528'],
  });
  assert.deepEqual(calls[0].ids, ['1551398064621887528']);
});

test('already accepted members do not get another role update', async () => {
  const { member, bot, calls } = roleSetup({ held: ACCEPT_ROLE_IDS });
  assert.deepEqual(await grantAcceptanceRoles(member, bot, 'moderator-id'), { added: false, addedRoleIds: [] });
  assert.equal(calls.length, 0);
});

test('missing permission, missing roles, or role hierarchy prevent assignment', async () => {
  for (const setup of [
    { manageRoles: false }, { missingRole: ACCEPT_ROLE_IDS[1] }, { hierarchy: false },
  ]) {
    const { member, bot, calls } = roleSetup(setup);
    await assert.rejects(grantAcceptanceRoles(member, bot, 'moderator-id'));
    assert.equal(calls.length, 0);
  }
});

test('score count is delivered to the DM and channel announcement', async () => {
  let posted;
  let directMessage;
  const member = {
    id: '123456789012345678', guild,
    send: async message => { directMessage = message; },
  };
  const result = await deliverAcceptance(member, { send: async message => { posted = message; } }, 8);
  assert.equal(result.dmSent, true);
  assert.equal(result.channelSent, true);
  assert.equal(posted.components[0].toJSON().content, `<@${member.id}>`);
  assert.match(posted.components[1].toJSON().components[0].components[0].content, /Score Count:\*\* 8/);
  assert.match(directMessage.components[0].toJSON().components[0].components[0].content, /Score Count:\*\* 8/);
});

test('channel announcement is still attempted when the acceptance DM fails', async () => {
  let posted = false;
  const member = {
    id: '123456789012345678', guild,
    send: async () => { throw new Error('DMs closed'); },
  };
  const result = await deliverAcceptance(member, { send: async () => { posted = true; } });
  assert.equal(result.dmSent, false);
  assert.equal(result.channelSent, true);
  assert.equal(posted, true);
});
