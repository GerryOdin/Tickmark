// Tickmark — swing-trading research desk (static app, data from data/*.json)

const view = document.getElementById('view');
const LC = window.LightweightCharts;

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('tm:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tm:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const fmt = (n, d = 2) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (n, d = 2) => (n == null ? '—' : `${n > 0 ? '+' : ''}${Number(n).toFixed(d)}%`);
const updown = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
const RCLASS = { 'Strong Buy': 'r-sb', Buy: 'r-b', Hold: 'r-h', Sell: 'r-s', 'Strong Sell': 'r-ss' };
const fam = (r) => (!r ? null : r.includes('Buy') ? 'buy' : r.includes('Sell') ? 'sell' : 'hold');
const famColor = (r) => ({ buy: 'var(--bull)', sell: 'var(--bear)' }[fam(r)] || 'var(--muted)');
const chip = (r) => (r ? `<span class="chip ${RCLASS[r] || 'r-h'}">${esc(r)}</span>` : '');
const disclaimer = () => `<p class="disclaimer">Educational research tool, not investment advice. Ratings come from simple rules — see the Record tab for how they have actually performed. Prices and news via Yahoo Finance. Charts by <a href="https://www.tradingview.com/" target="_blank" rel="noopener" style="text-decoration:underline">TradingView</a> Lightweight Charts.</p>`;
const COLORS = { bull: '#34d399', bear: '#f87171', neutral: '#8b98a8', news: '#a78bfa', earnings: '#fbbf24', accent: '#5eead4' };

let S = null;
const tickCache = new Map();
let disposers = [];

// ------------------------------------------------------------------- data
async function loadSummary() {
  const r = await fetch('data/summary.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('Could not load data/summary.json');
  S = await r.json();
  S.bySym = Object.fromEntries(S.stocks.map((s) => [s.sym, s]));
  if (S.market.spy) S.bySym.SPY = S.market.spy;
  document.getElementById('asof').textContent = `Close ${S.asOf}`;
  document.getElementById('tickers').innerHTML = Object.values(S.bySym)
    .map((s) => `<option value="${esc(s.sym)}">${esc(s.name)}</option>`).join('');
}

async function loadTicker(sym) {
  if (tickCache.has(sym)) return tickCache.get(sym);
  const r = await fetch(`data/t/${encodeURIComponent(sym)}.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error('not found');
  const t = await r.json();
  tickCache.set(sym, t);
  return t;
}

// ----------------------------------------------------------------- router
function route() {
  disposers.forEach((f) => { try { f(); } catch { /* already gone */ } });
  disposers = [];
  const [r, arg] = (location.hash.replace(/^#\/?/, '') || 'today').split('/');
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === r));
  const views = { today: viewToday, best: viewBest, screener: viewScreener, t: () => viewTicker(arg || 'SPY'), record: viewRecord };
  (views[r] || viewToday)();
  window.scrollTo(0, 0);
}

document.getElementById('search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('q').value.trim();
  if (!q || !S) return;
  const up = q.toUpperCase().replace('.', '-');
  const hit = S.bySym[up] || Object.values(S.bySym).find((s) => s.name.toLowerCase().includes(q.toLowerCase()));
  if (hit) { location.hash = `#/t/${hit.sym}`; document.getElementById('q').value = ''; document.getElementById('q').blur(); }
});
document.getElementById('q').addEventListener('change', (e) => {
  const v = e.target.value.trim().toUpperCase();
  if (S && S.bySym[v]) { location.hash = `#/t/${v}`; e.target.value = ''; e.target.blur(); }
});

// ------------------------------------------------------------- components
function setupCard(s) {
  const color = famColor(s.rating);
  const earn = s.earningsDays != null && s.earningsDays >= 0 && s.earningsDays <= 10
    ? `<span class="chip warn">Earnings in ${s.earningsDays}d</span>` : '';
  return `<a class="card setup" href="#/t/${esc(s.sym)}">
    <div class="head"><span class="sym">${esc(s.sym)}</span>${chip(s.rating)}${earn}<span class="score">${s.score}</span></div>
    <div class="name">${esc(s.name)} · ${esc(s.sector)}</div>
    <div class="bar"><i style="width:${s.score}%;background:${color}"></i></div>
    <div class="muted" style="font-size:12px">${s.agree} of ${s.active} active agents agree · rank #${s.rank} of ${S.stocks.length}</div>
    <div class="levels num">
      <div><span>Price</span>${fmt(s.close)}</div>
      <div><span>Stop</span>${fmt(s.stop)}</div>
      <div><span>Target</span>${fmt(s.target)}</div>
      <div><span>Risk</span>${fmt(s.riskPct, 1)}%</div>
    </div>
    <p class="why">Driven by: ${s.top.map(esc).join(', ')}</p>
  </a>`;
}

function row(s, right = '') {
  return `<a class="row" href="#/t/${esc(s.sym)}">
    <span class="sym">${esc(s.sym)}</span>
    <span class="name">${esc(s.name)}</span>
    <span class="r num ${updown(s.chg1d)}">${pct(s.chg1d)}</span>
    <span class="r">${right || chip(s.rating)}</span>
  </a>`;
}

function marketRead() {
  const m = S.market;
  const spy = m.spy || {};
  const trend = spy.above200 ? (spy.above50 ? 'SPY is above both its 50- and 200-day averages — the primary trend is up.'
    : 'SPY is above its 200-day but below its 50-day average — an uptrend that is pulling back.')
    : (spy.above50 ? 'SPY is below its 200-day but back above its 50-day average — trying to repair.'
      : 'SPY is below both its 50- and 200-day averages — the trend is down; be selective with longs.');
  const breadth = m.above50 >= 60 ? `Breadth is healthy: ${m.above50}% of stocks are above their 50-day average.`
    : m.above50 <= 40 ? `Breadth is weak: only ${m.above50}% of stocks are above their 50-day average.`
      : `Breadth is mixed: ${m.above50}% of stocks are above their 50-day average.`;
  const lead = S.sectors[0];
  const lag = S.sectors[S.sectors.length - 1];
  return `${trend} ${breadth} Strongest sector by agent score: <b>${esc(lead.sector)}</b>; weakest: <b>${esc(lag.sector)}</b>.`;
}

function heatColor(score) {
  // 0..100 -> red..neutral..green
  const t = Math.max(-1, Math.min(1, (score - 50) / 30));
  return t >= 0 ? `rgba(52,211,153,${0.08 + t * 0.42})` : `rgba(248,113,113,${0.08 - t * 0.42})`;
}

// ------------------------------------------------------------------ views
function viewToday() {
  const m = S.market;
  const spy = m.spy || {};
  const top = S.stocks.filter((s) => s.rating === 'Strong Buy').sort((a, b) => b.score - a.score).slice(0, 4);
  const changes = S.stocks.filter((s) => s.prevRating && fam(s.prevRating) !== fam(s.rating))
    .sort((a, b) => b.score - a.score);
  const watch = store.get('watch', []).map((x) => S.bySym[x]).filter(Boolean);
  const earn = S.stocks.filter((s) => s.earningsDays != null && s.earningsDays >= 0 && s.earningsDays <= 5)
    .sort((a, b) => a.earningsDays - b.earningsDays);

  view.innerHTML = `
    <h1>Market today</h1>
    <p class="sub">Daily close ${esc(S.asOf)} · each stock is rated against the rest of the S&amp;P 500</p>
    <div class="grid g4">
      <a class="card stat" href="#/t/SPY"><div class="k">S&amp;P 500 (SPY)</div><div class="v num">${fmt(spy.close)}</div><div class="s num ${updown(spy.chg1d)}">${pct(spy.chg1d)} today · ${pct(spy.chg5d)} 5d</div></a>
      <div class="card stat"><div class="k">Above 50-day avg</div><div class="v num">${m.above50}%</div><div class="s">short-term breadth</div></div>
      <div class="card stat"><div class="k">Above 200-day avg</div><div class="v num">${m.above200}%</div><div class="s">long-term breadth</div></div>
      <div class="card stat"><div class="k">Advancers / decliners</div><div class="v num"><span class="up">${m.up}</span> / <span class="down">${m.down}</span></div><div class="s">today</div></div>
    </div>
    <div class="card section" style="font-size:14px">${marketRead()}</div>

    <div class="section"><h2>Sectors by agent score</h2>
      <div class="heat">${S.sectors.map((s) => `<div style="background:${heatColor(s.score)}"><b>${esc(s.sector)}</b><span class="num">${s.score}</span> <span class="muted num" style="font-size:12px">${pct(s.chg1d)} · ${pct(s.chg5d)} 5d</span></div>`).join('')}</div>
    </div>

    <div class="section"><h2>Top swing setups</h2>
      <div class="setups">${top.map(setupCard).join('') || '<p class="empty">No Strong Buy setups today.</p>'}</div>
      <p style="margin:10px 0 0"><a href="#/best" style="color:var(--accent)">See all setups →</a></p>
    </div>

    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
      <div class="card"><h2>Your watchlist</h2>
        <div class="rows">${watch.map((s) => row(s)).join('') || '<p class="empty">Tap ☆ on any chart to add stocks here.</p>'}</div></div>
      <div class="card"><h2>Rating changes today</h2>
        <div class="rows">${changes.slice(0, 12).map((s) => row(s, `<span class="muted" style="font-size:12px">${esc(s.prevRating)} →</span> ${chip(s.rating)}`)).join('') || '<p class="empty">No rating changes today.</p>'}</div></div>
      <div class="card"><h2>Earnings in the next 5 days</h2>
        <div class="rows">${earn.slice(0, 15).map((s) => row(s, `<span class="chip warn">${s.earningsDays === 0 ? 'today' : s.earningsDays + 'd'}</span>`)).join('') || '<p class="empty">None found.</p>'}</div></div>
    </div>
    ${disclaimer()}`;
}

function viewBest() {
  const tab = store.get('bestTab', 'long');
  const lists = {
    long: S.stocks.filter((s) => fam(s.rating) === 'buy').sort((a, b) => b.score - a.score),
    fresh: S.stocks.filter((s) => fam(s.rating) === 'buy' && fam(s.prevRating) !== 'buy').sort((a, b) => b.score - a.score),
    clean: S.stocks.filter((s) => fam(s.rating) === 'buy' && !(s.earningsDays != null && s.earningsDays <= 10)).sort((a, b) => b.score - a.score),
    avoid: S.stocks.filter((s) => fam(s.rating) === 'sell').sort((a, b) => a.score - b.score),
  };
  const labels = { long: 'Long setups', fresh: 'New today', clean: 'No earnings soon', avoid: 'Weakest / avoid' };
  view.innerHTML = `
    <h1>Best trades</h1>
    <p class="sub">Ranked by agent score. Stop = recent swing low (max 3 ATR); target = 2× the risk.</p>
    <div class="tabs">${Object.keys(lists).map((k) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${labels[k]} <span class="muted">${lists[k].length}</span></button>`).join('')}</div>
    <div class="setups">${lists[tab].slice(0, 40).map(setupCard).join('') || '<p class="empty">Nothing here today.</p>'}</div>
    ${disclaimer()}`;
  view.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { store.set('bestTab', b.dataset.tab); viewBest(); }));
}

const scr = { q: '', sector: '', rating: '', sort: 'score', dir: -1 };
function viewScreener() {
  const sectors = [...new Set(S.stocks.map((s) => s.sector))].sort();
  view.innerHTML = `
    <h1>Screener</h1>
    <p class="sub">All ${S.stocks.length} S&amp;P 500 stocks. Tap a column to sort.</p>
    <div class="filters">
      <input id="fq" type="search" placeholder="Filter by ticker or name" value="${esc(scr.q)}">
      <select id="fs"><option value="">All sectors</option>${sectors.map((s) => `<option ${s === scr.sector ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select id="fr"><option value="">All ratings</option>${Object.keys(RCLASS).map((r) => `<option ${r === scr.rating ? 'selected' : ''}>${r}</option>`).join('')}</select>
    </div>
    <div class="card" style="padding:4px 8px;overflow-x:auto"><table>
      <thead><tr>
        <th data-k="sym">Ticker</th><th class="hide-sm" data-k="name">Name</th><th class="hide-sm" data-k="sector">Sector</th>
        <th class="n" data-k="close">Price</th><th class="n" data-k="chg1d">1D</th><th class="n hide-sm" data-k="chg20d">1M</th>
        <th class="n" data-k="score">Score</th><th data-k="rating">Rating</th>
        <th class="n hide-sm" data-k="rs63">vs SPY 3M</th><th class="n hide-sm" data-k="rsi">RSI</th><th class="n hide-sm" data-k="earningsDays">Earnings</th>
      </tr></thead><tbody id="tb"></tbody></table></div>
    ${disclaimer()}`;
  const draw = () => {
    const q = scr.q.toLowerCase();
    const rows = S.stocks.filter((s) => (!q || s.sym.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      && (!scr.sector || s.sector === scr.sector) && (!scr.rating || s.rating === scr.rating));
    rows.sort((a, b) => {
      let x = a[scr.sort]; let y = b[scr.sort];
      if (x == null) return 1; if (y == null) return -1;
      if (typeof x === 'string') return x.localeCompare(y) * scr.dir;
      return (x - y) * scr.dir;
    });
    document.getElementById('tb').innerHTML = rows.map((s) => `<tr data-sym="${esc(s.sym)}">
      <td><b>${esc(s.sym)}</b></td><td class="hide-sm" style="max-width:220px;overflow:hidden;text-overflow:ellipsis">${esc(s.name)}</td><td class="hide-sm muted">${esc(s.sector)}</td>
      <td class="n">${fmt(s.close)}</td><td class="n ${updown(s.chg1d)}">${pct(s.chg1d, 1)}</td><td class="n hide-sm ${updown(s.chg20d)}">${pct(s.chg20d, 1)}</td>
      <td class="n" style="color:${famColor(s.rating)}">${s.score}</td><td>${chip(s.rating)}</td>
      <td class="n hide-sm ${updown(s.rs63)}">${pct(s.rs63, 1)}</td><td class="n hide-sm">${s.rsi ?? '—'}</td>
      <td class="n hide-sm">${s.earningsDays != null && s.earningsDays >= 0 ? s.earningsDays + 'd' : '—'}</td></tr>`).join('');
  };
  draw();
  document.getElementById('fq').addEventListener('input', (e) => { scr.q = e.target.value; draw(); });
  document.getElementById('fs').addEventListener('change', (e) => { scr.sector = e.target.value; draw(); });
  document.getElementById('fr').addEventListener('change', (e) => { scr.rating = e.target.value; draw(); });
  view.querySelectorAll('th[data-k]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k;
    scr.dir = scr.sort === k ? -scr.dir : (['sym', 'name', 'sector', 'rating', 'earningsDays'].includes(k) ? 1 : -1);
    scr.sort = k; draw();
  }));
  document.getElementById('tb').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-sym]');
    if (tr) location.hash = `#/t/${tr.dataset.sym}`;
  });
}

