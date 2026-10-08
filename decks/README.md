# decks/

Drop your `*.deck.json` files from the slide_translate pipeline here
(e.g. `JP2_10_4to5.merged.deck.json`). The v8 page lists this folder through
the public GitHub API, so on GitHub Pages nothing else is needed.

`index.json` is only a fallback for when the API is unavailable (rate limit,
or running from a plain file server). Keep it as a JSON array of file names:

    ["BT1.merged.deck.json", "JP2_10_4to5.merged.deck.json"]
