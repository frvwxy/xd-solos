import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, ContainerBuilder, EmbedBuilder, Events, GatewayIntentBits, InteractionContextType, MessageFlags,
  ModalBuilder, PermissionFlagsBits, REST, Routes, SlashCommandBuilder,
  SectionBuilder, SeparatorBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle, ThumbnailBuilder, escapeMarkdown,
} from 'discord.js';
import { MAX_BAN, MAX_TIMEOUT, formatDuration, parseDuration } from './duration.js';
import { accessLevel, canPerform, unbanUnavailableReason, visibleActions } from './policy.js';
import { actionButtons } from './buttons.js';
import { notificationMessage } from './notifications.js';
import { postModLog } from './modlogs.js';
import { postWelcome } from './welcome.js';
import { canUseTryout, deliverTryout, tryoutCommand } from './tryout.js';
import { acceptCommand, canUseAccept, deliverAcceptance, grantAcceptanceRoles } from './accept.js';
import { postAcceptanceLog } from './acceptlogs.js';
import { updateMemberCount } from './membercount.js';
import { CARD_IDLE_MS, getPendingCard } from './sessions.js';
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
const pending = new Map();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
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

function profileCard(guildId, targetId, target, ban, user, nonce, available, unbanReason) {
  const status = target ? 'In server' : ban ? 'Banned' : 'Not in server';
  const avatar = user?.displayAvatarURL({ size: 256 });
  const created = user?.createdTimestamp ? Math.floor(user.createdTimestamp / 1000) : null;
  const joined = target?.joinedTimestamp ? Math.floor(target.joinedTimestamp / 1000) : null;
  const timeout = target?.communicationDisabledUntilTimestamp;
  const warningCount = getState().history.filter(entry => entry.guildId === guildId && entry.targetId === targetId && entry.action === 'warn').length;
  const statusText = timeout && timeout > Date.now() ? `Timed out until <t:${Math.floor(timeout / 1000)}:f>` : status;
  const topRole = target && target.roles.highest.id !== target.guild.id ? escapeMarkdown(target.roles.highest.name) : 'None';
  const warningLabel = `${warningCount} warning${warningCount === 1 ? '' : 's'}`;
  const identity = new TextDisplayBuilder().setContent([
    `**${escapeMarkdown(target?.displayName ?? user?.username ?? 'Unknown user')}**`,
    `${user ? `@${escapeMarkdown(user.username)}` : 'Unknown account'} • ID: \`${targetId}\``,
    `${statusText} • ${warningLabel}`,
    `Top role: ${topRole}`,
  ].join('\n'));
  const details = new TextDisplayBuilder().setContent([
    `**Created:** ${created ? `<t:${created}:D> (<t:${created}:R>)` : 'Unknown'}`,
    `**Joined:** ${joined ? `<t:${joined}:D> (<t:${joined}:R>)` : 'Not currently a member'}`,
    ...(unbanReason ? [`-# Unban unavailable: ${unbanReason}`] : []),
  ].join('\n'));
  const card = new ContainerBuilder().setAccentColor(CARD_COLOR);
  if (avatar) {
    card.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(identity)
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar)));
  } else {
    card.addTextDisplayComponents(identity);
  }
  card.addTextDisplayComponents(details);
  card.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  card.addActionRowComponents(...actionButtons(nonce, available));
  return card;
}

function panelButtons(nonce, buttons) {
  return [new ActionRowBuilder().addComponents(buttons.map(([view, label]) =>
    new ButtonBuilder().setCustomId(`mod:view:${nonce}:${view}`).setLabel(label)
      .setStyle(ButtonStyle.Secondary)))];
}

