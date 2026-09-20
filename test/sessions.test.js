import assert from 'node:assert/strict';
import test from 'node:test';
import { CARD_IDLE_MS, getPendingCard } from '../src/sessions.js';

test('only the moderator who opened a card can use it', () => {
  const item = { actorId: 'moderator', guildId: 'server', expiresAt: 1000 };
  const cards = new Map([['card', item]]);
  assert.equal(getPendingCard(cards, 'card', 'other', 'server', 500), null);
  assert.equal(getPendingCard(cards, 'card', 'moderator', 'other-server', 500), null);
  assert.equal(item.expiresAt, 1000);
  assert.equal(getPendingCard(cards, 'card', 'moderator', 'server', 500), item);
});

test('repeated owner use extends card lifetime instead of consuming it', () => {
  const item = { actorId: 'moderator', guildId: 'server', expiresAt: 1000 };
  const cards = new Map([['card', item]]);
  assert.equal(getPendingCard(cards, 'card', 'moderator', 'server', 500), item);
  assert.equal(item.expiresAt, 500 + CARD_IDLE_MS);
  assert.equal(getPendingCard(cards, 'card', 'moderator', 'server', 1000), item);
  assert.equal(item.expiresAt, 1000 + CARD_IDLE_MS);
  assert.equal(getPendingCard(cards, 'card', 'moderator', 'server', item.expiresAt + 1), null);
});
