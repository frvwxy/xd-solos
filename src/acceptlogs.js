import { EmbedBuilder } from 'discord.js';

export const ACCEPT_LOG_CHANNEL_ID = '1551391992699682956';

export function acceptanceLogEmbed(guild, { targetId, moderatorId, addedRoleIds, channelSent, dmSent }) {
  const card = new EmbedBuilder()
    .setColor(0x8bd8f7)
    .setTitle('Member Accepted into xd')
    .addFields(
      { name: 'Member', value: `<@${targetId}> (\`${targetId}\`)`, inline: true },
      { name: 'Accepted by', value: `<@${moderatorId}> (\`${moderatorId}\`)`, inline: true },
      { name: 'Roles added', value: addedRoleIds.map(id => `<@&${id}>`).join(', ') },
      { name: 'Channel announcement', value: channelSent ? 'Sent' : 'Failed', inline: true },
      { name: 'DM', value: dmSent ? 'Delivered' : 'Could not be delivered', inline: true },
    )
    .setTimestamp();
  const icon = guild.iconURL({ size: 128 });
  if (icon) card.setThumbnail(icon);
  return card;
}

export async function postAcceptanceLog(guild, event, channelId = ACCEPT_LOG_CHANNEL_ID) {
  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased() || channel.guildId !== guild.id || typeof channel.send !== 'function') {
      throw new Error(`Channel ${channelId} is not a text channel in ${guild.id}`);
    }
    await channel.send({ embeds: [acceptanceLogEmbed(guild, event)], allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    console.error(`Could not post acceptance log to ${channelId}:`, error);
    return false;
  }
}
