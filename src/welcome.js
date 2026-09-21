import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags,
  SectionBuilder, SeparatorBuilder, TextDisplayBuilder, ThumbnailBuilder, escapeMarkdown,
} from 'discord.js';

export const WELCOME_CHANNEL_ID = '1547022446748508210';
export const VERIFY_URL = 'https://discord.com/channels/1547021317193080882/1551336698003066980';

export function welcomeMessage(member) {
  const introduction = new TextDisplayBuilder().setContent([
    `**Welcome to ${escapeMarkdown(member.guild.name)}!**`,
    '',
    `Hey **${escapeMarkdown(member.user.username)}**, glad you're here!`,
    'Click **Verify** to get started.',
  ].join('\n'));
  const card = new ContainerBuilder().setAccentColor(0x8bd8f7);
  const icon = member.guild.iconURL({ size: 256 });
  if (icon) {
    card.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(introduction)
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(icon)));
  } else {
    card.addTextDisplayComponents(introduction);
  }
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent('*be comp. be xd.*'));
  card.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  card.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Verify').setStyle(ButtonStyle.Link).setURL(VERIFY_URL),
  ));
  return { components: [card], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

export async function postWelcome(member, channelId = WELCOME_CHANNEL_ID) {
  try {
    const channel = await member.guild.channels.fetch(channelId);
    if (!channel?.isTextBased() || channel.guildId !== member.guild.id || typeof channel.send !== 'function') {
      throw new Error(`Channel ${channelId} is not a text channel in ${member.guild.id}`);
    }
    await channel.send(welcomeMessage(member));
    return true;
  } catch (error) {
    console.error(`Could not post welcome for ${member.id} to ${channelId}:`, error);
    return false;
  }
}
