/* ============================================================================
 *  editor.js -- 秀丸エディタ風テキストエディタ + 内蔵IME (ime.js) の結合
 * ========================================================================== */
'use strict';

const $ = (s) => document.querySelector(s);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ---------------------------------------------------------------- 設定 */
const Settings = {
  key: 'jpime_editor_settings',
  data: { fontSize: 15, wrap: false, showMarks: true, lineNumbers: true, ruler: true, statusBar: true, curLine: true, theme: 'light',
          autoIndent: true, tabWidth: 4, tabSpaces: false, wrapCol: 80,
          // IME 入力既定
          digitsZen: false, spaceZen: true, slashZen: false, predictAuto: true, candPerPage: 9,
          kuten: '。', touten: '、', kataHankaku: false, alphaZen: false, bracketHan: false, startMode: 'hira', imeOnStart: true,
          symKagi: '「」', symParen: '（）', symChouon: 'ー', symNakaten: '・', symExq: '！？', symTilde: '〜', symColon: '：；',
          symAt: '@', symHash: '＃', symDollar: '＄', symPercent: '%', symAmp: '＆', symAster: '＊', symPlus: '＋', symEqual: '＝', symLtGt: '＜＞', symBrace: '｛｝', symUnder: '＿', symCaret: '＾', symBar: '｜', symYen: '＼', symDq: '”', symSq: '’', symBq: '｀', keymap: 'hidemaru',
          // ファイル
          newEncoding: 'utf8', newEol: '\r\n', bom: false, dicts: null,
          mdPreview: false, mdAuto: true, design: null, lang: 'ja', keisenHalf: false,
          // 音声入力
          speechMode: 'local', speechContinuous: true, speechCommands: true, speechKuten: false },
  load() { try { Object.assign(this.data, JSON.parse(localStorage.getItem(this.key) || '{}')); } catch (e) {} },
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {} }
};
Settings.load();

/* ---------------------------------------------------------------- 文書 */
class Doc {
  constructor(text, eol) { this.setText(text || '', eol); this.undo = []; this.redo = []; this.dirty = false; }
  setText(text, eol) {
    this.eol = eol || (text.includes('\r\n') ? '\r\n' : text.includes('\r') ? '\r' : '\n');
    this.lines = text.replace(/\r\n?/g, '\n').split('\n');
  }
  getText() { return this.lines.join(this.eol); }
  lineCount() { return this.lines.length; }
  getRange(a, b) {
    if (a.line === b.line) return this.lines[a.line].substring(a.col, b.col);
    const parts = [this.lines[a.line].substring(a.col)];
    for (let i = a.line + 1; i < b.line; i++) parts.push(this.lines[i]);
    parts.push(this.lines[b.line].substring(0, b.col));
    return parts.join('\n');
  }
  replaceRange(a, b, text, record = true, coalesceKey = null) {
    const old = this.getRange(a, b);
    const before = this.lines[a.line].substring(0, a.col), after = this.lines[b.line].substring(b.col);
    const ins = text.split('\n');
    const newLines = ins.slice();
    newLines[0] = before + newLines[0];
    const endCol = newLines[newLines.length - 1].length;
    newLines[newLines.length - 1] += after;
    this.lines.splice(a.line, b.line - a.line + 1, ...newLines);
    const end = { line: a.line + ins.length - 1, col: endCol };
    if (this.onChange) this.onChange(a.line, b.line - a.line + 1, newLines.length, end);
    if (record) {
      const rec = { a: { ...a }, b: { ...end }, old, text, key: coalesceKey };
      const last = this.undo[this.undo.length - 1];
      if (coalesceKey && last && last.key === coalesceKey && last.b.line === a.line && last.b.col === a.col && !old) { last.text += text; last.b = { ...end }; }
      else this.undo.push(rec);
      if (this.undo.length > 3000) this.undo.shift();
      this.redo.length = 0;
      this.dirty = true;
    }
    return end;
  }
  doUndo() { const r = this.undo.pop(); if (!r) return null; this.replaceRange(r.a, r.b, r.old, false); this.redo.push(r); this.dirty = true; return this._endOf(r.a, r.old); }
  doRedo() { const r = this.redo.pop(); if (!r) return null; const end = this.replaceRange(r.a, this._endOf(r.a, r.old), r.text, false); this.undo.push(r); this.dirty = true; return end; }
  _endOf(a, text) { const p = text.split('\n'); return p.length === 1 ? { line: a.line, col: a.col + text.length } : { line: a.line + p.length - 1, col: p[p.length - 1].length }; }
}
const posLt = (a, b) => a.line < b.line || (a.line === b.line && a.col < b.col);
const posEq = (a, b) => a.line === b.line && a.col === b.col;

/** 記号の全角/半角設定 (追加分): [設定名, ローマ字表での既定の文字] */
const SYM_MORE = [['symAt', '＠'], ['symHash', '＃'], ['symDollar', '＄'], ['symPercent', '％'], ['symAmp', '＆'], ['symAster', '＊'], ['symPlus', '＋'], ['symEqual', '＝'], ['symLtGt', '＜＞'], ['symBrace', '｛｝'], ['symUnder', '＿'], ['symCaret', '＾'], ['symBar', '｜'], ['symYen', '＼'], ['symDq', '”'], ['symSq', '’'], ['symBq', '｀']];

/* ---------------------------------------------------------------- 文字コード */
const Enc = {
  labels: { sjis: '日本語(Shift-JIS)', euc: '日本語(EUC)', jis: '日本語(JIS)', utf16le: 'Unicode(UTF-16)', utf16be: 'Unicode(UTF-16,Big-Endian)', utf8: 'Unicode(UTF-8)' },
  short: { sjis: 'Shift-JIS', euc: 'EUC', jis: 'JIS', utf16le: 'UTF-16', utf16be: 'UTF-16BE', utf8: 'UTF-8' },
  _maps: {},
  _buildMap(label) {
    const dec = new TextDecoder(label), m = new Map();
    for (let c = 0x20; c < 0x7f; c++) m.set(String.fromCharCode(c), [c]);
    if (label === 'shift_jis') {
      for (let c = 0xA1; c <= 0xDF; c++) m.set(dec.decode(new Uint8Array([c])), [c]);
      for (let hi = 0x81; hi <= 0xFC; hi++) { if (hi > 0x9F && hi < 0xE0) continue;
        for (let lo = 0x40; lo <= 0xFC; lo++) { if (lo === 0x7F) continue; const s = dec.decode(new Uint8Array([hi, lo])); if (s.length === 1 && s !== '�' && !m.has(s)) m.set(s, [hi, lo]); } }
    } else { // euc-jp
      for (let c = 0xA1; c <= 0xDF; c++) m.set(dec.decode(new Uint8Array([0x8E, c])), [0x8E, c]);
      for (let hi = 0xA1; hi <= 0xFE; hi++) for (let lo = 0xA1; lo <= 0xFE; lo++) { const s = dec.decode(new Uint8Array([hi, lo])); if (s.length === 1 && s !== '�' && !m.has(s)) m.set(s, [hi, lo]); }
    }
    return m;
  },
  map(label) { return this._maps[label] || (this._maps[label] = this._buildMap(label)); },
  decode(buf, enc) {
    if (enc === 'utf8') { if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) buf = buf.subarray(3); return new TextDecoder('utf-8').decode(buf); }
    if (enc === 'utf16le') { if (buf[0] === 0xFF && buf[1] === 0xFE) buf = buf.subarray(2); return new TextDecoder('utf-16le').decode(buf); }
    if (enc === 'utf16be') { if (buf[0] === 0xFE && buf[1] === 0xFF) buf = buf.subarray(2); return new TextDecoder('utf-16be').decode(buf); }
    return new TextDecoder({ sjis: 'shift_jis', euc: 'euc-jp', jis: 'iso-2022-jp' }[enc]).decode(buf);
  },
  detect(buf) {
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return { enc: 'utf8', bom: true };
    if (buf[0] === 0xFF && buf[1] === 0xFE) return { enc: 'utf16le', bom: true };
    if (buf[0] === 0xFE && buf[1] === 0xFF) return { enc: 'utf16be', bom: true };
    for (let i = 0; i < Math.min(buf.length, 4000) - 2; i++) if (buf[i] === 0x1B && buf[i + 1] === 0x24 && (buf[i + 2] === 0x42 || buf[i + 2] === 0x40)) return { enc: 'jis', bom: false };
    try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return { enc: 'utf8', bom: false }; } catch (e) {}
    const score = (t) => { let s = 0; for (const ch of t.substring(0, 20000)) { if (ch === '�') s -= 5; else if (/[぀-ヿ一-鿿]/.test(ch)) s += 1; else if (/[⺀-⿟㄀-㏿豈-﫿]/.test(ch)) s -= 1; } return s; };
    const sj = new TextDecoder('shift_jis').decode(buf), eu = new TextDecoder('euc-jp').decode(buf);
    return { enc: score(eu) > score(sj) ? 'euc' : 'sjis', bom: false };
  },
  encode(text, enc, bom) {
    if (enc === 'utf8') { const b = new TextEncoder().encode(text); if (!bom) return b; const o = new Uint8Array(b.length + 3); o.set([0xEF, 0xBB, 0xBF]); o.set(b, 3); return o; }
    if (enc === 'utf16le' || enc === 'utf16be') {
      const le = enc === 'utf16le', out = new Uint8Array(text.length * 2 + (bom ? 2 : 0)); let p = 0;
      if (bom) { out[0] = le ? 0xFF : 0xFE; out[1] = le ? 0xFE : 0xFF; p = 2; }
      for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); if (le) { out[p++] = c & 0xff; out[p++] = c >> 8; } else { out[p++] = c >> 8; out[p++] = c & 0xff; } }
      return out;
    }
    const out = [];
    if (enc === 'sjis' || enc === 'euc') {
      const m = this.map(enc === 'sjis' ? 'shift_jis' : 'euc-jp');
      for (const ch of text) { if (ch === '\n' || ch === '\r' || ch === '\t') { out.push(ch.charCodeAt(0)); continue; } const b = m.get(ch); if (b) out.push(...b); else out.push(...(enc === 'sjis' ? [0x81, 0x48] : [0xA1, 0xA9])); }
      return new Uint8Array(out);
    }
    // ISO-2022-JP
    const m = this.map('euc-jp'); let mode = 'A';
    const setMode = (md) => { if (mode === md) return; out.push(0x1B, ...(md === 'A' ? [0x28, 0x42] : md === 'K' ? [0x24, 0x42] : [0x28, 0x49])); mode = md; };
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      if (c < 0x80) { setMode('A'); out.push(c); continue; }
      const b = m.get(ch);
      if (!b) { setMode('K'); out.push(0x21, 0x29); continue; }
      if (b.length === 2 && b[0] === 0x8E) { setMode('H'); out.push(b[1] - 0x80); }
      else { setMode('K'); out.push(b[0] - 0x80, b[1] - 0x80); }
    }
    setMode('A');
    return new Uint8Array(out);
  }
};

/* ---------------------------------------------------------------- テキスト変換 (編集→変換) */
const Xform = {
  hanAscii: (s) => s.replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' '),
  zenAscii: (s) => s.replace(/[!-~]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)).replace(/ /g, '　'),
  hanKata: (s) => JP.kataToHankaku(s),
  hanPunct: (s) => s.replace(/[。、「」・”“’‘￥〜]/g, c => ({ '。': '｡', '、': '､', '「': '｢', '」': '｣', '・': '･', '”': '"', '“': '"', '’': "'", '‘': "'", '￥': '\\', '〜': '~' })[c]),
  zenPunct: (s) => s.replace(/[｡､｢｣･]/g, c => ({ '｡': '。', '､': '、', '｢': '「', '｣': '」', '･': '・' })[c]),
  zenKata: (s) => JP.hankakuToKata(s),
  hira: (s) => JP.kataToHira(JP.hankakuToKata(s)),
  kata: (s) => JP.hiraToKata(JP.hankakuToKata(s)),
  tabToSpace(s, w) { return s.split('\n').map(l => { let o = ''; for (const c of l) { if (c === '\t') o += ' '.repeat(w - (JP.charWidth && o.split('').reduce((a, x) => a + JP.charWidth(x), 0) % w)); else o += c; } return o; }).join('\n'); },
  spaceToTab(s, w) { return s.split('\n').map(l => l.replace(/^( +)/, (m) => '\t'.repeat(Math.floor(m.length / w)) + ' '.repeat(m.length % w))).join('\n'); },
  dedupeAdjacent: (s) => s.split('\n').filter((l, i, a) => i === 0 || l !== a[i - 1]).join('\n'),
  trimRight: (s) => s.split('\n').map(l => l.replace(/[ \t　]+$/, '')).join('\n'),
  removeBlank: (s) => s.split('\n').filter(l => l.trim() !== '').join('\n'),
  squeezeBlank: (s) => s.replace(/\n(\s*\n)+/g, '\n\n'),
  joinLines: (s) => s.replace(/\n/g, ''),
  reflow(s, cols) {
    const out = [];
    for (const para of s.split('\n')) { let cur = '', w = 0; for (const c of para) { const cw = JP.charWidth(c); if (w + cw > cols) { out.push(cur); cur = ''; w = 0; } cur += c; w += cw; } out.push(cur); }
    return out.join('\n');
  }
};

