# Strokes Gained

An installable PWA that pulls the current week's PGA Tour field from
[DataGolf](https://datagolf.com/api-access) and lets you rank and filter it by
weighted strokes gained categories.

Everything runs on your machine. There is no build step, no dependencies, and
no backend other than a small local server that hosts the page and forwards
requests to DataGolf.

## Running it

```bash
npm start           # http://127.0.0.1:5173
```

Open the URL, click **Settings**, paste your DataGolf API key, and hit
**Save & load**. The key is stored in this browser's `localStorage` and is sent
only to DataGolf.

To install it as an app, use your browser's install/"Add to Home Screen"
action. Once installed it opens offline and shows the last board you loaded.

### On a phone or tablet

`npm start` listens on loopback, so nothing else on your network can reach it.
To use the app from a phone, serve it on the network instead:

```bash
npm run start:lan   # prints the http://192.168.x.x:5173 address to open
```

Add that address to your home screen and it installs as a PWA there too. The
proxy stores no key of its own, so anything else on your network that finds it
would still need a DataGolf key to get anything out of it.

Do not open `index.html` by double-clicking it. Browsers block JavaScript
modules over `file://`, so the app cannot start — it will tell you so rather
than showing a blank page, but a real address is the fix.

### Hosting it somewhere else

Every asset path is relative, so `public/` can be served from a subfolder
(a GitHub Pages project site, say) as well as from a domain root. Without the
local proxy the app calls DataGolf directly, which works only if DataGolf
allows the cross-origin request — see [Can this run without the local
server?](#can-this-run-without-the-local-server) below.

### When the page comes up blank or unstyled

A small watchdog runs before the app does. If startup has not completed a few
seconds after load, it replaces the blank page with a box naming the likely
cause — opened from `file://`, assets missing at this address, a blocked
script — plus the page URL, whether the stylesheet loaded, and any captured
error, with a **Copy details** button.

```bash
npm test            # unit tests for the scoring and join logic
npm run icons       # regenerate the PWA icons
```

Requires Node 18 or newer. `PORT` and `HOST` environment variables override the
defaults.

## Scoring

Each player gets a single **Score** built from the weights you set. Weights run
from -2 to +3 in quarter steps; a negative weight penalises a category, which
is how you fade good putters or short-but-straight drivers.

There are two ways to combine them:

**Field z-score** (default) ranks every category against this week's field,
then takes the weighted average of those z-scores. Because z-scores are
unitless, driving distance in yards and accuracy in percentage points mix in
safely alongside strokes gained. The result is divided by the total absolute
weight, so doubling every weight does not change the numbers.

**Raw strokes gained** adds up weighted strokes gained per round instead, which
is more directly interpretable. Driving distance and accuracy are excluded in
this mode, because yards and percentage points do not add to strokes.

Players who are in the field but missing from DataGolf's skill ratings (usually
Monday qualifiers and amateurs) are hidden by default. Untick *Only players
with DataGolf skill data* to see them; they sort to the bottom and show `—`.

### Categories

| | |
|---|---|
| OTT, APP, ARG, PUTT | the four core strokes gained categories |
| T2G | derived: OTT + APP + ARG |
| TOTAL | DataGolf's overall skill estimate |
| DIST, ACC | driving distance and accuracy |

T2G and TOTAL overlap with the four core categories, so weighting them together
double counts. That is allowed on purpose — weighting TOTAL alone is a quick way
to sort by raw overall skill.

### Presets

Eight built-in weight sets (Balanced, Ball strikers, Approach heavy, Bombers,
Position players, Short game, Putting contest, Total only) are a starting point.
Adjust any slider and the preset switches to *Custom*; **Save as preset** keeps
your own, which persist in this browser.

## Filtering

- **Min/max bounds** on every category and on the pre-tournament win, top-10 and
  make-cut probabilities. The field's actual range is shown beside each row so
  you know what a sensible bound looks like. A player missing a value is
  excluded by any active bound on it.
- **Search** by player name or country.
- Toggles for amateurs and for players without skill data.

Any column header sorts the board. **Export CSV** dumps exactly what you are
looking at, in the order you are looking at it.

### Reading the colours

Cells are tinted on a diverging blue-to-red scale, blue above the field's
midpoint and red below, with the intensity scaled by the field's own spread.
For strokes gained the midpoint is zero, which is tour average and the number
that actually means something. For a measure with no meaningful zero — raw
driving distance in yards — the midpoint is the field median instead. The value
is always printed in the cell, so colour never carries information on its own.

## How the data is put together

Four DataGolf endpoints, joined on `dg_id`:

| Endpoint | Used for |
|---|---|
| `/field-updates` | this week's field, event name, tee times, DK/FD salaries |
| `/preds/skill-ratings` | the strokes gained skill estimates everything is built on |
| `/preds/pre-tournament` | win / top-10 / make-cut probabilities (optional) |
| `/get-schedule` | course and location for the event (optional) |

The field and skill ratings are required; if the other two fail the board still
loads without those columns. Responses are cached in `localStorage` — the field
for 5 minutes, skill ratings for 6 hours — and the cache is what lets the app
open offline. **Refresh** always bypasses it.

Two feed quirks are handled automatically: driving accuracy arrives as either a
fraction or percentage points depending on the feed, and pre-tournament
probabilities arrive as decimals. Both are detected from the data and
normalised, so the columns read as `-3.1` and `4.2%` either way.

## Watching your API usage

The **API requests** tile is live. It counts every request the app makes,
persists the log across reloads, and shows today's total alongside the rate for
the last hour and the last minute. Click it for the full diagnostics panel: a
per-minute bar chart of the last half hour, the recent error list, and the
report.

If DataGolf sends rate-limit headers, the tile switches to showing the real
remaining quota instead (`4987 / 5000`). Whether that happens is up to
DataGolf — the app looks for the usual `X-RateLimit-*` and `RateLimit-*` names
and also scans response bodies for quota-shaped fields. When nothing is
reported, the panel says so explicitly rather than showing a blank, so you can
tell "no quota reported" from "quota hidden from us".

A load costs up to four requests, one per feed. Cached responses are counted
separately and do not touch your quota — that is what *From cache* means.

## When something breaks

Errors appear in a banner at the top with two buttons: **Copy error** puts the
message plus a full debug report on your clipboard, and **Diagnostics** opens
the panel.

The report is markdown, and it is designed to be pasted straight back to me.
It contains the app version and transport, browser and origin, your weight and
filter settings, the request log with timings and status codes, every recent
error with its response body, **the exact shape of each DataGolf feed**, and a
per-category count of how many players had data. That last pair is what makes a
schema change diagnosable without me being able to call the API myself.

The app also watches for silent breakage — feeds that parse but produce nothing
usable, such as no player carrying a `dg_id`, no field player matching a skill
row, or a category that came back empty across the board. Each raises a
specific warning instead of leaving you with a blank table.

**Your API key never appears in any of it.** It is stripped from the report,
from the on-screen error banner, and from the stored log — both by matching the
key itself and by matching any `key=` parameter, since DataGolf echoes the
request URL back in some errors. There are unit tests asserting this.

## Can this run without the local server?

Short answer: only if DataGolf sends CORS headers, and the app can now tell you
whether it does. Open **Diagnostics → Test direct connection**.

The long answer is that this is not a design choice. A browser will not let a
page read a cross-origin response unless the server opts in with
`Access-Control-Allow-Origin`. If DataGolf sends it, `public/` is a plain static
folder and any static file server will do:

```bash
npx http-server public -p 5173      # or python3 -m http.server
```

The app detects that the proxy is absent and calls DataGolf directly. If
DataGolf does not send that header, no amount of client-side code can work
around it — that is the whole point of the same-origin policy.

Two things you give up in direct mode even when it works:

- **Rate-limit headers become invisible.** A page can only read response headers
  the server names in `Access-Control-Expose-Headers`. The local proxy reads
  them server-side and forwards them, which is why the live quota readout is
  more informative through the proxy.
- **A failed request is ambiguous.** `fetch` rejects identically for a CORS
  block and a dead network, so the app cannot tell you which without the probe.

Some things that look like alternatives but are not:

- **Opening `index.html` from `file://`** does not work. Browsers refuse to load
  ES modules over `file://`, service workers are unavailable there so it could
  not be a PWA, and the origin is `null`, which almost no API accepts.
- **A public CORS proxy** (`corsproxy.io` and friends) would work, and you
  should not use one. It means handing your API key to a stranger's server on
  every request. That is the one option here that is genuinely unsafe, which is
  why the local proxy allowlists its upstream paths and binds to loopback.
- **`mode: 'no-cors'`** returns an opaque response your code cannot read.

So: yes, if DataGolf cooperates, and the probe will tell you in one click.
Otherwise something on your machine has to make the request, and 150 lines of
dependency-free Node is the smallest honest version of that.

### What the local server does

`server.mjs` serves `public/` and proxies `/dg/*` to
`https://feeds.datagolf.com/*`. It binds to loopback only, allows a fixed list
of upstream paths, forwards rate-limit headers back to the page, and never logs
your key.

## The Nine: a nine-hole handicap book

`public/nine/` is a second, separate app: a scorebook for a group of friends who
play the same nine. It keeps the rounds, works out each player's handicap, and
tells you how many strokes everyone gets. It is also where the paper
(yardage-book) look is being tried out: card stock, pencilled scores, red-ink stamp.

```bash
npm start           # then open http://127.0.0.1:5173/nine/
```

It needs no API key and no server of its own. `public/nine/` is plain static
files, and it installs as its own PWA. Everything is kept in the browser's
`localStorage`. One person keeps the book and shares it with **Rounds →
Download**. **Import** on another phone replaces that phone's book with the file.

| | |
|---|---|
| **Card** | Enter each player's nine-hole total for the day; blank means they didn't play. |
| **Strokes** | Tick who's playing. The lowest handicap plays off scratch and everyone else gets the difference, with a head-to-head table for three or more. |
| **Players** | Each index, plus the last 20 differentials with the ones that count circled. |
| **Rounds** | Every round, editable, plus download/import. |

### The handicap maths

It is for one course — rating 27.3, slope 87, set in `COURSE` in
`public/nine/js/handicap.js`. That file is pure and covered by
`test/nine-handicap.test.mjs`.

1. **Differential** = (113 ÷ 87) × (score − 27.3), to 0.1.
2. **Index.** Take the most recent 20 rounds, and average the best of them:

   | Eligible rounds | 1–5 | 6–8 | 9–11 | 12–14 | 15–16 | 17–18 | 19 | 20+ |
   |---|---|---|---|---|---|---|---|---|
   | Best used | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |

3. **Course handicap** = index × 87 ÷ 113, rounded.
4. **Strokes to give** = each course handicap minus the lowest in the group.

Scores are totals, not hole by hole, so there is no per-hole cap on blow-up
holes and no placing strokes on particular holes. It is a pure nine-hole index,
never converted to 18 holes, without the official small-sample adjustments.

```bash
npm run icons:nine  # regenerate The Nine's icons
```

## Layout

```
server.mjs              static host + DataGolf proxy
public/
  index.html            the shell
  styles.css            light and dark themes
  sw.js                 service worker (app shell only; feed data is not cached here)
  manifest.webmanifest
  js/
    app.js              wiring and event handlers
    api.js              DataGolf client, caching, transport detection
    model.js            joins the feeds into table rows
    scoring.js          field statistics and the weighted score — all pure
    diagnostics.js      request log, usage stats, redaction, debug report
    ui.js               rendering
    presets.js          built-in weight sets
    store.js            settings persistence
public/nine/             The Nine — separate nine-hole handicap app (see above)
  js/handicap.js        differentials, index, strokes — all pure
  js/store.js           the book in localStorage, import/export, demo season
  js/app.js             pages and wiring
  nine.css              the paper look
tools/make-icons.mjs    generates the PNG icons with no image dependencies
tools/make-nine-icons.mjs  The Nine's icons
tools/png.mjs           shared PNG encoder for both
test/                   node:test unit tests
```

`scoring.js` and `model.js` are pure and carry the unit tests. The rest is DOM
wiring.

## Known limits

- The scoring logic is covered by tests against fixtures, and the UI has been
  driven end to end in a browser against stubbed feeds, but the DataGolf
  endpoints have not been exercised with a live key — network access to
  `feeds.datagolf.com` was blocked in the environment this was written in. That
  is what the diagnostics report is for: if anything looks wrong, send it and
  the feed shapes in it should pin down the cause.
- Whether DataGolf reports rate limits at all is unknown for the same reason.
  The app handles the common header conventions and says plainly when it sees
  none.
- Skill ratings are DataGolf's global, all-conditions estimates. There is no
  course-fit or recent-form adjustment yet; `/preds/skill-decompositions` and
  `/preds/player-decompositions` would be the way to add one.
- Filters apply to the whole field at once. There is no way to save a filter
  set the way you can save weights.
