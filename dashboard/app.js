// The dashboard's behaviour: filters, sorting, the detail view and the live panel, all from the data
// this program wrote into data.js. No fetch, no network, no framework.

const DATA = window.RADAR;
const PAGE = 50;
const el = (id) => document.getElementById(id);

const money = (n) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
};
const pct = (n) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);
const days = (n) => (n === null || n === undefined ? 'unknown' : n >= 365 ? `${(n / 365).toFixed(1)}y` : `${n}d`);
const num = (n) => n.toLocaleString('en-US');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const rows = DATA.rows;
let shown = PAGE;
let sortKey = 'rank';

function fillSelect(select, values, allLabel) {
  select.innerHTML = `<option value="">${allLabel}</option>` + values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
}

function setup() {
  el('meta-date').textContent = DATA.as_of;
  el('meta-total').textContent = num(DATA.total_protocols);
  el('meta-ranked').textContent = num(DATA.board_size);
  el('meta-watch').textContent = num(DATA.watchlist_size);
  el('meta-total-value').textContent = money(DATA.implied_total_usd);

  const f = DATA.fit;
  el('m-fitn').textContent = f.ok ? num(f.n_fit) : '—';
  el('m-testn').textContent = f.ok ? num(f.n_test) : '—';
  el('m-oos').textContent = f.ok ? `±${f.oos_mae_pct}% (median absolute)` : 'no fit';
  el('bands').innerHTML = (f.bands ?? [])
    .map((b) => {
      const hi = b.hi === null || b.hi > 1e17 ? 'and up' : money(b.hi);
      return `<tr><td>${money(b.lo)} – ${hi}</td><td class="num">${b.n}</td><td class="num">${b.median.toFixed(3)}×</td><td class="num">${money(1e6 * b.median)}</td></tr>`;
    })
    .join('');

  fillSelect(el('category'), [...new Set(rows.map((r) => r.category).filter(Boolean))].sort(), 'All categories');
  fillSelect(el('chain'), [...new Set(rows.flatMap((r) => r.chains))].sort(), 'All chains');

  el('foot-date').textContent = DATA.as_of;
  el('foot-source').textContent = DATA.source;

  renderLive();
  render();
}

function filtered() {
  const q = el('q').value.trim().toLowerCase();
  const cat = el('category').value;
  const chain = el('chain').value;
  const scope = el('scope').value;
  let list = rows.filter((r) => {
    if (cat && r.category !== cat) return false;
    if (chain && !r.chains.includes(chain)) return false;
    if (scope === 'watch' && !r.watchlist) return false;
    if (scope === 'early' && r.watchlist) return false;
    if (q) {
      const hay = `${r.name} ${r.slug} ${r.category ?? ''} ${r.chains.join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const order = {
    rank: (a, b) => a.rank - b.rank,
    value: (a, b) => b.implied_value_usd - a.implied_value_usd,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    growth: (a, b) => (b.change_7d ?? -999) - (a.change_7d ?? -999),
    age: (a, b) => (a.age_days ?? 1e9) - (b.age_days ?? 1e9),
  }[sortKey];
  return list.sort(order);
}

function render() {
  const list = filtered();
  const slice = list.slice(0, shown);
  const top = rows.length > 0 ? rows[0].implied_value_usd : 1;
  el('rows').innerHTML = slice
    .map(
      (r) => `
      <tr class="row${r.watchlist ? ' is-watch' : ''}" tabindex="0" data-slug="${esc(r.slug)}">
        <td class="num rank">${r.rank}</td>
        <td><span class="name">${esc(r.name)}</span><span class="slug">${esc(r.slug)}</span></td>
        <td>${r.category ? `<span class="pill">${esc(r.category)}</span>` : '—'}</td>
        <td><span class="chains">${esc(r.chains.join(', ') || '—')}</span></td>
        <td class="num">${money(r.tvl_usd)}</td>
        <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'delta-up' : 'delta-down'}">${pct(r.change_7d)}</td>
        <td class="num">${days(r.age_days)}</td>
        <td class="num value">${money(r.implied_value_usd)}<span class="bar" style="--w:${Math.max(2, Math.round((r.implied_value_usd / top) * 100))}%" aria-hidden="true"></span></td>
        <td class="num"><span class="pill ${r.watchlist ? 'watch' : 'early'}">${r.farm_steps.length} steps</span></td>
      </tr>`,
    )
    .join('');
  el('count').textContent = `${num(list.length)} of ${num(rows.length)} ranked protocols${list.length !== rows.length ? ' match the filters' : ''} · showing ${slice.length}`;
  el('more').hidden = list.length <= shown;
  for (const tr of el('rows').querySelectorAll('.row')) {
    tr.addEventListener('click', () => openDetail(tr.dataset.slug));
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDetail(tr.dataset.slug);
      }
    });
  }
}

function renderLive() {
  el('live-rows').innerHTML = DATA.live
    .map(
      (r) => `
      <tr>
        <td><span class="name">${esc(r.name)}</span></td>
        <td>${r.category ? `<span class="pill">${esc(r.category)}</span>` : '—'}</td>
        <td class="num">${money(r.tvl_usd)}</td>
        <td class="num">${money(r.mcap_usd)}</td>
        <td class="num">${r.ratio === null ? '—' : `${r.ratio.toFixed(2)}×`}</td>
        <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'delta-up' : 'delta-down'}">${pct(r.change_7d)}</td>
      </tr>`,
    )
    .join('');
}

function openDetail(slug) {
  const r = rows.find((row) => row.slug === slug);
  if (!r) return;
  el('detail-title').textContent = `${r.name} · rank ${r.rank}`;
  el('detail-meta').textContent = `${r.category ?? 'no category'} · ${r.chains.join(', ') || 'chain unknown'} · record began ${r.listed_at ?? 'unknown'} (${days(r.age_days)})${r.watchlist ? ' · on the watchlist' : ' · below the floor'}`;
  const comps = [...DATA.market]
    .sort((a, b) => Math.abs(Math.log(a.tvl_usd / r.tvl_usd)) - Math.abs(Math.log(b.tvl_usd / r.tvl_usd)))
    .slice(0, 4);
  el('detail-model').innerHTML = [
    ['TVL', money(r.tvl_usd)],
    ['Band multiple (fitted)', `${r.multiple.toFixed(3)}×`],
    ['Chain factor', `${r.chain_multiplier.toFixed(3)}×`],
    ['Implied value', money(r.implied_value_usd)],
    ...comps.map((c) => [`comp · ${c.name}`, `${c.multiple.toFixed(2)}× on ${money(c.tvl_usd)} TVL`]),
  ]
    .map(([k, v]) => `<li><span>${esc(k)}</span><span>${esc(v)}</span></li>`)
    .join('');
  el('detail-farm').innerHTML = r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('');
  el('detail').hidden = false;
  el('detail').scrollIntoView({ block: 'nearest' });
}

el('q').addEventListener('input', () => { shown = PAGE; render(); });
for (const id of ['category', 'chain', 'scope', 'sort']) {
  el(id).addEventListener('change', () => {
    if (id === 'sort') sortKey = el('sort').value;
    shown = PAGE;
    render();
  });
}
el('more').addEventListener('click', () => { shown += PAGE; render(); });
el('reset').addEventListener('click', () => {
  el('q').value = '';
  el('category').value = '';
  el('chain').value = '';
  el('scope').value = 'all';
  el('sort').value = 'rank';
  sortKey = 'rank';
  shown = PAGE;
  render();
});
el('close').addEventListener('click', () => { el('detail').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') el('detail').hidden = true; });

setup();
