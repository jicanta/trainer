# CP Gym

A personal desktop gym for competitive programming. It plans your week around the time you have, picks problems
slightly above your level, times your thinking separately from your coding, reads your verdicts from Codeforces,
records the idea you missed on every problem, and turns all of that into statistics that steer what you are given next. A coach (your local Claude Code, or a
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
downloads the problem set. Then open **Plan**, set the minutes you can train each day under "Your usual week", and
follow the blocks on **Today**.

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
| The coach cannot reach the local model server | Start llama-server, LM Studio or Ollama, then check the address with "Test connection" in Settings. |
| The coach says the prompt did not fit the context | Restart the model server with a larger context (16k tokens or more). |
| The Codeforces panel shows a browser check or stays blank | Complete the check in the panel, or open the problem in your browser (arrow button). |

## The weekly plan

**Plan** turns the minutes you have each day (set under "Your usual week"; 0 is a rest day) into concrete blocks:
practice problems at a given difficulty, idea drills, upsolves, re-solves, a virtual contest, and upcoming rated
Codeforces rounds. Today shows today's blocks with a Start button each, and a strip with the week. "Today I have"
changes only today.

- **Built from your log.** The planner measures how long a problem takes you, moves the difficulty with your
  clean-solve rate at your level, adds idea drills when you keep missing the key observation (or full solves when
  you keep losing problems to bugs), puts one short block on your weakest topic, makes one day a challenge day, and
  follows each contest with upsolves. "Why this plan" lists the reasons.
- **Adapts.** Past days are frozen. Today and the rest of the week are rebuilt once a day, when something new lands
  in the queue, and when you change your week. If you finished less than half of last week's plan, the new one
  fills less of your time.
- **Tracked without typing.** A block counts as done when the matching attempts or contests are finished. A real
  round counts when your contest submissions sync; any block can also be checked by hand.
- **Metrics**: share of planned minutes done, minutes trained against planned, the streak of planned days
  finished, problems solved at your level, and a chart of the plan done per week.
- **Coach note** (optional, one call): how last week went and what matters most in this one.
- Rounds come from the Codeforces API (`contest.list`, at most twice a day), only those rated for you.

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

No Claude plan? The coach can run on a model on your own machine instead. It was set up with unsloth's
`Qwen3.8-27B-GGUF` (the `UD-IQ3_S` quantization) in mind, and works with any model served through the OpenAI chat
API, which llama.cpp, LM Studio and Ollama all provide. A `.gguf` file is not used directly: one of those programs
loads it and the app talks to that program.

**1. Serve the model.** Pick one:

| Server | Command | Address to enter in the app |
| --- | --- | --- |
| llama.cpp | `llama-server -hf unsloth/Qwen3.8-27B-GGUF:UD-IQ3_S -c 16384 --jinja` (or `-m /path/to/model.gguf` for a file you already have) | `http://localhost:8080/v1` |
| LM Studio | Load the model, then start the server in the Developer tab | `http://localhost:1234/v1` |
| Ollama | `ollama run hf.co/unsloth/Qwen3.8-27B-GGUF:UD-IQ3_S` | `http://localhost:11434/v1` |

**2. Point the app at it.** In **Settings → Coach**, set "Runs on" to **Local model** and fill in:

- **Server address**: from the table above. The server can be on another machine: use its address instead of
  `localhost`.
- **Model name**: leave it empty for llama-server, which answers with whatever it has loaded. LM Studio and Ollama
  need the exact name they list.
- **API key**: only if you started the server with one.

**3. Press "Test connection".** It shows the models the server offers. If it says the server could not be reached,
the server is not running or the address or port is wrong.

From then on hints, idea checks, reflection drafts, debriefs and reviews all come from the local model. Switch back
to Claude Code in the same place at any time; nothing else changes.

What to expect:

- **Context.** Give the server 16k tokens or more (`-c 16384` in llama-server, the context length setting in LM
  Studio, `num_ctx` in Ollama). The coach sends the statement, the tutorial, your notes and the conversation with
  every message. To help it fit, a local model gets less tutorial text and less chat history than Claude does. If
  the coach reports that the prompt did not fit, raise the context.
- **Speed.** The first hint on a problem is the slowest: the model first studies the problem and writes private
  notes, then answers. A local model is allowed four times as long as Claude before the app gives up.
- **Thinking.** Qwen reasons inside `<think>` blocks before it answers. The app shows "Thinking" meanwhile and never
  displays or stores that text.
- **Quality.** A 27B model at 3-bit quantization solves problems far less reliably than Claude. Its hints are most
  trustworthy when the problem has an official Codeforces tutorial, which the app passes to it as ground truth.
  Without one it has to solve the problem itself, so treat a hint that seems off with suspicion, and correct an
  idea-drill result you disagree with from the Journal.

To check a server from the terminal, without opening the app:
`node test/live/coach.js local http://localhost:8080/v1 [model name]`.

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
npm test          # logic: level model, recommender, sessions, contests, verdict watcher, stats, weekly plan
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
| The weekly plan: block rules, adaptation, progress | `src/plan.js` (screen: `ui/views/plan.js`) |
| Level model, hint credit | `src/model.js` |
| Queue rules (park, upsolve, re-solve), time budgets | `src/sessions.js` |
| Coach prompts and reveal levels | `src/coach.js` |
| Statistics and the coach's view of your data | `src/stats.js` |
| "Ask yourself" questions, notices in the workspace | `ui/views/solve.js` |
| Colors and type | `ui/styles.css` |
