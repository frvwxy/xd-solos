# Basic Discord moderation bot

One `/user` slash command opens a private action menu: ban, mute (Discord timeout), kick, warn, or history. Use `/user target:@member` for someone still in the server, or `/user user_id:123...` to view a former member's history. Provide one of those options, not both. Each moderation action asks for an optional reason. Ban duration may be blank for a permanent ban only for the full-access roles; mute duration is always required. Durations use `m`, `h`, `d`, or `w` (for example `30m`, `2h`, `7d`), up to 365 days for a timed ban and 28 days for a mute.

## Staff roles

The IDs in `src/policy.js` are treated as **Discord role IDs**, not individual user IDs. The bot checks these roles when the menu is opened and again when an action is submitted.

| Role ID(s) | Available menu options |
| --- | --- |
| `1547023959118192680`, `635280852741390348`, `1550346816351113356` | Ban (timed or permanent), mute, kick, warn, history |
| `1547023304219697152` | Temp ban (duration required), mute, kick, warn, history |
| `1547023404157378641` | Mute, warn, history |

These roles do not need Discord's native moderation permissions; the **bot** needs Ban Members, Kick Members, and Moderate Members. Moderators must still have a higher role than the target. Members with none of the listed roles cannot use `/user`.

## Setup

1. Install Node.js 20+ and run `npm install` in this folder.
2. Create a Discord application and bot in the [Developer Portal](https://discord.com/developers/applications). Copy `.env.example` to `.env` and fill in the bot token, application/client ID, and your test server ID. Never commit or share `.env`.
3. Invite the bot using OAuth2 scopes `bot` and `applications.commands`. Give the **bot** Ban Members, Kick Members, and Moderate Members, and put its role above members it will moderate. The authorized staff roles must also be above their targets. Restrict `/user` in Server Settings → Integrations if desired; the bot enforces the role list regardless of that setting.
4. Run `npm start`. The bot registers `/user` in the configured server on startup. Run `npm test` for the duration parser tests.

## Deploy with Coolify

You do **not** need Node.js installed on your own computer. Put this folder in a Git repository, then create a Coolify **Application** from that repository and select **Dockerfile** as its Build Pack. If this folder is inside a larger repository, set Coolify's Base Directory to the folder containing `Dockerfile` and `package.json`. The Docker image installs and runs Node.js for you.

In Coolify, add `DISCORD_TOKEN`, `CLIENT_ID`, and `GUILD_ID` as **runtime** environment variables. Keep the token secret; do not put it in Git or the Dockerfile. Add a **Volume Mount** under Persistent Storage with destination path `/app/data`, so warnings, history, and timed bans survive redeploys. Leave the domain blank: this bot connects outward to Discord and has no website or listening port. Do not enable an HTTP health check for it. Deploy one instance only, then look for `Ready as ...` in the application logs. A Dockerfile entered directly into Coolify without a Git source cannot `COPY` this project's files, so use a Git-backed application.

Warnings, timed bans, and moderation history are saved in `data/moderation.json`. Keep this file across restarts. History shows the 10 most recent recorded actions for the selected user. Warnings saved by the earlier bot version appear in history automatically; earlier kicks, mutes, and bans cannot be reconstructed. The bot checks expired bans every 30 seconds and on startup; it only unbans a user if the current ban still has that timed ban's marker. Keep the bot online near expiry if precise timing matters. This starter targets one server and runs one bot process.

DMs are attempted for every successful action. For kick/ban they are attempted before removal, since DMs may become unavailable afterward; if the subsequent action fails, a DM may already have been sent. Closed DMs do not block moderation, and the private result reports delivery status. A warning is stored before its DM attempt.
