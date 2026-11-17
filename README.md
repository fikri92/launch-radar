# Launch radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/fikri92/launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/fikri92/launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for [make.fun](https://make.fun)'s **token-radar-01** bounty: it reads the sealed
protocol snapshot, finds the protocols whose DefiLlama record carries no token, and ranks them by what a
token would be worth if the record stayed as it is — with the steps to farm each one before it launches.

## What it does

- **Finds the subjects.** A protocol is pre-token when its record has no market cap, no CoinGecko id and
  no symbol. The bounty's watchlist is the floor: every one of its 40 slugs is on the board, and 186 more
  rows come from pre-token protocols below the $50M floor, which is where an early radar earns its keep.
- **Prices them from the record alone.** `implied = TVL × 0.22 × growth × age × late-record × chains`,
  where growth is the seven-day change clipped to −50%…150%, age is days since the record began (capped
  at 1095), a record older than 1460 days loses up to 25% because a long run with no token is weaker
  news, and extra chains add up to 8%. No protocol name is special-cased: one function scores every row,
  and the dashboard states every weight so a reader can re-derive any price.
- **Separates the market's own answers.** Protocols that already trade are shown beside the board with
  their market cap, and their MC/TVL multiple is the yardstick the implied values are read against.
- **Gives a farm plan.** Six steps per row — the wallet, the qualifying action by category, the weekly
  cadence, the hold window, the claim rule and the log — each with what it costs and how long it takes.

## Running it

```bash
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node --experimental-strip-types main.ts --input ../input/snapshot.json
```

It writes `out/board.json` (the ranked board), `out/data.js` (the dashboard's dataset), copies
`dashboard/` and `screenshots/`, and writes `out/dossier.json` last with the vendored library. The page
is static: `dashboard/index.html` reads `../data.js` and renders with no network and no framework.

## Layout

| Path | What it holds |
|---|---|
| `main.ts` | the entry point: snapshot in, board + dashboard data + dossier out |
| `lib/model.ts` | the scoring model, the farm plans and the board checks |
| `dashboard/` | `index.html`, `app.css`, `app.js` — the board, the filters and the detail view |
| `screenshots/` | the board, a protocol's detail view and a filtered view, 1440×900 |
| `vendor/makefun-board.ts` | the bounty's own dossier library, unchanged |

## Notes

Every figure comes from the snapshot the bounty ships (`as_of` 2026-11-14); nothing is fetched at run
time. The implied value is this dashboard's own claim, never a promise that a token will exist or what it
will be worth. MIT licensed.
