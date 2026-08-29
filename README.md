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

### 2. Render (MUFG PAN search — one-time setup)

The IPO dropdown loads from a static `ipos.json` on GitHub Pages. Checking PANs still needs the API proxy.

1. Open [Render Blueprint deploy](https://render.com/deploy?repo=https://github.com/phanikumar96/ipo-allotment-checker)
2. Click **Deploy** (free tier)
3. After deploy, the site auto-uses `https://ipo-allotment-checker-api.onrender.com/api/proxy` for MUFG PAN checks

The IPO list refreshes automatically on every push to `main`.

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
