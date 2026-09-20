import assert from 'node:assert/strict';
import test from 'node:test';
import { accessLevel, allowedActions, canPerform } from '../src/policy.js';

test('full roles may use every action and permanent bans', () => {
  for (const id of ['1547023959118192680', '635280852741390348', '1550346816351113356']) {
    assert.equal(accessLevel([id]), 'full');
  }
  assert.deepEqual(allowedActions('full'), ['ban', 'mute', 'kick', 'warn', 'history']);
  assert.equal(canPerform('full', 'ban', null), true);
});

test('timed role cannot permanently ban', () => {
  const level = accessLevel(['1547023304219697152']);
  assert.equal(level, 'timed');
  assert.equal(canPerform(level, 'ban', null), false);
  assert.equal(canPerform(level, 'ban', 60_000), true);
  assert.equal(canPerform(level, 'kick', null), true);
});

test('limited role can only mute, warn, and see history', () => {
  const level = accessLevel(['1547023404157378641']);
  assert.deepEqual(allowedActions(level), ['mute', 'warn', 'history']);
  assert.equal(canPerform(level, 'kick', null), false);
  assert.equal(canPerform(level, 'ban', 60_000), false);
});

test('unknown roles are denied and higher access wins', () => {
  assert.equal(accessLevel(['123']), 'none');
  assert.equal(canPerform('none', 'history', null), false);
  assert.equal(accessLevel(['1547023404157378641', '635280852741390348']), 'full');
});
