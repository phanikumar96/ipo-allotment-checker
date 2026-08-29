# ipo-allotment-checker

IPO allotment checker for **KFINTECH** and **MUFG** registrars.

Live site: [phanikumar96.github.io/ipo-allotment-checker](https://phanikumar96.github.io/ipo-allotment-checker/)

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

### 2. Vercel (MUFG API — required)

1. Import this repo at [vercel.com/new](https://vercel.com/new).
2. Deploy — Vercel serves `index.html` and runs `api/proxy.js` at `/api/proxy`.
3. On GitHub Pages, MUFG auto-uses `https://ipo-allotment-checker.vercel.app/api/proxy`.

Optional: add `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` GitHub secrets for `.github/workflows/vercel.yml` auto-deploy.

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
