// Technical indicators computed in the browser from daily bars.
// Every function returns an array aligned with the input (null during warm-up).

export function sma(v, n) {
  const out = new Array(v.length).fill(null);
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i >= n) sum -= v[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(v, n) {
  const out = new Array(v.length).fill(null);
  if (v.length < n) return out;
  const k = 2 / (n + 1);
  let prev = v.slice(0, n).reduce((a, b) => a + b, 0) / n; // seed with SMA
  out[n - 1] = prev;
  for (let i = n; i < v.length; i++) { prev = v[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

export function emaOf(series, n) { // EMA over an array that may start with nulls
  const start = series.findIndex((x) => x != null);
  if (start < 0) return series.map(() => null);
  const part = ema(series.slice(start), n);
  return [...new Array(start).fill(null), ...part];
}

export function bollinger(v, n = 20, mult = 2) {
  const mid = sma(v, n);
  const up = new Array(v.length).fill(null);
  const lo = new Array(v.length).fill(null);
  for (let i = n - 1; i < v.length; i++) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (v[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / n);
    up[i] = mid[i] + mult * sd;
    lo[i] = mid[i] - mult * sd;
  }
  return { mid, up, lo };
}

export function rsi(v, n = 14) {
  const out = new Array(v.length).fill(null);
  let g = 0; let l = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    const up = Math.max(d, 0); const dn = Math.max(-d, 0);
    if (i <= n) {
      g += up; l += dn;
      if (i === n) { g /= n; l /= n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
    } else {
      g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
  }
  return out;
}

export function macd(v, fast = 12, slow = 26, sig = 9) {
  const f = ema(v, fast); const s = ema(v, slow);
  const line = v.map((_, i) => (f[i] != null && s[i] != null ? f[i] - s[i] : null));
  const signal = emaOf(line, sig);
  const hist = line.map((x, i) => (x != null && signal[i] != null ? x - signal[i] : null));
  return { line, signal, hist };
}

export function atr(bars, n = 14) {
  const tr = bars.map((b, i) => (i === 0 ? b[2] - b[3]
    : Math.max(b[2] - b[3], Math.abs(b[2] - bars[i - 1][4]), Math.abs(b[3] - bars[i - 1][4]))));
  return emaOf(tr, n);
}

// Horizontal support / resistance levels from clustered swing highs and lows.
// A level needs 2+ touches; returns up to `max` levels nearest the last price.
export function supportResistance(bars, { swing = 5, max = 10 } = {}) {
  const n = bars.length;
  if (n < swing * 4) return [];
  const last = bars[n - 1][4];
  const a = atr(bars)[n - 1] || last * 0.02;
  const tol = Math.max(a * 0.6, last * 0.008);
  const piv = [];
  for (let i = swing; i < n - swing; i++) {
    let isHi = true; let isLo = true;
    for (let j = i - swing; j <= i + swing; j++) {
      if (bars[j][2] > bars[i][2]) isHi = false;
      if (bars[j][3] < bars[i][3]) isLo = false;
    }
    if (isHi) piv.push({ p: bars[i][2], i });
    if (isLo) piv.push({ p: bars[i][3], i });
  }
  piv.sort((x, y) => x.p - y.p);
  const clusters = [];
  for (const pt of piv) {
    const c = clusters[clusters.length - 1];
    if (c && pt.p - c.lo <= tol * 2) { c.pts.push(pt); c.hi = pt.p; } else clusters.push({ lo: pt.p, hi: pt.p, pts: [pt] });
  }
  const levels = clusters
    .filter((c) => c.pts.length >= 2)
    .map((c) => {
      const recent = Math.max(...c.pts.map((p) => p.i));
      // the most recent touch's price is where traders will remember the level
      const price = c.pts.reduce((s, p) => s + p.p, 0) / c.pts.length;
      return { price, touches: c.pts.length, recent, kind: price >= last ? 'resistance' : 'support' };
    })
    .filter((l) => Math.abs(l.price / last - 1) < 0.45);
  levels.sort((x, y) => Math.abs(x.price - last) - Math.abs(y.price - last));
  return levels.slice(0, max).sort((x, y) => y.price - x.price);
}