function viewRecord() {
  const h = store.get('recH', '20');
  const stats = S.track[h] || [];
  const max = Math.max(0.5, ...stats.map((s) => Math.abs(s.avgExcess)));
  const best = stats.find((s) => s.rating === 'Strong Buy');
  const worst = stats.find((s) => s.rating === 'Strong Sell');
  const edge = best && worst ? best.avgExcess - worst.avgExcess : 0;
  const verdict = edge > 0.5 ? `Over the last year, Strong Buys beat Strong Sells by <b>${edge.toFixed(2)} points</b> over ${h} sessions — the ratings have had some edge.`
    : edge < -0.5 ? `Over the last year, Strong Buys <b>trailed</b> Strong Sells by <b>${Math.abs(edge).toFixed(2)} points</b> over ${h} sessions. These trend rules have <b>not</b> had an edge recently — lagging stocks bounced more than leaders kept running. Treat ratings as a way to find and organize ideas, not as a signal to trade blindly.`
      : `Over the last year, the ratings showed <b>no meaningful edge</b> over ${h} sessions. Use them to find and organize ideas, not as a signal on their own.`;
  view.innerHTML = `
    <h1>Track record</h1>
    <p class="sub">What happened after each day's rating over the past year: average return vs SPY, and how often the stock beat SPY. Recomputed every night.</p>
    <div class="tabs">${['5', '10', '20'].map((k) => `<button data-h="${k}" class="${k === h ? 'on' : ''}">${k} sessions later</button>`).join('')}</div>
    <div class="card" style="font-size:14px;margin-bottom:12px">${verdict}</div>
    <div class="card"><table>
      <thead><tr><th>Rating</th><th class="n">Avg vs SPY</th><th></th><th class="n">Beat SPY</th><th class="n hide-sm">Samples</th></tr></thead>
      <tbody>${stats.map((s) => `<tr><td>${chip(s.rating)}</td><td class="n ${updown(s.avgExcess)}">${pct(s.avgExcess)}</td>
        <td style="width:40%"><div class="vote"><i style="${s.avgExcess >= 0 ? `left:50%;width:${(s.avgExcess / max) * 50}%;background:var(--bull)` : `left:${50 + (s.avgExcess / max) * 50}%;width:${(-s.avgExcess / max) * 50}%;background:var(--bear)`}"></i></div></td>
        <td class="n">${fmt(s.beatRate, 1)}%</td><td class="n hide-sm muted">${s.n.toLocaleString()}</td></tr>`).join('')}</tbody></table></div>
    <p class="sub" style="margin-top:12px">Samples overlap (each stock is counted every day), so these are rough estimates, not precise statistics. One year is a short window — this will get more meaningful as history builds up.</p>
    ${disclaimer()}`;
  view.querySelectorAll('[data-h]').forEach((b) => b.addEventListener('click', () => { store.set('recH', b.dataset.h); viewRecord(); }));
}

