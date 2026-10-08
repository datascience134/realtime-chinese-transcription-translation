# v8 — TCM Lecture Reader

Chinese-first live transcript for lectures. Reads your pre-translated slide
decks (`*.deck.json` from `slide_translate`) to bias speech recognition,
highlight words you already studied, detect the current slide, and translate
sentence by sentence a few seconds behind the speaker.

Everything runs in the browser. There is no server: the page talks to Soniox
and to your translation API directly, and stores transcripts in the browser.

## Files

```
v8/
├── index.html      page + styles
├── app.js          all logic
└── lib/
    ├── pinyin-pro.js   pinyin with sentence context (same build as v6)
    └── zh-words.js     CC-CEDICT word list for word grouping (same as v6)
decks/              put your *.deck.json files here (repo root, not inside v8/)
```

## One-time setup

1. **GitHub Pages.** Repo → Settings → Pages → Source: *Deploy from a branch*,
   branch `main`, folder `/ (root)`. Save. After about a minute the page is at
   `https://<owner>.github.io/<repo>/v8/`.
2. **Soniox key.** Open the page → ⚙ Settings → paste the key. (Paid, as before.)
3. **Translation key.** Settings → pick a provider preset, paste its key, pick a
   model. Gemini: enable billing on the key at aistudio.google.com so the
   per-minute limit stops biting. Other presets: OpenRouter, DeepSeek, Qwen
   (Alibaba Model Studio). Any OpenAI-compatible endpoint works via *Custom*.
   The model suggestions in the dropdown are examples; copy the exact id from
   your provider's model list.
4. **Glossary.** Settings → one `术语 = English` per line. These are sent to
   Soniox and to the translator in every session.

## Before each lecture

1. Run the `slide_translate` pipeline as usual and take the
   `<name>.merged.deck.json` it produces.
2. On GitHub, open the `decks/` folder → *Add file* → *Upload files* → drop the
   deck → Commit. (Or drag the file into the page's Session dialog; that copy
   lives only in that browser.)
3. On the page: **Session** → tick the deck(s), optionally type a slide range
   such as `12-40`, check the generated vocabulary list, **New session**.

## During the lecture

- **Start** begins listening. The screen stays awake, and the connection
  reconnects by itself if it drops.
- Read the big Chinese line. Blue-underlined words are on your slides. Grey
  text at the end of the live row is still being recognised.
- English appears under each sentence a few seconds later. **EN** in the top
  bar hides it globally; the per-row **EN** button shows or translates one
  sentence. In Settings you can switch to translating only sentences that are
  *not* on the slides.
- **Slide** tab: the detected slide's clauses with pinyin and English. ◀ ▶
  override detection; **Auto** turns detection off.
- **Outline** tab: paragraph starts and slide changes; click to jump.
- **✂ Mark & translate** (key `m`): force-finalise the current sentence, drop
  a boundary marker, translate everything pending now.
- **✎ Note** (key `n`): type an important point in your own words; it is
  stored inline and exported.
- Tap any word: pinyin, the slide's English for it if present, **Explain**
  (one short model call), **Save** to the Vocab tab, **Copy**.
- Hover a row: copy its Chinese, set the reading cursor (also click the time).
- Reloading the page restores today's session automatically.

## After the lecture

**Export** → Markdown (Chinese + pinyin + English, grouped by slide, with your
notes and timestamps), JSON (everything), or Chinese-only text. **Vocab** →
Export CSV gives an Anki-importable file.

## Deck discovery

The page lists `decks/` through the public GitHub API (60 requests/hour,
unauthenticated, no token needed). On GitHub Pages the owner and repo are read
from the URL. Running from somewhere else (Codespaces, a local server), set
Owner/Repo in Settings, or keep `decks/index.json` updated as a fallback:

```json
["BT1.merged.deck.json", "JP2_10_4to5.merged.deck.json"]
```

## Testing without a lecture

Settings → *Test mode*: paste Chinese text and press *Run test stream*. It is
fed through the same code path as Soniox tokens.

## Soniox settings that matter

- `Endpoint delay` (default 1500 ms): how long a pause ends a sentence.
- `Endpoint sensitivity` (default 0.2): higher = more, shorter sentences.
- The vocabulary and the slide text are sent as Soniox *context* (limit about
  10k characters; the page trims to fit).

## What changed from v6/v7

- Append-only rendering: each sentence is rendered once, never rebuilt. v6
  rebuilt the whole live cell on every token, which starved the audio sender
  and made the transcript lag behind fast speech.
- Sentence-level, automatic translation with batching (3 sentences or 8 s),
  retries with backoff, JSON output, and slide/glossary context in the prompt.
- Slide vocabulary and slide text sent to Soniox; v6 had this commented out.
- Correct end-of-stream (empty text frame) and current API-key auth
  (WebSocket protocol list) per the Soniox docs.
- Wake lock, auto-reconnect, IndexedDB persistence, resume after reload.
- Copy works on the live sentence too; per-row copy buttons.
- Timestamps, time ruler, paragraph breaks on pauses, outline pane, reading
  cursor, notes, vocab list, export.
