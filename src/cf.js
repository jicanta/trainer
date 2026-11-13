'use strict';
// Codeforces public API client: serialized calls (API allows ~1 request / 2 s), retries, friendly errors.
const BASE = 'https://codeforces.com/api/';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CFError extends Error {
  constructor(message, { code } = {}) { super(message); this.name = 'CFError'; this.code = code || 'cf_error'; }
}

class CF {
  constructor({ fetchImpl, minGapMs = 2100, base } = {}) {
    this.base = base || BASE;
    this.fetch = fetchImpl || globalThis.fetch;
    this.minGapMs = minGapMs ?? 2100;
    this.chain = Promise.resolve();
    this.lastAt = 0;
  }

  // Runs fn after the previous call finished and the rate-limit gap elapsed.
  schedule(fn) {
    const run = this.chain.then(async () => {
      const wait = this.lastAt + this.minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      try { return await fn(); } finally { this.lastAt = Date.now(); }
    });
    this.chain = run.catch(() => {});
    return run;
  }

  async call(method, params = {}, { retries = 3, timeoutMs = 60000 } = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    const url = `${this.base}${method}${qs.size ? `?${qs}` : ''}`;
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.schedule(async () => {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), timeoutMs);
          try {
            const res = await this.fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctl.signal });
            const text = await res.text();
            let body;
            try { body = JSON.parse(text); } catch {
              throw new CFError(`Codeforces returned a non-JSON response (HTTP ${res.status}). The API may be down or blocking requests.`, { code: 'bad_response' });
            }
            if (body.status === 'OK') return body.result;
            const comment = body.comment || `HTTP ${res.status}`;
            if (/limit exceeded/i.test(comment)) throw new CFError(comment, { code: 'rate_limit' });
            if (/not found/i.test(comment)) throw new CFError(comment.replace(/^handles?: /, ''), { code: 'not_found' });
            throw new CFError(comment, { code: 'failed' });
          } finally { clearTimeout(timer); }
        });
      } catch (e) {
        lastErr = e.name === 'AbortError' ? new CFError('Codeforces API timed out.', { code: 'timeout' }) : e;
        if (lastErr.code === 'not_found' || lastErr.code === 'failed') break; // retrying will not help
        if (attempt < retries) await sleep(1500 * (attempt + 1));
      }
    }
    if (lastErr instanceof CFError) throw lastErr;
    throw new CFError(`Could not reach Codeforces: ${lastErr && lastErr.message ? lastErr.message : lastErr}`, { code: 'network' });
  }

  problemset() { return this.call('problemset.problems'); }
  contestList() { return this.call('contest.list', { gym: false }); }
  async userInfo(handle) { return (await this.call('user.info', { handles: handle }))[0]; }
  userRating(handle) { return this.call('user.rating', { handle }); }
  userStatus(handle, from, count) { return this.call('user.status', { handle, from, count }, { timeoutMs: 120000 }); }
}

module.exports = { CF, CFError };
