// Today-page market header (Fear & Greed + index cards) and the Fear & Greed analyzer.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 2) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (n, d = 2) => (n == null ? '—' : `${n > 0 ? '+' : ''}${Number(n).toFixed(d)}%`);
const store = {
  get(k, d) { try { const v = localStorage.getItem('tm:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tm:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

export const ZONE_COLORS = {
  'Extreme Fear': '#ef4444', Fear: '#fb923c', Neutral: '#a3a3a3', Greed: '#86efac', 'Extreme Greed': '#22c55e',
};
export const zoneColor = (label) => ZONE_COLORS[label] || '#a3a3a3';
const zoneChip = (label) => (label ? `<span class="chip" style="color:${zoneColor(label)};background:${zoneColor(label)}22">${esc(label)}</span>` : '');
const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

// ------------------------------------------------------------------ gauge
export function gauge(value, label, size = 220) {
  const cx = 110; const cy = 108; const r = 88;
  const pt = (deg, rad = r) => {
    const a = (deg * Math.PI) / 180;
    return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)];
  };
  const arc = (v0, v1, color) => {
    const [x0, y0] = pt(180 - v0 * 1.8); const [x1, y1] = pt(180 - v1 * 1.8);
    return `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="${color}" stroke-width="16" fill="none"/>`;
  };
  const bands = [[0, 24.5, 'Extreme Fear'], [25.5, 44.5, 'Fear'], [45.5, 55, 'Neutral'], [56, 75, 'Greed'], [76, 100, 'Extreme Greed']];
  const v = Math.max(0, Math.min(100, value ?? 50));
  const [nx, ny] = pt(180 - v * 1.8, r - 22);
  const ticks = [0, 25, 50, 75, 100].map((t) => {
    const [x, y] = pt(180 - t * 1.8, r + 16);
    return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--muted)">${t}</text>`;
  }).join('');
  return `<svg class="gauge-svg" viewBox="-12 0 244 130" width="${size}" role="img" aria-label="Fear and Greed ${value}, ${esc(label)}">
    ${bands.map(([a, b, l]) => arc(a, b, zoneColor(l) + (l === label ? '' : '55'))).join('')}
    ${ticks}
    <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="var(--text)" stroke-width="3" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="6" fill="var(--text)"/>
  </svg>`;
}

// -------------------------------------------------------------- sparkline
export function sparkline(values, ref, { w = 160, h = 56, color } = {}) {
  const vals = values.filter((x) => x != null);
  if (vals.length < 2) return '<div class="muted" style="height:56px">No data</div>';
  const lo = Math.min(...vals, ref ?? Infinity); const hi = Math.max(...vals, ref ?? -Infinity);
  const span = hi - lo || 1;
  const x = (i) => (i / (values.length - 1)) * w;
  const y = (v) => h - 4 - ((v - lo) / span) * (h - 8);
  const d = values.map((v, i) => (v == null ? '' : `${i && values[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)).join('');
  const last = vals[vals.length - 1];
  const c = color || ((ref != null ? last >= ref : last >= vals[0]) ? 'var(--bull)' : 'var(--bear)');
  const refLine = ref != null ? `<line x1="0" x2="${w}" y1="${y(ref).toFixed(1)}" y2="${y(ref).toFixed(1)}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 4" vector-effect="non-scaling-stroke"/>` : '';
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="spark">${refLine}
    <path d="${d}" fill="none" stroke="${c}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    <circle cx="${x(values.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="2.6" fill="${c}"/></svg>`;
}

// ------------------------------------------------------- Today: F&G cards
function fgMini(fg, title, href) {
  if (!fg) return '';
  return `<a class="card fg-mini" href="${href}">
    <div class="fg-mini-top"><span class="k">${esc(title)}</span><span class="muted" style="font-size:12px">Analyze →</span></div>
    ${gauge(fg.value, fg.label, 150)}
    <div class="fg-mini-val"><b class="num" style="color:${zoneColor(fg.label)}">${fg.value}</b> <span>${esc(fg.label)}</span></div>
    <div class="fg-mini-cmp muted">Last week ${fg.weekAgo ?? '—'} · Last month ${fg.monthAgo ?? '—'}</div>
  </a>`;
}

export function fearGreedRow(M) {
  if (!M) return '';
  return `<div class="fg-row">${fgMini(M.fearGreed, 'Fear & Greed · Stocks', '#/fear')}${fgMini(M.cryptoFearGreed, 'Fear & Greed · Crypto', '#/fear/crypto')}</div>`;
}

// ----------------------------------------------------- Today: index cards
const RANGES = { '1D': 0, '1M': 21, '3M': 63, '1Y': 252, '5Y': 1260 };
function cardSeries(card, range) {
  if (range === '1D' && card.intraday && card.intraday.points.length > 1) {
    const vals = card.intraday.points.map((p) => p[1]);
    return { vals, ref: card.intraday.ref, last: vals[vals.length - 1] };
  }
  const n = RANGES[range] || 21;
  const pts = card.daily.slice(-(n + 1));
  const vals = pts.map((p) => p[1]);
  return { vals, ref: vals[0], last: vals[vals.length - 1] };
}

export function marketCards(M) {
  if (!M) return '';
  const range = store.get('cardRange', '1D');
  return `<div class="section">
    <div class="sec-head"><h2>Market</h2>
      <div class="tabs mini" id="rangeTabs">${Object.keys(RANGES).map((r) => `<button data-r="${r}" class="${r === range ? 'on' : ''}">${r}</button>`).join('')}</div></div>
    <div class="mcards">${M.cards.map((c) => {
      const s = cardSeries(c, range);
      const chg = s.ref ? (s.last / s.ref - 1) * 100 : null;
      const up = chg >= 0;
      const href = c.sym === '^GSPC' ? '#/t/SPY' : '';
      return `<${href ? `a href="${href}"` : 'div'} class="card mcard">
        <div class="mcard-t">${esc(c.label)}</div>
        ${sparkline(s.vals, s.ref)}
        <div class="mcard-v num">${c.sym === 'BTC-USD' ? '$' : ''}${fmt(s.last)}</div>
        <div class="num ${up ? 'up' : 'down'}" style="font-size:14px">${up ? '▲' : '▼'} ${Math.abs(chg ?? 0).toFixed(2)}% <span class="muted" style="font-size:12px">${range === '1D' ? (c.sym === 'BTC-USD' ? '24h' : 'today') : range}</span></div>
      </${href ? 'a' : 'div'}>`;
    }).join('')}</div>
  </div>`;
}

export function statPills(M, stocks) {
  if (!M) return '';
  const pills = M.stats.filter((s) => !['^GSPC', '^NDX', 'BTC-USD'].includes(s.sym)).map((s) => {
    const up = (s.chgPct ?? 0) >= 0;
    const val = s.kind === 'yield' ? `${fmt(s.value)}%` : fmt(s.value);
    const chg = s.kind === 'yield' ? `${s.chgBp > 0 ? '+' : ''}${s.chgBp} bp` : `${Math.abs(s.chgPct).toFixed(2)}%`;
    return `<span class="pill"><b>${esc(s.label)}</b> <span class="num">${val}</span> <span class="num ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${chg.replace('-', '')}</span></span>`;
  }).join('');
  const movers = stocks.slice().sort((a, b) => Math.abs(b.chg1d || 0) - Math.abs(a.chg1d || 0)).slice(0, 10)
    .map((s) => `<a class="pill" href="#/t/${esc(s.sym)}"><b>${esc(s.sym)}</b> <span class="num ${s.chg1d >= 0 ? 'up' : 'down'}">${s.chg1d >= 0 ? '▲' : '▼'} ${Math.abs(s.chg1d).toFixed(2)}%</span></a>`).join('');
  return `<div class="section"><h2>Broad market</h2><div class="pills">${pills}</div></div>
    <div class="section"><h2>Top movers · S&amp;P 500</h2><div class="pills">${movers}</div></div>`;
}

export function bindMarketCards(rerender) {
  document.querySelectorAll('#rangeTabs [data-r]').forEach((b) => b.addEventListener('click', () => {
    store.set('cardRange', b.dataset.r); rerender();
  }));
}

// --------------------------------------------------------- F&G analyzer
function analysis(fg, isCrypto) {
  const lines = [];
  const z = fg.label;
  const dir = (a, b) => (a == null ? '' : b > a + 4 ? 'up from' : b < a - 4 ? 'down from' : 'about the same as');
  lines.push(`Sentiment is <b style="color:${zoneColor(z)}">${esc(z)}</b> at <b>${fg.value}</b>, ${dir(fg.weekAgo, fg.value)} ${fg.weekAgo} a week ago and ${dir(fg.monthAgo, fg.value)} ${fg.monthAgo} a month ago. It has been in ${esc(z)} for ${fg.streakDays} ${isCrypto ? 'day' : 'session'}${fg.streakDays === 1 ? '' : 's'}, and today's reading is lower than ${100 - fg.percentile}% of all readings since ${fmtDate(fg.since)}.`);
  if (fg.components) {
    const sorted = fg.components.slice().sort((a, b) => a.score - b.score);
    const lo = sorted[0]; const hi = sorted[sorted.length - 1];
    lines.push(`Most fearful gauge: <b>${esc(lo.name)}</b> (${lo.score}). Most greedy: <b>${esc(hi.name)}</b> (${hi.score}).${hi.score - lo.score >= 50 ? ' The gauges strongly disagree, so treat the overall reading as a mixed signal rather than a clear one.' : ''}`);
  }
  const o = fg.outcomes;
  const zr = o.zones.find((r) => r.zone === z);
  const h = o.horizons[1];
  if (zr && zr[`n${h}`] >= 20) {
    const asset = isCrypto ? 'Bitcoin' : 'the S&P 500';
    const better = zr[`avg${h}`] > o.allDays[`avg${h}`];
    lines.push(`History: after past <b>${esc(z)}</b> readings (${zr.days} days), ${asset} moved <b>${pct(zr[`avg${h}`])}</b> on average over the next ${h} ${isCrypto ? 'days' : 'sessions'} and was higher ${zr[`up${h}`]}% of the time, vs ${pct(o.allDays[`avg${h}`])} and ${o.allDays[`up${h}`]}% across all days — ${better ? 'better than usual. Fear has often been a better time to buy than to sell.' : 'no better than usual.'}`);
  }
  return lines.map((l) => `<p>${l}</p>`).join('');
}

function outcomesTable(fg, isCrypto) {
  const o = fg.outcomes;
  const unit = isCrypto ? 'd' : '';
  const cell = (r, h) => (r[`n${h}`] ? `<td class="n ${r[`avg${h}`] >= 0 ? 'up' : 'down'}">${pct(r[`avg${h}`], 1)}<div class="muted" style="font-size:11px">${r[`up${h}`]}% up</div></td>` : '<td class="n muted">—</td>');
  return `<div class="card" style="overflow-x:auto"><table>
    <thead><tr><th>After a reading of…</th>${o.horizons.map((h) => `<th class="n">${h}${unit || ' sess'} later</th>`).join('')}<th class="n hide-sm">Days</th></tr></thead>
    <tbody>${o.zones.map((r) => `<tr style="${r.zone === fg.label ? 'background:var(--panel-2)' : ''}"><td>${zoneChip(r.zone)}${r.zone === fg.label ? ' <span class="muted" style="font-size:12px">← now</span>' : ''}</td>${o.horizons.map((h) => cell(r, h)).join('')}<td class="n hide-sm muted">${r.days}</td></tr>`).join('')}
    <tr><td class="muted">All days</td>${o.horizons.map((h) => `<td class="n">${pct(o.allDays[`avg${h}`], 1)}<div class="muted" style="font-size:11px">${o.allDays[`up${h}`]}% up</div></td>`).join('')}<td class="hide-sm"></td></tr>
    </tbody></table></div>
    <p class="sub" style="margin-top:8px">Average ${isCrypto ? 'Bitcoin' : 'S&amp;P 500'} change after each day in that zone, and how often it was higher. Overlapping samples from a few years of history — a guide to context, not a prediction.</p>`;
}

export function viewFear(view, M, LC, mode, disposers) {
  const isCrypto = mode === 'crypto';
  const fg = isCrypto ? M.cryptoFearGreed : M.fearGreed;
  if (!fg) { view.innerHTML = '<h1>Fear &amp; Greed</h1><p class="sub">Not available today.</p>'; return; }
  const cmp = [['Previous close', fg.prevClose], ['1 week ago', fg.weekAgo], ['1 month ago', fg.monthAgo], ['1 year ago', fg.yearAgo]];
  const range = store.get('fgRange', '1Y');
  view.innerHTML = `
    <h1>Fear &amp; Greed analyzer</h1>
    <p class="sub">${isCrypto ? 'Crypto sentiment from alternative.me (volatility, momentum, social media, dominance, search trends).' : 'Our CNN-style stock index: six market gauges, each scored 0–100 against its own past year, then averaged. Updated after each close.'}</p>
    <div class="tabs"><a href="#/fear" class="tabbtn ${isCrypto ? '' : 'on'}">Stocks</a><a href="#/fear/crypto" class="tabbtn ${isCrypto ? 'on' : ''}">Crypto</a></div>
    <div class="fg-hero card">
      <div class="fg-hero-g">${gauge(fg.value, fg.label, 280)}
        <div class="fg-hero-v"><b class="num" style="color:${zoneColor(fg.label)}">${fg.value}</b><span>${esc(fg.label)}</span></div></div>
      <div class="fg-cmp">${cmp.map(([k, v]) => `<div><span class="muted">${k}</span><b class="num">${v ?? '—'}</b>${zoneChip(v == null ? null : labelFor(v))}</div>`).join('')}</div>
    </div>
    <div class="card section fg-analysis">${analysis(fg, isCrypto)}</div>
    <div class="section"><div class="sec-head"><h2>History vs ${isCrypto ? 'Bitcoin' : 'S&amp;P 500'}</h2>
      <div class="tabs mini" id="fgRange">${['6M', '1Y', '3Y'].map((r) => `<button data-r="${r}" class="${r === range ? 'on' : ''}">${r}</button>`).join('')}</div></div>
      <div class="card" style="padding:8px"><div id="fgchart" style="height:300px"></div>
      <div class="muted" style="font-size:12px;margin:6px 4px 0">Colored line = Fear &amp; Greed (right axis, 0–100). Gray line = ${isCrypto ? 'Bitcoin' : 'S&amp;P 500'} (left axis).</div></div></div>
    ${fg.components ? `<div class="section"><h2>The six gauges</h2><div class="fg-comps">${fg.components.map((c) => `
      <div class="card fg-comp">
        <div class="fg-comp-top"><b>${esc(c.name)}</b>${zoneChip(c.label)}</div>
        <div class="fg-comp-score"><span class="num" style="color:${zoneColor(c.label)}">${c.score}</span>
          <div class="fg-bar"><i style="left:${c.score}%"></i></div></div>
        <div style="font-size:13px">${esc(c.reading)}</div>
        ${sparkline(c.history.slice(-252), 50, { color: zoneColor(c.label), h: 44 })}
        <div class="muted" style="font-size:12px">${esc(c.why)}</div>
        <div class="muted" style="font-size:12px;margin-top:4px">1 week ago ${c.weekAgo} · 1 month ago ${c.monthAgo}</div>
      </div>`).join('')}</div></div>` : ''}
    <div class="section"><h2>What happened next, historically</h2>${outcomesTable(fg, isCrypto)}</div>
    <p class="disclaimer">Sentiment is context, not a timing signal. Educational research tool, not investment advice.</p>`;

  document.querySelectorAll('#fgRange [data-r]').forEach((b) => b.addEventListener('click', () => {
    store.set('fgRange', b.dataset.r); viewFear(view, M, LC, mode, disposers);
  }));
  if (!LC) return;
  const n = { '6M': isCrypto ? 182 : 126, '1Y': isCrypto ? 365 : 252, '3Y': 1100 }[range];
  const hist = fg.history.slice(-n);
  const px = (isCrypto ? fg.btc : fg.spx).slice(-n);
  const chart = LC.createChart(document.getElementById('fgchart'), {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#8b98a8' },
    grid: { vertLines: { color: 'rgba(39,49,64,.4)' }, horzLines: { color: 'rgba(39,49,64,.4)' } },
    rightPriceScale: { borderColor: '#273140', scaleMargins: { top: 0.05, bottom: 0.05 } },
    leftPriceScale: { visible: true, borderColor: '#273140' },
    timeScale: { borderColor: '#273140' },
    handleScroll: { vertTouchDrag: false },
  });
  disposers.push(() => chart.remove());
  const price = chart.addLineSeries({ priceScaleId: 'left', color: 'rgba(200,210,225,.55)', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
  price.setData(px.filter((p) => p[1] != null).map((p) => ({ time: p[0], value: p[1] })));
  const line = chart.addBaselineSeries({
    baseValue: { type: 'price', price: 50 }, lineWidth: 2, priceLineVisible: false,
    topLineColor: '#22c55e', topFillColor1: 'rgba(34,197,94,.18)', topFillColor2: 'rgba(34,197,94,.02)',
    bottomLineColor: '#ef4444', bottomFillColor1: 'rgba(239,68,68,.02)', bottomFillColor2: 'rgba(239,68,68,.18)',
    autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
  });
  line.setData(hist.map((p) => ({ time: p[0], value: p[1] })));
  [[25, 'Extreme Fear'], [45, 'Fear'], [55, 'Greed'], [75, 'Extreme Greed']].forEach(([p, l]) => line.createPriceLine({
    price: p, color: zoneColor(l) + '88', lineWidth: 1, lineStyle: LC.LineStyle.Dotted, axisLabelVisible: false,
  }));
  chart.timeScale().fitContent();
}

export function labelFor(v) {
  return v < 25 ? 'Extreme Fear' : v < 45 ? 'Fear' : v <= 55 ? 'Neutral' : v <= 75 ? 'Greed' : 'Extreme Greed';
}
