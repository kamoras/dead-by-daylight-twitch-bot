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

  // Themed announcement when the bot enters a channel's chat, so the streamer
  // can see it's present. Fires for the bot's own join on every path (startup,
  // reconcile, webhook, manual). A live channel stays joined, so this does not
  // repeat mid-stream — only on an actual transition into chat.
  const help = config.prefix.trimEnd().length > 1
    ? `${config.prefix.trimEnd()} help`
    : `${config.prefix.trimEnd()}help`;
  const joinMessage = config.joinMessage
    || `The fog rolls in — the queue bot has entered the trial. Type ${help} for commands.`;

  client.on('join', (channel, _username, self) => {
    if (!self) return;
    client.say(channel, joinMessage).catch(() => {});
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

  function leaveChannel(channelName) {
    const normalized = channelName.replace(/^#/, '').toLowerCase();
    console.log(`[bot] Leaving #${normalized}`);
    queues.delete(normalized);
    return client.part(normalized);
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

  // Channels the bot is currently joined to (normalised, no leading #).
  function getJoinedChannels() {
    return client.getChannels().map(c => c.replace(/^#/, '').toLowerCase());
  }

  // Current Twitch category per channel (lowercased login -> game name), kept
  // fresh by the reconciliation poll. Used to hide the overlay when a streamer
  // is playing something other than the target game.
  const categories = new Map();
  const targetGame = (config.targetGame || 'Dead by Daylight').toLowerCase();

  function setLiveCategories(liveList) {
    categories.clear();
    for (const s of liveList) {
      categories.set(s.login.replace(/^#/, '').toLowerCase(), s.gameName || '');
    }
  }

  // Live snapshot of a channel's queue for the OBS overlay. `present` reflects
  // whether the bot is currently in the channel's chat, which disambiguates an
  // as-yet-uncreated queue (open & empty) from an offline channel. `onTargetGame`
  // is false only when we positively know the channel is playing another game.
  function getQueueSnapshot(channelName, limit = 5) {
    const key = channelName.replace(/^#/, '').toLowerCase();
    const present = getJoinedChannels().includes(key);
    const game = categories.get(key) || null;
    const onTargetGame = game == null ? true : game.toLowerCase() === targetGame;
    const queue = queues.get(key);
    if (!queue) {
      return { present, isOpen: present, size: 0, maxSize: config.queueMaxSize, entries: [], game, onTargetGame };
    }
    return {
      present,
      isOpen: queue.isOpen,
      size: queue.size,
      maxSize: queue.maxSize,
      game,
      onTargetGame,
      entries: queue.list(limit).map((e, i) => ({
        username: e.username,
        role: e.role,
        position: i + 1,
      })),
    };
  }

  function onStreamOnline(channelName) {
    const key = channelName.replace(/^#/, '').toLowerCase();
    console.log(`[bot] Stream online for #${key} — joining channel`);
    client.join(key).catch(err => console.error(`[bot] Failed to join #${key}:`, err.message));
  }

  function onStreamOffline(channelName) {
    const key = channelName.replace(/^#/, '').toLowerCase();
    const queue = queues.get(key);
    if (queue?.isOpen) {
      queue.close();
      client.say(`#${key}`, 'Stream is offline — queue has been closed and cleared.').catch(() => {});
    }
    queues.delete(key);
    client.part(key).catch(err => console.error(`[bot] Failed to leave #${key}:`, err.message));
    console.log(`[bot] Stream offline for #${key} — leaving channel`);
  }

  return { client, joinChannel, leaveChannel, onStreamOnline, isConnected, getChannelStats, getJoinedChannels, getQueueSnapshot, setLiveCategories, onStreamOffline };
}

module.exports = { createBot };
