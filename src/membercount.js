export const MEMBER_ROLE_ID = '1547023363900313620';
export const MEMBER_COUNT_CHANNEL_ID = '1551476206136725514';
export const MEMBER_COUNT_CHANNEL_PREFIX = '・xd count:';

export async function updateMemberCount(guild, channelId = MEMBER_COUNT_CHANNEL_ID) {
  const role = await guild.roles.fetch(MEMBER_ROLE_ID);
  if (!role) throw new Error(`Member role ${MEMBER_ROLE_ID} was not found in this server.`);

  const members = await guild.members.fetch();
  const count = [...members.values()].filter(member => member.roles.cache.has(MEMBER_ROLE_ID)).length;
  const name = `${MEMBER_COUNT_CHANNEL_PREFIX} ${count}`;
  const channel = await guild.channels.fetch(channelId);
  if (!channel || channel.guildId !== guild.id || typeof channel.setName !== 'function') {
    throw new Error(`Member count channel ${channelId} was not found in this server.`);
  }

  const changed = channel.name !== name;
  if (changed) await channel.setName(name, `Updated xd member count to ${count}`);
  return { count, name, changed };
}
