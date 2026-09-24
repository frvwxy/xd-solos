import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { accessLevel } from './policy.js';

const ROLE_ASSIGN_CONCURRENCY = 4;

export const roleInCommand = new SlashCommandBuilder()
  .setName('rolein')
  .setDescription('Give a role to every member who has another role')
  .setContexts(InteractionContextType.Guild)
  .addRoleOption(option => option
    .setName('in_role')
    .setDescription('Members with this role will be selected')
    .setRequired(true))
  .addRoleOption(option => option
    .setName('role_to_give')
    .setDescription('Role to give to the selected members')
    .setRequired(true));

export function canUseRoleIn(roleIds, hasAdministrator = false) {
  return hasAdministrator || accessLevel(roleIds) === 'full';
}

function validateRoles(guild, bot, actor, inRole, roleToGive) {
  if (!bot.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('The bot needs Manage Roles permission.');
  }
  if (inRole.id === guild.id) throw new Error('The source role cannot be @everyone.');
  if (roleToGive.id === guild.id) throw new Error('The bot cannot assign @everyone.');
  if (inRole.id === roleToGive.id) throw new Error('Choose two different roles.');
  if (roleToGive.managed) throw new Error('The destination role is managed by Discord or an integration.');
  if (bot.roles.highest.comparePositionTo(roleToGive) <= 0) {
    throw new Error('The bot role must be above the destination role.');
  }
  if (actor.id !== guild.ownerId && actor.roles.highest.comparePositionTo(roleToGive) <= 0) {
    throw new Error('Your highest role must be above the destination role.');
  }
}

export async function giveRoleToMembersWithRole(guild, bot, actor, inRole, roleToGive) {
  validateRoles(guild, bot, actor, inRole, roleToGive);
  const members = await guild.members.fetch();
  const sourceMembers = [...members.values()].filter(member => (
    !member.user.bot && member.roles.cache.has(inRole.id)
  ));
  const targets = sourceMembers.filter(member => !member.roles.cache.has(roleToGive.id));
  const failures = [];
  let addedCount = 0;
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < targets.length) {
      const member = targets[nextIndex++];
      if (member.id === guild.ownerId || bot.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
        failures.push({ memberId: member.id, error: new Error('Role hierarchy prevents managing this member.') });
        continue;
      }
      try {
        await member.roles.add(roleToGive.id, `Bulk role assignment by ${actor.id} from role ${inRole.id}`);
        addedCount += 1;
      } catch (error) {
        failures.push({ memberId: member.id, error });
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(ROLE_ASSIGN_CONCURRENCY, targets.length) },
    () => worker(),
  ));
  return {
    matchedCount: sourceMembers.length,
    addedCount,
    alreadyHadCount: sourceMembers.length - targets.length,
    failedCount: failures.length,
    failures,
  };
}
