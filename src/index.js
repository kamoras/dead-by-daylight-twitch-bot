'use strict';

require('dotenv').config({ quiet: true });
const db = require('./db');
const { createBot } = require('./bot');
const { createWebServer } = require('./web');

const config = {
  botUsername: process.env.TWITCH_BOT_USERNAME,
  botToken: process.env.TWITCH_BOT_TOKEN,
  prefix: process.env.BOT_PREFIX || '!dbd ',
  rolesMode: process.env.QUEUE_ROLES_MODE || 'off',
  queueMaxSize: parseInt(process.env.QUEUE_MAX_SIZE || '20', 10),
  port: Number(process.env.PORT) || 8080,
  debug: process.env.NODE_ENV !== 'production',
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

const { client, joinChannel, isConnected } = createBot(config, storedChannels);

const app = createWebServer(joinChannel, config.botUsername, config.prefix, isConnected, process.env.DOMAIN || '');
app.listen(config.port, () => {
  console.log(`[web] Listening on port ${config.port}`);
});

client
  .connect()
  .then(() => console.log(`[bot] Connected as ${config.botUsername}`))
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
