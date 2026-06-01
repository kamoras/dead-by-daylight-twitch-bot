'use strict';

// Must be set before requiring db so the module opens an in-memory database.
process.env.DB_PATH = ':memory:';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('../src/db');
const { createWebServer, _resetRateLimiterForTesting } = require('../src/web');

const mockJoin = async () => {};
const mockLeave = async () => {};
const app = createWebServer(mockJoin, mockLeave, 'testbot');

// A second instance with admin enabled, capturing the channels it's asked to leave.
const leftChannels = [];
process.env.ADMIN_PASSWORD = 'secret';
process.env.ADMIN_PATH = 'admin';
const adminApp = createWebServer(mockJoin, async (ch) => { leftChannels.push(ch); }, 'testbot');

beforeEach(() => {
  _resetRateLimiterForTesting();
  leftChannels.length = 0;
});

async function adminLogin() {
  const res = await request(adminApp)
    .post('/admin/admin/login')
    .type('form')
    .send({ password: 'secret' });
  return res.headers['set-cookie'];
}

describe('GET /', () => {
  it('returns 200 with the landing page', async () => {
    const res = await request(app).get('/');
    assert.equal(res.status, 200);
    assert.match(res.text, /Enter the Fog/);
    assert.match(res.text, /testbot/);
  });
});

describe('GET /health', () => {
  it('returns ok JSON', async () => {
    const res = await request(app).get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.ok(typeof res.body.uptimeMs === 'number');
  });
});

describe('POST /onboard', () => {
  it('rejects missing fields', async () => {
    const res = await request(app).post('/onboard').type('form').send({});
    assert.equal(res.status, 400);
    assert.match(res.text, /required/i);
  });

  it('rejects an invalid channel name', async () => {
    db.createInviteCode('WEB-0001');
    const res = await request(app)
      .post('/onboard')
      .type('form')
      .send({ invite_code: 'WEB-0001', channel_name: 'invalid channel!' });
    assert.equal(res.status, 400);
    assert.match(res.text, /Invalid channel name/);
  });

  it('rejects an unknown invite code', async () => {
    const res = await request(app)
      .post('/onboard')
      .type('form')
      .send({ invite_code: 'ZZZZ-ZZZZ', channel_name: 'goodchannel' });
    assert.equal(res.status, 400);
    assert.match(res.text, /Invalid or already-used/);
  });

  it('rejects an already-used invite code', async () => {
    db.createInviteCode('WEB-0002');
    db.validateAndUseCode('WEB-0002', 'someone');
    const res = await request(app)
      .post('/onboard')
      .type('form')
      .send({ invite_code: 'WEB-0002', channel_name: 'goodchannel' });
    assert.equal(res.status, 400);
    assert.match(res.text, /Invalid or already-used/);
  });

  it('accepts a valid invite code and channel name', async () => {
    db.createInviteCode('WEB-0003');
    const res = await request(app)
      .post('/onboard')
      .type('form')
      .send({ invite_code: 'WEB-0003', channel_name: 'newstreamer' });
    assert.equal(res.status, 200);
    assert.match(res.text, /You're in the Fog/);
    assert.equal(db.channelExists('newstreamer'), true);
  });

  it('burns the invite code so it cannot be reused', async () => {
    db.createInviteCode('WEB-0004');
    await request(app)
      .post('/onboard')
      .type('form')
      .send({ invite_code: 'WEB-0004', channel_name: 'streamer1' });
    const res = await request(app)
      .post('/onboard')
      .type('form')
      .send({ invite_code: 'WEB-0004', channel_name: 'streamer2' });
    assert.equal(res.status, 400);
  });

  it('rejects a channel that is already connected', async () => {
    db.createInviteCode('WEB-0005');
    db.createInviteCode('WEB-0006');
    await request(app)
      .post('/onboard')
      .type('form')
      .send({ invite_code: 'WEB-0005', channel_name: 'existingchan' });
    const res = await request(app)
      .post('/onboard')
      .type('form')
      .send({ invite_code: 'WEB-0006', channel_name: 'existingchan' });
    assert.equal(res.status, 400);
    assert.match(res.text, /already connected/);
  });

  it('is case-insensitive for channel names', async () => {
    db.createInviteCode('WEB-0007');
    const res = await request(app)
      .post('/onboard')
      .type('form')
      .send({ invite_code: 'WEB-0007', channel_name: 'MyCHANNEL' });
    assert.equal(res.status, 200);
    assert.equal(db.channelExists('mychannel'), true);
  });
});

describe('POST /admin/:path/disconnect', () => {
  it('rejects unauthenticated requests', async () => {
    db.addChannel('victim', 'victim');
    const res = await request(adminApp)
      .post('/admin/admin/disconnect')
      .type('form')
      .send({ channel: 'victim' });
    // No session → redirected back to the login page, channel untouched.
    assert.equal(res.status, 302);
    assert.equal(db.channelExists('victim'), true);
    assert.deepEqual(leftChannels, []);
  });

  it('removes the channel and leaves its chat when authenticated', async () => {
    db.addChannel('leaver', 'leaver');
    const cookie = await adminLogin();
    const res = await request(adminApp)
      .post('/admin/admin/disconnect')
      .set('Cookie', cookie)
      .type('form')
      .send({ channel: 'leaver' });
    assert.equal(res.status, 302);
    assert.equal(db.channelExists('leaver'), false);
    assert.deepEqual(leftChannels, ['leaver']);
  });

  it('ignores an invalid channel name without leaving anything', async () => {
    const cookie = await adminLogin();
    const res = await request(adminApp)
      .post('/admin/admin/disconnect')
      .set('Cookie', cookie)
      .type('form')
      .send({ channel: 'bad name!' });
    assert.equal(res.status, 302);
    assert.deepEqual(leftChannels, []);
  });
});
