import assert from 'node:assert/strict';
import test from 'node:test';
import { accessLevel, allowedActions, canPerform, unbanUnavailableReason, visibleActions } from '../src/policy.js';

test('full roles may use every action, including permanent ban and unban', () => {
  for (const id of ['1547023959118192680', '635280852741390348', '1550346816351113356']) {
    assert.equal(accessLevel([id]), 'full');
  }
  assert.deepEqual(allowedActions('full'), ['ban', 'tempban', 'mute', 'kick', 'warn', 'unban', 'history']);
  assert.equal(canPerform('full', 'ban'), true);
  assert.equal(canPerform('full', 'unban'), true);
});

test('timed role cannot permanently ban or unban', () => {
  const level = accessLevel(['1547023304219697152']);
  assert.equal(level, 'timed');
  assert.equal(canPerform(level, 'ban'), false);
  assert.equal(canPerform(level, 'tempban'), true);
  assert.equal(canPerform(level, 'unban'), false);
  assert.equal(canPerform(level, 'kick'), true);
});

test('limited role can only mute, warn, and see history', () => {
  const level = accessLevel(['1547023404157378641']);
  assert.deepEqual(allowedActions(level), ['mute', 'warn', 'history']);
  assert.equal(canPerform(level, 'kick'), false);
  assert.equal(canPerform(level, 'ban'), false);
});

test('unknown roles are denied and higher access wins', () => {
  assert.equal(accessLevel(['123']), 'none');
  assert.equal(canPerform('none', 'history'), false);
  assert.equal(accessLevel(['1547023404157378641', '635280852741390348']), 'full');
});

test('card buttons reflect membership, ban status, and role tier', () => {
  assert.deepEqual(visibleActions('full', { canModerate: true }), ['ban', 'tempban', 'mute', 'kick', 'warn', 'history']);
  assert.deepEqual(visibleActions('full', { banned: true }), ['unban', 'history']);
  assert.deepEqual(visibleActions('timed', { banned: true }), ['history']);
  assert.deepEqual(visibleActions('limited', { canModerate: true }), ['mute', 'warn', 'history']);
  assert.deepEqual(visibleActions('full'), ['history']);
});

test('unban explains status separately from staff permissions', () => {
  assert.equal(unbanUnavailableReason('full', { inServer: true, banned: false, canCheckBans: true }), 'this user is not banned.');
  assert.equal(unbanUnavailableReason('timed', { inServer: false, banned: true, canCheckBans: true }), 'a full-access staff role is required.');
  assert.equal(unbanUnavailableReason('full', { inServer: false, banned: false, canCheckBans: false }), 'the bot needs Ban Members permission.');
  assert.equal(unbanUnavailableReason('full', { inServer: false, banned: false, canCheckBans: true, banCheckFailed: true }), 'the bot could not verify the ban status.');
  assert.equal(unbanUnavailableReason('full', { inServer: false, banned: true, canCheckBans: true }), null);
});
