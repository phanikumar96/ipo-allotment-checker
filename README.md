# ipo-allotment-checker

IPO allotment checker for **KFINTECH** and **MUFG** registrars.

Live site: [phanikumar96.github.io/ipo-allotment-checker](https://phanikumar96.github.io/ipo-allotment-checker/)

Live Site: [ipo-allotment-checker-two.vercel.app](https://ipo-allotment-checker-two.vercel.app/)



## Features

- Check multiple PANs at once
- KFINTECH (manual Client ID) or MUFG (IPO dropdown — client ID sent automatically)
- Excel / CSV export, charts, dark mode

## Deploy (complete app with MUFG)

GitHub Pages serves the static UI only. MUFG needs the `/api/proxy` serverless function (CORS).

### 1. GitHub Pages (UI)

1. Push this repo to GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Set **Branch** to `gh-pages` and folder `/ (root)`, then click **Save**.
5. Wait 1–2 minutes, then open:
   **https://phanikumar96.github.io/ipo-allotment-checker/**

Every push to `main` auto-updates the `gh-pages` branch via GitHub Actions.

The IPO list also **auto-refreshes every hour IST** from MUFG (scheduled GitHub Action at `:30` UTC = top of each IST hour).

Retail / S-HNI / B-HNI use **applied shares** for both MUFG and KFINTECH (smallest = Retail, largest = B-HNI, in between = S-HNI). The Category column shows that bucket. PEMNDG is not used for category.

### 2. Vercel (MUFG PAN search — required, one-time)

GitHub Pages cannot run the MUFG proxy. **Deploy the API once:**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/phanikumar96/ipo-allotment-checker)

**Is Vercel free?** Yes — the **Hobby (free) plan** is enough for personal IPO checks. It has monthly limits (serverless calls, bandwidth) that are fine for normal use. It is not a paid “lifetime” contract — Vercel may change limits or pricing later, but there is no charge on the free tier if you stay within limits and don’t add a paid plan.

1. Click **Deploy** on Vercel (sign in with GitHub if asked).
2. Wait ~1 minute for the deploy to finish.
3. On the GitHub Pages site, select **MUFG**, pick an IPO (or **enter Client ID manually** if the IPO is not listed yet), and click **Check All PANs**.

The site auto-uses `https://ipo-allotment-checker.vercel.app/api/proxy` for MUFG PAN checks.

### Local development

```bash
python3 mufg_proxy_server_v2.py
```

Open http://127.0.0.1:5000/

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/proxy?action=ipos` | Live MUFG IPO list |
| POST | `/api/proxy` | PAN search — `{ "clientid", "PAN" }` |
