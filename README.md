# Alistra Discord Bot

A Railway-ready Discord bot with owner-only admin tools, a purchase ticket system, autorole,
mass DM, user wipe/ban, and automatic promotion/link removal.

Everything is gated behind the owner ID, so only `1526647973986046034` can run the commands
(change it with the `OWNER_ID` variable).

## Setup

1. Go to <https://discord.com/developers/applications> → **New Application** → **Bot**.
2. Copy the bot **token** and reset it if it was ever shared.
3. On the **Bot** page, enable BOTH privileged intents:
   - **SERVER MEMBERS INTENT** (autorole on join, `/dmall`, `/ban`)
   - **MESSAGE CONTENT INTENT** (promotion detection)
4. Invite the bot with the link below, choosing **Administrator** on the invite screen
   (simplest — it needs to purge messages in every channel, manage roles and create channels):

   ```
   https://discord.com/api/oauth2/authorize?client_id=YOUR_APP_ID&permissions=8&scope=bot%20applications.commands
   ```

   Prefer a smaller permission set? Use this instead:

   ```
   https://discord.com/api/oauth2/authorize?client_id=YOUR_APP_ID&permissions=120527645716&scope=bot%20applications.commands
   ```

   (that is View Channels, Send Messages, Manage Messages, Embed Links, Attach Files,
   Read Message History, Manage Channels, Manage Roles, Ban Members and thread permissions.)

## Railway variables

| Variable | Required | What it does |
| --- | --- | --- |
| `BOT_TOKEN` | yes | Your bot token. |
| `OWNER_ID` | no | Who may use the admin commands. Defaults to `1526647973986046034`. |
| `GUILD_ID` | no | Put your server ID here so slash commands appear **instantly**. Without it commands are global and can take up to an hour to show up. |
| `TICKET_CATEGORY_ID` | no | Default category for purchase tickets (same as running `/ticketpurchasecategory`). |
| `AUTOROLE_ID` | no | Default autorole (same as running `/autorole`). |
| `AUTOMOD_LOG_CHANNEL_ID` | no | Channel that receives a log embed for every deleted promotion message. |
| `DATA_FILE` | no | Where the small settings file lives. Defaults to `data/config.json`. |

Then in Railway: **Deploy**. Start command is `npm start`.

> Ticket category and autorole are remembered in a small JSON file. On Railway the filesystem
> is wiped on every deploy, so either attach a **Volume** and point `DATA_FILE` at it, or set
> `TICKET_CATEGORY_ID` / `AUTOROLE_ID` as variables.

## Commands (owner only)

| Command | What it does |
| --- | --- |
| `/say message:<text>` | Posts the message in the channel as the bot. **Only you see the confirmation**; everyone sees the posted message. |
| `/ticketpurchase message:<text>` | Posts a ticket panel with your text and a **Purchase** button. |
| `/ticketpurchasecategory category:<category>` | Sets the category where purchase tickets are created. |
| `/ban user:<user>` or `userid:<id>` | Deletes every message the user ever sent across the server (including threads), then bans them. |
| `/dmall message:<text>` | DMs every human member of the server. |
| `/autorole role:<role>` | Gives the role to everyone now and to every future member. |

Anyone who is not the owner gets **"You are not authorized to use this command."**

## Ticket flow

1. Owner runs `/ticketpurchase message:Prices and info here`.
2. A panel appears with a **Purchase** button (anyone can press it).
3. Pressing it opens a modal with three questions:
   - What are you buying?
   - Which payment method are you using?
   - Do you agree to our rules?
4. A private ticket channel is created in the configured category, visible only to the buyer,
   the owner and the bot. It contains the answers and a **Close Ticket** button
   (usable by the buyer or staff).

## Promotion detection

Every message is checked for Discord invites, links, bare domains (`something.com`) and promo
phrases (`free nitro`, `promo code`, `sub4sub`, `advertising my …`, …). Matching messages are
**deleted**. The bot owner and staff with Manage Messages / Administrator are never touched.
Add or adjust patterns in `src/automod.ts`.

## Run locally

```bash
cp .env.example .env   # then fill in BOT_TOKEN
npm install
npm run typecheck
npm start
```

## Files

- `src/index.ts` — client, command registration, event routing.
- `src/commands.ts` — slash command definitions.
- `src/admin.ts` — `/say`, `/ban`, `/dmall`, `/autorole`.
- `src/tickets.ts` — purchase panel, modal, ticket creation and closing.
- `src/automod.ts` — promotion/link detection.
- `src/store.ts` — small per-server settings file.
