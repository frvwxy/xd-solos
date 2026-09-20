import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const moderationActions = ['ban', 'tempban', 'mute', 'kick', 'warn', 'unban'];
const labels = { ban: 'Ban', tempban: 'Temp Ban', mute: 'Mute', kick: 'Kick', warn: 'Warn', unban: 'Unban', history: 'History' };

export function actionButtons(nonce, available) {
  const rows = [];
  const buttons = moderationActions.map(action => new ButtonBuilder()
    .setCustomId(`mod:choose:${nonce}:${action}`)
    .setLabel(labels[action])
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(!available.includes(action)));

  for (let index = 0; index < buttons.length; index += 3) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(index, index + 3)));
  }
  rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder()
    .setCustomId(`mod:choose:${nonce}:history`)
    .setLabel(labels.history)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(!available.includes('history'))));
  return rows;
}
