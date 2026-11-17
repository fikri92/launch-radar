// Fitting the value model from the snapshot itself.
//
// The board must not rest on weights someone typed. The multiple a token is priced at is derived from
// the protocols whose token already trades: for each of them, multiple = market_cap / tvl is what the
// market actually paid for one dollar of treasury.
//
// That distribution is wide (a protocol can trade under its treasury or many times over), so the model
// is a **median multiple per TVL band**, not a regression line: medians survive the outliers that make a
// least-squares slope meaningless here. Each band reports its own median and its own count, and the
// board's implied value is `tvl * band_median * chain adjustment`.
//
// The fit is then tested on rows it never saw: bands are computed on a 70% split (chosen by a hash of
// the slug, so the split is stable), and the held-out 30% is scored by the median absolute log error,
// reported on the dashboard as a percentage. A model that cannot say how wrong it is should not rank
// anything.

export interface FitRow {
  slug: string;
  name: string;
  tvl: number;
  mcap: number;
  growth: number;
  age: number;
}

export interface Band {
  lo: number;
  hi: number;
  n: number;
  median: number;
}

export interface FitResult {
  ok: boolean;
  n: number;
  n_fit: number;
  n_test: number;
  multiple_median: number;
  multiple_p25: number;
  multiple_p75: number;
  bands: Band[];
  r2: number;
  oos_mae_pct: number;
  oos_n: number;
  note: string;
  rows: FitRow[];
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function hash(slug: string): number {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i += 1) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

function quantile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]!;
}

/** Three TVL bands at the 1/3 and 2/3 quantiles of the rows they are built from. */
function makeBands(rows: FitRow[]): Band[] {
  if (rows.length === 0) return [];
  const tvls = rows.map((r) => r.tvl).sort((a, b) => a - b);
  const q1 = quantile(tvls, 1 / 3);
  const q2 = quantile(tvls, 2 / 3);
  const groups: FitRow[][] = [[], [], []];
  for (const r of rows) groups[r.tvl <= q1 ? 0 : r.tvl <= q2 ? 1 : 2]!.push(r);
  return groups.map((g, i) => ({
    lo: i === 0 ? 0 : g.length > 0 ? Math.min(...g.map((r) => r.tvl)) : 0,
    hi: i === 2 ? Number.POSITIVE_INFINITY : g.length > 0 ? Math.max(...g.map((r) => r.tvl)) : 0,
    n: g.length,
    median: Math.round(median(g.map((r) => r.mcap / r.tvl)) * 1000) / 1000,
  }));
}

function bandOf(bands: Band[], tvl: number, fallback: number): number {
  for (const band of bands) if (tvl >= band.lo && tvl < band.hi && band.n > 0) return band.median;
  return fallback;
}

/** Fit from the trading protocols and score it on the held-out split. */
export function fitModel(snapshot: { protocols: any[]; as_of: string }): FitResult {
  const asOf = Date.parse(`${snapshot.as_of}T00:00:00Z`);
  const rows: FitRow[] = [];
  for (const p of snapshot.protocols) {
    if (typeof p.mcap_usd !== 'number' || p.mcap_usd <= 0) continue;
    if (typeof p.tvl_usd !== 'number' || p.tvl_usd <= 0) continue;
    if (p.category === 'CEX') continue;
    const listed = typeof p.listed_at === 'string' ? Date.parse(`${p.listed_at}T00:00:00Z`) : NaN;
    const age = Number.isFinite(listed) ? Math.max(30, Math.floor((asOf - listed) / 86_400_000)) : 365;
    rows.push({
      slug: String(p.slug),
      name: String(p.name ?? p.slug),
      tvl: p.tvl_usd,
      mcap: p.mcap_usd,
      growth: typeof p.change_7d === 'number' ? p.change_7d : 0,
      age,
    });
  }
  const multiples = rows.map((r) => r.mcap / r.tvl);
  const empty: FitResult = {
    ok: false, n: rows.length, n_fit: 0, n_test: 0, multiple_median: 0, multiple_p25: 0, multiple_p75: 0,
    bands: [], r2: 0, oos_mae_pct: 0, oos_n: 0, note: 'not enough trading protocols to fit', rows: [],
  };
  if (rows.length < 20) return empty;

  const overall = median(multiples);
  const bands = makeBands(rows);

  // How much of the log-multiple dispersion the bands explain (in-sample, log space).
  const logs = rows.map((r) => Math.log(r.mcap / r.tvl));
  const meanLog = logs.reduce((a, b) => a + b, 0) / logs.length;
  let sse = 0;
  let sst = 0;
  for (const r of rows) {
    const pred = Math.log(bandOf(bands, r.tvl, overall));
    sse += (Math.log(r.mcap / r.tvl) - pred) ** 2;
    sst += (Math.log(r.mcap / r.tvl) - meanLog) ** 2;
  }
  const r2 = sst === 0 ? 0 : 1 - sse / sst;

  // Held-out test: bands from the 70% split, scored on the 30% it never saw.
  const train = rows.filter((r) => hash(r.slug) < 0.7);
  const test = rows.filter((r) => hash(r.slug) >= 0.7);
  let oosPct = 0;
  if (train.length >= 12 && test.length >= 5) {
    const trainBands = makeBands(train);
    const trainMedian = median(train.map((r) => r.mcap / r.tvl));
    const errs = test.map((r) => Math.abs(Math.log(r.mcap / r.tvl) - Math.log(bandOf(trainBands, r.tvl, trainMedian))));
    oosPct = Math.round((Math.exp(median(errs)) - 1) * 100);
  }

  return {
    ok: true,
    n: rows.length,
    n_fit: train.length,
    n_test: test.length,
    multiple_median: Math.round(overall * 1000) / 1000,
    multiple_p25: Math.round(quantile(multiples, 0.25) * 1000) / 1000,
    multiple_p75: Math.round(quantile(multiples, 0.75) * 1000) / 1000,
    bands,
    r2: Math.round(r2 * 1000) / 1000,
    oos_mae_pct: oosPct,
    oos_n: test.length,
    note: `median multiple per TVL band, from ${rows.length} protocols whose token trades; bands refitted on ${train.length} and scored on ${test.length} held out`,
    rows,
  };
}

/** The multiple the market pays for a protocol of this size, from the fitted bands. */
export function fittedMultiple(fit: FitResult, tvl: number): number {
  if (!fit.ok) return 0.22;
  return bandOf(fit.bands, tvl, fit.multiple_median);
}

/** The nearest trading protocols by TVL: the comps a reader can check the row against. */
export function comps(fit: FitResult, tvl: number, limit = 6): FitRow[] {
  if (!fit.ok) return [];
  return [...fit.rows]
    .sort((a, b) => Math.abs(Math.log(a.tvl / Math.max(1, tvl))) - Math.abs(Math.log(b.tvl / Math.max(1, tvl))))
    .slice(0, limit);
}

export { clamp };
