"""S&P 500 constituent list (symbol, name, sector, industry)."""
import io
import os

import pandas as pd
import requests

WIKI_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
CACHE = os.path.join(os.path.dirname(__file__), "universe_cache.csv")
HEADERS = {"User-Agent": "Mozilla/5.0 (Tickmark stock research app)"}


def load_universe() -> pd.DataFrame:
    """Fetch the current S&P 500 list; fall back to the last cached copy."""
    try:
        html = requests.get(WIKI_URL, headers=HEADERS, timeout=30).text
        df = pd.read_html(io.StringIO(html), attrs={"id": "constituents"})[0]
        df = df.rename(
            columns={
                "Symbol": "sym",
                "Security": "name",
                "GICS Sector": "sector",
                "GICS Sub-Industry": "industry",
            }
        )[["sym", "name", "sector", "industry"]]
        # Yahoo uses dashes for share classes (BRK.B -> BRK-B)
        df["sym"] = df["sym"].astype(str).str.strip().str.replace(".", "-", regex=False)
        if len(df) < 450:
            raise ValueError(f"only {len(df)} rows parsed")
        df.to_csv(CACHE, index=False)
        return df
    except Exception as exc:  # network or layout change
        print(f"[universe] live fetch failed ({exc}); using cache")
        return pd.read_csv(CACHE)
