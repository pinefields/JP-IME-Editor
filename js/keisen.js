/* keisen.js — 罫線描画 (OASYS 風): 修飾キー + 矢印キーで、カーソルを動かしながらテキストの罫線を引く・消す
 *
 *   Alt+矢印        細線を引く   ─│┌┐└┘├┤┬┴┼
 *   Alt+Shift+矢印  太線を引く   ━┃┏┓┗┛┣┫┳┻╋   (細線との交差は ┿╂┠┨┯┷ などを自動選択)
 *   Alt+Ctrl+矢印   罫線を消す
 *   半角罫線モードでは + - | で描く。
 *
 * しくみ: 画面の桁(半角=1, 全角=2)で考える。罫線文字は「上下左右の腕」(0=なし, 1=細, 2=太)の組で表し、
 *         A から B へ動くとき A の進行方向の腕と B の逆方向の腕を立てて(消去なら倒して)、腕の組に合う文字に置き換える。
 */
const Keisen = {
  // 文字 → [上, 下, 左, 右]
  CH: { '─': [0, 0, 1, 1], '│': [1, 1, 0, 0], '┌': [0, 1, 0, 1], '┐': [0, 1, 1, 0], '┘': [1, 0, 1, 0], '└': [1, 0, 0, 1], '├': [1, 1, 0, 1], '┬': [0, 1, 1, 1], '┤': [1, 1, 1, 0], '┴': [1, 0, 1, 1], '┼': [1, 1, 1, 1],
        '━': [0, 0, 2, 2], '┃': [2, 2, 0, 0], '┏': [0, 2, 0, 2], '┓': [0, 2, 2, 0], '┛': [2, 0, 2, 0], '┗': [2, 0, 0, 2], '┣': [2, 2, 0, 2], '┳': [0, 2, 2, 2], '┫': [2, 2, 2, 0], '┻': [2, 0, 2, 2], '╋': [2, 2, 2, 2],
        '┠': [2, 2, 0, 1], '┯': [0, 1, 2, 2], '┨': [2, 2, 1, 0], '┷': [1, 0, 2, 2], '┿': [1, 1, 2, 2], '┝': [1, 1, 0, 2], '┰': [0, 2, 1, 1], '┥': [1, 1, 2, 0], '┸': [2, 0, 1, 1], '╂': [2, 2, 1, 1] },
  DIR: { up: 0, down: 1, left: 2, right: 3 }, OPP: [1, 0, 3, 2],
  _byKey: null,
  charOf(arms) {
    if (!this._byKey) { this._byKey = new Map(); for (const [c, a] of Object.entries(this.CH)) this._byKey.set(a.join(''), c); }
    const a = arms.slice(), n = a.filter(x => x).length;
    if (n === 0) return null;
    if (n === 1) { const i = a.findIndex(x => x); a[this.OPP[i]] = a[i]; }        // 腕 1 本だけ → 直線にする
    const hit = this._byKey.get(a.join(''));
    if (hit) return hit;
    let best = null, bd = 99;                                                        // JIS にない太細の組み合わせ → 形が同じで最も近いもの
    for (const [c, b] of Object.entries(this.CH)) { if (b.some((x, i) => !!x !== !!a[i])) continue; const d = b.reduce((s, x, i) => s + Math.abs(x - a[i]), 0); if (d < bd) { bd = d; best = c; } }
    return best;
  },
  /** 行 → 桁ごとの配列 (全角文字は [文字, null]、タブは空白に展開) */
  toCols(line, tabW) {
    const arr = [];
    for (const ch of line) {
      if (ch === '\t') { const n = tabW - (arr.length % tabW); for (let i = 0; i < n; i++) arr.push(' '); continue; }
      arr.push(ch); if (JP.charWidth(ch) === 2) arr.push(null);
    }
    return arr;
  },
  fromCols(arr) { return arr.filter(c => c !== null).join(''); },
  colOfIndex(line, idx, tabW) { return this.toCols(line.substring(0, idx), tabW).length; },
  indexOfCol(arr, col) { let n = 0; for (let i = 0; i < col && i < arr.length; i++) if (arr[i] !== null) n += arr[i].length; return n; },
  get(arr, col) { const c = arr[col]; return c == null ? '' : c; },
  /** col から w 桁を s (幅 w の文字 or 空白 w 個) にする。またがる全角文字の残り半分は空白にする */
  put(arr, col, w, s) {
    while (arr.length < col + w) arr.push(' ');
    if (arr[col] === null) arr[col - 1] = ' ';
    if (arr[col + w] === null) arr[col + w] = ' ';
    if (s === null) { for (let i = 0; i < w; i++) arr[col + i] = ' '; return; }
    arr[col] = s; for (let i = 1; i < w; i++) arr[col + i] = null;
  },
  /** 1 歩進めて罫線を引く(mode 1=細線, 2=太線)・消す(mode 0)。 dir: 'up' | 'down' | 'left' | 'right' */
  step(ed, dir, mode) {
    const half = !!Settings.data.keisenHalf, W = half ? 1 : 2, tabW = Settings.data.tabWidth || 4, doc = ed.doc;
    const d = this.DIR[dir], vert = d < 2, la = ed.cur.line;
    let ca = this.colOfIndex(doc.lines[la], ed.cur.col, tabW);
    const A = this.toCols(doc.lines[la], tabW);
    if (A[ca] === null) ca--;                                   // 全角文字の途中にいたら、その文字の先頭へ
    const lb = la + (dir === 'up' ? -1 : dir === 'down' ? 1 : 0), cb = ca + (dir === 'left' ? -W : dir === 'right' ? W : 0);
    if (lb < 0 || cb < 0) return;
    const newLine = lb >= doc.lines.length;
    const B = vert ? this.toCols(newLine ? '' : doc.lines[lb], tabW) : A;
    const rows = new Map([[la, A]]); if (vert) rows.set(lb, B);
    const rowOf = (l) => rows.get(l) || (l >= 0 && l < doc.lines.length ? this.toCols(doc.lines[l], tabW) : null);
    // (l, col) の文字の k 方向の隣に、こちら向きの腕があるか
    const connected = (l, col, k) => {
      const nl = l + (k === 0 ? -1 : k === 1 ? 1 : 0), nc = col + (k === 2 ? -2 : k === 3 ? 2 : 0);
      const r = rowOf(nl); if (!r || nc < 0) return false;
      const a = this.CH[this.get(r, nc)];
      return !!(a && a[this.OPP[k]]);
    };
    const edit = (arr, col, arm) => {
      const cur = this.get(arr, col);
      if (half) {
        if (mode === 0) { if (arm === d && '+-|'.includes(cur) && cur) this.put(arr, col, 1, null); return; }
        const want = vert ? '|' : '-', cross = vert ? '-' : '|';
        this.put(arr, col, 1, (cur === '+' || cur === cross) ? '+' : want);
        return;
      }
      const base = this.CH[cur], arms = base ? base.slice() : [0, 0, 0, 0];
      // 直線の文字(─│━┃)は「腕 1 本だけ」の端でも直線として表示しているので、隣とつながっていない腕は無いものとして扱う
      // (こうしないと、線の端から直角に曲げたとき ┌ でなく ┬ になってしまう)
      if (base && base.filter(x => x).length === 2 && ((base[0] && base[1]) || (base[2] && base[3]))) {
        for (let k = 0; k < 4; k++) if (arms[k] && k !== arm && !connected(arr === A ? la : lb, col, k)) arms[k] = 0;
      }
      arms[arm] = mode;
      const ch = this.charOf(arms);
      if (ch) this.put(arr, col, 2, ch);
      else if (base) this.put(arr, col, 2, null);             // 腕がなくなった罫線文字 → 空白。罫線以外の文字は消さない
    };
    edit(A, ca, d); edit(B, cb, this.OPP[d]);
    const trim = (arr) => { const s = this.fromCols(arr); return mode === 0 ? s.replace(/[ 　]+$/, m => (/\S/.test(s) ? '' : m)) : s; };
    const l0 = Math.min(la, lb), l1 = newLine ? la : Math.max(la, lb);
    const out = vert ? (lb < la ? [trim(B), trim(A)] : [trim(A), trim(B)]) : [trim(A)];
    doc.replaceRange({ line: l0, col: 0 }, { line: l1, col: doc.lines[l1].length }, out.join('\n'));
    const lineB = doc.lines[lb], arrB = this.toCols(lineB, tabW);
    while (arrB.length < cb) arrB.push(' ');
    if (lineB.length < this.fromCols(arrB).length) doc.replaceRange({ line: lb, col: lineB.length }, { line: lb, col: lineB.length }, ' '.repeat(this.fromCols(arrB).length - lineB.length), true, 'keisen-pad');
    ed.cur = { line: lb, col: this.indexOfCol(arrB, cb) };
    ed.anchor = null; ed.selMode = false;
  },
  /** 表の行を挿入: カーソル行の縦線(下に続く線)を引き継いだ空の行を、すぐ下に作る */
  insertRow(ed) {
    const tabW = Settings.data.tabWidth || 4, doc = ed.doc, l = ed.cur.line, arr = this.toCols(doc.lines[l], tabW), out = [];
    let any = false;
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i]; if (c === null) continue;
      const a = this.CH[c];
      if (a && a[1]) { out.push(a[1] === 2 ? '┃' : '│'); any = true; }
      else if (c === '|' || c === '+') { out.push('|'); any = true; }
      else out.push(JP.charWidth(c) === 2 ? '　' : ' ');
    }
    if (!any) return false;
    doc.replaceRange({ line: l, col: doc.lines[l].length }, { line: l, col: doc.lines[l].length }, '\n' + out.join('').replace(/[ 　]+$/, ''));
    ed.cur = { line: l + 1, col: Math.min(ed.cur.col, doc.lines[l + 1].length) }; ed.anchor = null;
    return true;
  },
};
