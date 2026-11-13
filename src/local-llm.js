'use strict';
// The coach on a local model: any server that speaks the OpenAI chat API (llama.cpp's llama-server,
// LM Studio, Ollama, ...). This is how a GGUF such as unsloth's Qwen3 builds is used.
// Same contract as runClaude in coach.js: returns { promise, cancel } and streams through callbacks.

const DEFAULT_URL = 'http://localhost:8080/v1';

// "localhost:8080" -> "http://localhost:8080/v1". A path that is already there is kept as it is.
function baseUrl(url) {
  let u = String(url || '').trim() || DEFAULT_URL;
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  u = u.replace(/\/+$/, '');
  try { if (new URL(u).pathname === '/') u += '/v1'; } catch { /* reported when the request is made */ }
  return u;
}

const headers = (apiKey) => ({ 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) });

function friendlyError(msg, url) {
  const m = String(msg || '').trim();
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ECONNRESET|fetch failed|Invalid URL|socket hang up/i.test(m)) {
    return `Could not reach the local model server at ${url}. Start it (llama-server, LM Studio or Ollama) or fix the address in Settings.`;
  }
  if (/context|too long|too many tokens|exceed/i.test(m)) {
    return `The prompt did not fit in the local model's context window. Start the server with a larger context (16k tokens or more, for example "llama-server -c 16384"). ${m.slice(0, 200)}`;
  }
  return m.slice(0, 400) || 'The local model stopped without an answer.';
}

async function errorOf(res) {
  const body = await res.text().catch(() => '');
  try {
    const j = JSON.parse(body);
    const e = j.error ?? j.message ?? j;
    return typeof e === 'string' ? e : (e.message || JSON.stringify(e));
  } catch { return body.trim() || `HTTP ${res.status}`; }
}

async function listModels({ url, apiKey, signal } = {}) {
  const base = baseUrl(url);
  let res;
  try { res = await fetch(`${base}/models`, { headers: headers(apiKey), signal: signal || AbortSignal.timeout(8000) }); }
  catch (e) {
    if (signal && signal.aborted) throw e;
    throw new Error(friendlyError(`fetch failed ${(e.cause && e.cause.code) || e.message}`, base));
  }
  if (!res.ok) throw new Error(friendlyError(`The local model server answered ${res.status}: ${await errorOf(res)}`, base));
  const j = await res.json().catch(() => ({}));
  const rows = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : [];
  return rows.map((m) => String((m && (m.id || m.name || m.model)) || '')).filter(Boolean);
}

// Reasoning models may write their thinking inline as <think>...</think>. None of it is shown or stored.
// Returns the visible part of a (possibly unfinished) answer.
function visibleText(raw, final = false) {
  let s = String(raw || '');
  const close = s.indexOf('</think>');
  const open = s.indexOf('<think>');
  if (close >= 0 && (open < 0 || open > close)) s = s.slice(close + 8); // the template opened the block itself
  s = s.replace(/<think>[\s\S]*?<\/think>/g, '');
  const unclosed = s.indexOf('<think>');
  if (unclosed >= 0) s = s.slice(0, unclosed);
  if (!final) { // hold back what may be the start of a tag
    const lt = s.lastIndexOf('<');
    if (lt >= 0 && '<think>'.startsWith(s.slice(lt))) s = s.slice(0, lt);
  }
  return s.replace(/^\s+/, '');
}

// One streamed chat completion. Returns { promise, cancel }.
function runLocal({ url, model, apiKey, system, prompt, onDelta, onStatus, timeoutMs = 1200000 }) {
  const base = baseUrl(url);
  const ac = new AbortController();
  let cancelled = false;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, timeoutMs);
  const promise = (async () => {
    try {
      // llama-server answers with whatever it has loaded; LM Studio and Ollama need a name.
      const name = model || (await listModels({ url: base, apiKey, signal: ac.signal }).catch((e) => { if (ac.signal.aborted) throw e; return []; }))[0] || 'default';
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST', headers: headers(apiKey), signal: ac.signal,
        body: JSON.stringify({ model: name, stream: true, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
      });
      if (!res.ok) throw new Error(`The local model server answered ${res.status}: ${await errorOf(res)}`);
      let raw = '';
      let shown = '';
      let usage = null;
      let status = null;
      const say = (st) => { if (st !== status) { status = st; if (onStatus) onStatus(st); } };
      const handle = (line) => {
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') return;
        let d;
        try { d = JSON.parse(data); } catch { return; }
        if (d.error) throw new Error(typeof d.error === 'string' ? d.error : (d.error.message || JSON.stringify(d.error)));
        if (d.usage) usage = d.usage;
        const delta = (d.choices && d.choices[0] && d.choices[0].delta) || {};
        if (delta.reasoning_content || delta.reasoning) say('thinking');
        if (typeof delta.content === 'string' && delta.content) {
          raw += delta.content;
          const vis = visibleText(raw);
          if (vis.length > shown.length && vis.startsWith(shown)) {
            say('writing');
            if (onDelta) onDelta(vis.slice(shown.length));
            shown = vis;
          } else if (!vis) say('thinking');
        }
      };
      let buf = '';
      const dec = new TextDecoder();
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) handle(line); }
      }
      if (buf.trim()) handle(buf.trim());
      const text = visibleText(raw, true).trim();
      if (!text) throw new Error('The local model returned no answer (it may have run out of tokens while thinking). Try again, or give the server a larger context.');
      return { text, usage };
    } catch (e) {
      if (cancelled) { const err = new Error('Cancelled.'); err.cancelled = true; throw err; }
      if (timedOut) throw new Error('The local model took too long and was stopped.');
      throw new Error(friendlyError(`${e.message} ${(e.cause && (e.cause.code || e.cause.message)) || ''}`, base));
    } finally { clearTimeout(timer); }
  })();
  return { promise, cancel: () => { cancelled = true; ac.abort(); } };
}

module.exports = { runLocal, listModels, visibleText, baseUrl, DEFAULT_URL };
