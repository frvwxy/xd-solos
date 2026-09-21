import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { accessLevel } from './policy.js';

export const JAIL_CHANNEL_ID = '1551586495301681173';
export const JAIL_ROLE_ID = '1551368750488354896';

export const jailCommand = new SlashCommandBuilder()
  .setName('jail')
  .setDescription('Restrict a member to the jail channel')
  .setContexts(InteractionContextType.Guild)
  .addUserOption(option => option.setName('member').setDescription('Member to jail').setRequired(true));

export const unjailCommand = new SlashCommandBuilder()
  .setName('unjail')
  .setDescription('Restore a jailed member and their saved roles')
  .setContexts(InteractionContextType.Guild)
  .addUserOption(option => option.setName('member').setDescription('Member to unjail').setRequired(true));

export function canUseJail(roleIds) {
  return accessLevel(roleIds) !== 'none';
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
  if (!bot.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error('The bot needs Manage Channels permission.');
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

  const channels = await member.guild.channels.fetch();
  const jailChannel = channels.get(JAIL_CHANNEL_ID);
  if (!jailChannel?.isTextBased() || typeof jailChannel.permissionOverwrites?.edit !== 'function') {
    throw new Error(`Jail channel ${JAIL_CHANNEL_ID} was not found or is not text-based.`);
  }

  const editable = [...channels.values()]
    .filter(channel => channel.guildId === member.guild.id && typeof channel.permissionOverwrites?.edit === 'function')
    .sort((a, b) => Number(a.id === JAIL_CHANNEL_ID) - Number(b.id === JAIL_CHANNEL_ID));
  const snapshots = [];
  let rolesRemoved = false;
  let jailRoleAdded = false;
  try {
    for (const channel of editable) {
      const changes = channel.id === JAIL_CHANNEL_ID
        ? { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }
        : { ViewChannel: false };
      const overwrite = channel.permissionOverwrites.cache?.get(member.id);
      snapshots.push({
        channelId: channel.id,
        hadOverwrite: Boolean(overwrite),
        previous: previousPermissions(overwrite, changes),
      });
      await channel.permissionOverwrites.edit(member.id, changes);
    }
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
    await restoreJailAccess(member.guild, member.id, snapshots).catch(restoreError => {
      console.error('Could not fully roll back jail channel overwrites:', restoreError);
    });
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
