/* dictimport.js — ATOK の辞書ファイル(.DIC / .dic)をブラウザ内で解析し、内蔵IME用の辞書に変換して保存する
 *
 *   AtokDic    : 辞書ファイルのデコーダ (tools/atokdic_dump.py の JavaScript 移植)
 *   DictImport : 抽出した単語 → IME 辞書テキスト(コスト・品詞id付き)への変換 (tools/build_dicts.py の移植)
 *   DictStore  : 変換結果を IndexedDB に保存(次回起動時はそこから読む)
 *
 * 辞書データそのものはこのプログラムに含まれない。利用者が自分の辞書ファイルを選ぶと、その PC のブラウザ内だけで
 * 変換・保存される(外部への送信はしない)。
 *
 * 対応形式: 形式1 = "ATOK" (医療辞書'07 など 2005〜2008 年頃の専門用語辞書)、形式2 = "ATOK30" (ATOK 2017 / Pro 4 世代)
 * 構造の説明は tools/atokdic_dump.py の冒頭コメントを参照。
 */
const AtokDic = (() => {
  const u16 = (d, p) => (d[p] << 8) | d[p + 1];
  const s16 = (d, p) => { const v = (d[p] << 8) | d[p + 1]; return v & 0x8000 ? v - 0x10000 : v; };
  const hex2 = (n) => n.toString(16).padStart(2, '0');
  const hexOf = (b) => Array.from(b, hex2).join('');
  const sjis = new TextDecoder('shift_jis', { fatal: true });
  const sjisLoose = new TextDecoder('shift_jis');
  const u16be = new TextDecoder('utf-16be');
  const u16beFatal = new TextDecoder('utf-16be', { fatal: true });

  function varint(b, i) {
    let v = 0, shift = 0;
    for (;;) {
      if (i >= b.length) throw new Error('varint overrun');
      const x = b[i++];
      v += (x & 0x7f) * Math.pow(2, shift);
      if (!(x & 0x80)) return [v, i];
      shift += 7;
      if (shift > 42) throw new Error('varint too long');
    }
  }
  function headerInfo(d) {
    let e = 8; while (e < 16 && d[e]) e++;
    const magic = String.fromCharCode(...d.subarray(8, e));
    let n = 0x40; while (n < 0x80 && d[n]) n++;
    return { magic, name: sjisLoose.decode(d.subarray(0x40, n)) };
  }
  function isAtokDic(d) {
    const sig = [0x44, 0x49, 0x43, 0, 0, 0, 0, 0, 0x41, 0x54, 0x4f, 0x4b];      // "DIC\0\0\0\0\0ATOK"
    return d.length > 0x900 && sig.every((v, i) => d[i] === v);
  }
  function codeTable(d) {
    const inv = new Map();
    for (let b = 0; b < 256; b++) { const c = u16(d, 0x700 + 2 * b); if (!inv.has(c)) inv.set(c, b); }
    return inv;
  }
  /** ブロック(ノード配列+グループ表+単語データ)の先頭位置を全走査で探す */
  function* findBlocks(d) {
    const n = d.length;
    let p = 0x100;
    while (p < n - 16) {
      if (d[p + 6] !== 0 || d[p + 7] !== 0) { p++; continue; }
      const maxnode = u16(d, p), nl = u16(d, p + 2), rb = u16(d, p + 4);
      if (nl < 1 || nl > 4000 || maxnode < nl || maxnode > 0x8000 || rb < 1) { p++; continue; }
      const gt = p + (maxnode + 1) * 4;
      if (gt + 8 * nl + 2 > n) { p++; continue; }
      const base = gt + 8 * nl + 2;
      let ok = true, total = 0;
      const offs = new Array(nl);
      for (let k = 0; k < nl; k++) {
        const off = u16(d, gt + 8 * k + 4), ln = u16(d, gt + 8 * k + 6);
        if (ln < 2 || d[base + off - 2] !== 0 || d[base + off - 1] === 0) { ok = false; break; }   // 直前の 00(件数マーカー) と件数(1以上)
        offs[k] = off * 65536 + ln; total += ln;
      }
      if (!ok) { p++; continue; }
      offs.sort((a, b) => a - b);                    // グループは順不同でもよいが、隙間なく敷き詰められていること
      let expect = 0;
      for (let k = 0; k < nl; k++) { const off = Math.floor(offs[k] / 65536), ln = offs[k] % 65536; if (off !== expect) { ok = false; break; } expect = off + ln; }
      if (!ok) { p++; continue; }
      let nterm = 0;
      for (let i = 2; i <= maxnode; i++) { const q = p + 4 * i; if ((d[q] & 0x80) && (d[q + 2] | d[q + 3])) nterm++; }
      if (nterm !== nl) { p++; continue; }
      yield p;
      p = gt + 8 * nl + expect;
    }
  }
  const kataToHira = (s) => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const hiraToKata = (s) => s.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
  const kanaToHira = (s) => kataToHira(s.normalize('NFKC'));

  /** ブロック内の 終端ノード → 読み を復元して Map(グループ番号 → 読み) を返す */
  function blockReadings(d, p, inv) {
    const maxnode = u16(d, p);
    const readings = new Map();
    const codes = [];
    for (let i = 2; i <= maxnode; i++) {
      const val = s16(d, p + 4 * i), chk = u16(d, p + 4 * i + 2);
      if (val >= 0 || chk === 0) continue;
      codes.length = 0;
      let cur = chk, guard = 0;
      while (cur !== 1 && guard < 64) {
        const c = u16(d, p + 4 * cur + 2);
        codes.push(cur - s16(d, p + 4 * c));
        cur = c; guard++;
      }
      if (cur !== 1) continue;
      let yomi;
      try {
        const raw = new Uint8Array(codes.length);
        for (let k = 0; k < codes.length; k++) { const b = inv.get(codes[codes.length - 1 - k]); if (b === undefined) throw new Error('code'); raw[k] = b; }
        yomi = kanaToHira(sjis.decode(raw));
      } catch (e) { yomi = '?' + codes.slice().reverse().map(c => c.toString(16)).join(','); }
      readings.set(-val, yomi);
    }
    return readings;
  }
  function blockGroups(d, p) {
    const maxnode = u16(d, p), nl = u16(d, p + 2), gt = p + (maxnode + 1) * 4;
    const groups = [];
    for (let k = 0; k < nl; k++) groups.push([u16(d, gt + 8 * k + 4), u16(d, gt + 8 * k + 6)]);
    return { groups, base: gt + 8 * nl + 2 };
  }
  function groupData(d, base, off, ln) {
    const [count, qstart] = varint(d, base + off - 1);
    return { count, g: d.subarray(qstart, Math.max(qstart, base + off + ln - 2)) };
  }
  function wordOf(g, q, wl, yomi) {
    if (wl === 1 && g[q] === 0) return yomi;              // 単語＝読み(ひらがな語)の省略表記
    if (wl === 0) return hiraToKata(yomi);                // 単語＝読みのカタカナ表記の省略表記
    const raw = g.subarray(q, q + wl);
    try { return u16beFatal.decode(raw); } catch (e) { return '<' + hexOf(raw) + '>'; }
  }
  const utf16 = (b) => u16be.decode(b).replace(/\n/g, '／').replace(/\t/g, ' ').replace(/\r/g, '');

  /* ---- 項目リスト(コメント類) ---- */
  function itemFields(item) {
    const fields = [];
    let k = 1, first = true;
    while (k < item.length) {
      const hdr = item[k++];
      let n = hdr & 0x0f;
      if (first && n === 2) n = 1;
      const chunks = [];
      for (let t = 0; t < n; t++) { const [cl, k2] = varint(item, k); chunks.push(item.subarray(k2, k2 + cl)); k = k2 + cl; }
      fields.push(chunks);
      first = false;
      if (!(hdr & 0x10)) break;
    }
    if (k !== item.length) throw new Error('item leftover');
    return fields;
  }
  function parseItem(item) {
    const kind = item[0], out = [];
    if (kind === 0xff) {
      let k = 1;
      while (k < item.length) {
        const ty = item[k]; const [cl, k2] = varint(item, k + 1); const data = item.subarray(k2, k2 + cl); k = k2 + cl;
        if (ty === 0x12) continue;
        out.push(ty === 0x01 || ty === 0x02 ? utf16(data) : '<' + hex2(ty) + ':' + hexOf(data) + '>');
      }
      return out;
    }
    const fields = itemFields(item);
    const text = (chunks) => chunks.map(utf16).join('');
    if (kind === 0x0f || kind === 0x07) { for (const f of fields.slice(1)) out.push(text(f)); }
    else if (kind === 0x01 || kind === 0x08) out.push('正しい読み:' + text(fields[0]));
    else if (kind === 0x02 || kind === 0x03) out.push('本則の読み:' + text(fields[0]));
    else if (kind === 0x04 || kind === 0x1e) { const names = []; for (const f of fields.slice(1)) for (const c of f) names.push(utf16(c)); if (names.length) out.push('一般名称:' + names.join('、')); }
    else if (kind === 0x82) { for (const f of fields.slice(1)) for (const c of f) { const t = utf16(c); if (/[^\x00-\x7f]/.test(t)) out.push('読み:' + t.normalize('NFKC')); } }
    else if (kind === 0x0c) { for (const f of fields.slice(1)) for (const c of f) { const t = utf16(c); if (t.includes('-') && /^\p{Nd}+$/u.test(t.replace(/-/g, ''))) out.push('〒' + t); } }
    return out;
  }
  function parseItemList(g, q, comments) {
    const [l, q2] = varint(g, q); const body = g.subarray(q2, q2 + l);
    let [n, j] = varint(body, 0);
    for (let t = 0; t < n; t++) {
      const [li, j2] = varint(body, j); const item = body.subarray(j2, j2 + li); j = j2 + li;
      try { for (const c of parseItem(item)) comments.push(c); } catch (e) {}
    }
    return q2 + l;
  }

  /* ---- 形式1 ---- */
  const POS_V1 = { 0x01: '名詞', 0x02: '姓', 0x03: '名', 0x04: '人名', 0x05: '地名', 0x06: '組織', 0x07: '固有名詞', 0x09: 'サ変名詞', 0x0e: '副詞', 0x25: '連体詞', 0x27: '形容動詞', 0x29: '文字' };
  function parseGroupV1(g, yomi) {
    let q = 0; const ents = [];
    while (q < g.length) {
      const [wl, q1] = varint(g, q); const word = wordOf(g, q1, wl, yomi); q = q1 + wl;
      if (q + 6 > g.length || g[q] !== 0x03 || g[q + 1] !== 0x01 || g[q + 3] < 2 || g[q + 3] > 4) throw new Error('attr');
      const posc = g[q + 2], f1 = g[q + 4], f2 = g[q + 5]; q += 6;
      let tag = null; const comments = [];
      if (f1 & 0x10) tag = g[q++];
      if (f2 & 0x10) q = parseItemList(g, q, comments);
      ents.push({ yomi, word, pos: POS_V1[posc] || ('品詞' + hex2(posc)), a0: 0, a1: posc, extra: null, tag, cm: comments.join('｜') });
    }
    return ents;
  }

  /* ---- 形式2 ---- */
  const A0_BITS = [[0x80, 1], [0x20, 2], [0x10, 3], [0x08, 3], [0x04, 1], [0x02, 1], [0x01, 1]];
  const a0ExtraLen = (a0) => A0_BITS.reduce((s, [bit, n]) => s + ((a0 & bit) ? n : 0), 0);
  const POS_V2 = {
    0x01: '名詞', 0x08: 'サ変名詞', 0x0a: '名詞(御〜)', 0x0c: '形容動詞', 0x0e: 'サ変名詞/形容動詞', 0x10: '副詞', 0x11: '副詞(〜と)', 0x20: '数詞',
    0x40: '連体詞', 0x42: '接続詞', 0x44: '感動詞', 0x46: '独立語', 0x60: '接頭語', 0x62: '接頭語(数)', 0x64: '接尾語',
    0x80: '動詞語幹(五段)', 0x82: '動詞語幹(一段)', 0x84: '動詞語幹(カ変)', 0x86: '動詞語幹(86)', 0x88: '動詞語幹(88)', 0x8a: '動詞語幹(サ変)',
    0xa0: '形容詞語幹', 0xa2: '形容詞語幹(口語)', 0xc0: '副詞(2)', 0xc2: '形容動詞(タリ)', 0xe0: '単漢字', 0xe1: '記号', 0xf2: '口語', 0xf3: '口語(形容詞)' };
  function posV2(a0, a1, extra, word) {
    if (a1 === 0x02) {
      const s = (a0 & 0x80) && extra.length ? extra[0] : 0;
      if ((s & 0xc0) === 0xc0) return '人名';
      if (s & 0x80) return (s & 0x10) ? '姓/地名' : '姓';
      if (s & 0x40) return '名';
      if (s & 0x20) return '人名(外国)';
      if (s & 0x10) return (s & 0x08) ? '地名/組織' : '地名';
      if (s & 0x08) return '組織';
      if (s & 0x04) return '商品名';
      return '固有名詞';
    }
    if (a1 === 0xe0 && word && /^[\x00-\x7f]+$/.test(word)) return '英単語';
    if (a1 === 0x08 && (a0 & 0x20)) {
      const o = (a0 & 0x80) ? 1 : 0;
      if (extra.length >= o + 2 && (extra[o + 1] & 0x10) && !(extra[o + 1] & 0x04)) return '名詞(時相)';
    }
    return POS_V2[a1] || ('品詞' + hex2(a1));
  }
  function parseEntryV2(g, q, yomi, a0len) {
    const [wl, q1] = varint(g, q); const word = wordOf(g, q1, wl, yomi); q = q1 + wl;
    if (q + 2 > g.length) throw new Error('overrun');
    const a0 = g[q], a1 = g[q + 1]; q += 2;
    let n = a0len.get(a0);
    if (n === undefined) { if (a0 & 0x40) throw new Error('unknown A0'); n = a0ExtraLen(a0); }
    const extra = g.subarray(q, q + n); q += n;
    if (q + 2 > g.length) throw new Error('overrun');
    const f1 = g[q], f2 = g[q + 1]; q += 2;
    if ((f1 & ~0x1b) || (f2 & ~0xf4)) throw new Error('unknown flags');
    let tag = null, l;
    if (f1 & 0x10) tag = g[q++];
    if (f1 & 0x08) q += 2;
    if (f1 & 0x02) { [l, q] = varint(g, q); q += l; }
    if (f1 & 0x01) { [l, q] = varint(g, q); q += l; }
    if (f2 & 0x80) { [l, q] = varint(g, q); q += l; }
    if (f2 & 0x40) { [l, q] = varint(g, q); q += l; }
    const comments = [];
    if (f2 & 0x20) q = parseItemList(g, q, comments);
    if (f2 & 0x10) q = parseItemList(g, q, comments);
    if (f2 & 0x04) { [l, q] = varint(g, q); q += l; }
    if (q > g.length) throw new Error('overrun');
    return [q, { yomi, word, pos: posV2(a0, a1, extra, word), a0, a1, extra, tag, cm: comments.filter(c => c).join('｜') }];
  }
  /** グループを解析。未知の A0 値が出たら、件数どおりに解析できる付加バイト数を探して a0len に記憶する */
  function parseGroupV2(g, yomi, a0len, count) {
    const run = () => { let q = 0; const ents = []; while (q < g.length) { const r = parseEntryV2(g, q, yomi, a0len); q = r[0]; ents.push(r[1]); } return ents; };
    try { return run(); } catch (e) { if (count == null) throw e; }
    const tried = new Set();
    for (;;) {
      let a0 = null, q = 0;
      try {
        while (q < g.length) {
          const [wl, q2] = varint(g, q); const cand = g[q2 + wl];
          if (cand === undefined) break;
          if (!a0len.has(cand) && !tried.has(cand)) { a0 = cand; break; }
          q = parseEntryV2(g, q, yomi, a0len)[0];
        }
      } catch (e) {}
      if (a0 === null) throw new Error('calibration failed');
      tried.add(a0);
      const pred = a0ExtraLen(a0);
      let ok = null;
      for (const n of [pred, 0, 1, 2, 3, 4, 5, 6, 7, 8]) {
        a0len.set(a0, n);
        let ents; try { ents = run(); } catch (e) { continue; }
        if (ents.length === count) { ok = n; break; }
      }
      if (ok === null) { a0len.delete(a0); throw new Error('calibration failed'); }
      try { return run(); } catch (e) { continue; }
    }
  }
  function parseGroup(fmt, g, yomi, a0len, count) { return fmt === 1 ? parseGroupV1(g, yomi) : parseGroupV2(g, yomi, a0len, count); }

  function detectFormat(d, p, inv, magic) {
    const order = magic.startsWith('ATOK30') ? [2, 1] : [1, 2];
    if (p == null) return order[0];
    const readings = blockReadings(d, p, inv), { groups, base } = blockGroups(d, p);
    for (const v of order) {
      const a0len = new Map(); let ok = true;
      for (let gi = 0; gi < groups.length; gi++) {
        try { const { count, g } = groupData(d, base, groups[gi][0], groups[gi][1]); if (parseGroup(v, g, readings.get(gi + 1) || '?', a0len, count).length !== count) { ok = false; break; } }
        catch (e) { ok = false; break; }
      }
      if (ok) return v;
    }
    return order[0];
  }
  function decodeBlock(d, p, inv, fmt, a0len, stats, out) {
    const readings = blockReadings(d, p, inv), { groups, base } = blockGroups(d, p);
    // 先頭グループがまったく解析できないブロックは、更新で残った未使用領域の残骸なので読み飛ばす
    let probe = [];
    try { const { count, g } = groupData(d, base, groups[0][0], groups[0][1]); probe = parseGroup(fmt, g, readings.get(1) || '?', new Map(a0len), count); } catch (e) {}
    if (!probe.length) { stats.stale++; return; }
    for (let gi = 0; gi < groups.length; gi++) {
      let ents = [], count = -1;
      try { const gd = groupData(d, base, groups[gi][0], groups[gi][1]); count = gd.count; ents = parseGroup(fmt, gd.g, readings.get(gi + 1) || '?', a0len, count); }
      catch (e) { ents = []; stats.errors++; }
      if (ents.length !== count) stats.mismatch++;
      for (const e of ents) out.push(e);
    }
  }
  /** 辞書ファイル(Uint8Array)を解析して単語の配列を返す。 onProgress(0..1) は任意 */
  async function decode(d, onProgress) {
    if (!isAtokDic(d)) throw new Error('ATOK の辞書ファイルではありません');
    const { magic, name } = headerInfo(d);
    const inv = codeTable(d);
    const stats = { blocks: 0, stale: 0, errors: 0, mismatch: 0 };
    const entries = [], a0len = new Map();
    let fmt = null, lastYield = Date.now();
    for (const p of findBlocks(d)) {
      if (fmt === null) fmt = detectFormat(d, p, inv, magic);
      stats.blocks++;
      decodeBlock(d, p, inv, fmt, a0len, stats, entries);
      if (Date.now() - lastYield > 80) { onProgress && onProgress(p / d.length); await new Promise(r => setTimeout(r, 0)); lastYield = Date.now(); }
    }
    return { magic, name, format: fmt || (magic.startsWith('ATOK30') ? 2 : 1), entries, stats };
  }
  return { decode, headerInfo, isAtokDic, kataToHira, hiraToKata };
})();

