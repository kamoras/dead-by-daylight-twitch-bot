'use strict';

const crypto = require('crypto');

const HELIX = 'https://api.twitch.tv/helix';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';

// ---------------------------------------------------------------------------
// App access token (client credentials, cached until near expiry)
// ---------------------------------------------------------------------------

let _cachedToken = null;
let _tokenExpiresAt = 0;

async function getAppToken(clientId, clientSecret) {
  if (_cachedToken && Date.now() < _tokenExpiresAt - 60_000) {
    return _cachedToken;
  }
  const res = await fetch(
    `${TOKEN_URL}?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`,
    { method: 'POST' }
  );
  if (!res.ok) throw new Error(`Twitch token request failed: ${res.status}`);
  const data = await res.json();
  _cachedToken = data.access_token;
  _tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return _cachedToken;
}

// ---------------------------------------------------------------------------
// User ID lookup
// ---------------------------------------------------------------------------

async function getUserId(login, clientId, token) {
  const res = await fetch(`${HELIX}/users?login=${encodeURIComponent(login)}`, {
    headers: { 'Client-Id': clientId, 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json();
  return data.data?.[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Subscribe to stream.online / stream.offline for a single channel
// ---------------------------------------------------------------------------

async function subscribeStreamEvent(type, { broadcasterId, callbackUrl, webhookSecret, clientId, token }) {
  const res = await fetch(`${HELIX}/eventsub/subscriptions`, {
    method: 'POST',
    headers: {
      'Client-Id': clientId,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type,
      version: '1',
      condition: { broadcaster_user_id: broadcasterId },
      transport: { method: 'webhook', callback: callbackUrl, secret: webhookSecret },
    }),
  });
  if (res.status === 409) return { alreadyExists: true };
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`EventSub subscribe failed: ${res.status} — ${JSON.stringify(body)}`);
  }
  return res.json();
}

function subscribeStreamOffline(opts) {
  return subscribeStreamEvent('stream.offline', opts);
}

function subscribeStreamOnline(opts) {
  return subscribeStreamEvent('stream.online', opts);
}

// ---------------------------------------------------------------------------
// Sync subscriptions for a list of channel names
// ---------------------------------------------------------------------------

async function syncSubscriptions({ channels, callbackUrl, webhookSecret, clientId, clientSecret }) {
  if (!channels.length) return;
  const token = await getAppToken(clientId, clientSecret);

  for (const channel of channels) {
    try {
      const broadcasterId = await getUserId(channel, clientId, token);
      if (!broadcasterId) {
        console.warn(`[eventsub] No Twitch user found for channel: ${channel}`);
        continue;
      }
      const opts = { broadcasterId, callbackUrl, webhookSecret, clientId, token };
      const [offline, online] = await Promise.all([subscribeStreamOffline(opts), subscribeStreamOnline(opts)]);
      const tag = (r) => r.alreadyExists ? 'already active' : 'subscribed';
      console.log(`[eventsub] #${channel}: stream.offline ${tag(offline)}, stream.online ${tag(online)}`);
    } catch (err) {
      console.error(`[eventsub] Failed to subscribe for #${channel}:`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Subscribe a single newly-onboarded channel
// ---------------------------------------------------------------------------

async function subscribeChannel({ channel, callbackUrl, webhookSecret, clientId, clientSecret }) {
  try {
    const token = await getAppToken(clientId, clientSecret);
    const broadcasterId = await getUserId(channel, clientId, token);
    if (!broadcasterId) {
      console.warn(`[eventsub] No Twitch user found for channel: ${channel}`);
      return;
    }
    const opts = { broadcasterId, callbackUrl, webhookSecret, clientId, token };
    await Promise.all([subscribeStreamOffline(opts), subscribeStreamOnline(opts)]);
    console.log(`[eventsub] Subscribed to stream.online and stream.offline for #${channel}`);
  } catch (err) {
    console.error(`[eventsub] Failed to subscribe for #${channel}:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// Check which channels from a list are currently live
// ---------------------------------------------------------------------------
// Returns one entry per live channel: { login, gameId, gameName }.

async function getLiveChannels({ channels, clientId, clientSecret }) {
  if (!channels.length) return [];
  const token = await getAppToken(clientId, clientSecret);
  const live = [];
  // Helix /streams accepts at most 100 user_login filters per request.
  for (let i = 0; i < channels.length; i += 100) {
    const batch = channels.slice(i, i + 100);
    const params = batch.map(ch => `user_login=${encodeURIComponent(ch)}`).join('&');
    const res = await fetch(`${HELIX}/streams?${params}`, {
      headers: { 'Client-Id': clientId, 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Helix streams request failed: ${res.status}`);
    const data = await res.json();
    for (const s of data.data ?? []) {
      live.push({ login: s.user_login.toLowerCase(), gameId: s.game_id || '', gameName: s.game_name || '' });
    }
  }
  return live;
}

// ---------------------------------------------------------------------------
// Remove all EventSub subscriptions for a channel (on disconnect)
// ---------------------------------------------------------------------------

async function unsubscribeChannel({ channel, clientId, clientSecret }) {
  try {
    const token = await getAppToken(clientId, clientSecret);
    const broadcasterId = await getUserId(channel, clientId, token);
    if (!broadcasterId) return;

    const listRes = await fetch(`${HELIX}/eventsub/subscriptions?user_id=${broadcasterId}`, {
      headers: { 'Client-Id': clientId, 'Authorization': `Bearer ${token}` },
    });
    if (!listRes.ok) throw new Error(`EventSub list failed: ${listRes.status}`);
    const subs = (await listRes.json()).data ?? [];

    await Promise.all(subs.map(async sub => {
      const delRes = await fetch(`${HELIX}/eventsub/subscriptions?id=${encodeURIComponent(sub.id)}`, {
        method: 'DELETE',
        headers: { 'Client-Id': clientId, 'Authorization': `Bearer ${token}` },
      });
      if (!delRes.ok && delRes.status !== 404) {
        console.error(`[eventsub] Failed to delete subscription ${sub.id} for #${channel}: ${delRes.status}`);
      }
    }));
    if (subs.length) console.log(`[eventsub] Removed ${subs.length} subscription(s) for #${channel}`);
  } catch (err) {
    console.error(`[eventsub] Failed to unsubscribe for #${channel}:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

function verifySignature(secret, messageId, timestamp, rawBody, signature) {
  try {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(messageId + timestamp + rawBody);
    const expected = 'sha256=' + hmac.digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

module.exports = { getAppToken, syncSubscriptions, subscribeChannel, unsubscribeChannel, getLiveChannels, verifySignature };
