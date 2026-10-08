/* TCM Lecture Reader v8
 * Chinese-first live transcript with slide-aware vocabulary, sentence-level
 * translation, and post-class export. Everything runs in the browser.
 *
 * Sections:
 *   1. utils            6. session + rendering
 *   2. settings         7. Soniox (WebSocket + audio)
 *   3. IndexedDB        8. translation queue
 *   4. pinyin/segment   9. slide matching
 *   5. decks           10. popover/vocab, export, test mode, wiring
 */
'use strict';

/* ============================== 1. utils ============================== */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isHanzi = (ch) => /[一-鿿]/.test(ch);
const hanziOnly = (s) => (s.match(/[一-鿿]/g) || []).join('');
const fmtTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const SENT_END = /[。！？；…!?]$/;
const SOFT_END = /[，、,]$/;

function setStatus(msg, kind) {
  const el = $('status');
  el.textContent = msg;
  el.className = kind || '';
}

/* ============================== 2. settings ============================== */
const PROVIDERS = {
  gemini: { endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', models: ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'] },
  openrouter: { endpoint: 'https://openrouter.ai/api/v1/chat/completions', models: ['deepseek/deepseek-chat', 'qwen/qwen3-235b-a22b', 'google/gemini-3.5-flash', 'anthropic/claude-haiku-5.5'] },
  deepseek: { endpoint: 'https://api.deepseek.com/chat/completions', models: ['deepseek-chat'] },
  dashscope: { endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', models: ['qwen-flash', 'qwen-plus', 'qwen-turbo'] },
  custom: { endpoint: '', models: [] },
};
const DEFAULTS = {
  sonioxKey: '', epDelay: 1500, epSens: 0.2, paraGap: 2.5,
  provider: 'gemini', model: 'gemini-3.5-flash', endpoint: PROVIDERS.gemini.endpoint, llmKey: '',
  trMode: 'all', batchN: 3, batchS: 8, jsonMode: true, termGloss: true, extraPrompt: '',
  glossary: '证 = pattern (zhèng), not 症 symptom\n辨证论治 = pattern differentiation and treatment\n气血 = qi and blood\n阴阳 = yin and yang',
  ghOwner: '', ghRepo: '', ghPath: 'decks', ghBranch: 'main',
  theme: 'dark', zhSize: 24, rulerMin: 5,
  simText: '', simSpeed: 6,
  showPinyin: true, showEn: true, showHl: true, showSide: true, slideAuto: true,
  sonioxAuth: 'protocol',
};
let S = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('v8.settings') || '{}'));
const saveSettings = () => localStorage.setItem('v8.settings', JSON.stringify(S));

const SETTING_IDS = ['sonioxKey', 'epDelay', 'epSens', 'paraGap', 'provider', 'model', 'endpoint', 'llmKey', 'trMode', 'batchN', 'batchS', 'jsonMode', 'termGloss', 'extraPrompt', 'glossary', 'ghOwner', 'ghRepo', 'ghPath', 'ghBranch', 'theme', 'zhSize', 'rulerMin', 'simText', 'simSpeed'];

function settingsToUI() {
  for (const id of SETTING_IDS) {
    const el = $(id); if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!S[id]; else el.value = S[id];
  }
  fillModelList();
  applyDisplay();
}
function uiToSettings() {
  for (const id of SETTING_IDS) {
    const el = $(id); if (!el) continue;
    if (el.type === 'checkbox') S[id] = el.checked;
    else if (el.type === 'number') S[id] = Number(el.value);
    else S[id] = el.value;
  }
  saveSettings();
  applyDisplay();
}
function fillModelList() {
  const p = PROVIDERS[S.provider] || PROVIDERS.custom;
  $('modelList').innerHTML = p.models.map((m) => `<option value="${esc(m)}">`).join('');
}
function applyDisplay() {
  document.documentElement.dataset.theme = S.theme;
  document.documentElement.style.setProperty('--zh-size', S.zhSize + 'px');
  document.body.classList.toggle('nopinyin', !S.showPinyin);
  document.body.classList.toggle('nohl', !S.showHl);
  document.body.classList.toggle('sidehidden', !S.showSide);
  $('side').classList.toggle('hidden', !S.showSide);
  $('tgPinyin').classList.toggle('on', S.showPinyin);
  $('tgEn').classList.toggle('on', S.showEn);
  $('tgHl').classList.toggle('on', S.showHl);
  $('tgSide').classList.toggle('on', S.showSide);
  $('slideAuto').classList.toggle('on', S.slideAuto);
  document.querySelectorAll('.sent .en').forEach((en) => {
    if (en.dataset.has === '1') en.classList.toggle('hidden', !S.showEn && en.dataset.forced !== '1');
  });
}

/* ============================== 3. IndexedDB ============================== */
const DB = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('tcm-reader-v8', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('decks')) db.createObjectStore('decks', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const st = t.objectStore(store);
      const req = fn(st);
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  }
  return {
    put: (store, obj) => tx(store, 'readwrite', (st) => st.put(obj)),
    get: (store, id) => tx(store, 'readonly', (st) => st.get(id)),
    all: (store) => tx(store, 'readonly', (st) => st.getAll()),
    del: (store, id) => tx(store, 'readwrite', (st) => st.delete(id)),
    clear: (store) => tx(store, 'readwrite', (st) => st.clear()),
  };
})();

/* ============================== 4. pinyin / segmentation ============================== */
// Forward maximum match against the CC-CEDICT word list (lib/zh-words.js).
function segment(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    if (!isHanzi(text[i])) { out.push(text[i]); i++; continue; }
    let m = null;
    for (let len = Math.min(ZH_MAX_WORD_LEN, text.length - i); len >= 1; len--) {
      const c = text.slice(i, i + len);
      if (len === 1 || ZH_WORDS.has(c)) { m = c; break; }
    }
    out.push(m); i += m.length;
  }
  return out;
}
function pinyinOf(text) {
  try { return pinyinPro.pinyin(text, { type: 'array' }); } catch (e) { return text.split('').map(() => ''); }
}
// Ruby HTML for one sentence. hl = boolean mask per char (on-slide words).
function rubyHtml(text, hl) {
  const segs = segment(text);
  const py = pinyinOf(text);
  let idx = 0, html = '';
  for (const seg of segs) {
    if (isHanzi(seg[0])) {
      let inner = '';
      for (let k = 0; k < seg.length; k++) {
        const cls = hl && hl[idx + k] ? ' class="onslide"' : '';
        inner += `<ruby${cls}>${esc(seg[k])}<rt>${esc(py[idx + k] || '')}</rt></ruby>`;
      }
      html += `<span class="w" data-w="${esc(seg)}">${inner}</span>`;
    } else {
      html += esc(seg);
    }
    idx += seg.length;
  }
  return html;
}

