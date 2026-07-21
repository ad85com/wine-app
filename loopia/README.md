# AD's Cellar — Loopia build (server-backed)

Single-file frontend for the live backend at `https://wine.ad85.com/api/api.php`
(PHP 8.4 + MariaDB on Loopia).

## Deploy (2 minutes, Total Commander / FTP)

1. Open `index.html` in a text editor, find the line near the top of the script:

       const API_TOKEN = 'REPLACE_TOKEN';

   and paste your token from `api/config.php` between the quotes.
2. Upload **only `index.html`** into `public_html/` on Loopia (next to the
   existing `api/` folder — leave `api/` untouched).
3. Open `https://wine.ad85.com/` — the settings sheet (⚙︎) shows
   "✅ Connected" when everything is wired.

## Migrate the old data

Settings (⚙︎) → **Migrate / restore to server** → pick the JSON you exported
from the old artifact version. This wipes the server and loads your wines,
drinking history and label photos (photos stay on the device, matched by
name + vintage). The same button restores a server backup JSON.

## What changed vs. the old build

- All persistence is now the Loopia API (`?r=all` on boot, write-through on
  every change). No more browser-only storage.
- New **Racks** tab: define racks/fridges/cases with a grid, tap a slot to
  place a bottle in its exact position. The server enforces one bottle per
  slot (occupied slot → friendly "already occupied" message).
- Offline / server-down: the app falls back to the last cached snapshot in
  read-only mode with a banner; edits are blocked until reconnected.
- Everything else (look, themes, Claude label identify, Edulis notes, CHF/VAT
  pricing, pairings, pull-to-refresh, iPhone/iPad home-screen) unchanged.

`src/` holds the pieces (`body.html`, `core.js`, `extra.css`, `pairings.js`);
`index.html` is assembled from them and is the only file to upload.
