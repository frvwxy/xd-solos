import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const file = resolve('data/moderation.json');
let state;

export function loadState() {
  try {
    state = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(state.warnings) || !Array.isArray(state.timedBans)) {
      throw new Error('Invalid moderation data');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = { warnings: [], timedBans: [] };
  }
  return state;
}

export function saveState() {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, file);
}

export function getState() {
  if (!state) throw new Error('Moderation data not loaded');
  return state;
}
