#!/usr/bin/env node
'use strict';
// A stand-in for the Claude Code CLI: reads the prompt on stdin and answers with canned text in the
// same stream-json format, so the UI checks are free, offline and repeatable.
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { prompt += d; });
process.stdin.on('end', async () => {
  const request = (prompt.match(/<request>([\s\S]*?)<\/request>\s*$/) || [null, prompt])[1].trim();
  let text;
  if (!/<request>/.test(prompt) && /"needs_technique"/.test(prompt)) { // the private analysis prompt has no <request> block
    text = JSON.stringify({
      needs_technique: true, technique: 'gcd over the divisors of n', nudge: 'When are two numbers equal modulo m? Phrase it through their difference.',
      key_idea: 'Blocks coincide modulo m exactly when m divides every |a_i - a_(i+k)|, so take the gcd of those differences.',
      solution: 'For each divisor k of n compute g = gcd of |a_i - a_(i+k)| over all i. The divisor scores if g != 1.', complexity: 'O(d(n) * n log n)',
      pitfalls: ['g = 0 means the blocks are already identical and it counts'], thought_path: 'Translate "equal modulo m" into "m divides the difference".', confidence: 'high',
    });
  } else if (/IDEA CHECK/.test(request)) text = 'VERDICT: CORRECT\nThe key observation is there: **m must divide every difference**, so the gcd decides it. Complexity fits the limits.';
  else if (/REFLECTION DRAFT/.test(request)) text = '```json\n' + JSON.stringify({ key_idea: 'Equal modulo m means m divides the difference, so take the gcd of |a_i - a_(i+k)|.', missed: 'You stayed with sorting for too long before restating the condition.', mistake: 'wrong_path', takeaway: 'Restate "equal modulo m" as divisibility of differences before trying structure.' }) + '\n```';
  else if (/HINT REQUEST, level 1/.test(request)) text = 'Yes. It relies on the **gcd** over the divisors of n.';
  else if (/HINT REQUEST, level 2/.test(request)) text = 'Leave sorting aside. When are two numbers equal modulo m? Write that condition through their difference and try k = 2 by hand.';
  else if (/HINT REQUEST, level 3/.test(request)) text = 'm must divide every |a_i - a_(i+k)|, so only the gcd of those differences matters.';
  else if (/SOLUTION REQUEST/.test(request)) text = '1. Two numbers are equal modulo m when m divides their difference.\n2. For a divisor k take g = gcd of |a_i - a_(i+k)|.\n3. The divisor scores if g != 1.\n\n**What would have led you there**: restating the condition as divisibility.\n\nImplement it now without looking back at this text.';
  else if (/TRAINING REVIEW/.test(request)) text = '**Where you are**\nGym level near your starting estimate with a handful of attempts.\n\n**What is holding you back**\n- You stay on a wrong approach too long.\n\n**This week**\n- Four practice problems at 1600 to 1700, one contest.\n\n**One habit**\nWrite the complexity before coding.\n\n```json\n{"focus_tags": ["dp", "graphs"], "difficulty": "standard", "habit": "Write the complexity before coding"}\n```';
  else if (/WEEKLY PLAN NOTE/.test(request)) text = '**This week**\nThe contest on Saturday matters most: you are slow on the third problem.\n\n**Watch for**\nWrite the complexity before coding.';
  else if (/<contest>/.test(prompt)) text = 'You spent most of the clock on one problem. Next time move on after 25 minutes without progress and come back later.';
  else text = `Here is a direct answer to "${request.slice(0, 80)}": train on problems 100 to 200 above your level and reflect after each one.`;

  const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  emit({ type: 'system', subtype: 'init', model: 'fake' });
  emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
  const size = Math.ceil(text.length / 4);
  for (let i = 0; i < text.length; i += size) {
    emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(i, i + size) } } });
    await sleep(40);
  }
  emit({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 1, output_tokens: 1 } });
});
