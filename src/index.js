import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, Events, GatewayIntentBits, InteractionContextType, MessageFlags,
  ModalBuilder, PermissionFlagsBits, REST, Routes, SlashCommandBuilder,
  TextInputBuilder, TextInputStyle, escapeMarkdown,
} from 'discord.js';
import { MAX_BAN, MAX_TIMEOUT, formatDuration, parseDuration } from './duration.js';
import { accessLevel, canPerform, visibleActions } from './policy.js';
import { addHistory, addNote, getHistory, getNotes, getState, loadState, saveState } from './store.js';

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error('Set DISCORD_TOKEN, CLIENT_ID, and GUILD_ID in .env');
}
loadState();

const actions = {
  ban: { verb: 'banned' },
  tempban: { verb: 'temporarily banned' },
  mute: { verb: 'timed out' },
  kick: { verb: 'kicked' },
  warn: { verb: 'warned' },
  unban: { verb: 'unbanned' },
};
const buttonLabels = { ban: 'Ban', tempban: 'Temp Ban', mute: 'Mute', kick: 'Kick', warn: 'Warn', unban: 'Unban', history: 'History' };
const buttonStyles = {
  ban: ButtonStyle.Danger, tempban: ButtonStyle.Danger, mute: ButtonStyle.Secondary,
  kick: ButtonStyle.Secondary, warn: ButtonStyle.Secondary, unban: ButtonStyle.Success, history: ButtonStyle.Primary,
};
const pending = new Map();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const CARD_COLOR = 0x8bd8f7;

const command = new SlashCommandBuilder()
  .setName('user')
  .setDescription('Moderate a member or view their moderation history')
  .setContexts(InteractionContextType.Guild)
  .addUserOption(option => option.setName('target').setDescription('Member to moderate or inspect'))
  .addStringOption(option => option.setName('user_id').setDescription('Discord user ID, including former members'));

async function reply(interaction, content) {
  const payload = {
    embeds: [new EmbedBuilder().setColor(CARD_COLOR).setDescription(content)],
    allowedMentions: { parse: [] },
  };
  if (interaction.isChatInputCommand() && interaction.commandName === 'user' && interaction.deferred && !interaction.replied) {
    await interaction.deleteReply();
    return interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
  }
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

function canActOn(actor, target, guild) {
  if (target.id === guild.ownerId || actor.id === target.id || target.id === client.user.id) return false;
  return actor.id === guild.ownerId || actor.roles.highest.comparePositionTo(target.roles.highest) > 0;
}

async function resolveMembers(interaction, targetId) {
  const [actor, target, bot] = await Promise.all([
    interaction.guild.members.fetch(interaction.user.id),
    interaction.guild.members.fetch({ user: targetId, force: true }).catch(() => null),
    interaction.guild.members.fetchMe(),
  ]);
  return { actor, target, bot };
}

async function fetchBan(guild, targetId) {
  return guild.bans.fetch({ user: targetId, force: true }).catch(error => {
    if (error.code === 10026) return null;
    throw error;
  });
}

function profileCard(guildId, targetId, target, ban, user) {
  const status = target ? 'In server' : ban ? 'Banned' : 'Not in server';
  const avatar = user?.displayAvatarURL({ size: 256 });
  const created = user?.createdTimestamp ? Math.floor(user.createdTimestamp / 1000) : null;
  const joined = target?.joinedTimestamp ? Math.floor(target.joinedTimestamp / 1000) : null;
  const timeout = target?.communicationDisabledUntilTimestamp;
  const warningCount = getState().history.filter(entry => entry.guildId === guildId && entry.targetId === targetId && entry.action === 'warn').length;
  const card = new EmbedBuilder()
    .setColor(CARD_COLOR)
    .setAuthor({ name: target?.displayName ?? user?.username ?? 'Unknown user', ...(avatar ? { iconURL: avatar } : {}) })
    .setDescription(`${user ? `@${escapeMarkdown(user.username)}` : 'Unknown account'} • ID: \`${targetId}\``)
    .addFields(
      { name: 'Server status', value: timeout && timeout > Date.now() ? `Timed out until <t:${Math.floor(timeout / 1000)}:f>` : status, inline: true },
      { name: 'Top role', value: target && target.roles.highest.id !== target.guild.id ? escapeMarkdown(target.roles.highest.name) : 'None', inline: true },
      { name: 'Warnings', value: String(warningCount), inline: true },
      { name: 'Account created', value: created ? `<t:${created}:D> (<t:${created}:R>)` : 'Unknown' },
      { name: 'Joined server', value: joined ? `<t:${joined}:D> (<t:${joined}:R>)` : 'Not currently a member' },
    );
  if (avatar) card.setThumbnail(avatar);
  return card;
}

function actionButtons(nonce, available) {
  const buttons = available.filter(action => action !== 'history').map(action => new ButtonBuilder()
    .setCustomId(`mod:choose:${nonce}:${action}`)
    .setLabel(buttonLabels[action])
    .setStyle(buttonStyles[action]));
  const rows = [];
  for (let index = 0; index < buttons.length; index += 3) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(index, index + 3)));
  }
  if (available.includes('history')) {
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder()
      .setCustomId(`mod:choose:${nonce}:history`)
      .setLabel(buttonLabels.history)
      .setStyle(buttonStyles.history)));
  }
  return rows;
}

