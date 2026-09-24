import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionFlagsBits } from 'discord.js';
import { canUseRoleIn, giveRoleToMembersWithRole, roleInCommand } from '../src/rolein.js';

function member(id, roleIds, { bot = false, hierarchy = -1, addFails = false } = {}) {
  const calls = [];
  return {
    id,
    user: { bot },
    roles: {
      cache: new Map(roleIds.map(roleId => [roleId, { id: roleId }])),
      highest: { hierarchy },
      add: async (roleId, reason) => {
        calls.push({ roleId, reason });
        if (addFails) throw new Error('Discord rejected the role');
      },
    },
    calls,
  };
}

function setup({ manageRoles = true, actorAboveRole = true, botAboveRole = true } = {}) {
  const sourceRole = { id: 'source', managed: false };
  const destinationRole = { id: 'destination', managed: false };
  const actor = {
    id: 'actor',
    roles: { highest: { comparePositionTo: () => actorAboveRole ? 1 : 0 } },
  };
  const bot = {
    permissions: { has: permission => permission === PermissionFlagsBits.ManageRoles && manageRoles },
    roles: { highest: { comparePositionTo: value => value === destinationRole ? (botAboveRole ? 1 : 0) : -value.hierarchy } },
  };
  const members = [
    member('eligible', ['source']),
    member('already', ['source', 'destination']),
    member('unrelated', ['another']),
    member('bot-account', ['source'], { bot: true }),
    member('too-high', ['source'], { hierarchy: 1 }),
    member('failure', ['source'], { addFails: true }),
  ];
  const guild = {
    id: 'guild', ownerId: 'owner',
    members: { fetch: async () => new Map(members.map(item => [item.id, item])) },
  };
  return { actor, bot, destinationRole, guild, members, sourceRole };
}

test('/rolein requires a source role and destination role', () => {
  const command = roleInCommand.toJSON();
  assert.equal(command.name, 'rolein');
  assert.deepEqual(command.options.map(option => option.name), ['in_role', 'role_to_give']);
  assert.equal(command.options[0].required, true);
  assert.equal(command.options[1].required, true);
});

test('/rolein allows administrators and full-access staff only', () => {
  assert.equal(canUseRoleIn(['1547023959118192680']), true);
  assert.equal(canUseRoleIn(['635280852741390348']), true);
  assert.equal(canUseRoleIn(['1550346816351113356']), true);
  assert.equal(canUseRoleIn(['1547023404157378641']), false);
  assert.equal(canUseRoleIn(['unknown'], true), true);
  assert.equal(canUseRoleIn(['unknown']), false);
});

test('bulk assignment adds only missing roles to manageable non-bot members', async () => {
  const context = setup();
  const result = await giveRoleToMembersWithRole(
    context.guild, context.bot, context.actor, context.sourceRole, context.destinationRole,
  );
  assert.equal(result.matchedCount, 4);
  assert.equal(result.addedCount, 1);
  assert.equal(result.alreadyHadCount, 1);
  assert.equal(result.failedCount, 2);
  assert.deepEqual(context.members[0].calls, [{
    roleId: 'destination',
    reason: 'Bulk role assignment by actor from role source',
  }]);
  assert.equal(context.members[1].calls.length, 0);
  assert.equal(context.members[2].calls.length, 0);
  assert.equal(context.members[3].calls.length, 0);
});

test('bulk assignment validates permissions and role hierarchy', async () => {
  const noPermission = setup({ manageRoles: false });
  await assert.rejects(giveRoleToMembersWithRole(
    noPermission.guild, noPermission.bot, noPermission.actor,
    noPermission.sourceRole, noPermission.destinationRole,
  ), /Manage Roles/);

  const lowBot = setup({ botAboveRole: false });
  await assert.rejects(giveRoleToMembersWithRole(
    lowBot.guild, lowBot.bot, lowBot.actor, lowBot.sourceRole, lowBot.destinationRole,
  ), /bot role must be above/);

  const lowActor = setup({ actorAboveRole: false });
  await assert.rejects(giveRoleToMembersWithRole(
    lowActor.guild, lowActor.bot, lowActor.actor, lowActor.sourceRole, lowActor.destinationRole,
  ), /Your highest role must be above/);
});

test('bulk assignment rejects everyone, managed roles, and the same role twice', async () => {
  const context = setup();
  await assert.rejects(giveRoleToMembersWithRole(
    context.guild, context.bot, context.actor, { id: 'guild' }, context.destinationRole,
  ), /source role cannot be @everyone/);
  await assert.rejects(giveRoleToMembersWithRole(
    context.guild, context.bot, context.actor, context.sourceRole, { id: 'guild' },
  ), /cannot assign @everyone/);
  await assert.rejects(giveRoleToMembersWithRole(
    context.guild, context.bot, context.actor, context.sourceRole, { id: 'destination', managed: true },
  ), /managed by Discord/);
  await assert.rejects(giveRoleToMembersWithRole(
    context.guild, context.bot, context.actor, context.sourceRole, context.sourceRole,
  ), /two different roles/);
});
