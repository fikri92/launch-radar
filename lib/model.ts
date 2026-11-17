// The token radar's model: one snapshot in, one ranked board out.
//
// A protocol is pre-token when its DefiLlama record carries no market cap, no CoinGecko id and no
// symbol. Those are the subjects the radar ranks. Protocols whose token already trades are kept apart
// and shown at the market's own value on the same page.
//
// The implied value uses the snapshot's figures only, and every weight is stated on the dashboard:
//
//   base       = tvl_usd * BASE_MULTIPLE
//   growth     = clamp(change_7d, -50, 150) %          a week of flow, damped and clipped
//   g_mult     = 1 + (growth/100) * GROWTH_WEIGHT
//   age        = as_of - listed_at, days               how long it has run with no token
//   a_mult     = AGE_FLOOR + min(age, AGE_CAP)/AGE_CAP * AGE_RANGE
//   l_mult     = 1 - LATE_PENALTY * clamp((age - LATE_AFTER)/LATE_SPAN, 0, 1)
//   c_mult     = 1 + CHAIN_WEIGHT * clamp(chains-1, 0, CHAIN_CAP)/CHAIN_CAP
//   implied    = max(1, round(base * g_mult * a_mult * l_mult * c_mult))
//
// No name is special-cased: one function scores every row, which is what makes it a model.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  age_floor: number;
  age_range: number;
  age_cap_days: number;
  unknown_age_days: number;
  late_penalty: number;
  late_after_days: number;
  late_span_days: number;
  chain_weight: number;
  chain_cap: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.22,
  growth_weight: 0.55,
  growth_floor: -50,
  growth_cap: 150,
  age_floor: 0.55,
  age_range: 0.5,
  age_cap_days: 1095,
  unknown_age_days: 300,
  late_penalty: 0.25,
  late_after_days: 1460,
  late_span_days: 730,
  chain_weight: 0.08,
  chain_cap: 4,
};

export const MODEL_VERSION = 'radar-2';
export const EARLY_ROWS = 320;
export const LIVE_ROWS = 30;

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    base_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
    late_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  base_usd: number;
  growth_multiplier: number;
  age_multiplier: number;
  late_multiplier: number;
  chain_multiplier: number;
  watchlist: boolean;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_protocols: number;
  implied_total_usd: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const finite = (v: unknown, f: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : f);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants) {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = clamp(finite(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const ageMult = model.age_floor + (clamp(ageForModel, 0, model.age_cap_days) / model.age_cap_days) * model.age_range;
  const lateMult = 1 - model.late_penalty * clamp((ageForModel - model.late_after_days) / model.late_span_days, 0, 1);
  const chainMult = 1 + (model.chain_weight * clamp(protocol.chains.length - 1, 0, model.chain_cap)) / model.chain_cap;
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * ageMult * lateMult * chainMult));
  return { implied, base, growthPct, growthMult, ageMult, lateMult, chainMult, age };
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The category's own action, in the words a farmer can follow. Derived, never a list of names. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${n} on ${chain} and keep the position open.`;
  if (c.includes('leveraged')) return `Open one small $${capital} position on ${n} at ${chain} and keep it well under the liquidation line.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('farm')) return `Provide $${capital} of liquidity to ${n}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${n} and use the bridged funds inside its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${n} on ${chain} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return `Deposit $${capital} of USDC as margin on ${n} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${n}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${n} vault on ${chain} and keep the vault shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} and keep the policy.`;
  if (c.includes('launchpad') || c.includes('nft')) return `Mint or buy $${capital} of ${n}'s own offering on ${chain} and hold it.`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open.`;
}

export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const capital = p.tvl_usd >= 5e9 ? 250 : p.tvl_usd >= 1e9 ? 150 : p.tvl_usd >= 1e8 ? 100 : 50;
  const hold = age === null ? 30 : age < 180 ? 60 : age < 365 ? 45 : 30;
  const step = (text: string, cost: string, time: string): string => `${text} Cost: ${cost}. Time: ${time}.`;
  return [
    step(`Create a fresh wallet that holds only the funds you plan to farm in ${p.name}, and keep its seed phrase offline.`, 'under $3 of gas for the first transaction', '5 minutes'),
    step(actionFor(p, capital, chain), `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, '15 minutes to set up'),
    step(`Take one qualifying action a week on ${p.name}, such as a deposit, a borrow, a swap or a vote, and vary the size a little.`, 'about $2 of gas a week', '10 minutes a week'),
    step(`Hold the position on ${chain} for at least ${hold} days so the activity lands in more than one snapshot of the record.`, `the $${capital} stays in the position`, `${hold} days`),
    step(`Before withdrawing, open ${p.name}'s own rewards page and claim only from the link that protocol publishes itself.`, 'no fee to check, and never pay to claim', '10 minutes'),
    step(`Write the wallet, the dates and every transaction into a farm log for ${p.name}, so the position can be repeated or unwound.`, 'nothing but the log', '5 minutes'),
  ].map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s.length < 20 ? `${s} Keep the position open.` : s));
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      base_usd: Math.round(s.base),
      growth_pct: Math.round(s.growthPct * 100) / 100,
      growth_multiplier: round4(s.growthMult),
      age_multiplier: round4(s.ageMult),
      late_multiplier: round4(s.lateMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 100) / 100 : null,
    }));
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    live_size: live.length,
    total_protocols: snapshot.protocols.length,
    implied_total_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      mcap_usd: r.mcap_usd,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      base_usd: r.model.base_usd,
      growth_multiplier: r.model.growth_multiplier,
      age_multiplier: r.model.age_multiplier,
      late_multiplier: r.model.late_multiplier,
      chain_multiplier: r.model.chain_multiplier,
      watchlist: watch.has(r.slug),
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i += 1) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i += 1) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
