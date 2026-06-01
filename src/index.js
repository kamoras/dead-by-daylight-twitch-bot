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
  debug: process.env.NODE_ENV !== 'production',
};

const eventSubConfig = {
  enabled: !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET && process.env.TWITCH_WEBHOOK_SECRET),
  clientId: process.env.TWITCH_CLIENT_ID || '',
  clientSecret: process.env.TWITCH_CLIENT_SECRET || '',
  webhookSecret: process.env.TWITCH_WEBHOOK_SECRET || '',
  callbackUrl: process.env.DOMAIN ? `https://${process.env.DOMAIN}/webhook/twitch` : '',
};

// Webhooks (and therefore stream-based auto-join/leave) only work when the
// Twitch app credentials AND a public callback URL (DOMAIN) are both present.
const webhooksActive = eventSubConfig.enabled && !!eventSubConfig.callbackUrl;

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

const { client, joinChannel, leaveChannel, onStreamOnline, isConnected, getChannelStats, onStreamOffline } = createBot(config, []);

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

const app = createWebServer(
  onChannelAdded,
  onChannelRemoved,
  config.botUsername,
  config.prefix,
  isConnected,
  process.env.DOMAIN || '',
  getChannelStats,
  eventSubConfig.webhookSecret,
  onStreamOnline,
  onStreamOffline
);

app.listen(config.port, () => {
  console.log(`[web] Listening on port ${config.port}`);
});

async function joinAll(channelNames) {
  for (const ch of channelNames) {
    await joinChannel(ch).catch(err => console.error(`[bot] Failed to join #${ch}:`, err.message));
  }
}

client
  .connect()
  .then(async () => {
    console.log(`[bot] Connected as ${config.botUsername}`);

    if (!webhooksActive) {
      // Without working webhooks we can't detect stream start/end, so fall back
      // to the bot permanently sitting in every connected channel.
      if (!eventSubConfig.enabled) {
        console.log('[eventsub] Disabled — set TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET and TWITCH_WEBHOOK_SECRET to enable stream-based auto-join/leave');
      } else {
        console.log('[eventsub] DOMAIN not set — cannot receive webhooks; joining all channels permanently');
      }
      await joinAll(storedChannels);
      return;
    }

    console.log('[eventsub] Syncing stream subscriptions...');
    await eventsub.syncSubscriptions({
      channels: storedChannels,
      callbackUrl: eventSubConfig.callbackUrl,
      webhookSecret: eventSubConfig.webhookSecret,
      clientId: eventSubConfig.clientId,
      clientSecret: eventSubConfig.clientSecret,
    });

    // Join only the channels that are currently live; the rest are joined on
    // their next stream.online webhook.
    const liveChannels = await eventsub.getLiveChannels({
      channels: storedChannels,
      clientId: eventSubConfig.clientId,
      clientSecret: eventSubConfig.clientSecret,
    }).catch(err => {
      console.error('[bot] Could not check live status on startup — joining all channels as fallback:', err.message);
      return storedChannels;
    });
    await joinAll(liveChannels);
    console.log(`[bot] ${liveChannels.length} channel(s) live on startup${liveChannels.length ? ': ' + liveChannels.join(', ') : ''}`);
  })
  .catch(err => {
    console.error('[bot] Connection failed:', err.message);
    process.exit(1);
  });

process.on('SIGTERM', async () => {
  console.log('[bot] SIGTERM received, shutting down...');
  try {
    await client.disconnect();
  } catch {
    // already disconnected
  }
  db.close();
  process.exit(0);
});
