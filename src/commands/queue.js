'use strict';

function isMod(tags, channel) {
  return (
    tags.mod === true ||
    tags.badges?.broadcaster === '1' ||
    tags.username?.toLowerCase() === channel.replace(/^#/, '').toLowerCase()
  );
}

function formatEntries(entries) {
  return entries
    .map((e, i) => {
      const role = e.role ? ` (${e.role[0].toUpperCase()})` : '';
      return `#${i + 1} ${e.username}${role}`;
    })
    .join(' · ');
}

function handle(client, channel, tags, queue, cmd, args, config) {
  const username = tags['display-name'] || tags.username;
  const mod = isMod(tags, channel);
  const p = config.prefix;

  switch (cmd) {
    case 'join': {
      const result = queue.join(username, args[0]);
      client.say(channel, result.message);
      break;
    }

    case 'leave': {
      const result = queue.leave(username);
      client.say(channel, result.message);
      break;
    }

    case 'queue':
    case 'q': {
      if (queue.size === 0) {
        const hint =
          config.rolesMode === 'both'
            ? `Use ${p}join survivor or ${p}join killer to sign up.`
            : `Use ${p}join to sign up.`;
        client.say(channel, `The queue is empty! ${hint}`);
        break;
      }
      const status = queue.isOpen ? '🟢 Open' : '🔴 Closed';
      const preview = queue.list(5);
      const more = queue.size > 5 ? ` · +${queue.size - 5} more` : '';
      client.say(
        channel,
        `Queue [${status}] ${queue.size} total: ${formatEntries(preview)}${more}`
      );
      break;
    }

    case 'position':
    case 'pos': {
      const pos = queue.position(username);
      if (pos === 0) {
        const hint =
          config.rolesMode === 'both'
            ? `${p}join survivor / ${p}join killer`
            : `${p}join`;
        client.say(channel, `@${username}, you're not in the queue. Use ${hint} to sign up!`);
      } else {
        client.say(
          channel,
          `@${username}, you're #${pos} in the queue (${queue.size} total).`
        );
      }
      break;
    }

    case 'next': {
      if (!mod) break;
      const resultNext = queue.next();
      client.say(channel, resultNext.message);
      break;
    }

    case 'pick': {
      if (!mod) break;
      const resultPick = queue.pick();
      client.say(channel, resultPick.message);
      break;
    }

    case 'remove': {
      if (!mod) break;
      const target = args[0]?.replace(/^@/, '');
      if (!target) {
        client.say(channel, `@${username}, usage: ${p}remove <username>`);
        break;
      }
      const resultRemove = queue.remove(target);
      client.say(channel, resultRemove.message);
      break;
    }

    case 'clear': {
      if (!mod) break;
      const resultClear = queue.clear();
      client.say(channel, resultClear.message);
      break;
    }

    case 'open': {
      if (!mod) break;
      const resultOpen = queue.open();
      client.say(channel, resultOpen.message);
      break;
    }

    case 'close': {
      if (!mod) break;
      const resultClose = queue.close();
      client.say(channel, resultClose.message);
      break;
    }

    case 'help': {
      const joinHint =
        config.rolesMode === 'both' ? `${p}join survivor/killer` : `${p}join`;
      client.say(
        channel,
        `DbD Queue — Everyone: ${joinHint} | ${p}leave | ${p}queue | ${p}position | ${p}killer | ${p}survivor | ${p}perk | ${p}map | ${p}entity` +
          ` — Mods: ${p}open | ${p}close | ${p}pick | ${p}next | ${p}remove <user> | ${p}clear`
      );
      break;
    }

    default:
      break;
  }
}

module.exports = { handle };
