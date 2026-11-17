# ICPC problems

The ICPC source in Practice draws from the contests the Codeforces Gym marks as "Official ICPC Contest": 541 of
them as of November 2026 (regionals, subregionals, national contests, championships), about 6,100 problems with
enough data to rate, 3,400 of those from 2019 on. The picker uses the same year limit as Codeforces problems
(Settings, 2019 by default).

## Where the numbers come from

`scripts/build-icpc.js` reads each contest's submission list from the public Codeforces API (`contest.status`) and
counts, per problem, how many teams solved it in two separate fields:

- **Official teams**: the real scoreboard of the contest, which the Gym stores as "ghost" participants.
- **Virtual teams**: Codeforces users who played the set later under contest rules.

Practice submissions are left out. The result is `data/icpc.json`, which ships with the app, so nothing is
downloaded at run time. Running the script again adds contests that are new in the Gym; `--all` recounts everything
(about an hour).

## The rating estimate

The Gym has no ratings. `src/icpc.js` estimates one on the Codeforces scale:

1. For each field with 30 teams or more, a problem's rating is the field's strength plus 700 points for every
   tenfold change in the odds of solving it. The strength depends on the Gym's difficulty stars for the contest.
2. Official fields vary a lot between regions, and the virtual teams are a steadier yardstick. So when a contest
   has both, the official estimates are shifted as a block to agree with the virtual ones (the median difference
   over the problems), which keeps the official order inside the contest and takes the level from the virtual field.
3. The two estimates are averaged, weighted by how much each count says, and rounded to the nearest 100.

Contests where neither field reaches 30 teams are not offered.

## How good it is

The constants were fitted on the ICPC problems that also exist in the rated Codeforces problem set (regionals that
were mirrored as rated or educational rounds): 62 problems from 9 contests. On those, the estimate is off by 135
points on average, within 200 points for 87% and within 400 for 95%.

Read that as optimistic. It is measured on the same problems the constants were fitted on, and 8 of the 9 contests
come from one region (Southern and Volga Russia) and 1 from SWERC, so regions with very different fields, Latin
America included, are not checked directly. The order inside one contest is the solid part; a problem's level
against other contests can be off by a few hundred points. The four- and five-star strengths rest on two contests
and a guess.

Attempts on these problems move the gym level like any other, using the estimated rating.

## Not included: QOJ

The plan was to cross-check solve counts with qoj.ac. QOJ answers automated requests with a Cloudflare browser
check, so it cannot be read by a script. The cross-check between official and virtual teams takes its place.
