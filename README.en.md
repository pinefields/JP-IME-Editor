# IME Editor — a text editor with built-in Japanese input (HTML + JavaScript)  v1.14

**English** | [日本語](README.md)

A text editor that runs entirely in the browser and has its own Japanese input method (IME) built in, so you can type Japanese without an OS-level IME.
The IME does **multi-clause kana-kanji conversion based on morphological analysis** (lattice + Viterbi, with Mozc-compatible costs). IME keys follow ATOK; editor keys and menus follow Hidemaru Editor, and other key schemes (VS Code, Emacs, vi, …) can be selected.

Only the open-source Mozc dictionary (BSD-3) is bundled. **If you own ATOK dictionary files (.DIC), choose them in "Other → Conversion dictionaries → Import dictionary files" after start-up; they are converted inside the browser and become available for conversion** (see below).

The user interface is available in Japanese and English (Other → Environment → Environment → Display language).

## Importing ATOK dictionary files (v1.4)

1. Open Other → Conversion dictionaries and choose `.DIC` / `.dic` files with [Import dictionary files...] (multiple selection allowed).
   For ATOK Pro 4 these are ATOK30.DIC (standard), ATOK30NM.DIC (personal names), ATOK30TK.DIC (single kanji), ATOK30KG.DIC (symbols), ATOK30TR.DIC (trends),
   ATOK30CS/SE/LE.DIC (technical terms) and so on. The Medical Dictionary '07 (Atk_MD*.dic) can be imported too.
2. The files are parsed and converted in the browser on your PC and stored in IndexedDB (nothing is sent anywhere). The standard dictionary takes a few seconds.
   From then on the stored data is loaded, so the dictionary files are no longer needed.
3. Imported dictionaries are added to the list; tick to turn them on or off, [Delete] to remove them. Right after import, the standard, names, single-kanji, symbols,
   trends and technical-term dictionaries are on; katakana-English, Japanese-English, town names, postal codes and the medical dictionary are off.
4. Dictionaries that are not for kana-kanji conversion (character-code, IVS, radical-lookup dictionaries, etc.) cannot be imported (a message says so).

