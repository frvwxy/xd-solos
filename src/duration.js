const units = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
const unitNames = { m: 'Minute', h: 'Hour', d: 'Day', w: 'Week' };

export function formatDuration(input) {
  const match = /^(\d{1,4})\s*([mhdw])$/i.exec(input?.trim() ?? '');
  if (!match) return input;
  const count = Number(match[1]);
  const name = unitNames[match[2].toLowerCase()];
  return `${count} ${name}${count === 1 ? '' : 's'}`;
}

export function parseDuration(input, maxMs) {
  const match = /^(\d{1,4})\s*([mhdw])$/i.exec(input.trim());
  if (!match) return null;
  const value = Number(match[1]) * units[match[2].toLowerCase()];
  return value >= 60_000 && value <= maxMs ? value : null;
}

export const MAX_TIMEOUT = 28 * units.d;
export const MAX_BAN = 365 * units.d;
