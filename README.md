# Dead by Daylight Twitch Bot 🔪

[![CI](https://github.com/kamoras/dead-by-daylight-twitch-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/kamoras/dead-by-daylight-twitch-bot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A Twitch chat bot for Dead by Daylight streamers. Manages a viewer queue for on-stream play sessions and includes DbD-themed fun commands.

Streamers self-onboard via an invite-only landing page — no manual config needed per channel. Channels and invite codes are stored in a local SQLite database.

## Features

- **Queue management** — viewers sign up, check their position, and leave at will
- **Role modes** — configure the queue as survivor-only, killer-only, mixed roles, or no roles
- **Moderator controls** — open/close the queue, call up the next player, or remove users
- **Multi-channel** — one bot instance serves multiple streamers
- **Invite-only onboarding** — streamers get a landing page to self-connect their channel; access is gated by single-use invite codes you generate
- **DbD extras** — random killer, survivor, perk, map, and messages from the Entity
- **Genuinely free hosting** — runs on Oracle Cloud Always Free tier
- **Auto-deploy** — GitHub Actions deploys on every merge to `main` after CI passes
- **Dependabot** — automatic weekly dependency update PRs

---

## Commands

### Everyone

| Command | Description |
|---------|-------------|
| `!join` | Join the queue (when `QUEUE_ROLES_MODE=both`, use `!join survivor` or `!join killer`) |
| `!leave` | Leave the queue |
| `!queue` | Show the first 5 people in the queue |
| `!position` | Check your spot in the queue |
| `!killer` | Get a random killer |
| `!survivor` | Get a random survivor |
| `!perk [killer\|survivor]` | Get a random perk (optionally filtered by side) |
| `!map` | Get a random map |
| `!entity` | Hear from the Entity |
| `!help` | Print all available commands |

### Moderators only

| Command | Description |
|---------|-------------|
| `!open` | Open the queue |
| `!close` | Close the queue |
| `!pick` | Call up the next person and remove them from the queue |
| `!next` | Preview who's next without removing them |
| `!remove <username>` | Remove a specific user from the queue |
| `!clear` | Clear the entire queue |

---

## Configuration

All configuration is done via environment variables. Copy `.env.example` to `.env` and fill it in.

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `TWITCH_BOT_USERNAME` | ✅ | — | Twitch username of the bot account |
| `TWITCH_BOT_TOKEN` | ✅ | — | OAuth token for the bot, prefixed with `oauth:` |
| `BOT_PREFIX` | | `!` | Command prefix |
| `QUEUE_ROLES_MODE` | | `off` | `off` · `both` · `survivor` · `killer` |
| `QUEUE_MAX_SIZE` | | `20` | Maximum queue size |
| `PORT` | | `8080` | Port for the landing page and health check |
| `DB_PATH` | | `./data/bot.db` | Path to the SQLite database file |

### Getting a Twitch OAuth token

1. Create a dedicated Twitch account for your bot (strongly recommended).
2. Go to the [Twitch Developer Console](https://dev.twitch.tv/console) and create a new application.
3. Under **OAuth Redirect URLs**, add `http://localhost`.
4. Generate a user access token with the `chat:read` and `chat:edit` scopes.
5. Prefix the token with `oauth:` when setting `TWITCH_BOT_TOKEN`.

---

## Local Development

```bash
# 1. Clone and install
git clone https://github.com/kamoras/dead-by-daylight-twitch-bot.git
cd dead-by-daylight-twitch-bot
npm install

# 2. Configure
cp .env.example .env
# Edit .env with your Twitch bot credentials

# 3. Run with auto-reload
npm run dev
```

The landing page will be available at `http://localhost:8080`. Generate a local invite code to onboard your test channel:

```bash
npm run invite
```

Then visit `http://localhost:8080`, enter the code and your channel name to connect it.

Other scripts:

```bash
npm test        # Run unit tests
npm run lint    # Lint source files
npm start       # Production start (no auto-reload)
```

---

## Deploying to Oracle Cloud Always Free

Oracle Cloud's Always Free tier provides VMs with no expiry and no surprise charges, though a credit card is required to create an account.

The setup below uses **Docker Compose** on the Oracle VM and **GitHub Container Registry** (ghcr.io) to deliver images. GitHub Actions handles building and deploying automatically.

### 1 — Provision an Oracle Cloud VM

1. Sign up at [cloud.oracle.com](https://cloud.oracle.com) and create a free account.
2. Navigate to **Compute → Instances → Create Instance**.
3. Choose an **Always Free** shape: `VM.Standard.E2.1.Micro` (AMD) or `VM.Standard.A1.Flex` (Arm, 1 OCPU / 6 GB).
4. Select **Ubuntu 24 Minimal** as the image.
5. Add your SSH public key.
6. Under **Networking**, ensure a public IP is assigned.
7. Note the **Public IP address** once the instance starts.

#### Open ports in Oracle's security rules and the VM firewall

In the Oracle console: **Networking → Virtual Cloud Networks → your VCN → Security Lists** — add an ingress rule for TCP port 8080 (for the landing page).

Then on the VM itself:

```bash
sudo iptables -I INPUT -p tcp --dport 22 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 8080 -j ACCEPT
sudo netfilter-persistent save
```

### 2 — Set up the Oracle VM

SSH into the VM:

```bash
# Install Docker
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
sudo usermod -aG docker $USER
newgrp docker

# Create the app directory
sudo mkdir -p /opt/dbd-bot
sudo chown $USER:$USER /opt/dbd-bot
cd /opt/dbd-bot

# Clone the repo
git clone https://github.com/kamoras/dead-by-daylight-twitch-bot.git .

# Edit docker-compose.yml: replace kamoras with your GitHub username
nano docker-compose.yml

# Create the .env file with your real secrets (never commit this file)
cp .env.example .env
nano .env

# Create the data directory for the SQLite database
mkdir -p data
```

### 3 — Generate a deploy SSH key pair

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

### 4 — Add GitHub Actions secrets

In your GitHub repository go to **Settings → Secrets and variables → Actions → Repository secrets** and add:

| Secret | Value |
|--------|-------|
| `ORACLE_HOST` | Oracle VM public IP or hostname |
| `ORACLE_USER` | SSH username (`ubuntu`) |
| `ORACLE_SSH_KEY` | Contents of `~/.ssh/dbd_deploy` (the **private** key) |

### 5 — Deploy

Push a commit to `main`. GitHub Actions will:

1. Run lint and tests.
2. Build a multi-arch Docker image and push it to `ghcr.io/kamoras/dead-by-daylight-twitch-bot:latest`.
3. SSH into the Oracle VM and run `docker compose pull && docker compose up -d`.

You can watch progress under **Actions** in your repository.

Verify on the Oracle VM:

```bash
docker compose logs -f
```

### 6 — Onboard a channel

Generate an invite code from GitHub Actions:

1. Go to **Actions → Generate Invite Code → Run workflow**.
2. The code appears in the workflow logs.
3. Share the code with the streamer.
4. They visit `http://YOUR_VM_IP:8080`, enter the code and their channel name.
5. They type `/mod YOUR_BOT_USERNAME` in their Twitch chat — done.

---

## GitHub Actions Workflows

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | Push to `main`, any PR | Lints and runs tests |
| `deploy.yml` | After CI passes on `main`, or manual | Builds image → pushes to ghcr.io → deploys via SSH |
| `invite.yml` | Manual only | SSHes into the Oracle VM and runs the invite code generator; code appears in the run logs |

---

## Dependabot

Dependabot opens weekly PRs for npm packages, GitHub Actions, and the Docker base image — all grouped to minimise noise. CI runs automatically on each PR.

---

## Keeping DbD data up to date

Killers, survivors, perks, and maps live in `src/data/` and are community-maintained. Please open a PR when new chapters are released.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, coding standards, commit conventions, and the PR process. DbD data updates (new killers, survivors, maps, perks) are especially welcome.

---

## License

[MIT](LICENSE) — free to use, modify, and distribute.