/* ============================== 5. decks ============================== */
const Deck = {
  remote: [],   // [{id, name, url, size}]
  local: [],    // [{id, name, data}]
  cache: new Map(),

  ghCoords() {
    let owner = S.ghOwner, repo = S.ghRepo;
    const host = location.hostname;
    if ((!owner || !repo) && /\.github\.io$/.test(host)) {
      owner = owner || host.split('.')[0];
      repo = repo || location.pathname.split('/').filter(Boolean)[0] || '';
    }
    return { owner, repo, path: (S.ghPath || 'decks').replace(/^\/|\/$/g, ''), branch: S.ghBranch || 'main' };
  },
  displayName: (fn) => fn.replace(/\.merged\.deck\.json$|\.deck\.json$|\.json$/i, ''),

  async listRemote() {
    const { owner, repo, path, branch } = this.ghCoords();
    const rel = `../${path}/`;
    const out = [];
    let ok = false;
    if (owner && repo) {
      try {
        const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`, { headers: { Accept: 'application/vnd.github+json' } });
        if (r.ok) {
          const arr = await r.json();
          for (const f of arr) {
            if (f.type !== 'file' || !/\.json$/i.test(f.name) || f.name === 'index.json') continue;
            out.push({ id: 'remote:' + f.name, name: this.displayName(f.name), file: f.name, urls: [rel + f.name, f.download_url], size: f.size });
          }
          ok = true;
        }
      } catch (e) { /* fall through */ }
    }
    if (!ok) {
      try {
        const r = await fetch(rel + 'index.json', { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          const names = Array.isArray(j) ? j : (j.decks || []);
          for (const n of names) {
            const file = typeof n === 'string' ? n : n.file || n.name;
            if (!file) continue;
            out.push({ id: 'remote:' + file, name: this.displayName(file), file, urls: [rel + file], size: 0 });
          }
        }
      } catch (e) { /* no index */ }
    }
    this.remote = out;
    return out;
  },
  async listLocal() {
    this.local = (await DB.all('decks')) || [];
    return this.local;
  },
  async fetchRemote(entry) {
    if (this.cache.has(entry.id)) return this.cache.get(entry.id);
    let lastErr = null;
    for (const u of entry.urls.filter(Boolean)) {
      try {
        const r = await fetch(u, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = this.normalize(await r.json());
        this.cache.set(entry.id, data);
        return data;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('fetch failed');
  },
  normalize(raw) {
    const arr = Array.isArray(raw) ? raw : (raw.slides || raw.deck || []);
    const slides = [];
    for (const s of arr) {
      const clauses = (s.clauses || []).map((c) => ({ zh: String(c.zh || ''), pinyin: c.pinyin || '', en: c.en || '' })).filter((c) => c.zh);
      if (!clauses.length) continue;
      slides.push({ slide: Number(s.slide) || slides.length + 1, mode: s.mode || 'aligned', clauses, en_whole: s.en_whole || '' });
    }
    if (!slides.length) throw new Error('Not a deck: no slides with clauses found');
    return slides;
  },
  async addLocalFiles(files) {
    for (const f of files) {
      try {
        const data = this.normalize(JSON.parse(await f.text()));
        const id = 'local:' + f.name;
        await DB.put('decks', { id, name: this.displayName(f.name), file: f.name, data, addedAt: Date.now() });
      } catch (e) { alert(`${f.name}: ${e.message}`); }
    }
    await this.listLocal();
  },
};

function parseRange(str, max) {
  if (!str || !str.trim()) return null;
  const set = new Set();
  for (const part of str.split(/[,，\s]+/)) {
    const m = part.match(/^(\d+)\s*[-–~到]\s*(\d+)$/);
    if (m) { for (let i = +m[1]; i <= +m[2]; i++) set.add(i); }
    else if (/^\d+$/.test(part)) set.add(+part);
  }
  return set.size ? set : null;
}

// Build the per-session index: slides, bigram index with IDF, n-gram set for
// highlighting, and the vocabulary list for Soniox.
function buildSessionIndex(deckEntries) {
  const slides = [];
  for (const d of deckEntries) {
    const range = parseRange(d.range);
    for (const s of d.data) {
      if (range && !range.has(s.slide)) continue;
      slides.push({ deck: d.name, slide: s.slide, clauses: s.clauses, en_whole: s.en_whole, text: s.clauses.map((c) => c.zh).join('') });
    }
  }
  // highlight n-grams (2..6) and slide bigrams
  const ngrams = new Set();
  const df = new Map();
  for (const sl of slides) {
    const h = hanziOnly(sl.text);
    sl.bigrams = new Set();
    for (let i = 0; i + 1 < h.length; i++) sl.bigrams.add(h.slice(i, i + 2));
    for (const b of sl.bigrams) df.set(b, (df.get(b) || 0) + 1);
    for (const c of sl.clauses) {
      // n-grams within a clause only (so we do not bridge clause boundaries)
      const runs = c.zh.split(/[^一-鿿]+/).filter(Boolean);
      for (const run of runs) for (let n = 2; n <= 6; n++) for (let i = 0; i + n <= run.length; i++) ngrams.add(run.slice(i, i + n));
    }
  }
  const N = slides.length || 1;
  const idf = (b) => Math.log(1 + N / (df.get(b) || 1));
  return { slides, ngrams, idf, terms: extractTerms(slides) };
}

// Vocabulary for Soniox: glossary terms + dictionary words of 3+ chars found in
// the slides + out-of-vocabulary hanzi runs (likely jargon), ranked by frequency.
const STOP_CHARS = new Set('的了是与和也在其之上下有为以及等或而即把被对于从这那它他她我你们不都很更最就又并则所者可能会要将用由向到后前时当如若但却因此故已各每某诸何得着过来去个些样么吗呢吧啊呀哦嗯一二三四五六七八九十百千万几两半第');
// Trim function characters off both ends of an out-of-vocabulary hanzi run.
function trimRun(run) {
  let a = 0, b = run.length;
  while (a < b && STOP_CHARS.has(run[a])) a++;
  while (b > a && STOP_CHARS.has(run[b - 1])) b--;
  return run.slice(a, b);
}
function extractTerms(slides) {
  const freq = new Map();
  const bump = (w, k = 1) => freq.set(w, (freq.get(w) || 0) + k);
  const flushRun = (run) => { const t = trimRun(run); if (t.length >= 2 && t.length <= 6) bump(t, 1.5); };
  for (const sl of slides) {
    for (const c of sl.clauses) {
      const segs = segment(c.zh);
      let run = '';
      for (const seg of segs) {
        if (isHanzi(seg[0]) && seg.length === 1) { run += seg; continue; }
        if (run) flushRun(run);
        run = '';
        if (isHanzi(seg[0]) && seg.length >= 3) bump(seg);
      }
      if (run) flushRun(run);
    }
  }
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).map((e) => e[0]);
  const gloss = glossaryTerms().map((g) => g.zh);
  const seen = new Set(); const out = [];
  for (const t of [...gloss, ...ranked]) { if (!seen.has(t)) { seen.add(t); out.push(t); } }
  return out;
}
function glossaryTerms() {
  return (S.glossary || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.split(/\s*=\s*/);
    return { zh: m[0].trim(), en: (m[1] || '').trim() };
  }).filter((g) => g.zh);
}

/* ============================== 6. session + rendering ============================== */
let session = null;      // persisted object
let idx = null;          // session index (slides, ngrams...)
let cursorId = null;
const rowsEl = $('rows'), mainEl = $('main'), liveEl = $('live'), liveZh = liveEl.querySelector('.zh'), outlineEl = $('outline');

function newSession(name, decks) {
  session = { id: 'sess-' + Date.now(), name: name || ('Lecture ' + new Date().toLocaleString()), createdAt: Date.now(), decks: decks || [], elapsedBase: 0, items: [], slide: null };
  rowsEl.innerHTML = ''; outlineEl.innerHTML = '';
  lastRulerBucket = -1; lastT1 = null; slideCandidate = null; slideCandidateHits = 0;
  rebuildIndex();
  updateChip(); persistNow();
}
function rebuildIndex() {
  idx = session && session.decks.length ? buildSessionIndex(session.decks) : null;
  renderSlidePane();
}
function updateChip() {
  const c = $('sessionChip');
  if (!session) { c.textContent = 'No session'; return; }
  const d = session.decks.map((x) => x.name + (x.range ? ` [${x.range}]` : '')).join(', ');
  c.textContent = session.name + (d ? ' · ' + d : ' · no deck');
  c.title = c.textContent;
}
const persist = debounce(persistNow, 400);
async function persistNow() { if (session) { try { await DB.put('sessions', session); } catch (e) { console.warn('persist failed', e); } } }

let lastRulerBucket = -1, lastT1 = null;

// ---- row renderers (append-only; a row is never re-rendered unless its own data changes)
function renderItem(item, { replay = false } = {}) {
  if (item.type === 's') return renderSentence(item, replay);
  if (item.type === 'm') return renderMarker(item);
  if (item.type === 'n') return renderNote(item);
  if (item.type === 'r') return renderRuler(item);
}
function renderRuler(item) {
  const el = document.createElement('div');
  el.className = 'ruler'; el.textContent = fmtTime(item.t);
  rowsEl.appendChild(el);
}
function renderMarker(item) {
  const el = document.createElement('div');
  el.className = 'marker' + (item.manual ? ' manual' : ''); el.id = 'it-' + item.id;
  const label = item.slide != null ? `Slide <b>${esc(String(item.slide))}</b>${item.deck ? ' <span class="faint">' + esc(item.deck) + '</span>' : ''}` : '<b>Mark</b>';
  el.innerHTML = `<span class="faint">${fmtTime(item.t)}</span> ${label} ${item.title ? '<span class="faint">· ' + esc(item.title) + '</span>' : ''}`;
  rowsEl.appendChild(el);
  addOutline(item, item.slide != null ? `Slide ${item.slide} ${item.title || ''}` : 'Mark', 'slide');
}
function renderNote(item) {
  const el = document.createElement('div');
  el.className = 'sent note-row'; el.id = 'it-' + item.id;
  el.innerHTML = `<div class="t">${fmtTime(item.t)}</div><div class="body"><div class="zh">✎ ${esc(item.text)}</div></div><div class="ops"><button data-op="del" title="Delete note">✕</button></div>`;
  el.querySelector('[data-op=del]').onclick = () => { session.items = session.items.filter((x) => x.id !== item.id); el.remove(); persist(); };
  rowsEl.appendChild(el);
  addOutline(item, '✎ ' + item.text, 'note');
}
function renderSentence(item, replay) {
  const el = document.createElement('div');
  el.className = 'sent' + (item.para ? ' para' : ''); el.id = 'it-' + item.id;
  const hl = highlightMask(item.zh);
  const enHidden = !S.showEn;
  el.innerHTML = `
    <div class="t">${fmtTime(item.t0)}</div>
    <div class="body">
      <div class="zh">${rubyHtml(item.zh, hl)}</div>
      <div class="en ${enHidden ? 'hidden' : ''}" data-has="0"></div>
    </div>
    <div class="ops">
      <button data-op="copy" title="Copy Chinese">⧉</button>
      <button data-op="en" title="Show / translate English">EN</button>
      <button data-op="cur" title="Set reading cursor here">⌖</button>
    </div>`;
  el.querySelector('[data-op=copy]').onclick = () => copyText(item.zh);
  el.querySelector('[data-op=cur]').onclick = () => setCursor(item.id);
  el.querySelector('[data-op=en]').onclick = () => revealEn(item, true);
  el.querySelector('.t').onclick = () => setCursor(item.id);
  rowsEl.appendChild(el);
  setEnState(item);
  if (item.para) addOutline(item, item.zh.slice(0, 18), 'para');
  if (!replay) mainEl.scrollTop = mainEl.scrollHeight;
  return el;
}
function setEnState(item) {
  const el = document.getElementById('it-' + item.id); if (!el) return;
  const en = el.querySelector('.en');
  en.classList.remove('err', 'pending');
  if (item.en) {
    en.dataset.has = '1';
    en.innerHTML = esc(item.en);
    en.classList.toggle('hidden', !S.showEn && item.forced !== true);
  } else if (item.status === 'pending') {
    en.dataset.has = '0'; en.classList.add('pending'); en.classList.remove('hidden'); en.textContent = 'translating';
  } else if (item.status === 'error') {
    en.dataset.has = '0'; en.classList.add('err'); en.classList.remove('hidden');
    en.innerHTML = `${esc(item.err || 'translation failed')} <button class="retry">Retry</button>`;
    en.querySelector('.retry').onclick = () => { item.status = null; Translate.enqueue(item, true); };
  } else {
    // not translated (tap mode / on-slide sentence)
    en.dataset.has = '0'; en.classList.remove('hidden');
    en.innerHTML = `<span class="tap">${item.onSlide >= 0.5 ? 'on slide · ' : ''}tap EN to translate</span>`;
  }
}
function revealEn(item, force) {
  if (item.en) {
    item.forced = !item.forced || S.showEn ? true : item.forced;
    const en = document.querySelector('#it-' + item.id + ' .en');
    en.classList.toggle('hidden');
  } else if (item.status !== 'pending') {
    Translate.enqueue(item, true);
  }
}
function highlightMask(zh) {
  if (!idx) return null;
  const mask = new Array(zh.length).fill(false);
  let i = 0;
  while (i < zh.length) {
    if (!isHanzi(zh[i])) { i++; continue; }
    let best = 0;
    for (let n = Math.min(6, zh.length - i); n >= 2; n--) {
      if (idx.ngrams.has(zh.slice(i, i + n))) { best = n; break; }
    }
    if (best) { for (let k = 0; k < best; k++) mask[i + k] = true; i += best; } else i++;
  }
  return mask;
}
function onSlideRatio(zh, mask) {
  if (!mask) return 0;
  let h = 0, on = 0;
  for (let i = 0; i < zh.length; i++) if (isHanzi(zh[i])) { h++; if (mask[i]) on++; }
  return h ? on / h : 0;
}
function addOutline(item, label, kind) {
  const el = document.createElement('div');
  el.className = 'outline-item ' + kind;
  el.innerHTML = `<span class="ot">${fmtTime(item.t0 ?? item.t)}</span><span class="ol">${esc(label)}</span>`;
  el.onclick = () => { const r = document.getElementById('it-' + item.id); if (r) { r.scrollIntoView({ block: 'center' }); if (item.type === 's') setCursor(item.id); } $('side').classList.remove('open'); };
  outlineEl.appendChild(el);
}
function setCursor(id) {
  if (cursorId) document.getElementById('it-' + cursorId)?.classList.remove('cursor');
  cursorId = id;
  document.getElementById('it-' + id)?.classList.add('cursor');
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); setStatus('Copied', 'ok'); setTimeout(() => recording && setStatus('Listening', 'ok'), 800); }
  catch (e) { prompt('Copy:', t); }
}

// ---- adding content
function addItem(item, replay = false) {
  session.items.push(item);
  renderItem(item, { replay });
  if (!replay) persist();
}
function addSentence(zh, t0, t1) {
  zh = zh.trim(); if (!zh) return;
  // ruler
  const rulerMs = Math.max(1, S.rulerMin) * 60000;
  const bucket = Math.floor(t0 / rulerMs);
  if (bucket > lastRulerBucket) { lastRulerBucket = bucket; if (bucket > 0 || session.items.length) addItem({ type: 'r', id: uid(), t: bucket * rulerMs }); }
  const para = lastT1 != null && (t0 - lastT1) > S.paraGap * 1000;
  lastT1 = t1;
  const item = { type: 's', id: 's' + uid(), zh, t0, t1, para, en: '', status: null };
  const mask = highlightMask(zh);
  item.onSlide = onSlideRatio(zh, mask);
  Slides.observe(zh, t0);          // may insert a slide marker before this sentence
  item.slide = session.slide;
  addItem(item);
  const mode = S.trMode;
  if (mode === 'all' || (mode === 'new' && item.onSlide < 0.5)) Translate.enqueue(item);
}
function addMarker({ slide = null, deck = null, title = '', manual = false, t = null }) {
  addItem({ type: 'm', id: 'm' + uid(), t: t ?? elapsedMs(), slide, deck, title, manual });
  persistNow();
}
function addNote(text) {
  addItem({ type: 'n', id: 'n' + uid(), t: elapsedMs(), text });
  persistNow();
}

// ---- resume
async function resumeSession(id) {
  const s = await DB.get('sessions', id); if (!s) return;
  if (recording) stopRecording();
  session = s; rowsEl.innerHTML = ''; outlineEl.innerHTML = ''; lastRulerBucket = -1; lastT1 = null;
  rebuildIndex();
  for (const it of session.items) { renderItem(it, { replay: true }); if (it.type === 's') lastT1 = it.t1; if (it.type === 'r') lastRulerBucket = Math.floor(it.t / (Math.max(1, S.rulerMin) * 60000)); }
  updateChip(); updateClock();
  mainEl.scrollTop = mainEl.scrollHeight;
}

/* ============================== 7. Soniox ============================== */
let recording = false, stopping = false;
let ws = null, audioCtx = null, workletNode = null, micStream = null, wakeLock = null;
let recStartWall = 0;        // wall clock when the current recording segment started
let streamBaseMs = 0;        // session elapsed ms at the moment the current Soniox stream opened
let reconnectAttempts = 0;
let pendingAudio = [];       // buffered PCM while reconnecting
let curFinal = [];           // finalized tokens not yet flushed into a sentence
let curNonFinal = '';
let clockTimer = null;

function elapsedMs() { return (session ? session.elapsedBase : 0) + (recording ? Date.now() - recStartWall : 0); }
function updateClock() { $('clock').textContent = fmtTime(elapsedMs()); }

const PCM_WORKLET = `
class P extends AudioWorkletProcessor {
  constructor(){ super(); this.buf=[]; this.n=0; }
  process(inputs){ const ch=inputs[0]&&inputs[0][0]; if(ch&&ch.length){ this.buf.push(ch.slice()); this.n+=ch.length;
    if(this.n>=2048){ const m=new Float32Array(this.n); let o=0; for(const b of this.buf){ m.set(b,o); o+=b.length; } this.port.postMessage(m,[m.buffer]); this.buf=[]; this.n=0; } } return true; }
}
registerProcessor('pcm', P);`;

function f32ToPcm16(f) {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
  return out.buffer;
}

async function startRecording() {
  if (!S.sonioxKey) { setStatus('Add your Soniox API key in Settings', 'err'); openModal('mSettings'); return; }
  if (!session) newSession();
  stopping = false;
  setStatus('Requesting microphone…');
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
  } catch (e) { setStatus('Microphone blocked: ' + e.message, 'err'); return; }
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  const url = URL.createObjectURL(new Blob([PCM_WORKLET], { type: 'application/javascript' }));
  try { await audioCtx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
  const src = audioCtx.createMediaStreamSource(micStream);
  workletNode = new AudioWorkletNode(audioCtx, 'pcm');
  workletNode.port.onmessage = (e) => {
    const pcm = f32ToPcm16(e.data);
    if (ws && ws.readyState === WebSocket.OPEN && wsReady) ws.send(pcm);
    else { pendingAudio.push(pcm); if (pendingAudio.length > 400) pendingAudio.shift(); } // ~50 s at 2048 samples/chunk
  };
  src.connect(workletNode);
  workletNode.connect(audioCtx.destination);

  recording = true; recStartWall = Date.now(); reconnectAttempts = 0;
  $('btnRec').innerHTML = '<span class="rec-dot on"></span>Stop'; $('btnRec').classList.remove('primary'); $('btnRec').classList.add('danger');
  liveEl.classList.remove('idle');
  clockTimer = setInterval(updateClock, 1000);
  requestWakeLock();
  connectSoniox();
}

let wsReady = false;
function sonioxConfig() {
  const cfg = {
    model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: audioCtx.sampleRate, num_channels: 1,
    language_hints: ['zh'], language_hints_strict: true,
    enable_endpoint_detection: true,
    max_endpoint_delay_ms: Math.min(3000, Math.max(500, Number(S.epDelay) || 1500)),
    endpoint_sensitivity: Math.min(1, Math.max(-1, Number(S.epSens) || 0)),
  };
  // Context: general + terms + slide text, kept under ~9k characters total.
  const general = [{ key: 'domain', value: 'Traditional Chinese Medicine (中医) university lecture' }];
  if (session?.name) general.push({ key: 'topic', value: session.name.slice(0, 120) });
  const terms = (session?.terms || []).slice();
  let budget = 9000 - JSON.stringify(general).length;
  const keptTerms = []; let used = 0;
  for (const t of terms) { if (used + t.length + 3 > Math.min(budget, 3500)) break; keptTerms.push(t); used += t.length + 3; }
  budget -= used;
  let text = '';
  if (idx) {
    const parts = [];
    for (const sl of idx.slides) { parts.push(sl.text); }
    text = parts.join('\n');
    if (text.length > budget - 200) text = text.slice(0, Math.max(0, budget - 200));
  }
  cfg.context = { general, terms: keptTerms };
  if (text) cfg.context.text = text;
  if (S.sonioxAuth === 'config') cfg.api_key = S.sonioxKey;
  return cfg;
}
function connectSoniox() {
  wsReady = false;
  setStatus(reconnectAttempts ? `Reconnecting (${reconnectAttempts})…` : 'Connecting to Soniox…', 'warn');
  let sock;
  try {
    sock = S.sonioxAuth === 'protocol' ? new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket', ['soniox-api-key', S.sonioxKey]) : new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');
  } catch (e) {
    // Key not valid as a subprotocol token: fall back to the (deprecated) config field.
    S.sonioxAuth = 'config'; saveSettings();
    sock = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');
  }
  ws = sock;
  let opened = false;
  sock.onopen = () => {
    opened = true;
    streamBaseMs = elapsedMs();
    sock.send(JSON.stringify(sonioxConfig()));
    wsReady = true;
    for (const p of pendingAudio) sock.send(p);
    pendingAudio = [];
    reconnectAttempts = 0;
    setStatus('Listening', 'ok');
  };
  sock.onmessage = (ev) => {
    let res; try { res = JSON.parse(ev.data); } catch (e) { return; }
    if (res.error_code) {
      setStatus(`Soniox ${res.error_code}: ${res.error_message}`, 'err');
      if (res.error_code === 401 && S.sonioxAuth === 'protocol') { S.sonioxAuth = 'config'; saveSettings(); } // retry with config auth
      return;
    }
    handleTokens(res.tokens || []);
    if (res.finished) finalizeClose();
  };
  sock.onerror = () => { if (!opened && S.sonioxAuth === 'protocol') { S.sonioxAuth = 'config'; saveSettings(); } };
  sock.onclose = (ev) => {
    if (ws !== sock) return;
    wsReady = false;
    if (stopping || !recording) { finalizeClose(); return; }
    // Unexpected close: flush what we have and reconnect with backoff.
    flushSentence(true);
    reconnectAttempts++;
    if (reconnectAttempts > 8) { setStatus('Connection lost; could not reconnect. Press Start to resume.', 'err'); stopRecording(true); return; }
    const delay = Math.min(8000, 500 * 2 ** (reconnectAttempts - 1));
    setStatus(`Connection closed (${ev.code}); retrying in ${Math.round(delay / 1000)}s`, 'warn');
    setTimeout(() => { if (recording && !stopping) connectSoniox(); }, delay);
  };
}
function handleTokens(tokens) {
  let nonFinal = '';
  for (const tk of tokens) {
    if (!tk.text) continue;
    if (tk.is_final) {
      if (tk.text === '<end>') { flushSentence(); continue; }
      curFinal.push({ text: tk.text, s: tk.start_ms ?? null, e: tk.end_ms ?? null });
      const joined = curFinalText();
      if (SENT_END.test(joined.trimEnd())) flushSentence();
      else if (joined.length >= 70 && SOFT_END.test(joined.trimEnd())) flushSentence();
    } else if (tk.text !== '<end>') {
      nonFinal += tk.text;
    }
  }
  curNonFinal = nonFinal;
  renderLive();
}
function curFinalText() { return curFinal.map((t) => t.text).join(''); }
function renderLive() {
  const fin = curFinalText();
  liveZh.innerHTML = (fin ? rubyHtml(fin, highlightMask(fin)) : '') + (curNonFinal ? `<span class="nonfinal">${esc(curNonFinal)}</span>` : '');
  $('liveT').textContent = fin || curNonFinal ? fmtTime(elapsedMs()) : '';
  // keep the live row in view only if the user is near the bottom
  if (mainEl.scrollHeight - mainEl.scrollTop - mainEl.clientHeight < 160) mainEl.scrollTop = mainEl.scrollHeight;
}
function flushSentence(force) {
  const text = curFinalText().trim();
  if (!text) { curFinal = []; return; }
  const first = curFinal.find((t) => t.s != null), last = [...curFinal].reverse().find((t) => t.e != null);
  const t0 = first ? streamBaseMs + first.s : elapsedMs();
  const t1 = last ? streamBaseMs + last.e : elapsedMs();
  curFinal = [];
  addSentence(text, t0, t1);
  if (force) { curNonFinal = ''; renderLive(); }
}
function sendFinalize() {
  if (ws && ws.readyState === WebSocket.OPEN && wsReady) { try { ws.send(JSON.stringify({ type: 'finalize' })); } catch (e) { /* ignore */ } }
}
function stopRecording(silent) {
  if (!recording) return;
  stopping = true;
  if (session) session.elapsedBase += Date.now() - recStartWall;
  recording = false;
  clearInterval(clockTimer); updateClock();
  if (workletNode) { workletNode.port.onmessage = null; workletNode.disconnect(); workletNode = null; }
  if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
  releaseWakeLock();
  $('btnRec').innerHTML = '<span class="rec-dot"></span>Start'; $('btnRec').classList.add('primary'); $('btnRec').classList.remove('danger');
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(''); } catch (e) { /* ignore */ }   // empty TEXT frame = end of audio
    setTimeout(finalizeClose, 4000);
    if (!silent) setStatus('Finishing…');
  } else finalizeClose();
  Translate.flushNow();
  persistNow();
}
function finalizeClose() {
  flushSentence(true);
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
  if (ws) { try { ws.close(); } catch (e) { /* ignore */ } ws = null; }
  pendingAudio = []; stopping = false; wsReady = false;
  if (!recording) { setStatus('Stopped'); liveEl.classList.add('idle'); liveZh.innerHTML = ''; $('liveT').textContent = ''; }
}
async function requestWakeLock() {
  try { if ('wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { /* not fatal */ }
}
function releaseWakeLock() { try { wakeLock?.release(); } catch (e) { /* ignore */ } wakeLock = null; }
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && recording) {
    if (!wakeLock) requestWakeLock();
    if (audioCtx && audioCtx.state === 'suspended') { try { await audioCtx.resume(); } catch (e) { /* ignore */ } }
  }
});

/* ============================== 8. translation queue ============================== */
const Translate = (() => {
  let queue = [];          // items awaiting translation
  let timer = null;
  let inflight = 0;
  let jsonUnsupported = false;

  function enqueue(item, urgent) {
    if (item.status === 'pending') return;
    item.status = 'pending'; item.err = ''; setEnState(item);
    queue.push(item);
    if (urgent || queue.length >= Math.max(1, S.batchN)) flushNow();
    else if (!timer) timer = setTimeout(flushNow, Math.max(2, S.batchS) * 1000);
  }
  function flushNow() {
    clearTimeout(timer); timer = null;
    if (!queue.length) return;
    const batch = queue.splice(0, 10);
    run(batch);
  }
  function contextFor(batch) {
    const firstIdx = session.items.indexOf(batch[0]);
    const prev = [];
    for (let i = firstIdx - 1; i >= 0 && prev.length < 3; i--) { const it = session.items[i]; if (it.type === 's') prev.unshift(it); }
    const slideNo = batch[batch.length - 1].slide ?? session.slide;
    const slide = idx && slideNo != null ? idx.slides.find((s) => s.slide === slideNo) : null;
    return { prev, slide };
  }
  function buildMessages(batch) {
    const { prev, slide } = contextFor(batch);
    const gloss = glossaryTerms();
    const sys = [
      'You translate a live university lecture on Traditional Chinese Medicine (TCM) from Mandarin into clear, natural English for a student who reads the Chinese and is learning TCM terminology.',
      'The Chinese comes from automatic speech recognition and may contain homophone errors (e.g. 证/症/正/征, 气/器, 脾/皮). Use the slide reference and glossary to infer the intended term and translate the intended meaning.',
      'Translate EVERY sentence you are given, by id. Keep sentence boundaries. Do not add commentary, notes, or the Chinese text.',
      'Use standard TCM English terminology (WHO/Wiseman style) and keep terminology consistent with the slide reference when one is given.',
      S.termGloss ? 'For key TCM terms, write the Chinese term followed by pinyin with tone marks and the English in parentheses the first time it appears in this batch, e.g. 肝郁 (gān yù, liver qi stagnation). Everyday words are translated normally.' : '',
      'Respond with ONLY a JSON object: {"items":[{"id":"<id>","en":"<english>"}, ...]}',
      S.extraPrompt || '',
    ].filter(Boolean).join('\n');
    const parts = [];
    if (gloss.length) parts.push('Glossary (preferred renderings):\n' + gloss.map((g) => `${g.zh} = ${g.en || '(keep term)'}`).join('\n'));
    if (slide) parts.push(`Slide ${slide.slide} reference (teacher is probably discussing this):\n` + slide.clauses.map((c) => c.en ? `${c.zh} — ${c.en}` : c.zh).join('\n') + (slide.en_whole ? '\n' + slide.en_whole : ''));
    if (prev.length) parts.push('Preceding sentences (context only, do NOT translate):\n' + prev.map((p) => p.zh + (p.en ? `\n  → ${p.en}` : '')).join('\n'));
    parts.push('Translate these:\n' + batch.map((b) => `[${b.id}] ${b.zh}`).join('\n'));
    return [{ role: 'system', content: sys }, { role: 'user', content: parts.join('\n\n') }];
  }
  function parseContent(content, batch) {
    let txt = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try {
      const j = JSON.parse(txt);
      const items = Array.isArray(j) ? j : (j.items || j.translations || []);
      const map = new Map();
      if (Array.isArray(items)) for (const it of items) if (it && it.id) map.set(String(it.id), String(it.en ?? it.english ?? it.text ?? ''));
      else if (items && typeof items === 'object') for (const [k, v] of Object.entries(items)) map.set(k, String(v));
      if (map.size) return map;
    } catch (e) { /* not JSON */ }
    // Fallback: lines like "[s12] text" or just the text for a single item
    const map = new Map();
    const re = /\[(s[a-z0-9]+)\]\s*([^\n]+)/g; let m;
    while ((m = re.exec(txt))) map.set(m[1], m[2].trim());
    if (!map.size && batch.length === 1) map.set(batch[0].id, txt);
    return map;
  }
  async function callLLM(messages) {
    if (!S.llmKey) throw new Error('No translation API key (Settings)');
    if (!S.endpoint) throw new Error('No endpoint URL (Settings)');
    const body = { model: S.model, messages, temperature: 0.2 };
    if (S.jsonMode && !jsonUnsupported) body.response_format = { type: 'json_object' };
    let attempt = 0;
    for (;;) {
      const r = await fetch(S.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.llmKey }, body: JSON.stringify(body) });
      if (r.ok) {
        const j = await r.json();
        const c = j.choices?.[0]?.message?.content;
        if (c == null) throw new Error('Empty response');
        return typeof c === 'string' ? c : JSON.stringify(c);
      }
      const t = await r.text();
      if (r.status === 400 && body.response_format && /response_format|json/i.test(t)) { jsonUnsupported = true; delete body.response_format; continue; }
      if ((r.status === 429 || r.status >= 500) && attempt < 4) { attempt++; const ra = Number(r.headers.get('retry-after')); await sleep(ra ? ra * 1000 : Math.min(15000, 1500 * 2 ** attempt)); continue; }
      throw new Error(`HTTP ${r.status}: ${t.slice(0, 160)}`);
    }
  }
  async function run(batch) {
    inflight++;
    try {
      const content = await callLLM(buildMessages(batch));
      const map = parseContent(content, batch);
      for (const it of batch) {
        const en = map.get(it.id);
        if (en) { it.en = en; it.status = 'done'; } else { it.status = 'error'; it.err = 'No translation returned for this sentence'; }
        setEnState(it);
      }
    } catch (e) {
      for (const it of batch) { it.status = 'error'; it.err = e.message; setEnState(it); }
    } finally { inflight--; persist(); }
  }
  async function explain(word, sentence) {
    const messages = [
      { role: 'system', content: 'You are a concise TCM terminology tutor. Answer in at most 30 words of English. Give the meaning of the Chinese word as used in the sentence; if it is a TCM term, give the standard English term.' },
      { role: 'user', content: `Word: ${word}\nSentence: ${sentence}` },
    ];
    const body = { model: S.model, messages, temperature: 0.2 };
    const r = await fetch(S.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.llmKey }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(); return (j.choices?.[0]?.message?.content || '').trim();
  }
  return { enqueue, flushNow, explain, get pending() { return queue.length + inflight; } };
})();

/* ============================== 9. slide matching ============================== */
let slideCandidate = null, slideCandidateHits = 0;
const Slides = {
  recent: [],
  observe(zh, t0) {
    if (!idx || !S.slideAuto) return;
    this.recent.push(hanziOnly(zh)); if (this.recent.length > 3) this.recent.shift();
    const win = new Set();
    const w = this.recent.join('');
    for (let i = 0; i + 1 < w.length; i++) win.add(w.slice(i, i + 2));
    if (win.size < 6) return;
    let denom = 0; for (const b of win) denom += idx.idf(b);
    const cur = session.slide;
    let best = null, bestScore = 0, curScore = 0;
    for (let k = 0; k < idx.slides.length; k++) {
      const sl = idx.slides[k];
      let s = 0; for (const b of win) if (sl.bigrams.has(b)) s += idx.idf(b);
      s /= denom || 1;
      if (cur != null) { const d = Math.abs(sl.slide - cur); if (d === 1) s += 0.04; else if (d === 2) s += 0.02; }
      if (sl.slide === cur) curScore = s;
      if (s > bestScore) { bestScore = s; best = sl; }
    }
    if (!best || best.slide === cur) { slideCandidate = null; slideCandidateHits = 0; return; }
    if (bestScore < 0.28 || bestScore - curScore < 0.08) { slideCandidate = null; slideCandidateHits = 0; return; }
    if (slideCandidate === best.slide) slideCandidateHits++; else { slideCandidate = best.slide; slideCandidateHits = 1; }
    // first slide of the session switches immediately; later switches need two consecutive confirmations
    if (cur == null || slideCandidateHits >= 2) this.set(best.slide, false, t0);
  },
  set(no, manual, t) {
    if (!idx) return;
    const sl = idx.slides.find((s) => s.slide === no); if (!sl) return;
    session.slide = no; slideCandidate = null; slideCandidateHits = 0;
    addMarker({ slide: no, deck: sl.deck, title: sl.clauses[0].zh.slice(0, 20), manual, t });
    renderSlidePane();
    Translate.flushNow();
  },
  step(d) {
    if (!idx) return;
    const list = idx.slides.map((s) => s.slide);
    const i = list.indexOf(session.slide);
    const next = list[i < 0 ? 0 : Math.min(list.length - 1, Math.max(0, i + d))];
    if (next !== session.slide) this.set(next, true);
  },
};
function renderSlidePane() {
  const body = $('slideBody'), cur = $('slideCur');
  if (!idx) { body.innerHTML = '<div class="small muted">Load a deck in Session to see slide text here.</div>'; cur.textContent = '—'; return; }
  const sl = idx.slides.find((s) => s.slide === session?.slide);
  if (!sl) { body.innerHTML = `<div class="small muted">${idx.slides.length} slides loaded. Slide will be detected from speech, or use ◀ ▶.</div>`; cur.textContent = '—'; return; }
  cur.textContent = `Slide ${sl.slide}`; cur.title = sl.deck;
  body.innerHTML = sl.clauses.map((c) => `<div class="clause"><div class="czh">${rubyHtml(c.zh, null)}</div><div class="cen">${esc(c.en || '')}</div></div>`).join('') + (sl.en_whole ? `<div class="clause"><div class="cen">${esc(sl.en_whole)}</div></div>` : '');
}

/* ============================== 10. popover / vocab ============================== */
const pop = $('pop');
let popWord = '', popSentence = '', popPy = '', popEn = '';
function plainZh(el) {
  if (!el) return '';
  const c = el.cloneNode(true); c.querySelectorAll('rt').forEach((r) => r.remove());
  return c.textContent.trim();
}
function findDeckGloss(word) {
  const g = glossaryTerms().find((x) => x.zh === word); if (g && g.en) return g.en;
  if (!idx) return '';
  for (const sl of idx.slides) for (const c of sl.clauses) if (c.zh.includes(word) && c.en) return `slide ${sl.slide}: ${c.en}`;
  return '';
}
document.addEventListener('click', async (e) => {
  const w = e.target.closest('.w');
  if (w) {
    popWord = w.dataset.w; popSentence = plainZh(w.closest('.zh'));
    popPy = pinyinOf(popWord).join(' ');
    popEn = findDeckGloss(popWord);
    pop.querySelector('.pzh').textContent = popWord; pop.querySelector('.ppy').textContent = popPy; pop.querySelector('.pen').textContent = popEn;
    pop.style.display = 'block';
    const r = w.getBoundingClientRect();
    pop.style.left = Math.min(window.innerWidth - 330, Math.max(8, r.left)) + 'px';
    pop.style.top = Math.min(window.innerHeight - 160, r.bottom + 6) + 'px';
    e.stopPropagation(); return;
  }
  if (!e.target.closest('#pop')) pop.style.display = 'none';
});
pop.querySelector('.pclose').onclick = () => (pop.style.display = 'none');
pop.querySelector('.pcopy').onclick = () => copyText(popWord);
pop.querySelector('.pexplain').onclick = async () => {
  const el = pop.querySelector('.pen'); el.textContent = '…';
  try { popEn = await Translate.explain(popWord, popSentence); el.textContent = popEn; } catch (err) { el.textContent = 'Explain failed: ' + err.message; }
};
pop.querySelector('.psave').onclick = () => { Vocab.add({ zh: popWord, py: popPy, en: popEn, ctx: popSentence }); pop.style.display = 'none'; };

const Vocab = {
  list: JSON.parse(localStorage.getItem('v8.vocab') || '[]'),
  save() { localStorage.setItem('v8.vocab', JSON.stringify(this.list)); this.render(); },
  add(v) { if (!this.list.some((x) => x.zh === v.zh)) { this.list.unshift(Object.assign({ t: Date.now() }, v)); this.save(); setStatus('Saved to vocab', 'ok'); } },
  render() {
    $('vocab').innerHTML = this.list.length ? this.list.map((v, i) => `<div class="vocab-item"><span class="vzh">${esc(v.zh)}</span><span class="vpy">${esc(v.py)}</span><span class="ven">${esc(v.en || '')}</span><button data-i="${i}">✕</button></div>`).join('') : '<div class="small muted">Tap a word in the transcript, then Save.</div>';
    $('vocab').querySelectorAll('button').forEach((b) => (b.onclick = () => { this.list.splice(+b.dataset.i, 1); this.save(); }));
  },
  exportCsv() {
    const q = (s) => '"' + String(s || '').replace(/"/g, '""') + '"';
    const csv = this.list.map((v) => [q(v.zh), q(v.py), q(v.en), q(v.ctx)].join(',')).join('\n');
    download('vocab.csv', csv, 'text/csv');
  },
};

/* ============================== export ============================== */
function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: type || 'text/plain;charset=utf-8' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportMarkdown() {
  if (!session) return;
  const L = [`# ${session.name}`, '', `Date: ${new Date(session.createdAt).toLocaleString()}  `, `Decks: ${session.decks.map((d) => d.name + (d.range ? ` [${d.range}]` : '')).join(', ') || 'none'}`, ''];
  for (const it of session.items) {
    if (it.type === 'r') L.push(`---\n*${fmtTime(it.t)}*\n`);
    else if (it.type === 'm') L.push(`## ${fmtTime(it.t)} · ${it.slide != null ? `Slide ${it.slide}` : 'Mark'}${it.title ? ' · ' + it.title : ''}\n`);
    else if (it.type === 'n') L.push(`> ✎ **Note** (${fmtTime(it.t)}): ${it.text}\n`);
    else if (it.type === 's') {
      L.push(`**${fmtTime(it.t0)}** ${it.zh}  `);
      L.push(`<sub>${pinyinOf(it.zh).filter((p, i) => isHanzi(it.zh[i])).join(' ')}</sub>  `);
      if (it.en) L.push(`${it.en}`);
      L.push('');
    }
  }
  download(safeName(session.name) + '.md', L.join('\n'), 'text/markdown');
}
function exportJson() { if (session) download(safeName(session.name) + '.json', JSON.stringify(session, null, 1), 'application/json'); }
function exportZhOnly() { if (session) download(safeName(session.name) + '.zh.txt', session.items.filter((i) => i.type === 's').map((i) => i.zh).join('\n')); }
const safeName = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'session';

/* ============================== test mode ============================== */
let simTimer = null;
function runSimulation() {
  const text = S.simText.trim(); if (!text) { alert('Paste some Chinese text in the Test mode box first.'); return; }
  if (recording) { alert('Stop the real recording first.'); return; }
  closeModal('mSettings');
  if (!session) newSession('Test ' + new Date().toLocaleTimeString());
  liveEl.classList.remove('idle');
  recording = true; recStartWall = Date.now(); streamBaseMs = elapsedMs(); clockTimer = setInterval(updateClock, 1000);
  $('btnRec').innerHTML = '<span class="rec-dot on"></span>Stop test'; $('btnRec').classList.remove('primary'); $('btnRec').classList.add('danger');
  setStatus('Test stream', 'warn');
  const chars = [...text.replace(/\s+/g, '')];
  let i = 0; const perChar = 1000 / Math.max(1, S.simSpeed);
  const t = () => Date.now() - recStartWall + (session.elapsedBase - streamBaseMs);
  simTimer = setInterval(() => {
    if (i >= chars.length) { clearInterval(simTimer); simTimer = null; flushSentence(true); stopSimulation(); return; }
    const ch = chars[i++];
    const tokens = [{ text: ch, is_final: true, start_ms: t(), end_ms: t() + perChar }];
    if (/[。！？；]/.test(ch) && Math.random() < 0.7) tokens.push({ text: '<end>', is_final: true });
    // show a few upcoming chars as non-final to mimic streaming
    const nf = chars.slice(i, i + 3).join('');
    if (nf) tokens.push({ text: nf, is_final: false });
    handleTokens(tokens);
  }, perChar);
}
function stopSimulation() {
  if (simTimer) { clearInterval(simTimer); simTimer = null; }
  flushSentence(true);
  if (session) session.elapsedBase += Date.now() - recStartWall;
  recording = false; clearInterval(clockTimer); updateClock();
  $('btnRec').innerHTML = '<span class="rec-dot"></span>Start'; $('btnRec').classList.add('primary'); $('btnRec').classList.remove('danger');
  liveEl.classList.add('idle'); liveZh.innerHTML = ''; $('liveT').textContent = '';
  setStatus('Test finished'); Translate.flushNow(); persistNow();
}

/* ============================== modals + session UI ============================== */
function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }
document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); }));

