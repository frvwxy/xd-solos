import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionFlagsBits } from 'discord.js';
import {
  JAIL_CHANNEL_ID, JAIL_ROLE_ID, canUseJail, jailCommand, jailMember, restoreJailAccess,
  unjailCommand, unjailMember,
} from '../src/jail.js';

function setup({ manageRoles = true, manageChannels = true, alreadyJailed = false } = {}) {
  const roleCalls = [];
  const overwriteCalls = [];
  const deleteCalls = [];
  const makeChannel = (id, text = false) => ({
    id, guildId: 'guild', isTextBased: () => text,
    permissionOverwrites: {
      cache: new Map(),
      edit: async (target, changes) => overwriteCalls.push({ id, target, changes }),
      delete: async target => deleteCalls.push({ id, target }),
    },
  });
  const channels = new Map([
    ['general', makeChannel('general')],
    [JAIL_CHANNEL_ID, makeChannel(JAIL_CHANNEL_ID, true)],
  ]);
  const availableRoles = new Map([
    [JAIL_ROLE_ID, { id: JAIL_ROLE_ID, managed: false }],
    ['role-a', { id: 'role-a', managed: false }],
    ['managed-role', { id: 'managed-role', managed: true }],
  ]);
  const guild = {
    id: 'guild',
    roles: { fetch: async id => availableRoles.get(id) ?? null },
    channels: { fetch: async id => id ? channels.get(id) ?? null : channels },
  };
  const cachedRoles = new Map([
    ['guild', { id: 'guild', managed: false }],
    ['role-a', availableRoles.get('role-a')],
    ['managed-role', availableRoles.get('managed-role')],
    ...(alreadyJailed ? [[JAIL_ROLE_ID, availableRoles.get(JAIL_ROLE_ID)]] : []),
  ]);
  const member = {
    id: 'member', guild,
    roles: {
      highest: { id: 'member-highest' },
      cache: cachedRoles,
      add: async (ids, reason) => roleCalls.push({ action: 'add', ids, reason }),
      remove: async (ids, reason) => roleCalls.push({ action: 'remove', ids, reason }),
    },
  };
  const bot = {
    id: 'bot',
    permissions: { has: permission => (
      permission === PermissionFlagsBits.ManageRoles ? manageRoles
        : permission === PermissionFlagsBits.ManageChannels && manageChannels
    ) },
    roles: { highest: { comparePositionTo: () => 1 } },
  };
  return { bot, channels, deleteCalls, guild, member, overwriteCalls, roleCalls };
}

test('/jail requires a member and uses existing moderation staff roles', () => {
  const command = jailCommand.toJSON();
  assert.equal(command.name, 'jail');
  assert.equal(command.options[0].name, 'member');
  assert.equal(command.options[0].required, true);
  assert.equal(unjailCommand.toJSON().name, 'unjail');
  assert.equal(unjailCommand.toJSON().options[0].name, 'member');
  assert.equal(canUseJail(['1547023404157378641']), true);
  assert.equal(canUseJail(['635280852741390348']), true);
  assert.equal(canUseJail(['unknown']), false);
});

test('jailing removes manageable roles, restricts channels, and assigns the jail role', async () => {
  const setupResult = setup();
  const result = await jailMember(setupResult.member, setupResult.bot, 'moderator');
  assert.equal(result.added, true);
  assert.deepEqual(result.removedRoleIds, ['role-a']);
  assert.deepEqual(setupResult.overwriteCalls, [
    { id: 'general', target: 'member', changes: { ViewChannel: false } },
    {
      id: JAIL_CHANNEL_ID, target: 'member',
      changes: { ViewChannel: true, SendMessages: true, ReadMessageHistory: true },
    },
  ]);
  assert.deepEqual(setupResult.roleCalls, [
    { action: 'remove', ids: ['role-a'], reason: 'Jailed by moderator' },
    { action: 'add', ids: JAIL_ROLE_ID, reason: 'Jailed by moderator' },
  ]);

  await restoreJailAccess(setupResult.guild, setupResult.member.id, result.snapshots);
  assert.deepEqual(setupResult.deleteCalls, [
    { id: JAIL_CHANNEL_ID, target: 'member' },
    { id: 'general', target: 'member' },
  ]);
});

test('jailing requires both bot permissions and does not duplicate the jail role', async () => {
  const noRoles = setup({ manageRoles: false });
  await assert.rejects(jailMember(noRoles.member, noRoles.bot, 'mod'), /Manage Roles/);
  const noChannels = setup({ manageChannels: false });
  await assert.rejects(jailMember(noChannels.member, noChannels.bot, 'mod'), /Manage Channels/);
  const existing = setup({ alreadyJailed: true });
  assert.deepEqual(await jailMember(existing.member, existing.bot, 'mod'), {
    added: false, snapshots: [], removedRoleIds: [],
  });
  assert.equal(existing.overwriteCalls.length, 0);
});

test('unjailing restores saved roles, removes jail, and restores channel permissions', async () => {
  const setupResult = setup({ alreadyJailed: true });
  const record = {
    removedRoleIds: ['role-a', 'missing-role', 'managed-role'],
    snapshots: [
      { channelId: 'general', hadOverwrite: false, previous: { ViewChannel: null } },
      {
        channelId: JAIL_CHANNEL_ID, hadOverwrite: false,
        previous: { ViewChannel: null, SendMessages: null, ReadMessageHistory: null },
      },
    ],
  };
  const result = await unjailMember(setupResult.member, setupResult.bot, record, 'moderator');
  assert.deepEqual(result, {
    restoredRoleIds: ['role-a'], skippedRoleIds: ['missing-role', 'managed-role'],
  });
  assert.deepEqual(setupResult.roleCalls, [
    { action: 'add', ids: ['role-a'], reason: 'Unjailed by moderator' },
    { action: 'remove', ids: JAIL_ROLE_ID, reason: 'Unjailed by moderator' },
  ]);
  assert.deepEqual(setupResult.deleteCalls, [
    { id: JAIL_CHANNEL_ID, target: 'member' },
    { id: 'general', target: 'member' },
  ]);
});
