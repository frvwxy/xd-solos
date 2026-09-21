import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from 'discord.js';

export const WELCOME_CHANNEL_ID = '1547022446748508210';
export const VERIFY_URL = 'https://discord.com/channels/1547021317193080882/1551336698003066980';

export function welcomeMessage(member) {
  const card = new EmbedBuilder()
    .setColor(0x8bd8f7)
    .setTitle(`Welcome to ${member.guild.name}!`)
    .setDescription([
      `Hey **${escapeMarkdown(member.user.username)}**, glad you're here!`,
      '',
      'Press **Verify** below to head to the verification channel and get started.',
      '',
      '━━━━━━━━━━━━━━━━',
      '*be comp. be xd.*',
    ].join('\n'))
    .setTimestamp();
  const icon = member.guild.iconURL({ size: 256 });
  if (icon) card.setThumbnail(icon);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Verify').setStyle(ButtonStyle.Link).setURL(VERIFY_URL),
  );
  return { embeds: [card], components: [buttons], allowedMentions: { parse: [] } };
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
