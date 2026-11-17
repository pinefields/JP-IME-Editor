/* design.js — 配色(デザイン)の設定。秀丸の「ファイルタイプ別の設定 → デザイン」に相当
 *   Settings.data.design = { items: { <key>: { fg, bg, bold } }, show: { eol, eof, tab, zs } }   未設定の項目はテーマ(ライト/ダーク)の既定色
 *   Design.apply() が <style id="usercolors"> を生成して上書きする。
 */
const Design = {
  // k: キー, label: 表示名, fg/bg: 既定色 [ライト, ダーク] (null = その属性なし), bold: スタイル指定可, check: 表示ON/OFF (set:Settings のキー / show:design.show のキー), sample
  ITEMS: [
    { k: 'text',  label: '普通の文字',            fg: ['#000000', '#e8e8e8'], bg: ['#ffffff', '#1e1e1e'], bold: true, sample: 'abcABC123456' },
    { k: 'cur',   label: 'カーソル行',            fg: null, bg: ['#f4f7fc', '#2a2a2a'], check: { set: 'curLine' }, sample: 'abcABC123456' },
    { k: 'caret', label: 'キャレット',            fg: ['#000000', '#e8e8e8'], bg: null, sample: '▏' },
    { k: 'ime',   label: 'IME変換中の色',         fg: ['#000000', '#e8e8e8'], bg: ['#ffffff', '#1e1e1e'], sample: 'へんかんちゅう' },
    { k: 'imef',  label: 'IME変換中の注目文節',   fg: ['#ffffff', '#ffffff'], bg: ['#0a4e9a', '#0a4e9a'], sample: '注目文節' },
    { k: 'sel',   label: '範囲選択',              fg: ['#000000', '#e8e8e8'], bg: ['#cce4ff', '#264f78'], sample: 'abcABC123456' },
    { k: 'eol',   label: '改行文字',              fg: ['#88aabb', '#5a7a8a'], bg: null, check: { show: 'eol' }, sample: '↓ ↓ ↓' },
    { k: 'eof',   label: 'EOF(ファイルの末尾)',   fg: ['#00aa00', '#3cd43c'], bg: null, check: { show: 'eof' }, sample: '[EOF]' },
    { k: 'tab',   label: 'タブ文字',              fg: ['#88aabb', '#5a7a8a'], bg: null, check: { show: 'tab' }, sample: '^   ^   ^' },
    { k: 'zs',    label: '全角空白',              fg: ['#88aabb', '#5a7a8a'], bg: null, check: { show: 'zs' }, sample: '□ □ □' },
    { k: 'ruler', label: 'ルーラー',              fg: ['#333333', '#dddddd'], bg: ['#ececec', '#333333'], check: { set: 'ruler' }, sample: '0 . . . . 10' },
    { k: 'ln',    label: '行番号',                fg: ['#666677', '#9a9a9a'], bg: ['#f3f3f3', '#262626'], check: { set: 'lineNumbers' }, sample: '12345' },
    { k: 'bm',    label: 'マークした行の行番号',  fg: ['#000000', '#000000'], bg: ['#ffd34d', '#ffd34d'], sample: '12345' },
    { k: 'obar',  label: '見出しバー',            fg: ['#333333', '#333333'], bg: ['#e6e6e6', '#e6e6e6'], sample: '# 見出し' },
    { k: 'hl',    label: '検索文字列の強調',      fg: ['#000000', '#e8e8e8'], bg: ['#ffe08a', '#7a6a1a'], sample: 'Found' },
    { k: 'mdh',   label: 'Markdown 見出し',       fg: ['#1a4fb0', '#7fb3ff'], bg: null, sample: '# Heading' },
    { k: 'mdc',   label: 'Markdown コード',       fg: ['#8a3b00', '#e8a86c'], bg: ['#f3f1ea', '#2b2b2b'], sample: '`code`' },
    { k: 'mdl',   label: 'Markdown リンク',       fg: ['#0066cc', '#6cb6ff'], bg: null, sample: '[link](url)' },
    { k: 'mdq',   label: 'Markdown 引用・表の罫', fg: ['#777777', '#9a9a9a'], bg: null, sample: '> quote' },
    { k: 'mdb',   label: 'Markdown 箇条書き記号', fg: ['#c04000', '#ff9d5c'], bg: null, sample: '- [x] 1.' },
  ],
  PRESETS: {
    '白背景 (標準)': {},
    '黒背景 (秀丸風)': { text: { fg: '#ffffff', bg: '#000000' }, cur: { bg: '#1c1c1c' }, caret: { fg: '#ffffff' }, ime: { fg: '#ffffff', bg: '#000000' }, sel: { fg: '#000000', bg: '#ffffff' },
      eol: { fg: '#00c8c8' }, eof: { fg: '#00ff00' }, tab: { fg: '#808080' }, zs: { fg: '#808080' }, ruler: { fg: '#ffffff', bg: '#000000' }, ln: { fg: '#ffffff', bg: '#000000' }, bm: { fg: '#ffffff', bg: '#008000' },
      obar: { fg: '#ffffff', bg: '#404040' }, hl: { fg: '#ffffff', bg: '#0000ff' }, mdh: { fg: '#ffff00' }, mdc: { fg: '#ffa040', bg: '#202020' }, mdl: { fg: '#00ffff' }, mdq: { fg: '#00ff00' }, mdb: { fg: '#ff60ff' } },
    'ダークグレー': { text: { fg: '#d4d4d4', bg: '#1e1e1e' }, cur: { bg: '#2a2d2e' }, caret: { fg: '#d4d4d4' }, ime: { fg: '#d4d4d4', bg: '#1e1e1e' }, sel: { fg: '#ffffff', bg: '#264f78' },
      eol: { fg: '#5a7a8a' }, eof: { fg: '#6a9955' }, tab: { fg: '#5a5a5a' }, zs: { fg: '#5a5a5a' }, ruler: { fg: '#aaaaaa', bg: '#2d2d2d' }, ln: { fg: '#858585', bg: '#252526' },
      obar: { fg: '#cccccc', bg: '#333333' }, hl: { fg: '#ffffff', bg: '#7a5a00' }, mdh: { fg: '#7fb3ff' }, mdc: { fg: '#e8a86c', bg: '#2b2b2b' }, mdl: { fg: '#6cb6ff' }, mdq: { fg: '#9a9a9a' }, mdb: { fg: '#ff9d5c' } },
    'クリーム (目にやさしい)': { text: { fg: '#3b3228', bg: '#fbf5e3' }, cur: { bg: '#f2ead0' }, caret: { fg: '#3b3228' }, ime: { fg: '#3b3228', bg: '#fbf5e3' }, sel: { fg: '#3b3228', bg: '#e3d6a8' },
      eol: { fg: '#b5a888' }, eof: { fg: '#7a9a3a' }, tab: { fg: '#c5b998' }, zs: { fg: '#c5b998' }, ruler: { fg: '#6b5f4a', bg: '#efe7cf' }, ln: { fg: '#9a8e74', bg: '#f3ecd6' },
      obar: { fg: '#6b5f4a', bg: '#efe7cf' }, hl: { fg: '#3b3228', bg: '#ffd060' }, mdh: { fg: '#1f5f8f' }, mdc: { fg: '#8a3b00', bg: '#f0e8cc' }, mdl: { fg: '#1f6fb0' }, mdq: { fg: '#857a62' }, mdb: { fg: '#b0500a' } },
    '緑背景 (黒板風)': { text: { fg: '#e6f0e0', bg: '#1f3a2c' }, cur: { bg: '#27483a' }, caret: { fg: '#ffffff' }, ime: { fg: '#e6f0e0', bg: '#1f3a2c' }, sel: { fg: '#1f3a2c', bg: '#cfe8c0' },
      eol: { fg: '#6f9a80' }, eof: { fg: '#ffe060' }, tab: { fg: '#55806a' }, zs: { fg: '#55806a' }, ruler: { fg: '#cfe0c8', bg: '#19301f' }, ln: { fg: '#9fbfa8', bg: '#19301f' },
      obar: { fg: '#cfe0c8', bg: '#19301f' }, hl: { fg: '#000000', bg: '#ffe060' }, mdh: { fg: '#ffe060' }, mdc: { fg: '#ffc890', bg: '#19301f' }, mdl: { fg: '#9fd8ff' }, mdq: { fg: '#a8c8b0' }, mdb: { fg: '#ffb070' } },
  },
  state() { const d = Settings.data.design; return { items: (d && d.items) || {}, show: (d && d.show) || {} }; },
  /** 項目の実効色 { fg, bg, bold } (st: 編集中の状態。省略時は保存済み設定) */
  eff(k, st) {
    st = st || this.state();
    const it = this.ITEMS.find(x => x.k === k), u = st.items[k] || {}, t = this.themeIdx(), tx = st.items.text || {};
    // 色を付けていないキャレット・IME変換中・範囲選択・検索強調の文字色は「普通の文字」に従う (実際の表示と同じ)
    const dfg = it.fg ? ((['caret', 'ime', 'sel', 'hl'].includes(k) && tx.fg) || it.fg[t]) : null, dbg = it.bg ? ((k === 'ime' && tx.bg) || it.bg[t]) : null;
    return { fg: it.fg ? (u.fg || dfg) : null, bg: it.bg ? (u.bg || dbg) : null, bold: !!u.bold };
  },
  /** 背景が暗い配色か (Markdown プレビューの配色切り替えに使う) */
  isDark() { const c = this.eff('text').bg, n = parseInt(c.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) < 128; },
  css(st) {
    st = st || this.state();
    const u = st.items, sh = st.show, out = [], vars = [];
    const has = (k, a) => u[k] && u[k][a];
    if (has('text', 'fg')) vars.push('--fg:' + u.text.fg); if (has('text', 'bg')) vars.push('--bg:' + u.text.bg);
    if (has('cur', 'bg')) vars.push('--cur:' + u.cur.bg);
    if (has('mdh', 'fg')) vars.push('--md-h:' + u.mdh.fg); if (has('mdc', 'fg')) vars.push('--md-code:' + u.mdc.fg); if (has('mdc', 'bg')) vars.push('--md-codebg:' + u.mdc.bg);
    if (has('mdl', 'fg')) vars.push('--md-link:' + u.mdl.fg); if (has('mdq', 'fg')) vars.push('--md-quote:' + u.mdq.fg); if (has('mdb', 'fg')) vars.push('--md-bullet:' + u.mdb.fg);
    if (has('eof', 'fg')) vars.push('--eof:' + u.eof.fg);
    if (vars.length) out.push(`html:root, html.theme-dark:root { ${vars.join('; ')}; }`);
    if (u.text && u.text.bold) out.push('#text { font-weight: bold; }');
    const rule = (sel, k, extra) => { const a = []; if (has(k, 'fg')) a.push('color:' + u[k].fg); if (has(k, 'bg')) a.push('background:' + u[k].bg); if (extra) a.push(extra); if (a.length) out.push(`${sel} { ${a.join('; ')}; }`); };
    if (has('caret', 'fg')) out.push(`.caret { background: ${u.caret.fg}; }`);
    rule('.pre, .pre-seg, .pre-speech', 'ime', has('ime', 'fg') ? 'border-bottom-color:' + u.ime.fg : '');
    rule('.pre-focus', 'imef', has('imef', 'bg') ? 'border-bottom-color:' + u.imef.bg : '');
    if (has('eol', 'fg')) out.push(`.eol { color: ${u.eol.fg}; }`);
    if (has('tab', 'fg')) out.push(`.tab::before { color: ${u.tab.fg}; }`);
    if (has('zs', 'fg')) out.push(`.zs { outline-color: ${u.zs.fg}; }`);
    if (sh.eol === false) out.push('#text .eol { display: none; }');
    if (sh.eof === false) out.push('#text .eof { display: none; }');
    if (sh.tab === false) out.push('#text .tab::before { display: none; }');
    if (sh.zs === false) out.push('#text .zs { outline: none; }');
    rule('#ruler, html.theme-dark #ruler', 'ruler');
    rule('#text .line .ln', 'ln'); rule('#text .line.bm .ln', 'bm');
    rule('#outline, #outline.has', 'obar');
    rule('#text .hl', 'hl'); rule('#text .sel', 'sel');
    return out.join('\n');
  },
  apply() {
    let st = document.getElementById('usercolors');
    if (!st) { st = document.createElement('style'); st.id = 'usercolors'; document.head.appendChild(st); }
    st.textContent = this.css();
  },

  /* ---------------- 設定画面 (動作環境 → デザイン ページ) ---------------- */
  pend: null, cur: 'text',
  /** 動作環境ダイアログを開くときに呼ぶ: 編集用のコピーを作る */
  begin() {
    const s = this.state();
    this.pend = { items: JSON.parse(JSON.stringify(s.items)) };
    for (const k of this.SHOW) $('#dshow-' + k).checked = s.show[k] !== false;
    const ps = $('#dsPreset'); ps.innerHTML = '<option value="">(選択)</option>' + Object.keys(this.PRESETS).map(n => `<option>${esc(n)}</option>`).join(''); ps.value = '';
  },
  // 表示 ON/OFF: ルーラー・行番号・カーソル行は「表示」ページのチェックボックスと同じもの
  SHOW: ['eol', 'eof', 'tab', 'zs'],
  // 表示 ON/OFF は「表示1」「表示2」ページのチェックボックスと同じもの
  checked(it) { const c = it.check; if (!c) return null; return $(c.set ? '#set-' + c.set : '#dshow-' + c.show).checked; },
  themeIdx() { const open = this.pend && $('#dlgSettings').style.display === 'block'; return (open ? $('#set-theme').value : Settings.data.theme) === 'dark' ? 1 : 0; },
  renderList() {
    if (!this.pend) return;
    const base = this.eff('text', this.pend);
    $('#dsList').innerHTML = this.ITEMS.map(it => {
      const e = this.eff(it.k, this.pend), chk = this.checked(it);
      const fg = it.k === 'cur' ? base.fg : (e.fg || base.fg), bg = e.bg || base.bg;
      return `<div class="dsrow${it.k === this.cur ? ' on' : ''}" data-k="${it.k}"><span class="dschk">${it.check ? `<input type="checkbox" data-c="${it.k}" ${chk ? 'checked' : ''}>` : ''}</span><span class="dslbl">${esc(it.label)}</span><span class="dssample" style="color:${fg};background:${bg};${(e.bold || (it.k !== 'text' && base.bold)) ? 'font-weight:bold;' : ''}">${esc(it.sample)}</span></div>`;
    }).join('');
    $('#dsList').querySelectorAll('.dsrow').forEach(r => r.onclick = (ev) => { if (ev.target.tagName === 'INPUT') return; const top = $('#dsList').scrollTop; this.cur = r.dataset.k; this.renderList(); this.renderProps(); $('#dsList').scrollTop = top; });
    $('#dsList').querySelectorAll('input[data-c]').forEach(cb => cb.onchange = () => { const it = this.ITEMS.find(x => x.k === cb.dataset.c); $(it.check.set ? '#set-' + it.check.set : '#dshow-' + it.check.show).checked = cb.checked; });
  },
  contrast(c) { const n = parseInt(c.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) < 140 ? '#fff' : '#000'; },
  renderProps() {
    if (!this.pend) return;
    const it = this.ITEMS.find(x => x.k === this.cur), e = this.eff(it.k, this.pend), u = this.pend.items[it.k] || {};
    const btn = (el, has, val, isSet) => { el.style.background = has ? val : '#ddd'; el.style.color = has ? this.contrast(val) : '#888'; el.textContent = !has ? '' : (isSet ? '' : '既定'); };
    btn($('#dsFg'), !!it.fg, e.fg, !!u.fg); btn($('#dsBg'), !!it.bg, e.bg, !!u.bg);
    $('#dsBold').value = e.bold ? 'bold' : 'normal';
    $('#dsFgRow').classList.toggle('dis', !it.fg); $('#dsBgRow').classList.toggle('dis', !it.bg); $('#dsBoldRow').classList.toggle('dis', !it.bold);
  },
  setProp(a, v) { const u = this.pend.items[this.cur] || (this.pend.items[this.cur] = {}); if (v == null) delete u[a]; else u[a] = v; const top = $('#dsList').scrollTop; this.renderList(); this.renderProps(); $('#dsList').scrollTop = top; },
  init() {
    const pick = (a) => () => {
      const it = this.ITEMS.find(x => x.k === this.cur), u = this.pend.items[this.cur] || {}, base = this.ITEMS[0], t = this.themeIdx();
      ColorDlg.open({ value: u[a] || null, def: this.eff(it.k, this.pend)[a], sysBg: (this.pend.items.text && this.pend.items.text.bg) || base.bg[t], sysFg: (this.pend.items.text && this.pend.items.text.fg) || base.fg[t], title: `色の指定 - ${it.label} (${a === 'fg' ? '文字の色' : '背景の色'})` }, (v) => this.setProp(a, v));
    };
    $('#dsFg').onclick = pick('fg'); $('#dsBg').onclick = pick('bg');
    $('#dsBold').onchange = (e) => this.setProp('bold', e.target.value === 'bold' ? true : null);
    $('#dsPreset').onchange = (e) => { const p = this.PRESETS[e.target.value]; if (!p) return; this.pend.items = JSON.parse(JSON.stringify(p)); this.renderList(); this.renderProps(); };
    $('#dsReset').onclick = () => { this.pend.items = {}; for (const k of this.SHOW) $('#dshow-' + k).checked = true; $('#dsPreset').value = ''; this.renderList(); this.renderProps(); };
    ColorDlg.init();
  },
  /** [OK]: 編集内容を設定に書き込む (保存と反映は UI.commitSettings が行う) */
  commit() {
    if (!this.pend) return;
    const items = {};
    for (const [k, u] of Object.entries(this.pend.items)) { const o = {}; if (u.fg) o.fg = u.fg; if (u.bg) o.bg = u.bg; if (u.bold) o.bold = true; if (Object.keys(o).length) items[k] = o; }
    const show = {}; for (const k of this.SHOW) show[k] = $('#dshow-' + k).checked;
    Settings.data.design = { items, show };
    this.pend = null;
  },
};

