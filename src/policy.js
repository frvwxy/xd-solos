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
  if (level === 'full') return ['ban', 'tempban', 'mute', 'kick', 'warn', 'unban', 'history'];
  if (level === 'timed') return ['tempban', 'mute', 'kick', 'warn', 'history'];
  if (level === 'limited') return ['mute', 'warn', 'history'];
  return [];
}

export function canPerform(level, action) {
  return allowedActions(level).includes(action);
}

export function visibleActions(level, { canModerate = false, banned = false } = {}) {
  return allowedActions(level).filter(action => {
    if (action === 'history') return true;
    if (action === 'unban') return banned;
    return canModerate;
  });
}

export function unbanUnavailableReason(level, { inServer, banned, canCheckBans, banCheckFailed = false }) {
  if (level !== 'full') return 'a full-access staff role is required.';
  if (inServer) return 'this user is not banned.';
  if (!canCheckBans) return 'the bot needs Ban Members permission.';
  if (banCheckFailed) return 'the bot could not verify the ban status.';
  if (!banned) return 'this user is not banned.';
  return null;
}
