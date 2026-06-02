'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createBot } = require('../src/bot');

// Builds a bot with the tmi client's network methods stubbed and the channel
// reported as joined, so getQueueSnapshot's presence/category logic is testable.
function makeBot(overrides = {}) {
  const bot = createBot({
    botUsername: 'queuebot',
    botToken: 'oauth:test',
    prefix: '!dbd ',
    rolesMode: 'off',
    queueMaxSize: 20,
    debug: false,
    ...overrides,
  });
  bot.client.getChannels = () => ['#foggywoods'];
  bot.client.say = async () => {};
  bot.client.join = async () => {};
  bot.client.part = async () => {};
  return bot;
}

describe('overlay category gating (getQueueSnapshot)', () => {
  it('shows (onTargetGame true) when the category is unknown', () => {
    const snap = makeBot().getQueueSnapshot('foggywoods');
    assert.equal(snap.present, true);
    assert.equal(snap.game, null);
    assert.equal(snap.onTargetGame, true);
  });

  it('shows when the channel is playing the target game', () => {
    const bot = makeBot();
    bot.setLiveCategories([{ login: 'foggywoods', gameName: 'Dead by Daylight' }]);
    const snap = bot.getQueueSnapshot('foggywoods');
    assert.equal(snap.game, 'Dead by Daylight');
    assert.equal(snap.onTargetGame, true);
  });

  it('hides (onTargetGame false) when playing another game', () => {
    const bot = makeBot();
    bot.setLiveCategories([{ login: 'foggywoods', gameName: 'Just Chatting' }]);
    const snap = bot.getQueueSnapshot('foggywoods');
    assert.equal(snap.game, 'Just Chatting');
    assert.equal(snap.onTargetGame, false);
  });

  it('matches case-insensitively and honours a custom target game', () => {
    const bot = makeBot({ targetGame: 'Phasmophobia' });
    bot.setLiveCategories([{ login: 'foggywoods', gameName: 'phasmophobia' }]);
    assert.equal(bot.getQueueSnapshot('foggywoods').onTargetGame, true);
  });

  it('reverts to shown once the channel goes offline (categories cleared)', () => {
    const bot = makeBot();
    bot.setLiveCategories([{ login: 'foggywoods', gameName: 'Just Chatting' }]);
    assert.equal(bot.getQueueSnapshot('foggywoods').onTargetGame, false);
    bot.setLiveCategories([]); // next poll: nobody live
    assert.equal(bot.getQueueSnapshot('foggywoods').onTargetGame, true);
  });
});
