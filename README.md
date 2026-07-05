# 🍷 AD's Cellar

A beautiful, mobile-first web app to track your wine cellar — inventory, values,
drinking windows, tasting history, food pairings and cellar locations.
Think Vivino × Wine-Searcher × InVintory, but private and yours.

No accounts, no server, no build step: it's a **Progressive Web App (PWA)**.
All data is stored privately on your device and works fully offline.

## Features

- **Inventory** — add wines with a label photo (camera or upload) or by typing.
- **Rich wine info** — producer, vintage, region, appellation, grapes, ABV,
  style, bottle format (piccolo → impériale), drinking window, Vivino & critic
  ratings, market price, purchase price & date, Edulis notes, and your own notes.
- **Cellar locations** — Boxed, Top left, Top right, Bottom left, Bottom right,
  with a tap-able cellar map showing bottle counts per zone.
  (Exact per-bottle rack positions are a planned upgrade.)
- **Collection value** — dashboard with total bottles, current market value,
  total purchase cost, and gain/loss.
- **Drinking window tracker** — each wine is flagged Hold / Ready / Drink soon /
  Past peak based on the current year.
- **Drink a bottle** — log the date, occasion and your rating; quantity drops
  by one and the last bottle moves the wine to your drinking History.
- **Food pairings** — automatic suggestions from a built-in grape & style
  pairing guide (40+ varieties).
- **Quick lookups** — one tap opens Wine-Searcher or Vivino pre-searched for
  the wine, to grab current market prices and ratings.
- **Backup** — export/import the whole collection (including photos and
  history) as a single JSON file.
- **Cross-device sync** — sign in with an email one-time code (Supabase) and
  your wines, history and label photos sync automatically between iPhone,
  iPad and any other device. Data is protected by row-level security; only
  your account can read it.
- **AI label identification** — snap the label, tap "✨ Identify wine from
  photo" and Claude reads the label and pre-fills name, producer, vintage,
  region, grapes, drinking window and a tasting note — you review and save.
  Requires your own Anthropic API key (⚙︎ settings, stored on-device only;
  a scan costs a few cents).

## Install on your iPhone

1. Host this folder anywhere static (GitHub Pages is free — see below).
2. Open the URL in **Safari** on your iPhone.
3. Tap the **Share** button → **Add to Home Screen**.
4. It appears with the wine-glass icon and opens full-screen like a native app,
   working offline.

### Hosting on GitHub Pages

Repo → Settings → Pages → deploy from branch → pick the branch, root folder.
Your app will be at `https://<user>.github.io/wine-app/`.

## About automatic data lookup

Wine-Searcher's API is enterprise-only and Vivino has no public API, so the app
can't silently pull prices — instead each wine has one-tap lookup buttons that
open those sites pre-searched, and you paste the values in (30 seconds per
wine). For bulk enrichment, export your collection JSON and ask Claude to fill
in regions, grapes, drinking windows, ratings and market prices, then import
the enriched file back.

## Setting up sync

The Supabase project URL and publishable key live in `js/config.js`. One-time
setup in the Supabase dashboard: run the SQL in the project docs (tables
`wines`, `drinks` + `labels` storage bucket with RLS), and add `{{ .Token }}`
to **Authentication → Email Templates → Magic Link** so login emails include
the 6-digit code the app asks for.

## Data & privacy

Everything lives in your browser's IndexedDB — nothing leaves the device.
That also means: **export a backup regularly** (⚙︎ → Export collection), and
note that clearing Safari website data would erase the app's storage.

## Roadmap

- Visual rack layout with exact bottle positions (InVintory-style)
- Label photo → auto-fill via OCR/AI
- Cellar statistics (by region, vintage, style)
