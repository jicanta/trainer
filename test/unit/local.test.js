'use strict';
// The local-model coach, against a stand-in OpenAI-compatible server on a random port.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { makeDb, allSettings } = require('./helpers');
const { runLocal, listModels, visibleText, baseUrl } = require('../../src/local-llm');
const { Sessions } = require('../../src/sessions');
const { Contests } = require('../../src/contests');
const { Coach } = require('../../src/coach');

// `reply(body)` returns the list of SSE deltas to stream, or { status, error }.
function server(reply, { models = ['Qwen3.8-27B-GGUF'] } = {}) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', async () => {
      if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ object: 'list', data: models.map((id) => ({ id })) })); }
      if (req.url !== '/v1/chat/completions') { res.statusCode = 404; return res.end('not found'); }
      const parsed = JSON.parse(body);
      seen.push({ ...parsed, auth: req.headers.authorization || null });
      const out = reply(parsed);
      if (out.status) { res.statusCode = out.status; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ error: { message: out.error } })); }
      res.setHeader('Content-Type', 'text/event-stream');
      for (const delta of out) {
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`);
        await new Promise((r) => setTimeout(r, delta.wait || 2));
      }
      res.end('data: [DONE]\n\n');
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({
    seen, url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => { srv.closeAllConnections(); srv.close(r); }),
  })));
}

test('addresses are normalized', () => {
  assert.strictEqual(baseUrl('localhost:11434'), 'http://localhost:11434/v1');
  assert.strictEqual(baseUrl('http://localhost:1234/v1/'), 'http://localhost:1234/v1');
  assert.strictEqual(baseUrl('http://box:8080/api/v1'), 'http://box:8080/api/v1');
  assert.strictEqual(baseUrl(''), 'http://localhost:8080/v1');
});

test('inline thinking is never part of the visible answer', () => {
  assert.strictEqual(visibleText('<think>the gcd, surely</think>\n\nTry k = 2.'), 'Try k = 2.');
  assert.strictEqual(visibleText('<think>still going'), '');
  assert.strictEqual(visibleText('Answer <th'), 'Answer ');
  assert.strictEqual(visibleText('a < b', true), 'a < b');
  assert.strictEqual(visibleText('reasoning without an opening tag</think>Done.'), 'Done.');
});

test('a streamed answer: thinking hidden, model picked from the server, statuses reported', async () => {
  const s = await server(() => [{ reasoning_content: 'hmm' }, { content: '<thi' }, { content: 'nk>secret</think>Look at ' }, { content: 'the differences.' }]);
  try {
    assert.deepStrictEqual(await listModels({ url: s.url }), ['Qwen3.8-27B-GGUF']);
    const deltas = [];
    const statuses = [];
    const r = await runLocal({ url: s.url, system: 'SYS', prompt: 'PROMPT', apiKey: 'k1', onDelta: (t) => deltas.push(t), onStatus: (x) => statuses.push(x) }).promise;
    assert.strictEqual(r.text, 'Look at the differences.');
    assert.strictEqual(deltas.join(''), 'Look at the differences.');
    assert.deepStrictEqual(statuses, ['thinking', 'writing']);
    assert.strictEqual(s.seen[0].model, 'Qwen3.8-27B-GGUF');
    assert.strictEqual(s.seen[0].auth, 'Bearer k1');
    assert.deepStrictEqual(s.seen[0].messages, [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'PROMPT' }]);
  } finally { await s.close(); }
});

test('errors are explained: server down, context overflow, empty answer, cancel', async () => {
  await assert.rejects(runLocal({ url: 'http://127.0.0.1:1', model: 'm', system: '', prompt: '' }).promise, /Could not reach the local model server at http:\/\/127\.0\.0\.1:1\/v1/);
  await assert.rejects(listModels({ url: 'http://127.0.0.1:1' }), /Could not reach/);
  const full = await server(() => ({ status: 400, error: 'the request exceeds the available context size' }));
  await assert.rejects(runLocal({ url: full.url, model: 'm', system: '', prompt: '' }).promise, /context window/);
  await full.close();
  const empty = await server(() => [{ content: '<think>never finishes' }]);
  await assert.rejects(runLocal({ url: empty.url, model: 'm', system: '', prompt: '' }).promise, /returned no answer/);
  await empty.close();
  const slow = await server(() => [{ content: 'one', wait: 5000 }, { content: 'two' }]);
  const run = runLocal({ url: slow.url, model: 'm', system: '', prompt: '', onDelta: () => run.cancel() });
  await assert.rejects(run.promise, (e) => e.cancelled === true);
  await slow.close();
});

test('the coach answers through the local server when that backend is chosen', async () => {
  const s = await server((body) => (/TRAINING REVIEW/.test(body.messages[1].content)
    ? [{ content: '<think>plan</think>Solve more at 1600.\n\n```json\n{"focus_tags": ["dp"], "difficulty": "standard", "habit": "Write the complexity first"}\n```' }]
    : [{ content: 'Train slightly above your level.' }]));
  try {
    const db = makeDb();
    const getSettings = () => allSettings(db);
    const events = [];
    const done = () => new Promise((resolve, reject) => {
      const tick = () => {
        const e = events.find((x) => x.type === 'coach:done' || x.type === 'coach:error');
        if (!e) return setTimeout(tick, 5);
        events.length = 0;
        if (e.type === 'coach:error') reject(new Error(e.payload.error)); else resolve(e.payload);
      };
      tick();
    });
    const coach = new Coach({
      db, getSettings, emit: (type, payload) => events.push({ type, payload }),
      sessions: new Sessions({ db, getSettings, emit: () => {} }), contests: new Contests({ db, getSettings, emit: () => {} }),
      runner: () => { throw new Error('Claude must not be called'); },
    });
    db.setSetting('coachBackend', 'local');
    db.setSetting('localUrl', s.url);
    assert.deepStrictEqual(coach.status(), { backend: 'local', found: true, path: null, url: `${s.url}/v1`, model: 'the model the server has loaded', rateLimit: null });
    assert.deepStrictEqual(await coach.testLocal(), { url: `${s.url}/v1`, models: ['Qwen3.8-27B-GGUF'] });
    coach.sendGeneral({ text: 'What should I train?' });
    assert.strictEqual((await done()).message.content, 'Train slightly above your level.');
    assert.match(s.seen[0].messages[1].content, /<training_data>/);
    coach.review();
    const { review } = await done();
    assert.strictEqual(review.content, 'Solve more at 1600.');
    assert.deepStrictEqual(review.focus.focusTags, ['dp']);
  } finally { await s.close(); }
});