function panelButtons(nonce, buttons) {
  return [new ActionRowBuilder().addComponents(buttons.map(([view, label]) =>
    new ButtonBuilder().setCustomId(`mod:view:${nonce}:${view}`).setLabel(label)
      .setStyle(view.startsWith('back') ? ButtonStyle.Secondary : ButtonStyle.Primary)))];
}

function panel(title, subtitle, description) {
  return new EmbedBuilder().setColor(CARD_COLOR).setTitle(title)
    .setDescription(`${subtitle}\n\n${description}`);
}

function panelPayload(nonce, item, view) {
  const subtitle = `Discord user \`${item.targetId}\``;
  if (view === 'profile') {
    return { embeds: [item.profile], components: actionButtons(nonce, item.available) };
  }
  if (view === 'records') {
    return {
      embeds: [panel('User records', subtitle, 'What would you like to open?')],
      components: panelButtons(nonce, [['notes', '📝 Notes'], ['history', '📁 Moderation History'], ['backprofile', 'Back']]),
    };
  }
  if (view === 'history') {
    const entries = getHistory(item.guildId, item.targetId);
    const total = getState().history.filter(entry => entry.guildId === item.guildId && entry.targetId === item.targetId).length;
    const lines = entries.map(entry => {
      const when = Math.floor(new Date(entry.at).getTime() / 1000);
      const duration = entry.duration ? ` (${formatDuration(entry.duration)})` : '';
      const reason = (entry.reason ?? 'No reason provided').replace(/\s+/g, ' ').slice(0, 80);
      return `• <t:${when}:f> — ${buttonLabels[entry.action] ?? entry.action}${duration} — ${reason} — by ${entry.moderatorId ?? 'bot'}`;
    });
    return {
      embeds: [panel('Moderation History', `${subtitle} • ${total} record(s)`, lines.join('\n') || 'No moderation history was found for this user.')],
      components: panelButtons(nonce, [['backrecords', 'Back']]),
    };
  }
  if (view === 'notes') {
    return {
      embeds: [panel('Notes', subtitle, 'Add a private moderator note or review existing notes.')],
      components: panelButtons(nonce, [['addnote', 'Add Note'], ['viewnotes', 'View Notes'], ['backrecords', 'Back']]),
    };
  }
  const notes = getNotes(item.guildId, item.targetId);
  const total = getState().notes.filter(note => note.guildId === item.guildId && note.targetId === item.targetId).length;
  const lines = notes.map(note => {
    const when = Math.floor(new Date(note.at).getTime() / 1000);
    return `• <t:${when}:f> — ${note.text.replace(/\s+/g, ' ').slice(0, 250)} — by ${note.authorId}`;
  });
  return {
    embeds: [panel('Private Notes', `${subtitle} • ${total} note(s)`, lines.join('\n') || 'No notes were found for this user.')],
    components: panelButtons(nonce, [['backnotes', 'Back']]),
  };
}

function saveHistorySafely(entry) {
  try {
    addHistory(entry);
    return true;
  } catch (error) {
    console.error('Action succeeded but history could not be saved:', error);
    return false;
  }
}

