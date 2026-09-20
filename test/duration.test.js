import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_BAN, MAX_TIMEOUT, parseDuration } from '../src/duration.js';

test('parses supported units and whitespace', () => {
  assert.equal(parseDuration(' 2h ', MAX_TIMEOUT), 7_200_000);
  assert.equal(parseDuration('1W', MAX_BAN), 604_800_000);
});

test('rejects invalid, zero, and excessive durations', () => {
  for (const input of ['', '0m', '1s', '2 hours', '-1d', '9999w']) assert.equal(parseDuration(input, MAX_BAN), null);
  assert.equal(parseDuration('29d', MAX_TIMEOUT), null);
  assert.equal(parseDuration('366d', MAX_BAN), null);
});
