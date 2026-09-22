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
import {
  canManageChannelLock, lockChannel, lockCommand, unlockChannel, unlockCommand,
} from './channel-lock.js';
import {
  JAIL_ROLE_ID, applyJailRolePermissions, canUseJail, jailCommand, jailMember,
  restoreJailAccess, unjailCommand, unjailMember,
} from './jail.js';
import {
  RAID_ANNOUNCEMENT_CHANNEL_ID, RAID_LOCK_CHANNEL_ID, activeRaidChannelMessage,
  canUseRaid, endedRaidAnnouncementMessage, getRobloxJoinInfo, raidAnnouncementMessage,
  raidCommand, raidEndMessage, resolveRobloxUser,
} from './raid.js';
import { CARD_IDLE_MS, getPendingCard } from './sessions.js';
import {
  addHistory, addNote, getActiveRaid, getChannelLock, getHistory, getJail, getNotes, getState,
  loadState, removeActiveRaid, removeChannelLock, removeJail, saveState, setActiveRaid,
  setChannelLock, setJail,
} from './store.js';

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
const buttonLabels = { ban: 'Ban', tempban: 'Temp Ban', mute: 'Mute', kick: 'Kick', warn: 'Warn', unban: 'Unban', jail: 'Jail', unjail: 'Unjail', history: 'History' };
const pending = new Map();
const activeUnjails = new Set();
const activeRaidOperations = new Set();
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
      const reason = entry.reason ? ` — ${entry.reason.replace(/\s+/g, ' ').slice(0, 80)}` : '';
      return `• <t:${when}:f> — ${buttonLabels[entry.action] ?? entry.action}${duration}${reason} — by ${entry.moderatorId ?? 'bot'}`;
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
  const staffScore = interaction.options.getInteger('staff_score');
  const memberScore = interaction.options.getInteger('member_score');
  const scores = staffScore === null && memberScore === null ? null : { staffScore, memberScore };
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
  const result = await deliverAcceptance(member, channel, scores);
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
    channelSent: result.channelSent, dmSent: result.dmSent, scores,
  });
  return reply(interaction, `${escapeMarkdown(user.username)} received the acceptance roles. Channel announcement ${result.channelSent ? 'sent' : 'failed'}; DM ${result.dmSent ? 'sent' : 'failed'}.${countUpdated ? ` Member count updated to ${memberCount}.` : ' Warning: member count channel could not be updated.'}${logSent ? '' : ' Warning: acceptance log could not be posted.'}`);
}

