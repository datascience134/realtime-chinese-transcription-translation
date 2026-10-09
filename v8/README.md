# v8 — TCM Lecture Reader: user manual

Chinese-first live transcript for lectures. It reads your pre-translated slide
decks (`*.deck.json` from `slide_translate`) to bias speech recognition,
underline words you already studied, detect the current slide, and translate
sentence by sentence a few seconds behind the speaker.

Everything runs in the browser. There is no server. The page talks to Soniox
and to your translation API directly and stores transcripts in the browser.

Page: `https://datascience134.github.io/realtime-chinese-transcription-translation/v8/`

---

## 1. The quick version

**Once:** ⚙ Settings → paste Soniox key → paste Gemini key → Done.

**Before class:** upload the deck to `decks/` on GitHub → **Session** → tick it → **New session**.

**In class:** **Start**. Read the big Chinese line. Press **✎ Note** when the
teacher says something important that is not on the slides. **Stop** at the end.

**After class:** **Export** → option 1 → a Markdown file of the whole lecture.

Everything below explains the rest. Defaults are fine for all of it.

---

## 2. The main screen

### Top bar, left to right

| Control | What it does |
|---|---|
| **Start / Stop** | Starts or stops listening to the microphone. Red dot blinks while recording. |
| **00:00** | Time since the session started recording. Pauses when you Stop. |
| Status text | What the page is doing: *Listening*, *Reconnecting*, an error, etc. Green is good, yellow is working on it, red needs you. |
| Session chip | Name of the current session and the deck(s) loaded. "No session" means you have not set one up yet. |
| **拼音** | Show or hide pinyin above the characters. Hide it when you want to test yourself. Key: `p`. |
| **EN** | Show or hide all English translations. When hidden, each row's own EN button still reveals that one sentence. Key: `e`. |
| **Slide words** | Turn the blue underline on or off. The underline marks words that appear anywhere in the loaded deck, i.e. words you already pre-read. |
| **Pane** | Show or hide the right-hand side pane. On a phone this opens the pane as a drawer. |
| **Session** | Opens the Session dialog: choose decks, name the session, start a new one. See section 4. |
| **Export** | Save the transcript. 1 = Markdown (Chinese + pinyin + English, grouped by slide, with your notes), 2 = JSON (everything, for re-importing or processing later), 3 = Chinese only, one sentence per line. |
| **⚙** | Settings. See section 3. |

### The transcript (middle)

Each finished sentence is one row:

- Left: the time it was spoken. Click it to set the **reading cursor**, an
  orange outline that marks where you were when you looked up at the teacher.
- Middle: the Chinese, large, with pinyin above. Blue underline = on your
  slides. Under it, the English in smaller grey text.
- Right, visible on hover: **⧉** copies the Chinese of that row, **EN** shows
  or requests the translation for that row, **⌖** sets the reading cursor.

Other things you will see in the transcript:

- A dashed line with a time, every 5 minutes. Just a landmark.
- A gap before a row: the teacher paused for more than ~2.5 seconds, so the
  page treats it as a new paragraph.
- An orange **Slide N** bar: the page detected that the teacher moved to slide
  N of your deck. Yellow **Mark** bar: you pressed Mark.
- An orange **✎** row: a note you typed.
- The last row, with grey text at its end, is the sentence being spoken right
  now. Grey = still being recognised and may change. Once it turns white it is
  final.

**Tap any Chinese word** to open a small popup:

- The word and its pinyin.
- If the word is in your glossary or on a slide, that English.
- **Explain**: asks the translation model for a one-line meaning (one small API
  call). **Save**: adds it to the Vocab tab. **Copy**: copies the word.
  **✕** or tap elsewhere closes it.

### Floating buttons, bottom right

- **✎ Note** (key `n`): type something in your own words. It is inserted at
  the current point in the transcript and included in the export. Use it for
  "exam point", "not on slide", "ask later".