// ------------------------------------------------------------- chart page
const PIN_TYPES = {
  signal: { label: 'Signals', color: COLORS.accent },
  rating: { label: 'Rating changes', color: '#60a5fa' },
  news: { label: 'News', color: COLORS.news },
  earnings: { label: 'Earnings', color: COLORS.earnings },
};

function timeStr(t) {
  if (typeof t === 'string') return t;
  if (typeof t === 'number') return new Date(t * 1000).toISOString().slice(0, 10);
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
}

function marker(p, time) {
  const tone = COLORS[p.tone] || COLORS.neutral;
  switch (p.type) {
    case 'signal': return { time, position: p.tone === 'bear' ? 'aboveBar' : 'belowBar', color: tone, shape: p.tone === 'bear' ? 'arrowDown' : 'arrowUp' };
    case 'rating': return { time, position: p.tone === 'bear' ? 'aboveBar' : 'belowBar', color: p.tone === 'neutral' ? '#60a5fa' : tone, shape: 'square', text: p.title.split('-> ')[1]?.[0] || 'R' };
    case 'earnings': return { time, position: 'belowBar', color: COLORS.earnings, shape: 'circle', text: 'E' };
    default: return { time, position: 'aboveBar', color: COLORS.news, shape: 'circle' };
  }
}

