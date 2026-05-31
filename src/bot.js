'use strict';

const tmi = require('tmi.js');
const Queue = require('./queue');
const queueCommands = require('./commands/queue');
const dbdCommands = require('./commands/dbd');

function createBot(config, initialChannels = []) {
  // Per-channel queue state, keyed by normalised channel name (no #, lowercase).
  const queues = new Map();

  function getQueue(channel) {
    const key = channel.replace(/^#/, '').toLowerCase();
    if (!queues.has(key)) {
      queues.set(key, new Queue({ maxSize: config.queueMaxSize, rolesMode: config.rolesMode }));
    }
    return queues.get(key);
  }

  const channels = initialChannels.length > 0 ? initialChannels : [config.channel].filter(Boolean);

  const client = new tmi.Client({
    options: { debug: config.debug },
    connection: {
      reconnect: true,
      maxReconnectAttempts: Infinity,
      reconnectDecay: 1.5,
      reconnectInterval: 1000,
    },
    identity: {
      username: config.botUsername,
      password: config.botToken,
    },
    channels,
  });

  client.on('message', (channel, tags, message, self) => {
    if (self) return;
    if (!message.startsWith(config.prefix)) return;

    try {
      const parts = message.slice(config.prefix.length).trim().split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1);
      const queue = getQueue(channel);

      queueCommands.handle(client, channel, tags, queue, cmd, args, config);
      dbdCommands.handle(client, channel, tags, cmd, args);
    } catch (err) {
      console.error(`[bot] Error handling command in ${channel}:`, err.message);
    }
  });

  client.on('connected', (addr, port) => {
    console.log(`[tmi] Connected to ${addr}:${port}`);
  });

  client.on('disconnected', reason => {
    console.warn(`[tmi] Disconnected: ${reason}. Will attempt to reconnect...`);
  });

  client.on('reconnect', () => {
    console.log('[tmi] Reconnecting...');
  });

  function joinChannel(channelName) {
    const normalized = channelName.replace(/^#/, '').toLowerCase();
    console.log(`[bot] Joining #${normalized}`);
    return client.join(normalized);
  }

  function isConnected() {
    try {
      return client.readyState() === 'OPEN';
    } catch {
      return false;
    }
  }

  function getChannelStats() {
    return Array.from(queues.entries()).map(([channel, queue]) => ({
      channel,
      size: queue.size,
      isOpen: queue.isOpen,
    }));
  }

  return { client, joinChannel, isConnected, getChannelStats };
}

module.exports = { createBot };
