# Dead by Daylight Twitch Bot

[![CI](https://github.com/kamoras/dead-by-daylight-twitch-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/kamoras/dead-by-daylight-twitch-bot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A Twitch chat bot for Dead by Daylight streamers. Manages a viewer queue for on-stream play sessions and includes DbD-themed commands.

One bot instance serves multiple streamers. Streamers self-onboard through an invite-only landing page — no manual config needed per channel.

## Features

- **Queue management** — viewers sign up, check their position, and leave at will
- **Role modes** — survivor is the default role; killer is opt-in (`!dbd join killer`)
- **Moderator controls** — open/close the queue, pick the next player(s), remove users
- **Live-only presence** — the bot joins a channel when its stream goes live and leaves (closing and clearing the queue) when it ends (requires Twitch EventSub config)
- **Multi-channel** — one bot instance serves multiple streamers
- **Invite-only onboarding** — streamers self-connect via a landing page using single-use invite codes
- **Admin dashboard** — generate/revoke invite codes, monitor connected channels, queue state, and webhook activity
- **DbD extras** — random killer, survivor, perk, map, and Entity messages
- **Free hosting** — runs on Oracle Cloud Always Free tier (no expiry; credit card required to sign up)
- **Auto-deploy** — GitHub Actions builds, pushes, and deploys on every merge to `main`
- **HTTPS** — Caddy reverse proxy with automatic Let's Encrypt TLS

---

## Commands

All commands use the `!dbd` prefix by default. Configurable via `BOT_PREFIX`.

### Everyone

| Command | Description |
|---------|-------------|
| `!dbd join` | Join the queue as survivor (default when `QUEUE_ROLES_MODE=both`) |
| `!dbd join killer` | Join the queue as killer |
| `!dbd leave` | Leave the queue |
| `!dbd queue` | Show the first 5 people in the queue |
| `!dbd position` | Check your spot in the queue |
| `!dbd killer` | Get a random killer |
| `!dbd survivor` | Get a random survivor |
| `!dbd perk [killer\|survivor]` | Get a random perk (optionally filtered by side) |
| `!dbd map` | Get a random map |
| `!dbd entity` | Hear from the Entity |
| `!dbd help` | Quick help — joining, leaving, and queue status |
| `!dbd help extended` | Full command reference including all mod commands and DbD extras |

### Moderators only

| Command | Description |
|---------|-------------|
| `!dbd open` | Open the queue |
| `!dbd close` | Close the queue and clear it (resets for the next session) |
| `!dbd pick [n]` | Call up the next person, or the next `n` people |
| `!dbd next` | Preview who's next without removing them |
| `!dbd remove <username>` | Remove a specific user from the queue |
| `!dbd clear` | Clear the queue without closing it |

---

## Configuration

All configuration is done via environment variables. In production these are set as GitHub Actions secrets and synced to the server on every deploy. For local development, copy `.env.example` to `.env`.

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `TWITCH_BOT_USERNAME` | ✅ | — | Twitch username of the bot account |
| `TWITCH_BOT_TOKEN` | ✅ | — | OAuth token for the bot, prefixed with `oauth:` |
| `DOMAIN` | ✅ | — | Your domain — Caddy uses this for TLS and the webhook URL |
| `ADMIN_PASSWORD` | ✅ | — | Password for the admin dashboard |
| `ADMIN_PATH` | ✅ | — | Secret URL slug — admin lives at `https://YOUR_DOMAIN/admin/YOUR_ADMIN_PATH` |
| `BOT_PREFIX` | | `!dbd ` | Command prefix (trailing space required for multi-word prefixes) |
| `QUEUE_ROLES_MODE` | | `both` | `off` · `both` · `survivor` · `killer` |
| `QUEUE_MAX_SIZE` | | `20` | Maximum queue size |
| `PORT` | | `8080` | Internal port (Caddy proxies to this — do not expose publicly) |
| `DB_PATH` | | `./data/bot.db` | SQLite path inside the container (maps to `/opt/dbd-bot/data/bot.db` on host) |
| `TWITCH_CLIENT_ID` | | — | Twitch app Client ID — required for stream-end auto-detection |
| `TWITCH_CLIENT_SECRET` | | — | Twitch app Client Secret — required for stream-end auto-detection |
| `TWITCH_WEBHOOK_SECRET` | | — | Random string for EventSub signature verification (`openssl rand -hex 20`) |

### Getting a Twitch OAuth token

1. Create a dedicated Twitch account for the bot.
2. Go to the [Twitch Developer Console](https://dev.twitch.tv/console) and register a new application.
3. Set the OAuth Redirect URL to `http://localhost`.
4. Construct the following URL (replacing `YOUR_CLIENT_ID`) and open it in a browser while logged in as the bot account:
   ```
   https://id.twitch.tv/oauth2/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost&response_type=token&scope=chat:read+chat:edit
   ```
5. Authorize the app. The browser redirects to `http://localhost` — copy the `access_token` from the URL bar.
6. Prefix it with `oauth:` when setting `TWITCH_BOT_TOKEN`.

---

## Local Development

```bash
# 1. Clone and install
git clone https://github.com/kamoras/dead-by-daylight-twitch-bot.git
cd dead-by-daylight-twitch-bot
npm install

# 2. Configure
cp .env.example .env
# Fill in at minimum: TWITCH_BOT_USERNAME, TWITCH_BOT_TOKEN,
# ADMIN_PASSWORD, ADMIN_PATH

# 3. Run with auto-reload
npm run dev
```

The landing page is at `http://localhost:8080`. The admin dashboard is at `http://localhost:8080/admin/YOUR_ADMIN_PATH`.

To onboard a test channel, generate a local invite code:

```bash
npm run invite
```

Then visit `http://localhost:8080`, enter the code and your channel name.

```bash
npm test        # Run unit tests
npm run lint    # Lint source files
npm start       # Production start (no auto-reload)
```

---

## Deploying to Oracle Cloud Always Free

### 1 — Provision an Oracle Cloud VM

1. Sign up at [cloud.oracle.com](https://cloud.oracle.com).
2. Navigate to **Compute → Instances → Create Instance**.
3. Choose an **Always Free** shape: `VM.Standard.E2.1.Micro` (AMD) or `VM.Standard.A1.Flex` (Arm).
4. Select **Ubuntu 24 Minimal** as the image.
5. Add your SSH public key during creation.
6. Note the **Public IP address** once the instance starts.

#### Open ports

In the Oracle console under **Networking → Virtual Cloud Networks → Security Lists**, add ingress rules for TCP ports **80** and **443**.

Then on the VM:

```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

#### Install Docker

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) \
  signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

That's the only manual setup required on the VM. Everything else is handled by the deploy workflow.

### 2 — Generate a deploy SSH key pair

On your **local machine**:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/dbd_deploy -N ""
```

Add the public key to the Oracle VM:

```bash
# On the Oracle VM:
echo "PASTE_CONTENTS_OF_dbd_deploy.pub_HERE" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 3 — Add GitHub Actions secrets

Go to **Settings → Secrets and variables → Actions → Repository secrets** and add:

| Secret | Required | Description |
|--------|:--------:|-------------|
| `ORACLE_HOST` | ✅ | Oracle VM public IP or hostname |
| `ORACLE_USER` | ✅ | SSH username (`ubuntu`) |
| `ORACLE_SSH_KEY` | ✅ | Contents of `~/.ssh/dbd_deploy` (the **private** key) |
| `TWITCH_BOT_USERNAME` | ✅ | Bot's Twitch username |
| `TWITCH_BOT_TOKEN` | ✅ | Bot's OAuth token (`oauth:...`) |
| `DOMAIN` | ✅ | Your domain (e.g. `bot.yourdomain.com`) |
| `ADMIN_PASSWORD` | ✅ | Password for the admin dashboard |
| `ADMIN_PATH` | ✅ | Secret URL segment for the admin dashboard |
| `QUEUE_ROLES_MODE` | | Defaults to `both` |
| `QUEUE_MAX_SIZE` | | Defaults to `20` |
| `BOT_PREFIX` | | Defaults to `!dbd ` (include the trailing space) |
| `TWITCH_CLIENT_ID` | | Enables stream-end auto-detection via EventSub |
| `TWITCH_CLIENT_SECRET` | | Enables stream-end auto-detection via EventSub |
| `TWITCH_WEBHOOK_SECRET` | | Random string — generate with `openssl rand -hex 20` |

### 4 — Deploy

Push a commit to `main`. GitHub Actions will:

1. Run lint and tests (CI).
2. Build a multi-arch Docker image and push it to `ghcr.io/kamoras/dead-by-daylight-twitch-bot:latest`.
3. SSH into the Oracle VM, create `/opt/dbd-bot`, write `.env` from secrets, copy `docker-compose.yml` and `Caddyfile`, then start the containers.

Caddy automatically obtains a Let's Encrypt TLS certificate on first start. Your landing page will be live at `https://YOUR_DOMAIN`.

Monitor the deploy under **Actions** in your repository. To tail logs on the server:

```bash
sudo docker compose -f /opt/dbd-bot/docker-compose.yml logs -f
```

The SQLite database is at `/opt/dbd-bot/data/bot.db` on the host — it persists across container recreation. To back it up:

```bash
cp /opt/dbd-bot/data/bot.db ~/dbd-bot-backup.db
```

### 5 — Onboard a channel

1. Visit `https://YOUR_DOMAIN/admin/YOUR_ADMIN_PATH` and sign in.
2. Click **Generate Code** — the code is shown only to you, never in any log.
3. Share the code with the streamer.
4. They visit `https://YOUR_DOMAIN`, enter the code and their channel name.
5. Recommended: they type `/mod YOUR_BOT_USERNAME` in their chat to give the bot moderator status (prevents Twitch rate-limiting the bot's messages).

---

## Admin Dashboard

The admin dashboard at `https://YOUR_DOMAIN/admin/YOUR_ADMIN_PATH` provides:

- **Bot status** — connection state, uptime, active channel count, current prefix
- **Invite codes** — generate single-use codes; revoke any pending code before it's used
- **Connected channels** — all onboarded channels with queue size and open/closed state
- **Webhook activity** — EventSub delivery stats (received, verified, rejected) and a log of recent stream-end events

Sessions last 8 hours. The admin URL itself is secret — any other `/admin/*` path returns 404.

---

## Live-Only Presence

When `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_WEBHOOK_SECRET`, and `DOMAIN` are all set, the bot subscribes to the Twitch EventSub `stream.online` and `stream.offline` events for every connected channel:

- **`stream.online`** — the bot joins the channel's chat.
- **`stream.offline`** — the bot closes and clears the queue, posts a message, and leaves the channel's chat.

On startup the bot joins only the channels that are currently live; the rest are joined automatically when they next go online. Disconnecting a channel from the admin panel also removes its EventSub subscriptions.

The webhook endpoint is `https://YOUR_DOMAIN/webhook/twitch`. Twitch verifies ownership of this endpoint during subscription setup, so the HTTPS endpoint provided by Caddy is required.

Without these secrets (or without `DOMAIN`), the bot can't receive webhooks and instead falls back to permanently sitting in every connected channel.

---

## GitHub Actions Workflows

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | Push to `main`, any PR | Lints and runs tests |
| `deploy.yml` | After CI passes on `main`, or manual | Builds image → pushes to ghcr.io → writes config → deploys via SSH |
| `invite.yml` | Manual only | Emergency headless fallback — generates a code on the server. Use the admin dashboard instead; the Actions log never shows the code. |

---

## Dependabot

Dependabot opens weekly PRs for npm packages, GitHub Actions, and the Docker base image, all grouped to minimise noise. CI runs automatically on each PR.

---

## Keeping DbD data up to date

Killers, survivors, perks, and maps live in `src/data/` and are community-maintained. Please open a PR when new chapters are released. Use the **DbD Data Update** issue template.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, coding standards, commit conventions, and the PR process.

---

## License

[MIT](LICENSE) — free to use, modify, and distribute.
