# Tickmark

A swing-trading research desk for the S&P 500, with a phone-first web app and $0 hosting.

Every weekday after the close, a script downloads daily prices for all 500 stocks. Fourteen rule-based
"agents" then vote on each stock, and the stocks are ranked against each other. The script also pins
signals, rating changes, news and earnings onto each chart as dated events.

## What's inside

| Path | What it does |
|---|---|
| `pipeline/run.py` | Nightly job: downloads prices, scores the stocks, writes `web/data/*.json` |
| `pipeline/scoring.py` | Indicators, the 14 agents, the composite score and the swing plan (stop and target) |
| `pipeline/pins.py` | Chart pins: computed signals, rating changes, news and earnings |
| `pipeline/universe.py` | Current S&P 500 member list |
| `web/` | The app: plain HTML, CSS and JS, installable on a phone home screen |
| `.github/workflows/nightly.yml` | Free nightly run and deploy on GitHub |

## Run it on your PC

```powershell
pip install -r requirements.txt
python pipeline/run.py          # about 2 minutes; add --no-extras to skip news and earnings
python -m http.server 8765 --directory web
```

Then open http://localhost:8765.

## Put it on your phone for free (GitHub Pages)

1. Create a free account at github.com and create a new **public** repository named `tickmark`.
   GitHub Pages is free only for public repositories, so your code and the generated ratings will be
   publicly viewable. A private alternative is in the next section.
2. Push this folder to that repository.
3. In the repository, open **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
4. Open **Actions → Nightly update → Run workflow** to build it the first time.
5. Open `https://<your-username>.github.io/tickmark/` on your phone.
   - **iPhone:** in Safari, tap Share → **Add to Home Screen**.
   - **Android:** in Chrome, tap ⋮ → **Install app** (or **Add to Home screen**).

From then on, GitHub reruns the job every weekday at about 4:45 pm ET. Your PC doesn't need to be on.

### If you want it private

Use Cloudflare Pages or Vercel with a private repository. Both have free tiers. Point the project at the
`web` folder and run `pip install -r requirements.txt && python pipeline/run.py` as the build command,
then add a daily scheduled deploy hook.

## How the rating works

- Each agent votes from −1 (bearish) to +1 (bullish):
  - Trend: 50-day, 200-day, golden/death cross, Weinstein stage.
  - Momentum: strength vs SPY over 1 and 3 months, RSI, MACD.
  - Setups: pullback to the 20-day EMA, volume breakout, distance from the 52-week high.
  - Volume: accumulation vs distribution.
  - Volatility: Bollinger squeeze, stretch from the average.
- The weighted votes become a 0–100 **score**, smoothed over about a week.
- The **rating** compares that score with every other S&P 500 stock on the same day: the top 10% are
  Strong Buy, the next 20% Buy, the middle 40% Hold, then 20% Sell and 10% Strong Sell.
- **Swing plan:** the stop goes just below the 10-day swing low, capped at 3 ATR. The target is twice the
  risk. The app sizes your position from your account size and the % you risk per trade.
- **Track record tab:** what happened 5, 10 and 20 sessions after each day's rating over the past year,
  measured against SPY and recomputed every night.

Educational research tool, not investment advice.

## Roadmap

- [ ] Congressional trades (House and Senate disclosures), showing both trade date and filing date
- [ ] Insider buying and selling (SEC Form 4)
- [ ] Macro calendar pins (CPI, jobs report, Fed meetings) from FRED
- [ ] AI layer (Claude API): turns news into pins tagged by affected industries and stocks,
      writes the bull and bear case for each rating, and answers chat questions about a chart
- [ ] Alerts when a watchlist stock changes rating