let deckSelection = new Map(); // id -> {entry, range, data?}
async function openSessionModal() {
  openModal('mSession');
  $('sessName').value = session?.name || '';
  deckSelection = new Map();
  if (session) for (const d of session.decks) deckSelection.set(d.id, { id: d.id, name: d.name, range: d.range || '', data: d.data });
  $('deckList').innerHTML = '<div class="muted small">Loading…</div>';
  await Promise.all([Deck.listRemote(), Deck.listLocal()]);
  renderDeckList();
  updateTermPreview();
}
function renderDeckList() {
  const rows = [];
  const all = [...Deck.remote.map((e) => ({ ...e, src: 'repo' })), ...Deck.local.map((e) => ({ ...e, src: 'this device' }))];
  // decks that are in the session but no longer listed anywhere
  for (const [id, sel] of deckSelection) if (!all.some((e) => e.id === id)) all.push({ id, name: sel.name, src: 'session only', data: sel.data });
  if (!all.length) {
    const { owner, repo, path } = Deck.ghCoords();
    rows.push(`<div class="help">No decks found. ${owner && repo ? `Looked in <code>${esc(owner)}/${esc(repo)}/${esc(path)}</code>.` : 'Set Owner/Repo in Settings, or'} Drop a deck.json below.</div>`);
  }
  for (const e of all) {
    const sel = deckSelection.get(e.id);
    rows.push(`<div class="deck-item" data-id="${esc(e.id)}">
      <input type="checkbox" ${sel ? 'checked' : ''} />
      <div><div class="dn" title="${esc(e.name)}">${esc(e.name)}</div><div class="ds">${esc(e.src)}${e.size ? ' · ' + Math.round(e.size / 1024) + ' KB' : ''}${e.data ? ' · ' + e.data.length + ' slides' : ''}</div></div>
      <input type="text" placeholder="slides e.g. 5-30" value="${esc(sel?.range || '')}" ${sel ? '' : 'disabled'} />
    </div>`);
  }
  $('deckList').innerHTML = rows.join('');
  $('deckList').querySelectorAll('.deck-item').forEach((row) => {
    const id = row.dataset.id; const cb = row.querySelector('input[type=checkbox]'); const rg = row.querySelector('input[type=text]');
    const entry = all.find((x) => x.id === id);
    cb.onchange = async () => {
      if (cb.checked) {
        rg.disabled = false;
        try {
          const data = entry.data || (id.startsWith('local:') ? (await DB.get('decks', id)).data : await Deck.fetchRemote(entry));
          deckSelection.set(id, { id, name: entry.name, range: rg.value, data });
        } catch (err) { alert('Could not load deck: ' + err.message); cb.checked = false; rg.disabled = true; return; }
      } else { rg.disabled = true; deckSelection.delete(id); }
      updateTermPreview();
    };
    rg.oninput = () => { const s = deckSelection.get(id); if (s) { s.range = rg.value; updateTermPreviewDebounced(); } };
    if (id.startsWith('local:')) {
      const del = document.createElement('button'); del.textContent = 'remove'; del.className = 'small'; del.style.gridColumn = '3'; del.title = 'Remove from this device';
      del.onclick = async () => { await DB.del('decks', id); deckSelection.delete(id); await Deck.listLocal(); renderDeckList(); updateTermPreview(); };
      row.appendChild(del); row.style.gridTemplateColumns = '24px 1fr 110px auto';
    }
  });
}
function updateTermPreview() {
  const decks = [...deckSelection.values()];
  if (!decks.length) { $('sessTerms').value = glossaryTerms().map((g) => g.zh).join('\n'); $('sessTermsInfo').textContent = 'No deck ticked: only glossary terms will be sent.'; return; }
  const tmp = buildSessionIndex(decks);
  $('sessTerms').value = tmp.terms.slice(0, 400).join('\n');
  $('sessTermsInfo').textContent = `${tmp.slides.length} slides · ${tmp.terms.length} candidate terms (first 400 shown; Soniox gets as many as fit its context limit) · slide text also sent as background context.`;
}
const updateTermPreviewDebounced = debounce(updateTermPreview, 400);
function applySessionFromModal(fresh) {
  const name = $('sessName').value.trim();
  const decks = [...deckSelection.values()].map((d) => ({ id: d.id, name: d.name, range: d.range, data: d.data }));
  const terms = $('sessTerms').value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (fresh || !session) {
    if (recording) stopRecording(true);
    newSession(name, decks);
  } else {
    session.name = name || session.name; session.decks = decks; rebuildIndex(); updateChip();
  }
  session.terms = terms;
  persistNow(); closeModal('mSession');
  if (recording && ws) { setStatus('Deck changed; reconnecting with new vocabulary', 'warn'); try { ws.close(); } catch (e) { /* onclose reconnects */ } }
}

