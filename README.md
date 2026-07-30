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

## Why there is a local server

`server.mjs` does two things: serves `public/`, and proxies `/dg/*` to
`https://feeds.datagolf.com/*`. The proxy exists because DataGolf's feeds are
not guaranteed to send CORS headers, so a browser calling them directly from a
page may be blocked.

It binds to loopback only, allows a fixed list of upstream paths, and never
logs your key. The app probes for it at startup and falls back to calling
DataGolf directly if you are serving `public/` some other way — that path works
only if your browser permits the cross-origin request.

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
    ui.js               rendering
    presets.js          built-in weight sets
    store.js            settings persistence
tools/make-icons.mjs    generates the PNG icons with no image dependencies
test/                   node:test unit tests
```

`scoring.js` and `model.js` are pure and carry the unit tests. The rest is DOM
wiring.

## Known limits

- The scoring logic is covered by tests against fixtures, and the UI has been
  driven end to end in a browser against stubbed feeds, but the DataGolf
  endpoints have not been exercised with a live key — network access to
  `feeds.datagolf.com` was blocked in the environment this was written in. If a
  field name differs from what the code expects, `model.js` is where to look.
- Skill ratings are DataGolf's global, all-conditions estimates. There is no
  course-fit or recent-form adjustment yet; `/preds/skill-decompositions` and
  `/preds/player-decompositions` would be the way to add one.
- Filters apply to the whole field at once. There is no way to save a filter
  set the way you can save weights.
