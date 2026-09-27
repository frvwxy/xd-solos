import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, InteractionContextType,
  SectionBuilder, SeparatorBuilder, SlashCommandBuilder, TextDisplayBuilder, ThumbnailBuilder,
  escapeMarkdown,
} from 'discord.js';

export const ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60_000;

export const activityCommand = new SlashCommandBuilder()
  .setName('activity')
  .setDescription('Check whether a member has chatted during the past week')
  .setContexts(InteractionContextType.Guild)
  .addUserOption(option => option
    .setName('user')
    .setDescription('Member whose activity you want to check')
    .setRequired(true));

export function activityStatus(record, trackingStartedAt, now = Date.now()) {
  if (record?.lastMessageAt && now - record.lastMessageAt <= ACTIVITY_WINDOW_MS) {
    return { state: 'active', label: 'Active', detail: 'Messaged during the past 7 days' };
  }
  if (record?.lastMessageAt || now - trackingStartedAt >= ACTIVITY_WINDOW_MS) {
    return { state: 'inactive', label: 'Inactive', detail: 'No messages recorded during the past 7 days' };
  }
  return { state: 'unknown', label: 'Collecting data', detail: 'Not enough activity data has been collected yet' };
}

function activityButtons(nonce, available) {
  const labels = { kick: 'Kick', warn: 'Warn', history: 'History' };
  return new ActionRowBuilder().addComponents(['kick', 'warn', 'history'].map(action => (
    new ButtonBuilder()
      .setCustomId(`mod:choose:${nonce}:${action}`)
      .setLabel(labels[action])
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!available.includes(action))
  )));
}

export function activityCard(member, record, trackingStartedAt, nonce, available, now = Date.now()) {
  const status = activityStatus(record, trackingStartedAt, now);
  const avatar = member.user.displayAvatarURL({ size: 256 });
  const identity = new TextDisplayBuilder().setContent([
    '**7-Day Activity Check**',
    `**${escapeMarkdown(member.displayName)}**`,
    `@${escapeMarkdown(member.user.username)} • ID: \`${member.id}\``,
    `**Status:** ${status.label}`,
    `-# ${status.detail}`,
  ].join('\n'));
  const lastMessage = record?.lastMessageAt
    ? `<t:${Math.floor(record.lastMessageAt / 1000)}:F> (<t:${Math.floor(record.lastMessageAt / 1000)}:R>)${record.channelId ? ` in <#${record.channelId}>` : ''}`
    : 'No message recorded';
  const details = new TextDisplayBuilder().setContent([
    `**Last message:** ${lastMessage}`,
    `**Tracking since:** <t:${Math.floor(trackingStartedAt / 1000)}:F>`,
  ].join('\n'));
  const card = new ContainerBuilder().setAccentColor(0x8bd8f7);
  if (avatar) {
    card.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(identity)
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar)));
  } else {
    card.addTextDisplayComponents(identity);
  }
  card.addTextDisplayComponents(details);
  card.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  card.addActionRowComponents(activityButtons(nonce, available));
  return card;
}
