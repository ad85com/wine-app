/* ============================================================
   scan.js — identify a wine with Claude, two ways:
   1. from its label/box photo (vision)
   2. from just the name + vintage typed into the form
   Either way Claude returns structured wine data and the form is
   pre-filled for the user to confirm. Requires the user's own API
   key, stored only on-device.
   ============================================================ */

'use strict';

const CLAUDE_KEY_LS = 'claude-api-key';

const WINE_JSON_SPEC =
  'Respond with ONLY a JSON object (no markdown, no commentary) with exactly these keys, using null for anything you cannot determine: '
  + '"name" (string, the wine name), "producer" (string), "vintage" (integer year), '
  + '"style" (one of: "red","white","rose","sparkling","sweet","fortified"), '
  + '"country" (string), "region" (string), "appellation" (string), '
  + '"grapes" (array of grape variety strings — use the typical blend for this wine if unknown), '
  + '"abv" (number), '
  + '"drinkFrom" (integer year) and "drinkTo" (integer year) for the typical drinking window of this wine and vintage, '
  + '"ratingVivino" (number 0-5, the approximate Vivino community rating if you know it), '
  + '"ratingCritic" (integer 0-100, an approximate critic score if you know it), '
  + '"description" (one sentence about this wine\'s character), '
  + '"bottleCount" (integer — if a photo shows a case or box, how many bottles it holds, e.g. "6 bouteilles" or "12x75cl"; also count multiple identical visible bottles; null for a single bottle or a text-only request). '
  + 'Be accurate rather than complete — prefer null over guessing.';

function getClaudeKey() {
  const key = (localStorage.getItem(CLAUDE_KEY_LS) || '').trim();
  if (!key) toast('Add your Claude API key in ⚙︎ settings first');
  return key || null;
}

async function callClaude(key, content) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const msg = err?.error?.message || `HTTP ${resp.status}`;
    throw new Error(resp.status === 401 ? 'API key rejected — check it in settings' : msg);
  }

  const data = await resp.json();
  if (data.stop_reason === 'refusal' || !data.content?.length) {
    throw new Error('Claude could not answer this request');
  }
  const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No wine details found in the response');
  return JSON.parse(match[0]);
}

async function withButtonSpinner(btn, working, fn) {
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = working;
  try {
    await fn();
  } catch (e) {
    console.warn('lookup failed', e);
    toast('Could not fetch: ' + (e.message || e));
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

/* ---------------- 1. identify from photo ---------------- */
async function identifyLabel() {
  const key = getClaudeKey();
  if (!key) return;

  // use the freshly selected photo, or the stored one when editing
  let blob = pendingPhoto;
  if (!blob) {
    const id = document.getElementById('f-id').value;
    if (id) {
      const rec = await db.get('photos', id);
      blob = rec && rec.blob;
    }
  }
  if (!blob) {
    toast('Add a label photo first 📷 — or type the name and use “Fetch details”');
    return;
  }

  await withButtonSpinner(document.getElementById('identifyBtn'), '🔎 Identifying…', async () => {
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });

    const w = await callClaude(key, [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
      { type: 'text', text: 'Identify this wine from its label — the photo may show a single bottle, a wine label, or a case/box of wine. ' + WINE_JSON_SPEC },
    ]);

    fillFormFromScan(w);
    if (w.bottleCount > 1) {
      document.getElementById('f-quantity').value = w.bottleCount;
      toast(`✨ Looks like a case of ${w.bottleCount} — quantity set to ${w.bottleCount}. Check & save`);
    } else {
      toast('✨ Identified! Check the details, then save');
    }
  });
}

/* ---------------- 2. fetch from name + vintage ---------------- */
async function fetchByName() {
  const key = getClaudeKey();
  if (!key) return;

  const name = document.getElementById('f-name').value.trim();
  const vintage = document.getElementById('f-vintage').value.trim();
  if (!name) {
    toast('Type the wine name first (vintage helps too)');
    return;
  }

  await withButtonSpinner(document.getElementById('fetchByNameBtn'), '🔎 Fetching…', async () => {
    const w = await callClaude(key, [
      {
        type: 'text',
        text: `Identify the wine "${name}"${vintage ? `, vintage ${vintage}` : ''}. `
          + 'If the name is ambiguous, pick the best-known wine matching it. '
          + WINE_JSON_SPEC,
      },
    ]);
    fillFormFromScan(w);
    toast('✨ Details filled in — check & adjust, then save');
  });
}

/* ---------------- shared form fill ---------------- */
function fillFormFromScan(w) {
  const set = (id, v) => { if (v != null && v !== '') document.getElementById(id).value = v; };
  set('f-name', w.name);
  set('f-producer', w.producer);
  set('f-vintage', w.vintage);
  if (w.style && ['red', 'white', 'rose', 'sparkling', 'sweet', 'fortified'].includes(w.style)) {
    document.getElementById('f-style').value = w.style;
  }
  set('f-country', w.country);
  set('f-region', w.region);
  set('f-appellation', w.appellation);
  if (Array.isArray(w.grapes) && w.grapes.length) set('f-grapes', w.grapes.join(', '));
  set('f-abv', w.abv);
  set('f-drinkFrom', w.drinkFrom);
  set('f-drinkTo', w.drinkTo);
  set('f-ratingVivino', w.ratingVivino);
  set('f-ratingCritic', w.ratingCritic);
  const notes = document.getElementById('f-notes');
  if (w.description && !notes.value) notes.value = w.description;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('identifyBtn')?.addEventListener('click', identifyLabel);
  document.getElementById('fetchByNameBtn')?.addEventListener('click', fetchByName);
  const keyInput = document.getElementById('claudeKeyInput');
  if (keyInput) {
    keyInput.value = localStorage.getItem(CLAUDE_KEY_LS) || '';
    keyInput.addEventListener('change', () => {
      localStorage.setItem(CLAUDE_KEY_LS, keyInput.value.trim());
      toast(keyInput.value.trim() ? 'API key saved on this device' : 'API key removed');
    });
  }
});
