import {
  ContainerBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder, TextDisplayBuilder,
} from 'discord.js';
import { isBotOwner } from './policy.js';
import { RAID_LOCK_CHANNEL_ID } from './raid.js';

export const KILL_SWITCH_CHANNEL_ID = RAID_LOCK_CHANNEL_ID;

export const killSwitchCommand = new SlashCommandBuilder()
  .setName('killswitch')
  .setDescription('Control the owner-only emergency lockdown')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand(subcommand => subcommand
    .setName('activate')
    .setDescription('Activate the emergency lockdown'))
  .addSubcommand(subcommand => subcommand
    .setName('deactivate')
    .setDescription('Deactivate the emergency lockdown'));

export function canUseKillSwitch(userId) {
  return isBotOwner(userId);
}

export function killSwitchIndicatorMessage() {
  const card = new ContainerBuilder()
    .setAccentColor(0xed4245)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '## 🚨 Kill Switch Activated\nThis channel is locked until the bot owner ends the lockdown.',
    ));
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [card],
    allowedMentions: { parse: [] },
  };
}
