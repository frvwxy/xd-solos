import assert from 'node:assert/strict';
import test from 'node:test';
import { ButtonStyle } from 'discord.js';
import { actionButtons } from '../src/buttons.js';
import { visibleActions } from '../src/policy.js';

test('shows every grey button and disables actions unavailable to a limited role', () => {
  const available = visibleActions('limited', { canModerate: true });
  const rows = actionButtons('test', available).map(row => row.toJSON());
  const buttons = rows.flatMap(row => row.components);
  assert.deepEqual(rows.map(row => row.components.length), [3, 3, 1]);
  assert.deepEqual(buttons.map(button => button.label), ['Ban', 'Temp Ban', 'Mute', 'Kick', 'Warn', 'Unban', 'History']);
  assert.ok(buttons.every(button => button.style === ButtonStyle.Secondary));
  assert.deepEqual(buttons.map(button => button.disabled), [true, true, false, true, false, true, false]);
});

test('disables all moderation actions when the target cannot be moderated', () => {
  const available = visibleActions('full', { canModerate: false, banned: false });
  const buttons = actionButtons('test', available).flatMap(row => row.toJSON().components);
  assert.ok(buttons.slice(0, -1).every(button => button.disabled));
  assert.equal(buttons.at(-1).disabled, false);
});
