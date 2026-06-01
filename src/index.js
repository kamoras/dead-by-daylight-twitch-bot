'use strict';

require('dotenv').config({ quiet: true });
const db = require('./db');
const { createBot } = require('./bot');
const { createWebServer } = require('./web');
const eventsub = require('./eventsub');

const config = {
  botUsername: process.env.TWITCH_BOT_USERNAME,
  botToken: process.env.TWITCH_BOT_TOKEN,
  prefix: (() => {
    const p = process.env.BOT_PREFIX || '!dbd ';
    return p.length > 1 && !p.endsWith(' ') ? p + ' ' : p;
  })(),
  rolesMode: process.env.QUEUE_ROLES_MODE || 'off',
  queueMaxSize: parseInt(process.env.QUEUE_MAX_SIZE || '20', 10),
  port: Number(process.env.PORT) || 8080,
  // Reconciliation poll cadence (floored at 30s to stay well within Twitch rate limits).
  pollIntervalMs: Math.max(30_000, Number(process.env.STREAM_POLL_INTERVAL_MS) || 90_000),
  debug: process.env.NODE_ENV !== 'production',
};

const eventSubConfig = {
  clientId: process.env.TWITCH_CLIENT_ID || '',
  clientSecret: process.env.TWITCH_CLIENT_SECRET || '',
  webhookSecret: process.env.TWITCH_WEBHOOK_SECRET || '',
  callbackUrl: process.env.DOMAIN ? `https://${process.env.DOMAIN}/webhook/twitch` : '',
};

// Querying who's live (the backbone of live-only presence via polling) needs
// only the app credentials. Webhooks — which add instant join/leave on top of
// polling — additionally require a shared secret and a public callback URL.
const streamApiEnabled = !!(eventSubConfig.clientId && eventSubConfig.clientSecret);
const webhooksActive = streamApiEnabled && !!eventSubConfig.webhookSecret && !!eventSubConfig.callbackUrl;