- Storage is per browser and per way of opening (file:// and http://localhost are separate). Clearing the browser's site data also deletes imported dictionaries; import them again in that case.
- `dict/mozc_cal.js` (cost table of all Mozc words, 16 MB) is loaded only during import. ATOK dictionaries carry no frequency information, so words that also exist in Mozc
  use Mozc's part-of-speech ID and cost, and ATOK-only words get a base cost per part of speech. Verbs and adjectives are conjugated from their stems.
- The decoder was verified with ATOK Pro 4 (ATOK30 generation) and the Medical Dictionary '07 (the format of about 2005–2008). Dictionaries of other versions may fail to import.
- **Dictionary contents are copyrighted by their respective owners (JustSystems, Office 21, etc.). Use this only if you hold a valid licence, for your own dictionaries
  on your own PC.** Converted data must not be redistributed.

Settings dialogs (Environment, Conversion dictionaries) apply on [OK]; [Cancel] / ✕ / Esc close them without changes.

## Getting started

1. Put the whole folder somewhere and open `index.html` in **Chrome or Edge** (double-click is fine; it works from file://).
   It works the same when hosted on GitHub Pages or similar (see the notes below).
2. **Turn the OS Japanese input (MS-IME / ATOK) off.**
   If it is on, the OS IME takes the keys first (a warning appears in the status bar).
3. The dictionary loads within 2–3 seconds after start-up (status bar "Dict 1/1"; the number grows when you import dictionaries).
4. Type in romaji → Space to convert → Enter to commit. Press F1 for the key list.

## Files

```
index.html           Main page (UI)
js/ime.js            IME engine (dictionary store, romaji-kana, lattice/Viterbi, clause candidates, learning, prediction)
js/editor.js         Editor (buffer, rendering, Hidemaru-style menus/keys, find/replace, encodings, key macros, dialogs)
js/markdown.js       Markdown renderer / syntax highlighting
js/speech.js         Voice input (Web Speech API)
js/design.js         Colour settings and the colour picker dialog
js/keisen.js         Drawing and erasing ruled lines
js/keymap.js         Key schemes (VS Code / Atom / Emacs / vi / nano / VZ)
js/i18n.js           Display-language switching
js/i18n_en.js        English translation table
dict/manifest.js     List of bundled dictionaries
dict/general.js      General dictionary (generated from the Mozc OSS dictionary, 582,688 words)   ← BSD-3 (dict/LICENSE-mozc.txt)
dict/mozc_cal.js     Cost calibration table (all Mozc words; loaded only when importing dictionary files)
dict/connection.js   Connection cost matrix (Mozc, 2672×2672, quantised in units of 64)
dict/posdef.js       Part-of-speech ID table (Mozc id.def)
js/dictimport.js     ATOK dictionary decoder + conversion to IME dictionaries + IndexedDB storage
tools/               Scripts that generate the dictionary data (Python)
```

Dictionary data is stored as gzip + base64 and expanded with the browser's DecompressionStream when loaded
(Chrome/Edge 80 or later). Memory use is about 80 MB with the bundled dictionary only, and about 180 MB with the main ATOK Pro 4 dictionaries imported and turned on.

## How the IME works

| Stage | Implementation |
|---|---|
| Romaji → kana | ATOK-compatible table (nn/n' → ん, geminates, contracted sounds, ふぁ/てぃ/ゔ, etc.). Input starting with `@` stays alphabetic (abbreviations in the medical dictionary) |
| Dictionary | Reading → entries (surface, left/right context IDs, cost, comment). Hash lookup by reading; prefix search by binary search over sorted keys |
| Multi-clause conversion | Builds a lattice over the whole reading and finds the minimum path of word cost + connection cost (Mozc matrix) with Viterbi. Unknown words are covered by hiragana/katakana/alphanumeric nodes |
| Clause segmentation | Particles, auxiliaries, suffixes, dependent words and symbols attach to the preceding content word. Prefixes join the next word. Noun + する is one clause |
| Candidates | Beam search over paths within the focused clause (including connection costs to neighbouring clauses), grouped by surface. Hiragana / katakana / half-width kana candidates are appended |
| Resizing clauses | Moves the boundary by one character and reconverts the rest |
| Learning | Committed clauses (reading → surface) and words are saved in localStorage and are preferred next time |
| Prediction | Learning history + dictionary prefix matches. Tab to select, Shift+Enter to commit |
| Word registration | Ctrl+F7. The user dictionary is kept in localStorage and can be exported/imported in ATOK word-file format |

### How ATOK dictionaries are incorporated (tools/build_dicts.py)

ATOK dictionaries contain no frequency information, so costs are decided as follows.
- A word whose (reading, surface) also exists in the Mozc dictionary → uses Mozc's part-of-speech ID and (frequency-based) cost as is.
- A word found only in ATOK → the base cost for its part of speech (noun 6500, proper noun 7000, place name 7300, single kanji 7800, …) minus a little according to length.
  Common words rank high through Mozc costs, and ATOK-only words (place names, personal names, technical terms, compounds) complement them.
- Conjugated forms (base, irrealis, continuative, ta-connective, hypothetical, imperative) are generated from verb stems (godan row codes, ichidan, adjective stems)
  and registered with Mozc's conjugation IDs (compound verbs such as 温め直す and 相照らす can be converted).
- "Non-standard printed forms" in the single-kanji dictionary get +500; symbols without a comment (Unicode name) are placed slightly later.
- The Medical Dictionary '07 keeps its earlier setting, giving a bonus to medical words that also appear in the general dictionary (off by default; when on, medical words win in pairs such as 受診/受信).

## Menus (Hidemaru style)

Menus can be operated from the keyboard (v1.5): `Alt+F` (File) `Alt+E` (Edit) `Alt+V` (View) `Alt+S` (Search) `Alt+M` (Macro) `Alt+O` (Other), or Alt alone to enter the menu bar.
Once open, move with ↑↓←→, run with Enter, pick directly with the letter in parentheses, close with Esc.
If the browser takes Alt+F etc. first in your environment, starting Chrome with `--app=<URL>` or installing the page as an app is reliable.

| Menu | Contents |
|---|---|
| File | New / Open / Close and open / Save / Save as / Insert file at cursor / Print / Export as HTML (Markdown) / Encoding (Shift-JIS, EUC, JIS, UTF-16, UTF-16BE, UTF-8; line ends CR+LF/CR/LF; BOM; reload with auto-detection) / Save and exit / Exit |
| Edit | Undo / Redo / Cut / Copy / Append cut / Append copy / Paste / Delete / Convert (UPPER CASE, lower case, half-width, full-width hiragana, full-width katakana, TAB ⇔ spaces, half/full width for alphanumerics-symbols-spaces only, for katakana only, indent, outdent, sort, case conversion, half/full-width conversion, JSON expand/minify, remove duplicate lines) / Format / Markdown / Select all / Clipboard history / Reload |
| View | Word wrap / Ruler / Line numbers / Show full-width spaces, tabs, line ends / Highlight cursor line / Status bar / Full screen / Colour scheme (standard, black) / Font size / Markdown mode / Markdown preview / IME on/off |
| Search | Find / Find next / Find previous / Replace / Highlight matches / Back to search start / Go to line / Top / end of file / Last edit position / Next / previous edit mark / Previous cursor position / Heading list (Markdown) / Marks |
| Macro | Start/stop key recording (Shift+F1) / Play (Shift+F2) / Save / Load / Ruled lines |
| Other | Configuration for each file type / Environment / Key bindings / Register word / User dictionary / Conversion dictionaries / Clear learning data / About |

In Chrome/Edge, Open, Save and Save as read and write real files directly through the File System Access API
(other browsers fall back to downloads). Items that cannot be realised in a browser, such as grep and the macro language, have been removed from the menus.

The Find dialog has the same layout as Hidemaru's and supports **regular expressions** (JavaScript syntax), whole-word search, case sensitivity, fuzzy search (treats full/half width, hiragana/katakana and upper/lower case as equal)
and match highlighting. In the replacement string, `\0`–`\9` refer to groups.

## Configuration for each file type, and Environment (v1.9)

As in Hidemaru, settings are split into two dialogs. In both, switch pages with "Target" on the left; [OK] applies and saves, [Cancel] discards.

- **Other → Configuration for each file type**: Font / Form (wrapping) · Tab (2/4/8/custom, insert spaces with the Tab key) · Indent (auto indent) /
  Design (list of places with text colour, background colour and style; reset; save/load colour schemes) · Showing1 (line-end character, EOF, tab character, full-width space) · Showing2 (ruler, line numbers, cursor line)
- **Other → Environment**: File (encoding, line ends and BOM for new files) / View and operation (status bar, theme) / Markdown / Kana-kanji conversion (IME) / Voice input / Environment (display language, key bindings)

In "Design", pick an item from the list of places and open the colour dialog with the text-colour or background-colour button (48 basic colours, system background/text colour, hue × saturation plane with a luminance bar, numeric HSL/RGB input, OK/Cancel).
The ticks in the list turn display on or off and are linked to the ticks on Showing1 and Showing2. "Save/Load" applies a whole scheme at once: white background / black background / dark grey / cream / green background.
The English terms follow the English edition of Hidemaru (Form, Showing1, Places, Assigned color, Return code character, etc.).

## Ruled lines (v1.10)

In the style of OASYS word processors, moving the cursor with the arrow keys while holding a modifier draws text ruled lines along the path.

| Key | Action |
|---|---|
| Alt+Arrow | Draw a thin line (─│┌┐└┘├┤┬┴┼) |
| Alt+Shift+Arrow | Draw a thick line (━┃┏┓┗┛┣┫┳┻╋). Where it crosses a thin line, ┿ ╂ ┠ ┨ ┯ ┷ etc. are chosen automatically |
| Alt+Ctrl+Arrow | Erase lines |

Corners, T-junctions and crossings are decided automatically from how the lines connect. Passing over existing text replaces that cell (one full-width character) with the line; short lines are padded with spaces, and moving below the last line adds lines.
Macro → Ruled lines switches between full-width box characters and half-width ASCII (+-|); "Insert table row" creates an empty row right below that inherits the vertical lines of the cursor row. Each step can be undone with Ctrl+Z.
"Line drawing mode" in the same menu draws with the arrow keys alone (Shift = thick, Ctrl = erase, Esc = leave).
Box-drawing characters are treated as full width (2 columns), so use a monospaced Japanese font.

## Key bindings (v1.12)

Other → Environment → Environment → Key bindings switches the editor's key scheme. Press F1 to list the bindings.

| Scheme | Main contents |
|---|---|
| Hidemaru Editor (default) | As before |
| Visual Studio Code | Alt+↑↓ move line, Shift+Alt+↑↓ copy line, Ctrl+Shift+K delete line, Ctrl+/ comment, Ctrl+D select word, Ctrl+L select line, etc. |
| Atom | Ctrl+↑↓ move line, Ctrl+Shift+D duplicate line, Ctrl+J join lines, etc. |
| Emacs | C-f/b/n/p, C-a/e, M-f/b, C-k / C-y, C-Space · C-w · M-w, C-x C-s, C-x C-f, C-/, etc. (Esc works as the Meta key) |
| vi / Vim | Normal / insert / visual modes. Motions, d y c > < with text objects, p, u, ., / ? n N, :w :q :%s, etc. |
| nano | ^K / ^U, ^O, ^X, ^W, ^\, ^_, M-U / M-E, etc. |
| VZ Editor | Diamond cursor (^E ^X ^S ^D), two-stroke ^Q and ^K commands, text stack with ^Y / ^J, etc. |

- While composing or converting kana, the IME (ATOK-style) keys take priority in every scheme.
- Keys the selected scheme does not bind keep their standard (Hidemaru) behaviour.
- In a normal tab the browser handles Ctrl+N, Ctrl+T and Ctrl+W. They reach the editor while in View → Full screen (F11) (Keyboard Lock API, Chrome / Edge).
- The VS Code / Atom schemes use Alt+↑↓ for moving lines, so use Macro → Ruled lines → Line drawing mode for ruled lines.
- vi search and substitution use JavaScript regular expressions. Registers, marks, macros (q) and blockwise visual mode are not supported.

## Display language (v1.8)

"Display language" in Other → Environment → Environment switches between Japanese and English (applied immediately on [OK]; no reload needed).
Menus, dialogs, the status bar and messages change. The translation table is `js/i18n_en.js` (Japanese string → English); corrections and additions only need this file.
In the English menus the underlined letter is the Alt access key (Alt+F → File, X → Exit).

## Voice input (v1.3, Web Speech API)

- Toggle with 🎤 in the status bar, `Ctrl+Alt+M`, or Other → Voice input. Text being recognised is shown at the cursor with a dotted underline and inserted there when final (can be mixed with keyboard input).
- Recognition mode (Other → Environment → Voice input): **on-device only** (default; audio is not sent out; requires Chrome 139 or later plus the Japanese language pack of about 60 MB, installable from the same page) /
  prefer on-device / cloud (audio is sent to Google's servers in Chrome and Microsoft's in Edge; do not use it to speak confidential information such as patient data).
- Voice commands: 「かいぎょう」 → line break, 「まる」 at the end of a sentence → 。, 「てん」 → 、. Punctuation type, full-width digits and half-width kana follow the IME input defaults.
- **Reconversion**: select a misrecognised word and press the `変換` (Convert) key or `Ctrl+Alt+R` to replace it with a homophone candidate from the built-in IME dictionary (e.g. 受信した → 受診した). Esc twice restores it. Building the reverse index takes about a second the first time.
- If the microphone prompt does not appear under file://, run `py -m http.server 8000` in the folder and open `http://localhost:8000/index.html`.

## Markdown (.md) support

- Opening `.md` / `.markdown` switches to Markdown mode automatically (it can also be fixed with View → Markdown mode)
- **Syntax colouring** for headings, lists, checkboxes, quotes, code, links, emphasis and tables
- The outline bar (below the menu) shows the current heading; click it to jump from the **heading list**
- View → **Markdown preview** shows a preview on the right (scroll-synchronised, dark scheme supported). GFM tables, task lists and fenced code are supported
- Edit → Markdown: bold / italic / strikethrough / code / code block / link / heading level / bullet list / numbered list / checklist / toggle check / quote / horizontal rule / **format table** (align column widths)
- File → **Export as HTML** saves styled HTML

## IME input defaults (Other → Environment)

| Item | Choices |
|---|---|
| Period / comma | 。(full-width) ｡(half-width) ．. / 、(full-width) ､(half-width) ，, |
| Symbols | Full or half width for each of 「」（）ー・！？〜：；＠＃＄％＆＊＋＝＜＞｛｝＿＾｜＼”’｀; [All full-width] / [All half-width] change them at once |
| Katakana | Commit as full-width / half-width (ｶﾅ) |
| Digits | Half-width / full-width |
| Letters (typed with Shift) | Half-width / full-width |
| Space | Full-width / half-width (Shift+Space gives the other) |
| Input mode at start-up, IME on/off at start-up, automatic prediction, number of candidates shown | |

## Keys (excerpt; F1 shows the full list)

| IME (ATOK) | |
|---|---|
| Ctrl+Space / 変換 (Convert) / click on the status bar | IME on/off |
| 無変換 (Non-convert) / Shift+無変換 | あ → ア → ｱ / Ａ ⇔ A |
| Space · 変換 · ↓ / ↑ | Convert, next candidate (candidate list on the second press) / previous candidate |
| Enter / ↓ (while converting) | Commit all / commit the focused clause and move on |
| ← → / Shift+← Shift+→ | Move between clauses / shrink or extend the clause |
| Backspace (while converting) / Esc / Shift+Del | Cancel conversion / cancel / delete the focused clause |
| F6–F10 (Ctrl+U/I/O/P/@) | Hiragana / katakana / half-width kana / full-width alphanumeric / half-width alphanumeric |
| Tab / Shift+Enter | Select prediction / commit prediction |
| Ctrl+Backspace / Ctrl+F7 | Undo commit / register word |

| Editor (Hidemaru) | |
|---|---|
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+F / Ctrl+R / F3 / Shift+F3 | Find / replace / find next / find previous |
| Ctrl+G | Go to line |
| Ctrl+L | Last edit position |
| Shift+F1 / Shift+F2 | Record keys / play |
| Ctrl+B | Start selection |
| Ctrl+S / Ctrl+O / Ctrl+P | Save / open / print |
| Home / End / Ctrl+Home / Ctrl+End / Ctrl+←→ | Start of line (toggles with indent) / end of line / top / end of document / move by word |
| F11 | Full screen |
| Insert | Insert / overwrite |

With word wrap on, wrapped parts count as separate lines as in Hidemaru (line numbers, status bar, Go to line), and ↑↓, Home and End move by display line (v1.13).

Display: line numbers, ruler, marks for full-width spaces (dotted box), tabs (^), line ends (↓) and [EOF], cursor-line highlight, word wrap on/off, colour scheme (standard/black).
Files: Shift-JIS / EUC / JIS / UTF-8 / UTF-16 are detected automatically on open and saved with the same encoding and line ends (changeable from the menu).

## Regenerating the bundled dictionary (if needed)

```
py tools/build_dicts.py <Mozc dictionary folder> - - dict      # general.js / mozc_cal.js / connection.js / posdef.js / manifest.js
```
The Mozc dictionary is `src/data/dictionary_oss/` in https://github.com/google/mozc (dictionary00–09.txt, id.def, connection_single_column.txt).
`tools/atokdic_dump.py` is a stand-alone tool that dumps a dictionary file to TSV (the same decoding as js/dictimport.js).

## Notes and limitations

- Only the Mozc dictionary (BSD-3-Clause, dict/LICENSE-mozc.txt) is bundled. Imported ATOK dictionary data is stored only in the user's browser and is not part of the distribution.
- Conversion accuracy does not match ATOK or Google Japanese Input (the language model is roughly a word bigram; ATOK's associative and contextual processing and its frequency information are not reproduced).
  Learning and word registration help.
- Browser shortcuts (Ctrl+N new window, Ctrl+T, Ctrl+W) cannot be intercepted in a normal tab. Use "New" in the menu, or switch to full screen (F11).
- "Exit" may be unable to close the tab because of browser restrictions (close the tab by hand in that case).
- Advanced Hidemaru features such as vertical writing, rectangular selection, the macro language and grep are not available.
- Files of more than a few tens of thousands of lines take several seconds for the first rendering (about 1 second for 20,000 lines).
