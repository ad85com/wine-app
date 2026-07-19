# 🧸 Dose Diary — allergen dosing tracker

A private, mobile-first web app to track **oral immunotherapy (OIT)** — the small,
gradually increasing allergen doses used to desensitise a child to a food allergy —
along with any reactions and the progress over time.

Built for parents doing OIT under an allergist's supervision. No accounts, no
server, no build step: it's a **Progressive Web App (PWA)**, everything is stored
privately on your device, and it works fully offline.

> ⚕️ **Not medical advice.** Dose Diary is a diary, not a protocol. Only ever
> change a dose on the written instruction of your allergist. If your child shows
> signs of a severe reaction — trouble breathing, throat/face swelling, repeated
> vomiting, floppiness/collapse — give adrenaline (EpiPen) and call emergency
> services immediately.

## What it does

- **Allergens** — set up each food being desensitised (peanut, egg, milk, cashew…)
  with its emoji, **today's target dose**, unit (mg / ml / drops / g), start date,
  a maintenance goal, and your allergist's protocol notes.
- **Today** — one card per allergen showing today's target dose and whether it's
  been given, with a one-tap **Log today's dose** button.
- **Log a dose** — records amount, unit, date/time, a **reaction level**
  (none / mild / moderate / severe), tap-to-add **symptoms**, and free notes.
  Severe reactions surface a safety reminder.
- **Dose log** — full history grouped by day, colour-coded by reaction, filterable
  per allergen.
- **Progress** — per-allergen chart of dose over time with reaction-coloured points,
  plus stats (start→current dose, highest reached, days dosed, reactions) and
  progress toward the maintenance goal, and a running **day streak** so daily
  dosing stays consistent.
- **Export for your doctor** — one tap exports the dose log as **CSV** (opens in any
  spreadsheet) to bring to clinic visits.
- **Backup** — export/import everything as a single JSON file.

## Install on your phone

1. Host this folder anywhere static (GitHub Pages is free).
2. Open the URL in **Safari** (iPhone) or **Chrome** (Android).
3. **Share → Add to Home Screen** (iOS) / **⋮ → Install app** (Android).
4. It opens full-screen like a native app and works offline.

If deployed alongside the sibling app in this repo, the URL is
`https://<user>.github.io/wine-app/allergen-tracker/`.

## Data & privacy

Everything lives in your browser's local storage — nothing is uploaded anywhere.
That means: **export a backup regularly** (⚙︎ → Export everything), and note that
clearing your browser's website data would erase it.
