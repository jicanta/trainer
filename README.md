# CP Gym

A personal desktop gym for competitive programming. It picks problems slightly above your level, times your
thinking separately from your coding, reads your verdicts from Codeforces, records the idea you missed on every
problem, and turns all of that into statistics that steer what you are given next. A coach (your local Claude Code, or a
local model such as a Qwen GGUF) gives graded hints, explains what you missed, and reviews your training.

Built around how Um_nik, Errichto and Radewoosh say to practice: see [docs/training-method.md](docs/training-method.md).

## Use it

You need:

- **Git** and **Node.js 22.12 or newer** (`node -v` to check; [nvm](https://github.com/nvm-sh/nvm) is the easy way to get it).
- A **Codeforces handle**. No password or API key: the app reads your public submissions.
- Optional, for the coach: **[Claude Code](https://claude.com/claude-code)** installed and signed in (run `claude`
  once in a terminal), or a local model server (see [The coach](#the-coach)). Everything else works without
  either; hints, idea judging and reviews do not.

Then:

```bash
git clone https://github.com/jicanta/trainer.git
cd trainer
npm install      # also downloads Electron (about 100 MB), so the first time takes a minute
npm start
```

On first start the app asks for your Codeforces handle, imports your submissions, suggests a starting level and
downloads the problem set. After that, pick **Practice** and go.

Your training data is yours and stays on your machine (see "Things to know"); nothing in this repository is personal.

To update later: `git pull && npm install`.

Developed and tested on Linux (Ubuntu 24.04). `npm start` also starts the app on macOS and Windows, but those are
untested; on Windows the safest route is WSL.

Linux extras:

```bash
npm run install-launcher   # install as a desktop app: application menu entry and a desktop icon
npm run remove-launcher    # remove both again
npm run enable-sandbox     # one-time, sudo: turn the Chromium sandbox on (see "Sandbox" below)
```

If something does not work:

| Symptom | Fix |
|---|---|
| `Electron is not installed yet` | Run `npm install` in the project folder. |
| `npm install` fails or the app crashes on start with a `node:sqlite` error | Your Node is older than 22.12. Update it. |
| The coach says Claude Code was not found | Install Claude Code and sign in, or set the full path to `claude` in Settings. Or use a local model (see The coach). |
| The Codeforces panel shows a browser check or stays blank | Complete the check in the panel, or open the problem in your browser (arrow button). |

## How a session goes

**Practice.** The picker shows six unseen problems in your band (your level up to 300 above it by default).
Tags are hidden until you finish: recognizing what a problem needs is the skill. Pick one and the workspace opens
with the Codeforces statement on the left and your clock, notes and coach on the right.

- The clock has two phases, **Think** and **Code**. Switch when you start typing code. Pausing hides the statement.
- **Since your last new idea** is the stuck clock. Logging an idea (one line, Enter) resets it. After 25 minutes
  without one the app asks you to decide: a hint, park it, or keep going. A check-in every 10 minutes asks what you
  are trying right now; "I drifted" is an honest answer and is counted.
- Submit on Codeforces, in the panel or in your browser. Verdicts are read from your public submissions, so wrong
  answers are counted and an accepted run ends the attempt on its own.
- **Hints cost credit**: technique check 75%, nudge 50%, key idea 25%, full solution 0%. Chat without a hint is
  free, and the coach will then only clarify the statement and ask questions.
- **Park** stops without spoilers; the problem returns in 30 days. Reading the solution puts it in the upsolve
  queue, and anything solved with heavy help comes back two weeks later for a cold re-solve.
- Afterwards you write a short **reflection**: key idea, what you missed, what went wrong, one takeaway. The coach
  can draft it. This is what the insights are made of.

**Idea drill.** Same, without coding: think the problem through, write the full idea, and the coach judges it.
More problems per hour, all of it thinking.

**Virtual contest.** Four to six problems on a ladder around your level (or a real past round you never touched),
two hours, no hints, no pause, ratings and tags hidden. Results give a performance estimate, queue one or two
problems for upsolving, and can be debriefed with the coach.

## Insights and the feedback loop

- **Gym level**: an Elo-style estimate on the Codeforces scale, replayed from your attempt log.
- Results and time by rating, training time per week, mistakes from your reflections, drifts per thinking hour.
- **Topics**: gym results per topic, topic level, and how much you have solved at your level on Codeforces.
  The resulting priority quietly biases the practice picker toward weak topics.
- **From your Codeforces history**: where your real rounds stop, your in-contest speed by rating, what you try and fail.
- **Coach review**: the coach reads all of it, says what is holding you back, and proposes focus topics, a
  difficulty preset and one habit. "Apply" feeds that back into problem selection for two weeks.
- Before each new problem you are shown your most frequent recent mistake and your latest takeaways.

## The coach

The coach is the `claude` CLI on your machine, run headless with no tools, no plugins and no access to your files
(`claude -p --safe-mode --tools ""`). It sees only what the app sends: the statement, the official Codeforces
tutorial when one exists, your notes, the conversation and your statistics. The model is set in Settings (Opus by
default; Fable is stronger and uses more of your plan). Its usage counts against your Claude plan.

### A local model instead of Claude

The coach can also run on a model on your own machine, for example a Qwen GGUF from unsloth. In Settings, under
Coach, choose **Local model** and point it at any server that speaks the OpenAI chat API:

| Server | Start it | Address |
| --- | --- | --- |
| llama.cpp | `llama-server -m model.gguf -c 16384 --jinja` | `http://localhost:8080/v1` (model name can stay empty) |
| LM Studio | load the model, start the local server | `http://localhost:1234/v1` |
| Ollama | `ollama serve` | `http://localhost:11434/v1` |

"Test connection" lists the models the server offers. Give the server a context of 16k tokens or more: the coach
sends the statement, the tutorial and your notes with every message. The model's own thinking (`<think>` blocks) is
never shown. A small quantized model solves problems far less reliably than Claude, so its hints are most
trustworthy on problems that have an official tutorial to ground them.

## Things to know

- **Codeforces panel.** Sign in there once if you want to submit from inside the app; the login is kept. If
  Codeforces shows a browser check, complete it in the panel. If the panel cannot show a problem at all, open it
  in your browser (the arrow button) and use "Paste it instead" in the Coach tab so the coach still has the
  statement. Verdicts are unaffected: they come from the Codeforces API.
- **Data** lives in `~/.config/cp-gym/` on Linux (`~/Library/Application Support/cp-gym/` on macOS,
  `%APPDATA%\cp-gym\` on Windows): one SQLite file, `cpgym.db`. Settings has "Export my data".
- **Sandbox.** Ubuntu 23.10 and later block Chromium's sandbox for apps without an AppArmor profile, so the
  launcher starts the app with `--no-sandbox` there. The embedded view only loads codeforces.com. To run with the
  sandbox on, run `npm run enable-sandbox` once (it makes Electron's sandbox helper root-owned).

## Tests

```bash
npm test          # logic: level model, recommender, sessions, contests, verdict watcher, stats
npm run test:ui   # the whole app, headless, against local stand-ins for Codeforces, Claude and a local model
node test/live/sync.js /tmp/cpgym-live <handle>   # live Codeforces API check
node test/live/coach.js opus                      # live coach check (a few real Claude calls)
node test/live/coach.js local http://localhost:8080/v1   # the same check against your local model server
node test/live/page.js <profile-dir> 1920C        # loads one real problem in the app; use sparingly
```

## Where to change things

| What | Where |
|---|---|
| Difficulty bands, contest ladders, topic weighting | `src/recommend.js` |
| Level model, hint credit | `src/model.js` |
| Queue rules (park, upsolve, re-solve), time budgets | `src/sessions.js` |
| Coach prompts and reveal levels | `src/coach.js` |
| Statistics and the coach's view of your data | `src/stats.js` |
| "Ask yourself" questions, notices in the workspace | `ui/views/solve.js` |
| Colors and type | `ui/styles.css` |