async function handleJail(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  if (!canUseJail(actor.roles.cache.keys())) {
    return reply(interaction, 'Your roles do not allow use of /jail.');
  }
  const user = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason')?.trim() || null;
  if (!user || user.bot) return reply(interaction, 'Choose a server member, not a bot.');
  const member = await interaction.guild.members.fetch({ user: user.id, force: true }).catch(() => null);
  if (!member) return reply(interaction, 'That user is not in this server.');
  if (!canActOn(actor, member, interaction.guild)) return reply(interaction, 'Role hierarchy prevents you from jailing this member.');
  if (member.permissions.has(PermissionFlagsBits.Administrator)) {
    return reply(interaction, 'Administrators cannot be jailed because they bypass channel permission overwrites.');
  }

  const bot = await interaction.guild.members.fetchMe();
  let snapshots;
  let removedRoleIds;
  try {
    const result = await jailMember(member, bot, actor.id);
    if (!result.added) return reply(interaction, `${escapeMarkdown(user.username)} is already jailed.`);
    snapshots = result.snapshots;
    removedRoleIds = result.removedRoleIds;
    setJail({
      guildId: interaction.guildId,
      targetId: user.id,
      moderatorId: actor.id,
      snapshots,
      removedRoleIds: result.removedRoleIds,
      at: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`Could not jail ${user.id}:`, error);
    if (snapshots) {
      await member.roles.remove(JAIL_ROLE_ID, 'Jail record could not be saved; rolling back').catch(console.error);
      if (removedRoleIds?.length) {
        await member.roles.add(removedRoleIds, 'Jail record could not be saved; restoring roles').catch(console.error);
      }
      await restoreJailAccess(interaction.guild, user.id, snapshots).catch(console.error);
    }
    return reply(interaction, `Could not jail ${escapeMarkdown(user.username)}. ${error.message}`);
  }

  const dmSent = await notify(member, interaction.guild, actor, 'jail', reason, null);
  const historySaved = saveHistorySafely({
    guildId: interaction.guildId, targetId: user.id, moderatorId: actor.id,
    action: 'jail', reason, duration: null, dmSent,
  });
  const logSent = await postModLog(interaction.guild, {
    targetId: user.id, moderatorId: actor.id, action: 'jail', reason, duration: null, dmSent,
  });
  return reply(interaction, `${escapeMarkdown(user.username)} was jailed and restricted to the jail channel. DM ${dmSent ? 'sent' : 'failed'}.${historySaved ? '' : ' Warning: history could not be saved.'}${logSent ? '' : ' Warning: moderation log could not be posted.'}`);
}

async function handleUnjail(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  if (!canUseJail(actor.roles.cache.keys())) {
    return reply(interaction, 'Your roles do not allow use of /unjail.');
  }
  const user = interaction.options.getUser('member');
  if (!user || user.bot) return reply(interaction, 'Choose a server member, not a bot.');
  const member = await interaction.guild.members.fetch({ user: user.id, force: true }).catch(() => null);
  if (!member) return reply(interaction, 'That user is not in this server.');
  if (!canActOn(actor, member, interaction.guild)) return reply(interaction, 'Role hierarchy prevents you from unjailing this member.');
  const record = getJail(interaction.guildId, user.id);
  if (!record) return reply(interaction, `${escapeMarkdown(user.username)} does not have a saved jail record.`);

  const key = `${interaction.guildId}:${user.id}`;
  activeUnjails.add(key);
  let restored;
  try {
    const bot = await interaction.guild.members.fetchMe();
    restored = await unjailMember(member, bot, record, actor.id);
    removeJail(interaction.guildId, user.id);
  } catch (error) {
    console.error(`Could not unjail ${user.id}:`, error);
    return reply(interaction, `Could not unjail ${escapeMarkdown(user.username)}. ${error.message}`);
  } finally {
    activeUnjails.delete(key);
  }

  const reason = 'Released from jail';
  const dmSent = await notify(member, interaction.guild, actor, 'unjail', reason, null);
  const historySaved = saveHistorySafely({
    guildId: interaction.guildId, targetId: user.id, moderatorId: actor.id,
    action: 'unjail', reason, duration: null, dmSent,
  });
  const logSent = await postModLog(interaction.guild, {
    targetId: user.id, moderatorId: actor.id, action: 'unjail', reason, duration: null, dmSent,
  });
  const skipped = restored.skippedRoleIds.length
    ? ` ${restored.skippedRoleIds.length} saved role(s) could not be restored because they are missing, managed, or above the bot.` : '';
  return reply(interaction, `${escapeMarkdown(user.username)} was unjailed and ${restored.restoredRoleIds.length} role(s) were restored.${skipped} DM ${dmSent ? 'sent' : 'failed'}.${historySaved ? '' : ' Warning: history could not be saved.'}${logSent ? '' : ' Warning: moderation log could not be posted.'}`);
}

async function handleChannelLock(interaction, shouldLock) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  if (!canManageChannelLock(
    actor.roles.cache.keys(), actor.permissions.has(PermissionFlagsBits.Administrator),
  )) {
    return reply(interaction, 'You need the channel-lock role or Administrator permission to use this command.');
  }
  const channel = interaction.channel
    ?? await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);
  if (!channel) return reply(interaction, 'The current channel could not be found.');
  const existing = getChannelLock(interaction.guildId, channel.id);
  const bot = await interaction.guild.members.fetchMe();

  if (shouldLock) {
    if (existing) return reply(interaction, 'This channel is already locked by the bot.');
    let previous;
    try {
      ({ previous } = await lockChannel(channel, interaction.guild, bot));
      setChannelLock({
        guildId: interaction.guildId, channelId: channel.id,
        moderatorId: actor.id, previous, at: new Date().toISOString(),
      });
    } catch (error) {
      if (previous !== undefined) await unlockChannel(channel, interaction.guild, bot, previous).catch(console.error);
      console.error(`Could not lock channel ${channel.id}:`, error);
      return reply(interaction, `Could not lock this channel. ${error.message}`);
    }
    return reply(interaction, `Locked <#${channel.id}> for the member role.`);
  }

  if (!existing) return reply(interaction, 'This channel does not have a saved bot lock.');
  try {
    await unlockChannel(channel, interaction.guild, bot, existing.previous);
    removeChannelLock(interaction.guildId, channel.id);
  } catch (error) {
    console.error(`Could not unlock channel ${channel.id}:`, error);
    return reply(interaction, `Could not unlock this channel. ${error.message}`);
  }
  return reply(interaction, `Unlocked <#${channel.id}> and restored the member role's previous permission.`);
}

