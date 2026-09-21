import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, InteractionContextType, SlashCommandBuilder,
} from 'discord.js';

export const TRYOUT_SERVER_URL = 'https://www.roblox.com/share?code=9bcd5321f7579243bd813e8f275554d4&type=Server';

export const tryoutCommand = new SlashCommandBuilder()
  .setName('tryout')
  .setDescription('Send a member the xd tryout instructions and private server link')
  .setContexts(InteractionContextType.Guild)
  .addUserOption(option => option.setName('user').setDescription('Member starting their tryout').setRequired(true));

export function tryoutMessage(guild) {
  const embed = new EmbedBuilder()
    .setColor(0x8bd8f7)
    .setTitle('Your tryout for xd is starting now!')
    .setDescription('Join the private server below to begin. Please make your way to the leash area.')
    .setTimestamp();
  const icon = guild.iconURL({ size: 256 });
  if (icon) embed.setThumbnail(icon);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Join Private Server').setStyle(ButtonStyle.Link).setURL(TRYOUT_SERVER_URL),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

export function tryoutChannelMessage(guild, userId) {
  return {
    ...tryoutMessage(guild),
    content: `<@${userId}>`,
    allowedMentions: { parse: [], users: [userId] },
  };
}

export async function deliverTryout(member, channel) {
  const [dm, post] = await Promise.allSettled([
    Promise.resolve().then(() => member.send(tryoutMessage(member.guild))),
    Promise.resolve().then(() => {
      if (typeof channel?.send !== 'function') throw new Error('Command channel cannot accept messages');
      return channel.send(tryoutChannelMessage(member.guild, member.id));
    }),
  ]);
  return {
    dmSent: dm.status === 'fulfilled',
    channelSent: post.status === 'fulfilled',
    dmError: dm.status === 'rejected' ? dm.reason : null,
    channelError: post.status === 'rejected' ? post.reason : null,
  };
}
