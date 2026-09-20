export const CARD_IDLE_MS = 14 * 60_000;

export function getPendingCard(cards, nonce, actorId, guildId, now = Date.now()) {
  const item = cards.get(nonce);
  if (!item || item.expiresAt < now || item.actorId !== actorId || item.guildId !== guildId) return null;
  item.expiresAt = now + CARD_IDLE_MS;
  return item;
}