async function fetchTextChannel(guild, channelId, label) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || typeof channel.send !== 'function') {
    throw new Error(`${label} channel ${channelId} was not found or cannot receive messages.`);
  }
  return channel;
}

async function startRaid(interaction, actor) {
  if (getActiveRaid(interaction.guildId)) return reply(interaction, 'A raid is already active. End it before starting another.');
  if (getChannelLock(interaction.guildId, RAID_LOCK_CHANNEL_ID)) {
    return reply(interaction, 'The configured raid channel is already locked by the bot. Unlock it before starting a raid.');
  }

  const username = interaction.options.getString('roblox_user', true).trim();
  const opps = interaction.options.getString('opps', true).trim();
  if (!opps) return reply(interaction, 'Enter at least one opponent name.');
  let robloxUser;
  try {
    robloxUser = await resolveRobloxUser(username);
  } catch (error) {
    console.error(`Could not resolve Roblox user ${username}:`, error);
    return reply(interaction, `Could not find that Roblox user. ${error.message}`);
  }

  let joinInfo = { status: 'Joins unavailable', joinUrl: null, placeId: null, gameInstanceId: null };
  try {
    joinInfo = await getRobloxJoinInfo(robloxUser.id);
  } catch (error) {
    console.warn(`Could not check Roblox presence for ${robloxUser.id}:`, error);
  }

  let lockChannelTarget;
  let announcementChannel;
  try {
    [lockChannelTarget, announcementChannel] = await Promise.all([
      fetchTextChannel(interaction.guild, RAID_LOCK_CHANNEL_ID, 'Raid lock'),
      fetchTextChannel(interaction.guild, RAID_ANNOUNCEMENT_CHANNEL_ID, 'Raid announcement'),
    ]);
  } catch (error) {
    return reply(interaction, error.message);
  }

  const bot = await interaction.guild.members.fetchMe();
  const startedAt = Date.now();
  const raid = {
    guildId: interaction.guildId,
    lockChannelId: RAID_LOCK_CHANNEL_ID,
    announcementChannelId: RAID_ANNOUNCEMENT_CHANNEL_ID,
    startedBy: actor.id,
    startedAt,
    opps,
    robloxUserId: robloxUser.id,
    robloxUsername: robloxUser.name,
    robloxDisplayName: robloxUser.displayName,
    robloxProfileUrl: robloxUser.profileUrl,
    robloxStatus: joinInfo.status,
    joinUrl: joinInfo.joinUrl,
  };

  let previous;
  let markerMessage;
  let announcementMessage;
  try {
    ({ previous } = await lockChannel(lockChannelTarget, interaction.guild, bot));
    raid.previous = previous;
    setChannelLock({
      guildId: interaction.guildId, channelId: RAID_LOCK_CHANNEL_ID,
      moderatorId: actor.id, previous, source: 'raid', at: new Date(startedAt).toISOString(),
    });
    markerMessage = await lockChannelTarget.send(activeRaidChannelMessage());
    announcementMessage = await announcementChannel.send(raidAnnouncementMessage(interaction.guild, raid));
    raid.markerMessageId = markerMessage.id;
    raid.announcementMessageId = announcementMessage.id;
    setActiveRaid(raid);
  } catch (error) {
    await announcementMessage?.delete().catch(console.error);
    await markerMessage?.delete().catch(console.error);
    if (previous !== undefined) {
      await unlockChannel(lockChannelTarget, interaction.guild, bot, previous).catch(console.error);
      try { removeChannelLock(interaction.guildId, RAID_LOCK_CHANNEL_ID); } catch (saveError) { console.error(saveError); }
    }
    try { removeActiveRaid(interaction.guildId); } catch (saveError) { console.error(saveError); }
    console.error('Could not start raid:', error);
    return reply(interaction, `Could not start the raid. ${error.message}`);
  }

  const joinStatus = raid.joinUrl ? 'A Roblox join button was added.' : `Roblox status: ${raid.robloxStatus}.`;
  return reply(interaction, `Raid started against ${escapeMarkdown(opps)}. <#${RAID_LOCK_CHANNEL_ID}> is locked and the announcement was posted in <#${RAID_ANNOUNCEMENT_CHANNEL_ID}>. ${joinStatus}`);
}

