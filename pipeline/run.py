"""Nightly job: download S&P 500 daily bars, score every stock, write JSON for the web app.

Usage:
    python pipeline/run.py                 # full run
    python pipeline/run.py --limit 25      # quick test on 25 stocks
    python pipeline/run.py --no-extras     # skip news/earnings lookups
"""
import argparse
import json
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import yfinance as yf

sys.path.insert(0, os.path.dirname(__file__))
from pins import fetch_extras, technical_pins  # noqa: E402
from scoring import (agreement, explain, indicators, rating_for,  # noqa: E402
                     rating_for_pct, score_frame, trade_plan)
from universe import load_universe  # noqa: E402
from market import build_market  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "data")
CHART_DAYS = 252   # track-record window
BAR_DAYS = 504     # 2 years of bars per chart (EMA 200 needs the warm-up)
FWD = 20  # track-record horizon in sessions (~1 month swing)


def r2(x, n=2):
    if x is None:
        return None
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(x) or math.isinf(x) else round(x, n)


def dump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)


def download(symbols):
    print(f"[prices] downloading {len(symbols)} symbols ...")
    t0 = time.time()
    data = yf.download(symbols, period="5y", interval="1d", auto_adjust=True,
                       group_by="ticker", threads=True, progress=False)
    # Retry anything that failed (Yahoo hiccups, cache locks) one at a time
    missing = [s for s in symbols if get_frame(data, s) is None]
    if missing:
        print(f"[prices] retrying {len(missing)}: {missing[:20]}")
        frames = {s: data[s] for s in symbols if s not in missing and s in data.columns.get_level_values(0)}
        for s in missing:
            time.sleep(0.5)
            one = yf.download(s, period="5y", interval="1d", auto_adjust=True,
                              group_by="ticker", threads=False, progress=False)
            if one is not None and len(one):
                frames[s] = one[s] if isinstance(one.columns, pd.MultiIndex) else one
        data = pd.concat(frames, axis=1)
    print(f"[prices] done in {time.time() - t0:.0f}s")
    return data


