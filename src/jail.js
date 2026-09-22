import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { accessLevel } from './policy.js';

export const JAIL_CHANNEL_ID = '1551586495301681173';
export const JAIL_ROLE_ID = '1551368750488354896';

export const jailCommand = new SlashCommandBuilder()
  .setName('jail')
  .setDescription('Jail a member')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand(subcommand => subcommand
    .setName('member')
    .setDescription('Restrict a member to the jail channel')
    .addUserOption(option => option.setName('user').setDescription('Member to jail').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Optional reason for jailing this member')));

export const unjailCommand = new SlashCommandBuilder()
  .setName('unjail')
  .setDescription('Restore a jailed member and their saved roles')
  .setContexts(InteractionContextType.Guild)
  .addUserOption(option => option.setName('member').setDescription('Member to unjail').setRequired(true));

export function canUseJail(roleIds) {
  return accessLevel(roleIds) !== 'none';
}

export async function applyJailRolePermissions(channel) {
  if (typeof channel.permissionOverwrites?.edit !== 'function') return false;
  const permissions = channel.id === JAIL_CHANNEL_ID
    ? { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }
    : { ViewChannel: false };
  await channel.permissionOverwrites.edit(JAIL_ROLE_ID, permissions);
  return true;
}

const permissionBits = {
  ViewChannel: PermissionFlagsBits.ViewChannel,
  SendMessages: PermissionFlagsBits.SendMessages,
  ReadMessageHistory: PermissionFlagsBits.ReadMessageHistory,
};

function previousPermissions(overwrite, changes) {
  return Object.fromEntries(Object.keys(changes).map(name => {
    const bit = permissionBits[name];
    if (overwrite?.allow.has(bit)) return [name, true];
    if (overwrite?.deny.has(bit)) return [name, false];
    return [name, null];
  }));
}

async function restoreSnapshot(guild, targetId, snapshot) {
  const channel = await guild.channels.fetch(snapshot.channelId).catch(() => null);
  if (!channel?.permissionOverwrites) return;
  if (snapshot.hadOverwrite) {
    await channel.permissionOverwrites.edit(targetId, snapshot.previous);
  } else {
    await channel.permissionOverwrites.delete(targetId);
  }
}

export async function restoreJailAccess(guild, targetId, snapshots) {
  const failures = [];
  for (const snapshot of [...snapshots].reverse()) {
    try {
      await restoreSnapshot(guild, targetId, snapshot);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Could not restore every channel permission overwrite.');
}

export async function jailMember(member, bot, moderatorId) {
  if (!bot.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('The bot needs Manage Roles permission.');
  }
  if (bot.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
    throw new Error('The bot role must be above the member being jailed.');
  }
  const jailRole = await member.guild.roles.fetch(JAIL_ROLE_ID);
  if (!jailRole) throw new Error(`Jail role ${JAIL_ROLE_ID} was not found in this server.`);
  if (jailRole.managed || bot.roles.highest.comparePositionTo(jailRole) <= 0) {
    throw new Error('The bot role must be above the jail role, and the jail role cannot be managed.');
  }
  if (member.roles.cache.has(JAIL_ROLE_ID)) return { added: false, snapshots: [], removedRoleIds: [] };

  const removedRoleIds = [...member.roles.cache.values()]
    .filter(role => role.id !== member.guild.id && role.id !== JAIL_ROLE_ID && !role.managed)
    .map(role => role.id);

  const snapshots = [];
  let rolesRemoved = false;
  let jailRoleAdded = false;
  try {
    if (removedRoleIds.length) {
      await member.roles.remove(removedRoleIds, `Jailed by ${moderatorId}`);
      rolesRemoved = true;
    }
    await member.roles.add(JAIL_ROLE_ID, `Jailed by ${moderatorId}`);
    jailRoleAdded = true;
    return { added: true, snapshots, removedRoleIds };
  } catch (error) {
    if (jailRoleAdded) await member.roles.remove(JAIL_ROLE_ID, 'Rolling back failed jail').catch(console.error);
    if (rolesRemoved && removedRoleIds.length) {
      await member.roles.add(removedRoleIds, 'Restoring roles after failed jail').catch(console.error);
    }
    throw error;
  }
}

export async function unjailMember(member, bot, record, moderatorId, roleAlreadyRemoved = false) {
  if (!bot.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('The bot needs Manage Roles permission.');
  }
  if (!bot.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error('The bot needs Manage Channels permission.');
  }
  const roles = await Promise.all(record.removedRoleIds.map(id => member.guild.roles.fetch(id)));
  const restorableRoleIds = roles
    .filter(role => role && !role.managed && bot.roles.highest.comparePositionTo(role) > 0)
    .map(role => role.id);
  const skippedRoleIds = record.removedRoleIds.filter(id => !restorableRoleIds.includes(id));
  const reason = moderatorId ? `Unjailed by ${moderatorId}` : 'Jail role removed manually';

  if (restorableRoleIds.length) await member.roles.add(restorableRoleIds, reason);
  if (!roleAlreadyRemoved && member.roles.cache.has(JAIL_ROLE_ID)) {
    await member.roles.remove(JAIL_ROLE_ID, reason);
  }
  await restoreJailAccess(member.guild, member.id, record.snapshots);
  return { restoredRoleIds: restorableRoleIds, skippedRoleIds };
}
