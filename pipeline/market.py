"""Broad-market data for the Today page and the Fear & Greed analyzer.

Stock Fear & Greed is our own version of the CNN-style index: six market gauges,
each scored 0-100 by where today's reading sits within its own past year, then
averaged. (CNN also uses the put/call ratio, which has no free data source.)
Crypto Fear & Greed comes from alternative.me's free public API.
"""
import math

import numpy as np
import pandas as pd
import requests
import yfinance as yf

STATS = [  # (yahoo symbol, label, kind)
    ("^GSPC", "S&P 500", "index"),
    ("^NDX", "Nasdaq 100", "index"),
    ("^DJI", "Dow", "index"),
    ("^RUT", "Russell 2000", "index"),
    ("^VIX", "VIX", "vol"),
    ("^TNX", "10Y yield", "yield"),
    ("CL=F", "Oil (WTI)", "commodity"),
    ("GC=F", "Gold", "commodity"),
    ("BTC-USD", "Bitcoin", "crypto"),
]
CARDS = [("^GSPC", "S&P 500"), ("^NDX", "Nasdaq 100"), ("BTC-USD", "Bitcoin")]
EXTRA = ["HYG", "IEF", "TLT", "SPY"]
ZONES = ["Extreme Fear", "Fear", "Neutral", "Greed", "Extreme Greed"]

COMPONENTS = {
    "momentum": ("Market momentum", "S&P 500 vs its 125-day average",
                 "Is the S&P 500 trading well above its 6-month average (greed) or below it (fear)?"),
    "strength": ("Stock price strength", "New 52-week highs vs lows",
                 "More S&P 500 stocks hitting 1-year highs than lows signals greed; more lows signals fear."),
    "breadth": ("Stock price breadth", "Share of stocks above their 50-day average",
                "Broad participation (most stocks in uptrends) is greedy; a narrow market is fearful."),
    "volatility": ("Market volatility", "VIX vs its 50-day average",
                   "A VIX spiking above its recent average means traders are paying up for protection (fear)."),
    "safehaven": ("Safe-haven demand", "Stocks vs Treasuries, last 20 days",
                  "When long-term Treasuries beat stocks, money is hiding in safety (fear)."),
    "junk": ("Junk bond demand", "High-yield vs Treasury bonds, last 20 days",
             "Investors buying riskier high-yield bonds over Treasuries shows appetite for risk (greed)."),
}


def _r(x, n=2):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(x) or math.isinf(x) else round(x, n)