async function notify(target, guildName, action, reason, duration) {
  const card = new EmbedBuilder()
    .setColor(CARD_COLOR)
    .setTitle('Moderation notice')
    .setDescription(`You have been ${actions[action].verb} in **${escapeMarkdown(guildName)}**.`)
    .addFields({ name: 'Reason', value: reason });
  if (duration) card.addFields({ name: 'Duration', value: formatDuration(duration) });
  try {
    await target.send({ embeds: [card], allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    console.warn(`Could not DM ${target.id}:`, error);
    return false;
  }
}

function modalFor(action, nonce) {
  if (action === 'addnote') {
    return new ModalBuilder().setCustomId(`mod:note:${nonce}`).setTitle('Add moderator note')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('note').setLabel('Private note')
          .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(250)
          .setPlaceholder('Write a note visible only to moderators'),
      ));
  }
  const modal = new ModalBuilder().setCustomId(`mod:submit:${nonce}:${action}`).setTitle(`${buttonLabels[action]} user`);
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('reason').setLabel(action === 'ban' ? 'Reason (required)' : 'Reason (optional)')
      .setStyle(TextInputStyle.Paragraph).setRequired(action === 'ban')
      .setMaxLength(300).setPlaceholder(action === 'ban' ? 'Why is this user being permanently banned?' : 'No reason provided'),
  ));
  if (action === 'tempban' || action === 'mute') {
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('duration')
        .setLabel('Duration (required)')
        .setPlaceholder('Examples: 30m, 2h, 7d, 1w')
        .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8),
    ));
  }
  return modal;
}

async function handleCommand(interaction) {
  const selectedUser = interaction.options.getUser('target');
  const typedId = interaction.options.getString('user_id')?.trim();
  if ((selectedUser && typedId) || (!selectedUser && !typedId)) {
    return reply(interaction, 'Provide either target or user_id, but not both.');
  }
  if (typedId && !/^\d{17,20}$/.test(typedId)) return reply(interaction, 'user_id must be a Discord user ID.');
  await interaction.deferReply();
  const targetId = selectedUser?.id ?? typedId;
  const { actor, target, bot } = await resolveMembers(interaction, targetId);
  const level = accessLevel(actor.roles.cache.keys());
  if (level === 'none') return reply(interaction, 'Your roles do not allow use of this moderation command.');
  let ban = null;
  if (!target && bot.permissions.has(PermissionFlagsBits.BanMembers)) {
    try {
      ban = await fetchBan(interaction.guild, targetId);
    } catch (error) {
      console.warn(`Could not check ban status for ${targetId}:`, error);
    }
  }
  const user = target?.user ?? ban?.user ?? await client.users.fetch(targetId).catch(() => null);
  const canModerate = target && canActOn(actor, target, interaction.guild);
  const options = visibleActions(level, { canModerate: Boolean(canModerate), banned: Boolean(ban) });

  const nonce = randomUUID();
  pending.set(nonce, {
    actorId: actor.id, targetId, guildId: interaction.guildId,
    available: options, profile: profileCard(interaction.guildId, targetId, target, ban, user),
    expiresAt: Date.now() + 14 * 60_000,
  });
  await interaction.editReply({
    embeds: [pending.get(nonce).profile],
    components: actionButtons(nonce, options),
    allowedMentions: { parse: [] },
  });
}

function getPending(interaction, nonce) {
  const item = pending.get(nonce);
  if (!item || item.expiresAt < Date.now() || item.actorId !== interaction.user.id || item.guildId !== interaction.guildId) return null;
  return item;
}

async function showView(interaction, nonce, item, view) {
  await interaction.deferUpdate();
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  if (!canPerform(accessLevel(actor.roles.cache.keys()), 'history')) {
    return interaction.editReply({
      embeds: [panel('Access denied', `Discord user \`${item.targetId}\``, 'Your roles no longer allow access to these records.')],
      components: [],
    });
  }
  return interaction.editReply({ ...panelPayload(nonce, item, view), allowedMentions: { parse: [] } });
}

async function showPrivateRecords(interaction, nonce, item) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  if (!canPerform(accessLevel(actor.roles.cache.keys()), 'history')) {
    return reply(interaction, 'Your roles no longer allow access to these records.');
  }
  return interaction.editReply({
    ...panelPayload(nonce, item, 'records'),
    allowedMentions: { parse: [] },
  });
}

async function handleNavigation(interaction) {
  const [nonce, requested] = interaction.customId.slice('mod:view:'.length).split(':');
  const item = getPending(interaction, nonce);
  if (!item) return reply(interaction, 'This card expired. Run /user again.');
  if (item.used) return reply(interaction, 'This card was already used. Run /user again.');
  if (requested === 'addnote') return interaction.showModal(modalFor('addnote', nonce));
  const views = {
    notes: 'notes', history: 'history', viewnotes: 'viewnotes',
    backprofile: 'profile', backrecords: 'records', backnotes: 'notes',
  };
  const view = views[requested];
  if (!view) return reply(interaction, 'Unknown view.');
  return showView(interaction, nonce, item, view);
}