async function openResume() {
  const all = ((await DB.all('sessions')) || []).sort((a, b) => b.createdAt - a.createdAt);
  $('resumeList').innerHTML = all.length ? all.map((s) => `<div class="deck-item" data-id="${esc(s.id)}"><span></span><div><div class="dn">${esc(s.name)}</div><div class="ds">${new Date(s.createdAt).toLocaleString()} · ${s.items.filter((i) => i.type === 's').length} sentences · ${fmtTime(s.elapsedBase)}</div></div><div class="row"><button data-act="open" class="small">Open</button><button data-act="del" class="small danger">✕</button></div></div>`).join('') : '<div class="muted small">No saved sessions.</div>';
  $('resumeList').querySelectorAll('[data-act=open]').forEach((b) => (b.onclick = async () => { await resumeSession(b.closest('.deck-item').dataset.id); closeModal('mResume'); closeModal('mSettings'); }));
  $('resumeList').querySelectorAll('[data-act=del]').forEach((b) => (b.onclick = async () => { const id = b.closest('.deck-item').dataset.id; if (confirm('Delete this saved session?')) { await DB.del('sessions', id); if (session?.id === id) { session = null; rowsEl.innerHTML = ''; outlineEl.innerHTML = ''; updateChip(); } openResume(); } }));
  openModal('mResume');
}

