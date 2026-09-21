import { TextDisplayBuilder } from 'discord.js';
import { addDivider, cardMessage, cardWithHeader } from './cards.js';

export const ACCEPT_LOG_CHANNEL_ID = '1551391992699682956';

export function acceptanceLogMessage(guild, { targetId, moderatorId, addedRoleIds, channelSent, dmSent }) {
  const card = cardWithHeader(guild, [
    '**Member Accepted into xd**',
    `**Member:** <@${targetId}> (\`${targetId}\`)`,
    `**Accepted by:** <@${moderatorId}> (\`${moderatorId}\`)`,
  ].join('\n'), 0x8bd8f7, 128);
  addDivider(card);
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `**Roles added:** ${addedRoleIds.map(id => `<@&${id}>`).join(', ')}`,
    `**Channel announcement:** ${channelSent ? 'Sent' : 'Failed'}`,
    `**DM:** ${dmSent ? 'Delivered' : 'Could not be delivered'}`,
  ].join('\n')));
  return cardMessage(card);
}

export async function postAcceptanceLog(guild, event, channelId = ACCEPT_LOG_CHANNEL_ID) {
  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased() || channel.guildId !== guild.id || typeof channel.send !== 'function') {
      throw new Error(`Channel ${channelId} is not a text channel in ${guild.id}`);
    }
    await channel.send(acceptanceLogMessage(guild, event));
    return true;
  } catch (error) {
    console.error(`Could not post acceptance log to ${channelId}:`, error);
    return false;
  }
}
