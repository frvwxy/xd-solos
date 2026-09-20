// These are Discord role IDs, not individual user IDs.
const fullRoles = new Set(['1547023959118192680', '635280852741390348', '1550346816351113356']);
const timedRoles = new Set(['1547023304219697152']);
const limitedRoles = new Set(['1547023404157378641']);

export function accessLevel(roleIds) {
  const ids = new Set(roleIds);
  if ([...fullRoles].some(id => ids.has(id))) return 'full';
  if ([...timedRoles].some(id => ids.has(id))) return 'timed';
  if ([...limitedRoles].some(id => ids.has(id))) return 'limited';
  return 'none';
}

export function allowedActions(level) {
  if (level === 'full' || level === 'timed') return ['ban', 'mute', 'kick', 'warn', 'history'];
  if (level === 'limited') return ['mute', 'warn', 'history'];
  return [];
}

export function canPerform(level, action, durationMs) {
  if (!allowedActions(level).includes(action)) return false;
  if (action === 'ban' && level === 'timed' && !durationMs) return false;
  return true;
}
