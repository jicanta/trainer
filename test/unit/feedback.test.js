'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildIssue, newIssueUrl, repoSlug } = require('../../src/feedback');

test('feedback becomes an issue with a short title, the full text and labels', () => {
  const long = `The shuffle button ${'x'.repeat(120)}\nsecond line`;
  const issue = buildIssue({ kind: 'bug', text: long, view: 'practice', version: '1.0.0' });
  assert.match(issue.title, /^Bug: The shuffle button x+…$/);
  assert.ok(issue.title.length <= 78);
  assert.ok(issue.body.startsWith(long));
  assert.match(issue.body, /Sent from CP Gym 1\.0\.0, practice view/);
  assert.deepStrictEqual(issue.labels, ['feedback', 'bug']);
  assert.deepStrictEqual(buildIssue({ kind: 'idea', text: 'Add a timer sound' }).labels, ['feedback', 'enhancement']);
});

test('empty feedback is rejected and the fallback link carries the issue', () => {
  assert.throws(() => buildIssue({ kind: 'bug', text: '   ' }), /Write something/);
  const url = new URL(newIssueUrl('a/b', buildIssue({ kind: 'idea', text: 'Dark mode & more' })));
  assert.strictEqual(url.pathname, '/a/b/issues/new');
  assert.strictEqual(url.searchParams.get('title'), 'Suggestion: Dark mode & more');
  assert.strictEqual(repoSlug(), 'jicanta/trainer');
});
