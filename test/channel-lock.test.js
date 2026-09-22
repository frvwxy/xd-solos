import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import {
  CHANNEL_LOCK_ROLE_ID, canManageChannelLock, currentSendMessagesOverwrite, lockChannel, lockCommand,
  unlockChannel, unlockCommand,
} from '../src/channel-lock.js';
import { MEMBER_ROLE_ID } from '../src/membercount.js';

function setup({ manageChannels = true, previous = null, hierarchy = true } = {}) {
  const calls = [];
  const allow = new PermissionsBitField(previous === true ? PermissionFlagsBits.SendMessages : 0n);
  const deny = new PermissionsBitField(previous === false ? PermissionFlagsBits.SendMessages : 0n);
  const overwrite = previous === null ? null : { allow, deny };
  const channel = {
    id: 'channel', guildId: 'guild',
    permissionOverwrites: {
      cache: new Map(overwrite ? [[MEMBER_ROLE_ID, overwrite]] : []),
      edit: async (target, permissions) => calls.push({ target, permissions }),
    },
  };
  const memberRole = { id: MEMBER_ROLE_ID, managed: false };
  const guild = { id: 'guild', roles: { fetch: async id => id === MEMBER_ROLE_ID ? memberRole : null } };
  const bot = {
    permissions: { has: permission => permission === PermissionFlagsBits.ManageChannels && manageChannels },
    roles: { highest: { comparePositionTo: () => hierarchy ? 1 : 0 } },
  };
  return { bot, calls, channel, guild };
}

test('/lock and /unlock allow the configured role or an administrator', () => {
  assert.equal(lockCommand.toJSON().name, 'lock');
  assert.equal(unlockCommand.toJSON().name, 'unlock');
  assert.equal(CHANNEL_LOCK_ROLE_ID, '1547023404157378641');
  assert.equal(canManageChannelLock([CHANNEL_LOCK_ROLE_ID]), true);
  assert.equal(canManageChannelLock(['635280852741390348']), false);
  assert.equal(canManageChannelLock(['unknown'], true), true);
  assert.equal(canManageChannelLock(['unknown']), false);
});

test('lock denies Send Messages and unlock restores the previous overwrite', async () => {
  const context = setup({ previous: true });
  assert.equal(currentSendMessagesOverwrite(context.channel), true);
  assert.deepEqual(await lockChannel(context.channel, context.guild, context.bot), { previous: true });
  await unlockChannel(context.channel, context.guild, context.bot, true);
  assert.deepEqual(context.calls, [
    { target: MEMBER_ROLE_ID, permissions: { SendMessages: false } },
    { target: MEMBER_ROLE_ID, permissions: { SendMessages: true } },
  ]);
});

test('lock supports an inherited permission and validates bot permissions and hierarchy', async () => {
  const inherited = setup();
  assert.equal(currentSendMessagesOverwrite(inherited.channel), null);
  assert.deepEqual(await lockChannel(inherited.channel, inherited.guild, inherited.bot), { previous: null });

  const noPermission = setup({ manageChannels: false });
  await assert.rejects(lockChannel(noPermission.channel, noPermission.guild, noPermission.bot), /Manage Channels/);
  const lowBot = setup({ hierarchy: false });
  await assert.rejects(lockChannel(lowBot.channel, lowBot.guild, lowBot.bot), /above the member role/);
});
