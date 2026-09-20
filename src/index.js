import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder, Client, Events, GatewayIntentBits, InteractionContextType, MessageFlags,
  ModalBuilder, PermissionFlagsBits, REST, Routes, SlashCommandBuilder,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { MAX_BAN, MAX_TIMEOUT, parseDuration } from './duration.js';
import { getState, loadState, saveState } from './store.js';

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error('Set DISCORD_TOKEN, CLIENT_ID, and GUILD_ID in .env');
}
loadState();

const actions = {
  ban: { permission: PermissionFlagsBits.BanMembers, verb: 'banned' },
  mute: { permission: PermissionFlagsBits.ModerateMembers, verb: 'timed out' },
  kick: { permission: PermissionFlagsBits.KickMembers, verb: 'kicked' },
  warn: { permission: PermissionFlagsBits.ModerateMembers, verb: 'warned' },
};
const pending = new Map();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const command = new SlashCommandBuilder()
  .setName('user')
  .setDescription('Moderate a server member')
  .setContexts(InteractionContextType.Guild)
  .addUserOption(option => option.setName('target').setDescription('Member to moderate').setRequired(true));

async function reply(interaction, content) {
  const payload = { content, allowedMentions: { parse: [] } };
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
    interaction.guild.members.fetch(targetId).catch(() => null),
    interaction.guild.members.fetchMe(),
  ]);
  return { actor, target, bot };
}

async function notify(target, guildName, action, reason, duration) {
  const content = `You have been ${actions[action].verb} in ${guildName}.${duration ? ` Duration: ${duration}.` : ''}\nReason: ${reason}`;
  try {
    await target.send({ content, allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    console.warn(`Could not DM ${target.id}:`, error);
    return false;
  }
}

function modalFor(action, nonce) {
  const modal = new ModalBuilder().setCustomId(`mod:submit:${nonce}`).setTitle(`${action[0].toUpperCase()}${action.slice(1)} member`);
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('reason').setLabel('Reason (optional)').setStyle(TextInputStyle.Paragraph)
      .setRequired(false).setMaxLength(300).setPlaceholder('No reason provided'),
  ));
  if (action === 'ban' || action === 'mute') {
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('duration')
        .setLabel(action === 'ban' ? 'Duration (blank = permanent)' : 'Duration (required)')
        .setPlaceholder('Examples: 30m, 2h, 7d, 1w')
        .setStyle(TextInputStyle.Short).setRequired(action === 'mute').setMaxLength(8),
    ));
  }
  return modal;
}

async function handleCommand(interaction) {
  const targetId = interaction.options.getUser('target', true).id;
  const { actor, target } = await resolveMembers(interaction, targetId);
  if (!target) return reply(interaction, 'That user is not currently a member of this server.');
  if (!Object.values(actions).some(a => actor.permissions.has(a.permission))) {
    return reply(interaction, 'You need a moderation permission to use this command.');
  }
  if (!canActOn(actor, target, interaction.guild)) return reply(interaction, 'You cannot moderate this member due to role hierarchy.');

  const nonce = randomUUID();
  pending.set(nonce, { actorId: actor.id, targetId, guildId: interaction.guildId, expiresAt: Date.now() + 14 * 60_000 });
  const menu = new StringSelectMenuBuilder().setCustomId(`mod:choose:${nonce}`)
    .setPlaceholder('Choose a moderation action')
    .addOptions(Object.keys(actions).map(action => ({ label: action[0].toUpperCase() + action.slice(1), value: action })));
  await interaction.reply({
    content: `Choose an action for ${target.user.username} (${targetId}). Only you can use this menu.`,
    components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

function getPending(interaction, nonce) {
  const item = pending.get(nonce);
  if (!item || item.expiresAt < Date.now() || item.actorId !== interaction.user.id || item.guildId !== interaction.guildId) return null;
  return item;
}

async function handleChoice(interaction) {
  const nonce = interaction.customId.slice('mod:choose:'.length);
  const item = getPending(interaction, nonce);
  if (!item) return reply(interaction, 'This menu expired or belongs to another moderator. Run /user again.');
  if (item.action) return reply(interaction, 'A form is already open for this menu. Run /user to start over.');
  const action = interaction.values[0];
  if (!actions[action]) return reply(interaction, 'Unknown action.');
  item.action = action;
  await interaction.showModal(modalFor(action, nonce));
}

async function handleSubmit(interaction) {
  const nonce = interaction.customId.slice('mod:submit:'.length);
  const item = getPending(interaction, nonce);
  if (!item || !item.action) return reply(interaction, 'This form expired. Run /user again.');
  pending.delete(nonce);
  const { action, targetId } = item;
  const reason = (interaction.fields.fields.has('reason') ? interaction.fields.getTextInputValue('reason').trim() : '') || 'No reason provided';
  const duration = (action === 'ban' || action === 'mute') && interaction.fields.fields.has('duration')
    ? interaction.fields.getTextInputValue('duration').trim() : '';
  const durationMs = duration ? parseDuration(duration, action === 'ban' ? MAX_BAN : MAX_TIMEOUT) : null;
  if (action === 'mute' && !durationMs) return reply(interaction, 'Mute duration is required: 1m to 28d (e.g. 30m, 2h, 7d).');
  if (action === 'ban' && duration && !durationMs) return reply(interaction, 'Ban duration must be 1m to 365d, or blank for permanent.');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { actor, target, bot } = await resolveMembers(interaction, targetId);
  if (!target) return reply(interaction, 'The target is no longer in this server. No action was taken.');
  if (!actor.permissions.has(actions[action].permission)) return reply(interaction, `You no longer have permission to ${action} members.`);
  if (!canActOn(actor, target, interaction.guild)) return reply(interaction, 'Role hierarchy prevents this action.');
  if ((action === 'ban' && (!bot.permissions.has(PermissionFlagsBits.BanMembers) || !target.bannable)) ||
      (action === 'kick' && (!bot.permissions.has(PermissionFlagsBits.KickMembers) || !target.kickable)) ||
      (action === 'mute' && (!bot.permissions.has(PermissionFlagsBits.ModerateMembers) || !target.moderatable))) {
    return reply(interaction, 'I lack the required permission or a higher role than the target.');
  }

  const auditReason = `${reason} | moderator ${actor.id}`;
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
        if (durationMs) {
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
    const label = action === 'ban' && !duration ? 'permanently banned' : actions[action].verb;
    return reply(interaction, `${target.user.username} was ${label}${duration ? ` for ${duration}` : ''}. DM ${dmSent ? 'sent' : 'could not be delivered'}.`);
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
        const ban = await guild.bans.fetch(entry.targetId).catch(error => {
          if (error.code === 10026) return null; // Already unbanned manually.
          throw error;
        });
        // A manual unban followed by a new ban must never be undone by the old timer.
        if (ban?.reason?.includes(`timed-ban:${entry.tag}`)) await guild.bans.remove(entry.targetId, 'Timed ban expired');
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
    else if (interaction.isStringSelectMenu() && interaction.customId.startsWith('mod:choose:')) await handleChoice(interaction);
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('mod:submit:')) await handleSubmit(interaction);
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
await new REST({ version: '10' }).setToken(DISCORD_TOKEN).put(
  Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [command.toJSON()] },
);
await client.login(DISCORD_TOKEN);