function pinCard(p) {
  const t = PIN_TYPES[p.type] || PIN_TYPES.news;
  return `<div class="card pin-card" style="border-left-color:${p.type === 'news' ? COLORS.news : COLORS[p.tone] || t.color}">
    <div class="meta"><span>${esc(p.date)}</span><span class="tag">${esc(t.label)}</span>
      <span class="tag ${p.kind}">${p.kind === 'fact' ? 'Reported' : 'Computed signal'}</span>${p.source ? `<span>${esc(p.source)}</span>` : ''}</div>
    <h3>${esc(p.title)}</h3>${p.body ? `<p>${esc(p.body)}</p>` : ''}
    ${p.url ? `<p style="margin-top:6px"><a class="src" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Read source ↗</a></p>` : ''}
  </div>`;
}

function ratingPanel(T, s) {
  const L = T.latest;
  const color = famColor(L.rating);
  const circ = 2 * Math.PI * 36;
  const groups = [...new Set(L.agents.map((a) => a.group))];
  const p = L.plan;
  const earn = L.earningsDays != null && L.earningsDays >= 0 && L.earningsDays <= 10
    ? `<div class="alert warn">Earnings in ${L.earningsDays === 0 ? 'less than a day' : L.earningsDays + ' trading days'} (${esc(L.nextEarnings)}). Holding through earnings risks an overnight gap past your stop.</div>` : '';
  return `<div class="card">
    <h2>Agent rating</h2>
    <div class="rating-big">
      <div class="gauge"><svg width="84" height="84" viewBox="0 0 84 84"><circle cx="42" cy="42" r="36" fill="none" stroke="var(--panel-2)" stroke-width="8"/>
        <circle cx="42" cy="42" r="36" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(L.score / 100) * circ} ${circ}"/></svg>
        <div class="val">${L.score}</div></div>
      <div><div class="label" style="color:${color}">${esc(L.rating)}</div>
        <div class="muted" style="font-size:13px">${L.rank ? `Rank #${L.rank} of ${S.stocks.length} · ` : ''}${L.agree} of ${L.active} active agents agree</div></div>
    </div>
    ${earn}
    <h2 style="margin-top:16px">Swing plan <span class="muted" style="text-transform:none;letter-spacing:0">(${esc(p.side)})</span></h2>
    <div class="plan"><div><span>Entry</span><b>${fmt(p.entry)}</b></div><div><span>Stop</span><b class="down">${fmt(p.stop)}</b></div><div><span>Target</span><b class="up">${fmt(p.target)}</b></div></div>
    <div class="muted" style="font-size:12px;margin-top:6px">Risk ${fmt(p.riskPct, 1)}% per share · 2:1 reward-to-risk · ATR ${fmt(p.atr)}</div>
    <div class="sizer">
      <label>Account size ($)<input id="acct" inputmode="decimal" value="${store.get('acct', 10000)}"></label>
      <label>Risk per trade (%)<input id="riskp" inputmode="decimal" value="${store.get('riskp', 1)}"></label>
      <div class="out" id="sizeout"></div>
    </div>
    <h2 style="margin-top:18px">How the agents voted</h2>
    <div class="agents">${groups.map((g) => `<div class="group-h">${esc(g)}</div>${L.agents.filter((a) => a.group === g).map((a) => {
      const v = a.vote;
      const bar = v >= 0 ? `left:50%;width:${v * 50}%;background:var(--bull)` : `left:${50 + v * 50}%;width:${-v * 50}%;background:var(--bear)`;
      const lab = v >= 0.25 ? '<span class="up">Bullish</span>' : v <= -0.25 ? '<span class="down">Bearish</span>' : '<span class="muted">Neutral</span>';
      return `<div class="agent"><div class="top"><span>${esc(a.name)}</span><span style="font-size:13px">${lab} <span class="num muted">${v > 0 ? '+' : ''}${v.toFixed(2)}</span></span></div>
        <div class="w">${esc(a.why)}</div><div class="vote"><i style="${bar}"></i></div></div>`;
    }).join('')}`).join('')}</div>
  </div>`;
}

async function viewTicker(symRaw) {
  const sym = decodeURIComponent(symRaw).toUpperCase();
  view.innerHTML = '<div class="loading">Loading chart…</div>';
  let T;
  try { T = await loadTicker(sym); } catch {
    view.innerHTML = `<h1>${esc(sym)}</h1><p class="sub">Not in the S&amp;P 500 data set.</p>`;
    return;
  }
  if (!location.hash.toUpperCase().includes(sym)) return; // navigated away while loading
  const s = S.bySym[sym] || {};
  const watch = store.get('watch', []);
  const enabled = store.get('pinTypes', { signal: true, rating: true, news: true, earnings: true });

  view.innerHTML = `
    <div class="tick-head">
      <span class="sym">${esc(sym)}</span><span class="px">${fmt(s.close)}</span>
      <span class="num ${updown(s.chg1d)}">${pct(s.chg1d)}</span>${chip(T.latest.rating)}
      <button class="star ${watch.includes(sym) ? 'on' : ''}" id="star" aria-label="Toggle watchlist">${watch.includes(sym) ? '★ Watching' : '☆ Watch'}</button>
      <span class="muted" style="width:100%;font-size:13px">${esc(T.name)} · ${esc(T.industry)}</span>
    </div>
    <div class="cols">
      <div>
        <div class="card" style="padding:8px">
          <div class="chart-wrap"><div class="legend" id="legend"></div><div id="chart"></div></div>
          <div class="score-label">Agent score history (above 50 = more bullish votes)</div>
          <div id="scorechart"></div>
        </div>
        <div class="pin-toggles">${Object.entries(PIN_TYPES).map(([k, v]) => `<button class="toggle ${enabled[k] ? 'on' : ''}" data-pt="${k}"><i style="background:${v.color}"></i>${v.label}</button>`).join('')}</div>
        <div id="pincard"><p class="muted" style="font-size:13px;margin:0">Tap a marker on the chart, or an item below, to see what happened.</p></div>
        <div class="section"><h2>Timeline</h2><div class="card timeline" id="timeline"></div></div>
      </div>
      <div>${ratingPanel(T, s)}</div>
    </div>
    ${disclaimer()}`;

  // --- watchlist + sizer
  document.getElementById('star').addEventListener('click', (e) => {
    const w = store.get('watch', []);
    const i = w.indexOf(sym);
    if (i >= 0) w.splice(i, 1); else w.push(sym);
    store.set('watch', w);
    e.currentTarget.classList.toggle('on', i < 0);
    e.currentTarget.textContent = i < 0 ? '★ Watching' : '☆ Watch';
  });
  const sizeOut = () => {
    const acct = parseFloat(document.getElementById('acct').value) || 0;
    const rp = parseFloat(document.getElementById('riskp').value) || 0;
    store.set('acct', acct); store.set('riskp', rp);
    const p = T.latest.plan;
    const perShare = Math.abs(p.entry - p.stop);
    const shares = perShare > 0 ? Math.floor((acct * rp / 100) / perShare) : 0;
    document.getElementById('sizeout').innerHTML = `Size: <b class="num">${shares.toLocaleString()} shares</b> (≈ $${fmt(shares * p.entry, 0)}) · max loss ≈ $${fmt(shares * perShare, 0)}`;
  };
  document.getElementById('acct').addEventListener('input', sizeOut);
  document.getElementById('riskp').addEventListener('input', sizeOut);
  sizeOut();

  if (!LC) { document.getElementById('chart').innerHTML = '<p class="empty">Chart library failed to load (offline?).</p>'; return; }

  // --- main chart
  const base = {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#8b98a8', fontFamily: 'system-ui, sans-serif' },
    grid: { vertLines: { color: 'rgba(39,49,64,.45)' }, horzLines: { color: 'rgba(39,49,64,.45)' } },
    rightPriceScale: { borderColor: '#273140', minimumWidth: 64 },
    timeScale: { borderColor: '#273140', rightOffset: 3 },
    crosshair: { mode: LC.CrosshairMode.Normal },
    // let the page scroll vertically on phones; horizontal drag pans the chart
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
  };
  const bars = T.bars;
  const dates = bars.map((b) => b[0]);
  const idxOf = new Map(dates.map((d, k) => [d, k]));
  const chart = LC.createChart(document.getElementById('chart'), base);
  disposers.push(() => chart.remove());
  const candles = chart.addCandlestickSeries({ upColor: COLORS.bull, downColor: COLORS.bear, borderVisible: false, wickUpColor: COLORS.bull, wickDownColor: COLORS.bear });
  candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
  candles.setData(bars.map((b) => ({ time: b[0], open: b[1], high: b[2], low: b[3], close: b[4] })));
  const vol = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  vol.setData(bars.map((b, k) => ({ time: b[0], value: b[5], color: k && b[4] < bars[k - 1][4] ? 'rgba(248,113,113,.35)' : 'rgba(52,211,153,.35)' })));
  const line = (arr, color) => {
    const ser = chart.addLineSeries({ color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    ser.setData(arr.map((v, k) => (v == null ? { time: dates[k] } : { time: dates[k], value: v })));
  };
  line(T.sma50, '#60a5fa');
  line(T.sma200, '#fbbf24');
  const p = T.latest.plan;
  candles.createPriceLine({ price: p.stop, color: COLORS.bear, lineWidth: 1, lineStyle: LC.LineStyle.Dashed, axisLabelVisible: true, title: 'stop' });
  candles.createPriceLine({ price: p.target, color: COLORS.bull, lineWidth: 1, lineStyle: LC.LineStyle.Dashed, axisLabelVisible: true, title: 'target' });

  // --- score chart (synced)
  const sc = LC.createChart(document.getElementById('scorechart'), { ...base, layout: { ...base.layout, attributionLogo: false }, rightPriceScale: { ...base.rightPriceScale, scaleMargins: { top: 0.1, bottom: 0.1 } }, timeScale: { ...base.timeScale, visible: false }, handleScroll: false, handleScale: false });
  disposers.push(() => sc.remove());
  const scoreSer = sc.addBaselineSeries({ baseValue: { type: 'price', price: 50 }, topLineColor: COLORS.bull, topFillColor1: 'rgba(52,211,153,.25)', topFillColor2: 'rgba(52,211,153,.02)', bottomLineColor: COLORS.bear, bottomFillColor1: 'rgba(248,113,113,.02)', bottomFillColor2: 'rgba(248,113,113,.25)', lineWidth: 2, priceLineVisible: false });
  scoreSer.setData(T.score.map((v, k) => (v == null ? { time: dates[k] } : { time: dates[k], value: v })));
  chart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r) sc.timeScale().setVisibleLogicalRange(r); });
  const n = bars.length;
  chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 130), to: n + 2 });

  // --- legend
  const legend = document.getElementById('legend');
  const showLegend = (k) => {
    const b = bars[k];
    if (!b) return;
    legend.innerHTML = `${b[0]} O ${fmt(b[1])} H ${fmt(b[2])} L ${fmt(b[3])} C <span style="color:var(--text)">${fmt(b[4])}</span> · score ${T.score[k] ?? '—'} · <span style="color:#60a5fa">50d</span> <span style="color:#fbbf24">200d</span>`;
  };
  showLegend(n - 1);
  chart.subscribeCrosshairMove((param) => {
    const k = param.time ? idxOf.get(timeStr(param.time)) : undefined;
    showLegend(k ?? n - 1);
  });

  // --- pins
  const snap = (d) => {
    if (idxOf.has(d)) return idxOf.get(d);
    let lo = 0; let hi = n - 1;
    if (d > dates[hi]) return hi;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (dates[mid] < d) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const pins = T.pins.map((pin) => ({ ...pin, idx: snap(pin.date) }));
  const pinCardEl = document.getElementById('pincard');
  const showPins = (list) => { pinCardEl.innerHTML = list.map(pinCard).join(''); };
  const focus = (idx) => {
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, idx - 70), to: Math.min(n + 2, idx + 30) });
  };
  const drawPins = () => {
    const vis = pins.filter((pin) => enabled[pin.type]);
    candles.setMarkers(vis.map((pin) => marker(pin, dates[pin.idx])).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)));
    const tl = document.getElementById('timeline');
    tl.innerHTML = vis.slice().reverse().map((pin, k) => `<div class="tl-item" data-k="${vis.length - 1 - k}">
      <span class="dot" style="background:${pin.type === 'news' ? COLORS.news : pin.type === 'earnings' ? COLORS.earnings : COLORS[pin.tone] || COLORS.neutral}"></span>
      <div><div class="t">${esc(pin.title)}</div><div class="d">${esc(pin.date)} · ${esc(PIN_TYPES[pin.type]?.label || '')}${pin.source ? ' · ' + esc(pin.source) : ''}</div></div></div>`).join('') || '<p class="empty">No events for the selected types.</p>';
    tl.onclick = (e) => {
      const it = e.target.closest('.tl-item');
      if (!it) return;
      const pin = vis[+it.dataset.k];
      showPins([pin]);
      focus(pin.idx);
      pinCardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
  };
  drawPins();
  chart.subscribeClick((param) => {
    if (!param.time) return;
    const k = idxOf.get(timeStr(param.time));
    const vis = pins.filter((pin) => enabled[pin.type]);
    let hit = vis.filter((pin) => pin.idx === k);
    if (!hit.length) hit = vis.filter((pin) => Math.abs(pin.idx - k) <= 1);
    if (hit.length) showPins(hit);
  });
  view.querySelectorAll('[data-pt]').forEach((b) => b.addEventListener('click', () => {
    enabled[b.dataset.pt] = !enabled[b.dataset.pt];
    store.set('pinTypes', enabled);
    b.classList.toggle('on', enabled[b.dataset.pt]);
    drawPins();
  }));
}

// ------------------------------------------------------------------- boot
(async function boot() {
  try {
    await loadSummary();
  } catch (e) {
    view.innerHTML = `<h1>No data yet</h1><p class="sub">Run <code>python pipeline/run.py</code> to generate data/summary.json.</p>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
