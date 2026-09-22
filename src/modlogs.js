import { TextDisplayBuilder, escapeMarkdown } from 'discord.js';
import { addDivider, cardMessage, cardWithHeader } from './cards.js';
import { formatDuration } from './duration.js';

export const DEFAULT_MOD_LOG_CHANNEL_ID = '1551357755477065738';

const actionTitles = {
  ban: 'Permanent Ban',
  tempban: 'Temporary Ban',
  mute: 'Mute',
  kick: 'Kick',
  warn: 'Warning',
  unban: 'Unban',
  jail: 'Jail',
  unjail: 'Unjail',
};

export function modLogMessage(guild, { targetId, moderatorId, action, reason, duration, dmSent }) {
  const card = cardWithHeader(guild, [
    `**${actionTitles[action] ?? action}**`,
    `**User:** <@${targetId}> (\`${targetId}\`)`,
    `**Moderator:** ${moderatorId ? `<@${moderatorId}> (\`${moderatorId}\`)` : 'Automatic timer'}`,
  ].join('\n'), 0x8bd8f7, 128);
  addDivider(card);
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    ...(reason ? [`**Reason:** ${escapeMarkdown(reason)}`] : []),
    ...(duration ? [`**Duration:** ${formatDuration(duration)}`] : []),
    `**DM:** ${dmSent == null ? 'Not attempted' : dmSent ? 'Delivered' : 'Could not be delivered'}`,
  ].join('\n')));
  return cardMessage(card);
}

export async function postModLog(guild, event, channelId = process.env.MOD_LOG_CHANNEL_ID || DEFAULT_MOD_LOG_CHANNEL_ID) {
  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased() || channel.guildId !== guild.id || typeof channel.send !== 'function') {
      throw new Error(`Channel ${channelId} is not a text channel in ${guild.id}`);
    }
    await channel.send(modLogMessage(guild, event));
    return true;
  } catch (error) {
    console.error(`Could not post moderation log to ${channelId}:`, error);
    return false;
  }
}
