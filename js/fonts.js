/* fonts.js — エディタのフォント選択。インストールされているフォントを調べ、等幅かどうかを実測して分類する
 *
 *   調べ方: (1) Local Font Access API (window.queryLocalFonts, Chrome / Edge 103 以降。初回に許可を求められる) で全フォント名を得る
 *           (2) API が使えない・許可されないときは、よく使われる等幅フォントの候補が入っているかを 1 つずつ確かめる
 *   判定:   canvas で文字幅を測る。 i W m 0 . 空白 の幅がすべて同じ → 英数字が等幅。
 *           さらに「あ」の字形をそのフォントが持っていて、幅が半角のちょうど 2 倍 → 日本語も桁がそろう (kind = 'jp')。それ以外は 'latin'。
 */
const Fonts = (() => {
  const DEFAULT = '"MS Gothic", "ＭＳ ゴシック", "BIZ UDGothic", Consolas, monospace';
  const KNOWN = ['MS Gothic', 'ＭＳ ゴシック', 'MS Mincho', 'ＭＳ 明朝', 'BIZ UDGothic', 'BIZ UDゴシック', 'BIZ UDMincho', 'BIZ UD明朝', 'Consolas', 'Courier New', 'Lucida Console', 'Cascadia Mono', 'Cascadia Code',
    'HackGen', 'HackGen Console', 'HackGen35', 'HackGen Console NF', 'Ricty', 'Ricty Diminished', 'Myrica M', 'MyricaM M', 'Migu 1M', 'MigMix 1M', 'Source Han Code JP', '源ノ角ゴシック Code JP', 'PlemolJP', 'PlemolJP Console', 'UDEV Gothic', 'UDEV Gothic JPDOC',
    'Moralerspace Neon', 'Moralerspace Argon', 'Noto Sans Mono CJK JP', 'Noto Sans Mono', 'Cica', 'Firge', 'Juisee', 'Bizin Gothic', 'M PLUS 1 Code', 'M+ 1m', 'M+ 2m', 'Osaka-Mono', 'Osaka－等幅', 'Menlo', 'Monaco', 'SF Mono',
    'DejaVu Sans Mono', 'Liberation Mono', 'IPAGothic', 'IPAゴシック', 'IPAMincho', 'IPA明朝', 'VL Gothic', 'VL ゴシック', 'TakaoGothic', 'Takaoゴシック', 'Fira Code', 'Fira Mono', 'JetBrains Mono', 'Source Code Pro', 'Inconsolata', 'Ubuntu Mono', 'Roboto Mono', 'IBM Plex Mono', 'Hack', 'Terminal', 'ＭＳ ゴシック'];
  const SIZE = 40;
  let cv = null, ctx = null;
  const q = (name) => '"' + String(name).replace(/["\\]/g, '') + '"';
  function w(text, font) { ctx.font = SIZE + 'px ' + font; return ctx.measureText(text).width; }
  function pixels(text, font) { ctx.clearRect(0, 0, cv.width, cv.height); ctx.font = SIZE + 'px ' + font; ctx.textBaseline = 'top'; ctx.fillStyle = '#000'; ctx.fillText(text, 4, 4); return ctx.getImageData(0, 0, cv.width, cv.height).data; }
  const same = (a, b) => { for (let i = 3; i < a.length; i += 4) if (a[i] !== b[i]) return false; return true; };
  function init() { if (!cv) { cv = document.createElement('canvas'); cv.width = 176; cv.height = 64; ctx = cv.getContext('2d', { willReadFrequently: true }); } }
  /** そのフォントが入っているか (総称フォントに置き換わっていないか) */
  function installed(name) {
    init(); const t = 'mmmmmmmmmmlli10OQ@ wW';
    return ['monospace', 'serif', 'sans-serif'].some(fb => Math.abs(w(t, q(name) + ', ' + fb) - w(t, fb)) > 0.01);
  }
  /** そのフォント自身が文字 ch の字形を持っているか (持っていなければ代替フォントで描かれ、代替フォントだけのときと同じ絵になる) */
  function hasGlyph(name, ch) { return ['serif', 'monospace'].some(fb => !same(pixels(ch, q(name) + ', ' + fb), pixels(ch, fb))); }
  /** 'jp' = 英数字も日本語も桁がそろう / 'latin' = 英数字だけ等幅 / null = 等幅ではない */
  function classify(name) {
    init(); const f = q(name) + ', serif', a = w('A', f);
    if (!(a > 0) || ['i', 'W', 'm', '0', '.', ' ', 'l'].some(c => Math.abs(w(c, f) - a) > SIZE * 0.004)) return null;
    if (Math.abs(w('あ', f) - 2 * a) < SIZE * 0.01 && Math.abs(w('漢', f) - 2 * a) < SIZE * 0.01 && hasGlyph(name, 'あ')) return 'jp';
    return 'latin';
  }
  function load() { try { return JSON.parse(localStorage.getItem('jpime_fonts') || 'null'); } catch (e) { return null; } }
  function store(list, full) { try { localStorage.setItem('jpime_fonts', JSON.stringify({ list, full })); } catch (e) {} }
  function build(names) {
    const seen = new Set(), list = [];
    const sigs = new Set();          // 同じフォントの別名 (MS Gothic と ＭＳ ゴシック など) は、字形が同じなので 1 つにまとめる
    for (const n of names) {
      if (!n || seen.has(n) || n[0] === '@') continue; seen.add(n);
      const k = classify(n); if (!k) continue;
      const px = pixels('あ直骨g', q(n) + ', serif'); let h = 0; for (let i = 3; i < px.length; i += 4) h = (h * 31 + px[i]) | 0;
      const sig = w('Aあg漢@', q(n) + ', serif').toFixed(2) + '/' + h; if (sigs.has(sig)) continue; sigs.add(sig);
      list.push({ n, k });
    }
    list.sort((x, y) => x.n.localeCompare(y.n, 'ja'));
    return list;
  }
  /** 候補リストだけで調べる (許可は不要) */
  function scanKnown() { const list = build(KNOWN.filter(installed)); store(list, false); return list; }
  /** インストールされている全フォントを調べる。戻り値 { list, full, error } */
  async function scanAll() {
    if (!('queryLocalFonts' in window)) return { list: scanKnown(), full: false, error: 'unsupported' };
    let fonts;
    try { fonts = await window.queryLocalFonts(); } catch (e) { return { list: scanKnown(), full: false, error: 'denied' }; }
    if (!fonts.length) return { list: scanKnown(), full: false, error: 'denied' };
    const names = [...new Set(fonts.map(f => f.family))];
    const list = build(names);
    store(list, true);
    return { list, full: true, total: names.length };
  }
  function current() { const c = load(); return c && c.list ? c : { list: scanKnown(), full: false }; }
  /** <select> に選択肢を入れる。 sel = 現在の設定値 ('' = 標準) */
  function fill(el, sel) {
    const en = Settings.data.lang === 'en', c = current(), esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const opt = (f) => `<option value="${esc(f.n)}">${esc(f.n)}</option>`;
    const jp = c.list.filter(f => f.k === 'jp'), la = c.list.filter(f => f.k === 'latin');
    let h = `<option value="">${en ? '(Default: MS Gothic)' : '(標準: ＭＳ ゴシック)'}</option>`;
    if (sel && !c.list.some(f => f.n === sel)) h += opt({ n: sel });
    if (jp.length) h += `<optgroup label="${en ? 'Monospaced (Japanese = 2 columns)' : '等幅 (全角 = 半角の 2 倍)'}">${jp.map(opt).join('')}</optgroup>`;
    if (la.length) h += `<optgroup label="${en ? 'Monospaced for Latin only (Japanese will not align)' : '英数字のみ等幅 (日本語は桁がずれます)'}">${la.map(opt).join('')}</optgroup>`;
    el.innerHTML = h; el.value = sel || '';
    return c;
  }
  const css = (name) => (name ? q(name) + ', ' : '') + DEFAULT;
  return { DEFAULT, classify, installed, scanKnown, scanAll, fill, css, current };
})();