- **✂ Mark & translate** (key `m`): three things at once. Forces Soniox to
  finish the current sentence, drops a yellow Mark bar, and translates
  everything still waiting immediately instead of waiting for the batch. Use
  it at topic changes, or when you want the English *now*.

### Side pane tabs

- **Outline**: one line per paragraph start, slide change, mark and note, with
  its time. Click a line to jump there. This is your map of the lecture.
- **Slide**: the slide the page thinks the teacher is on, with each clause in
  Chinese, pinyin and English, exactly as in your deck. **◀ ▶** step to
  another slide by hand. **Auto** (on by default) lets the page detect the
  slide from what is being said. Turn Auto off if detection keeps jumping
  wrongly and use ◀ ▶ instead.
- **Vocab**: every word you saved with the popup. **Export CSV (Anki)**
  downloads them as `zh, pinyin, english, sentence` for import into Anki.
  **Clear** empties the list.

---

## 3. Settings (⚙), field by field

### Transcription (Soniox)

| Field | Meaning | Touch it when |
|---|---|---|
| **Soniox API key** | Your paid Soniox key. Stored only in this browser. | Required. |
| **Endpoint delay** (default 1500 ms) | How long a pause before Soniox decides a sentence has ended. Lower = sentences finish sooner, so translations arrive sooner, but a teacher who pauses mid-sentence gets chopped. | Sentences feel chopped: raise to 2000–2500. Translations feel slow: lower to 1000. |
| **Endpoint sensitivity** (default 0.2) | How eager Soniox is to end a sentence. Higher = more, shorter sentences. | Rows are very long run-ons: raise to 0.5. Rows are fragments: lower to 0 or −0.3. |
| **Paragraph gap** (default 2.5 s) | A silence longer than this starts a new paragraph (and an Outline entry). | Too many or too few paragraph breaks. |

### Translation (any OpenAI-compatible API)

| Field | Meaning | Touch it when |
|---|---|---|
| **Provider preset** | Fills in the endpoint URL and suggests models. Gemini, OpenRouter, DeepSeek, Qwen, or Custom. | You want to try a different model provider. |
| **Model** | The model id sent to the provider. Suggestions appear as you type; copy the exact id from your provider if unsure. | Flash-Lite ignores instructions; use `gemini-3.5-flash` or better. |
| **Endpoint URL** | Where requests go. Filled by the preset. | Only for Custom. |
| **API key** | The provider's key. Stored only in this browser. | Required. |
| **Translate** | *Every sentence* (default). *Only sentences not on the slides*: sentences whose words are mostly on the deck are left untranslated with a "tap EN" hint, saving calls and pushing you to read the Chinese. *Only when I tap*: nothing is translated unless you press a row's EN. | You want fewer calls or more reading practice. |
| **Batch: sentences** (3) / **max wait** (8 s) | Sentences are translated in small groups: as soon as 3 are waiting, or 8 seconds after the first one, whichever comes first. Bigger batches = fewer API calls, slightly later English. | Rate-limit errors: raise both. English too slow: lower both (1 and 3 is near-instant). |
| **Ask for JSON output** | Tells the model to reply in a strict format so every sentence gets its own translation. If a provider rejects it, the page turns it off by itself. | Leave on. |
| **Keep TCM terms in Chinese with pinyin** | The English keeps key terms as `肝郁 (gān yù, liver qi stagnation)` on first use. Off = plain English. | You prefer plain English. |
| **Extra instructions** | Anything you want added to the translator's instructions, e.g. "the teacher's course is on diagnostics; 诊 is always 'diagnosis'". | A recurring mistranslation. |

### Glossary

One line per term, `中文 = English`. Used in two ways: the Chinese side is sent
to Soniox as vocabulary so it recognises the term, and both sides are sent to
the translator as the preferred rendering. It persists across sessions. Add a
line every time you notice a term being mis-heard or mis-translated. The
English side is optional; `术语 =` alone still helps recognition.

### Deck source (GitHub)

Where the Session dialog looks for deck files. On GitHub Pages leave all four
blank; owner and repo are read from the page URL. Fill them in only if you run
the page from somewhere else (Codespaces, a local server). **Folder** is the
repo folder holding the decks, **Branch** is the branch to read.

