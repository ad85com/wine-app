# Substack post downloader

`substack_download.py` downloads the **full post history** of one or more
Substack publications you read — as Markdown (with metadata front matter),
the original HTML, or both, with optional local image download. It uses the
same JSON API the Substack website itself uses.

No installation needed — it's a single file using only the Python 3 standard
library (Python 3.8+).

## Quick start

```bash
# One publication, Markdown only
python3 tools/substack_download.py https://someauthor.substack.com

# Several publications, Markdown + HTML + images, into ~/substack-archive
python3 tools/substack_download.py \
    someauthor.substack.com anotherauthor.substack.com https://www.custom-domain.com \
    --format both --images --out ~/substack-archive
```

Output layout (one folder per publication):

```
substack-archive/
  someauthor-substack-com/
    index.json                          # all archive metadata
    0001_2021-03-15_first-post.md       # numbered oldest → newest
    0002_2021-03-22_second-post.md
    ...
    images/                             # with --images
```

Re-running is safe and fast: posts already on disk are skipped, so you can
re-run any time to pick up new posts (or after fixing a cookie to fill in
the paywalled ones). Use `--force` to re-download everything.

## Paywalled posts (subscriber content)

Free posts need nothing. For **paywalled posts on publications you're
subscribed to**, the script needs your Substack session cookie so the API
answers as you:

1. In your browser, open the publication and make sure you're signed in
   (a paywalled post should show in full).
2. Open developer tools (F12 / ⌥⌘I) → **Application** (Chrome) or
   **Storage** (Firefox) → **Cookies** → select the publication's site.
3. Find the cookie named **`substack.sid`** and copy its value.
4. Put it in a file, e.g. `cookie.txt`:

   ```
   substack.sid=PASTE_THE_VALUE_HERE
   ```

5. Run with `--cookie-file cookie.txt`.

Notes:

- For publications on a **custom domain** (not `*.substack.com`), copy the
  `substack.sid` cookie **from that domain** — sessions are per-site.
- The cookie is your login session — treat it like a password. Don't commit
  `cookie.txt`, and prefer `--cookie-file` over `--cookie` so the value
  doesn't end up in your shell history.
- Sessions expire after a while; if previously-working posts start showing
  as `LOCKED`, copy a fresh cookie.
- Posts you are *not* entitled to (publications where you're a free
  subscriber) will simply be reported as `LOCKED` and skipped.

## Options

| Option | Meaning |
| --- | --- |
| `--out DIR` | Output directory (default `./substack-archive`) |
| `--format md\|html\|both` | Output format (default `md`) |
| `--images` | Download images next to the posts and rewrite links |
| `--cookie-file FILE` | File containing your `substack.sid=...` cookie |
| `--cookie "substack.sid=..."` | Same, inline (visible in shell history) |
| `--delay SECONDS` | Pause between requests (default 0.5 — be polite) |
| `--force` | Re-download posts that already exist |

## What gets saved per post

- Markdown with YAML front matter: title, subtitle, date, authors, canonical
  URL, post type, paywalled flag, and the audio URL for podcast episodes.
- Headings, lists (nested), links, images, blockquotes, code blocks, and
  embeds all convert cleanly; anything exotic degrades to plain text, and
  `--format both` keeps the original HTML as a fallback.

This tool is for personal archiving of content you have legitimate access
to. Please respect authors' rights — don't republish their paywalled work.
