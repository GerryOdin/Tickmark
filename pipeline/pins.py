"""Chart pins: dated events shown on the chart like timed comments.

kind = "signal"  computed from price/volume (our own analysis)
kind = "fact"    reported by an outside source (news, earnings)
"""
import math
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import yfinance as yf

from scoring import family


def _d(ts):
    return pd.Timestamp(ts).strftime("%Y-%m-%d")


def technical_pins(i: pd.DataFrame, score: pd.Series, ratings: pd.Series, level: pd.Series,
                   enter_buy: float, enter_sell: float, mid: float, window: int = 252):
    """level = peer percentile (stocks) or score/100 (SPY); thresholds on that scale."""
    pins = []
    start = i.index[-window] if len(i) > window else i.index[0]

    s50, s200 = i.sma50, i.sma200
    golden = (s50 > s200) & (s50.shift(1) <= s200.shift(1))
    death = (s50 < s200) & (s50.shift(1) >= s200.shift(1))
    prev_hi = i.close.shift(1).rolling(252, min_periods=150).max()
    new_hi = i.close > prev_hi
    ret = i.close.pct_change()
    big = (ret.abs() >= np.maximum(0.04, 2.5 * i.atr.shift(1) / i.close.shift(1))) & (i.volr >= 1.8)

    last_hi_pos = -999
    for pos, ts in enumerate(i.index):
        if ts < start:
            continue
        d = _d(ts)
        if golden.iloc[pos]:
            pins.append(dict(date=d, type="signal", kind="signal", tone="bull",
                             title="Golden cross", body="50-day average crossed above the 200-day average."))
        if death.iloc[pos]:
            pins.append(dict(date=d, type="signal", kind="signal", tone="bear",
                             title="Death cross", body="50-day average crossed below the 200-day average."))
        if new_hi.iloc[pos] and pos - last_hi_pos > 20:
            pins.append(dict(date=d, type="signal", kind="signal", tone="bull",
                             title="New 52-week high", body=f"Closed at {i.close.iloc[pos]:.2f}, above its prior 1-year high."))
            last_hi_pos = pos
        if big.iloc[pos]:
            r = ret.iloc[pos]
            pins.append(dict(date=d, type="signal", kind="signal", tone="bull" if r > 0 else "bear",
                             title=f"{r * 100:+.1f}% on {i.volr.iloc[pos]:.1f}x volume",
                             body="Unusually large move on heavy volume - often news-driven. Check what happened that day."))

    # Rating flips with hysteresis: enter Buy at the buy cutoff, but only leave it
    # once the stock falls back to the middle of the pack (same for Sell).
    lvl = level.reindex(i.index)
    raw, state = [], None
    for x in lvl:
        if pd.isna(x):
            raw.append(None)
            continue
        if x >= enter_buy:
            state = "buy"
        elif x <= enter_sell:
            state = "sell"
        elif state == "buy" and x < mid or state == "sell" and x > mid or state is None:
            state = "hold"
        raw.append(state)
    # ...and the new state must last 3 sessions before it counts
    current = None
    for pos in range(2, len(raw)):
        f = raw[pos]
        if f is None or raw[pos - 1] != f or raw[pos - 2] != f:
            continue
        if f != current:
            if current is not None and i.index[pos] >= start:
                labels = {"buy": "Buy", "hold": "Hold", "sell": "Sell"}
                tone = {"buy": "bull", "sell": "bear", "hold": "neutral"}[f]
                pins.append(dict(date=_d(i.index[pos]), type="rating", kind="signal", tone=tone,
                                 title=f"Rating: {labels[current]} -> {labels[f]}",
                                 body=f"Held for 3 sessions. Agent score {int(score.iloc[pos])}/100 on this day."))
            current = f
    return pins


# ------------------------------------------------------- outside sources
def _clean(x):
    if x is None:
        return None
    if isinstance(x, float) and math.isnan(x):
        return None
    return x


def fetch_extras(sym: str):
    """Recent news and earnings for one ticker from Yahoo (free, unofficial)."""
    out = dict(news=[], earnings=[], nextEarnings=None)
    t = yf.Ticker(sym)
    try:
        for item in (t.news or [])[:12]:
            c = item.get("content", item)
            title = c.get("title")
            when = c.get("pubDate") or c.get("displayTime")
            if not when and item.get("providerPublishTime"):
                when = datetime.fromtimestamp(item["providerPublishTime"], tz=timezone.utc).isoformat()
            if not title or not when:
                continue
            url = (c.get("canonicalUrl") or {}).get("url") or (c.get("clickThroughUrl") or {}).get("url") or c.get("link")
            provider = (c.get("provider") or {}).get("displayName") or c.get("publisher") or "News"
            out["news"].append(dict(date=str(when)[:10], type="news", kind="fact", tone="neutral",
                                    title=title, body=(c.get("summary") or "")[:400], source=provider, url=url))
    except Exception as exc:
        print(f"[extras] news {sym}: {exc}")
    try:
        ed = t.get_earnings_dates(limit=8)
        if ed is not None and len(ed):
            today = pd.Timestamp.now(tz=ed.index.tz).normalize()
            for ts, row in ed.iterrows():
                est, rep = _clean(row.get("EPS Estimate")), _clean(row.get("Reported EPS"))
                sur = _clean(row.get("Surprise(%)"))
                if ts.normalize() >= today and rep is None:
                    nxt = _d(ts)
                    if out["nextEarnings"] is None or nxt < out["nextEarnings"]:
                        out["nextEarnings"] = nxt
                    continue
                if rep is None:
                    continue
                tone = "neutral" if sur is None else ("bull" if sur > 0 else "bear")
                body = f"Reported EPS {rep:.2f}" + (f" vs {est:.2f} expected" if est is not None else "")
                if sur is not None:
                    body += f" ({sur:+.1f}% surprise)"
                out["earnings"].append(dict(date=_d(ts), type="earnings", kind="fact", tone=tone,
                                            title="Earnings " + ("beat" if tone == "bull" else "miss" if tone == "bear" else "report"),
                                            body=body, source="Yahoo Finance"))
    except Exception as exc:
        print(f"[extras] earnings {sym}: {exc}")
    return out
