# Basic Discord moderation bot

One `/user target:@member` slash command opens a private action menu: ban, mute (Discord timeout), kick, or warn. Each action asks for an optional reason. Ban duration may be blank for a permanent ban; mute duration is required. Durations use `m`, `h`, `d`, or `w` (for example `30m`, `2h`, `7d`), up to 365 days for a timed ban and 28 days for a mute.

## Setup

1. Install Node.js 20+ and run `npm install` in this folder.
2. Create a Discord application and bot in the [Developer Portal](https://discord.com/developers/applications). Copy `.env.example` to `.env` and fill in the bot token, application/client ID, and your test server ID. Never commit or share `.env`.
3. Invite the bot using OAuth2 scopes `bot` and `applications.commands`. Give it **Ban Members**, **Kick Members**, and **Moderate Members**, and put its role above members it will moderate. Staff also need the relevant permission, and their role must be above the target. Restrict access to `/user` in Server Settings → Integrations if desired.
4. Run `npm start`. The bot registers `/user` in the configured server on startup. Run `npm test` for the duration parser tests.

## Deploy with Coolify

You do **not** need Node.js installed on your own computer. Put this folder in a Git repository, then create a Coolify **Application** from that repository and select **Dockerfile** as its Build Pack. If this folder is inside a larger repository, set Coolify's Base Directory to the folder containing `Dockerfile` and `package.json`. The Docker image installs and runs Node.js for you.

In Coolify, add `DISCORD_TOKEN`, `CLIENT_ID`, and `GUILD_ID` as **runtime** environment variables. Keep the token secret; do not put it in Git or the Dockerfile. Add a **Volume Mount** under Persistent Storage with destination path `/app/data`, so warnings and timed bans survive redeploys. Leave the domain blank: this bot connects outward to Discord and has no website or listening port. Do not enable an HTTP health check for it. Deploy one instance only, then look for `Ready as ...` in the application logs. A Dockerfile entered directly into Coolify without a Git source cannot `COPY` this project's files, so use a Git-backed application.

Warnings and timed bans are saved in `data/moderation.json`. Keep this file across restarts. The bot checks expired bans every 30 seconds and on startup; it only unbans a user if the current ban still has that timed ban's marker. Keep the bot online near expiry if precise timing matters. This starter targets one server, runs one bot process, and does not include a warning-history command or mod-log channel.

DMs are attempted for every successful action. For kick/ban they are attempted before removal, since DMs may become unavailable afterward; if the subsequent action fails, a DM may already have been sent. Closed DMs do not block moderation, and the private result reports delivery status. A warning is stored before its DM attempt.
