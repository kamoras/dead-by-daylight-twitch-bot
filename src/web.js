'use strict';

const express = require('express');
const db = require('./db');

const START_TIME = Date.now();

// Basic in-memory rate limiter for the onboarding endpoint.
const attempts = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const window = 15 * 60 * 1000; // 15 minutes
  const entry = attempts.get(ip);
  if (entry && now < entry.resetAt) {
    if (entry.count >= 5) {
      return res.status(429).send(renderError('Too many attempts. Please wait 15 minutes and try again.'));
    }
    entry.count += 1;
  } else {
    attempts.set(ip, { count: 1, resetAt: now + window });
  }
  next();
}

function renderPage({ title, heading, headingColor = '#cc2222', body, botName }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#080810;color:#c8c8d8;font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background-image:radial-gradient(ellipse at top,#1a0a1a 0%,#080810 70%)}
    .card{background:rgba(20,10,25,.95);border:1px solid rgba(180,0,0,.3);border-radius:8px;padding:2.5rem;width:100%;max-width:440px;box-shadow:0 0 60px rgba(120,0,0,.2)}
    h1{font-size:1.6rem;color:${headingColor};margin-bottom:.4rem;letter-spacing:.05em}
    .sub{font-size:.9rem;color:#888;margin-bottom:2rem}
    label{display:block;font-size:.85rem;color:#aaa;margin-bottom:.4rem}
    input{width:100%;padding:.65rem .9rem;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:4px;color:#e8e8e8;font-size:.95rem;margin-bottom:1.2rem;outline:none;transition:border-color .2s}
    input:focus{border-color:rgba(180,0,0,.6)}
    button{width:100%;padding:.75rem;background:#8b0000;color:#fff;border:none;border-radius:4px;font-size:1rem;cursor:pointer;transition:background .2s}
    button:hover{background:#a00000}
    .steps{margin-top:1.8rem;padding-top:1.4rem;border-top:1px solid rgba(255,255,255,.06)}
    .steps p{font-size:.8rem;color:#666;margin-bottom:.5rem}
    .steps ol{font-size:.82rem;color:#888;padding-left:1.2rem;line-height:1.8}
    .steps code{background:rgba(255,255,255,.08);padding:.1rem .35rem;border-radius:3px;font-size:.82rem}
    .steps strong{color:#ccc}
    .error{background:rgba(180,0,0,.15);border:1px solid rgba(180,0,0,.4);border-radius:4px;padding:.75rem 1rem;margin-bottom:1.2rem;color:#ff6666;font-size:.9rem}
  </style>
</head>
<body>
  <div class="card">
    <h1>${heading}</h1>
    ${body(botName)}
  </div>
</body>
</html>`;
}

function renderLanding(botName, errorMsg, prefix) {
  return renderPage({
    title: 'Enter the Fog — DbD Queue Bot',
    heading: 'Enter the Fog',
    botName,
    body: (bot) => `
      <p class="sub">Connect your Twitch channel to the DbD Queue Bot</p>
      ${errorMsg ? `<div class="error">${errorMsg}</div>` : ''}
      <form method="POST" action="/onboard">
        <label for="invite_code">Invite Code</label>
        <input type="text" id="invite_code" name="invite_code" placeholder="XXXX-XXXX" autocomplete="off" spellcheck="false" required>
        <label for="channel_name">Your Twitch Channel Name</label>
        <input type="text" id="channel_name" name="channel_name" placeholder="your_channel" autocomplete="off" spellcheck="false" required>
        <button type="submit">Join the Fog →</button>
      </form>
      <div class="steps">
        <p>After connecting:</p>
        <ol>
          <li>Go to your Twitch channel</li>
          <li>Type <code>/mod ${bot}</code> in chat to make the bot a moderator</li>
          <li>Type <code>${prefix}help</code> to see all commands</li>
        </ol>
      </div>`,
  });
}

function renderSuccess(botName, channelName, prefix) {
  return renderPage({
    title: "You're in the Fog!",
    heading: "You're in the Fog!",
    headingColor: '#33cc66',
    botName,
    body: (bot) => `
      <p class="sub">Channel <strong style="color:#fff">${channelName}</strong> is now connected.</p>
      <div class="steps" style="margin-top:1.5rem;padding-top:0;border:none">
        <p>Next steps:</p>
        <ol>
          <li>Go to your Twitch channel</li>
          <li>Type <code>/mod ${bot}</code> in chat</li>
          <li>Type <code>${prefix}help</code> to see all available commands</li>
        </ol>
      </div>`,
  });
}

function renderError(message) {
  return `<html><body style="font-family:sans-serif;background:#080810;color:#ff6666;display:flex;align-items:center;justify-content:center;height:100vh"><p>${message}</p></body></html>`;
}

function createWebServer(joinChannel, botName, prefix = '!dbd ', isConnected = () => true) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.urlencoded({ extended: false }));

  app.get('/', (_req, res) => {
    res.send(renderLanding(botName, null, prefix));
  });

  app.post('/onboard', rateLimit, (req, res) => {
    const rawCode = (req.body.invite_code || '').trim();
    const rawChannel = (req.body.channel_name || '').trim().toLowerCase().replace(/^#/, '');

    if (!rawCode || !rawChannel) {
      return res.status(400).send(renderLanding(botName, 'Both fields are required.', prefix));
    }

    if (!/^[a-zA-Z0-9_]{3,25}$/.test(rawChannel)) {
      return res.status(400).send(renderLanding(botName, 'Invalid channel name. Use only letters, numbers, and underscores (3–25 characters).', prefix));
    }

    if (db.channelExists(rawChannel)) {
      return res.status(400).send(renderLanding(botName, 'This channel is already connected.', prefix));
    }

    const valid = db.validateAndUseCode(rawCode, rawChannel);
    if (!valid) {
      return res.status(400).send(renderLanding(botName, 'Invalid or already-used invite code.', prefix));
    }

    db.addChannel(rawChannel, rawChannel);
    joinChannel(rawChannel).catch(err => {
      console.error(`[web] Failed to join #${rawChannel}:`, err.message);
    });

    return res.send(renderSuccess(botName, rawChannel, prefix));
  });

  app.get('/health', (_req, res) => {
    const connected = isConnected();
    res
      .status(connected ? 200 : 503)
      .json({ status: connected ? 'ok' : 'disconnected', uptimeMs: Date.now() - START_TIME });
  });

  return app;
}

function _resetRateLimiterForTesting() {
  attempts.clear();
}

module.exports = { createWebServer, _resetRateLimiterForTesting };
