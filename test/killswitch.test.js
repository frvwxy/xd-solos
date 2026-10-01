import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageFlags } from 'discord.js';
import {
  KILL_SWITCH_CHANNEL_ID, canUseKillSwitch, killSwitchCommand, killSwitchIndicatorMessage,
} from '../src/killswitch.js';

test('/killswitch is owner-only and has activate/deactivate subcommands', () => {
  const json = killSwitchCommand.toJSON();
  assert.equal(json.name, 'killswitch');
  assert.deepEqual(json.options.map(option => option.name), ['activate', 'deactivate']);
  assert.equal(canUseKillSwitch('635280852741390348'), true);
  assert.equal(canUseKillSwitch('someone-else'), false);
});

test('kill switch uses the configured help channel and public lockdown card', () => {
  assert.equal(KILL_SWITCH_CHANNEL_ID, '1547135508054806589');
  const message = killSwitchIndicatorMessage();
  assert.ok(message.flags & MessageFlags.IsComponentsV2);
  assert.equal(message.components.length, 1);
  const card = JSON.stringify(message.components[0].toJSON());
  assert.match(card, /Kill Switch Activated/);
  assert.match(card, /<:lol:1555070479302397984>/);
  assert.match(card, /until kole ends the lockdown/);
  assert.deepEqual(message.allowedMentions, { parse: [] });
});
