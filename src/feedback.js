'use strict';
// Feedback from inside the app becomes a GitHub issue on the app's own repository, filed through the `gh` CLI
// the user is already signed in to. Without `gh`, the caller gets a prefilled "new issue" link to open instead.
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const KINDS = { bug: { title: 'Bug', label: 'bug' }, idea: { title: 'Suggestion', label: 'enhancement' } };
const MAX_TEXT = 5000;

function repoSlug() {
  if (process.env.CPGYM_FEEDBACK_REPO) return process.env.CPGYM_FEEDBACK_REPO;
  const repo = require('../package.json').repository;
  const url = typeof repo === 'string' ? repo : (repo && repo.url) || '';
  const m = url.match(/(?:github:|github\.com[/:])([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  return m ? m[1] : null;
}

function findGh() {
  const candidates = [];
  if (process.env.CPGYM_GH) candidates.push(process.env.CPGYM_GH);
  for (const dir of (process.env.PATH || '').split(path.delimiter)) if (dir) candidates.push(path.join(dir, 'gh'));
  candidates.push('/usr/bin/gh', '/usr/local/bin/gh', '/opt/homebrew/bin/gh', '/snap/bin/gh', path.join(os.homedir(), '.local/bin/gh'));
  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.X_OK); if (fs.statSync(c).isFile()) return c; } catch { /* keep looking */ }
  }
  return null;
}

function buildIssue({ kind, text, view, version }) {
  const k = KINDS[kind] || KINDS.idea;
  const clean = String(text || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_TEXT);
  if (!clean) throw new Error('Write something first.');
  const first = clean.split('\n')[0].trim();
  const title = `${k.title}: ${first.length > 72 ? `${first.slice(0, 71).trimEnd()}…` : first}`;
  const body = `${clean}\n\n---\nSent from CP Gym ${version || '?'}, ${String(view || 'unknown').replace(/[^\w-]/g, '')} view, ${process.platform}.`;
  return { title, body, labels: ['feedback', k.label] };
}

function newIssueUrl(repo, issue) {
  const q = new URLSearchParams({ title: issue.title, body: issue.body, labels: issue.labels.join(',') });
  return `https://github.com/${repo}/issues/new?${q}`;
}

function gh(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 30000, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      if (err) { err.stderr = String(stderr || ''); return reject(err); }
      resolve(String(stdout || ''));
    });
  });
}

// Resolves { url } when the issue was filed, or { url: null, fallback } with a prefilled link when it could not be.
async function sendFeedback(input) {
  const repo = repoSlug();
  if (!repo) throw new Error('This build has no repository to send feedback to.');
  const issue = buildIssue(input);
  const fallback = newIssueUrl(repo, issue);
  const bin = findGh();
  if (!bin) return { url: null, fallback };
  const base = ['issue', 'create', '--repo', repo, '--title', issue.title, '--body', issue.body];
  let out;
  try {
    out = await gh(bin, [...base, ...issue.labels.flatMap((l) => ['--label', l])]);
  } catch (e) {
    if (!/label/i.test(e.stderr || '')) return { url: null, fallback };
    try { out = await gh(bin, base); } catch { return { url: null, fallback }; } // the repository lacks a label
  }
  const url = (out.match(/https:\/\/github\.com\/\S+\/issues\/\d+/) || [null])[0];
  return url ? { url } : { url: null, fallback };
}

module.exports = { sendFeedback, buildIssue, newIssueUrl, repoSlug, findGh };