/* ---------------- 色の指定ダイアログ (秀丸風: 基本色 48 色 + システム色 + 色の作成) ---------------- */
const ColorDlg = {
  COLORS: ['#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#808080',
           '#c0c0c0', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
           '#ff80c0', '#ff8080', '#80ff80', '#00ff80', '#0080ff', '#ff80ff', '#80ffff', '#8080ff',
           '#ff80ff', '#ff8040', '#80ff00', '#00ff40', '#0080c0', '#8000ff', '#00c0c0', '#8080c0',
           '#800040', '#ff8000', '#008040', '#80ff40', '#004080', '#ff0080', '#008080', '#804040',
           '#400000', '#804000', '#004000', '#408000', '#000040', '#400040', '#004040', '#404040'],
  val: null, opt: null, cb: null, hsl: [160, 0, 240],      // 色合い 0-239 / 鮮やかさ 0-240 / 明るさ 0-240 (Windows の色の設定と同じ目盛り)
  hex(r, g, b) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); },
  rgbOf(c) { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; },
  rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 160 / 240, s = 0;
    if (d > 1e-9) { s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4); h /= 6; }
    return [Math.min(239, Math.round(h * 240) % 240), Math.round(s * 240), Math.round(l * 240)];
  },
  hsl2rgb(H, S, L) {
    const h = H / 240, s = S / 240, l = L / 240;
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  },
  init() {
    $('#colGrid').innerHTML = this.COLORS.map((c, i) => `<button data-c="${c}" data-i="${i}" style="background:${c}" title="${c}"></button>`).join('');
    $('#colGrid').querySelectorAll('button').forEach(b => { b.onclick = () => this.set(b.dataset.c); b.ondblclick = () => { this.set(b.dataset.c); this.ok(); }; });
    $('#colSysBg').onclick = () => this.set(this.opt.sysBg, 'bg'); $('#colSysFg').onclick = () => this.set(this.opt.sysFg, 'fg');
    // 色合い×鮮やかさ の面 と 明るさ のバー
    const drag = (cv, fn) => { const h = (e) => { const r = cv.getBoundingClientRect(); fn(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))); };
      cv.addEventListener('mousedown', (e) => { e.preventDefault(); h(e); const mv = (ev) => h(ev), up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }; document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); }); };
    drag($('#colSV'), (x, y) => { let L = this.hsl[2]; if (L === 0 || L === 240) L = 120; this.setHsl(Math.min(239, Math.round(x * 239)), Math.round((1 - y) * 240), L); });
    drag($('#colL'), (x, y) => this.setHsl(this.hsl[0], this.hsl[1], Math.round((1 - y) * 240)));
    const num = (id, max) => { const v = Math.round(+$(id).value); return isFinite(v) ? Math.max(0, Math.min(max, v)) : 0; };
    for (const id of ['#colH', '#colS', '#colLn']) $(id).oninput = () => this.setHsl(num('#colH', 239), num('#colS', 240), num('#colLn', 240), id);
    for (const id of ['#colR', '#colG', '#colB']) $(id).oninput = () => this.set(this.hex(num('#colR', 255), num('#colG', 255), num('#colB', 255)), null, id);
    $('#colHex').oninput = (e) => { if (/^[0-9a-fA-F]{6}$/.test(e.target.value)) this.set('#' + e.target.value.toLowerCase(), null, '#colHex'); };
    $('#colOk').onclick = () => this.ok(); $('#colCancel').onclick = () => this.close();
    $('#dlgColor').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); } else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.ok(); } }, true);
    // 面は一度だけ描く (横: 色合い、縦: 上が鮮やか・下が灰色)
    const cv = $('#colSV'), g = cv.getContext('2d'), W = cv.width, H = cv.height;
    const hg = g.createLinearGradient(0, 0, W, 0); for (let i = 0; i <= 12; i++) hg.addColorStop(i / 12, `hsl(${i * 30},100%,50%)`);
    g.fillStyle = hg; g.fillRect(0, 0, W, H);
    const sg = g.createLinearGradient(0, 0, 0, H); sg.addColorStop(0, 'rgba(128,128,128,0)'); sg.addColorStop(1, 'rgba(128,128,128,1)');
    g.fillStyle = sg; g.fillRect(0, 0, W, H);
    this._sv = g.getImageData(0, 0, W, H);
  },
  /** opt: { value: 現在の指定色(null=既定), def: 既定色, sysBg, sysFg, title }  cb(色 or null) は [OK] のときだけ呼ばれる */
  open(opt, cb) {
    this.opt = opt; this.cb = cb;
    $('#dlgColor h3').textContent = opt.title || '色の指定';
    const b1 = $('#colSysBg'), b2 = $('#colSysFg');
    b1.style.background = opt.sysBg; b1.style.color = Design.contrast(opt.sysBg); b2.style.background = opt.sysFg; b2.style.color = Design.contrast(opt.sysFg);
    this.set(opt.value || opt.def);
    $('#dlgColor').style.display = 'block';
    $('#colOk').focus();
  },
  /** RGB(#rrggbb) で色を決める。 sys: 'bg'/'fg' = システム色ボタン、 src: 入力中の欄(書き戻さない) */
  set(c, sys, src) { this.val = c; this.sys = sys || null; const [r, g, b] = this.rgbOf(c); this.hsl = this.rgb2hsl(r, g, b); this.refresh(src); },
  setHsl(H, S, L, src) { this.hsl = [H, S, L]; this.sys = null; this.val = this.hex(...this.hsl2rgb(H, S, L)); this.refresh(src); },
  refresh(src) {
    const c = this.val, [r, g, b] = this.rgbOf(c), [H, S, L] = this.hsl;
    const put = (id, v) => { if (id !== src) $(id).value = v; };
    put('#colH', H); put('#colS', S); put('#colLn', L); put('#colR', r); put('#colG', g); put('#colB', b); put('#colHex', c.slice(1).toUpperCase());
    $('#colNow').style.background = c;
    $('#colGrid').querySelectorAll('button').forEach(bt => bt.classList.toggle('on', !this.sys && bt.dataset.c === c && bt.dataset.i == this.COLORS.indexOf(c)));
    $('#colSysBg').classList.toggle('on', this.sys === 'bg'); $('#colSysFg').classList.toggle('on', this.sys === 'fg');
    // 面の十字マーカー
    const cv = $('#colSV'), g2 = cv.getContext('2d'); g2.putImageData(this._sv, 0, 0);
    const x = Math.round(H / 239 * (cv.width - 1)), y = Math.round((1 - S / 240) * (cv.height - 1));
    g2.fillStyle = '#000'; for (const [dx, dy, w, h] of [[-9, -1, 6, 3], [4, -1, 6, 3], [-1, -9, 3, 6], [-1, 4, 3, 6]]) g2.fillRect(x + dx, y + dy, w, h);
    // 明るさバー (上: 白 → 中: 純色 → 下: 黒) と ◀ マーカー
    const lc = $('#colL'), g3 = lc.getContext('2d'), LH = lc.height; g3.clearRect(0, 0, lc.width, LH);
    const lg = g3.createLinearGradient(0, 0, 0, LH); lg.addColorStop(0, '#fff'); lg.addColorStop(0.5, this.hex(...this.hsl2rgb(H, S, 120))); lg.addColorStop(1, '#000');
    g3.fillStyle = lg; g3.fillRect(0, 0, 16, LH); g3.strokeStyle = '#777'; g3.strokeRect(0.5, 0.5, 15, LH - 1);
    const my = Math.round((1 - L / 240) * (LH - 1)); g3.fillStyle = '#000'; g3.beginPath(); g3.moveTo(19, my); g3.lineTo(28, my - 6); g3.lineTo(28, my + 6); g3.closePath(); g3.fill();
  },
  ok() { const cb = this.cb, v = this.val; this.close(); if (cb) cb(v === this.opt.def && !this.opt.value ? null : v); },
  close() { $('#dlgColor').style.display = 'none'; },
};
