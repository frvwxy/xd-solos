import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, InteractionContextType,
  PermissionFlagsBits, SlashCommandBuilder, escapeMarkdown,
} from 'discord.js';

export const RAID_LOCK_CHANNEL_ID = '1547135508054806589';
export const RAID_ANNOUNCEMENT_CHANNEL_ID = '1547135372167749692';
export const RAID_ALERT_ROLE_ID = '1551356053168459867';
export const RAID_LOG_ROLE_ID = '1551356073334804531';
export const RAID_STAFF_ROLE_ID = '1547023404157378641';
export const RAID_CHANNEL_URL = 'https://discord.com/channels/1547021317193080882/1547135372167749692';
export const ACTIVE_RAID_MESSAGE = `## <:raid:1551851895755374673> | **ACTIVE RAID**: ${RAID_CHANNEL_URL}`;

const CARD_COLOR = 0x8bd8f7;
const ROBLOX_USERS_URL = 'https://users.roblox.com/v1/usernames/users';
const ROBLOX_PRESENCE_URL = 'https://presence.roblox.com/v1/presence/users';

export const raidCommand = new SlashCommandBuilder()
  .setName('raid')
  .setDescription('Start or end a raid')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand(subcommand => subcommand
    .setName('start')
    .setDescription('Start a raid and lock the configured channel')
    .addStringOption(option => option
      .setName('roblox_user')
      .setDescription('Roblox username to join')
      .setRequired(true)
      .setMaxLength(20))
    .addStringOption(option => option
      .setName('opps')
      .setDescription('Names of the opponents')
      .setRequired(true)
      .setMaxLength(300)))
  .addSubcommand(subcommand => subcommand
    .setName('end')
    .setDescription('End the active raid and unlock the channel')
    .addStringOption(option => option
      .setName('result')
      .setDescription('How the raid ended')
      .setRequired(true)
      .addChoices(
        { name: 'Won', value: 'won' },
        { name: 'Lost', value: 'lost' },
      )));

export function canUseRaid(roleIds, hasAdministrator = false) {
  return hasAdministrator || [...roleIds].includes(RAID_STAFF_ROLE_ID);
}

async function postJson(url, body, fetchImpl) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Roblox returned HTTP ${response.status}.`);
  return response.json();
}

export async function resolveRobloxUser(username, fetchImpl = globalThis.fetch) {
  const cleanUsername = username.trim();
  const body = await postJson(ROBLOX_USERS_URL, {
    usernames: [cleanUsername], excludeBannedUsers: false,
  }, fetchImpl);
  const user = body.data?.[0];
  if (!user) throw new Error(`Roblox user ${cleanUsername} was not found.`);
  return {
    id: String(user.id),
    name: user.name,
    displayName: user.displayName || user.name,
    profileUrl: `https://www.roblox.com/users/${user.id}/profile`,
  };
}

export async function getRobloxJoinInfo(userId, fetchImpl = globalThis.fetch) {
  const body = await postJson(ROBLOX_PRESENCE_URL, { userIds: [Number(userId)] }, fetchImpl);
  const presence = body.userPresences?.[0];
  if (!presence || presence.userPresenceType !== 2) {
    return { status: 'Offline', joinUrl: null, placeId: null, gameInstanceId: null };
  }
  if (!presence.placeId || !presence.gameId) {
    return { status: 'Joins unavailable', joinUrl: null, placeId: null, gameInstanceId: null };
  }
  return {
    status: 'Join available',
    joinUrl: `https://www.roblox.com/games/start?placeId=${presence.placeId}&gameInstanceId=${encodeURIComponent(presence.gameId)}`,
    placeId: String(presence.placeId),
    gameInstanceId: presence.gameId,
  };
}

function robloxLabel(raid) {
  const display = raid.robloxDisplayName === raid.robloxUsername
    ? `@${raid.robloxUsername}`
    : `${raid.robloxDisplayName} (@${raid.robloxUsername})`;
  return `[${escapeMarkdown(display)}](${raid.robloxProfileUrl})`;
}

function baseEmbed(guild) {
  const embed = new EmbedBuilder().setColor(CARD_COLOR);
  const icon = guild.iconURL({ size: 256 });
  if (icon) embed.setThumbnail(icon);
  return embed;
}

function raidFields(raid) {
  return [
    { name: 'Roblox User', value: robloxLabel(raid), inline: true },
    { name: 'Opponents', value: escapeMarkdown(raid.opps), inline: true },
  ];
}

export function activeRaidChannelMessage() {
  return { content: ACTIVE_RAID_MESSAGE, allowedMentions: { parse: [] } };
}

export function raidAnnouncementMessage(guild, raid) {
  const started = Math.floor(raid.startedAt / 1000);
  const embed = baseEmbed(guild)
    .setTitle('Active Raid')
    .setDescription('An xd raid is now underway.')
    .addFields(
      ...raidFields(raid),
      { name: 'Roblox Status', value: raid.robloxStatus, inline: true },
      { name: 'Started', value: `<t:${started}:F>\n<t:${started}:R>`, inline: true },
      { name: 'Started By', value: `<@${raid.startedBy}>`, inline: true },
    )
    .setFooter({ text: 'be comp. be xd.' });
  const components = raid.joinUrl ? [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Join on Roblox').setStyle(ButtonStyle.Link).setURL(raid.joinUrl),
  )] : [];
  return {
    content: `<@&${RAID_ALERT_ROLE_ID}>`, embeds: [embed], components,
    allowedMentions: { parse: [], roles: [RAID_ALERT_ROLE_ID] },
  };
}

export function formatRaidDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [
    ...(hours ? [`${hours} ${hours === 1 ? 'Hour' : 'Hours'}`] : []),
    ...(minutes ? [`${minutes} ${minutes === 1 ? 'Minute' : 'Minutes'}`] : []),
    ...(seconds || (!hours && !minutes) ? [`${seconds} ${seconds === 1 ? 'Second' : 'Seconds'}`] : []),
  ];
  return parts.join(', ');
}

function endedRaidEmbed(guild, raid, result, endedBy, endedAt) {
  const won = result === 'won';
  return baseEmbed(guild)
    .setTitle(won ? 'Raid Won' : 'Raid Lost')
    .setDescription(won
      ? '**We won!** Thanks to everyone who showed up and represented xd.'
      : '**We lost this one.** Thanks to everyone who showed up and represented xd.')
    .addFields(
      ...raidFields(raid),
      { name: 'Duration', value: formatRaidDuration(endedAt - raid.startedAt), inline: true },
      { name: 'Ended By', value: `<@${endedBy}>`, inline: true },
    )
    .setFooter({ text: 'be comp. be xd.' });
}

export function endedRaidAnnouncementMessage(guild, raid, result, endedBy, endedAt) {
  return {
    content: null,
    embeds: [endedRaidEmbed(guild, raid, result, endedBy, endedAt)],
    components: [],
    allowedMentions: { parse: [] },
  };
}

export function raidEndMessage(guild, raid, result, endedBy, endedAt) {
  return {
    content: `<@&${RAID_LOG_ROLE_ID}>`,
    embeds: [endedRaidEmbed(guild, raid, result, endedBy, endedAt)],
    allowedMentions: { parse: [], roles: [RAID_LOG_ROLE_ID] },
  };
}