/* ---------------------------------------------------------------- エディタ */
class Editor {
  constructor() {
    this.doc = new Doc('', Settings.data.newEol);
    this.cur = { line: 0, col: 0 };
    this.anchor = null; this.selMode = false; this.overwrite = false;
    this.fileName = '(無題)'; this.fileHandle = null; this.srcBytes = null;
    this.encoding = Settings.data.newEncoding; this.bom = Settings.data.bom;
    this.prefCol = null;
    this.ime = new IME(this._imeOpts());
    this.ime.on = Settings.data.imeOnStart;
    this.find = { text: '', repl: '', regex: false, icase: true, word: false, fuzzy: false, inSel: false, hl: false, hist: [], startPos: null };
    this.rendered = []; this.dirtyFrom = 0; this.dirtyLines = new Set(); this.lnFrom = Infinity; this.prevCur = { line: 0, col: 0 }; this.prevSel = null;
    this.editMarks = new Set(); this.bookmarks = new Set(); this.lastEditPos = null; this.posHistory = [];
    this.clipHistory = []; this.internalClip = '';
    this.macro = { recording: false, keys: [] };
    this.mdManual = null;   // null=自動(.md/.markdown) / true / false
    this._fence = null;
    this.el = { editor: $('#editor'), text: $('#text'), kb: $('#kb'), cand: $('#cand'), pred: $('#pred'), status: $('#status'), ruler: $('#ruler'), preview: $('#preview'), outline: $('#outline') };
    this._hookDoc(this.doc);
    this._bind();
    this.applySettings();
    this.render();
    this.focus();
  }
  _imeOpts() { const d = Settings.data; return { digitsZen: d.digitsZen, spaceZen: d.spaceZen, slashZen: d.slashZen, predictAuto: d.predictAuto, candPerPage: d.candPerPage, kuten: d.kuten, touten: d.touten, kataHankaku: d.kataHankaku, alphaZen: d.alphaZen, bracketHan: false, startMode: d.startMode, sym: this._symMap(), chouon: d.symChouon || 'ー', atZen: d.symAt === '＠' }; }
  /** 記号の全角/半角設定 → { 既定の文字: 入力する文字 } */
  _symMap() {
    const d = Settings.data, m = {};
    if (d.bracketHan) { d.symKagi = '｢｣'; d.bracketHan = false; }            // 旧設定の引き継ぎ
    if (d.slashZen) { d.symNakaten = '／'; d.slashZen = false; }
    const pair = (def, val) => { if (val && val !== def && val.length === def.length) for (let i = 0; i < def.length; i++) m[def[i]] = val[i]; };
    pair('「」', d.symKagi); pair('（）', d.symParen); pair('・', d.symNakaten); pair('！？', d.symExq); pair('〜', d.symTilde); pair('：；', d.symColon);
    for (const [f, def] of SYM_MORE) pair(def, d[f]);
    return m;
  }
  _hookDoc(doc) { doc.onChange = (from, nOld, nNew, end) => { this.markDirty(from, nOld, nNew); this.lastEditPos = { ...end }; this._shiftMarks(from, nOld, nNew); }; }
  _shiftMarks(from, nOld, nNew) {
    const shift = (set) => { const d = nNew - nOld; if (!d) return; const n = new Set(); for (const l of set) { if (l < from) n.add(l); else if (l >= from + nOld) n.add(l + d); else if (l < from + nNew) n.add(l); } set.clear(); for (const l of n) set.add(l); };
    shift(this.editMarks); shift(this.bookmarks);
    for (let k = 0; k < Math.max(1, nNew); k++) this.editMarks.add(from + k);
  }
  isMd() { return this.mdManual !== null ? this.mdManual : (Settings.data.mdAuto && /\.(md|markdown|mdown|mkd)$/i.test(this.fileName)); }
  /* ---- Markdown 編集補助 ---- */
  mdWrap(before, after) {
    const sel = this.selection();
    if (sel && sel.a.line === sel.b.line) { const t = this.selectedText(); const end = this.doc.replaceRange(sel.a, sel.b, before + t + after); this.anchor = { line: sel.a.line, col: sel.a.col + before.length }; this.cur = { line: end.line, col: end.col - after.length }; }
    else { this.clearSelection(); const end = this.doc.replaceRange(this.cur, this.cur, before + after); this.cur = { line: end.line, col: end.col - after.length }; }
  }
  mdHeading(delta) {
    this.transformLines(t => t.split('\n').map(l => { const m = l.match(/^(#{0,6})\s?(.*)$/); let n = m[1].length + delta; if (n < 0) n = 0; if (n > 6) n = 6; return n ? '#'.repeat(n) + ' ' + m[2] : m[2]; }).join('\n'));
  }
  mdList(kind) {   // 'ul' | 'ol' | 'task'
    this.transformLines(t => { const ls = t.split('\n'); const all = ls.every(l => /^\s*([-*+]|\d+[.)])\s/.test(l)); return ls.map((l, i) => { const m = l.match(/^(\s*)(?:([-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?(.*)$/); if (all && kind !== 'task') return m[1] + m[3]; return m[1] + (kind === 'ol' ? (i + 1) + '. ' : kind === 'task' ? '- [ ] ' : '- ') + m[3]; }).join('\n'); });
  }
  mdToggleCheck() {
    const l = this.doc.lines[this.cur.line]; const m = l.match(/^(\s*[-*+]\s+)\[([ xX])\]/);
    if (!m) return this.flash('チェックボックス行ではありません');
    this.doc.replaceRange({ line: this.cur.line, col: m[1].length + 1 }, { line: this.cur.line, col: m[1].length + 2 }, m[2] === ' ' ? 'x' : ' ');
  }
  mdFormatTable() {
    let a = this.cur.line, b = this.cur.line; const isRow = (l) => /\|/.test(l) && l.trim();
    if (!isRow(this.doc.lines[a])) return this.flash('表の行にカーソルを置いてください');
    while (a > 0 && isRow(this.doc.lines[a - 1])) a--; while (b < this.doc.lineCount() - 1 && isRow(this.doc.lines[b + 1])) b++;
    const cells = (s) => { s = s.trim(); if (s.startsWith('|')) s = s.slice(1); if (s.endsWith('|')) s = s.slice(0, -1); return s.split(/(?<!\\)\|/).map(c => c.trim()); };
    const rows = []; for (let i = a; i <= b; i++) rows.push(cells(this.doc.lines[i]));
    const ncol = Math.max(...rows.map(r => r.length)); const w = (s) => Array.from(s).reduce((x, c) => x + JP.charWidth(c), 0);
    const sepIdx = rows.findIndex(r => r.every(c => /^:?-+:?$/.test(c)));
    const widths = new Array(ncol).fill(3);
    rows.forEach((r, ri) => { if (ri === sepIdx) return; r.forEach((c, k) => widths[k] = Math.max(widths[k], w(c))); });
    const pad = (c, k, align) => { const sp = widths[k] - w(c); if (align === 'right') return ' '.repeat(sp) + c; if (align === 'center') return ' '.repeat(Math.floor(sp / 2)) + c + ' '.repeat(sp - Math.floor(sp / 2)); return c + ' '.repeat(sp); };
    const aligns = sepIdx >= 0 ? rows[sepIdx].map(c => /^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : /^:-+$/.test(c) ? 'left' : '') : new Array(ncol).fill('');
    const out = rows.map((r, ri) => { if (ri === sepIdx) return '| ' + widths.map((wd, k) => { const al = aligns[k]; let d = '-'.repeat(wd); if (al === 'center') d = ':' + '-'.repeat(wd - 2) + ':'; else if (al === 'right') d = '-'.repeat(wd - 1) + ':'; else if (al === 'left') d = ':' + '-'.repeat(wd - 1); return d; }).join(' | ') + ' |'; return '| ' + widths.map((wd, k) => pad(r[k] || '', k, aligns[k])).join(' | ') + ' |'; }).join('\n');
    const end = this.doc.replaceRange({ line: a, col: 0 }, { line: b, col: this.doc.lines[b].length }, out); this.clearSelection(); this.cur = { line: Math.min(this.cur.line, end.line), col: 0 };
  }
  exportHtml() {
    const body = MD.render(this.doc.getText());
    const title = this.fileName.replace(/\.[^.]+$/, '');
    const html = MD.document(title, body, Settings.data.theme === 'dark');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })); a.download = (title === '(無題)' ? '無題' : title) + '.html'; a.click();
    this.flash('HTMLを書き出しました');
  }
  currentHeading() {
    if (!this.isMd()) return null;
    const hs = MD.headings(this.doc.lines); let cur = null; for (const h of hs) { if (h.line <= this.cur.line) cur = h; else break; } return cur;
  }
  applySettings() {
    const d = Settings.data;
    document.documentElement.style.setProperty('--fs', d.fontSize + 'px');
    document.documentElement.style.setProperty('--tab', d.tabWidth);
    document.documentElement.classList.toggle('theme-dark', d.theme === 'dark');
    this.el.text.classList.toggle('wrap', d.wrap);
    if (I18N.setLang(d.lang) && typeof Menu !== 'undefined' && Menu.relabel) { Menu.relabel(); this._titleKey = null; }
    this.el.text.classList.toggle('nomarks', !d.showMarks);
    this.el.text.classList.toggle('noln', !d.lineNumbers);
    this.el.text.classList.toggle('nocur', !d.curLine);
    this.el.ruler.style.display = d.ruler ? '' : 'none';
    this.el.status.style.display = d.statusBar ? '' : 'none';
    this.el.preview.style.display = (d.mdPreview && this.isMd()) ? '' : 'none';
    let st = $('#mdcss'); if (!st) { st = document.createElement('style'); st.id = 'mdcss'; document.head.appendChild(st); } if (typeof Design !== 'undefined') Design.apply();
    st.textContent = MD.css(typeof Design !== 'undefined' ? Design.isDark() : d.theme === 'dark').replace(/body\.md,\.md\{/, '#preview .md{').replace(/\.md /g, '#preview .md ');
    this._previewDirty = true;
    Object.assign(this.ime.opts, this._imeOpts());
    this.ime.conv.kataHankaku = d.kataHankaku;
    this.rendered = []; this.render(); this.renderRuler();
  }
  focus() { this.el.kb.focus({ preventScroll: true }); }

  /* ---- 描画の差分管理 ---- */
  markDirty(from, nOld, nNew) {
    if (this.rendered.length === 0) return;
    const tx = this.el.text;
    if (nOld !== nNew) {
      this.rendered.splice(from, nOld, ...new Array(nNew));
      for (let k = 0; k < nOld && tx.children[from]; k++) tx.removeChild(tx.children[from]);
      const ref = tx.children[from] || null;
      for (let k = 0; k < nNew; k++) { const d = document.createElement('div'); d.className = 'line'; d.innerHTML = '<span class="ln"></span><span class="lc"></span>'; tx.insertBefore(d, ref); }
      this.lnFrom = Math.min(this.lnFrom, from);
    } else for (let k = 0; k < nNew; k++) this.dirtyLines.add(from + k);
  }
  setDoc(doc) { this.doc = doc; this._hookDoc(doc); this.rendered = []; this.dirtyFrom = 0; this.editMarks.clear(); this.bookmarks.clear(); this.lastEditPos = null; this.posHistory = []; }

  /* ---- 選択 ---- */
  selection() { if (!this.anchor || posEq(this.anchor, this.cur)) return null; return posLt(this.anchor, this.cur) ? { a: this.anchor, b: this.cur } : { a: this.cur, b: this.anchor }; }
  selectedText() { const s = this.selection(); return s ? this.doc.getRange(s.a, s.b) : ''; }
  clearSelection() { this.anchor = null; this.selMode = false; }
  startSelIfShift(e) { if (e.shiftKey || this.selMode) { if (!this.anchor) this.anchor = { ...this.cur }; } else this.anchor = null; }
  docEnd() { return { line: this.doc.lineCount() - 1, col: this.doc.lines[this.doc.lineCount() - 1].length }; }

  /* ---- 編集 ---- */
  deleteSelection() { const s = this.selection(); if (!s) return false; this.doc.replaceRange(s.a, s.b, ''); this.cur = { ...s.a }; this.clearSelection(); return true; }
  insertText(text, coalesce = false) {
    this.deleteSelection();
    let end = { ...this.cur };
    if (this.overwrite && !text.includes('\n')) {
      const line = this.doc.lines[this.cur.line];
      const n = Math.min(Array.from(text).length, Array.from(line.substring(this.cur.col)).length);
      let e = this.cur.col; for (let i = 0; i < n; i++) e += (line.codePointAt(e) > 0xffff ? 2 : 1);
      end = { line: this.cur.line, col: e };
    }
    this.cur = this.doc.replaceRange(this.cur, end, text, true, coalesce ? 'type' : null);
    this.prefCol = null;
  }
  retractChars(n) { const a = { line: this.cur.line, col: Math.max(0, this.cur.col - n) }; this.doc.replaceRange(a, this.cur, ''); this.cur = a; }
  /** 選択範囲(なければ全体)を関数で変換 */
  transform(fn, wholeIfNone = true) {
    let s = this.selection();
    if (!s) { if (!wholeIfNone) { this.flash('範囲を選択してください'); return; } s = { a: { line: 0, col: 0 }, b: this.docEnd() }; }
    const t = this.doc.getRange(s.a, s.b), out = fn(t);
    if (out === t || out == null) return;
    const end = this.doc.replaceRange(s.a, s.b, out);
    this.anchor = { ...s.a }; this.cur = end; this.selMode = false;
  }
  /** 行単位の選択範囲に拡張して変換 */
  transformLines(fn) {
    let s = this.selection();
    if (!s) s = { a: { line: 0, col: 0 }, b: this.docEnd() };
    const a = { line: s.a.line, col: 0 }, bl = (s.b.col === 0 && s.b.line > s.a.line) ? s.b.line - 1 : s.b.line, b = { line: bl, col: this.doc.lines[bl].length };
    const t = this.doc.getRange(a, b), out = fn(t);
    if (out === t || out == null) return;
    const end = this.doc.replaceRange(a, b, out);
    this.anchor = a; this.cur = end; this.selMode = false;
  }
  indent() { this.transformLines(t => t.split('\n').map(l => (Settings.data.tabSpaces ? ' '.repeat(Settings.data.tabWidth) : '\t') + l).join('\n')); }
  unindent() { this.transformLines(t => t.split('\n').map(l => l.replace(/^(\t| {1,4}|　)/, '')).join('\n')); }

  /* ---- カーソル ---- */
  clampCur() { this.cur.line = Math.max(0, Math.min(this.doc.lineCount() - 1, this.cur.line)); this.cur.col = Math.max(0, Math.min(this.doc.lines[this.cur.line].length, this.cur.col)); }
  colWidth(line, col) { let w = 0; const s = this.doc.lines[line]; for (let i = 0; i < col && i < s.length; i++) w += s[i] === '\t' ? Settings.data.tabWidth - (w % Settings.data.tabWidth) : JP.charWidth(s[i]); return w; }
  colFromWidth(line, width) { const s = this.doc.lines[line]; let w = 0; for (let i = 0; i < s.length; i++) { const cw = s[i] === '\t' ? Settings.data.tabWidth - (w % Settings.data.tabWidth) : JP.charWidth(s[i]); if (w + cw / 2 >= width) return i; w += cw; } return s.length; }
  pushPos() { const last = this.posHistory[this.posHistory.length - 1]; if (!last || !posEq(last, this.cur)) this.posHistory.push({ ...this.cur }); if (this.posHistory.length > 100) this.posHistory.shift(); }
  jumpTo(pos, select) { this.rowEnd = false; this.pushPos(); this.cur = { ...pos }; this.clampCur(); if (!select) this.clearSelection(); this.prefCol = null; }
  moveVert(dy, e) {
    if (Settings.data.wrap) return this.moveRows(dy, e);
    this.startSelIfShift(e); if (this.prefCol === null) this.prefCol = this.colWidth(this.cur.line, this.cur.col); this.cur.line = Math.max(0, Math.min(this.doc.lineCount() - 1, this.cur.line + dy)); this.cur.col = this.colFromWidth(this.cur.line, this.prefCol); }
  /* ---- 折り返し表示のときの「表示行」。秀丸と同じく、折り返された部分も 1 行として数え、上下・Home・End も表示行で動く ---- */
  /** 表示行 1 行ぶんの高さ */
  rowH() {
    const tx = this.el.text, key = getComputedStyle(tx).font;
    if (this._rowHKey !== key) { const m = document.createElement('div'); m.className = 'line'; m.style.cssText = 'position:absolute;visibility:hidden'; m.innerHTML = '<span class="lc">0</span>'; tx.appendChild(m); this._rowHv = m.getBoundingClientRect().height || 20; m.remove(); this._rowHKey = key; }
    return this._rowHv;
  }
  /** 論理行 li の各表示行が始まる桁位置 (折り返しなしなら [0])。画面の実際の折り返し位置を測る */
  rows(li) {
    const s = this.doc.lines[li];
    if (!Settings.data.wrap || !s) return [0];
    if (!this._rowCache) this._rowCache = new Map();
    const c = this._rowCache.get(li);
    if (this.ime.active) return (c && c.text === s) ? c.starts : [0];
    const el = this.el.text.children[li], lc = el && el.lastChild; if (!lc) return [0];
    const w = lc.clientWidth;
    if (c && c.text === s && c.w === w && c.font === this._rowHKey) return c.starts;
    const h = this.rowH(), starts = [0], tops = [0];
    if (lc.offsetHeight > h * 1.5) {
      const range = document.createRange(), walker = document.createTreeWalker(lc, NodeFilter.SHOW_TEXT), base = lc.getBoundingClientRect().top;
      let col = 0, top = null, t;
      while ((t = walker.nextNode())) {
        if (t.parentElement.closest('.pre, .eol, .eof')) continue;
        const v = t.nodeValue;
        for (let i = 0; i < v.length; i++, col++) {
          if (/[\uDC00-\uDFFF]/.test(v[i])) continue;
          range.setStart(t, i); range.setEnd(t, i + 1);
          const r = range.getClientRects()[0]; if (!r) continue;
          if (top !== null && r.top > top + h / 2) { starts.push(col); tops.push(r.top - base); }
          if (top === null || r.top > top + h / 2) top = r.top;
        }
      }
    }
    if (this._rowCache.size > 4000) this._rowCache.clear();
    this._rowCache.set(li, { text: s, w, font: this._rowHKey, starts, tops });
    return starts;
  }
  /** 桁位置 col がある表示行。 atEnd: 折り返し位置ちょうどのとき、前の表示行の行末とみなす */
  rowOf(starts, col, atEnd) { let r = 0; while (r + 1 < starts.length && starts[r + 1] <= col) r++; if (atEnd && r > 0 && starts[r] === col) r--; return r; }
  moveRows(dy, e) {
    this.startSelIfShift(e);
    const keepEnd = this.rowEndPrev, n = this.doc.lineCount(), sg = dy < 0 ? -1 : 1;
    let li = this.cur.line, st = this.rows(li), r = this.rowOf(st, this.cur.col, keepEnd);
    if (this.prefCol === null) this.prefCol = this.colWidth(li, this.cur.col) - this.colWidth(li, st[r]);
    for (let k = Math.abs(dy); k > 0; k--) {
      if (sg > 0) { if (r + 1 < st.length) r++; else if (li + 1 < n) { li++; st = this.rows(li); r = 0; } else break; }
      else { if (r > 0) r--; else if (li > 0) { li--; st = this.rows(li); r = st.length - 1; } else break; }
    }
    const last = r === st.length - 1, a = st[r], b = last ? this.doc.lines[li].length : st[r + 1];
    if (keepEnd && !last) { this.cur = { line: li, col: b }; this.rowEnd = true; return; }
    this.cur = { line: li, col: Math.max(a, Math.min(this.colFromWidth(li, this.colWidth(li, a) + this.prefCol), last ? b : b - 1)) };
  }
  /** Home (dir < 0) / End (dir > 0): 表示行の先頭・末尾へ */
  rowEdge(dir, e) {
    this.startSelIfShift(e); this.prefCol = null;
    const li = this.cur.line, s = this.doc.lines[li], st = this.rows(li), r = this.rowOf(st, this.cur.col, this.rowEndPrev);
    if (dir < 0) { if (r > 0) this.cur.col = st[r]; else { const ind = s.match(/^[ \t　]*/)[0].length; this.cur.col = (this.cur.col === ind) ? 0 : ind; } }
    else if (r + 1 < st.length) { this.cur.col = st[r + 1]; this.rowEnd = true; }
    else this.cur.col = s.length;
  }
  /** 行番号を表示行ごとに振り直す (折り返し表示のとき)。 _rowBase[i] = 論理行 i より前にある表示行の数 */
  updateRowNumbers(again) {
    const tx = this.el.text, n = this.doc.lineCount(), h = this.rowH(), cnt = new Array(n), base = new Array(n + 1);
    let total = 0;
    for (let i = 0; i < n; i++) { base[i] = total; const el = tx.children[i]; cnt[i] = el ? Math.max(1, Math.round(el.lastChild.offsetHeight / h)) : 1; total += cnt[i]; }
    base[n] = total; this._rowBase = base; this._rowTotal = total;
    const lnw = String(total).length;
    if (this._lnw !== lnw) { this._lnw = lnw; document.documentElement.style.setProperty('--lnw', (lnw + 1) + 'ch'); if (!again) return this.updateRowNumbers(true); }
    if (!Settings.data.lineNumbers) return;
    for (let i = 0; i < n; i++) {
      const el = tx.children[i]; if (!el) continue;
      let want = String(base[i] + 1).padStart(lnw, ' ');
      for (let k = 1; k < cnt[i]; k++) want += '\n' + String(base[i] + 1 + k).padStart(lnw, ' ');
      if (el._ln !== want) { el.firstChild.textContent = want; el._ln = want; }
    }
  }
  moveHoriz(dx, e) {
    this.startSelIfShift(e); this.prefCol = null;
    const sel = !e.shiftKey && !this.selMode && this.selection();
    if (sel) { this.cur = dx < 0 ? { ...sel.a } : { ...sel.b }; this.clearSelection(); return; }
    const s = this.doc.lines[this.cur.line];
    if (dx < 0) { if (this.cur.col > 0) { this.cur.col--; if (this.cur.col > 0 && /[\uDC00-\uDFFF]/.test(s[this.cur.col])) this.cur.col--; } else if (this.cur.line > 0) { this.cur.line--; this.cur.col = this.doc.lines[this.cur.line].length; } }
    else { if (this.cur.col < s.length) { this.cur.col++; if (this.cur.col < s.length && /[\uDC00-\uDFFF]/.test(s[this.cur.col])) this.cur.col++; } else if (this.cur.line < this.doc.lineCount() - 1) { this.cur.line++; this.cur.col = 0; } }
  }
  wordClass(c) { if (/\s/.test(c)) return 0; if (/[A-Za-z0-9_]/.test(c)) return 1; if (/[ぁ-ゟ]/.test(c)) return 2; if (/[゠-ヿ]/.test(c)) return 3; if (/[一-鿿]/.test(c)) return 4; return 5; }
  moveWord(dx, e) {
    this.startSelIfShift(e); this.prefCol = null;
    const s = this.doc.lines[this.cur.line];
    if (dx > 0) { if (this.cur.col >= s.length) { if (this.cur.line < this.doc.lineCount() - 1) { this.cur.line++; this.cur.col = 0; } return; } let i = this.cur.col; const k = this.wordClass(s[i]); while (i < s.length && this.wordClass(s[i]) === k) i++; while (i < s.length && /\s/.test(s[i])) i++; this.cur.col = i; }
    else { if (this.cur.col === 0) { if (this.cur.line > 0) { this.cur.line--; this.cur.col = this.doc.lines[this.cur.line].length; } return; } let i = this.cur.col; while (i > 0 && /\s/.test(s[i - 1])) i--; const k = this.wordClass(s[i - 1]); while (i > 0 && this.wordClass(s[i - 1]) === k) i--; this.cur.col = i; }
  }
  selectWordAt(line, col) { const s = this.doc.lines[line]; if (!s.length) return; col = Math.min(col, s.length - 1); const k = this.wordClass(s[col]); let a = col, b = col + 1; while (a > 0 && this.wordClass(s[a - 1]) === k) a--; while (b < s.length && this.wordClass(s[b]) === k) b++; this.anchor = { line, col: a }; this.cur = { line, col: b }; }
  gotoLine(n) {
    if (Settings.data.wrap && this._rowBase) {          // 折り返し表示中は、画面の行番号(表示行)で指定する
      const b = this._rowBase, row = Math.max(0, Math.min(n - 1, b[b.length - 1] - 1)); let li = 0;
      while (li + 1 < b.length - 1 && b[li + 1] <= row) li++;
      const st = this.rows(li); this.jumpTo({ line: li, col: st[Math.min(row - b[li], st.length - 1)] || 0 }); this.render(); return;
    }
    this.jumpTo({ line: n - 1, col: 0 }); this.render();
  }

  /* ---- 検索 ---- */
  _fuzzyNorm(s) { let o = ''; for (const c of s) { let n = c.normalize('NFKC'); if (n.length !== 1) n = c; n = JP.kataToHira(n).toLowerCase(); o += n; } return o; }
  buildRegex() {
    const f = this.find; if (!f.text) return null;
    let src = f.regex ? f.text : f.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (f.fuzzy && !f.regex) src = this._fuzzyNorm(f.text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try { return new RegExp(src, 'g' + (f.icase ? 'i' : '')); } catch (e) { this.flash('正規表現エラー: ' + e.message, 5000); return null; }
  }
  _lineMatches(re, text) {
    const t = this.find.fuzzy && !this.find.regex ? this._fuzzyNorm(text) : text;
    const res = []; re.lastIndex = 0; let m;
    while ((m = re.exec(t)) !== null) {
      if (!m[0].length) { re.lastIndex++; continue; }
      if (this.find.word) { const a = m.index, b = a + m[0].length; const kb = text[a - 1] !== undefined && this.wordClass(text[a - 1]) === this.wordClass(text[a]); const ke = text[b] !== undefined && this.wordClass(text[b]) === this.wordClass(text[b - 1]); if (kb || ke) continue; }
      res.push({ i: m.index, len: m[0].length });
    }
    return res;
  }
  findNext(dir = 1) {
    const re = this.buildRegex(); if (!re) { if (!this.find.text) this.flash('検索文字列がありません'); return false; }
    if (!this.find.startPos) this.find.startPos = { ...this.cur };
    const L = this.doc.lines, n = L.length, sel = this.selection();
    let start = { ...this.cur };
    if (dir > 0 && sel) start = { ...sel.b }; else if (dir < 0 && sel) start = { ...sel.a };
    for (let step = 0; step <= n; step++) {
      const li = ((start.line + dir * step) % n + n) % n;
      const ms = this._lineMatches(re, L[li]);
      if (dir > 0) { for (const mm of ms) if (step > 0 || mm.i >= start.col) { if (step > 0 && li < start.line) this.flash('先頭から検索しました'); this.anchor = { line: li, col: mm.i }; this.cur = { line: li, col: mm.i + mm.len }; this.render(); return true; } }
      else { for (let j = ms.length - 1; j >= 0; j--) { const mm = ms[j]; if (step > 0 || mm.i + mm.len <= start.col) { if (step > 0 && li > start.line) this.flash('末尾から検索しました'); this.anchor = { line: li, col: mm.i }; this.cur = { line: li, col: mm.i + mm.len }; this.render(); return true; } } }
    }
    this.flash('見つかりません'); return false;
  }
  _replText(rep) { return this.find.regex ? rep.replace(/\\(\d)/g, '$$$1').replace(/\\n/g, '\n').replace(/\\t/g, '\t') : rep; }
  replaceOne(rep) {
    const sel = this.selection(); if (!sel) return this.findNext(1);
    const re = this.buildRegex(); if (!re) return false;
    const t = this.selectedText();
    const ms = this._lineMatches(re, t);
    if (ms.length === 1 && ms[0].i === 0 && ms[0].len === t.length) {
      const out = this.find.regex ? t.replace(new RegExp(re.source, this.find.icase ? 'i' : ''), this._replText(rep)) : rep;
      this.doc.replaceRange(sel.a, sel.b, out); this.cur = this.doc._endOf(sel.a, out); this.clearSelection();
    }
    return this.findNext(1);
  }
  replaceAll(rep) {
    const re = this.buildRegex(); if (!re) return 0;
    let s = this.find.inSel && this.selection();
    const a = s ? s.a : { line: 0, col: 0 }, b = s ? s.b : this.docEnd();
    const lines = this.doc.getRange(a, b).split('\n'); let n = 0;
    const r1 = new RegExp(re.source, this.find.icase ? 'i' : '');
    const out = lines.map(line => {
      const ms = this._lineMatches(re, line); if (!ms.length) return line;
      let o = '', p = 0;
      for (const m of ms) { o += line.substring(p, m.i); const seg = line.substr(m.i, m.len); o += this.find.regex ? seg.replace(r1, this._replText(rep)) : rep; p = m.i + m.len; n++; }
      return o + line.substring(p);
    }).join('\n');
    if (n) { const end = this.doc.replaceRange(a, b, out); this.cur = end; this.clearSelection(); this.render(); }
    return n;
  }

  /* ---- ファイル ---- */
  async newFile() {
    if (this.doc.dirty && !confirm('変更が保存されていません。破棄しますか?')) return;
    this.setDoc(new Doc('', Settings.data.newEol)); this.cur = { line: 0, col: 0 }; this.clearSelection();
    this.fileName = '(無題)'; this.fileHandle = null; this.srcBytes = null; this.encoding = Settings.data.newEncoding; this.bom = Settings.data.bom; this.render();
  }
  loadBytes(buf, name, encOverride) {
    const det = encOverride ? { enc: encOverride, bom: false } : Enc.detect(buf);
    let text; try { text = Enc.decode(buf, det.enc); } catch (e) { this.flash('読み込みエラー: ' + e.message, 5000); return; }
    this.setDoc(new Doc(text)); this.cur = { line: 0, col: 0 }; this.clearSelection(); this.fileName = name; this.encoding = det.enc; this.bom = det.bom; this.srcBytes = buf;
    this.render(); this.flash(`${name} を開きました (${Enc.short[det.enc]}, ${this.doc.lineCount()}行)`);
  }
  async openFile(insertAtCursor = false) {
    if (!insertAtCursor && this.doc.dirty && !confirm('変更が保存されていません。破棄しますか?')) return;
    if (window.showOpenFilePicker) {
      try { const [h] = await window.showOpenFilePicker(); const f = await h.getFile(); const buf = new Uint8Array(await f.arrayBuffer());
        if (insertAtCursor) { const det = Enc.detect(buf); this.insertText(Enc.decode(buf, det.enc).replace(/\r\n?/g, '\n')); this.render(); }
        else { this.loadBytes(buf, f.name); this.fileHandle = h; }
      } catch (e) { if (e.name !== 'AbortError') this.flash('開けませんでした: ' + e.message, 5000); }
      this.focus(); return;
    }
    const inp = $('#fileInput'); inp.onchange = async () => { const f = inp.files[0]; if (!f) return; const buf = new Uint8Array(await f.arrayBuffer());
      if (insertAtCursor) { const det = Enc.detect(buf); this.insertText(Enc.decode(buf, det.enc).replace(/\r\n?/g, '\n')); this.render(); } else { this.loadBytes(buf, f.name); this.fileHandle = null; }
      inp.value = ''; this.focus(); };
    inp.click();
  }
  reloadWith(enc) {
    if (!this.srcBytes) { this.encoding = enc; this.flash(`保存時の文字コードを ${Enc.short[enc]} にしました`); return; }
    if (this.doc.dirty && !confirm('変更が保存されていません。読み込みなおしますか?')) return;
    const name = this.fileName, h = this.fileHandle; this.loadBytes(this.srcBytes, name, enc); this.fileHandle = h;
  }
  async saveFile(as = false) {
    const text = this.doc.getText();
    const bytes = Enc.encode(text, this.encoding, this.bom);
    if (window.showSaveFilePicker) {
      try {
        let h = this.fileHandle;
        if (as || !h) h = await window.showSaveFilePicker({ suggestedName: this.fileName === '(無題)' ? '無題.txt' : this.fileName, types: [{ description: 'テキスト', accept: { 'text/plain': ['.txt'] } }] });
        const w = await h.createWritable(); await w.write(bytes); await w.close();
        this.fileHandle = h; this.fileName = h.name; this.srcBytes = bytes; this.doc.dirty = false; this.render();
        this.flash(`${h.name} を保存しました (${Enc.short[this.encoding]}${this.bom ? ' BOM' : ''}, ${this.doc.eol === '\r\n' ? 'CR+LF' : this.doc.eol === '\r' ? 'CR' : 'LF'})`);
        return true;
      } catch (e) { if (e.name === 'AbortError') return false; this.flash('保存に失敗: ' + e.message + ' (ダウンロードします)', 4000); }
    }
    let name = this.fileName === '(無題)' ? '無題.txt' : this.fileName;
    if (as) { const n = prompt('ファイル名', name); if (!n) return false; name = n; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'text/plain' })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    this.fileName = name; this.doc.dirty = false; this.render(); this.flash(`${name} をダウンロード保存しました (${Enc.short[this.encoding]})`); return true;
  }
  async exitApp(save) { if (save) { if (!(await this.saveFile(false))) return; } else if (this.doc.dirty && !confirm('変更が保存されていません。終了しますか?')) return; this.doc.dirty = false; window.close(); setTimeout(() => this.flash('ブラウザのタブを閉じてください'), 300); }
  print() { window.print(); }

  /* ---- クリップボード ---- */
  async copySel(cut, append) {
    const t = this.selectedText(); if (!t) return;
    const text = append ? this.internalClip + t : t;
    this.internalClip = text; this.clipHistory.unshift(text); if (this.clipHistory.length > 30) this.clipHistory.pop();
    try { await navigator.clipboard.writeText(text.replace(/\n/g, this.doc.eol)); } catch (e) {}
    if (cut) { this.deleteSelection(); this.render(); }
  }
  pasteText(t) { this.commitIme(); this.insertText(t.replace(/\r\n?/g, '\n')); this.render(); }

  /* ---- キーマクロ ---- */
  macroToggle() { if (this.macro.recording) { this.macro.recording = false; this.flash(`キー操作の記録を終了 (${this.macro.keys.length} キー)`); } else { this.macro.recording = true; this.macro.keys = []; this.flash('キー操作を記録中... (Shift+F1 で終了)'); } this.renderStatus(); }
  macroPlay() {
    if (this.macro.recording || !this.macro.keys.length) { this.flash('記録されたキー操作がありません'); return; }
    this.macro.playing = true;
    for (const k of this.macro.keys) this.onKey({ key: k.key, ctrlKey: k.ctrl, shiftKey: k.shift, altKey: k.alt, preventDefault() {}, isComposing: false });
    this.macro.playing = false; this.render();
  }

  /* ---- イベント ---- */
  _bind() {
    const kb = this.el.kb;
    kb.addEventListener('keydown', (e) => this.onKey(e));
    kb.addEventListener('paste', (e) => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text'); if (t) this.pasteText(t); });
    kb.addEventListener('copy', (e) => { const t = this.selectedText(); if (t) { e.clipboardData.setData('text/plain', t.replace(/\n/g, this.doc.eol)); e.preventDefault(); this.internalClip = t; this.clipHistory.unshift(t); } });
    kb.addEventListener('cut', (e) => { const t = this.selectedText(); if (t) { e.clipboardData.setData('text/plain', t.replace(/\n/g, this.doc.eol)); e.preventDefault(); this.internalClip = t; this.clipHistory.unshift(t); this.deleteSelection(); this.render(); } });
    kb.addEventListener('compositionstart', () => { this.flash('⚠ OSの日本語入力がONです。半角/全角キーでOFFにしてください(内蔵IMEを使います)', 4000); });
    kb.addEventListener('compositionend', () => { kb.value = ''; });
    kb.addEventListener('input', () => { kb.value = ''; });
    kb.addEventListener('blur', () => this.el.editor.classList.add('nofocus'));
    kb.addEventListener('focus', () => this.el.editor.classList.remove('nofocus'));
    const tx = this.el.text;
    let dragging = false, clicks = 0, clickTimer = null;
    tx.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const p = this.posFromPoint(e.clientX, e.clientY); if (!p) return;
      this.rowEnd = false;
      if (Settings.data.wrap) {                          // 折り返し位置ちょうど: 上の表示行の右端をクリックしたのなら、その行末に置く
        const st = this.rows(p.line), k = st.indexOf(p.col), c = this._rowCache && this._rowCache.get(p.line), lcEl = this.el.text.children[p.line];
        if (k > 0 && c && lcEl) this.rowEnd = e.clientY - lcEl.lastChild.getBoundingClientRect().top < c.tops[k];
      }
      this.commitIme();
      clicks++; clearTimeout(clickTimer); clickTimer = setTimeout(() => clicks = 0, 400);
      if (clicks === 2) this.selectWordAt(p.line, p.col);
      else if (clicks >= 3) { this.anchor = { line: p.line, col: 0 }; this.cur = p.line < this.doc.lineCount() - 1 ? { line: p.line + 1, col: 0 } : { line: p.line, col: this.doc.lines[p.line].length }; clicks = 0; }
      else { if (e.shiftKey) { if (!this.anchor) this.anchor = { ...this.cur }; } else this.anchor = { ...p }; this.cur = p; dragging = true; }
      this.prefCol = null; this.render(); e.preventDefault(); this.focus();
    });
    window.addEventListener('mousemove', (e) => { if (!dragging) return; const p = this.posFromPoint(e.clientX, e.clientY); if (p) { this.cur = p; this.render(); } });
    window.addEventListener('mouseup', () => { if (dragging) { dragging = false; if (this.anchor && posEq(this.anchor, this.cur)) this.anchor = null; this.render(); } });
    this.el.editor.addEventListener('scroll', () => { this.syncRuler(); this.positionPopups(); this.syncPreviewScroll(); });
    this.el.outline.addEventListener('click', () => { if (this.isMd()) UI.openHeadings(); });
    this.el.cand.addEventListener('mousedown', (e) => { const li = e.target.closest('li'); if (li) { this.ime.selectCandidate(+li.dataset.i); this.render(); } e.preventDefault(); });
    window.addEventListener('resize', () => { if (Settings.data.wrap) this.render(); this.syncRuler(); this.positionPopups(); });
    document.addEventListener('mousedown', (e) => { if (!e.target.closest('.dialog, #menubar, #cand, #pred, button, input, select, textarea')) setTimeout(() => this.focus(), 0); });
  }
  posFromPoint(x, y) {
    let node, off;
    if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); if (!r) return null; node = r.startContainer; off = r.startOffset; }
    else if (document.caretPositionFromPoint) { const cp = document.caretPositionFromPoint(x, y); if (!cp) return null; node = cp.offsetNode; off = cp.offset; }
    if (!node) return null;
    const elOf = (n) => n.nodeType === 3 ? n.parentElement : n;
    const lc = elOf(node).closest('.lc');
    if (!lc) {
      const lineEl = elOf(node).closest('.line');
      if (lineEl) { const li = +lineEl.dataset.line; return { line: li, col: this.doc.lines[li].length }; }
      const lines = this.el.text.querySelectorAll('.line'); if (!lines.length) return { line: 0, col: 0 };
      const last = lines[lines.length - 1], li = +last.dataset.line; return y > last.getBoundingClientRect().top ? { line: li, col: this.doc.lines[li].length } : null;
    }
    const li = +lc.closest('.line').dataset.line; let col = 0;
    const walker = document.createTreeWalker(lc, NodeFilter.SHOW_TEXT); let t;
    while ((t = walker.nextNode())) { if (t.parentElement.closest('.pre, .eol, .eof')) continue; if (t === node) { col += off; break; } col += t.nodeValue.length; }
    if (node.nodeType !== 3) col = this.doc.lines[li].length;
    return { line: li, col: Math.min(col, this.doc.lines[li].length) };
  }
  commitIme() { const t = this.ime.forceCommit(); if (t) this.insertText(t); this.reconv = null; }
  /** 音声入力の確定文字列を挿入 */
  insertSpeech(t) { this.commitIme(); this.insertText(t); this.render(); }
  /** 選択範囲を内蔵IMEで再変換 (同音語の誤り訂正。音声入力結果の修正に) */
  reconvert() {
    const t = this.selectedText();
    if (!t || t.includes('\n')) return this.flash('再変換する文字列(1行内)を選択してください');
    if (t.length > 40) return this.flash('再変換できるのは 40 文字までです');
    const reading = IMEDICT.readingOf(t);
    if (!reading) return this.flash('読みが分からない文字が含まれているため再変換できません');
    this.deleteSelection();
    this.reconv = { orig: t };
    this.ime.reconvert(reading);
    this.render();
  }

  onKey(e) {
    if (e.isComposing || e.key === 'Process') return;
    const key = e.key, ctrl = e.ctrlKey, shift = e.shiftKey, alt = e.altKey;
    if (this.macro.recording && !this.macro.playing && !(shift && key === 'F1')) this.macro.keys.push({ key, ctrl, shift, alt });
    // ---- 音声入力 ON/OFF (Ctrl+Alt+M) / 選択範囲の再変換 (変換キー, Ctrl+Alt+R)
    if (ctrl && alt && key.toLowerCase() === 'm') { e.preventDefault(); this.cmd('speech'); return; }
    if (!/^(Shift|Control|Alt|Meta)$/.test(key)) { this.rowEndPrev = this.rowEnd; this.rowEnd = false; }
    // ---- キー配列 (Emacs / vi / nano / VZ / VS Code / Atom)。割り当てのないキーは下の標準処理へ
    if (Keymap.handle(this, e)) { e.preventDefault(); return; }
    // ---- 罫線: Alt+矢印 = 細線、Alt+Shift+矢印 = 太線、Alt+Ctrl+矢印 = 消去
    if (alt && /^Arrow(Up|Down|Left|Right)$/.test(key)) { e.preventDefault(); this.commitIme(); Keisen.step(this, key.slice(5).toLowerCase(), ctrl ? 0 : shift ? 2 : 1); this.render(); return; }
    if (!this.ime.active && this.selection() && (key === 'Convert' || (ctrl && alt && key.toLowerCase() === 'r'))) { e.preventDefault(); this.reconvert(); return; }
    // ---- 内蔵IME (エディタ専用の Ctrl キーは IME が待機中なら素通し)
    const editorCtrl = ctrl && /^[zyxcvasofrnbglp1-4]$/i.test(key) && !this.ime.active;
    if (!editorCtrl && key !== 'F1' && key !== 'F2' && !(shift && /^F[1-9]$|^F1[0-2]$/.test(key) && !this.ime.active)) {
      const r = this.ime.handleKey(e);
      if (r.handled) {
        e.preventDefault(); if (r.retract) this.retractChars(r.retract); if (r.commit) this.insertText(r.commit);
        if (this.reconv && (r.commit || !this.ime.active)) { if (!r.commit && !this.ime.active) this.insertText(this.reconv.orig); this.reconv = null; }   // 再変換の取り消し → 元に戻す
        this.render(); return;
      }
    }
    // ---- エディタコマンド (秀丸準拠)
    let handled = true;
    if (ctrl && !alt) {
      switch (key.toLowerCase()) {
        case 'z': this.cmd('undo'); break;
        case 'y': this.cmd('redo'); break;
        case 'a': this.cmd('selectAll'); break;
        case 'c': case 'x': case 'v':
          if (this.macro.playing) { if (key.toLowerCase() === 'v') this.insertText(this.internalClip); else this.copySel(key.toLowerCase() === 'x', false); } else handled = false; break;
        case 'f': UI.openFind(false); break;
        case 'r': UI.openFind(true); break;
        case 'g': case 'j': UI.openGoto(); break;
        case 's': this.saveFile(false); break;
        case 'o': this.openFile(false); break;
        case 'n': this.newFile(); break;
        case 'p': this.print(); break;
        case 'l': this.cmd('lastEdit'); break;
        case 'b': if (this.selMode) this.clearSelection(); else { this.selMode = true; this.anchor = { ...this.cur }; } break;
        case 'home': this.startSelIfShift(e); this.pushPos(); this.cur = { line: 0, col: 0 }; break;
        case 'end': this.startSelIfShift(e); this.pushPos(); this.cur = this.docEnd(); break;
        case 'arrowleft': this.moveWord(-1, e); break;
        case 'arrowright': this.moveWord(1, e); break;
        case 'arrowup': this.el.editor.scrollTop -= this.lineHeight(); return;
        case 'arrowdown': this.el.editor.scrollTop += this.lineHeight(); return;
        case 'f7': UI.openWordReg(); break;
        case 'u': case 'i': case 'k': case 'h': case 'd': case 'e': case 'w': case 't': break;
        default: handled = false;
      }
    } else if (!alt) {
      switch (key) {
        case 'ArrowLeft': this.moveHoriz(-1, e); break;
        case 'ArrowRight': this.moveHoriz(1, e); break;
        case 'ArrowUp': this.moveVert(-1, e); break;
        case 'ArrowDown': this.moveVert(1, e); break;
        case 'PageUp': this.moveVert(-this.pageLines(), e); break;
        case 'PageDown': this.moveVert(this.pageLines(), e); break;
        case 'Home': this.rowEdge(-1, e); break;
        case 'End': this.rowEdge(1, e); break;
        case 'Enter': { let ins = '\n'; if (Settings.data.autoIndent) ins += this.doc.lines[this.cur.line].substring(0, this.cur.col).match(/^[ \t　]*/)[0]; this.insertText(ins); break; }
        case 'Tab': { if (shift) { this.unindent(); break; } const sel = this.selection(); if (sel && sel.a.line !== sel.b.line) { this.indent(); break; } this.insertText(Settings.data.tabSpaces ? ' '.repeat(Settings.data.tabWidth - (this.colWidth(this.cur.line, this.cur.col) % Settings.data.tabWidth)) : '\t', true); break; }
        case 'Backspace': if (!this.deleteSelection()) { if (this.cur.col > 0) { const a = { line: this.cur.line, col: this.cur.col - (/[\uDC00-\uDFFF]/.test(this.doc.lines[this.cur.line][this.cur.col - 1]) ? 2 : 1) }; this.doc.replaceRange(a, this.cur, ''); this.cur = a; } else if (this.cur.line > 0) { const a = { line: this.cur.line - 1, col: this.doc.lines[this.cur.line - 1].length }; this.doc.replaceRange(a, this.cur, ''); this.cur = a; } } this.prefCol = null; break;
        case 'Delete': if (!this.deleteSelection()) { const s = this.doc.lines[this.cur.line]; if (this.cur.col < s.length) this.doc.replaceRange(this.cur, { line: this.cur.line, col: this.cur.col + (/[\uD800-\uDBFF]/.test(s[this.cur.col]) ? 2 : 1) }, ''); else if (this.cur.line < this.doc.lineCount() - 1) this.doc.replaceRange(this.cur, { line: this.cur.line + 1, col: 0 }, ''); } break;
        case 'Insert': this.overwrite = !this.overwrite; break;
        case 'Escape': this.clearSelection(); UI.closeDialogs(); Menu.close(); break;
        case 'F1': if (shift) this.macroToggle(); else UI.openHelp(); break;
        case 'F2': if (shift) this.macroPlay(); else handled = false; break;
        case 'F3': this.findNext(shift ? -1 : 1); break;
        case 'F7': if (shift) this.copySel(true, true); break;
        case 'F8': if (shift) this.copySel(false, true); break;
        case 'F11': if (!shift) { this.cmd('fullscreen'); break; } handled = false; break;
        case 'F5': case 'F6': case 'F9': case 'F10': case 'F12': if (!shift) break; handled = false; break;
        default: if (key.length === 1 && !ctrl) this.insertText(key, true); else handled = false;
      }
    } else handled = false;
    if (handled) { e.preventDefault(); this.clampCur(); this.render(); }
  }
  lineHeight() { return this.rowH(); }
  pageLines() { return Math.max(1, Math.floor(this.el.editor.clientHeight / this.lineHeight()) - 1); }

  /* ---- メニューコマンド ---- */
  cmd(c, arg) {
    const d = Settings.data, tw = d.tabWidth;
    switch (c) {
      case 'new': this.newFile(); return;
      case 'open': this.openFile(false); return;
      case 'insertFile': this.openFile(true); return;
      case 'save': this.saveFile(false); return;
      case 'saveAs': this.saveFile(true); return;
      case 'print': this.print(); return;
      case 'reloadAuto': if (this.srcBytes) this.reloadWith(null); break;
      case 'enc': this.reloadWith(arg); break;
      case 'eol': this.doc.eol = arg; this.doc.dirty = true; break;
      case 'bom': this.bom = !this.bom; this.doc.dirty = true; break;
      case 'saveExit': this.exitApp(true); return;
      case 'exit': this.exitApp(false); return;
      case 'undo': { const p = this.doc.doUndo(); if (p) { this.cur = p; this.clearSelection(); } break; }
      case 'redo': { const p = this.doc.doRedo(); if (p) { this.cur = p; this.clearSelection(); } break; }
      case 'cut': this.copySel(true, false); break;
      case 'copy': this.copySel(false, false); break;
      case 'cutAppend': this.copySel(true, true); break;
      case 'copyAppend': this.copySel(false, true); break;
      case 'paste': navigator.clipboard.readText().then(t => this.pasteText(t)).catch(() => { if (this.internalClip) this.pasteText(this.internalClip); else this.flash('Ctrl+V で貼り付けてください'); }); return;
      case 'delete': if (!this.deleteSelection()) this.onKey({ key: 'Delete', preventDefault() {} }); break;
      case 'selectAll': this.anchor = { line: 0, col: 0 }; this.cur = this.docEnd(); break;
      case 'clipHist': UI.openClipHist(); return;
      case 'reload': if (this.srcBytes) this.reloadWith(this.encoding); else this.flash('読み込み元のファイルがありません'); break;
      // 変換
      case 'upper': this.transform(t => t.toUpperCase(), false); break;
      case 'lower': this.transform(t => t.toLowerCase(), false); break;
      case 'hankaku': this.transform(t => Xform.hanKata(Xform.hanPunct(Xform.hanAscii(t))), false); break;
      case 'hira': this.transform(Xform.hira, false); break;
      case 'kata': this.transform(Xform.kata, false); break;
      case 'tab2sp': this.transformLines(t => Xform.tabToSpace(t, tw)); break;
      case 'sp2tab': this.transformLines(t => Xform.spaceToTab(t, tw)); break;
      case 'asciiHan': this.transform(Xform.hanAscii, false); break;
      case 'asciiZen': this.transform(Xform.zenAscii, false); break;
      case 'kataHan': this.transform(Xform.hanKata, false); break;
      case 'kataZen': this.transform(Xform.zenKata, false); break;
      case 'indent': this.indent(); break;
      case 'unindent': this.unindent(); break;
      case 'sort': UI.openSort(); return;
      case 'caseDlg': UI.openCase(); return;
      case 'widthDlg': UI.openWidth(); return;
      case 'jsonExpand': this.transform(t => { try { return JSON.stringify(JSON.parse(t), null, 2); } catch (e) { this.flash('JSONとして解釈できません: ' + e.message, 4000); return t; } }); break;
      case 'jsonShrink': this.transform(t => { try { return JSON.stringify(JSON.parse(t)); } catch (e) { this.flash('JSONとして解釈できません: ' + e.message, 4000); return t; } }); break;
      case 'dedupe': this.transformLines(Xform.dedupeAdjacent); break;
      // 整形
      case 'trimRight': this.transformLines(Xform.trimRight); break;
      case 'removeBlank': this.transformLines(Xform.removeBlank); break;
      case 'squeezeBlank': this.transformLines(Xform.squeezeBlank); break;
      case 'joinLines': this.transformLines(Xform.joinLines); break;
      case 'reflow': { const n = parseInt(prompt('折り返し桁数(半角換算)', d.wrapCol), 10); if (n > 0) { d.wrapCol = n; Settings.save(); this.transformLines(t => Xform.reflow(t, n)); } break; }
      // 表示
      case 'wrap': d.wrap = !d.wrap; Settings.save(); this.applySettings(); break;
      case 'ruler': d.ruler = !d.ruler; Settings.save(); this.applySettings(); break;
      case 'lineNumbers': d.lineNumbers = !d.lineNumbers; Settings.save(); this.applySettings(); break;
      case 'marks': d.showMarks = !d.showMarks; Settings.save(); this.applySettings(); break;
      case 'curLine': d.curLine = !d.curLine; Settings.save(); this.applySettings(); break;
      case 'statusBar': d.statusBar = !d.statusBar; Settings.save(); this.applySettings(); break;
      case 'theme': d.theme = arg; Settings.save(); this.applySettings(); break;
      case 'fontUp': d.fontSize = Math.min(40, d.fontSize + 1); Settings.save(); this.applySettings(); break;
      case 'fontDown': d.fontSize = Math.max(8, d.fontSize - 1); Settings.save(); this.applySettings(); break;
      // 検索
      case 'find': UI.openFind(false); return;
      case 'findNext': this.findNext(1); break;
      case 'findPrev': this.findNext(-1); break;
      case 'replace': UI.openFind(true); return;
      case 'hl': this.find.hl = !this.find.hl; this.rendered = []; break;
      case 'findStart': if (this.find.startPos) { this.jumpTo(this.find.startPos); this.find.startPos = null; } break;
      case 'goto': UI.openGoto(); return;
      case 'top': this.jumpTo({ line: 0, col: 0 }); break;
      case 'bottom': this.jumpTo(this.docEnd()); break;
      case 'lastEdit': if (this.lastEditPos) this.jumpTo(this.lastEditPos); else this.flash('編集した所がありません'); break;
      case 'editMarkDown': case 'editMarkUp': { const ms = [...this.editMarks].filter(l => l < this.doc.lineCount()).sort((a, b) => a - b); const l = c === 'editMarkDown' ? ms.find(x => x > this.cur.line) : [...ms].reverse().find(x => x < this.cur.line); if (l !== undefined) this.jumpTo({ line: l, col: 0 }); else this.flash('編集マークはありません'); break; }
      case 'prevPos': { const p = this.posHistory.pop(); if (p) { this.cur = p; this.clampCur(); this.clearSelection(); } else this.flash('前のカーソル位置がありません'); break; }
      case 'bookmark': if (this.bookmarks.has(this.cur.line)) this.bookmarks.delete(this.cur.line); else this.bookmarks.add(this.cur.line); this.rendered = []; break;
      case 'bookmarkNext': case 'bookmarkPrev': { const ms = [...this.bookmarks].sort((a, b) => a - b); const l = c === 'bookmarkNext' ? ms.find(x => x > this.cur.line) : [...ms].reverse().find(x => x < this.cur.line); if (l !== undefined) this.jumpTo({ line: l, col: 0 }); else this.flash('マークはありません'); break; }
      case 'bookmarkList': UI.openMarks(); return;
      // ウィンドウ
      // マクロ
      case 'macroRec': this.macroToggle(); break;
      case 'macroPlay': this.macroPlay(); break;
      case 'macroSave': { const b = new Blob([JSON.stringify(this.macro.keys)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'keymacro.json'; a.click(); break; }
      case 'macroLoad': { const inp = $('#fileInput'); inp.onchange = async () => { const f = inp.files[0]; if (f) { try { this.macro.keys = JSON.parse(await f.text()); this.flash(`キー操作を読み込みました (${this.macro.keys.length} キー)`); } catch (e) { this.flash('読み込めませんでした'); } } inp.value = ''; }; inp.click(); return; }
      // その他
      case 'settings': UI.openSettings('env', arg); return;
      case 'filetype': UI.openSettings('ft', arg); return;
      case 'keisenToggle': this.keisenMode = !this.keisenMode; this.flash(this.keisenMode ? '罫線モード: 矢印で細線、Shift+矢印で太線、Ctrl+矢印で消去、Esc で終了' : '罫線モードを終了しました', 5000); this.render(); return;
      case 'fullscreen':
        if (document.fullscreenElement) { document.exitFullscreen(); return; }
        document.documentElement.requestFullscreen().then(() => { if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock().catch(() => {}); this.flash('全画面表示: F11 で戻ります', 4000); this.focus(); }).catch(() => this.flash('全画面表示にできませんでした'));
        return;
      case 'keisenHelp': this.flash('罫線: Alt+矢印で細線、Alt+Shift+矢印で太線、Alt+Ctrl+矢印で消去'); return;
      case 'keisenMode': Settings.data.keisenHalf = !!arg; Settings.save(); this.flash(arg ? '半角罫線 (+-|) で描きます' : '全角罫線で描きます'); return;
      case 'keisenRow': if (!Keisen.insertRow(this)) this.flash('表の行(縦の罫線がある行)にカーソルを置いてください'); this.render(); return;
      case 'speech': if (typeof Speech !== 'undefined') Speech.toggle(this).then(() => this.renderStatus()); return;
      case 'reconvert': this.reconvert(); return;
      case 'help': UI.openHelp(); return;
      case 'wordreg': UI.openWordReg(); return;
      case 'userdict': UI.renderUserDict(); UI.open('#dlgUserDict'); return;
      case 'dicts': UI.openDicts(); return;
      case 'learnClear': if (confirm('学習データを消去しますか?')) { this.ime.learner.clear(); this.flash('学習データを消去しました'); } break;
      case 'imetoggle': this.commitIme(); this.ime.on = !this.ime.on; break;
      case 'about': UI.open('#dlgAbout'); $('#aboutOk').focus(); return;
      // Markdown
      case 'mdMode': this.mdManual = arg === 'auto' ? null : arg === 'on'; this.rendered = []; this.applySettings(); break;
      case 'mdPreview': d.mdPreview = !d.mdPreview; Settings.save(); this.applySettings(); break;
      case 'mdExport': this.exportHtml(); break;
      case 'mdBold': this.mdWrap('**', '**'); break;
      case 'mdItalic': this.mdWrap('*', '*'); break;
      case 'mdStrike': this.mdWrap('~~', '~~'); break;
      case 'mdCode': this.mdWrap('`', '`'); break;
      case 'mdLink': { const t = this.selectedText(); const sel = this.selection(); const url = prompt('リンク先URL', 'https://'); if (url === null) return; if (sel && sel.a.line === sel.b.line) { this.cur = this.doc.replaceRange(sel.a, sel.b, `[${t}](${url})`); this.clearSelection(); } else { const end = this.doc.replaceRange(this.cur, this.cur, `[](${url})`); this.cur = { line: end.line, col: this.cur.col + 1 }; } break; }
      case 'mdCodeBlock': { const sel = this.selection(); if (sel) { const t = this.selectedText(); const end = this.doc.replaceRange(sel.a, sel.b, '```\n' + t + '\n```'); this.cur = end; this.clearSelection(); } else { const end = this.doc.replaceRange(this.cur, this.cur, '```\n\n```'); this.cur = { line: end.line - 1, col: 0 }; } break; }
      case 'mdH1': case 'mdH2': case 'mdH3': this.transformLines(t => t.split('\n').map(l => '#'.repeat(+c.slice(-1)) + ' ' + l.replace(/^#{1,6}\s+/, '')).join('\n')); break;
      case 'mdHUp': this.mdHeading(1); break;
      case 'mdHDown': this.mdHeading(-1); break;
      case 'mdUl': this.mdList('ul'); break;
      case 'mdOl': this.mdList('ol'); break;
      case 'mdTask': this.mdList('task'); break;
      case 'mdCheck': this.mdToggleCheck(); break;
      case 'mdTable': this.mdFormatTable(); break;
      case 'mdQuote': this.transformLines(t => t.split('\n').map(l => l.startsWith('> ') ? l.slice(2) : '> ' + l).join('\n')); break;
      case 'mdHr': this.insertText('\n---\n'); break;
      case 'headings': UI.openHeadings(); return;
      case 'none': this.flash('この機能は未実装です'); break;
    }
    this.clampCur(); this.render(); this.focus();
  }

  /* ---- 描画 ---- */
  renderLineHtml(i, text, sel, preedit, hlRe) {
    let out = '';
    const cur = (i === this.cur.line), marks = Settings.data.showMarks;
    const push = (s, cls) => { if (!s) return; let h = esc(s); if (marks) h = h.replace(/　/g, '<span class="zs">　</span>').replace(/\t/g, '<span class="tab">\t</span>'); out += cls ? `<span class="${cls}">${h}</span>` : h; };
    // 装飾範囲: 選択・強調
    const bounds = new Set([0, text.length]);
    let selR = null;
    if (sel) { const a = sel.a.line < i ? 0 : sel.a.col, b = sel.b.line > i ? text.length : sel.b.col; if (a <= b) { selR = [a, b]; bounds.add(a); bounds.add(b); } }
    const hls = hlRe ? this._lineMatches(hlRe, text).map(m => [m.i, m.i + m.len]) : [];
    for (const h of hls) { bounds.add(h[0]); bounds.add(h[1]); }
    const mds = this._fence ? MD.lineTokens(text, this._fence[i]) : [];
    for (const m of mds) { bounds.add(m[0]); bounds.add(m[1]); }
    const caretPos = cur ? this.cur.col : -1;
    if (caretPos >= 0) bounds.add(caretPos);
    // 折り返し位置ちょうどにカーソルがあるとき、前の表示行の行末(End の後)か次の表示行の先頭かを、隣の文字と離れないようにして決める
    let glue = null;
    if (cur && Settings.data.wrap && caretPos > 0 && caretPos < text.length && !(preedit && preedit.parts.length)) {
      glue = this.rowEnd ? [caretPos - (/[\uDC00-\uDFFF]/.test(text[caretPos - 1]) && caretPos > 1 ? 2 : 1), caretPos] : [caretPos, caretPos + (/[\uD800-\uDBFF]/.test(text[caretPos]) ? 2 : 1)];
      bounds.add(glue[0]); bounds.add(Math.min(glue[1], text.length));
    }
    const pts = [...bounds].sort((x, y) => x - y);
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      const g = glue && a === glue[0];
      if (g) out += '<span class="nb">';
      if (a === caretPos && !(glue && glue.done)) out += this._caretHtml(preedit);
      const cls = [];
      if (selR && a >= selR[0] && b <= selR[1]) cls.push('sel');
      if (hls.some(h => a >= h[0] && b <= h[1])) cls.push('hl');
      for (const m of mds) if (a >= m[0] && b <= m[1]) cls.push(m[2]);
      push(text.substring(a, b), cls.join(' '));
      if (g) { if (b === caretPos) { out += this._caretHtml(preedit); glue.done = true; } out += '</span>'; }
    }
    if (caretPos === text.length) out += this._caretHtml(preedit);
    if (marks) out += (i === this.doc.lineCount() - 1) ? '<span class="eof">[EOF]</span>' : '<span class="eol">↓</span>';
    return out;
  }
  _caretHtml(preedit) {
    if (preedit && preedit.parts.length) {
      let out = '';
      for (const part of preedit.parts) {
        const cls = 'pre pre-' + part.kind;
        if (part.kind === 'raw' && preedit.caret >= 0) out += `<span class="${cls}">${esc(part.text.substring(0, preedit.caret))}<span class="caret"></span>${esc(part.text.substring(preedit.caret))}</span>`;
        else if (part.kind === 'speech') out += `<span class="${cls}">${esc(part.text)}</span><span class="caret"></span>`;
        else out += `<span class="${cls}">${esc(part.text)}</span>`;
      }
      return out;
    }
    return '<span class="caret"></span>';
  }
  render() {
    const doc = this.doc, n = doc.lineCount(), sel = this.selection();
    const preedit = this.ime.active ? this.ime.display() : (typeof Speech !== 'undefined' && Speech.interim ? { parts: [{ text: Speech.interim, kind: 'speech' }], caret: -1, text: Speech.interim } : null);
    const wrapNum = !!Settings.data.wrap; if (this._wrapNum !== wrapNum) { this._wrapNum = wrapNum; this.rendered = []; this._lnw = null; }
    const tx = this.el.text, showLn = Settings.data.lineNumbers, lnw = wrapNum ? String(Math.max(n, this._rowTotal || 0)).length : String(n).length;
    const hlRe = this.find.hl ? this.buildRegex() : null;
    const md = this.isMd();
    if (md) { const fm = MD.fenceMap(doc.lines); if (!this._fence || this._fence.length !== fm.length || fm.some((v, k) => v !== this._fence[k])) { this._fence = fm; this.rendered = []; } }
    else if (this._fence) { this._fence = null; this.rendered = []; }
    if (this._wasMd !== md) { this._wasMd = md; this.rendered = []; this.el.preview.style.display = (Settings.data.mdPreview && md) ? '' : 'none'; }
    if (this._lnw !== lnw) { this._lnw = lnw; document.documentElement.style.setProperty('--lnw', (lnw + 1) + 'ch'); this._lnwChanged = true; }
    const lineHtml = (i) => { const inSel = sel && i >= sel.a.line && i <= sel.b.line; return this.renderLineHtml(i, doc.lines[i], inSel ? sel : null, preedit, hlRe); };
    const lnText = (i) => (showLn && !wrapNum ? String(i + 1).padStart(lnw, ' ') : '');
    if (this.rendered.length === 0 || tx.children.length !== n) {
      const parts = new Array(n);
      for (let i = 0; i < n; i++) { const html = lineHtml(i); this.rendered[i] = html; parts[i] = `<div class="line${i === this.cur.line ? ' cur' : ''}${this.bookmarks.has(i) ? ' bm' : ''}" data-line="${i}"><span class="ln">${lnText(i)}</span><span class="lc">${html}</span></div>`; }
      tx.innerHTML = parts.join(''); this.rendered.length = n; this.lnFrom = Infinity;
    } else {
      const need = new Set(this.dirtyLines); need.add(this.prevCur.line); need.add(this.cur.line);
      const addRange = (r) => { if (!r) return; for (let i = r.a.line; i <= Math.min(r.b.line, r.a.line + 5000); i++) need.add(i); };
      addRange(this.prevSel); addRange(sel);
      for (let i = 0; i < n; i++) {
        if (this.rendered[i] !== undefined && !need.has(i)) continue;
        const html = lineHtml(i), el = tx.children[i];
        if (this.rendered[i] !== html) { this.rendered[i] = html; el.lastChild.innerHTML = html; }
        el.classList.toggle('cur', i === this.cur.line); el.classList.toggle('bm', this.bookmarks.has(i));
      }
      if (this.lnFrom < n || this._lnwChanged) { const f = this._lnwChanged ? 0 : this.lnFrom; for (let i = f; i < n; i++) { const el = tx.children[i]; el.dataset.line = i; if (!wrapNum) el.firstChild.textContent = lnText(i); el.classList.toggle('bm', this.bookmarks.has(i)); } this.lnFrom = Infinity; this._lnwChanged = false; }
      if (tx.children[this.prevCur.line]) tx.children[this.prevCur.line].classList.toggle('cur', this.prevCur.line === this.cur.line);
      if (tx.children[this.cur.line]) tx.children[this.cur.line].classList.add('cur');
    }
    this.dirtyFrom = Infinity; this.dirtyLines.clear();
    this.prevCur = { ...this.cur }; this.prevSel = sel ? { a: { ...sel.a }, b: { ...sel.b } } : null;
    if (wrapNum) this.updateRowNumbers();
    this.scrollToCursor(); this.syncRuler(); this.renderStatus(); this.renderPopups(); this.renderOutline(); this.schedulePreview();
  }
  /** ルーラー(目盛り)を描く。秀丸と同じく桁の境界に目盛り線を引き、10 桁ごとに数字を添える。
   *  0 の目盛り = 本文 1 文字目の左端。行番号の桁数・表示有無・横スクロール・フォントサイズに追従する。 */
  syncRuler() {
    const r = this.el.ruler, lc = this.el.text.querySelector('.lc');
    if (!lc || r.style.display === 'none') return;
    let cv = r.firstElementChild;
    if (!cv || cv.tagName !== 'CANVAS') { r.textContent = ''; cv = document.createElement('canvas'); r.appendChild(cv); }
    const rr = r.getBoundingClientRect(), W = Math.max(1, Math.round(rr.width)), H = Math.max(1, Math.round(rr.height));
    const x0 = lc.getBoundingClientRect().left - rr.left;
    // 半角1文字の幅
    const fkey = getComputedStyle(this.el.text).font;
    if (this._chwKey !== fkey) { const m = document.createElement('span'); m.style.cssText = 'position:absolute;visibility:hidden;white-space:pre'; m.textContent = '0'.repeat(100); this.el.text.appendChild(m); this._chw = m.getBoundingClientRect().width / 100; m.remove(); this._chwKey = fkey; }
    const chw = this._chw || 8;
    const caretEl = this.el.text.querySelector('.caret'), cx = caretEl ? caretEl.getBoundingClientRect().left - rr.left : null;
    const cs = getComputedStyle(r), key = [W, H, x0.toFixed(2), chw.toFixed(3), cs.color, cs.backgroundColor, cx == null ? '' : cx.toFixed(1), window.devicePixelRatio].join('|');
    if (key === this._rulerKey) return;
    this._rulerKey = key;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    g.fillStyle = cs.color; g.font = `${Math.min(11, H - 5)}px "Segoe UI", Arial, sans-serif`; g.textBaseline = 'top';
    if (cx != null && cx >= x0 - 1 && cx < W) { g.globalAlpha = 0.35; g.fillRect(Math.round(cx), 0, Math.max(2, Math.round(chw)), H); g.globalAlpha = 1; }   // カーソル桁
    const first = Math.max(0, Math.floor(-x0 / chw)), last = Math.ceil((W - x0) / chw);
    for (let c = first; c <= last; c++) {
      const x = Math.round(x0 + c * chw);
      if (x < x0 - 0.5) continue;
      const h = c % 10 === 0 ? H : (c % 5 === 0 ? Math.round(H * 0.5) : Math.round(H * 0.25));
      g.fillRect(x, H - h, 1, h);
      if (c % 10 === 0) g.fillText(String(c), x + 3, 0);
    }
  }
  renderOutline() {
    const h = this.currentHeading();
    this.el.outline.textContent = h ? `${'#'.repeat(h.level)} ${h.text}` : (this.isMd() ? '（見出し無し）' : '（見出し無し）');
    this.el.outline.classList.toggle('has', !!h);
  }
  schedulePreview() {
    if (!(Settings.data.mdPreview && this.isMd())) return;
    const key = this.doc.lines.length + ':' + (this.doc.undo.length) + ':' + (this.doc.redo.length) + ':' + (this.doc.dirty ? 1 : 0);
    if (this._previewKey === key && !this._previewDirty) return;
    this._previewKey = key; this._previewDirty = false;
    clearTimeout(this._pvT);
    this._pvT = setTimeout(() => { this.el.preview.innerHTML = `<div class="md">${MD.render(this.doc.getText())}</div>`; this.syncPreviewScroll(); }, 120);
  }
  syncPreviewScroll() {
    const ed = this.el.editor, pv = this.el.preview; if (pv.style.display === 'none') return;
    const ratio = ed.scrollTop / Math.max(1, ed.scrollHeight - ed.clientHeight); pv.scrollTop = ratio * Math.max(0, pv.scrollHeight - pv.clientHeight);
  }
  scrollToCursor() {
    const c = this.el.text.querySelector('.caret') || this.el.text.querySelector('.pre-focus') || this.el.text.querySelector('.line.cur');
    if (!c) return;
    const ed = this.el.editor, r = c.getBoundingClientRect(), er = ed.getBoundingClientRect();
    if (r.top < er.top) ed.scrollTop -= (er.top - r.top) + 4; else if (r.bottom > er.bottom) ed.scrollTop += (r.bottom - er.bottom) + 4;
    if (!Settings.data.wrap) { if (r.left < er.left + 60) ed.scrollLeft -= (er.left + 60 - r.left); else if (r.right > er.right - 20) ed.scrollLeft += (r.right - er.right) + 40; }
  }
  renderStatus() {
    Keymap.status(this);
    const d = this.doc, col = this.colWidth(this.cur.line, this.cur.col) + 1;
    const chars = d.lines.reduce((a, l) => a + l.length, 0) + d.lineCount() - 1, sel = this.selection();
    let ln = this.cur.line + 1, cl = col;
    if (Settings.data.wrap && this._rowBase && this._rowBase.length === d.lineCount() + 1) { const st = this.rows(this.cur.line), r = this.rowOf(st, this.cur.col, this.rowEnd); ln = this._rowBase[this.cur.line] + r + 1; cl = col - this.colWidth(this.cur.line, st[r]); }
    $('#mb-pos').textContent = `${ln}: ${cl}`;
    $('#st-pos').textContent = `${ln} 行 ${cl} 桁`;
    $('#st-info').textContent = `${d.lineCount()} 行 / ${chars} 文字` + (sel ? ` / 選択 ${this.selectedText().length} 文字` : '') + (this.selMode ? ' [範囲選択]' : '') + (this.macro.recording ? ' ●記録中' : '');
    $('#st-mode').textContent = (this.overwrite ? '上書' : '挿入') + (this.isMd() ? ' / Markdown' : '');
    $('#st-eol').textContent = d.eol === '\r\n' ? 'CR+LF' : d.eol === '\r' ? 'CR' : 'LF';
    $('#st-enc').textContent = Enc.short[this.encoding] + (this.bom ? '(BOM)' : '');
    const im = $('#st-ime'); im.textContent = this.ime.on ? this.ime.modeLabel() : 'IME OFF'; im.classList.toggle('off', !this.ime.on);
    const mic = $('#st-mic'); if (mic && typeof Speech !== 'undefined') { mic.textContent = Speech.on ? ('🎤 ' + (Speech.statusText || '音声入力')) : '🎤'; mic.classList.toggle('on', Speech.on); mic.classList.toggle('sound', Speech.on && Speech.soundOn); mic.title = Speech.on ? '音声入力 ON (クリックで OFF, Ctrl+Alt+M)' : '音声入力 (クリックで ON, Ctrl+Alt+M)'; }
    document.title = I18N.t(`${this.fileName}${d.dirty ? '(更新)' : ''} - IME Editor`);
    $('#mb-title').textContent = `${this.fileName}${d.dirty ? '(更新)' : ''}`;
  }
  renderRuler() { this._rulerKey = null; this.syncRuler(); }
  renderPopups() {
    const cand = this.el.cand, pred = this.el.pred, c = this.ime.candidates();
    if (c) { cand.innerHTML = '<ol>' + c.list.map((x, i) => `<li data-i="${c.page * this.ime.opts.candPerPage + i}" class="${i === c.index ? 'on' : ''}"><span class="n">${i + 1}</span><span class="w">${esc(x.s)}</span>${x.cm ? `<span class="cm">${esc(x.cm)}</span>` : ''}</li>`).join('') + `</ol><div class="pg">${c.page * this.ime.opts.candPerPage + c.index + 1}/${c.total}</div>`; cand.style.display = 'block'; }
    else cand.style.display = 'none';
    const p = this.ime.predictions();
    if (p && this.ime.state === 'input') { pred.innerHTML = '<ol>' + p.list.map((x, i) => `<li class="${i === p.index ? 'on' : ''}">${esc(x.s)}${x.learned ? '<span class="lrn">学</span>' : ''}</li>`).join('') + '</ol><div class="hint">Tab:選択 Shift+Enter:確定</div>'; pred.style.display = 'block'; }
    else pred.style.display = 'none';
    this.positionPopups();
  }
  positionPopups() {
    const anchorEl = this.el.text.querySelector('.pre-focus') || this.el.text.querySelector('.pre') || this.el.text.querySelector('.caret');
    if (!anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    for (const el of [this.el.cand, this.el.pred]) {
      if (el.style.display === 'none') continue;
      let x = r.left, y = r.bottom + 2; const w = el.offsetWidth, h = el.offsetHeight;
      if (x + w > window.innerWidth - 8) x = Math.max(4, window.innerWidth - w - 8);
      if (y + h > window.innerHeight - 24) y = r.top - h - 2;
      el.style.left = x + 'px'; el.style.top = y + 'px';
    }
  }
  flash(msg, ms = 2500) { const m = $('#st-msg'); m.textContent = msg; clearTimeout(this._ft); this._ft = setTimeout(() => { m.textContent = ''; }, ms); }
}

/* ---------------------------------------------------------------- メニューバー (秀丸準拠) */
const Menu = {
  ed: null, openIdx: -1,
  def() {
    const ed = this.ed, d = Settings.data;
    return [
      { label: 'ファイル(F)', items: [
        { label: '新規作成(N)', key: 'Ctrl+N', cmd: 'new' }, { label: '開く(O)...', key: 'Ctrl+O', cmd: 'open' }, { label: '閉じて開く(L)...', cmd: 'open' },
        { label: '上書き保存(S)', key: 'Ctrl+S', cmd: 'save' }, { label: '名前を付けて保存(A)...', cmd: 'saveAs' }, { label: 'カーソル位置への読込み(I)...', cmd: 'insertFile' }, { label: '印刷(P)...', key: 'Ctrl+P', cmd: 'print' }, { label: 'HTMLとして書き出し(H)...  [Markdown]', cmd: 'mdExport', disabled: !ed.isMd() },
        { sep: true },
        { label: 'エンコードの種類(D)', sub: [
          { label: '自動判定で読み込みしなおし(A)', cmd: 'reloadAuto', disabled: !ed.srcBytes }, { sep: true },
          ...['sjis', 'euc', 'jis', 'utf16le', 'utf16be', 'utf8'].map(e => ({ label: Enc.labels[e], check: ed.encoding === e, cmd: 'enc', arg: e })),
          { sep: true },
          { label: '改行=CR+LF', check: ed.doc.eol === '\r\n', cmd: 'eol', arg: '\r\n' }, { label: '改行=CR', check: ed.doc.eol === '\r', cmd: 'eol', arg: '\r' }, { label: '改行=LF', check: ed.doc.eol === '\n', cmd: 'eol', arg: '\n' }, { sep: true },
          { label: 'BOM', check: ed.bom, cmd: 'bom', disabled: !/^utf/.test(ed.encoding) } ] },
        { sep: true },
        { label: '保存して終了(E)', cmd: 'saveExit' }, { label: '終了(X)', cmd: 'exit' } ] },
      { label: '編集(E)', items: [
        { label: 'やり直し(U)', key: 'Ctrl+Z', cmd: 'undo', disabled: !ed.doc.undo.length }, { label: 'やり直しのやり直し(R)', key: 'Ctrl+Y', cmd: 'redo', disabled: !ed.doc.redo.length }, { sep: true },
        { label: '切り抜き(T)', key: 'Ctrl+X', cmd: 'cut' }, { label: 'コピー(C)', key: 'Ctrl+C', cmd: 'copy' }, { label: '追加切り抜き(W)', key: 'Shift+F7', cmd: 'cutAppend' }, { label: '追加コピー(A)', key: 'Shift+F8', cmd: 'copyAppend' },
        { label: '貼り付け(P)', key: 'Ctrl+V', cmd: 'paste' }, { label: '削除(L)', key: 'Del', cmd: 'delete' },
        { label: '変換(V)', sub: [
          { label: 'UPPER CASE(U)', cmd: 'upper' }, { label: 'lower case(L)', cmd: 'lower' }, { label: 'ﾊﾝｶｸ(H)', cmd: 'hankaku' }, { label: '全角ひらがな(Z)', cmd: 'hira' }, { label: '全角カタカナ(K)', cmd: 'kata' },
          { label: 'TAB -> 空白(S)', cmd: 'tab2sp' }, { label: '空白 -> TAB(T)', cmd: 'sp2tab' }, { label: '英数字/記号/空白のみ半角に(A)', cmd: 'asciiHan' }, { label: '英数字/記号/空白のみ全角に(B)', cmd: 'asciiZen' },
          { label: 'カタカナのみ半角に(O)', cmd: 'kataHan' }, { label: 'カタカナのみ全角に(Y)', cmd: 'kataZen' }, { label: 'インデント(I)', cmd: 'indent' }, { label: '逆インデント(N)', cmd: 'unindent' },
          { label: 'ソート(R)...', cmd: 'sort' }, { label: '大文字/小文字の変換(C)...', cmd: 'caseDlg' }, { label: '半角/全角変換(E)...', cmd: 'widthDlg' }, { label: 'JSON展開(J)', cmd: 'jsonExpand' }, { label: 'JSON短縮(M)', cmd: 'jsonShrink' }, { label: '重複行削除（隣接行のみ）(Q)', cmd: 'dedupe' } ] },
        { label: '整形(-)', sub: [
          { label: '行末の空白を削除', cmd: 'trimRight' }, { label: '空行を削除', cmd: 'removeBlank' }, { label: '連続する空行を1つに', cmd: 'squeezeBlank' }, { label: '行の連結', cmd: 'joinLines' }, { label: '指定桁で折り返し(整形)...', cmd: 'reflow' } ] },
        { label: 'Markdown(K)', sub: [
          { label: '太字  **  (B)', cmd: 'mdBold' }, { label: '斜体  *  (I)', cmd: 'mdItalic' }, { label: '取り消し線  ~~  (S)', cmd: 'mdStrike' }, { label: 'インラインコード  `  (C)', cmd: 'mdCode' }, { label: 'コードブロック  ```  (F)', cmd: 'mdCodeBlock' }, { label: 'リンク  [](url)  (L)...', cmd: 'mdLink' }, { sep: true },
          { label: '見出し1  #', cmd: 'mdH1' }, { label: '見出し2  ##', cmd: 'mdH2' }, { label: '見出し3  ###', cmd: 'mdH3' }, { label: '見出しレベルを上げる(+)', cmd: 'mdHUp' }, { label: '見出しレベルを下げる(-)', cmd: 'mdHDown' }, { sep: true },
          { label: '箇条書き  -  (U)', cmd: 'mdUl' }, { label: '番号付きリスト  1.  (O)', cmd: 'mdOl' }, { label: 'チェックリスト  - [ ]  (T)', cmd: 'mdTask' }, { label: 'チェックのON/OFF(X)', cmd: 'mdCheck' }, { label: '引用  >  (Q)', cmd: 'mdQuote' }, { label: '水平線  ---  (H)', cmd: 'mdHr' }, { sep: true },
          { label: '表の整形(A)', cmd: 'mdTable' } ] },
        { sep: true }, { label: 'すべてを選択(S)', key: 'Ctrl+A', cmd: 'selectAll' }, { label: 'クリップボード履歴(H)...', cmd: 'clipHist' }, { sep: true },
        { label: '再読み込み(O)', cmd: 'reload', disabled: !ed.srcBytes } ] },
      { label: '表示(V)', items: [
        { label: '折り返し(W)', check: d.wrap, cmd: 'wrap' }, { label: 'ルーラー(R)', check: d.ruler, cmd: 'ruler' }, { label: '行番号(N)', check: d.lineNumbers, cmd: 'lineNumbers' },
        { label: '全角空白/タブ/改行の表示(M)', check: d.showMarks, cmd: 'marks' }, { label: 'カーソル行の強調(C)', check: d.curLine, cmd: 'curLine' }, { label: 'ステータスバー(S)', check: d.statusBar, cmd: 'statusBar' }, { sep: true },
        { label: '全画面表示(F)', key: 'F11', check: !!document.fullscreenElement, cmd: 'fullscreen' },
        { label: '配色(T)', sub: [ { label: '標準(白)', check: d.theme === 'light', cmd: 'theme', arg: 'light' }, { label: '黒', check: d.theme === 'dark', cmd: 'theme', arg: 'dark' } ] },
        { label: '文字を大きく(+)', cmd: 'fontUp' }, { label: '文字を小さく(-)', cmd: 'fontDown' }, { sep: true },
        { label: 'Markdownモード(K)', sub: [ { label: '自動 (.md ファイルで有効)', check: ed.mdManual === null, cmd: 'mdMode', arg: 'auto' }, { label: '常に有効', check: ed.mdManual === true, cmd: 'mdMode', arg: 'on' }, { label: '無効', check: ed.mdManual === false, cmd: 'mdMode', arg: 'off' } ] },
        { label: 'Markdownプレビュー(P)', check: d.mdPreview, cmd: 'mdPreview', disabled: !ed.isMd() }, { sep: true },
        { label: 'IME ON/OFF(I)', key: 'Ctrl+Space', check: ed.ime.on, cmd: 'imetoggle' } ] },
      { label: '検索(S)', items: [
        { label: '検索(F)...', key: 'Ctrl+F', cmd: 'find' }, { label: '下候補(N)', key: 'F3', cmd: 'findNext' }, { label: '上候補(P)', key: 'Shift+F3', cmd: 'findPrev' }, { label: '置換(R)...', key: 'Ctrl+R', cmd: 'replace' },
        { label: '検索文字列の強調(O)', check: ed.find.hl, cmd: 'hl' }, { label: '検索開始位置へ戻る(S)', cmd: 'findStart', disabled: !ed.find.startPos }, { sep: true },
        { label: '指定行(J)...', key: 'Ctrl+G', cmd: 'goto' }, { label: 'ファイルの先頭(T)', key: 'Ctrl+Home', cmd: 'top' }, { label: 'ファイルの最後(B)', key: 'Ctrl+End', cmd: 'bottom' },
        { label: '最後に編集した所(L)', key: 'Ctrl+L', cmd: 'lastEdit' }, { label: '下の編集マーク(D)', cmd: 'editMarkDown' }, { label: '上の編集マーク(U)', cmd: 'editMarkUp' }, { label: '前のカーソル位置(V)', cmd: 'prevPos' },
        { label: '見出し一覧(O)...  [Markdown]', cmd: 'headings', disabled: !ed.isMd() }, { sep: true },
        { label: 'マーク/マーク解除(K)', cmd: 'bookmark', check: ed.bookmarks.has(ed.cur.line) }, { label: '下のマーク', cmd: 'bookmarkNext' }, { label: '上のマーク', cmd: 'bookmarkPrev' }, { label: 'マーク一覧(M)...', cmd: 'bookmarkList' } ] },
      { label: 'マクロ(M)', items: [
        { label: 'キー操作の記録開始/終了(R)', key: 'Shift+F1', cmd: 'macroRec', check: ed.macro.recording }, { label: 'キー操作の再生(P)', key: 'Shift+F2', cmd: 'macroPlay', disabled: !ed.macro.keys.length },
        { label: 'キー操作の保存(S)...', cmd: 'macroSave', disabled: !ed.macro.keys.length }, { label: 'キー操作の読込み(L)...', cmd: 'macroLoad' }, { sep: true },
        { label: '罫線(K)', sub: [
          { label: '罫線モード (矢印キーだけで描く)(M)', check: !!ed.keisenMode, cmd: 'keisenToggle' }, { sep: true },
          { label: '細線を引く', key: 'Alt+矢印', cmd: 'keisenHelp' }, { label: '太線を引く', key: 'Alt+Shift+矢印', cmd: 'keisenHelp' }, { label: '罫線を消す', key: 'Alt+Ctrl+矢印', cmd: 'keisenHelp' }, { sep: true },
          { label: '全角罫線  ─│┌┐(Z)', check: !d.keisenHalf, cmd: 'keisenMode', arg: false }, { label: '半角罫線  +-|(H)', check: !!d.keisenHalf, cmd: 'keisenMode', arg: true }, { sep: true },
          { label: '表に行を挿入(I)', cmd: 'keisenRow' } ] } ] },
      { label: 'その他(O)', items: [
        { label: 'ファイルタイプ別の設定(C)...', cmd: 'filetype' }, { label: '動作環境(E)...', cmd: 'settings' }, { label: 'キー割り当て(K)...', key: 'F1', cmd: 'help' }, { sep: true },
        { label: '単語登録(W)...', key: 'Ctrl+F7', cmd: 'wordreg' }, { label: 'ユーザー辞書(U)...', cmd: 'userdict' }, { label: '変換辞書(D)...', cmd: 'dicts' }, { label: '学習データの消去(L)', cmd: 'learnClear' }, { sep: true },
        { label: '音声入力(V)', key: 'Ctrl+Alt+M', cmd: 'speech', check: typeof Speech !== 'undefined' && Speech.on, disabled: typeof Speech === 'undefined' || !Speech.supported() },
        { label: '選択範囲の再変換(R)', key: '変換 / Ctrl+Alt+R', cmd: 'reconvert', disabled: !ed.selection() }, { sep: true },
        { label: 'バージョン情報(A)...', cmd: 'about' } ] }
    ];
  },
  init(ed) {
    this.ed = ed; const bar = $('#menus');
    this.def().forEach((m, i) => { const b = document.createElement('div'); b.className = 'mtop'; b.dataset.noi18n = '1'; b.innerHTML = I18N.menu(m.label).html; b.dataset.i = i; bar.appendChild(b);
      b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); if (this.openIdx === i) this.close(); else this.openAt(i); });
      b.addEventListener('mouseenter', () => { if (this.openIdx >= 0 && this.openIdx !== i) this.openAt(i); }); });
    document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menubar, .menu')) this.close(); });
    // ---- キーボード操作: Alt+F などでメニューを開く / 開いている間は ↑↓←→ Enter Esc と ( ) 内の英字で操作
    this.mn = this.def().map(m => this.mnemonic(m.label));
    this.relabel = () => { this.mn = this.def().map(m => this.mnemonic(m.label)); bar.querySelectorAll('.mtop').forEach((b, i) => { b.innerHTML = I18N.menu(this.def()[i].label).html; }); };
    let altAlone = false;
    document.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (this.openIdx >= 0) { altAlone = e.key === 'Alt' && !e.repeat && !e.ctrlKey && !e.shiftKey; this.onKey(e); return; }
      if (e.key === 'Alt') { altAlone = !e.repeat && !e.ctrlKey && !e.shiftKey; e.preventDefault(); return; }
      altAlone = false;
      if (e.altKey && !e.ctrlKey && !e.metaKey && !this.dialogOpen() && !Keymap.claims(e)) {
        const i = this.mn.indexOf(this.keyChar(e));
        if (i >= 0) { e.preventDefault(); e.stopPropagation(); this.openKb(i); }
      }
    }, true);
    document.addEventListener('keyup', (e) => {
      if (e.key !== 'Alt') return;
      e.preventDefault();                        // ブラウザ自身のメニューにフォーカスが移るのを防ぐ
      if (this.openIdx >= 0) { if (altAlone) { this.close(); this.ed.focus(); } }
      else if (altAlone && !this.dialogOpen()) this.openKb(0);     // Alt 単独: メニューバーへ
      altAlone = false;
    }, true);
    window.addEventListener('blur', () => { altAlone = false; });
  },
  dialogOpen() { return Array.from(document.querySelectorAll('.dialog')).some(d => d.style.display === 'block'); },
  mnemonic(label) { return I18N.menu(label).mn; },
  keyChar(e) { const c = e.code || ''; if (/^Key[A-Z]$/.test(c)) return c[3]; if (/^Digit[0-9]$/.test(c)) return c[5]; return (e.key || '').length === 1 ? e.key.toUpperCase() : null; },
  openKb(i) { this.ed.commitIme(); this.ed.render(); this.openAt(i); this.pops = [document.querySelector('.menu')]; this.select(this.pops[0], this.firstEnabled(this.pops[0], 0, 1)); },
  firstEnabled(pop, from, dir) { const n = pop._rows.length; for (let k = 0, i = from; k < n; k++, i += dir) { const j = ((i % n) + n) % n; if (!pop._rows[j].it.disabled) return j; } return -1; },
  select(pop, j) { pop._rows.forEach((r, k) => r.row.classList.toggle('sel', k === j)); pop._sel = j; },
  openSub(pop) {
    const r = pop._rows[pop._sel]; if (!r || !r.it.sub || r.it.disabled) return false;
    r.row.dispatchEvent(new MouseEvent('mouseenter'));
    if (!pop._sub) return false;
    this.pops.push(pop._sub); this.select(pop._sub, this.firstEnabled(pop._sub, 0, 1)); return true;
  },
  activate(pop) { const r = pop._rows[pop._sel]; if (!r || r.it.disabled) return; if (r.it.sub) { this.openSub(pop); return; } this.close(); this.ed.focus(); this.ed.cmd(r.it.cmd, r.it.arg); },
  onKey(e) {
    if (!this.pops || !this.pops[0] || !this.pops[0].isConnected) this.pops = [document.querySelector('.menu:not(.sub)')];     // マウスで開いた場合
    while (this.pops.length > 1 && !this.pops[this.pops.length - 1].isConnected) this.pops.pop();
    const pop = this.pops[this.pops.length - 1]; if (!pop) return;
    const n = this.def().length, sel = pop._sel == null ? -1 : pop._sel;
    let used = true;
    switch (e.key) {
      case 'ArrowDown': this.closeSub(pop); this.select(pop, this.firstEnabled(pop, sel + 1, 1)); break;
      case 'ArrowUp': this.closeSub(pop); this.select(pop, this.firstEnabled(pop, sel < 0 ? -1 : sel - 1, -1)); break;
      case 'Home': this.select(pop, this.firstEnabled(pop, 0, 1)); break;
      case 'End': this.select(pop, this.firstEnabled(pop, -1, -1)); break;
      case 'ArrowRight': if (!this.openSub(pop)) this.openKb((this.openIdx + 1) % n); break;
      case 'ArrowLeft': if (this.pops.length > 1) { this.pops.pop(); this.closeSub(this.pops[this.pops.length - 1]); } else this.openKb((this.openIdx + n - 1) % n); break;
      case 'Enter': case ' ': this.activate(pop); break;
      case 'Escape': if (this.pops.length > 1) { this.pops.pop(); this.closeSub(this.pops[this.pops.length - 1]); } else { this.close(); this.ed.focus(); } break;
      case 'Tab': this.close(); this.ed.focus(); break;
      case 'Alt': case 'Shift': case 'Control': break;
      default: {
        const ch = this.keyChar(e); used = false;
        if (e.ctrlKey || e.metaKey || !ch) { if (e.key.length > 1 && !/^F\d+$/.test(e.key)) break; this.close(); this.ed.focus(); return; }
        used = true;
        if (e.altKey) { const t = this.mn.indexOf(ch); if (t >= 0) { this.openKb(t); break; } }
        const hits = pop._rows.map((r, k) => k).filter(k => !pop._rows[k].it.disabled && this.mnemonic(pop._rows[k].it.label) === ch);
        if (!hits.length) break;
        const next = hits.find(k => k > sel); const j = next === undefined ? hits[0] : next;
        this.closeSub(pop); this.select(pop, j);
        if (hits.length === 1) this.activate(pop);          // 同じ英字が複数あるときは選択だけ移して Enter で実行
      }
    }
    if (used) { e.preventDefault(); e.stopPropagation(); }
  },
  openAt(i) {
    this.close(); this.openIdx = i;
    const m = this.def()[i], top = $('#menus').children[i]; top.classList.add('on');
    const r = top.getBoundingClientRect();
    const pop = this.build(m.items); pop.style.left = r.left + 'px'; pop.style.top = r.bottom + 'px'; document.body.appendChild(pop);
  },
  build(items) {
    const pop = document.createElement('div'); pop.className = 'menu'; pop.dataset.noi18n = '1'; pop._rows = [];
    for (const it of items) {
      if (it.sep) { const s = document.createElement('div'); s.className = 'msep'; pop.appendChild(s); continue; }
      const row = document.createElement('div'); row.className = 'mitem' + (it.disabled ? ' dis' : '') + (it.sub ? ' hassub' : '');
      row.innerHTML = `<span class="chk">${it.check ? '✔' : ''}</span><span class="lbl">${I18N.menu(it.label).html}</span><span class="key">${esc(I18N.t(it.key || ''))}</span>${it.sub ? '<span class="arr">▶</span>' : ''}`;
      if (it.sub) { row.addEventListener('mouseenter', () => { this.closeSub(pop); const sub = this.build(it.sub); sub.classList.add('sub'); const r = row.getBoundingClientRect(); sub.style.left = (r.right - 2) + 'px'; sub.style.top = r.top + 'px'; document.body.appendChild(sub); pop._sub = sub; if (sub.getBoundingClientRect().right > window.innerWidth) sub.style.left = (r.left - sub.offsetWidth) + 'px'; }); }
      else { row.addEventListener('mouseenter', () => this.closeSub(pop)); if (!it.disabled) row.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this.close(); this.ed.cmd(it.cmd, it.arg); }); }
      pop._rows.push({ row, it });
      row.addEventListener('mouseenter', () => this.select(pop, pop._rows.findIndex(r => r.row === row)));
      pop.appendChild(row);
    }
    return pop;
  },
  closeSub(pop) { if (pop._sub) { this.closeSub(pop._sub); pop._sub.remove(); pop._sub = null; } },
  close() { this.pops = null; document.querySelectorAll('.menu').forEach(m => m.remove()); document.querySelectorAll('.mtop.on').forEach(m => m.classList.remove('on')); this.openIdx = -1; }
};

