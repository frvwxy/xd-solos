import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, InteractionContextType, SlashCommandBuilder,
} from 'discord.js';
import { addDivider, cardMessage, cardWithHeader } from './cards.js';

export const TRYOUT_SERVER_URL = 'https://www.roblox.com/share?code=9bcd5321f7579243bd813e8f275554d4&type=Server';

export const tryoutCommand = new SlashCommandBuilder()
  .setName('tryout')
  .setDescription('Send a member the xd tryout instructions and private server link')
  .setContexts(InteractionContextType.Guild)
  .addUserOption(option => option.setName('user').setDescription('Member starting their tryout').setRequired(true));

function tryoutCard(guild) {
  const card = cardWithHeader(guild,
    '**Your tryout for xd is starting now!**\nJoin the private server below to begin.\nPlease make your way to the leash area.',
    0x8bd8f7);
  addDivider(card);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Join Private Server').setStyle(ButtonStyle.Link).setURL(TRYOUT_SERVER_URL),
  );
  return card.addActionRowComponents(row);
}

export function tryoutMessage(guild) {
  return cardMessage(tryoutCard(guild));
}

export function tryoutChannelMessage(guild, userId) {
  return cardMessage(tryoutCard(guild), userId);
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