function panel(title, subtitle, description) {
  return new ContainerBuilder().setAccentColor(CARD_COLOR)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${title}**\n${subtitle}\n\n${description}`));
}

function panelPayload(nonce, item, view) {
  const subtitle = `Discord user \`${item.targetId}\``;
  if (view === 'profile') {
    return { components: [item.profile] };
  }
  if (view === 'records') {
    const card = panel('User records', subtitle, 'What would you like to open?');
    card.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    card.addActionRowComponents(...panelButtons(nonce, [['notes', '📝 Notes'], ['history', '📁 Moderation History'], ['backprofile', 'Back']]));
    return { components: [card] };
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
    const card = panel('Moderation History', `${subtitle} • ${total} record(s)`, lines.join('\n') || 'No moderation history was found for this user.');
    card.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    card.addActionRowComponents(...panelButtons(nonce, [['backrecords', 'Back']]));
    return { components: [card] };
  }
  if (view === 'notes') {
    const card = panel('Notes', subtitle, 'Add a private moderator note or review existing notes.');
    card.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    card.addActionRowComponents(...panelButtons(nonce, [['addnote', 'Add Note'], ['viewnotes', 'View Notes'], ['backrecords', 'Back']]));
    return { components: [card] };
  }
  const notes = getNotes(item.guildId, item.targetId);
  const total = getState().notes.filter(note => note.guildId === item.guildId && note.targetId === item.targetId).length;
  const lines = notes.map(note => {
    const when = Math.floor(new Date(note.at).getTime() / 1000);
    return `• <t:${when}:f> — ${note.text.replace(/\s+/g, ' ').slice(0, 250)} — by ${note.authorId}`;
  });
  const card = panel('Private Notes', `${subtitle} • ${total} note(s)`, lines.join('\n') || 'No notes were found for this user.');
  card.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  card.addActionRowComponents(...panelButtons(nonce, [['backnotes', 'Back']]));
  return { components: [card] };
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

async function notify(target, guild, moderator, action, reason, duration) {
  try {
    await target.send(notificationMessage(guild, moderator, action, reason, duration));
    return true;
  } catch (error) {
    console.warn(`Could not DM ${target.id}:`, error);
    return false;
  }
}

function modalFor(action, nonce, formId) {
  if (action === 'addnote') {
    return new ModalBuilder().setCustomId(`mod:note:${nonce}`).setTitle('Add moderator note')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('note').setLabel('Private note')
          .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(250)
          .setPlaceholder('Write a note visible only to moderators'),
      ));
  }
  const modal = new ModalBuilder().setCustomId(`mod:submit:${nonce}:${action}:${formId}`).setTitle(`${buttonLabels[action]} user`);
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
  let banCheckFailed = false;
  const canCheckBans = bot.permissions.has(PermissionFlagsBits.BanMembers);
  if (!target && canCheckBans) {
    try {
      ban = await fetchBan(interaction.guild, targetId);
    } catch (error) {
      banCheckFailed = true;
      console.warn(`Could not check ban status for ${targetId}:`, error);
    }
  }
  const user = target?.user ?? ban?.user ?? await client.users.fetch(targetId).catch(() => null);
  const canModerate = target && canActOn(actor, target, interaction.guild);
  const options = visibleActions(level, { canModerate: Boolean(canModerate), banned: Boolean(ban) });
  const unbanReason = unbanUnavailableReason(level, {
    inServer: Boolean(target), banned: Boolean(ban), canCheckBans, banCheckFailed,
  });

  const nonce = randomUUID();
  pending.set(nonce, {
    actorId: actor.id, targetId, guildId: interaction.guildId,
    available: options, profile: profileCard(interaction.guildId, targetId, target, ban, user, nonce, options, unbanReason),
    forms: new Map(), busy: false,
    expiresAt: Date.now() + CARD_IDLE_MS,
  });
  await interaction.editReply({
    content: null,
    embeds: null,
    flags: MessageFlags.IsComponentsV2,
    components: [pending.get(nonce).profile],
    allowedMentions: { parse: [] },
  });
}

async function handleTryout(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  if (!canUseTryout(actor.roles.cache.keys())) {
    return reply(interaction, 'Your roles do not allow use of this command.');
  }
  const user = interaction.options.getUser('user');
  if (!user || user.bot) return reply(interaction, 'Choose a server member, not a bot.');
  const member = await interaction.guild.members.fetch({ user: user.id, force: true }).catch(() => null);
  if (!member) return reply(interaction, 'That user is not in this server. No tryout instructions were sent.');
  const channel = interaction.channel ?? await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);
  const result = await deliverTryout(member, channel);
  if (result.dmError) console.warn(`Could not send tryout DM to ${user.id}:`, result.dmError);
  if (result.channelError) console.warn(`Could not post tryout in ${interaction.channelId}:`, result.channelError);
  return reply(interaction, `Tryout for ${escapeMarkdown(user.username)}: channel post ${result.channelSent ? 'sent' : 'failed'}; DM ${result.dmSent ? 'sent' : 'failed'}.`);
}

