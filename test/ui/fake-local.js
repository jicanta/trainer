'use strict';
// A stand-in for a local model server (llama-server, LM Studio, Ollama): the OpenAI chat API,
// streamed, with the answer wrapped in the <think> block that reasoning models produce.
const http = require('node:http');

const MODEL = 'Qwen3.8-27B-GGUF';
const ANSWER = 'From the local model: train on problems 100 to 200 above your level and reflect after each one.';

async function start() {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', async () => {
      if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL }] })); }
      if (req.url !== '/v1/chat/completions') { res.statusCode = 404; return res.end('{}'); }
      res.setHeader('Content-Type', 'text/event-stream');
      const send = (delta) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`);
      send({ content: '<think>What does the data say?</think>\n\n' });
      const size = Math.ceil(ANSWER.length / 4);
      for (let i = 0; i < ANSWER.length; i += size) { send({ content: ANSWER.slice(i, i + size) }); await new Promise((r) => setTimeout(r, 40)); }
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, model: MODEL, answer: ANSWER, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

module.exports = { start };
