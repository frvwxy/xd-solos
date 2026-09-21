import { EmbedBuilder } from 'discord.js';
import { formatDuration } from './duration.js';

export const DEFAULT_MOD_LOG_CHANNEL_ID = '1551357755477065738';

const actionTitles = {
  ban: 'Permanent Ban',
  tempban: 'Temporary Ban',
  mute: 'Mute',
  kick: 'Kick',
  warn: 'Warning',
  unban: 'Unban',
};

export function modLogEmbed(guild, { targetId, moderatorId, action, reason, duration, dmSent }) {
  const card = new EmbedBuilder()
    .setColor(0x8bd8f7)
    .setTitle(actionTitles[action] ?? action)
    .addFields(
      { name: 'User', value: `<@${targetId}> (\`${targetId}\`)`, inline: true },
      { name: 'Moderator', value: moderatorId ? `<@${moderatorId}> (\`${moderatorId}\`)` : 'Automatic timer', inline: true },
      { name: 'Reason', value: reason || 'No reason provided' },
      { name: 'DM', value: dmSent == null ? 'Not attempted' : dmSent ? 'Delivered' : 'Could not be delivered', inline: true },
    )
    .setTimestamp();
  if (duration) card.addFields({ name: 'Duration', value: formatDuration(duration), inline: true });
  const icon = guild.iconURL({ size: 128 });
  if (icon) card.setThumbnail(icon);
  return card;
}

export async function postModLog(guild, event, channelId = process.env.MOD_LOG_CHANNEL_ID || DEFAULT_MOD_LOG_CHANNEL_ID) {
  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased() || channel.guildId !== guild.id || typeof channel.send !== 'function') {
      throw new Error(`Channel ${channelId} is not a text channel in ${guild.id}`);
    }
    await channel.send({ embeds: [modLogEmbed(guild, event)], allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    console.error(`Could not post moderation log to ${channelId}:`, error);
    return false;
  }
}