async function handleAccept(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  if (!canUseAccept(actor.roles.cache.keys())) {
    return reply(interaction, 'Your roles do not allow use of /accept.');
  }
  const user = interaction.options.getUser('user');
  const scoreCount = interaction.options.getInteger('score_count');
  if (!user || user.bot) return reply(interaction, 'Choose a server member, not a bot.');
  const member = await interaction.guild.members.fetch({ user: user.id, force: true }).catch(() => null);
  if (!member) return reply(interaction, 'That user is not in this server. No roles or announcement were sent.');
  if (!canActOn(actor, member, interaction.guild)) return reply(interaction, 'Role hierarchy prevents you from accepting this member.');

  const bot = await interaction.guild.members.fetchMe();
  let addedRoleIds;
  try {
    const result = await grantAcceptanceRoles(member, bot, actor.id);
    if (!result.added) return reply(interaction, `${escapeMarkdown(user.username)} already has all acceptance roles. No duplicate announcement was sent.`);
    addedRoleIds = result.addedRoleIds;
  } catch (error) {
    console.error(`Could not accept ${user.id}:`, error);
    return reply(interaction, `Could not assign the acceptance roles to ${escapeMarkdown(user.username)}. ${error.message}`);
  }

  const channel = interaction.channel ?? await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);
  const result = await deliverAcceptance(member, channel, scoreCount);
  if (result.dmError) console.warn(`Could not send acceptance DM to ${user.id}:`, result.dmError);
  if (result.channelError) console.warn(`Could not post acceptance in ${interaction.channelId}:`, result.channelError);
  let memberCount = null;
  let countUpdated = true;
  try {
    ({ count: memberCount } = await updateMemberCount(interaction.guild));
  } catch (error) {
    countUpdated = false;
    console.error('Could not update the xd member count channel:', error);
  }
  const logSent = await postAcceptanceLog(interaction.guild, {
    targetId: user.id, moderatorId: actor.id, addedRoleIds,
    channelSent: result.channelSent, dmSent: result.dmSent, scoreCount,
  });
  return reply(interaction, `${escapeMarkdown(user.username)} received the acceptance roles. Channel announcement ${result.channelSent ? 'sent' : 'failed'}; DM ${result.dmSent ? 'sent' : 'failed'}.${countUpdated ? ` Member count updated to ${memberCount}.` : ' Warning: member count channel could not be updated.'}${logSent ? '' : ' Warning: acceptance log could not be posted.'}`);
}

function getPending(interaction, nonce) {
  return getPendingCard(pending, nonce, interaction.user.id, interaction.guildId);
}

async function showView(interaction, nonce, item, view) {
  await interaction.deferUpdate();
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  if (!canPerform(accessLevel(actor.roles.cache.keys()), 'history')) {
    return interaction.editReply({ components: [panel('Access denied', `Discord user \`${item.targetId}\``, 'Your roles no longer allow access to these records.')] });
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
    content: null,
    embeds: null,
    flags: MessageFlags.IsComponentsV2,
    ...panelPayload(nonce, item, 'records'),
    allowedMentions: { parse: [] },
  });
}

async function handleNavigation(interaction) {
  const [nonce, requested] = interaction.customId.slice('mod:view:'.length).split(':');
  const item = getPending(interaction, nonce);
  if (!item) return reply(interaction, 'This card expired. Run /user again.');
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
  if (!item.available.includes(action)) return reply(interaction, 'That action is not available on this card.');
  if (action === 'history') return showPrivateRecords(interaction, nonce, item);
  if (!actions[action]) return reply(interaction, 'Unknown action.');
  const formId = randomUUID();
  item.forms.set(formId, action);
  try {
    await interaction.showModal(modalFor(action, nonce, formId));
  } catch (error) {
    item.forms.delete(formId);
    throw error;
  }
}

async function handleNoteSubmit(interaction) {
  const nonce = interaction.customId.slice('mod:note:'.length);
  const item = getPending(interaction, nonce);
  if (!item) return reply(interaction, 'This card expired. Run /user again.');
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
  const [nonce, action, formId] = interaction.customId.slice('mod:submit:'.length).split(':');
  const item = getPending(interaction, nonce);
  if (!item || !item.available.includes(action) || !actions[action] || item.forms.get(formId) !== action) {
    return reply(interaction, 'This form expired or was already submitted. Open the action again from /user.');
  }
  item.forms.delete(formId);
  if (item.busy) return reply(interaction, 'Another action from this card is in progress. Try again shortly.');
  const enteredReason = interaction.fields.fields.has('reason') ? interaction.fields.getTextInputValue('reason').trim() : '';
  if (action === 'ban' && !enteredReason) return reply(interaction, 'A reason is required for a permanent ban.');
  const reason = enteredReason || 'No reason provided';
  const duration = (action === 'tempban' || action === 'mute') && interaction.fields.fields.has('duration')
    ? interaction.fields.getTextInputValue('duration').trim() : '';
  const durationMs = duration ? parseDuration(duration, action === 'tempban' ? MAX_BAN : MAX_TIMEOUT) : null;
  if (action === 'mute' && !durationMs) return reply(interaction, 'Mute duration is required: 1m to 28d (e.g. 30m, 2h, 7d).');
  if (action === 'tempban' && !durationMs) return reply(interaction, 'Temp ban duration is required: 1m to 365d (e.g. 2h, 7d).');

  item.busy = true;
  try {
    return await performAction(interaction, item, action, reason, duration, durationMs);
  } finally {
    item.busy = false;
  }
}