async function endRaid(interaction, actor) {
  const raid = getActiveRaid(interaction.guildId);
  if (!raid) return reply(interaction, 'There is no active raid to end.');
  const result = interaction.options.getString('result', true);
  let lockChannelTarget;
  try {
    lockChannelTarget = await fetchTextChannel(interaction.guild, raid.lockChannelId, 'Raid lock');
    const bot = await interaction.guild.members.fetchMe();
    await unlockChannel(lockChannelTarget, interaction.guild, bot, raid.previous);
    if (getChannelLock(interaction.guildId, raid.lockChannelId)) {
      removeChannelLock(interaction.guildId, raid.lockChannelId);
    }
    removeActiveRaid(interaction.guildId);
  } catch (error) {
    console.error('Could not end raid:', error);
    return reply(interaction, `Could not end the raid or restore the channel permission. ${error.message}`);
  }

  const endedAt = Date.now();
  const announcementChannel = await fetchTextChannel(
    interaction.guild, raid.announcementChannelId, 'Raid announcement',
  ).catch(error => {
    console.error('Could not find the raid announcement channel while ending the raid:', error);
    return null;
  });
  const updates = await Promise.allSettled([
    Promise.resolve().then(async () => {
      if (!raid.markerMessageId) return;
      const message = await lockChannelTarget.messages.fetch(raid.markerMessageId);
      await message.delete();
    }),
    Promise.resolve().then(async () => {
      if (!announcementChannel) throw new Error('Raid announcement channel is unavailable.');
      if (!raid.announcementMessageId) return;
      const message = await announcementChannel.messages.fetch(raid.announcementMessageId);
      await message.edit(endedRaidAnnouncementMessage(interaction.guild, raid, result, actor.id, endedAt));
    }),
    Promise.resolve().then(() => {
      if (!announcementChannel) throw new Error('Raid announcement channel is unavailable.');
      return announcementChannel.send(raidEndMessage(interaction.guild, raid, result, actor.id, endedAt));
    }),
  ]);
  const failedUpdates = updates.filter(item => item.status === 'rejected');
  for (const item of failedUpdates) console.error('Could not update a raid message:', item.reason);
  return reply(interaction, `Raid ended as ${result === 'won' ? 'a win' : 'a loss'} and <#${raid.lockChannelId}> was unlocked.${failedUpdates.length ? ` ${failedUpdates.length} raid message update(s) failed; check the bot console.` : ''}`);
}

