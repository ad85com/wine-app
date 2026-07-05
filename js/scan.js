/* ============================================================
   scan.js — identify a wine from its label photo using Claude
   Sends the (already compressed) label photo to the Claude API
   directly from the browser, gets structured wine data back,
   and pre-fills the add/edit form for the user to confirm.
   Requires the user's own API key, stored only on-device.
   ============================================================ */

'use strict';

const CLAUDE_KEY_LS = 'claude-api-key';

async function identifyLabel() {
  const btn = document.getElementById('identifyBtn');
  const key = (localStorage.getItem(CLAUDE_KEY_LS) || '').trim();
  if (!key) {
    toast('Add your Claude API key in ⚙︎ settings first');
    return;
  }

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
    toast('Add a label photo first 📷');
    return;
  }

  btn.disabled = true;
  const origLabel = btn.textContent;
  btn.textContent = '🔎 Identifying…';

  try {
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });

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
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
            {
              type: 'text',
              text: 'Identify this wine from its label. Respond with ONLY a JSON object (no markdown, no commentary) with exactly these keys, using null for anything you cannot determine: '
                + '"name" (string, the wine name as on the label), "producer" (string), "vintage" (integer year), '
                + '"style" (one of: "red","white","rose","sparkling","sweet","fortified"), '
                + '"country" (string), "region" (string), "appellation" (string), '
                + '"grapes" (array of grape variety strings — use the typical blend for this wine if not on the label), '
                + '"abv" (number, from the label if visible), '
                + '"drinkFrom" (integer year) and "drinkTo" (integer year) for the typical drinking window of this wine and vintage, '
                + '"description" (one sentence about this wine\'s character). '
                + 'Be accurate rather than complete — prefer null over guessing.',
            },
          ],
        }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const msg = err?.error?.message || `HTTP ${resp.status}`;
      throw new Error(resp.status === 401 ? 'API key rejected — check it in settings' : msg);
    }

    const data = await resp.json();
    if (data.stop_reason === 'refusal' || !data.content?.length) {
      throw new Error('Claude could not analyse this photo');
    }

    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No wine details found in the response');
    const w = JSON.parse(match[0]);

    fillFormFromScan(w);
    toast('✨ Identified! Check the details, then save');
  } catch (e) {
    console.warn('identify failed', e);
    toast('Could not identify: ' + (e.message || e));
  } finally {
    btn.disabled = false;
    btn.textContent = origLabel;
  }
}

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
  const notes = document.getElementById('f-notes');
  if (w.description && !notes.value) notes.value = w.description;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('identifyBtn')?.addEventListener('click', identifyLabel);
  const keyInput = document.getElementById('claudeKeyInput');
  if (keyInput) {
    keyInput.value = localStorage.getItem(CLAUDE_KEY_LS) || '';
    keyInput.addEventListener('change', () => {
      localStorage.setItem(CLAUDE_KEY_LS, keyInput.value.trim());
      toast(keyInput.value.trim() ? 'API key saved on this device' : 'API key removed');
    });
  }
});
