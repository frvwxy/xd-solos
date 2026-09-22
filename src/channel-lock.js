import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { MEMBER_ROLE_ID } from './membercount.js';

export const CHANNEL_LOCK_ROLE_ID = '1547023404157378641';

export const lockCommand = new SlashCommandBuilder()
  .setName('lock')
  .setDescription('Prevent members from sending messages in this channel')
  .setContexts(InteractionContextType.Guild);

export const unlockCommand = new SlashCommandBuilder()
  .setName('unlock')
  .setDescription('Restore member messaging permissions in this channel')
  .setContexts(InteractionContextType.Guild);

export function canManageChannelLock(roleIds, hasAdministrator = false) {
  return hasAdministrator || [...roleIds].includes(CHANNEL_LOCK_ROLE_ID);
}

async function validate(channel, guild, bot) {
  if (channel.guildId !== guild.id || typeof channel.permissionOverwrites?.edit !== 'function') {
    throw new Error('This channel does not support permission overwrites.');
  }
  if (!bot.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error('The bot needs Manage Channels permission.');
  }
  const memberRole = await guild.roles.fetch(MEMBER_ROLE_ID);
  if (!memberRole) throw new Error(`Member role ${MEMBER_ROLE_ID} was not found in this server.`);
  if (memberRole.managed || bot.roles.highest.comparePositionTo(memberRole) <= 0) {
    throw new Error('The bot role must be above the member role, and the member role cannot be managed.');
  }
}

export function currentSendMessagesOverwrite(channel) {
  const overwrite = channel.permissionOverwrites.cache?.get(MEMBER_ROLE_ID);
  if (overwrite?.allow.has(PermissionFlagsBits.SendMessages)) return true;
  if (overwrite?.deny.has(PermissionFlagsBits.SendMessages)) return false;
  return null;
}

export async function lockChannel(channel, guild, bot) {
  await validate(channel, guild, bot);
  const previous = currentSendMessagesOverwrite(channel);
  await channel.permissionOverwrites.edit(MEMBER_ROLE_ID, { SendMessages: false });
  return { previous };
}

export async function unlockChannel(channel, guild, bot, previous) {
  await validate(channel, guild, bot);
  await channel.permissionOverwrites.edit(MEMBER_ROLE_ID, { SendMessages: previous });
}