async function handleRaid(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const actor = await interaction.guild.members.fetch(interaction.user.id);
  if (!canUseRaid(actor.roles.cache.keys(), actor.permissions.has(PermissionFlagsBits.Administrator))) {
    return reply(interaction, 'You need the raid staff role or Administrator permission to use this command.');
  }
  if (activeRaidOperations.has(interaction.guildId)) return reply(interaction, 'Another raid action is already in progress.');
  activeRaidOperations.add(interaction.guildId);
  try {
    return interaction.options.getSubcommand() === 'start'
      ? await startRaid(interaction, actor)
      : await endRaid(interaction, actor);
  } finally {
    activeRaidOperations.delete(interaction.guildId);
  }
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

async function reconcileJails() {
  for (const record of [...getState().jails]) {
    try {
      const guild = await client.guilds.fetch(record.guildId);
      const member = await guild.members.fetch(record.targetId).catch(() => null);
      if (member?.roles.cache.has(JAIL_ROLE_ID)) continue;
      if (member) {
        const bot = await guild.members.fetchMe();
        await unjailMember(member, bot, record, null, true);
      } else {
        await restoreJailAccess(guild, record.targetId, record.snapshots);
      }
      removeJail(record.guildId, record.targetId);
    } catch (error) {
      console.error(`Could not reconcile jail access for ${record.guildId}/${record.targetId}:`, error);
    }
  }
}

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (!interaction.inGuild() || !interaction.guild) return;
    if (interaction.isChatInputCommand() && interaction.commandName === 'user') await handleCommand(interaction);
    else if (interaction.isChatInputCommand() && interaction.commandName === 'tryout') await handleTryout(interaction);
    else if (interaction.isChatInputCommand() && interaction.commandName === 'accept') await handleAccept(interaction);
    else if (interaction.isChatInputCommand() && interaction.commandName === 'jail') await handleJail(interaction);
    else if (interaction.isChatInputCommand() && interaction.commandName === 'unjail') await handleUnjail(interaction);
    else if (interaction.isChatInputCommand() && interaction.commandName === 'lock') await handleChannelLock(interaction, true);
    else if (interaction.isChatInputCommand() && interaction.commandName === 'unlock') await handleChannelLock(interaction, false);
    else if (interaction.isChatInputCommand() && interaction.commandName === 'raid') await handleRaid(interaction);
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

client.on(Events.ChannelCreate, channel => {
  if (channel.guildId !== GUILD_ID) return;
  void applyJailRolePermissions(channel)
    .catch(error => console.error(`Could not apply jail permissions to new channel ${channel.id}:`, error));
});

client.on(Events.ChannelDelete, channel => {
  if (channel.guildId === GUILD_ID && getChannelLock(channel.guildId, channel.id)) {
    try {
      removeChannelLock(channel.guildId, channel.id);
    } catch (error) {
      console.error(`Could not remove saved lock for deleted channel ${channel.id}:`, error);
    }
  }
});

client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
  if (!oldMember.roles.cache.has(JAIL_ROLE_ID) || newMember.roles.cache.has(JAIL_ROLE_ID)) return;
  const key = `${newMember.guild.id}:${newMember.id}`;
  if (activeUnjails.has(key)) return;
  const record = getJail(newMember.guild.id, newMember.id);
  if (!record) return;
  activeUnjails.add(key);
  void newMember.guild.members.fetchMe()
    .then(bot => unjailMember(newMember, bot, record, null, true))
    .then(() => removeJail(newMember.guild.id, newMember.id))
    .catch(error => console.error(`Could not restore roles and channel access for ${newMember.id}:`, error))
    .finally(() => activeUnjails.delete(key));
});

client.on(Events.GuildMemberRemove, member => {
  const record = getJail(member.guild.id, member.id);
  if (!record) return;
  void restoreJailAccess(member.guild, member.id, record.snapshots)
    .then(() => removeJail(member.guild.id, member.id))
    .catch(error => console.error(`Could not clean up jail access for departed member ${member.id}:`, error));
});

client.once(Events.ClientReady, () => {
  console.log(`Ready as ${client.user.tag}`);
  void checkTimedBans();
  void reconcileJails();
  setInterval(() => void checkTimedBans(), 30_000);
  setInterval(() => {
    for (const [nonce, item] of pending) if (item.expiresAt < Date.now()) pending.delete(nonce);
  }, 60_000);
});

// POST upserts each guild command without deleting any other commands in the server.
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
for (const guildCommand of [
  command, tryoutCommand, acceptCommand, jailCommand, unjailCommand, lockCommand, unlockCommand, raidCommand,
]) {
  await rest.post(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: guildCommand.toJSON() });
}
await client.login(DISCORD_TOKEN);