/* ================================================================== 変換 (単語 → IME 辞書テキスト) */
const DictImport = {
  cal: null, _calWait: null,

  /* 辞書の種類(ヘッダーの辞書名で判定)。 on: 取り込み直後の既定 ON/OFF */
  KINDS: [
    { m: /^標準辞書/,              id: 'atok_std', on: true,  note: '一般語・地名・人名・活用形(語幹から生成)。主辞書' },
    { m: /^人名辞書/,              id: 'atok_nm',  on: true,  note: '姓・名' },
    { m: /^単漢字辞書/,            id: 'atok_tk',  on: true,  note: '単漢字(印刷標準字体の注記付き)' },
    { m: /^記号辞書/,              id: 'atok_kg',  on: true,  note: '「きごう」「かっこ」「やじるし」などで記号' },
    { m: /^トレンド辞書/,          id: 'atok_tr',  on: true,  note: '新語・商品名・人名' },
    { m: /^人文科学用語辞書/,      id: 'atok_cs',  on: true,  note: '' },
    { m: /^理工学用語辞書/,        id: 'atok_se',  on: true,  note: '' },
    { m: /^法律経済用語辞書/,      id: 'atok_le',  on: true,  note: '' },
    { m: /^カタカナ語英語辞書/,    id: 'atok_ke',  on: false, note: 'カタカナ語の読みから英語綴りに変換(候補に英語が混じる)' },
    { m: /^日本語英語辞書/,        id: 'atok_je',  on: false, note: '日本語の読みから英単語に変換' },
    { m: /^町名住所変換辞書/,      id: 'atok_ac',  on: false, note: '町名の読みから都道府県付きの住所に変換' },
    { m: /^郵便番号辞書[：:]事業所/, id: 'atok_yc', on: false, zip: true, note: '大口事業所の個別郵便番号から事業所名・住所に変換' },
    { m: /^郵便番号辞書/,          id: 'atok_y7',  on: false, zip: true, note: '郵便番号(例: 100ー0001)から住所に変換' },
    { m: /^医療辞書.*メイン/,      id: 'med_main',  on: false, med: 6000, note: '医療用語。ON にすると同音語で医療語が優先されます' },
    { m: /^医療辞書.*薬品/,        id: 'med_drug',  on: false, med: 7000, note: '薬品名' },
    { m: /^医療辞書.*先発後発/,    id: 'med_gen',   on: false, med: 7200, note: '先発品・後発品' },
    { m: /^医療辞書.*ICD/,         id: 'med_icd',   on: false, med: 7000, note: 'ICD10 病名(コード付き)' },
    { m: /^医療辞書.*識別/,        id: 'med_ident', on: false, med: 7000, note: '識別コード' },
    { m: /^医療辞書.*和英/,        id: 'med_je',    on: false, med: 7400, note: '医学用語の和英' },
  ],
  REJECT: /文字コード|IVS辞書|部首変換|文書学習/,

  ID: { noun: 1851, sahen: 1841, keiyodo: 1931, adv: 12, rentai: 2659, num: 2043, soshiki: 1929, koyu: 1920, kigou: 2644 },
  ID_NAMES: { adv_noun: '名詞,副詞可能,*,*,*,*,*', setsuzoku: '接続詞,*,*,*,*,*,*', kandou: '感動詞,*,*,*,*,*,*', prefix: '接頭詞,名詞接続,*,*,*,*,*', suffix: '名詞,接尾,一般,*,*,*,*',
    sei: '名詞,固有名詞,人名,姓,*,*,*', mei: '名詞,固有名詞,人名,名,*,*,*', jinmei: '名詞,固有名詞,人名,一般,*,*,*', chimei: '名詞,固有名詞,地域,一般,*,*,*' },
  POS: {
    '名詞': ['noun', 6500], '名詞(御〜)': ['noun', 6800], '独立語': ['noun', 6800], '単漢字': ['noun', 7800],
    'サ変名詞': ['sahen', 6500], 'サ変名詞/形容動詞': ['sahen', 6500], '名詞(時相)': ['adv_noun', 6300],
    '形容動詞': ['keiyodo', 6500], '形容動詞(タリ)': ['keiyodo', 7000], '副詞': ['adv', 6000], '副詞(〜と)': ['adv', 6200], '副詞(2)': ['adv', 6200],
    '連体詞': ['rentai', 5800], '接続詞': ['setsuzoku', 5800], '感動詞': ['kandou', 6200], '接頭語': ['prefix', 6200], '接頭語(数)': ['prefix', 6500], '接尾語': ['suffix', 6200], '数詞': ['num', 7000],
    '姓': ['sei', 7000], '姓/地名': ['sei', 7000], '名': ['mei', 7200], '人名': ['jinmei', 7000], '人名(外国)': ['jinmei', 7200],
    '地名': ['chimei', 7300], '地名/組織': ['chimei', 7300], '組織': ['soshiki', 7000], '商品名': ['koyu', 7200], '固有名詞': ['koyu', 7000],
    '英単語': ['noun', 7500], '記号': ['kigou', 8000], '住所': ['chimei', 8000] },
  POS_MED: { '名詞': 1851, '固有名詞': 1920, 'サ変名詞': 1841, '組織': 1929, '形容動詞': 1931, '連体詞': 2659, '副詞': 12 },
  GODAN: {
    0x01: [{ '基本形': 'う', '未然形': 'わ', '未然ウ接続': 'お', '連用形': 'い', '連用タ接続': 'っ', '仮定形': 'え', '命令ｅ': 'え' }, '五段・ワ行促音便'],
    0x02: [{ '基本形': 'く', '未然形': 'か', '未然ウ接続': 'こ', '連用形': 'き', '連用タ接続': 'い', '仮定形': 'け', '命令ｅ': 'け' }, '五段・カ行イ音便'],
    0x0c: [{ '基本形': 'く', '未然形': 'か', '未然ウ接続': 'こ', '連用形': 'き', '連用タ接続': 'っ', '仮定形': 'け', '命令ｅ': 'け' }, '五段・カ行促音便ユク'],
    0x03: [{ '基本形': 'ぐ', '未然形': 'が', '未然ウ接続': 'ご', '連用形': 'ぎ', '連用タ接続': 'い', '仮定形': 'げ', '命令ｅ': 'げ' }, '五段動詞'],
    0x04: [{ '基本形': 'す', '未然形': 'さ', '未然ウ接続': 'そ', '連用形': 'し', '仮定形': 'せ', '命令ｅ': 'せ' }, '五段動詞'],
    0x05: [{ '基本形': 'つ', '未然形': 'た', '未然ウ接続': 'と', '連用形': 'ち', '連用タ接続': 'っ', '仮定形': 'て', '命令ｅ': 'て' }, '五段動詞'],
    0x06: [{ '基本形': 'ぬ', '未然形': 'な', '未然ウ接続': 'の', '連用形': 'に', '連用タ接続': 'ん', '仮定形': 'ね', '命令ｅ': 'ね' }, '五段動詞'],
    0x07: [{ '基本形': 'ぶ', '未然形': 'ば', '未然ウ接続': 'ぼ', '連用形': 'び', '連用タ接続': 'ん', '仮定形': 'べ', '命令ｅ': 'べ' }, '五段動詞'],
    0x08: [{ '基本形': 'む', '未然形': 'ま', '未然ウ接続': 'も', '連用形': 'み', '連用タ接続': 'ん', '仮定形': 'め', '命令ｅ': 'め' }, '五段動詞'],
    0x09: [{ '基本形': 'る', '未然形': 'ら', '未然ウ接続': 'ろ', '連用形': 'り', '連用タ接続': 'っ', '仮定形': 'れ', '命令ｅ': 'れ' }, '五段動詞'],
    0x0b: [{ '基本形': 'う', '未然形': 'わ', '未然ウ接続': 'お', '連用形': 'い', '連用タ接続': 'う', '仮定形': 'え', '命令ｅ': 'え' }, '五段・ワ行ウ音便'] },
  ICHIDAN: { '基本形': 'る', '未然形': '', '連用形': '', '仮定形': 'れ', '命令ｒｏ': 'ろ', '命令ｙｏ': 'よ', '未然ウ接続': 'よ' },
  KEIYOSHI: { '基本形': 'い', '連用テ接続': 'く', '連用タ接続': 'かっ', '仮定形': 'けれ', '未然ウ接続': 'かろ', 'ガル接続': '' },

  kindOf(name) {
    if (this.REJECT.test(name)) return null;
    const k = this.KINDS.find(x => x.m.test(name));
    if (k) return k;
    let h = 0; for (const c of name) h = (h * 31 + c.codePointAt(0)) >>> 0;
    return { id: 'imp_' + h.toString(36), on: true, note: '', zip: /郵便番号/.test(name), generic: true };
  },

  /* ---- コスト校正表 (Mozc 全語)。取り込み時だけ dict/mozc_cal.js を読み込む ---- */
  loadCalGz(b64) {
    this._calLoading = (async () => {
      const text = new TextDecoder('utf-8').decode(await IMEDICT._gunzip(IMEDICT._b64ToBytes(b64)));
      const map = new Map();
      let s = 0;
      while (s < text.length) { let e = text.indexOf('\n', s); if (e < 0) e = text.length; const t = text.indexOf('\t', s); if (t > s && t < e) map.set(text.substring(s, t), text.substring(t + 1, e)); s = e + 1; }
      this.cal = map;
    })();
  },
  ensureCal() {
    if (this.cal) return Promise.resolve();
    if (!this._calWait) this._calWait = new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = 'dict/mozc_cal.js';
      s.onload = () => { (this._calLoading || Promise.reject(new Error('mozc_cal.js が不正です'))).then(resolve, reject); };
      s.onerror = () => reject(new Error('dict/mozc_cal.js を読み込めません'));
      document.head.appendChild(s);
    }).finally(() => { if (!this.cal) this._calWait = null; });
    return this._calWait;
  },
  releaseCal() { this.cal = null; this._calWait = null; this._calLoading = null; const s = document.querySelector('script[src="dict/mozc_cal.js"]'); if (s) s.remove(); },
  /** (読み, 表記) が Mozc 辞書にあれば [lid, rid, cost] */
  calLookup(key, w) {
    const line = this.cal && this.cal.get(key);
    if (!line) return null;
    let p = 0;
    while (p < line.length) {
      let e = line.indexOf('\t', p); if (e < 0) e = line.length;
      const c1 = line.indexOf(':', p), c2 = line.indexOf(':', c1 + 1);
      if (e - c2 - 1 === w.length && line.startsWith(w, c2 + 1)) {
        const idp = line.substring(p, c1), sl = idp.indexOf('/');
        const l = +(sl < 0 ? idp : idp.substring(0, sl));
        return [l, sl < 0 ? l : +idp.substring(sl + 1), +line.substring(c1 + 1, c2)];
      }
      p = e + 1;
    }
    return null;
  },
  normReading(y) {
    return AtokDic.kataToHira(y.normalize('NFKC')).replace(/[A-Z]/g, c => c.toLowerCase());
  },
  _posIds() {
    if (this._ids) return this._ids;
    const byName = new Map(); IMEDICT.pos.forEach((s, i) => { if (!byName.has(s)) byName.set(s, i); });
    const ids = Object.assign({}, this.ID);
    for (const [k, name] of Object.entries(this.ID_NAMES)) { if (!byName.has(name)) throw new Error('品詞表に ' + name + ' がありません'); ids[k] = byName.get(name); }
    this._byName = byName; this._ids = ids; this._vid = new Map();
    return ids;
  },
  _verbId(cls, form, pos) {
    const k = pos + cls + form; let v = this._vid.get(k);
    if (v === undefined) { v = this._byName.get(`${pos},*,*,${cls},${form},*`); if (v === undefined) v = this._byName.get(`${pos},*,*,五段動詞,${form},*`); this._vid.set(k, v); }
    return v;
  },

  /** 抽出した単語 → 辞書テキスト(1行1読み)。 戻り値 { text, entries } */
  async build(dec, kind, onProgress) {
    const ids = this._posIds();
    const table = new Map(), seen = new Set();
    const cplen = (w) => { let n = 0; for (const _ of w) n++; return n; };
    const add = (key, w, l, r, c, cm) => {
      if (!key || !w) return;
      const sk = key + '\t' + w; if (seen.has(sk)) return; seen.add(sk);
      let a = table.get(key); if (!a) table.set(key, a = []);
      a.push([l, r, c, w, cm]);
    };
    const calibrated = (key, w, lid, base, per, maxlen) => this.calLookup(key, w) || [lid, lid, Math.max(2500, base - per * Math.min(cplen(w), maxlen))];
    const addr = /郵便番号|住所/.test(dec.name);
    const medBase = kind.med || (dec.format === 1 ? 6500 : 0);
    let lastYield = Date.now(), i = 0;
    for (const e of dec.entries) {
      if (++i % 2000 === 0 && Date.now() - lastYield > 80) { onProgress && onProgress(i / dec.entries.length); await new Promise(r => setTimeout(r, 0)); lastYield = Date.now(); }
      const y = e.yomi, w = e.word; let pos = addr ? '住所' : e.pos;
      if (/[\n\t\r]/.test(w) || /[\n\t\r]/.test(y)) continue;
      if (medBase) {                                    // 形式1 の専門用語辞書(医療辞書など)
        const key = this.normReading(y.replace(/・/g, ''));
        if (!key || !w || seen.has(key + '\t' + w)) continue;
        let cost = Math.max(2000, medBase - 60 * Math.min(cplen(w), 12));
        if (/\([A-Z]\p{Nd}/u.test(w)) cost += 1000;
        const m = this.calLookup(key, w);
        let lid, rid;
        if (m) { lid = m[0]; rid = m[1]; cost = Math.min(cost - 300, Math.max(1000, m[2] - 900)); }
        else lid = rid = this.POS_MED[pos] || 1851;
        add(key, w, lid, rid, cost, e.cm);
        continue;
      }
      if (pos.startsWith('動詞語幹') || pos === '形容詞語幹') {      // 語幹から活用形を生成
        let forms = null, cls, vpos = '動詞,自立';
        if (pos === '動詞語幹(五段)') { const row = (e.a0 & 0x80) && e.extra && e.extra.length ? this.GODAN[e.extra[0]] : null; if (row) { forms = row[0]; cls = row[1]; } }
        else if (pos === '動詞語幹(一段)') { forms = this.ICHIDAN; cls = '一段'; }
        else if (pos === '形容詞語幹') { forms = this.KEIYOSHI; cls = (y && 'きしちにひみりぎじぢびぴ'.includes(y[y.length - 1])) ? '形容詞・イ段' : '形容詞・アウオ段'; vpos = '形容詞,自立'; }
        if (forms) for (const [form, k] of Object.entries(forms)) {
          const key = this.normReading(y + k), rw = w + k;
          const [l, r, c] = calibrated(key, rw, this._verbId(cls, form, vpos), 6800, 40, 12);
          add(key, rw, l, r, c, '');
        }
        continue;
      }
      const pc = this.POS[pos];
      if (!pc) continue;                                // 口語形・カ変/サ変語幹など
      let key = this.normReading(y);
      if (kind.zip) key = key.replace(/-/g, 'ー');      // かな入力時にハイフンは「ー」になる
      if (!key) continue;
      let [l, r, cost] = calibrated(key, w, ids[pc[0]], pc[1], 50, 10);
      if (pos === '単漢字' && e.tag === 0x40) cost += 500;      // 非印刷標準字体は後ろに
      if (pos === '記号' && !e.cm) cost += 200;
      add(key, w, l, r, cost, e.cm);
    }
    const keys = Array.from(table.keys()).sort();
    const lines = new Array(keys.length);
    let n = 0;
    for (let k = 0; k < keys.length; k++) {
      const items = table.get(keys[k]); items.sort((a, b) => a[2] - b[2]); n += items.length;
      lines[k] = keys[k] + '\t' + items.map(([l, r, c, w, cm]) => l + (r !== l ? '/' + r : '') + ':' + c + ':' + w + (cm ? '\x1f' + cm : '')).join('\t');
    }
    return { text: lines.join('\n'), entries: n };
  },

  /** 辞書ファイル1つを取り込む。 戻り値: メタ情報 {id,label,entries,size,on,note,...}。 onStatus(文字列) は進捗表示用 */
  async importFile(file, onStatus) {
    const st = (s) => onStatus && onStatus(`${file.name}: ${s}`);
    st('読み込み中…');
    const d = new Uint8Array(await file.arrayBuffer());
    if (!AtokDic.isAtokDic(d)) throw new Error('ATOK の辞書ファイル(.DIC)ではありません');
    const head = AtokDic.headerInfo(d);
    const kind = this.kindOf(head.name);
    if (!kind) throw new Error(`「${head.name}」はかな漢字変換用の辞書ではないため取り込めません`);
    st('コスト表を準備中…'); await this.ensureCal();
    const dec = await AtokDic.decode(d, (r) => st(`解析中… ${Math.round(r * 100)}%`));
    if (!dec.entries.length) throw new Error(`「${head.name}」から単語を取り出せませんでした(空の辞書か、未対応の形式です)`);
    const built = await this.build(dec, kind, (r) => st(`変換中… ${Math.round(r * 100)}%`));
    if (!built.entries) throw new Error(`「${head.name}」に登録できる単語がありません`);
    st('保存中…');
    const meta = { id: kind.id, label: 'ATOK ' + head.name.replace(/^医療辞書07/, '医療辞書07 '), entries: built.entries, size: built.text.length, on: kind.on, note: kind.note || '',
      imported: true, src: file.name, words: dec.entries.length, format: dec.format, date: new Date().toISOString().slice(0, 10) };
    if (/^医療辞書/.test(head.name)) meta.label = head.name.replace(/^医療辞書07/, '医療辞書07 ');
    await DictStore.put(meta, built.text);
    return { meta, text: built.text, stats: dec.stats };
  },
};

/* ================================================================== 保存 (IndexedDB) */
const DictStore = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('このブラウザは IndexedDB を使えません'));
      const rq = indexedDB.open('jpime_dicts', 1);
      rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' }); if (!db.objectStoreNames.contains('text')) db.createObjectStore('text'); };
      rq.onsuccess = () => { this._db = rq.result; resolve(this._db); };
      rq.onerror = () => reject(rq.error || new Error('IndexedDB を開けません'));
    });
  },
  async _tx(stores, mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode); let result;
      tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('保存できませんでした(容量不足の可能性)'));
      result = fn(tx);
    });
  },
  async list() { let rq; await this._tx(['meta'], 'readonly', tx => { rq = tx.objectStore('meta').getAll(); }); return rq.result || []; },
  async text(id) { let rq; await this._tx(['text'], 'readonly', tx => { rq = tx.objectStore('text').get(id); }); return rq.result || null; },
  put(meta, text) { return this._tx(['meta', 'text'], 'readwrite', tx => { tx.objectStore('meta').put(meta); tx.objectStore('text').put(text, meta.id); }); },
  remove(id) { return this._tx(['meta', 'text'], 'readwrite', tx => { tx.objectStore('meta').delete(id); tx.objectStore('text').delete(id); }); },
};
