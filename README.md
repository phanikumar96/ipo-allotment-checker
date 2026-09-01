# ipo-allotment-checker

IPO allotment checker for **KFINTECH** and **MUFG** registrars.

Live site: [phanikumar96.github.io/ipo-allotment-checker](https://phanikumar96.github.io/ipo-allotment-checker/)

Live Site: [ipo-allotment-checker-two.vercel.app](https://ipo-allotment-checker-two.vercel.app/)



## Features

- Check multiple PANs at once
- KFINTECH (manual Client ID) or MUFG (IPO dropdown — client ID sent automatically)
- Excel / CSV export, charts, dark mode

### Filtering results

The results toolbar has two chip rows — **Result** (Allotted / No Allotment / Not
Found / Issues) and **Category** (Retail / S-HNI / B-HNI / N/A). They answer two
different questions, so:

- A plain click leaves **exactly one** filter active: picking a Category clears
  the Result row and vice versa. Clicking the lit chip again clears it.
- **Shift / Ctrl / Cmd-click** combines the two rows instead of replacing.
- Every active filter shows as a pill with its own ✕, so one can be dropped
  without clearing the rest.
- The number on a chip is what a plain click on it actually gives you. A chip
  with 0 is dimmed but still clickable.

The IPO dropdown is an in-window panel (not the OS `<select>` popup), so long IPO
names wrap inside the field's width instead of running off the side of the screen
on a phone. It is keyboard-navigable and has a type-to-filter box.

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

> **After a push, give Vercel a few minutes.** Vercel deploys this repo through
> its own Git integration, and it has taken up to ~20 minutes to serve a new
> `index.html`. GitHub Pages usually updates first, so the two URLs can disagree
> for a while. The **Verify Vercel deployment** Action polls the Vercel URL after
> any push that touches `index.html` or `api/`, and fails if the change never
> goes live — so a stale site is visible instead of silent. It deploys nothing
> and needs no secrets; if the Git integration ever gets disconnected, reconnect
> it in the Vercel dashboard.
3. On the GitHub Pages site, select **MUFG**, pick an IPO (or **enter Client ID manually** if the IPO is not listed yet), and click **Check All PANs**.

The Pages site auto-uses `https://ipo-allotment-checker-two.vercel.app` for both
`/api/proxy` (MUFG PAN checks) and `/api/pans` (shared list). If you rename the
Vercel project, update the candidate list in `mugProxyCandidates()` in
`index.html`, or just paste the new URL into **Advanced → CORS proxy prefix**.

### 3. Shared PAN list (required for the list to be shared)

The PAN list lives in Redis behind `/api/pans`, so everyone opening the site sees
the same PANs and a PAN one person adds shows up for everyone else on their next
refresh. **It is append-only: nothing is ever deleted server-side.** "Remove" on a
chip only hides that PAN in the browser that clicked it.

One-time setup:

1. Create a free Redis database — either **Vercel → Storage → Upstash Redis**
   (env vars are injected automatically) or a free database at
   [upstash.com](https://upstash.com).
2. If you created it at Upstash directly, add these to
   **Vercel → Project → Settings → Environment Variables**:

   | Name | Value |
   |------|-------|
   | `UPSTASH_REDIS_REST_URL` | REST URL from the Upstash console |
   | `UPSTASH_REDIS_REST_TOKEN` | REST token from the Upstash console |

   (`KV_REST_API_URL` / `KV_REST_API_TOKEN` are also accepted, which is what
   Vercel's own KV integration sets.)
3. Redeploy. On first load the site seeds the store with `BASELINE_PANS` from
   `index.html`, so the list starts out full rather than empty.

Until this is configured the site still works — it falls back to `BASELINE_PANS`
plus whatever is in that browser's `localStorage`. It says so rather than
pretending an add was published, and it distinguishes the two cases:

| Status line under the PAN chips | Meaning |
|---|---|
| ✓ `shared with everyone · N PANs` | Redis is wired up; adds reach other people |
| • `sharing off — this device only` + `how to turn it on` | `/api/pans` answered **501**: the function is deployed but no store is attached. Not an error — the link opens the setup steps above, inline in the page. |
| ⚠ `shared list unreachable — this device only` + `retry` | nothing answered at all |

Anyone who can open the site can **add** PANs. Nobody can remove them.

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
| GET | `/api/pans` | Shared PAN list — `{ "pans": [...], "count": n }` |
| POST | `/api/pans` | Add PANs — `{ "pans": ["ABCDE1234F", ...] }`, returns the merged list. Invalid PANs are dropped; duplicates keep their original position. |
| DELETE | `/api/pans` | **405** — the shared list is append-only by design |

## Tests

```bash
node scripts/test-filters.js            # chip counts match the rows a click gives; one click = one filter
node scripts/test-category-sheet.js     # Excel "By Category" cross-sheet formulas
node scripts/test-pans-api.js           # shared list: append-only, dedupe, order, 501 when unconfigured
node scripts/test-e2e-shared-pans.js    # real Chromium: load / add / other user refreshes,
                                        # dropdown stays in the window, chips are visible, badge wording
```
