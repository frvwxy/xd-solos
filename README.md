# Basic Discord moderation bot

One `/user` slash command posts a public, light-blue Discord card with the user's avatar, ID, server status, top role, warning count, and account/join dates. All seven moderation buttons—Ban, Temp Ban, Mute (Discord timeout), Kick, Warn, Unban, and History—sit inside its border in smaller rows. Every button is grey; unavailable actions are visibly disabled based on the moderator's role and the target's status. Discord does not support interactive buttons literally inside an embed, so interactive cards use a Components V2 container styled like one. Only the moderator who ran `/user` can use that card's buttons. The card can be used for multiple actions; it expires after 14 minutes of inactivity or a bot restart, not after one action. Each opened form can be submitted only once, and simultaneous submissions from the same card are blocked. Button availability reflects the target's status when the card was opened, so run `/user` again after a ban, kick, or unban to refresh it. History responds separately and ephemerally with **Notes** and **Moderation History** cards; those records are not posted to the channel. Action confirmations and DMs remain actual embeds. Notes can be added or reviewed by authorized moderators and are never sent to the user. Use `/user target:@member` for someone still in the server, or `/user user_id:123...` to view a former member's records or unban them. Provide one of those options, not both. Each moderation action opens a reason form. Permanent Ban requires a reason; Temp Ban and Mute require a duration; Ban is permanent. Durations use `m`, `h`, `d`, or `w` (for example `30m`, `2h`, `7d`), up to 365 days for a timed ban and 28 days for a mute. Displayed durations use readable names, such as `5 Minutes` and `1 Day`.

The card uses two compact button rows and explains a disabled Unban button. A member still in the server is not banned, so Unban is unavailable even to a full-access moderator. To unban someone, open `/user user_id:...` for a currently banned account. The bot also needs Ban Members permission.

## Staff roles

The IDs in `src/policy.js` are treated as **Discord role IDs**, not individual user IDs. The bot checks these roles when the menu is opened and again when an action is submitted.

| Role ID(s) | Available menu options |
| --- | --- |
| `1547023959118192680`, `635280852741390348`, `1550346816351113356` | Ban, Temp Ban, Mute, Kick, Warn, Unban, History |
| `1547023304219697152` | Temp Ban, Mute, Kick, Warn, History |
| `1547023404157378641` | Mute, warn, history |

These roles do not need Discord's native moderation permissions; the **bot** needs Ban Members, Kick Members, Moderate Members, and Embed Links. Moderators must still have a higher role than the target. Members with none of the listed roles cannot use `/user`.

## Setup

1. Install Node.js 20+ and run `npm install` in this folder.
2. Create a Discord application and bot in the [Developer Portal](https://discord.com/developers/applications). Copy `.env.example` to `.env` and fill in the bot token, application/client ID, and your test server ID. Never commit or share `.env`.
3. Invite the bot using OAuth2 scopes `bot` and `applications.commands`. Give the **bot** Ban Members, Kick Members, Moderate Members, and Embed Links, and put its role above members it will moderate. The authorized staff roles must also be above their targets. Restrict `/user` in Server Settings → Integrations if desired; the bot enforces the role list regardless of that setting.
4. Run `npm start`. The bot registers `/user` in the configured server on startup. Run `npm test` for the duration parser tests.

## Deploy with Coolify

You do **not** need Node.js installed on your own computer. Put this folder in a Git repository, then create a Coolify **Application** from that repository and select **Dockerfile** as its Build Pack. If this folder is inside a larger repository, set Coolify's Base Directory to the folder containing `Dockerfile` and `package.json`. The Docker image installs and runs Node.js for you.

In Coolify, add `DISCORD_TOKEN`, `CLIENT_ID`, and `GUILD_ID` as **runtime** environment variables. Keep the token secret; do not put it in Git or the Dockerfile. Add a **Volume Mount** under Persistent Storage with destination path `/app/data`, so warnings, history, notes, and timed bans survive redeploys. Leave the domain blank: this bot connects outward to Discord and has no website or listening port. Do not enable an HTTP health check for it. Deploy one instance only, then look for `Ready as ...` in the application logs. A Dockerfile entered directly into Coolify without a Git source cannot `COPY` this project's files, so use a Git-backed application.

Completed moderation actions and automatic timed unbans are logged to channel `1551357755477065738`. No new environment variable is required; set `MOD_LOG_CHANNEL_ID` only if you want a different channel. Make that channel staff-only because logs contain reasons and user IDs. The bot needs View Channel, Send Messages, and Embed Links there. If a log cannot be posted, moderation still succeeds and the moderator sees a warning; check the bot console and channel permissions. Private moderator notes are not posted to the log channel.

Warnings, timed bans, moderation history, and moderator notes are saved in `data/moderation.json`. Keep this file across restarts. History and Notes each show the 10 most recent records for the selected user. Warnings saved by the earlier bot version appear in history automatically; earlier kicks, mutes, and bans cannot be reconstructed. Unban is available only to full-access roles, and only when the user is currently banned. The bot checks expired bans every 30 seconds and on startup; it only unbans a user if the current ban still has that timed ban's marker. Keep the bot online near expiry if precise timing matters. This starter targets one server and runs one bot process.

DMs are attempted for every successful action and use embeds showing the action, moderator, reason, and duration when applicable. The server icon appears as the thumbnail when one is set. For kick/ban they are attempted before removal, since DMs may become unavailable afterward; if the subsequent action fails, a DM may already have been sent. Closed DMs do not block moderation, and the ephemeral embed reports delivery status. A warning is stored before its DM attempt.