const REQUIRED_VARS = {
  botUsername: 'TWITCH_BOT_USERNAME',
  botToken: 'TWITCH_BOT_TOKEN',
};
for (const [key, envVar] of Object.entries(REQUIRED_VARS)) {
  if (!config[key]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const VALID_ROLES_MODES = ['off', 'both', 'survivor', 'killer'];
if (!VALID_ROLES_MODES.includes(config.rolesMode)) {
  console.error(
    `Invalid QUEUE_ROLES_MODE: "${config.rolesMode}". Valid values: ${VALID_ROLES_MODES.join(', ')}`
  );
  process.exit(1);
}

process.on('unhandledRejection', reason => {
  console.error('[fatal] Unhandled rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', err => {
  console.error('[fatal] Uncaught exception:', err.message);
  process.exit(1);
});

const storedChannels = db.getActiveChannels().map(r => r.channel_name);
console.log(`[db] Loaded ${storedChannels.length} channel(s) from database`);

const { client, joinChannel, leaveChannel, onStreamOnline, isConnected, getChannelStats, getJoinedChannels, onStreamOffline } = createBot(config, []);

// Combines channel join + EventSub subscription for use by the onboarding flow.
async function onChannelAdded(channelName) {
  await joinChannel(channelName);
  if (webhooksActive) {
    await eventsub.subscribeChannel({
      channel: channelName,
      callbackUrl: eventSubConfig.callbackUrl,
      webhookSecret: eventSubConfig.webhookSecret,
      clientId: eventSubConfig.clientId,
      clientSecret: eventSubConfig.clientSecret,
    });
  }
}

// Leaves the channel and tears down its EventSub subscriptions so a future
// stream.online for a disconnected channel can't make the bot rejoin.
async function onChannelRemoved(channelName) {
  await leaveChannel(channelName);
  if (webhooksActive) {
    await eventsub.unsubscribeChannel({
      channel: channelName,
      clientId: eventSubConfig.clientId,
      clientSecret: eventSubConfig.clientSecret,
    });
  }
}

const app = createWebServer({
  botName: config.botUsername,
  prefix: config.prefix,
  domain: process.env.DOMAIN || '',
  webhookSecret: eventSubConfig.webhookSecret,
  onChannelAdded,
  onChannelRemoved,
  joinChannel,
  leaveChannel,
  isConnected,
  getChannelStats,
  getJoinedChannels,
  onStreamOnline,
  onStreamOffline,
});

app.listen(config.port, () => {
  console.log(`[web] Listening on port ${config.port}`);
});

async function joinAll(channelNames) {
  for (const ch of channelNames) {
    await joinChannel(ch).catch(err => console.error(`[bot] Failed to join #${ch}:`, err.message));
  }
}

// Reconcile chat presence with live status: join channels that are live but
// not joined, and leave managed channels that are joined but no longer live.
// This is the backbone of live-only presence and self-heals any webhook that
// was missed or never delivered.
async function reconcilePresence() {
  const stored = db.getActiveChannels().map(r => r.channel_name);
  let live;
  try {
    live = await eventsub.getLiveChannels({
      channels: stored,
      clientId: eventSubConfig.clientId,
      clientSecret: eventSubConfig.clientSecret,
    });
  } catch (err) {
    console.error('[reconcile] Live-status check failed, leaving presence unchanged:', err.message);
    return;
  }

  const liveSet = new Set(live);
  const storedSet = new Set(stored);
  const joined = getJoinedChannels();
  const joinedSet = new Set(joined);

  for (const ch of live) {
    if (!joinedSet.has(ch)) {
      console.log(`[reconcile] #${ch} is live but not joined — joining`);
      await joinChannel(ch).catch(err => console.error(`[reconcile] Join #${ch} failed:`, err.message));
    }
  }
  for (const ch of joined) {
    if (storedSet.has(ch) && !liveSet.has(ch)) {
      console.log(`[reconcile] #${ch} is no longer live but still joined — leaving`);
      onStreamOffline(ch);
    }
  }
}

let pollTimer = null;

client
  .connect()
  .then(async () => {
    console.log(`[bot] Connected as ${config.botUsername}`);

    if (!streamApiEnabled) {
      // No Twitch app credentials — we can't tell who's live, so fall back to
      // the bot permanently sitting in every connected channel.
      console.log('[eventsub] No Twitch credentials — set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET for live-only presence');
      await joinAll(storedChannels);
      return;
    }

    // Webhooks give instant join/leave; without them we rely on polling alone.
    if (webhooksActive) {
      console.log('[eventsub] Syncing stream subscriptions...');
      await eventsub.syncSubscriptions({
        channels: storedChannels,
        callbackUrl: eventSubConfig.callbackUrl,
        webhookSecret: eventSubConfig.webhookSecret,
        clientId: eventSubConfig.clientId,
        clientSecret: eventSubConfig.clientSecret,
      });
    } else {
      console.log('[eventsub] Webhooks inactive (need TWITCH_WEBHOOK_SECRET + DOMAIN) — relying on reconciliation polling for live-only presence');
    }

    // Initial presence sync, then poll to keep it correct and catch missed webhooks.
    await reconcilePresence();
    pollTimer = setInterval(() => { reconcilePresence().catch(() => {}); }, config.pollIntervalMs);
    console.log(`[bot] Live-only presence active (reconciling every ${Math.round(config.pollIntervalMs / 1000)}s)`);
  })
  .catch(err => {
    console.error('[bot] Connection failed:', err.message);
    process.exit(1);
  });

process.on('SIGTERM', async () => {
  console.log('[bot] SIGTERM received, shutting down...');
  if (pollTimer) clearInterval(pollTimer);
  try {
    await client.disconnect();
  } catch {
    // already disconnected
  }
  db.close();
  process.exit(0);
});