async function handleChoice(interaction) {
  const [nonce, action] = interaction.customId.slice('mod:choose:'.length).split(':');
  const item = getPending(interaction, nonce);
  if (!item) return reply(interaction, 'This card expired or belongs to another moderator. Run /user again.');
  if (item.used) return reply(interaction, 'This card was already used. Run /user again.');
  if (!item.available.includes(action)) return reply(interaction, 'That action is not available on this card.');
  if (action === 'history') return showPrivateRecords(interaction, nonce, item);
  if (!actions[action]) return reply(interaction, 'Unknown action.');
  await interaction.showModal(modalFor(action, nonce));
}

async function handleNoteSubmit(interaction) {
  const nonce = interaction.customId.slice('mod:note:'.length);
  const item = getPending(interaction, nonce);
  if (!item) return reply(interaction, 'This card expired. Run /user again.');
  if (item.used) return reply(interaction, 'This card was already used. Run /user again.');
  const note = interaction.fields.getTextInputValue('note').trim();
  if (!note) return reply(interaction, 'The note cannot be empty.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  if (!canPerform(accessLevel(actor.roles.cache.keys()), 'history')) {
    return reply(interaction, 'Your roles no longer allow access to moderator notes.');
  }
  try {
    addNote({ guildId: interaction.guildId, targetId: item.targetId, authorId: actor.id, text: note });
  } catch (error) {
    console.error('Could not save moderator note:', error);
    return reply(interaction, 'The note could not be saved. Check the bot console.');
  }
  return reply(interaction, 'Note saved. Use View Notes to see the updated list.');
}

async function handleSubmit(interaction) {
  const [nonce, action] = interaction.customId.slice('mod:submit:'.length).split(':');
  const item = getPending(interaction, nonce);
  if (!item || item.used || !item.available.includes(action) || !actions[action]) {
    return reply(interaction, 'This form expired or was already used. Run /user again.');
  }
  const { targetId } = item;
  const enteredReason = interaction.fields.fields.has('reason') ? interaction.fields.getTextInputValue('reason').trim() : '';
  if (action === 'ban' && !enteredReason) return reply(interaction, 'A reason is required for a permanent ban.');
  const reason = enteredReason || 'No reason provided';
  const duration = (action === 'tempban' || action === 'mute') && interaction.fields.fields.has('duration')
    ? interaction.fields.getTextInputValue('duration').trim() : '';
  const durationMs = duration ? parseDuration(duration, action === 'tempban' ? MAX_BAN : MAX_TIMEOUT) : null;
  if (action === 'mute' && !durationMs) return reply(interaction, 'Mute duration is required: 1m to 28d (e.g. 30m, 2h, 7d).');
  if (action === 'tempban' && !durationMs) return reply(interaction, 'Temp ban duration is required: 1m to 365d (e.g. 2h, 7d).');

  item.used = true;
  pending.delete(nonce);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { actor, target, bot } = await resolveMembers(interaction, targetId);
  const level = accessLevel(actor.roles.cache.keys());
  if (!canPerform(level, action)) return reply(interaction, 'Your roles no longer allow that action.');
  const auditReason = `${reason} | moderator ${actor.id}`;

  if (action === 'unban') {
    if (!bot.permissions.has(PermissionFlagsBits.BanMembers)) return reply(interaction, 'I need Ban Members permission to unban.');
    try {
      const ban = await fetchBan(interaction.guild, targetId);
      if (!ban) return reply(interaction, 'This user is no longer banned.');
      await interaction.guild.bans.remove(targetId, auditReason);
      getState().timedBans = getState().timedBans.filter(entry => entry.guildId !== interaction.guildId || entry.targetId !== targetId);
      const dmSent = await notify(ban.user, interaction.guild.name, action, reason);
      const historySaved = saveHistorySafely({ guildId: interaction.guildId, targetId, moderatorId: actor.id, action, reason, duration: null, dmSent });
      return reply(interaction, `${ban.user.username} was unbanned. DM ${dmSent ? 'sent' : 'could not be delivered'}.${historySaved ? '' : ' Warning: history could not be saved.'}`);
    } catch (error) {
      console.error('Unban failed:', error);
      return reply(interaction, 'Could not unban this user. Check my permissions and the console.');
    }
  }

  if (!target) return reply(interaction, 'The target is no longer in this server. No action was taken.');
  if (!canActOn(actor, target, interaction.guild)) return reply(interaction, 'Role hierarchy prevents this action.');
  if (((action === 'ban' || action === 'tempban') && (!bot.permissions.has(PermissionFlagsBits.BanMembers) || !target.bannable)) ||
      (action === 'kick' && (!bot.permissions.has(PermissionFlagsBits.KickMembers) || !target.kickable)) ||
      (action === 'mute' && (!bot.permissions.has(PermissionFlagsBits.ModerateMembers) || !target.moderatable))) {
    return reply(interaction, 'I lack the required permission or a higher role than the target.');
  }

  let dmSent;
  try {
    if (action === 'warn') {
      getState().warnings.push({ guildId: interaction.guildId, targetId, moderatorId: actor.id, reason, at: new Date().toISOString() });
      saveState();
      dmSent = await notify(target, interaction.guild.name, action, reason);
    } else if (action === 'mute') {
      await target.timeout(durationMs, auditReason);
      dmSent = await notify(target, interaction.guild.name, action, reason, duration);
    } else {
      // DM before removal: once kicked/banned, the bot may no longer share a server with this user.
      dmSent = await notify(target, interaction.guild.name, action, reason, duration || undefined);
      if (action === 'kick') await target.kick(auditReason);
      else {
        let entry;
        if (action === 'tempban') {
          entry = { guildId: interaction.guildId, targetId, expiresAt: Date.now() + durationMs, tag: randomUUID() };
          getState().timedBans.push(entry);
          saveState();
        }
        try {
          await target.ban({ reason: `${auditReason} | timed-ban:${entry?.tag ?? 'permanent'}` });
        } catch (error) {
          if (entry) {
            getState().timedBans = getState().timedBans.filter(b => b !== entry);
            saveState();
          }
          throw error;
        }
      }
    }
    const historySaved = saveHistorySafely({ guildId: interaction.guildId, targetId, moderatorId: actor.id, action, reason, duration: duration || null, dmSent });
    const label = action === 'ban' ? 'permanently banned' : actions[action].verb;
    return reply(interaction, `${target.user.username} was ${label}${duration ? ` for ${formatDuration(duration)}` : ''}. DM ${dmSent ? 'sent' : 'could not be delivered'}.${historySaved ? '' : ' Warning: history could not be saved.'}`);
  } catch (error) {
    console.error(`${action} failed:`, error);
    return reply(interaction, `Could not ${action} this member. Check my permissions and the console.${dmSent ? ' A DM may already have been sent.' : ''}`);
  }
}

