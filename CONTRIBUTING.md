# Contributing to Dead by Daylight Twitch Bot

Thank you for taking the time to contribute! This document covers everything you need to get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Running Tests](#running-tests)
- [Code Style](#code-style)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Updating DbD Data](#updating-dbd-data)
- [Reporting Bugs](#reporting-bugs)

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to uphold it.

---

## Getting Started

1. **Fork** the repository and clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/dead-by-daylight-twitch-bot.git
   cd dead-by-daylight-twitch-bot
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure your environment:**
   ```bash
   cp .env.example .env
   # Fill in TWITCH_BOT_USERNAME and TWITCH_BOT_TOKEN
   ```

4. **Create a feature branch:**
   ```bash
   git checkout -b feat/your-feature-name
   ```

---

## Development Workflow

Start the bot with auto-reload:
```bash
npm run dev
```

The landing page is available at `http://localhost:8080`.

Generate a local invite code to onboard a test channel:
```bash
npm run invite
```

---

## Running Tests

```bash
npm test        # Run all tests
npm run lint    # Lint source files
```

Both must pass before a PR can be merged. Please add tests for any new behaviour you introduce.

---

## Code Style

- ESLint is configured via `eslint.config.js` — run `npm run lint` to check
- No comments unless the *why* is non-obvious
- No trailing `console.log` statements left in production paths
- Keep functions small and focused

---

## Commit Messages

Use the imperative mood and keep the subject line under 72 characters:

```
feat: add !lurk command
fix: prevent duplicate queue entries on reconnect
chore: bump tmi.js to 1.9.0
```

Common prefixes: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`.

---

## Pull Request Process

1. Make sure `npm test` and `npm run lint` both pass locally.
2. Open a PR against `main` using the provided template.
3. Keep PRs focused — one feature or fix per PR.
4. A maintainer will review and merge or request changes.

CI must be green before any PR is merged.

---

## Updating DbD Data

The killer, survivor, perk, and map lists in `src/data/` need updating whenever a new chapter releases. This is one of the most valuable contributions you can make.

Files to update:

| File | What to add |
|------|-------------|
| `src/data/killers.js` | New killer name (e.g. `'The Houndmaster'`) |
| `src/data/survivors.js` | New survivor name (e.g. `'Sable Ward'`) |
| `src/data/perks.js` | New perks in the correct `survivor` or `killer` array |
| `src/data/maps.js` | New map name |

Please use the official in-game name exactly as it appears. Use the **DbD Data Update** issue template to propose additions before opening a PR if you're unsure.

---

## Reporting Bugs

Please use the **Bug Report** issue template. Include steps to reproduce, expected behaviour, and actual behaviour. Do **not** post Twitch credentials or OAuth tokens in issues.

For security vulnerabilities, see [SECURITY.md](SECURITY.md).