/* ============================== wiring ============================== */
$('btnRec').onclick = () => { if (simTimer) return stopSimulation(); recording ? stopRecording() : startRecording(); };
$('btnMark').onclick = () => { if (!session) return; sendFinalize(); flushSentence(true); addMarker({ manual: true }); Translate.flushNow(); };
$('btnNote').onclick = () => { if (!session) newSession(); $('noteText').value = ''; openModal('mNote'); setTimeout(() => $('noteText').focus(), 50); };
$('noteSave').onclick = () => { const t = $('noteText').value.trim(); if (t) addNote(t); closeModal('mNote'); };
$('noteCancel').onclick = () => closeModal('mNote');
$('btnSession').onclick = openSessionModal;
$('sessCancel').onclick = () => closeModal('mSession');
$('sessApply').onclick = () => applySessionFromModal(false);
$('sessNew').onclick = () => { if (!session || !session.items.length || confirm('Start a new session? The current transcript stays saved and can be reopened from Settings → Resume.')) applySessionFromModal(true); };
$('deckRefresh').onclick = async () => { Deck.cache.clear(); await Promise.all([Deck.listRemote(), Deck.listLocal()]); renderDeckList(); };
$('deckFile').onclick = () => $('deckFileInput').click();
$('deckFileInput').onchange = async (e) => { await Deck.addLocalFiles([...e.target.files]); e.target.value = ''; renderDeckList(); };
const drop = $('deckDrop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', async (e) => { e.preventDefault(); drop.classList.remove('over'); await Deck.addLocalFiles([...e.dataTransfer.files].filter((f) => /\.json$/i.test(f.name))); renderDeckList(); });