let checkingBans = false;
async function checkTimedBans() {
  if (checkingBans) return;
  checkingBans = true;
  try {
    for (const entry of [...getState().timedBans]) {
      if (entry.expiresAt > Date.now()) continue;
      try {
        const guild = await client.guilds.fetch(entry.guildId);
        const ban = await fetchBan(guild, entry.targetId);
        // A manual unban followed by a new ban must never be undone by the old timer.
        if (ban?.reason?.includes(`timed-ban:${entry.tag}`)) {
          await guild.bans.remove(entry.targetId, 'Timed ban expired');
          getState().history.push({ guildId: entry.guildId, targetId: entry.targetId, moderatorId: null, action: 'unban', reason: 'Timed ban expired', at: new Date().toISOString() });
        }
        getState().timedBans = getState().timedBans.filter(b => b !== entry);
        saveState();
      } catch (error) {
        console.error(`Timed unban failed for ${entry.guildId}/${entry.targetId}; will retry:`, error);
      }
    }
  } finally {
    checkingBans = false;
  }
}

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (!interaction.inGuild() || !interaction.guild) return;
    if (interaction.isChatInputCommand() && interaction.commandName === 'user') await handleCommand(interaction);
    else if (interaction.isButton() && interaction.customId.startsWith('mod:choose:')) await handleChoice(interaction);
    else if (interaction.isButton() && interaction.customId.startsWith('mod:view:')) await handleNavigation(interaction);
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('mod:submit:')) await handleSubmit(interaction);
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('mod:note:')) await handleNoteSubmit(interaction);
  } catch (error) {
    console.error('Interaction failed:', error);
    if (interaction.isRepliable()) await reply(interaction, 'Something went wrong. Check the bot console.').catch(console.error);
  }
});

client.once(Events.ClientReady, () => {
  console.log(`Ready as ${client.user.tag}`);
  void checkTimedBans();
  setInterval(() => void checkTimedBans(), 30_000);
  setInterval(() => {
    for (const [nonce, item] of pending) if (item.expiresAt < Date.now()) pending.delete(nonce);
  }, 60_000);
});

// Guild-scoped commands update quickly while developing; no separate deploy script needed.
await new REST({ version: '10' }).setToken(DISCORD_TOKEN).post(
  Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: command.toJSON() },
);
await client.login(DISCORD_TOKEN);
