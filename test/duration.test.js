import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_BAN, MAX_TIMEOUT, formatDuration, parseDuration } from '../src/duration.js';

test('formats durations for moderator results, DMs, and history', () => {
  assert.equal(formatDuration('5m'), '5 Minutes');
  assert.equal(formatDuration('1d'), '1 Day');
  assert.equal(formatDuration(' 2H '), '2 Hours');
  assert.equal(formatDuration('1w'), '1 Week');
  assert.equal(formatDuration('30s'), '30s');
});

test('parses supported units and whitespace', () => {
  assert.equal(parseDuration(' 2h ', MAX_TIMEOUT), 7_200_000);
  assert.equal(parseDuration('1W', MAX_BAN), 604_800_000);
});

test('rejects invalid, zero, and excessive durations', () => {
  for (const input of ['', '0m', '1s', '2 hours', '-1d', '9999w']) assert.equal(parseDuration(input, MAX_BAN), null);
  assert.equal(parseDuration('29d', MAX_TIMEOUT), null);
  assert.equal(parseDuration('366d', MAX_BAN), null);
});
