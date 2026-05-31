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

const { client, joinChannel, isConnected, getChannelStats, onStreamOffline } = createBot(config, storedChannels);

// Combines channel join + EventSub subscription for use by the onboarding flow.
async function onChannelAdded(channelName) {
  await joinChannel(channelName);
  if (eventSubConfig.enabled && eventSubConfig.callbackUrl) {
    await eventsub.subscribeChannel({
      channel: channelName,
      callbackUrl: eventSubConfig.callbackUrl,
      webhookSecret: eventSubConfig.webhookSecret,
      clientId: eventSubConfig.clientId,
      clientSecret: eventSubConfig.clientSecret,
    });
  }
}

const app = createWebServer(
  onChannelAdded,
  config.botUsername,
  config.prefix,
  isConnected,
  process.env.DOMAIN || '',
  getChannelStats,
  eventSubConfig.webhookSecret,
  onStreamOffline
);

app.listen(config.port, () => {
  console.log(`[web] Listening on port ${config.port}`);
});

client
  .connect()
  .then(async () => {
    console.log(`[bot] Connected as ${config.botUsername}`);

    if (eventSubConfig.enabled && eventSubConfig.callbackUrl) {
      console.log('[eventsub] Syncing stream.offline subscriptions...');
      await eventsub.syncSubscriptions({
        channels: storedChannels,
        callbackUrl: eventSubConfig.callbackUrl,
        webhookSecret: eventSubConfig.webhookSecret,
        clientId: eventSubConfig.clientId,
        clientSecret: eventSubConfig.clientSecret,
      });
    } else if (!eventSubConfig.enabled) {
      console.log('[eventsub] Disabled — set TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET and TWITCH_WEBHOOK_SECRET to enable auto stream-end detection');
    }
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
