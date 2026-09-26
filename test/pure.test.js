import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionFlagsBits } from 'discord.js';
import {
  PURE_OWNER_USER_ID, canUsePure, pureCommand, purePublicMessage, serverMuteIfInVoice,
} from '../src/pure.js';

function setup({ connected = true, alreadyMuted = false, permission = true, hierarchy = true } = {}) {
  const calls = [];
  const member = {
    roles: { highest: { id: 'member-role' } },
    voice: {
      channelId: connected ? 'voice-channel' : null,
      serverMute: alreadyMuted,
      setMute: async (muted, reason) => calls.push({ muted, reason }),
    },
  };
  const bot = {
    permissions: { has: value => value === PermissionFlagsBits.MuteMembers && permission },
    roles: { highest: { comparePositionTo: () => hierarchy ? 1 : 0 } },
  };
  return { bot, calls, member };
}

test('/pure requires a member and reason and is restricted to the configured user', () => {
  const command = pureCommand.toJSON();
  assert.equal(command.name, 'pure');
  assert.deepEqual(command.options.map(option => option.name), ['user', 'reason']);
  assert.equal(command.options[0].required, true);
  assert.equal(command.options[1].required, true);
  assert.equal(PURE_OWNER_USER_ID, '635280852741390348');
  assert.equal(canUsePure(PURE_OWNER_USER_ID), true);
  assert.equal(canUsePure('someone-else'), false);
});

test('/pure public response contains the requested phrase', () => {
  const payload = purePublicMessage();
  assert.equal(payload.embeds[0].toJSON().description, 'pure is a chuddy chud');
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test('/pure server mutes a connected member', async () => {
  const context = setup();
  assert.deepEqual(await serverMuteIfInVoice(
    context.member, context.bot, 'moderator', 'Test reason',
  ), { connected: true, muted: true, alreadyMuted: false });
  assert.deepEqual(context.calls, [{
    muted: true, reason: 'Test reason | /pure by moderator',
  }]);
});

test('/pure skips voice mute when disconnected or already muted', async () => {
  const disconnected = setup({ connected: false });
  assert.deepEqual(await serverMuteIfInVoice(
    disconnected.member, disconnected.bot, 'moderator', 'Reason',
  ), { connected: false, muted: false, alreadyMuted: false });
  assert.equal(disconnected.calls.length, 0);

  const muted = setup({ alreadyMuted: true });
  assert.deepEqual(await serverMuteIfInVoice(
    muted.member, muted.bot, 'moderator', 'Reason',
  ), { connected: true, muted: true, alreadyMuted: true });
  assert.equal(muted.calls.length, 0);
});

test('/pure voice mute validates bot permission and hierarchy', async () => {
  const noPermission = setup({ permission: false });
  await assert.rejects(serverMuteIfInVoice(
    noPermission.member, noPermission.bot, 'moderator', 'Reason',
  ), /Mute Members/);
  const lowBot = setup({ hierarchy: false });
  await assert.rejects(serverMuteIfInVoice(
    lowBot.member, lowBot.bot, 'moderator', 'Reason',
  ), /bot role must be above/);
});
