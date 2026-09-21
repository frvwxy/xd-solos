import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { cardMessage, cardWithHeader } from './cards.js';

export const ACCEPT_ROLE_IDS = [
  '1551356027973148802',
  '1551356053168459867',
  '1551356073334804531',
  '1551356086076969010',
  '1547023363900313620',
  '1551398064621887528',
];

export const ACCEPT_COMMAND_ROLE_IDS = [
  '1547023404157378641',
  '1547023304219697152',
  '1547023959118192680',
  '1550346816351113356',
  '1551403954745905222',
];
const acceptCommandRoles = new Set(ACCEPT_COMMAND_ROLE_IDS);

export function canUseAccept(roleIds) {
  return [...roleIds].some(id => acceptCommandRoles.has(id));
}

export const acceptCommand = new SlashCommandBuilder()
  .setName('accept')
  .setDescription('Accept a member into xd and assign their roles')
  .setContexts(InteractionContextType.Guild)
  .addUserOption(option => option.setName('user').setDescription('Member to accept').setRequired(true));

function acceptanceCard(guild) {
  return cardWithHeader(guild,
    "**Congratulations!**\nWelcome to xd. We're glad to have you with us.\n\n*be comp. be xd.*",
    0x8bd8f7);
}

export function acceptanceMessage(guild) {
  return cardMessage(acceptanceCard(guild));
}

export function acceptanceChannelMessage(guild, userId) {
  return cardMessage(acceptanceCard(guild), userId);
}

export async function grantAcceptanceRoles(member, bot, moderatorId) {
  const missing = ACCEPT_ROLE_IDS.filter(id => !member.roles.cache.has(id));
  if (!missing.length) return { added: false, addedRoleIds: [] };
  if (!bot.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('The bot needs Manage Roles permission.');
  }
  const roles = await Promise.all(missing.map(id => member.guild.roles.fetch(id)));
  const missingRole = roles.findIndex(role => !role);
  if (missingRole !== -1) throw new Error(`Configured role ${missing[missingRole]} was not found in this server.`);
  if (roles.some(role => role.managed || bot.roles.highest.comparePositionTo(role) <= 0)) {
    throw new Error('The bot role must be above all acceptance roles, and they cannot be managed roles.');
  }
  await member.roles.add(missing, `Accepted into xd by ${moderatorId}`);
  return { added: true, addedRoleIds: missing };
}

export async function deliverAcceptance(member, channel) {
  const [dm, post] = await Promise.allSettled([
    Promise.resolve().then(() => member.send(acceptanceMessage(member.guild))),
    Promise.resolve().then(() => {
      if (typeof channel?.send !== 'function') throw new Error('Command channel cannot accept messages');
      return channel.send(acceptanceChannelMessage(member.guild, member.id));
    }),
  ]);
  return {
    dmSent: dm.status === 'fulfilled',
    channelSent: post.status === 'fulfilled',
    dmError: dm.status === 'rejected' ? dm.reason : null,
    channelError: post.status === 'rejected' ? post.reason : null,
  };
}
