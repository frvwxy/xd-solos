import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const moderationActions = ['ban', 'tempban', 'mute', 'kick', 'warn', 'unban'];
const labels = { ban: 'Ban', tempban: 'Temp Ban', mute: 'Mute', kick: 'Kick', warn: 'Warn', unban: 'Unban', history: 'History' };

export function actionButtons(nonce, available) {
  const buttons = moderationActions.map(action => new ButtonBuilder()
    .setCustomId(`mod:choose:${nonce}:${action}`)
    .setLabel(labels[action])
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(!available.includes(action)));
  const history = new ButtonBuilder()
    .setCustomId(`mod:choose:${nonce}:history`)
    .setLabel(labels.history)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(!available.includes('history'));
  return [
    new ActionRowBuilder().addComponents(buttons.slice(0, 3)),
    new ActionRowBuilder().addComponents([...buttons.slice(3), history]),
  ];
}
