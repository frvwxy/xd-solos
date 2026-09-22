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
    if (state.history === undefined) {
      // Preserve warning records created by the first version of the bot.
      state.history = state.warnings.map(warning => ({ ...warning, action: 'warn' }));
    }
    if (!Array.isArray(state.history)) throw new Error('Invalid moderation history');
    if (state.notes === undefined) state.notes = [];
    if (!Array.isArray(state.notes)) throw new Error('Invalid moderator notes');
    if (state.jails === undefined) state.jails = [];
    if (!Array.isArray(state.jails)) throw new Error('Invalid jail records');
    if (state.channelLocks === undefined) state.channelLocks = [];
    if (!Array.isArray(state.channelLocks)) throw new Error('Invalid channel lock records');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = { warnings: [], timedBans: [], history: [], notes: [], jails: [], channelLocks: [] };
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

export function addHistory(entry) {
  getState().history.push({ ...entry, at: new Date().toISOString() });
  saveState();
}

export function getHistory(guildId, targetId, limit = 10) {
  return getState().history
    .filter(entry => entry.guildId === guildId && entry.targetId === targetId)
    .slice(-limit).reverse();
}

export function addNote(entry) {
  getState().notes.push({ ...entry, at: new Date().toISOString() });
  saveState();
}

export function getNotes(guildId, targetId, limit = 10) {
  return getState().notes
    .filter(entry => entry.guildId === guildId && entry.targetId === targetId)
    .slice(-limit).reverse();
}

export function getJail(guildId, targetId) {
  return getState().jails.find(entry => entry.guildId === guildId && entry.targetId === targetId) ?? null;
}

export function setJail(entry) {
  const state = getState();
  state.jails = state.jails.filter(item => item.guildId !== entry.guildId || item.targetId !== entry.targetId);
  state.jails.push(entry);
  saveState();
}

export function removeJail(guildId, targetId) {
  const state = getState();
  const before = state.jails.length;
  state.jails = state.jails.filter(entry => entry.guildId !== guildId || entry.targetId !== targetId);
  if (state.jails.length !== before) saveState();
}

export function getChannelLock(guildId, channelId) {
  return getState().channelLocks.find(entry => entry.guildId === guildId && entry.channelId === channelId) ?? null;
}

export function setChannelLock(entry) {
  const state = getState();
  state.channelLocks = state.channelLocks
    .filter(item => item.guildId !== entry.guildId || item.channelId !== entry.channelId);
  state.channelLocks.push(entry);
  saveState();
}

export function removeChannelLock(guildId, channelId) {
  const state = getState();
  const before = state.channelLocks.length;
  state.channelLocks = state.channelLocks
    .filter(entry => entry.guildId !== guildId || entry.channelId !== channelId);
  if (state.channelLocks.length !== before) saveState();
}
