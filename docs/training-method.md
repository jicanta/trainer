# The method behind CP Gym

The app is an implementation of what three top competitors say about practice. Where they disagree, the app
offers both and records which one you chose.

## Sources

- Um_nik, [How to practice Competitive Programming](https://codeforces.com/blog/entry/98806),
  [Pro Tips](https://codeforces.com/blog/entry/113785), [Things I don't know](https://codeforces.com/blog/entry/92248)
- Errichto, [How to practice?](https://github.com/Errichto/youtube/wiki/How-to-practice%3F) and
  [FAQ](https://github.com/Errichto/youtube/wiki/FAQ)
- Radewoosh, [My opinion on how to practice competitive programming](https://codeforces.com/blog/entry/91114)

## What they say, and what the app does with it

| Advice | Source | In the app |
|---|---|---|
| Solve problems slightly above your level: not easy, usually solvable. The "interesting interval" is narrow. | Errichto, Um_nik | The picker draws from your level up to 300 above it, and the level moves with every result. |
| Solving and solving fast are separate skills. Archives teach the first, contests the second. | Um_nik | Practice and virtual contests are separate modes with separate statistics (level vs. contest performance and speed). |
| Do not solve by topic and do not look at tags: they are spoilers, and recognizing the topic is the skill. | Um_nik, Errichto | Tags never reach the screen while a problem is open, on the picker, in the workspace or on the Codeforces page. |
| Know your weaknesses and go solve such problems. | Radewoosh | The picker is weighted toward weak topics without telling you which. A topic filter exists for a deliberate short block. |
| You are stuck only when you have had no new idea for 20 to 30 minutes (longer for hard problems). Then read the editorial, understand it, implement it. | Errichto | The stuck clock counts from your last logged idea. When it runs out you are asked to decide. The solution route puts the problem in the upsolve queue. |
| Do not read the editorial. Drop the problem and return in a month with new skills. | Um_nik | "Park": no spoilers, back in the queue after 30 days. |
| If truly stuck, ask a stronger friend one yes/no question: does this need a standard technique? | Um_nik | Hint level 1, the technique check. |
| Ask yourself questions while reading, solving, before coding, and when it fails. | Um_nik | The "Ask yourself" tab, and the reflection prompts after each problem. |
| Upsolve what you could not solve in a contest: one or two problems, not the hardest ones. | Errichto, Um_nik | After a contest the two most reachable unsolved problems are queued. Your real Codeforces rounds are scanned for the same. |
| Do not force an algorithm onto a problem. You need fundamentals, not exotic algorithms. | Um_nik | The coach is instructed accordingly, and only core topics are tracked. |
| Measure progress by not-easy problems solved, not by rating. | Errichto, Um_nik | The monthly counter on the home screen. |
| Challenges, not routine: only enter a virtual contest you are not sure to sweep. | Radewoosh | The contest ladder is built so that half of it is a coin flip or a reach. |
| Keep a solved problem in your mind; understand what you missed. | Radewoosh, Errichto | The reflection, the journal, and the cold re-solve two weeks after a heavily assisted solve. |
| Practice regularly; consistency beats bursts. | Errichto | The weekly plan: blocks sized to the time you have each day, a streak, and a plan that shrinks when you did not finish the last one. |

## The numbers

- **Level**: Elo-style, Codeforces scale. Expected score for a problem rated r at level L is 1 / (1 + 10^((r - L) / 400)).
  A clean solve scores 1, a solve after the technique check 0.75, after a nudge 0.5, after the key idea 0.25,
  anything after the full solution 0. Parked and unsolved count as 0. Upsolves and re-solves do not count.
  Contest problems and idea drills move the level less than a practice solve.
- **Contest performance**: the level at which the expected number of solves equals what you solved.
- **Topic priority**: 0.6 x (how far your topic level is below your level) + 0.4 x (how little you have solved at
  your level on Codeforces), scaled by how often the topic appears at your level.
- **Weekly plan**: minutes per problem = median think + code time of your recent clean or assisted practice solves at
  your level, plus 5 for the reflection (your time budget until there are three). Difficulty steps up one preset when
  60% or more of your last problems at level were clean, down one at 25% or less. One contest per week from 240
  planned minutes, two from 5 contest lengths (or 3.5 when "too slow" is your top mistake); a rated round counts first.
  If you finished under 50% of last week, the plan fills 75% of your time; under 75%, 90%. Done = planned minutes
  covered, where a block of n problems counts in proportion to the problems finished.
