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
// Subscribe to stream.offline for a single channel
// ---------------------------------------------------------------------------

async function subscribeStreamOffline({ broadcasterId, callbackUrl, webhookSecret, clientId, token }) {
  const res = await fetch(`${HELIX}/eventsub/subscriptions`, {
    method: 'POST',
    headers: {
      'Client-Id': clientId,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'stream.offline',
      version: '1',
      condition: { broadcaster_user_id: broadcasterId },
      transport: { method: 'webhook', callback: callbackUrl, secret: webhookSecret },
    }),
  });
  if (res.status === 409) {
    return { alreadyExists: true };
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`EventSub subscribe failed: ${res.status} — ${JSON.stringify(body)}`);
  }
  return res.json();
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
      const result = await subscribeStreamOffline({ broadcasterId, callbackUrl, webhookSecret, clientId, token });
      if (result.alreadyExists) {
        console.log(`[eventsub] Subscription already active for #${channel}`);
      } else {
        console.log(`[eventsub] Subscribed to stream.offline for #${channel}`);
      }
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
    const result = await subscribeStreamOffline({ broadcasterId, callbackUrl, webhookSecret, clientId, token });
    if (!result.alreadyExists) {
      console.log(`[eventsub] Subscribed to stream.offline for #${channel}`);
    }
  } catch (err) {
    console.error(`[eventsub] Failed to subscribe for #${channel}:`, err.message);
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

module.exports = { getAppToken, syncSubscriptions, subscribeChannel, verifySignature };
