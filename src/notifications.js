import { TextDisplayBuilder, escapeMarkdown } from 'discord.js';
import { addDivider, cardMessage, cardWithHeader } from './cards.js';
import { formatDuration } from './duration.js';

const noticeText = {
  ban: { title: 'Banned', verb: 'banned' },
  tempban: { title: 'Temporarily Banned', verb: 'temporarily banned' },
  mute: { title: 'Timed Out', verb: 'timed out' },
  kick: { title: 'Kicked', verb: 'kicked' },
  warn: { title: 'Warned', verb: 'warned' },
  unban: { title: 'Unbanned', verb: 'unbanned' },
};

export function notificationMessage(guild, moderator, action, reason, duration) {
  const notice = noticeText[action];
  if (!notice) throw new Error(`Unknown moderation action: ${action}`);
  const name = moderator.displayName ?? moderator.user?.username ?? 'Server staff';
  const card = cardWithHeader(guild,
    `**${notice.title}**\nYou have been ${notice.verb} in **${escapeMarkdown(guild.name)}**.`,
    0xfacc15);
  addDivider(card);
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `**Moderator:** ${escapeMarkdown(name)}`,
    `**Reason:** ${escapeMarkdown(reason)}`,
    ...(duration ? [`**Duration:** ${formatDuration(duration)}`] : []),
  ].join('\n')));
  return cardMessage(card);
}