### Display

**Theme** dark or light. **Chinese size** in pixels; 28–32 is comfortable on a
laptop from a distance. **Time ruler every N min** spacing of the dashed time
lines.

### Test mode (no microphone)

Paste Chinese text, set a speed, press **Run test stream**. The text is fed
through exactly the same path as live Soniox tokens, so you can see how
sentences split, how slide detection behaves with your deck, and what the
translation looks like, all without a lecture. Use a paragraph copied from a
slide to check slide detection, and a made-up aside to check highlighting.

### Data

**Resume previous session…** lists every saved session with date and sentence
count; **Open** restores it on screen, **✕** deletes it. **Delete all saved
sessions** wipes the browser's store. Export first if you need anything.

Sessions are saved automatically after every sentence, and today's session
is reopened automatically if you reload the page mid-lecture.

---

## 4. The Session dialog

A **session** is one lecture: its transcript, its notes, and the deck(s) it is
matched against.

| Control | What it does |
|---|---|
| **Session name** | Free text, used as the export file name. |
| Deck list | Decks found in the repo folder (*repo*), plus any you imported into this browser (*this device*). Tick the one(s) for today. The optional text box takes a slide range like `12-40` or `5,7,9-12`, which limits vocabulary and slide detection to those slides. |
| **Refresh list** | Re-reads the repo folder, e.g. right after you uploaded a deck. |
| **Import deck.json from this device** / drop zone | Loads a deck file from your computer into this browser only. Useful when you forgot to upload, or on a day without GitHub access. **remove** deletes it from the browser. |
| **Vocabulary sent to Soniox** | Generated automatically from the ticked decks and your glossary. Edit it if you see junk or want to add a term for today only. Soniox receives as many as fit; the whole slide text is also sent as background context. |
| **Apply to current** | Changes the deck or name of the session already on screen, keeping the transcript. If you are recording, the connection restarts with the new vocabulary. |
| **New session** | Clears the screen and starts a fresh session with these decks. The old session stays saved and can be reopened from Settings → Resume. |

Where decks come from: upload each lecture's `<name>.merged.deck.json` from
the `slide_translate` pipeline into the `decks/` folder of this repo on
GitHub (Add file → Upload files). The page lists that folder through the
public GitHub API. `decks/index.json` is a fallback list of file names for
when the API is unavailable; keep it updated if you run the page outside
GitHub Pages.

---

## 5. Things that happen on their own

- **Screen stays awake** while recording.
- **Connection drops** are retried automatically with a short back-off; audio
  during the gap is buffered and sent when reconnected. The status turns yellow
  while this happens and green again when done.
- **Translation failures** show in red under the sentence with a **Retry**
  button. Rate-limit and server errors are retried a few times before that.
- **Slide detection** compares the last few sentences against every slide of
  the deck and needs two sentences in a row to agree before switching, so it
  lags the teacher by a sentence or two and will not flap on asides.
- **Pinyin** is computed on the page, never by the translation model, so it
  is always present and consistent.

## 6. Keyboard shortcuts

`m` Mark & translate · `n` Note · `p` toggle pinyin · `e` toggle English.
They are ignored while you are typing in a text box.

## 7. What changed from v6/v7

- Append-only rendering: each sentence is rendered once. v6 rebuilt the whole
  live cell on every token, which starved the audio sender and made the
  transcript lag behind fast speech.
- Sentence-level automatic translation with batching, retries, JSON output,
  and slide/glossary context in the prompt, instead of one manual cut per slide.
- Slide vocabulary and slide text sent to Soniox; v6 had this commented out.
- Correct end-of-stream signal and current API-key auth per the Soniox docs.
- Wake lock, auto-reconnect, saved sessions, resume after reload.
- Copy works on the live sentence; per-row copy buttons.
- Timestamps, time ruler, paragraph breaks, outline, reading cursor, notes,
  vocab list, export.
