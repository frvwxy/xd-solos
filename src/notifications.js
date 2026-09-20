import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { formatDuration } from './duration.js';

const noticeText = {
  ban: { title: 'Banned', verb: 'banned' },
  tempban: { title: 'Temporarily Banned', verb: 'temporarily banned' },
  mute: { title: 'Timed Out', verb: 'timed out' },
  kick: { title: 'Kicked', verb: 'kicked' },
  warn: { title: 'Warned', verb: 'warned' },
  unban: { title: 'Unbanned', verb: 'unbanned' },
};

export function notificationEmbed(guild, moderator, action, reason, duration) {
  const notice = noticeText[action];
  if (!notice) throw new Error(`Unknown moderation action: ${action}`);
  const icon = guild.iconURL({ size: 256 });
  const name = moderator.displayName ?? moderator.user?.username ?? 'Server staff';
  const card = new EmbedBuilder()
    .setColor(0xfacc15)
    .setTitle(notice.title)
    .setDescription(`You have been ${notice.verb} in **${escapeMarkdown(guild.name)}**.`)
    .addFields(
      { name: 'Moderator', value: escapeMarkdown(name), inline: true },
      { name: 'Reason', value: reason, inline: true },
    )
    .setTimestamp();
  if (duration) card.addFields({ name: 'Duration', value: formatDuration(duration), inline: true });
  if (icon) card.setThumbnail(icon);
  return card;
}