def get_frame(data, sym):
    try:
        df = data[sym].dropna(subset=["Close"])
    except KeyError:
        return None
    return df if len(df) >= 220 else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-extras", action="store_true")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    uni = load_universe()
    if args.limit:
        uni = uni.head(args.limit)
    meta = {r.sym: r for r in uni.itertuples()}
    symbols = list(meta)

    data = download(symbols + ["SPY"])
    spy_df = get_frame(data, "SPY")
    if spy_df is None:
        raise SystemExit("SPY download failed")
    spy_close = spy_df["Close"]

    extras = {}
    if not args.no_extras:
        print(f"[extras] news + earnings for {len(symbols)} symbols ...")
        t0 = time.time()
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = {ex.submit(fetch_extras, s): s for s in symbols}
            for f in as_completed(futs):
                try:
                    extras[futs[f]] = f.result()
                except Exception as exc:
                    print(f"[extras] {futs[f]} failed: {exc}")
        print(f"[extras] done in {time.time() - t0:.0f}s")

    # ---- pass 1: indicators + agent scores for every stock
    computed = {}
    for sym in symbols + ["SPY"]:
        df = spy_df if sym == "SPY" else get_frame(data, sym)
        if df is None:
            print(f"[skip] {sym}: not enough data")
            continue
        ind = indicators(df, spy_close)
        votes, score = score_frame(ind)
        if pd.isna(score.iloc[-1]):
            continue
        computed[sym] = (ind, votes, score)

    # ---- rank each day's scores against the whole S&P 500 -> relative ratings
    panel = pd.DataFrame({s: v[2] for s, v in computed.items() if s != "SPY"})
    pct_panel = panel.rank(axis=1, pct=True)
    rating_panel = pct_panel.apply(lambda col: col.map(rating_for_pct))

    rows = []
    for sym, (ind, votes, score) in computed.items():
        info = meta.get(sym)
        name = info.name if info else "SPDR S&P 500 ETF"
        sector = info.sector if info else "Index"
        industry = info.industry if info else "Index"

        if sym == "SPY":
            ratings = score.map(rating_for)
            rank = None
        else:
            ratings = rating_panel[sym].reindex(ind.index)
            rank = int(panel.iloc[-1].rank(ascending=False, method="min")[sym])

        s_now = int(score.iloc[-1])
        rating = ratings.iloc[-1]
        agree, active = agreement(votes.iloc[-1], s_now)
        plan = trade_plan(ind, rating)
        agents = explain(ind, votes)
        ex = extras.get(sym, {})
        next_e = ex.get("nextEarnings")
        last_date = ind.index[-1]
        e_days = None
        if next_e:
            e_days = int(np.busday_count(last_date.date(), pd.Timestamp(next_e).date()))

        # --- per-ticker chart file
        tail = ind.iloc[-BAR_DAYS:]
        sc_tail = score.iloc[-BAR_DAYS:]
        first_chart_day = tail.index[0].strftime("%Y-%m-%d")
        if sym == "SPY":
            pins = technical_pins(ind, score, ratings, score / 100, 0.62, 0.39, 0.50, BAR_DAYS)
        else:
            pins = technical_pins(ind, score, ratings, pct_panel[sym], 0.70, 0.30, 0.50, BAR_DAYS)
        pins += [p for p in ex.get("earnings", []) if p["date"] >= first_chart_day]
        pins += [p for p in ex.get("news", []) if p["date"] >= first_chart_day]
        pins.sort(key=lambda p: p["date"])

        c = ind.close
        row = dict(
            sym=sym, name=name, sector=sector, industry=industry,
            close=r2(c.iloc[-1]), chg1d=r2((c.iloc[-1] / c.iloc[-2] - 1) * 100),
            chg5d=r2((c.iloc[-1] / c.iloc[-6] - 1) * 100), chg20d=r2((c.iloc[-1] / c.iloc[-21] - 1) * 100),
            score=s_now, score5=r2(score.iloc[-6], 0), rating=rating, rank=rank,
            prevRating=ratings.iloc[-2], agree=agree, active=active,
            stop=plan["stop"], target=plan["target"], riskPct=plan["riskPct"],
            rsi=r2(ind.rsi.iloc[-1], 0), rs63=r2(ind.rs63.iloc[-1] * 100, 1),
            above50=bool(c.iloc[-1] > ind.sma50.iloc[-1]), above200=bool(c.iloc[-1] > ind.sma200.iloc[-1]),
            earningsDays=e_days, nextEarnings=next_e,
            top=[a["name"] for a in sorted(agents, key=lambda a: -a["vote"] * a["weight"] * (1 if s_now >= 50 else -1))[:3]],
        )
        rows.append(row)

        dump(os.path.join(OUT, "t", f"{sym}.json"), dict(
            sym=sym, name=name, sector=sector, industry=industry, asOf=last_date.strftime("%Y-%m-%d"),
            bars=[[d.strftime("%Y-%m-%d"), r2(o), r2(h), r2(l), r2(cl), int(v) if not pd.isna(v) else 0]
                  for d, o, h, l, cl, v in zip(tail.index, tail.open, tail.high, tail.low, tail.close, tail.volume)],
            # moving averages, bands, RSI, MACD are computed in the browser from bars
            score=[r2(x, 0) for x in sc_tail],
            latest=dict(score=s_now, rating=rating, rank=rank, agree=agree, active=active, agents=agents, plan=plan,
                        nextEarnings=next_e, earningsDays=e_days),
            pins=pins,
        ))

    stocks = [r for r in rows if r["sym"] != "SPY"]
    spy_row = next((r for r in rows if r["sym"] == "SPY"), None)

    # --- sector aggregates
    sectors = {}
    for r in stocks:
        s = sectors.setdefault(r["sector"], dict(sector=r["sector"], n=0, score=0.0, chg1d=0.0, chg5d=0.0))
        s["n"] += 1
        s["score"] += r["score"]
        s["chg1d"] += r["chg1d"] or 0
        s["chg5d"] += r["chg5d"] or 0
    sector_list = [dict(sector=k, n=v["n"], score=round(v["score"] / v["n"]), chg1d=round(v["chg1d"] / v["n"], 2),
                        chg5d=round(v["chg5d"] / v["n"], 2)) for k, v in sectors.items()]
    sector_list.sort(key=lambda s: -s["score"])

    # --- track record: return vs SPY N sessions after each day's rating (last ~year)
    order = ["Strong Buy", "Buy", "Hold", "Sell", "Strong Sell"]
    closes = pd.DataFrame({s: computed[s][0].close for s in panel.columns})
    window = rating_panel.index[-CHART_DAYS:]
    track = {}
    for h in (5, 10, 20):
        excess = (closes.shift(-h) / closes - 1).sub(spy_close.shift(-h) / spy_close - 1, axis=0)
        ex_w, rt_w = excess.loc[window].stack(), rating_panel.loc[window].stack()
        both = pd.DataFrame({"x": ex_w, "r": rt_w}).dropna()
        stats = []
        for k in order:
            x = both.x[both.r == k]
            if len(x):
                stats.append(dict(rating=k, n=int(len(x)), avgExcess=round(float(x.mean()) * 100, 2),
                                  beatRate=round(float((x > 0).mean()) * 100, 1)))
        track[str(h)] = stats

    n = len(stocks) or 1
    counts = {k: sum(1 for r in stocks if r["rating"] == k) for k in order}
    summary = dict(
        asOf=pd.Timestamp(spy_close.index[-1]).strftime("%Y-%m-%d"),
        generatedAt=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        horizon=FWD,
        market=dict(
            spy=spy_row,
            above50=round(sum(r["above50"] for r in stocks) / n * 100, 1),
            above200=round(sum(r["above200"] for r in stocks) / n * 100, 1),
            avgScore=round(sum(r["score"] for r in stocks) / n),
            up=sum(1 for r in stocks if (r["chg1d"] or 0) > 0),
            down=sum(1 for r in stocks if (r["chg1d"] or 0) < 0),
            counts=counts,
        ),
        sectors=sector_list,
        track=track,
        stocks=stocks,
    )
    dump(os.path.join(OUT, "summary.json"), summary)

    # Broad market (index stats, index charts, fear & greed) in its own file
    try:
        mk = build_market(closes)
        mk["generatedAt"] = summary["generatedAt"]
        dump(os.path.join(OUT, "market.json"), mk)
        fg = mk.get("fearGreed") or {}
        print(f"[market] fear & greed {fg.get('value')} ({fg.get('label')}); "
              f"crypto {(mk.get('cryptoFearGreed') or {}).get('value')}")
    except Exception as exc:
        print(f"[market] failed: {exc}")
    print(f"[done] {len(stocks)} stocks scored, as of {summary['asOf']}. Counts: {counts}")
    print("[track]", track)


if __name__ == "__main__":
    main()
