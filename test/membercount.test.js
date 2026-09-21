import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MEMBER_COUNT_CHANNEL_ID, MEMBER_COUNT_CHANNEL_PREFIX, MEMBER_ROLE_ID, updateMemberCount,
} from '../src/membercount.js';

function setup({ currentName = '・xd count:', roleExists = true, channelExists = true } = {}) {
  const calls = [];
  const members = new Map([
    ['1', { roles: { cache: { has: id => id === MEMBER_ROLE_ID } } }],
    ['2', { roles: { cache: { has: id => id === MEMBER_ROLE_ID } } }],
    ['3', { roles: { cache: { has: () => false } } }],
  ]);
  const channel = channelExists ? {
    guildId: 'guild-id', name: currentName,
    setName: async (name, reason) => { calls.push({ name, reason }); },
  } : null;
  const guild = {
    id: 'guild-id',
    roles: { fetch: async id => id === MEMBER_ROLE_ID && roleExists ? { id } : null },
    members: { fetch: async () => members },
    channels: { fetch: async id => id === MEMBER_COUNT_CHANNEL_ID ? channel : null },
  };
  return { calls, guild };
}

test('member count uses the configured role and renames the configured channel', async () => {
  assert.equal(MEMBER_ROLE_ID, '1547023363900313620');
  assert.equal(MEMBER_COUNT_CHANNEL_ID, '1551476206136725514');
  assert.equal(MEMBER_COUNT_CHANNEL_PREFIX, '・xd count:');
  const { calls, guild } = setup();
  assert.deepEqual(await updateMemberCount(guild), {
    count: 2, name: '・xd count: 2', changed: true,
  });
  assert.deepEqual(calls, [{ name: '・xd count: 2', reason: 'Updated xd member count to 2' }]);
});

test('member count avoids an unnecessary rename when the name is current', async () => {
  const { calls, guild } = setup({ currentName: '・xd count: 2' });
  assert.deepEqual(await updateMemberCount(guild), {
    count: 2, name: '・xd count: 2', changed: false,
  });
  assert.equal(calls.length, 0);
});

test('member count rejects a missing role or channel', async () => {
  await assert.rejects(updateMemberCount(setup({ roleExists: false }).guild), /Member role/);
  await assert.rejects(updateMemberCount(setup({ channelExists: false }).guild), /Member count channel/);
});
