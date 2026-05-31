'use strict';

const express = require('express');
const db = require('./db');

const START_TIME = Date.now();

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#0a0a10"/>
  <g stroke="#cc2222" stroke-linecap="round" stroke-linejoin="round" fill="none" stroke-width="2.2">
    <circle cx="15" cy="6.5" r="3.2"/>
    <line x1="15" y1="9.7" x2="15" y2="21.5"/>
    <path d="M15 21.5 Q15 27.5 20.5 27.5 Q26 27.5 26 22.5"/>
    <line x1="26" y1="22.5" x2="21.5" y2="21"/>
  </g>
</svg>`;

const FAVICON_URI = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`;

const OG_IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="65%">
      <stop offset="0%" stop-color="#1a0820"/>
      <stop offset="100%" stop-color="#050508"/>
    </radialGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="618" width="1200" height="12" fill="#8b0000" opacity="0.8"/>
  <g transform="translate(90,130)" stroke="#cc2222" fill="none" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)" opacity="0.85">
    <circle cx="85" cy="52" r="38" stroke-width="13"/>
    <line x1="85" y1="90" x2="85" y2="275" stroke-width="13"/>
    <path d="M85 275 Q85 345 155 345 Q225 345 225 275" stroke-width="13"/>
    <line x1="225" y1="275" x2="178" y2="258" stroke-width="13"/>
  </g>
  <line x1="365" y1="175" x2="365" y2="455" stroke="#cc2222" stroke-width="1.5" stroke-opacity="0.25"/>
  <text x="410" y="265" font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="82" font-weight="700" fill="#ffffff" letter-spacing="0">Dead by Daylight</text>
  <text x="414" y="355" font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="62" font-weight="700" fill="#cc2222" letter-spacing="10">QUEUE BOT</text>
  <text x="416" y="428" font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="28" fill="#555577" letter-spacing="4">Invite-only  •  Multi-channel  •  Free</text>
</svg>`;

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

function metaTags(baseUrl) {
  if (!baseUrl) return '';
  return `
  <meta property="og:type" content="website">
  <meta property="og:url" content="${baseUrl}">
  <meta property="og:title" content="DbD Queue Bot — Enter the Fog">
  <meta property="og:description" content="Connect your Twitch channel to the Dead by Daylight Queue Bot. Invite-only, multi-channel, free.">
  <meta property="og:image" content="${baseUrl}/og-image.svg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="DbD Queue Bot — Enter the Fog">
  <meta name="twitter:description" content="Connect your Twitch channel to the Dead by Daylight Queue Bot.">
  <meta name="twitter:image" content="${baseUrl}/og-image.svg">`;
}

function renderPage({ title, heading, headingColor = '#cc2222', body, botName, baseUrl = '' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="icon" type="image/svg+xml" href="${FAVICON_URI}">
  <link rel="apple-touch-icon" href="${FAVICON_URI}">${metaTags(baseUrl)}
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

function renderLanding(botName, errorMsg, prefix, baseUrl) {
  return renderPage({
    title: 'Enter the Fog — DbD Queue Bot',
    heading: 'Enter the Fog',
    botName,
    baseUrl,
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

function createWebServer(joinChannel, botName, prefix = '!dbd ', isConnected = () => true, domain = '') {
  const baseUrl = domain ? `https://${domain}` : '';
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.urlencoded({ extended: false }));

  app.get('/og-image.svg', (_req, res) => {
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(OG_IMAGE_SVG);
  });

  app.get('/', (_req, res) => {
    res.send(renderLanding(botName, null, prefix, baseUrl));
  });

  app.post('/onboard', rateLimit, (req, res) => {
    const rawCode = (req.body.invite_code || '').trim();
    const rawChannel = (req.body.channel_name || '').trim().toLowerCase().replace(/^#/, '');

    if (!rawCode || !rawChannel) {
      return res.status(400).send(renderLanding(botName, 'Both fields are required.', prefix, baseUrl));
    }

    if (!/^[a-zA-Z0-9_]{3,25}$/.test(rawChannel)) {
      return res.status(400).send(renderLanding(botName, 'Invalid channel name. Use only letters, numbers, and underscores (3–25 characters).', prefix, baseUrl));
    }

    if (db.channelExists(rawChannel)) {
      return res.status(400).send(renderLanding(botName, 'This channel is already connected.', prefix, baseUrl));
    }

    const valid = db.validateAndUseCode(rawCode, rawChannel);
    if (!valid) {
      return res.status(400).send(renderLanding(botName, 'Invalid or already-used invite code.', prefix, baseUrl));
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