async function performAction(interaction, item, action, reason, duration, durationMs) {
  const { targetId } = item;
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
      const dmSent = await notify(ban.user, interaction.guild, actor, action, reason);
      const historySaved = saveHistorySafely({ guildId: interaction.guildId, targetId, moderatorId: actor.id, action, reason, duration: null, dmSent });
      const logSent = await postModLog(interaction.guild, { targetId, moderatorId: actor.id, action, reason, duration: null, dmSent });
      return reply(interaction, `${ban.user.username} was unbanned. DM ${dmSent ? 'sent' : 'could not be delivered'}.${historySaved ? '' : ' Warning: history could not be saved.'}${logSent ? '' : ' Warning: moderation log could not be posted.'}`);
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
      dmSent = await notify(target, interaction.guild, actor, action, reason);
    } else if (action === 'mute') {
      await target.timeout(durationMs, auditReason);
      dmSent = await notify(target, interaction.guild, actor, action, reason, duration);
    } else {
      // DM before removal: once kicked/banned, the bot may no longer share a server with this user.
      dmSent = await notify(target, interaction.guild, actor, action, reason, duration || undefined);
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
    const logSent = await postModLog(interaction.guild, { targetId, moderatorId: actor.id, action, reason, duration: duration || null, dmSent });
    const label = action === 'ban' ? 'permanently banned' : actions[action].verb;
    return reply(interaction, `${target.user.username} was ${label}${duration ? ` for ${formatDuration(duration)}` : ''}. DM ${dmSent ? 'sent' : 'could not be delivered'}.${historySaved ? '' : ' Warning: history could not be saved.'}${logSent ? '' : ' Warning: moderation log could not be posted.'}`);
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
        let unbanned = false;
        // A manual unban followed by a new ban must never be undone by the old timer.
        if (ban?.reason?.includes(`timed-ban:${entry.tag}`)) {
          await guild.bans.remove(entry.targetId, 'Timed ban expired');
          getState().history.push({ guildId: entry.guildId, targetId: entry.targetId, moderatorId: null, action: 'unban', reason: 'Timed ban expired', at: new Date().toISOString() });
          unbanned = true;
        }
        getState().timedBans = getState().timedBans.filter(b => b !== entry);
        saveState();
        if (unbanned) {
          await postModLog(guild, {
            targetId: entry.targetId, moderatorId: null, action: 'unban',
            reason: 'Timed ban expired', duration: null, dmSent: null,
          });
        }
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
    else if (interaction.isChatInputCommand() && interaction.commandName === 'tryout') await handleTryout(interaction);
    else if (interaction.isChatInputCommand() && interaction.commandName === 'accept') await handleAccept(interaction);
    else if (interaction.isButton() && interaction.customId.startsWith('mod:choose:')) await handleChoice(interaction);
    else if (interaction.isButton() && interaction.customId.startsWith('mod:view:')) await handleNavigation(interaction);
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('mod:submit:')) await handleSubmit(interaction);
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('mod:note:')) await handleNoteSubmit(interaction);
  } catch (error) {
    console.error('Interaction failed:', error);
    if (interaction.isRepliable()) await reply(interaction, 'Something went wrong. Check the bot console.').catch(console.error);
  }
});

client.on(Events.GuildMemberAdd, member => {
  if (member.guild.id === GUILD_ID && !member.user.bot) void postWelcome(member);
});

client.once(Events.ClientReady, () => {
  console.log(`Ready as ${client.user.tag}`);
  void checkTimedBans();
  setInterval(() => void checkTimedBans(), 30_000);
  setInterval(() => {
    for (const [nonce, item] of pending) if (item.expiresAt < Date.now()) pending.delete(nonce);
  }, 60_000);
});

// POST upserts each guild command without deleting any other commands in the server.
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
for (const guildCommand of [command, tryoutCommand, acceptCommand]) {
  await rest.post(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: guildCommand.toJSON() });
}
await client.login(DISCORD_TOKEN);
