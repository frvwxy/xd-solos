import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVE_RAID_MESSAGE, RAID_ALERT_ROLE_ID, RAID_ANNOUNCEMENT_CHANNEL_ID,
  RAID_LOCK_CHANNEL_ID, RAID_LOG_ROLE_ID, RAID_STAFF_ROLE_ID, activeRaidChannelMessage,
  canUseRaid, endedRaidAnnouncementMessage, formatRaidDuration, getRobloxJoinInfo,
  raidAnnouncementMessage, raidCommand, raidEndMessage, resolveRobloxUser,
} from '../src/raid.js';

const guild = {
  iconURL: () => 'https://cdn.discordapp.com/icons/1/icon.png',
};

const raid = {
  opps: 'alpha and beta',
  robloxUserId: '123',
  robloxUsername: 'TargetUser',
  robloxDisplayName: 'Target',
  robloxProfileUrl: 'https://www.roblox.com/users/123/profile',
  robloxStatus: 'Join available',
  joinUrl: 'https://www.roblox.com/games/start?placeId=456&gameInstanceId=server-id',
  startedBy: '999',
  startedAt: 1_000,
};

test('/raid has start and end subcommands with the requested access role', () => {
  const command = raidCommand.toJSON();
  assert.equal(command.name, 'raid');
  assert.deepEqual(command.options.map(option => option.name), ['start', 'end']);
  assert.deepEqual(command.options[0].options.map(option => option.name), ['roblox_user', 'opps']);
  assert.equal(command.options[1].options[0].name, 'result');
  assert.deepEqual(command.options[1].options[0].choices.map(({ name, value }) => ({ name, value })), [
    { name: 'Won', value: 'won' }, { name: 'Lost', value: 'lost' },
  ]);
  assert.equal(RAID_STAFF_ROLE_ID, '1547023404157378641');
  assert.equal(canUseRaid([RAID_STAFF_ROLE_ID]), true);
  assert.equal(canUseRaid(['unknown'], true), true);
  assert.equal(canUseRaid(['unknown']), false);
});

test('raid uses the configured channels, roles, and exact active heading', () => {
  assert.equal(RAID_LOCK_CHANNEL_ID, '1547135508054806589');
  assert.equal(RAID_ANNOUNCEMENT_CHANNEL_ID, '1547135372167749692');
  assert.equal(RAID_ALERT_ROLE_ID, '1551356053168459867');
  assert.equal(RAID_LOG_ROLE_ID, '1551356073334804531');
  assert.equal(ACTIVE_RAID_MESSAGE, '## <:raid:1551851895755374673> | **ACTIVE RAID**: https://discord.com/channels/1547021317193080882/1547135372167749692');
  assert.deepEqual(activeRaidChannelMessage(), {
    content: ACTIVE_RAID_MESSAGE, allowedMentions: { parse: [] },
  });
});

test('Roblox username and public presence create a direct join link', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (url.includes('usernames')) {
      return { ok: true, json: async () => ({ data: [{ id: 123, name: 'TargetUser', displayName: 'Target' }] }) };
    }
    return {
      ok: true,
      json: async () => ({ userPresences: [{ userPresenceType: 2, placeId: 456, gameId: 'server id' }] }),
    };
  };
  const user = await resolveRobloxUser(' TargetUser ', fetchImpl);
  const join = await getRobloxJoinInfo(user.id, fetchImpl);
  assert.deepEqual(user, {
    id: '123', name: 'TargetUser', displayName: 'Target',
    profileUrl: 'https://www.roblox.com/users/123/profile',
  });
  assert.equal(join.status, 'Join available');
  assert.equal(join.joinUrl, 'https://www.roblox.com/games/start?placeId=456&gameInstanceId=server%20id');
  assert.deepEqual(calls[0].body, { usernames: ['TargetUser'], excludeBannedUsers: false });
  assert.deepEqual(calls[1].body, { userIds: [123] });
});

test('private joins and offline users do not receive a join link', async () => {
  const privateJoin = await getRobloxJoinInfo('123', async () => ({
    ok: true,
    json: async () => ({ userPresences: [{ userPresenceType: 2, placeId: null, gameId: null }] }),
  }));
  assert.equal(privateJoin.status, 'Joins unavailable');
  assert.equal(privateJoin.joinUrl, null);
  const offline = await getRobloxJoinInfo('123', async () => ({
    ok: true,
    json: async () => ({ userPresences: [{ userPresenceType: 0 }] }),
  }));
  assert.equal(offline.status, 'Offline');
  assert.equal(offline.joinUrl, null);
});

test('raid announcements ping only the configured role and include join controls', () => {
  const start = raidAnnouncementMessage(guild, raid);
  assert.equal(start.content, `<@&${RAID_ALERT_ROLE_ID}>`);
  assert.deepEqual(start.allowedMentions, { parse: [], roles: [RAID_ALERT_ROLE_ID] });
  assert.equal(start.components[0].toJSON().components[0].url, raid.joinUrl);
  const embed = start.embeds[0].toJSON();
  assert.equal(embed.title, 'Active Raid');
  assert.match(embed.fields.find(field => field.name === 'Opponents').value, /alpha and beta/);

  const withoutJoin = raidAnnouncementMessage(guild, { ...raid, joinUrl: null, robloxStatus: 'Offline' });
  assert.deepEqual(withoutJoin.components, []);
});

test('ending a raid removes controls, records duration, and pings only log', () => {
  const endedAt = raid.startedAt + 3_661_000;
  assert.equal(formatRaidDuration(3_661_000), '1 Hour, 1 Minute, 1 Second');
  assert.equal(formatRaidDuration(5_000), '5 Seconds');
  const edit = endedRaidAnnouncementMessage(guild, raid, 'won', '777', endedAt);
  assert.equal(edit.content, null);
  assert.deepEqual(edit.components, []);
  assert.equal(edit.embeds[0].toJSON().title, 'Raid Won');
  const end = raidEndMessage(guild, raid, 'lost', '777', endedAt);
  assert.equal(end.content, `<@&${RAID_LOG_ROLE_ID}>`);
  assert.deepEqual(end.allowedMentions, { parse: [], roles: [RAID_LOG_ROLE_ID] });
  assert.equal(end.embeds[0].toJSON().title, 'Raid Lost');
});
