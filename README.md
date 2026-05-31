# Dead by Daylight Twitch Bot 🔪

[![CI](https://github.com/kamoras/dead-by-daylight-twitch-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/kamoras/dead-by-daylight-twitch-bot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A Twitch chat bot for Dead by Daylight streamers. Manages a viewer queue for on-stream play sessions and includes DbD-themed commands.

One bot instance serves multiple streamers. Streamers self-onboard through an invite-only landing page — no manual config needed per channel.

## Features

- **Queue management** — viewers sign up, check their position, and leave at will
- **Role modes** — configure the queue as survivor-only, killer-only, mixed, or no roles
- **Moderator controls** — open/close the queue, call up the next player, remove users
- **Multi-channel** — one bot instance serves multiple streamers
- **Invite-only onboarding** — streamers connect their channel through a landing page using single-use invite codes you generate
- **DbD extras** — random killer, survivor, perk, map, and messages from the Entity
- **Free hosting** — runs on Oracle Cloud Always Free tier (no expiry, credit card required to sign up)
- **Auto-deploy** — GitHub Actions builds, pushes, and deploys on every merge to `main`
- **HTTPS** — Caddy reverse proxy handles TLS automatically via Let's Encrypt
- **Dependabot** — automatic weekly dependency update PRs

---

## Commands

All commands use the `!dbd` prefix by default (e.g. `!dbd join`). This is configurable via `BOT_PREFIX`.

### Everyone

| Command | Description |
|---------|-------------|
| `!dbd join` | Join the queue (when `QUEUE_ROLES_MODE=both`, use `!dbd join survivor` or `!dbd join killer`) |
| `!dbd leave` | Leave the queue |
| `!dbd queue` | Show the first 5 people in the queue |
| `!dbd position` | Check your spot in the queue |
| `!dbd killer` | Get a random killer |
| `!dbd survivor` | Get a random survivor |
| `!dbd perk [killer\|survivor]` | Get a random perk (optionally filtered by side) |
| `!dbd map` | Get a random map |
| `!dbd entity` | Hear from the Entity |
| `!dbd help` | Print all available commands |

### Moderators only

| Command | Description |
|---------|-------------|
| `!dbd open` | Open the queue |
| `!dbd close` | Close the queue |
| `!dbd pick` | Call up the next person and remove them from the queue |
| `!dbd next` | Preview who's next without removing them |
| `!dbd remove <username>` | Remove a specific user from the queue |
| `!dbd clear` | Clear the entire queue |

---

## Configuration

All configuration is done via environment variables. In production these are set as GitHub Actions secrets and synced to the server on every deploy. For local development, copy `.env.example` to `.env`.

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `TWITCH_BOT_USERNAME` | ✅ | — | Twitch username of the bot account |
| `TWITCH_BOT_TOKEN` | ✅ | — | OAuth token for the bot, prefixed with `oauth:` |
| `DOMAIN` | ✅ | — | Your domain name — Caddy uses this to obtain a TLS certificate |
| `ADMIN_PASSWORD` | ✅ | — | Password for the `/admin` page used to generate invite codes |
| `BOT_PREFIX` | | `!dbd ` | Command prefix (include trailing space for multi-word prefixes) |
| `QUEUE_ROLES_MODE` | | `both` | `off` · `both` · `survivor` · `killer` |
| `QUEUE_MAX_SIZE` | | `20` | Maximum queue size |
| `PORT` | | `8080` | Internal port (Caddy proxies to this — do not expose it publicly) |
| `DB_PATH` | | `./data/bot.db` | Path to the SQLite database file inside the container (maps to `/opt/dbd-bot/data/bot.db` on the host) |

### Getting a Twitch OAuth token

1. Create a dedicated Twitch account for the bot.
2. Go to the [Twitch Developer Console](https://dev.twitch.tv/console) and register a new application.
3. Set the OAuth Redirect URL to `http://localhost`.
4. Construct the following URL (replacing `YOUR_CLIENT_ID`) and open it in a browser while logged in as the bot account:
   ```
   https://id.twitch.tv/oauth2/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost&response_type=token&scope=chat:read+chat:edit
   ```
5. Authorize the app. The browser will redirect to `http://localhost` — copy the `access_token` value from the URL bar.
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
# Fill in TWITCH_BOT_USERNAME and TWITCH_BOT_TOKEN

# 3. Run with auto-reload
npm run dev
```

The landing page is at `http://localhost:8080`. To onboard a test channel, generate a local invite code:

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
| `ADMIN_PASSWORD` | ✅ | Password for `https://YOUR_DOMAIN/admin` |
| `QUEUE_ROLES_MODE` | | Defaults to `both` |
| `QUEUE_MAX_SIZE` | | Defaults to `20` |
| `BOT_PREFIX` | | Defaults to `!dbd ` |

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

The SQLite database is stored at `/opt/dbd-bot/data/bot.db` on the host — it persists across container recreation and is accessible directly without going through Docker. To back it up:

```bash
cp /opt/dbd-bot/data/bot.db ~/dbd-bot-backup.sql
```

### 5 — Onboard a channel

1. Visit `https://YOUR_DOMAIN/admin` and enter your `ADMIN_PASSWORD`.
2. Click **Generate Code** — the code is displayed only to you, never in any logs.
3. Share the code with the streamer.
4. They visit `https://YOUR_DOMAIN`, enter the code and their channel name.
5. They type `/mod YOUR_BOT_USERNAME` in their Twitch chat — done.

---

## GitHub Actions Workflows

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | Push to `main`, any PR | Lints and runs tests |
| `deploy.yml` | After CI passes on `main`, or manual | Builds image → pushes to ghcr.io → writes config → deploys via SSH |
| `invite.yml` | Manual only | Emergency headless fallback — generates a code on the server but masks it from logs. Use `https://YOUR_DOMAIN/admin` instead. |

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
