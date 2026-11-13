'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { expected, attemptScore, replay, performance, roundLevel } = require('../../src/model');

test('expected follows the Codeforces rating model', () => {
  assert.strictEqual(expected(1500, 1500), 0.5);
  assert.ok(Math.abs(expected(1500, 1900) - 1 / 11) < 1e-9);
  assert.ok(expected(1500, 1100) > 0.9);
});

test('attempt scores reflect the help used', () => {
  const base = { status: 'solved', mode: 'practice', rating: 1600, hint_level: 0 };
  assert.strictEqual(attemptScore(base), 1);
  assert.strictEqual(attemptScore({ ...base, hint_level: 2 }), 0.5);
  assert.strictEqual(attemptScore({ ...base, hint_level: 4 }), 0);
  assert.strictEqual(attemptScore({ ...base, status: 'parked' }), 0);
  assert.strictEqual(attemptScore({ ...base, status: 'abandoned' }), null);
  assert.strictEqual(attemptScore({ ...base, mode: 'upsolve' }), null);
  assert.strictEqual(attemptScore({ ...base, mode: 'contest', hint_level: 0 }), 1);
  assert.strictEqual(attemptScore({ ...base, mode: 'contest', status: 'failed' }), 0);
  assert.strictEqual(attemptScore({ ...base, mode: 'idea', idea_verdict: 'correct' }), 1);
  assert.strictEqual(attemptScore({ ...base, mode: 'idea', status: 'failed', idea_verdict: 'partial' }), 0.4);
  assert.strictEqual(attemptScore({ ...base, rating: null }), null);
});

test('replay moves the level up on hard solves and down on easy fails', () => {
  const up = replay([{ id: 1, rating: 1800, tags: ['dp'], mode: 'practice', score: 1, ended_at: 1 }], 1500);
  assert.ok(up.level > 1500);
  assert.ok(up.tags.dp.level > 1500);
  const down = replay([{ id: 1, rating: 1200, tags: ['dp'], mode: 'practice', score: 0, ended_at: 1 }], 1500);
  assert.ok(down.level < 1500);
  const many = [];
  for (let i = 0; i < 60; i++) many.push({ id: i, rating: 1700, tags: ['greedy'], mode: 'practice', score: i % 2, ended_at: i });
  const r = replay(many, 1500);
  assert.ok(Math.abs(r.level - 1700) < 60, `converges near 1700 at a 50% solve rate, got ${r.level}`);
  assert.strictEqual(r.history.length, 60);
});

test('performance is the level where expected solves equal actual solves', () => {
  const ladder = [1100, 1300, 1500, 1700, 1900];
  const p = performance(ladder.map((rating, i) => ({ rating, solved: i < 3 })));
  assert.ok(p > 1500 && p < 1700, `got ${p}`);
  assert.strictEqual(performance(ladder.map((rating) => ({ rating, solved: false }))), 850);
  assert.strictEqual(performance(ladder.map((rating) => ({ rating, solved: true }))), 2150);
  assert.strictEqual(performance([]), null);
});

test('roundLevel snaps to the Codeforces rating grid', () => {
  assert.strictEqual(roundLevel(1549), 1500);
  assert.strictEqual(roundLevel(1550), 1600);
  assert.strictEqual(roundLevel(300), 800);
});