$('btnSettings').onclick = () => { settingsToUI(); openModal('mSettings'); };
$('setClose').onclick = () => { uiToSettings(); closeModal('mSettings'); };
$('provider').onchange = () => { const p = PROVIDERS[$('provider').value]; if (p.endpoint) $('endpoint').value = p.endpoint; if (p.models[0]) $('model').value = p.models[0]; S.provider = $('provider').value; fillModelList(); };
$('simStart').onclick = () => { uiToSettings(); runSimulation(); };
$('btnResume').onclick = openResume;
$('resumeClose').onclick = () => closeModal('mResume');
$('btnWipe').onclick = async () => { if (confirm('Delete ALL saved sessions from this browser? Export anything you need first.')) { await DB.clear('sessions'); session = null; rowsEl.innerHTML = ''; outlineEl.innerHTML = ''; updateChip(); } };
$('btnExport').onclick = () => {
  if (!session) return alert('No session yet.');
  const c = prompt('Export as: 1 = Markdown (zh + pinyin + en, with slides and notes), 2 = JSON (full session), 3 = Chinese only (.txt)', '1');
  if (c === '1') exportMarkdown(); else if (c === '2') exportJson(); else if (c === '3') exportZhOnly();
};
$('tgPinyin').onclick = () => { S.showPinyin = !S.showPinyin; saveSettings(); applyDisplay(); };
$('tgEn').onclick = () => { S.showEn = !S.showEn; saveSettings(); applyDisplay(); };
$('tgHl').onclick = () => { S.showHl = !S.showHl; saveSettings(); applyDisplay(); };
$('tgSide').onclick = () => { if (window.innerWidth <= 860) { $('side').classList.toggle('open'); return; } S.showSide = !S.showSide; saveSettings(); applyDisplay(); };
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab));
}));
$('slidePrev').onclick = () => Slides.step(-1);
$('slideNext').onclick = () => Slides.step(1);
$('slideAuto').onclick = () => { S.slideAuto = !S.slideAuto; saveSettings(); applyDisplay(); };
$('vocabExport').onclick = () => Vocab.exportCsv();
$('vocabClear').onclick = () => { if (confirm('Clear vocab list?')) { Vocab.list = []; Vocab.save(); } };
window.addEventListener('beforeunload', (e) => { persistNow(); if (recording) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('pagehide', () => persistNow());
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  if (e.key === 'm') $('btnMark').click();
  if (e.key === 'n') $('btnNote').click();
  if (e.key === 'p') $('tgPinyin').click();
  if (e.key === 'e') $('tgEn').click();
});

/* ============================== boot ============================== */
(async function boot() {
  applyDisplay(); Vocab.render(); fillModelList();
  // Reopen the most recent session from today so a page reload mid-lecture loses nothing.
  try {
    const all = ((await DB.all('sessions')) || []).sort((a, b) => b.createdAt - a.createdAt);
    const last = all[0];
    if (last && Date.now() - last.createdAt < 12 * 3600 * 1000 && last.items.length) await resumeSession(last.id);
  } catch (e) { console.warn(e); }
  updateChip(); updateClock();
  if (!S.sonioxKey) setStatus('Set your API keys in ⚙ Settings, then choose a deck in Session.', 'warn');
})();
