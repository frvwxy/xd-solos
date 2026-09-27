import assert from 'node:assert/strict';
import test from 'node:test';
import { ButtonStyle, ComponentType } from 'discord.js';
import { ACTIVITY_WINDOW_MS, activityCard, activityCommand, activityStatus } from '../src/activity.js';

const now = Date.UTC(2026, 8, 27, 12);
const member = {
  id: '123456789012345678',
  displayName: 'Example Member',
  user: {
    username: 'example_user',
    displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/avatar.png',
  },
};

test('/activity requires a member', () => {
  const command = activityCommand.toJSON();
  assert.equal(command.name, 'activity');
  assert.equal(command.options[0].name, 'user');
  assert.equal(command.options[0].required, true);
});

test('activity status distinguishes active, inactive, and collecting data', () => {
  assert.equal(activityStatus({ lastMessageAt: now - ACTIVITY_WINDOW_MS + 1 }, now - ACTIVITY_WINDOW_MS, now).state, 'active');
  assert.equal(activityStatus({ lastMessageAt: now - ACTIVITY_WINDOW_MS - 1 }, now - ACTIVITY_WINDOW_MS, now).state, 'inactive');
  assert.equal(activityStatus(null, now - ACTIVITY_WINDOW_MS, now).state, 'inactive');
  assert.equal(activityStatus(null, now - 60_000, now).state, 'unknown');
});

test('activity card shows last message data and only enables available actions', () => {
  const record = { lastMessageAt: now - 60_000, channelId: '987654321098765432' };
  const card = activityCard(member, record, now - 10_000, 'nonce', ['warn', 'history'], now).toJSON();
  assert.equal(card.accent_color, 0x8bd8f7);
  assert.equal(card.components[0].type, ComponentType.Section);
  assert.match(card.components[0].components[0].content, /7-Day Activity Check/);
  assert.match(card.components[1].content, /<#987654321098765432>/);
  const buttons = card.components.at(-1).components;
  assert.deepEqual(buttons.map(button => button.label), ['Kick', 'Warn', 'History']);
  assert.ok(buttons.every(button => button.style === ButtonStyle.Secondary));
  assert.deepEqual(buttons.map(button => button.disabled), [true, false, false]);
});

test('activity card explains when no history has been collected yet', () => {
  const card = activityCard(member, null, now - 60_000, 'nonce', ['history'], now).toJSON();
  assert.match(card.components[0].components[0].content, /Collecting data/);
  assert.match(card.components[1].content, /No message recorded/);
});