def label_for(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return ("Extreme Fear" if v < 25 else "Fear" if v < 45 else "Neutral" if v <= 55
            else "Greed" if v <= 75 else "Extreme Greed")


def _pct_rank(s: pd.Series, window=252):
    """Where each value sits within the trailing year, 0-100."""
    return s.rolling(window, min_periods=120).rank(pct=True) * 100


def zone_outcomes(score: pd.Series, price: pd.Series, horizons):
    """Average forward return of `price` after days spent in each zone."""
    price = price.reindex(score.index).ffill()
    out = []
    for z in ZONES:
        row = dict(zone=z)
        mask = score.map(label_for) == z
        row["days"] = int(mask.sum())
        for h in horizons:
            fwd = (price.shift(-h) / price - 1)[mask].dropna()
            row[f"avg{h}"] = _r(fwd.mean() * 100) if len(fwd) else None
            row[f"up{h}"] = _r((fwd > 0).mean() * 100, 0) if len(fwd) else None
            row[f"n{h}"] = int(len(fwd))
        out.append(row)
    base = {}
    for h in horizons:
        fwd = (price.shift(-h) / price - 1).reindex(score.index).dropna()
        base[f"avg{h}"] = _r(fwd.mean() * 100)
        base[f"up{h}"] = _r((fwd > 0).mean() * 100, 0)
    return dict(horizons=list(horizons), zones=out, allDays=base)


def _streak(score: pd.Series):
    labels = score.map(label_for)
    cur, n = labels.iloc[-1], 0
    for v in reversed(labels.tolist()):
        if v != cur:
            break
        n += 1
    return n


def fear_greed(closes: dict, panel_close: pd.DataFrame):
    spx, vix = closes["^GSPC"], closes["^VIX"]
    idx = spx.index
    raw = {}
    raw["momentum"] = spx / spx.rolling(125).mean() - 1
    hi = panel_close >= panel_close.rolling(252, min_periods=200).max()
    lo = panel_close <= panel_close.rolling(252, min_periods=200).min()
    members = panel_close.notna().sum(axis=1).replace(0, np.nan)
    raw["strength"] = ((hi.sum(axis=1) - lo.sum(axis=1)) / members).reindex(idx)
    raw["breadth"] = ((panel_close > panel_close.rolling(50).mean()).sum(axis=1) / members).reindex(idx)
    raw["volatility"] = -(vix / vix.rolling(50).mean() - 1).reindex(idx)
    raw["safehaven"] = (closes["SPY"].pct_change(20) - closes["TLT"].pct_change(20)).reindex(idx)
    raw["junk"] = (closes["HYG"].pct_change(20) - closes["IEF"].pct_change(20)).reindex(idx)

    scores = pd.DataFrame({k: _pct_rank(v.ffill()) for k, v in raw.items()})
    # require all six gauges so the history is consistent
    scores = scores.dropna()
    total = scores.mean(axis=1).round()

    def ago(n):
        return int(total.iloc[-1 - n]) if len(total) > n else None

    now = int(total.iloc[-1])
    last = scores.iloc[-1]
    raw_last = {k: v.reindex(scores.index).iloc[-1] for k, v in raw.items()}
    readings = {
        "momentum": f"S&P 500 is {raw_last['momentum'] * 100:+.2f}% vs its 125-day average",
        "strength": f"Net {raw_last['strength'] * 100:+.1f}% of stocks at 52-week highs (highs minus lows)",
        "breadth": f"{raw_last['breadth'] * 100:.0f}% of stocks are above their 50-day average",
        "volatility": f"VIX is {-raw_last['volatility'] * 100:+.0f}% vs its 50-day average ({vix.iloc[-1]:.1f})",
        "safehaven": f"Stocks {'beat' if raw_last['safehaven'] > 0 else 'trailed'} Treasuries by {abs(raw_last['safehaven']) * 100:.1f} pts over 20 days",
        "junk": f"High-yield {'beat' if raw_last['junk'] > 0 else 'trailed'} Treasuries by {abs(raw_last['junk']) * 100:.1f} pts over 20 days",
    }
    hist_idx = scores.index[-760:]
    comps = []
    for k, (name, how, why) in COMPONENTS.items():
        v = int(round(last[k]))
        comps.append(dict(key=k, name=name, how=how, why=why, reading=readings[k], score=v, label=label_for(v),
                          weekAgo=int(round(scores[k].iloc[-6])), monthAgo=int(round(scores[k].iloc[-22])),
                          history=[int(round(x)) for x in scores[k].loc[hist_idx]]))

    return dict(
        value=now, label=label_for(now),
        prevClose=ago(1), weekAgo=ago(5), monthAgo=ago(21), yearAgo=ago(251),
        streakDays=_streak(total),
        percentile=_r((total < now).mean() * 100, 0),
        since=total.index[0].strftime("%Y-%m-%d"),
        components=comps,
        history=[[d.strftime("%Y-%m-%d"), int(v)] for d, v in total.loc[hist_idx].items()],
        spx=[[d.strftime("%Y-%m-%d"), _r(v)] for d, v in spx.reindex(hist_idx).items()],
        outcomes=zone_outcomes(total, spx, (5, 20, 60)),
    )


def crypto_fear_greed(btc: pd.Series):
    try:
        data = requests.get("https://api.alternative.me/fng/?limit=0", timeout=30).json()["data"]
        s = pd.Series({pd.Timestamp(int(x["timestamp"]), unit="s").normalize(): int(x["value"]) for x in data}).sort_index()
        s = s[~s.index.duplicated()]
        btc_d = btc.copy()
        btc_d.index = pd.DatetimeIndex(btc_d.index).tz_localize(None).normalize()
        now = int(s.iloc[-1])

        def ago(n):
            return int(s.iloc[-1 - n]) if len(s) > n else None

        tail = s.iloc[-1100:]
        return dict(
            value=now, label=data[0]["value_classification"] or label_for(now),
            prevClose=ago(1), weekAgo=ago(7), monthAgo=ago(30), yearAgo=ago(365),
            streakDays=_streak(s.astype(float)), percentile=_r((s < now).mean() * 100, 0),
            since=s.index[0].strftime("%Y-%m-%d"),
            history=[[d.strftime("%Y-%m-%d"), int(v)] for d, v in tail.items()],
            btc=[[d.strftime("%Y-%m-%d"), _r(v)] for d, v in btc_d.reindex(tail.index).ffill().items()],
            outcomes=zone_outcomes(s.astype(float), btc_d.reindex(s.index).ffill(), (7, 30, 90)),
            source="alternative.me",
        )
    except Exception as exc:
        print(f"[market] crypto fear & greed failed: {exc}")
        return None


def intraday(sym: str, daily: pd.Series):
    """Latest session (indexes) or last 24h (bitcoin) at 5-minute resolution."""
    try:
        h = yf.Ticker(sym).history(period="5d", interval="5m")["Close"].dropna()
        if h.empty:
            return None
        if sym == "BTC-USD":
            cut = h.index[-1] - pd.Timedelta(hours=24)
            ref_s = h[h.index <= cut]
            ref = float(ref_s.iloc[-1]) if len(ref_s) else float(h.iloc[0])
            h = h[h.index > cut]
        else:
            day = h.index[-1].date()
            h = h[[ts.date() == day for ts in h.index]]
            prior = daily[pd.DatetimeIndex(daily.index).date < day]
            ref = float(prior.iloc[-1]) if len(prior) else float(h.iloc[0])
        return dict(ref=_r(ref), points=[[int(ts.timestamp()), _r(v)] for ts, v in h.items()])
    except Exception as exc:
        print(f"[market] intraday {sym} failed: {exc}")
        return None


def build_market(panel_close: pd.DataFrame):
    syms = sorted({s for s, _, _ in STATS} | set(EXTRA))
    data = yf.download(syms, period="5y", interval="1d", auto_adjust=True,
                       group_by="ticker", threads=True, progress=False)
    closes = {}
    for s in syms:
        try:
            closes[s] = data[s]["Close"].dropna()
        except KeyError:
            closes[s] = pd.Series(dtype=float)

    stats = []
    for s, label, kind in STATS:
        c = closes[s]
        if len(c) < 2:
            continue
        last, prev = float(c.iloc[-1]), float(c.iloc[-2])
        wk = float(c.iloc[-6]) if len(c) > 6 else None
        ytd_base = c[c.index < pd.Timestamp(c.index[-1].year, 1, 1)]
        ytd = float(ytd_base.iloc[-1]) if len(ytd_base) else None
        row = dict(sym=s, label=label, kind=kind, value=_r(last), asOf=c.index[-1].strftime("%Y-%m-%d"),
                   chg=_r(last - prev), chgPct=_r((last / prev - 1) * 100),
                   wkPct=_r((last / wk - 1) * 100) if wk else None,
                   ytdPct=_r((last / ytd - 1) * 100) if ytd else None)
        if kind == "yield":  # ^TNX is quoted in percent; show change in basis points
            row["chgBp"] = _r((last - prev) * 100, 0)
        stats.append(row)

    cards = []
    for s, label in CARDS:
        c = closes[s]
        cards.append(dict(sym=s, label=label,
                          daily=[[d.strftime("%Y-%m-%d"), _r(v)] for d, v in c.iloc[-1260:].items()],
                          intraday=intraday(s, c)))

    fg = None
    try:
        fg = fear_greed(closes, panel_close)
    except Exception as exc:
        print(f"[market] fear & greed failed: {exc}")

    return dict(stats=stats, cards=cards, fearGreed=fg, cryptoFearGreed=crypto_fear_greed(closes["BTC-USD"]))
