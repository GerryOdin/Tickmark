"""Indicators, swing-trading agents, composite score and trade plan.

Every agent is a simple, explainable rule that looks only at data up to
each day (no look-ahead), so the same code produces today's rating and
the full rating history used for the track record.
"""
import numpy as np
import pandas as pd


# ---------------------------------------------------------------- indicators
def sma(s, n):
    return s.rolling(n, min_periods=n).mean()


def ema(s, n):
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def rsi(close, n=14):
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = up / dn.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


def atr(h, l, c, n=14):
    pc = c.shift(1)
    tr = pd.concat([h - l, (h - pc).abs(), (l - pc).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def indicators(df: pd.DataFrame, spy_close: pd.Series) -> pd.DataFrame:
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"].astype(float)
    i = pd.DataFrame(index=df.index)
    i["open"], i["close"], i["high"], i["low"], i["volume"] = df["Open"], c, h, l, v
    i["sma20"], i["sma50"], i["sma200"] = sma(c, 20), sma(c, 50), sma(c, 200)
    i["ema20"] = ema(c, 20)
    i["rsi"] = rsi(c)
    i["atr"] = atr(h, l, c)
    macd = ema(c, 12) - ema(c, 26)
    i["macd_hist"] = macd - macd.ewm(span=9, adjust=False, min_periods=9).mean()

    spy = spy_close.reindex(df.index).ffill()
    i["rs63"] = (c / c.shift(63) - 1) - (spy / spy.shift(63) - 1)
    i["rs20"] = (c / c.shift(20) - 1) - (spy / spy.shift(20) - 1)

    # Weinstein: 30-week moving average on weekly closes
    wk = c.resample("W-FRI").last()
    w30 = wk.rolling(30, min_periods=30).mean()
    i["sma30w"] = w30.reindex(df.index, method="ffill")
    i["sma30w_slope"] = (w30 - w30.shift(4)).reindex(df.index, method="ffill")

    up_vol = v.where(c > c.shift(1), 0.0)
    dn_vol = v.where(c < c.shift(1), 0.0)
    i["updown"] = up_vol.rolling(20).sum() / dn_vol.rolling(20).sum().replace(0, np.nan)

    i["hi252"] = h.rolling(252, min_periods=150).max()
    i["hi50_prev"] = h.shift(1).rolling(50).max()
    i["lo50_prev"] = l.shift(1).rolling(50).min()
    i["volr"] = v / v.rolling(50, min_periods=20).mean()
    i["bbw"] = 4 * c.rolling(20).std() / i["sma20"]
    i["bbw_pct"] = i["bbw"].rolling(126, min_periods=60).rank(pct=True)
    i["swing_low10"] = l.rolling(10).min()
    i["swing_high10"] = h.rolling(10).max()
    return i


# -------------------------------------------------------------------- agents
def _s(i, values):
    return pd.Series(values, index=i.index, dtype=float)


def a_trend50(i):
    rising = i.sma50 > i.sma50.shift(10)
    return _s(i, np.select([(i.close > i.sma50) & rising, (i.close < i.sma50) & ~rising], [1.0, -1.0], 0.0))


def a_trend200(i):
    gap = i.close / i.sma200 - 1
    return _s(i, np.select([gap > 0.01, gap < -0.01], [1.0, -1.0], 0.0))


def a_cross(i):
    return _s(i, np.select([i.sma50 > i.sma200, i.sma50 < i.sma200], [1.0, -1.0], 0.0))


def a_stage(i):
    s2 = (i.close > i.sma30w) & (i.sma30w_slope > 0)
    s4 = (i.close < i.sma30w) & (i.sma30w_slope < 0)
    return _s(i, np.select([s2, s4], [1.0, -1.0], 0.0))


def a_rsi(i):
    up = i.close > i.sma200
    r = i.rsi
    return _s(
        i,
        np.select(
            [r > 75, r >= 55, r >= 45, (r >= 30) & up, r >= 30, (r < 30) & up, r < 30],
            [-0.5, 1.0, 0.0, 0.5, -0.5, 1.0, -1.0],
            0.0,
        ),
    )


def a_macd(i):
    hst, prev = i.macd_hist, i.macd_hist.shift(1)
    return _s(
        i,
        np.select(
            [(hst > 0) & (hst > prev), hst > 0, (hst < 0) & (hst < prev), hst < 0],
            [1.0, 0.5, -1.0, -0.5],
            0.0,
        ),
    )


def a_rs63(i):
    return (i.rs63 / 0.10).clip(-1, 1)


def a_rs20(i):
    return (i.rs20 / 0.05).clip(-1, 1)


def a_pullback(i):
    rising = i.sma50 > i.sma50.shift(10)
    long_ok = (i.close > i.sma50) & rising & (i.low.rolling(3).min() <= i.ema20 + 0.5 * i.atr) & (i.close > i.ema20)
    short_ok = (i.close < i.sma50) & ~rising & (i.high.rolling(3).max() >= i.ema20 - 0.5 * i.atr) & (i.close < i.ema20)
    return _s(i, np.select([long_ok, short_ok], [1.0, -1.0], 0.0))


def a_volume(i):
    return (np.log(i.updown) / np.log(1.5)).clip(-1, 1)


def a_high52(i):
    dist = i.close / i.hi252 - 1
    return ((dist + 0.175) / 0.125).clip(-1, 1)


def a_breakout(i):
    bo = ((i.close > i.hi50_prev) & (i.volr > 1.3)).astype(float).rolling(5).max()
    bd = ((i.close < i.lo50_prev) & (i.volr > 1.3)).astype(float).rolling(5).max()
    return _s(i, np.select([bo > 0, bd > 0], [1.0, -1.0], 0.0))


def a_squeeze(i):
    coiled = i.bbw_pct <= 0.2
    return _s(i, np.where(coiled, 0.5 * np.sign(i.close - i.sma50), 0.0))


def a_extension(i):
    ext = (i.close - i.ema20) / i.atr
    up = i.close > i.sma200
    return _s(i, np.select([ext > 3, (ext < -3) & up], [-0.75, 0.5], 0.0))


def _pct(x):
    return f"{x * 100:+.1f}%"


AGENTS = [
    dict(key="trend50", name="50-day trend", group="Trend", weight=1.2, fn=a_trend50,
         why=lambda r: f"Price {_pct(r.close / r.sma50 - 1)} vs 50-day avg, which is "
                       f"{'rising' if r.sma50_rising else 'falling'}"),
    dict(key="trend200", name="200-day trend", group="Trend", weight=1.2, fn=a_trend200,
         why=lambda r: f"Price {_pct(r.close / r.sma200 - 1)} vs 200-day avg"),
    dict(key="cross", name="Golden / death cross", group="Trend", weight=0.8, fn=a_cross,
         why=lambda r: "50-day avg above 200-day (golden)" if r.sma50 > r.sma200 else "50-day avg below 200-day (death)"),
    dict(key="stage", name="Weinstein stage", group="Trend", weight=1.2, fn=a_stage,
         why=lambda r: {1.0: "Stage 2 - advancing above a rising 30-week avg",
                        -1.0: "Stage 4 - declining below a falling 30-week avg"}.get(r.v_stage, "Stage 1/3 - basing or topping")),
    dict(key="rs63", name="Strength vs S&P (3 mo)", group="Momentum", weight=1.2, fn=a_rs63,
         why=lambda r: f"{_pct(r.rs63)} vs SPY over 63 sessions"),
    dict(key="rs20", name="Strength vs S&P (1 mo)", group="Momentum", weight=0.8, fn=a_rs20,
         why=lambda r: f"{_pct(r.rs20)} vs SPY over 20 sessions"),
    dict(key="rsi", name="RSI regime", group="Momentum", weight=0.8, fn=a_rsi,
         why=lambda r: f"RSI {r.rsi:.0f}" + (" - overbought" if r.rsi > 75 else " - oversold" if r.rsi < 30 else "")),
    dict(key="macd", name="MACD momentum", group="Momentum", weight=0.8, fn=a_macd,
         why=lambda r: f"Histogram {'above' if r.macd_hist > 0 else 'below'} zero and "
                       f"{'expanding' if abs(r.macd_hist) > abs(r.macd_prev) else 'fading'}"),
    dict(key="pullback", name="Pullback entry", group="Setup", weight=1.0, fn=a_pullback,
         why=lambda r: "Uptrend pulled back to the 20-day EMA and held" if r.v_pullback > 0
         else "Downtrend rallied into the 20-day EMA and failed" if r.v_pullback < 0
         else "No pullback-to-EMA setup right now"),
    dict(key="breakout", name="Breakout on volume", group="Setup", weight=1.0, fn=a_breakout,
         why=lambda r: "Cleared its 50-day high on heavy volume this week" if r.v_breakout > 0
         else "Broke its 50-day low on heavy volume this week" if r.v_breakout < 0
         else "No volume breakout in the last 5 sessions"),
    dict(key="high52", name="52-week high proximity", group="Setup", weight=0.8, fn=a_high52,
         why=lambda r: f"{_pct(r.close / r.hi252 - 1)} from 52-week high"),
    dict(key="volume", name="Accumulation / distribution", group="Volume", weight=0.8, fn=a_volume,
         why=lambda r: f"Up-day volume is {r.updown:.2f}x down-day volume (20 sessions)"),
    dict(key="squeeze", name="Volatility squeeze", group="Volatility", weight=0.5, fn=a_squeeze,
         why=lambda r: "Bands are tight (bottom 20% of 6 months) - a big move often follows"
         if r.bbw_pct <= 0.2 else "No squeeze"),
    dict(key="extension", name="Stretch from average", group="Volatility", weight=0.6, fn=a_extension,
         why=lambda r: f"{(r.close - r.ema20) / r.atr:+.1f} ATRs from the 20-day EMA"
                       + (" - extended, poor entry" if (r.close - r.ema20) / r.atr > 3 else "")),
]
WEIGHTS = pd.Series({a["key"]: a["weight"] for a in AGENTS})


def score_frame(i: pd.DataFrame):
    votes = pd.DataFrame({a["key"]: a["fn"](i) for a in AGENTS}, index=i.index).fillna(0.0)
    comp = (votes * WEIGHTS).sum(axis=1) / WEIGHTS.sum()
    # Smooth over ~a week so ratings move at swing-trade speed, not day-to-day noise
    comp = comp.ewm(span=5, adjust=False).mean()
    score = (50 + 50 * comp).round().where(i.sma200.notna())
    return votes, score


# Absolute thresholds (used for SPY / when no peer ranking exists)
RATINGS = [(75, "Strong Buy"), (62, "Buy"), (39, "Hold"), (26, "Sell"), (-1, "Strong Sell")]
# Relative thresholds: percentile of the score among all S&P 500 stocks that day
PCT_RATINGS = [(0.90, "Strong Buy"), (0.70, "Buy"), (0.30, "Hold"), (0.10, "Sell"), (-1, "Strong Sell")]


def rating_for(score):
    if score is None or pd.isna(score):
        return None
    for floor, name in RATINGS:
        if score >= floor:
            return name
    return "Strong Sell"


def rating_for_pct(pct):
    if pct is None or pd.isna(pct):
        return None
    for floor, name in PCT_RATINGS:
        if pct >= floor:
            return name
    return "Strong Sell"


def family(rating):
    if not isinstance(rating, str):
        return None
    return "buy" if "Buy" in rating else "sell" if "Sell" in rating else "hold"


def explain(i: pd.DataFrame, votes: pd.DataFrame):
    """Per-agent vote and plain-English reason for the latest bar."""
    r = i.iloc[-1].copy()
    r["sma50_rising"] = i.sma50.iloc[-1] > i.sma50.iloc[-11]
    r["macd_prev"] = i.macd_hist.iloc[-2]
    last = votes.iloc[-1]
    for k in last.index:
        r[f"v_{k}"] = last[k]
    out = []
    for a in AGENTS:
        try:
            why = a["why"](r)
        except Exception:
            why = ""
        out.append(dict(key=a["key"], name=a["name"], group=a["group"], weight=a["weight"],
                        vote=round(float(last[a["key"]]), 2), why=why))
    return out


def agreement(votes_row: pd.Series, score: float):
    active = votes_row[votes_row.abs() >= 0.25]
    if active.empty:
        return 0, 0
    direction = 1 if score >= 50 else -1
    return int((np.sign(active) == direction).sum()), int(len(active))


def trade_plan(i: pd.DataFrame, rating: str):
    r = i.iloc[-1]
    c, a = float(r.close), float(r.atr)
    if family(rating) == "sell":
        stop = min(float(r.swing_high10) + 0.25 * a, c + 3 * a)
        if stop - c < a:
            stop = c + 1.5 * a
        target = c - 2 * (stop - c)
        side = "short / avoid"
    else:
        stop = max(float(r.swing_low10) - 0.25 * a, c - 3 * a)
        if c - stop < a:
            stop = c - 1.5 * a
        target = c + 2 * (c - stop)
        side = "long"
    return dict(side=side, entry=round(c, 2), stop=round(stop, 2), target=round(target, 2),
                riskPct=round(abs(c - stop) / c * 100, 2), atr=round(a, 2))
