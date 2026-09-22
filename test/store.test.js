import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('older moderation data gains private notes without losing history', async () => {
  const originalDirectory = process.cwd();
  const testDirectory = mkdtempSync(join(tmpdir(), 'moderation-store-test-'));
  try {
    process.chdir(testDirectory);
    mkdirSync('data');
    writeFileSync('data/moderation.json', JSON.stringify({
      warnings: [{ guildId: 'guild', targetId: 'user', moderatorId: 'mod', reason: 'Test', at: '2026-01-01T00:00:00.000Z' }],
      timedBans: [],
    }));
    const store = await import(`../src/store.js?test=${Date.now()}`);
    store.loadState();
    assert.equal(store.getHistory('guild', 'user')[0].action, 'warn');
    assert.deepEqual(store.getNotes('guild', 'user'), []);
    assert.equal(store.getJail('guild', 'user'), null);
    assert.equal(store.getChannelLock('guild', 'channel'), null);

    store.addNote({ guildId: 'guild', targetId: 'user', authorId: 'mod', text: 'Private note' });
    store.setJail({ guildId: 'guild', targetId: 'user', moderatorId: 'mod', snapshots: [] });
    assert.equal(store.getJail('guild', 'user').moderatorId, 'mod');
    store.removeJail('guild', 'user');
    assert.equal(store.getJail('guild', 'user'), null);
    store.setChannelLock({ guildId: 'guild', channelId: 'channel', moderatorId: 'mod', previous: null });
    assert.equal(store.getChannelLock('guild', 'channel').moderatorId, 'mod');
    store.removeChannelLock('guild', 'channel');
    assert.equal(store.getChannelLock('guild', 'channel'), null);
    assert.equal(store.getNotes('guild', 'user')[0].text, 'Private note');
    const saved = JSON.parse(readFileSync('data/moderation.json', 'utf8'));
    assert.equal(saved.history.length, 1);
    assert.equal(saved.notes.length, 1);
    assert.deepEqual(saved.jails, []);
    assert.deepEqual(saved.channelLocks, []);
  } finally {
    process.chdir(originalDirectory);
    rmSync(testDirectory, { recursive: true, force: true });
  }
});
