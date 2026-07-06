# Edulis email → cellar pipeline

How Claude processes Edulis emails forwarded to **claude@ad85.com** and turns
them into wines and notes in AD's Cellar. This doc is the runbook for Claude
sessions; the owner just forwards emails and says "process my Edulis emails"
(including the app password for that run).

Two email kinds, detected from content:

- **Order / purchase emails** (order confirmations, invoices, offers the
  owner bought from) → **create or top-up wines** in the collection.
- **Marketing / tasting-note emails** about a wine → **attach Edulis notes**
  to the matching wine.

Some emails are both — an offer with tasting notes that the owner ordered
from. Apply both treatments.

## Order emails → creating wines

1. Extract each line item: wine name, producer, vintage, bottle format,
   **quantity** (Edulis sells in cases of 3/6/12), and **unit price in CHF**.
2. **VAT**: Edulis prices are **excl. VAT** — store the email's unit price
   directly as `purchasePrice` (the app stores excl.-VAT prices and adds
   the 8.1% Swiss VAT itself for all displays and totals). Do NOT divide
   or otherwise adjust the price.
3. `purchaseDate` = the original order email date (YYYY-MM-DD).
4. If the wine already exists in the collection (same name + vintage):
   **increase `quantity`** by the ordered amount and update purchase info
   only if empty — don't clobber owner-entered data.
5. If new: create the wine record. Fields from the email as above, plus
   Claude enriches from its own knowledge / web research:
   `style`, `country`, `region`, `appellation`, `grapes`, `abv`,
   `drinkFrom`/`drinkTo`, and (when found) `ratingVivino`, `ratingCritic`,
   `marketPrice` (+`marketCurrency`). `location` defaults to `boxed`.
   Record shape: copy an existing row's `data` for reference; required
   basics are `id` (e.g. `edulis-<timestamp>-<n>`), `status:'cellar'`,
   `createdAt`/`updatedAt` (ms), `name`, `quantity`, `size` (map formats:
   75cl→`standard`, 150cl→`magnum`, 37.5cl→`demi`).
6. If the email carries tasting notes, also fill the Edulis note fields
   (below).
7. Report to the owner: wines created/topped up with quantities and prices,
   plus anything ambiguous that needs their confirmation.

## Marketing emails → Edulis notes

1. Owner receives an Edulis marketing email about a wine, buys (or not),
   and forwards the email to `claude@ad85.com`.
2. In a Claude session, the owner asks to process the emails.
3. Claude (via the Gmail MCP tools on claude@ad85.com):
   - `search_threads` with e.g. `subject:(edulis OR fwd) newer_than:90d`
     (or all unprocessed mail), then `get_thread` for full bodies.
   - For each forwarded email, extract:
     - **wine identity**: name, producer, vintage (from subject/body)
     - **headline**: one-line summary (subject line, cleaned of Fwd:/Re:)
     - **body**: the full Edulis text about the wine (strip marketing
       boilerplate, unsubscribe footers, images)
     - **original date**: the date of the *original* Edulis email (from the
       forwarded header block `From: ... Date: ...`), NOT the forward date
4. Match each email to a wine in the collection (fetch all rows, match on
   name + vintage, fuzzy on accents/spacing). If ambiguous or no match,
   ask the owner instead of guessing (the wine may not be added yet — offer
   to create it).
5. Update the matched wine's `data` jsonb:
   - `edulisTitle` — headline
   - `edulisBody`  — full text
   - `edulisDate`  — original email date (YYYY-MM-DD)
   - `purchaseDate` — set to the original email date **only if empty**
   - `updatedAt` — `Date.now()` (ms) so devices pick up the change (LWW)
   and set the row's `updated_at` to `now()` ISO string.
6. After processing, label/archive the email in Gmail (e.g. label
   `processed`) so it isn't re-processed, and report to the owner which
   wines were updated.

## Writing to Supabase

Data lives in the `wines` table (`id text, user_id uuid, data jsonb,
updated_at timestamptz`) at the project in `js/config.js`, protected by RLS.
Claude authenticates as the owner via the password grant:

```
POST {SUPABASE_URL}/auth/v1/token?grant_type=password
apikey: {publishable key}
{"email": "<owner email>", "password": "<app password>"}
→ access_token
```

Then read/update rows:

```
GET  {SUPABASE_URL}/rest/v1/wines?select=id,data
PATCH {SUPABASE_URL}/rest/v1/wines?id=eq.<id>
  headers: apikey, Authorization: Bearer <access_token>,
           Content-Type: application/json, Prefer: return=minimal
  body: {"data": {...merged...}, "updated_at": "<now ISO>"}
```

**Credentials:** ask the owner for the app email + password at runtime.
Never commit them to the repo or store them in files.

## App display

The wine detail page shows `edulisTitle` as a tappable row; tapping expands
`edulisBody` with the `edulisDate` footer. Legacy field `edulisNotes` (from
early versions) is still displayed as the body if the new fields are empty.
