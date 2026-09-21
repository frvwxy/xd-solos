import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionFlagsBits } from 'discord.js';
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

test('/accept requires a user option and contains the exact five assigned role IDs', () => {
  const command = acceptCommand.toJSON();
  assert.equal(command.name, 'accept');
  assert.equal(command.options[0].name, 'user');
  assert.equal(command.options[0].required, true);
  assert.deepEqual(ACCEPT_ROLE_IDS, [
    '1551356027973148802', '1551356053168459867',
    '1551356073334804531', '1551356086076969010',
    '1547023363900313620',
  ]);
});

test('/accept is available to exactly the four requested staff roles', () => {
  assert.deepEqual(ACCEPT_COMMAND_ROLE_IDS, [
    '1547023404157378641', '1547023304219697152',
    '1547023959118192680', '1550346816351113356',
  ]);
  for (const id of ACCEPT_COMMAND_ROLE_IDS) assert.equal(canUseAccept([id]), true);
  assert.equal(canUseAccept(['635280852741390348']), false);
  assert.equal(canUseAccept(['123']), false);
  assert.equal(canUseAccept(['123', ACCEPT_COMMAND_ROLE_IDS[0]]), true);
});

test('acceptance embeds include the server icon and channel post pings only the selected user', () => {
  const dm = acceptanceMessage(guild);
  const post = acceptanceChannelMessage(guild, '123456789012345678');
  assert.equal(dm.embeds[0].toJSON().title, 'Congratulations and welcome to xd!');
  assert.equal(dm.embeds[0].toJSON().thumbnail.url, guild.iconURL());
  assert.deepEqual(dm.allowedMentions, { parse: [] });
  assert.equal(post.content, '<@123456789012345678>');
  assert.deepEqual(post.allowedMentions, { parse: [], users: ['123456789012345678'] });
});

test('role grant adds only missing acceptance roles with an audit reason', async () => {
  const { member, bot, calls } = roleSetup({ held: [ACCEPT_ROLE_IDS[0]] });
  assert.deepEqual(await grantAcceptanceRoles(member, bot, 'moderator-id'), { added: true, addedRoleIds: ACCEPT_ROLE_IDS.slice(1) });
  assert.deepEqual(calls[0].ids, ACCEPT_ROLE_IDS.slice(1));
  assert.match(calls[0].reason, /moderator-id/);
});

test('a member with the original four roles receives the additional role', async () => {
  const { member, bot, calls } = roleSetup({ held: ACCEPT_ROLE_IDS.slice(0, 4) });
  assert.deepEqual(await grantAcceptanceRoles(member, bot, 'moderator-id'), {
    added: true, addedRoleIds: ['1547023363900313620'],
  });
  assert.deepEqual(calls[0].ids, ['1547023363900313620']);
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

test('DM and channel announcement are attempted independently', async () => {
  let posted;
  const member = {
    id: '123456789012345678', guild,
    send: async () => { throw new Error('DMs closed'); },
  };
  const result = await deliverAcceptance(member, { send: async message => { posted = message; } });
  assert.equal(result.dmSent, false);
  assert.equal(result.channelSent, true);
  assert.equal(posted.content, `<@${member.id}>`);
});