/* ---------------------------------------------------------------- UI (ダイアログ) */
const UI = {
  ed: null,
  init(ed) {
    this.ed = ed;
    $('#st-ime').addEventListener('click', () => ed.cmd('imetoggle'));
    document.querySelectorAll('.dialog .close, .dialog [data-close]').forEach(b => b.onclick = () => { this.closeDialogs(); ed.focus(); });
    document.querySelectorAll('.dialog').forEach(dl => dl.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); this.closeDialogs(); ed.focus(); } }));
    // 検索ダイアログ
    const f = $('#findText'), rp = $('#replText');
    const sync = () => { ed.find.text = f.value; ed.find.repl = rp.value; ed.find.regex = $('#fRegex').checked; ed.find.icase = !$('#fCase').checked; ed.find.word = $('#fWord').checked; ed.find.fuzzy = $('#fFuzzy').checked && !ed.find.regex; ed.find.inSel = $('#fInSel').checked; const hl = $('#fHl').checked; if (hl !== ed.find.hl) { ed.find.hl = hl; ed.rendered = []; } if (f.value && !ed.find.hist.includes(f.value)) { ed.find.hist.unshift(f.value); ed.find.hist = ed.find.hist.slice(0, 20); this.renderHist(); } };
    $('#fDown').onclick = () => { sync(); ed.findNext(1); };
    $('#fUp').onclick = () => { sync(); ed.findNext(-1); };
    $('#fReplace').onclick = () => { sync(); ed.replaceOne(ed.find.repl); ed.render(); };
    $('#fReplaceAll').onclick = () => { sync(); const n = ed.replaceAll(ed.find.repl); ed.flash(`${n} 個置換しました`); };
    $('#fHl').onchange = () => { sync(); ed.render(); };
    $('#fRegex').onchange = () => { $('#fFuzzy').disabled = $('#fRegex').checked; };
    for (const el of [f, rp]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { sync(); if (el === rp) { ed.replaceOne(ed.find.repl); ed.render(); } else ed.findNext(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') { this.closeDialogs(); ed.focus(); } if (e.key === 'F3') { e.preventDefault(); sync(); ed.findNext(e.shiftKey ? -1 : 1); } });
    $('#findHist').onchange = () => { f.value = $('#findHist').value; f.focus(); };
    $('#gotoText').addEventListener('keydown', (e) => { if (e.key === 'Enter') { ed.gotoLine(parseInt($('#gotoText').value, 10) || 1); this.closeDialogs(); ed.focus(); } if (e.key === 'Escape') { this.closeDialogs(); ed.focus(); } });
    $('#gotoOk').onclick = () => { ed.gotoLine(parseInt($('#gotoText').value, 10) || 1); this.closeDialogs(); ed.focus(); };
    $('#wordRegOk').onclick = () => { const ok = ed.ime.registerWord($('#wrYomi').value, $('#wrWord').value, $('#wrPos').value, $('#wrCm').value); ed.flash(ok ? '単語を登録しました' : '読みと単語を入力してください'); if (ok) { this.closeDialogs(); ed.focus(); } };
    $('#sortOk').onclick = () => { const desc = $('#sortDesc').checked, num = $('#sortNum').checked, uniq = $('#sortUniq').checked, icase = $('#sortIcase').checked; ed.transformLines(t => { let a = t.split('\n'); const key = (s) => num ? parseFloat(s.replace(/[^\d.\-]/g, '')) || 0 : (icase ? s.toLowerCase() : s); a.sort((x, y) => { const kx = key(x), ky = key(y); return kx < ky ? -1 : kx > ky ? 1 : 0; }); if (desc) a.reverse(); if (uniq) a = a.filter((l, i) => i === 0 || l !== a[i - 1]); return a.join('\n'); }); this.closeDialogs(); ed.render(); ed.focus(); };
    $('#caseOk').onclick = () => { const v = document.querySelector('input[name=caseMode]:checked').value; ed.transform(t => v === 'upper' ? t.toUpperCase() : v === 'lower' ? t.toLowerCase() : t.replace(/\b([a-z])/g, c => c.toUpperCase()), false); this.closeDialogs(); ed.render(); ed.focus(); };
    $('#widthOk').onclick = () => { const toHan = document.querySelector('input[name=widthDir]:checked').value === 'han'; const o = { alpha: $('#wAlpha').checked, sym: $('#wSym').checked, sp: $('#wSpace').checked, kana: $('#wKana').checked };
      ed.transform(t => { let s = t; if (toHan) { if (o.alpha) s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)); if (o.sym) s = Xform.hanPunct(s.replace(/[！-／：-＠［-｀｛-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))); if (o.sp) s = s.replace(/　/g, ' '); if (o.kana) s = Xform.hanKata(s); }
        else { if (o.alpha) s = s.replace(/[A-Za-z0-9]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)); if (o.sym) s = Xform.zenPunct(s.replace(/[!-\/:-@\[-`{-~]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0))); if (o.sp) s = s.replace(/ /g, '　'); if (o.kana) s = Xform.zenKata(s); } return s; }, false); this.closeDialogs(); ed.render(); ed.focus(); };
    // 設定
    // 設定ダイアログ: コントロールは開いたときに現在値を読み込み、[OK] で初めて反映・保存する(キャンセル/✕/Esc は変更なし)
    this.setBinds = [];
    const bindSet = (sel, key, conv, isCheck) => { const el = $(sel); if (el) this.setBinds.push({ el, key, conv, isCheck }); };
    bindSet('#set-fontSize', 'fontSize', v => +v); bindSet('#set-tabWidth', 'tabWidth', v => +v);
    for (const id of ['symKagi', 'symParen', 'symChouon', 'symNakaten', 'symExq', 'symTilde', 'symColon', ...SYM_MORE.map(x => x[0])]) bindSet('#set-' + id, id);
    bindSet('#set-keymap', 'keymap');
    // 記号を一括で全角/半角にする (OK を押すまでは確定しない)
    for (const [btn, han] of [['#symAllZen', false], ['#symAllHan', true]]) $(btn).addEventListener('click', () => document.querySelectorAll('.symgrid select').forEach(sl => { sl.selectedIndex = han ? +(sl.dataset.han || 1) : 0; sl.dispatchEvent(new Event('change', { bubbles: true })); }));
    for (const id of ['tabSpaces', 'autoIndent', 'digitsZen', 'spaceZen', 'predictAuto', 'kataHankaku', 'alphaZen', 'imeOnStart', 'bom', 'mdAuto', 'mdPreview']) bindSet('#set-' + id, id, null, true);
    bindSet('#set-kuten', 'kuten'); bindSet('#set-touten', 'touten'); bindSet('#set-startMode', 'startMode'); bindSet('#set-newEncoding', 'newEncoding'); bindSet('#set-newEol', 'newEol'); bindSet('#set-candPerPage', 'candPerPage', v => +v);
    bindSet('#set-speechMode', 'speechMode'); for (const id of ['speechContinuous', 'speechCommands', 'speechKuten']) bindSet('#set-' + id, id, null, true);
    Design.init();
    $('#settingsOk').onclick = () => { Design.commit(); this.commitSettings(); this.closeDialogs(); ed.focus(); };
    document.querySelectorAll('#setTree div').forEach(t => t.onclick = () => this.setPage(t.dataset.page));
    for (const id of ['wrap', 'ruler', 'lineNumbers', 'curLine', 'statusBar']) bindSet('#set-' + id, id, null, true);
    document.querySelectorAll('input[name=wrapmode]').forEach(r => r.onchange = () => { $('#set-wrap').checked = document.querySelector('input[name=wrapmode]:checked').value === 'win'; });
    $('#set-tabWidth').addEventListener('input', () => { document.querySelector('input[name=tabw][value=c]').checked = true; });
    bindSet('#set-theme', 'theme'); bindSet('#set-lang', 'lang');
    $('#dictsOk').onclick = () => { this.commitDicts(); this.closeDialogs(); ed.focus(); };
    $('#dictImportBtn').onclick = () => $('#dictImportFile').click();
    $('#dictImportFile').onchange = (e) => { const files = Array.from(e.target.files); e.target.value = ''; this.importDicts(files); };
    $('#speechInstall').onclick = async () => { const b = $('#speechInstall'); b.disabled = true; b.textContent = 'ダウンロード中…'; const ok = await Speech.installLocal(); ed.flash(ok ? '端末内認識の日本語言語パックをインストールしました' : '言語パックをインストールできませんでした'); await this.refreshSpeechStatus(); };
    const mic = $('#st-mic'); if (mic) mic.onclick = () => { ed.cmd('speech'); ed.focus(); };
    $('#userdictExport').onclick = () => { const b = new Blob(['﻿' + ed.ime.user.exportText()], { type: 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'ユーザー辞書.txt'; a.click(); };
    $('#userdictImport').onchange = (e) => { const fl = e.target.files[0]; if (!fl) return; fl.text().then(t => { const n = ed.ime.user.importText(t.replace(/^﻿/, '')); IMEDICT._cache.clear(); ed.flash(`${n} 語を取り込みました`); this.renderUserDict(); }); e.target.value = ''; };
    $('#learnClear').onclick = () => ed.cmd('learnClear');
    this.renderDictList();
  },
  open(sel) { this.closeDialogs(); $(sel).style.display = 'block'; },
  closeDialogs() { document.querySelectorAll('.dialog').forEach(d => d.style.display = 'none'); },
  renderHist() { $('#findHist').innerHTML = '<option value="">履歴</option>' + this.ed.find.hist.map(h => `<option>${esc(h)}</option>`).join(''); },
  openFind(withReplace) {
    const ed = this.ed, sel = ed.selectedText();
    this.open('#dlgFind'); $('#dlgFind').classList.toggle('repl', withReplace); $('#findTitle').textContent = withReplace ? '置換' : '検索';
    if (sel && !sel.includes('\n')) $('#findText').value = sel; else if (!$('#findText').value) $('#findText').value = ed.find.text;
    $('#fRegex').checked = ed.find.regex; $('#fCase').checked = !ed.find.icase; $('#fWord').checked = ed.find.word; $('#fFuzzy').checked = ed.find.fuzzy; $('#fHl').checked = ed.find.hl; $('#fInSel').checked = !!ed.selection() && ed.selection().a.line !== ed.selection().b.line;
    ed.find.startPos = { ...ed.cur };
    $('#findText').focus(); $('#findText').select();
  },
  openGoto() { this.open('#dlgGoto'); $('#gotoText').value = this.ed.cur.line + 1; $('#gotoText').focus(); $('#gotoText').select(); },
  openWordReg() { const ed = this.ed; ed.commitIme(); this.open('#dlgWordReg'); $('#wrWord').value = ed.selectedText().replace(/\n/g, '') || ''; $('#wrYomi').value = ''; $('#wrCm').value = ''; ($('#wrWord').value ? $('#wrYomi') : $('#wrWord')).focus(); },
  openHelp() {
    const km = Keymap.helpHtml(), tabs = [...document.querySelectorAll('#helpTabs button')], pane = $('#helpPane');
    $('#kmHelp').innerHTML = km; tabs[0].style.display = km ? '' : 'none';
    const id = Settings.data.keymap || 'hidemaru'; tabs[0].textContent = (Keymap.LIST.find(x => x[0] === id) || ['', ''])[1];
    const show = (t) => { tabs.forEach(b => b.classList.toggle('on', b.dataset.tab === t)); document.querySelectorAll('#helpPane .hpane').forEach(p => p.classList.toggle('on', p.dataset.tab === t)); pane.scrollTop = 0; };
    const vis = () => tabs.filter(b => b.style.display !== 'none');
    tabs.forEach(b => b.onclick = () => { show(b.dataset.tab); $('#helpOk').focus(); });
    $('#dlgHelp').onkeydown = (e) => {
      const v = vis(), i = v.findIndex(b => b.classList.contains('on')), step = { ArrowDown: 40, ArrowUp: -40, PageDown: pane.clientHeight - 30, PageUp: -(pane.clientHeight - 30) }[e.key];
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { show(v[(i + (e.key === 'ArrowRight' ? 1 : v.length - 1)) % v.length].dataset.tab); e.preventDefault(); }
      else if (step) { pane.scrollTop += step; e.preventDefault(); }
      else if (e.key === 'Home') { pane.scrollTop = 0; e.preventDefault(); } else if (e.key === 'End') { pane.scrollTop = pane.scrollHeight; e.preventDefault(); }
    };
    this.open('#dlgHelp'); show(km ? 'km' : 'ime'); $('#helpOk').focus();
  },
  openSort() { this.open('#dlgSort'); },
  openCase() { this.open('#dlgCase'); },
  openWidth() { this.open('#dlgWidth'); },
  openClipHist() { const ed = this.ed; this.open('#dlgClip'); const box = $('#clipList'); box.innerHTML = ed.clipHistory.length ? ed.clipHistory.map((t, i) => `<div class="cliprow" data-i="${i}">${esc(t.substring(0, 80)).replace(/\n/g, '↓')}${t.length > 80 ? '…' : ''}</div>`).join('') : '<div class="dim">履歴はありません</div>'; box.querySelectorAll('.cliprow').forEach(r => r.onclick = () => { ed.pasteText(ed.clipHistory[+r.dataset.i]); this.closeDialogs(); ed.focus(); }); },
  openHeadings() { const ed = this.ed; this.open('#dlgHeadings'); const box = $('#headingList'); const hs = MD.headings(ed.doc.lines); box.innerHTML = hs.length ? hs.map(h => `<div class="cliprow" style="padding-left:${(h.level - 1) * 14 + 6}px" data-l="${h.line}">${'#'.repeat(h.level)} ${esc(h.text)}</div>`).join('') : '<div class="dim">見出しがありません</div>'; box.querySelectorAll('.cliprow').forEach(r => r.onclick = () => { ed.jumpTo({ line: +r.dataset.l, col: 0 }); this.closeDialogs(); ed.render(); ed.focus(); }); },
  openMarks() { const ed = this.ed; this.open('#dlgMarks'); const box = $('#markList'); const ms = [...ed.bookmarks].sort((a, b) => a - b); box.innerHTML = ms.length ? ms.map(l => `<div class="cliprow" data-l="${l}">${l + 1}: ${esc(ed.doc.lines[l] || '')}</div>`).join('') : '<div class="dim">マークはありません (検索メニュー→マーク/マーク解除)</div>'; box.querySelectorAll('.cliprow').forEach(r => r.onclick = () => { ed.jumpTo({ line: +r.dataset.l, col: 0 }); this.closeDialogs(); ed.render(); ed.focus(); }); },
  async refreshSpeechStatus() {
    const el = $('#speechStatus'), b = $('#speechInstall'); if (!el) return;
    if (typeof Speech === 'undefined' || !Speech.supported()) { el.textContent = 'このブラウザは Web Speech API(音声認識)に対応していません'; b.style.display = 'none'; return; }
    const st = await Speech.localStatus();
    el.textContent = { available: '端末内(オフライン)の日本語認識: 利用可能', downloadable: '端末内の日本語認識: 言語パック未インストール(約60MB)', downloading: '端末内の日本語認識: ダウンロード中…',
      unavailable: '端末内の日本語認識: このブラウザ/OS では利用できません(クラウド認識のみ)', unsupported: '端末内認識はこのブラウザでは未対応です(Chrome 139 以降で利用可。クラウド認識のみ)' }[st] || st;
    b.style.display = st === 'downloadable' ? '' : 'none'; b.disabled = false; b.textContent = '言語パックをインストール';
  },
  /** g: 'ft' = ファイルタイプ別の設定 (フォント・体裁・デザイン)、'env' = 動作環境 */
  openSettings(g, page) {
    this.loadSettingsControls(); Design.begin();
    this.setGroup = g;
    $('#setTitle').textContent = g === 'ft' ? 'ファイルタイプ別の設定' : '動作環境';
    document.querySelectorAll('#setTree div').forEach(t => t.classList.toggle('hide', t.dataset.g !== g));
    this.open('#dlgSettings');
    this.setPageLast = this.setPageLast || {};
    this.setPage(page || this.setPageLast[g] || (g === 'ft' ? 'font' : 'file'));
    this.refreshSpeechStatus();
  },
  setPage(p) { if (this.setPageLast && this.setGroup) this.setPageLast[this.setGroup] = p; this.setPageCur = p; document.querySelectorAll('#setTree div').forEach(t => t.classList.toggle('on', t.dataset.page === p)); document.querySelectorAll('.setpage').forEach(t => t.classList.toggle('on', t.dataset.page === p)); if (p === 'design') { Design.renderList(); Design.renderProps(); } },
  loadSettingsControls() {
    this.ed._symMap();
    for (const b of this.setBinds) { if (b.isCheck) b.el.checked = !!Settings.data[b.key]; else b.el.value = Settings.data[b.key]; }
    const d = Settings.data, tw = [2, 4, 8].includes(+d.tabWidth) ? String(d.tabWidth) : 'c';
    document.querySelector(`input[name=tabw][value="${tw}"]`).checked = true;
    document.querySelector(`input[name=wrapmode][value=${d.wrap ? 'win' : 'max'}]`).checked = true;
  },
  commitSettings() {
    for (const b of this.setBinds) {
      if (b.isCheck) { Settings.data[b.key] = b.el.checked; continue; }
      let v = b.conv ? b.conv(b.el.value) : b.el.value;
      if (b.key === 'tabWidth') { const r = document.querySelector('input[name=tabw]:checked'); if (r && r.value !== 'c') v = +r.value; }
      if (typeof v === 'number' && !isFinite(v)) continue;
      Settings.data[b.key] = v;
    }
    Settings.save(); this.ed.applySettings(); this.ed.rendered = []; this.ed.render();
  },
  /* ---- 変換辞書ダイアログ: チェックの変更は [OK] で反映。取り込みと削除はその場で実行される ---- */
  openDicts() { this.dictPending = {}; for (const m of IMEDICT.list) this.dictPending[m.id] = IMEDICT.enabled.has(m.id); $('#dictImportStatus').textContent = ''; this.renderDictList(); this.open('#dlgDicts'); },
  commitDicts() { const p = this.dictPending || {}; for (const m of IMEDICT.list) { if ((m.id in p) && p[m.id] !== IMEDICT.enabled.has(m.id)) DictLoader.setEnabled(m.id, p[m.id]); } this.dictPending = null; },
  renderDictList() {
    const box = $('#dictList'), d = IMEDICT, p = this.dictPending || {};
    if (!box) return;
    box.innerHTML = d.list.map(m => {
      const loaded = d.dicts.has(m.id), on = (m.id in p) ? p[m.id] : d.enabled.has(m.id);
      const info = `${m.entries.toLocaleString()} 語 / ${(m.size / 1e6).toFixed(1)} MB ${loaded ? '読込済' : (d.enabled.has(m.id) ? '読込中…' : '')}`;
      const src = m.imported ? ` <span class="dim">[取り込み: ${esc(m.src || '')} ${esc(m.date || '')}]</span> <button class="dictdel" data-del="${m.id}" title="取り込んだ辞書を削除">削除</button>` : '';
      return `<div class="dictrow" title="${esc(m.note || '')}"><label style="display:inline"><input type="checkbox" data-dict="${m.id}" ${on ? 'checked' : ''}> ${esc(m.label)}</label> <span class="dim">${info}</span>${src}${m.note ? `<div class="dim dictnote">${esc(m.note)}</div>` : ''}</div>`;
    }).join('') + `<div class="dim">接続コスト表: ${d.conn ? '読込済' : '読込中…'}</div>`;
    box.querySelectorAll('input[data-dict]').forEach(cb => cb.onchange = () => { if (this.dictPending) this.dictPending[cb.dataset.dict] = cb.checked; else DictLoader.setEnabled(cb.dataset.dict, cb.checked); });
    box.querySelectorAll('button[data-del]').forEach(b => b.onclick = () => this.deleteDict(b.dataset.del));
  },
  async importDicts(files) {
    const stEl = $('#dictImportStatus'), btn = $('#dictImportBtn');
    if (!files.length) return;
    btn.disabled = true;
    const done = [], failed = [];
    for (const f of files) {
      try {
        const r = await DictImport.importFile(f, (t) => { stEl.textContent = t; });
        DictLoader.register(r.meta, r.text);
        if (this.dictPending) this.dictPending[r.meta.id] = r.meta.on;
        done.push(`${r.meta.label} (${r.meta.entries.toLocaleString()} 語)`);
      } catch (e) { failed.push(`${f.name}: ${e.message}`); }
      this.renderDictList();
    }
    DictImport.releaseCal();
    btn.disabled = false;
    stEl.innerHTML = (done.length ? `取り込み完了: ${esc(done.join('、'))}` : '') + (failed.length ? `<div class="err">${failed.map(esc).join('<br>')}</div>` : '');
    this.renderDictList(); this.ed.renderStatus();
  },
  async deleteDict(id) {
    const m = IMEDICT.list.find(x => x.id === id); if (!m || !m.imported) return;
    if (!confirm(`取り込んだ辞書「${m.label}」を削除しますか?\n(元の辞書ファイルは消えません。もう一度取り込めば元に戻せます)`)) return;
    try { await DictStore.remove(id); } catch (e) { this.ed.flash('削除できませんでした: ' + e.message); return; }
    DictLoader.unregister(id);
    if (this.dictPending) delete this.dictPending[id];
    $('#dictImportStatus').textContent = `「${m.label}」を削除しました`;
    this.renderDictList(); this.ed.renderStatus();
  },
  renderUserDict() {
    const u = this.ed.ime.user, box = $('#userdictList');
    box.innerHTML = u.entries.length ? '<table><tr><th>読み</th><th>単語</th><th>品詞</th><th>コメント</th><th></th></tr>' + u.entries.map((e, i) => `<tr><td>${esc(e.y)}</td><td>${esc(e.w)}</td><td>${esc(e.pos)}</td><td>${esc(e.cm || '')}</td><td><button data-del="${i}">削除</button></td></tr>`).join('') + '</table>' : '<div class="dim">登録語はありません (Ctrl+F7 で登録)</div>';
    box.querySelectorAll('button[data-del]').forEach(b => b.onclick = () => { const e = u.entries[+b.dataset.del]; u.remove(e.y, e.w); IMEDICT._cache.clear(); this.renderUserDict(); });
  }
};

/* ---------------------------------------------------------------- 辞書ローダー */
const DictLoader = {
  loading: new Set(),
  DICT_VER: 4,
  init() {
    let saved = Settings.data.dicts;
    // 辞書構成が変わった版では、旧版の保存設定(辞書の ON/OFF)を捨てて既定値から始める
    if (Settings.data.dictVer !== this.DICT_VER) { if (saved && Settings.data.dictVer === undefined && !('atok_std' in saved)) saved = Settings.data.dicts = null; Settings.data.dictVer = this.DICT_VER; Settings.save(); }
    for (const m of IMEDICT.list) { const on = saved && (m.id in saved) ? saved[m.id] : m.on; if (on) this.setEnabled(m.id, true); }
    this.loadScript('dict/posdef.js'); this.loadScript('dict/connection.js');
    // 取り込み済みの辞書 (IndexedDB)
    DictStore.list().then(metas => {
      const ord = (m) => { const k = DictImport.KINDS.findIndex(x => x.id === m.id); return k < 0 ? 999 : k; };
      metas.sort((a, b) => ord(a) - ord(b));
      for (const meta of metas) {
        const i = IMEDICT.list.findIndex(x => x.id === meta.id);
        if (i >= 0) { if (IMEDICT.dicts.has(meta.id)) continue; IMEDICT.list[i] = meta; } else IMEDICT.list.push(meta);
        const sv = Settings.data.dicts; const on = sv && (meta.id in sv) ? sv[meta.id] : meta.on;
        if (on) this.setEnabled(meta.id, true);
      }
      UI.renderDictList(); this.updateStatus();
    }).catch(e => console.warn('取り込み済み辞書を読めません', e));
  },
  updateStatus() { const el = $('#st-dict'); if (el) el.textContent = `辞書 ${Array.from(IMEDICT.enabled).filter(id => IMEDICT.dicts.has(id)).length}/${IMEDICT.enabled.size}`; },
  setEnabled(id, on) {
    Settings.data.dicts = Settings.data.dicts || {}; Settings.data.dicts[id] = on; Settings.save();
    IMEDICT.setEnabled(id, on);
    if (on && !IMEDICT.dicts.has(id) && !this.loading.has(id)) {
      const m = IMEDICT.list.find(x => x.id === id); if (!m) return;
      this.loading.add(id);
      if (m.imported) DictStore.text(id).then(t => { if (t != null) IMEDICT.load(id, m.label, m.entries, t); else throw new Error('データがありません'); }).catch(e => UI.ed && UI.ed.flash(`辞書を読み込めません: ${m.label} (${e.message})`, 6000)).finally(() => this.loading.delete(id));
      else this.loadScript('dict/' + m.file, () => this.loading.delete(id));
    }
    this.updateStatus();
    UI.ed && UI.ed.renderStatus();
  },
  /** 取り込んだ辞書を一覧に登録して(既定が ON なら)すぐ使えるようにする */
  register(meta, text) {
    const i = IMEDICT.list.findIndex(x => x.id === meta.id);
    if (i >= 0) IMEDICT.list[i] = meta; else IMEDICT.list.push(meta);
    IMEDICT.dicts.delete(meta.id); IMEDICT._rev = null;
    Settings.data.dicts = Settings.data.dicts || {}; Settings.data.dicts[meta.id] = meta.on; Settings.save();
    IMEDICT.setEnabled(meta.id, meta.on);
    if (meta.on) IMEDICT.load(meta.id, meta.label, meta.entries, text);
    this.updateStatus();
  },
  unregister(id) {
    const i = IMEDICT.list.findIndex(x => x.id === id); if (i >= 0) IMEDICT.list.splice(i, 1);
    IMEDICT.dicts.delete(id); IMEDICT.setEnabled(id, false); IMEDICT._rev = null;
    if (Settings.data.dicts) { delete Settings.data.dicts[id]; Settings.save(); }
    this.updateStatus();
  },
  loadScript(src, done) { const s = document.createElement('script'); s.src = src; s.onload = done || null; s.onerror = () => { UI.ed && UI.ed.flash('辞書ファイルの読み込みに失敗: ' + src, 6000); done && done(); }; document.head.appendChild(s); }
};

/* ---------------------------------------------------------------- 起動 */
window.addEventListener('beforeunload', (e) => { if (window.editor && window.editor.doc.dirty) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('DOMContentLoaded', () => {
  const ed = new Editor(); window.editor = ed;
  Menu.init(ed); UI.init(ed);
  IMEDICT.onLoaded = (id) => { UI.renderDictList(); ed.flash(`辞書を読み込みました: ${(IMEDICT.list.find(x => x.id === id) || { label: id }).label}`); DictLoader.updateStatus(); };
  IMEDICT.onError = (id, e) => ed.flash('辞書エラー ' + id + ': ' + e.message, 8000);
  DictLoader.init();
  $('#st-dict').textContent = `辞書 0/${IMEDICT.enabled.size}`;
});
