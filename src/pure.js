import {
  EmbedBuilder, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder,
} from 'discord.js';

export const PURE_OWNER_USER_ID = '635280852741390348';

export const pureCommand = new SlashCommandBuilder()
  .setName('pure')
  .setDescription('Warn a member and voice mute them if connected')
  .setContexts(InteractionContextType.Guild)
  .addUserOption(option => option
    .setName('user')
    .setDescription('Member to warn')
    .setRequired(true))
  .addStringOption(option => option
    .setName('reason')
    .setDescription('Reason for the warning')
    .setRequired(true)
    .setMaxLength(300));

export function canUsePure(userId) {
  return userId === PURE_OWNER_USER_ID;
}

export async function serverMuteIfInVoice(member, bot, moderatorId, reason) {
  if (!member.voice?.channelId) return { connected: false, muted: false, alreadyMuted: false };
  if (member.voice.serverMute) return { connected: true, muted: true, alreadyMuted: true };
  if (!bot.permissions.has(PermissionFlagsBits.MuteMembers)) {
    throw new Error('The bot needs Mute Members permission to server mute this member.');
  }
  if (bot.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
    throw new Error('The bot role must be above the member to server mute them.');
  }
  await member.voice.setMute(true, `${reason} | /pure by ${moderatorId}`);
  return { connected: true, muted: true, alreadyMuted: false };
}

export function purePublicMessage() {
  return {
    embeds: [new EmbedBuilder().setColor(0x8bd8f7).setDescription('pure is a chuddy chud')],
    allowedMentions: { parse: [] },
  };
}
