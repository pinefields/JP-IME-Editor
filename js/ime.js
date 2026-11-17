/* ============================================================================
 *  ime.js  --  ブラウザ内日本語IMEエンジン
 *   - 辞書ストア IMEDICT (読み→項目、接続コスト表、品詞表)   ※辞書は dict/*.js が登録
 *   - ローマ字かな変換 (ATOK準拠)
 *   - 形態素解析ベースの連文節変換 (ラティス + Viterbi、Mozc互換のコスト体系)
 *   - 文節の候補列挙 / 伸縮 / 部分確定、学習、ユーザー辞書、推測変換
 * ========================================================================== */
'use strict';

/* ---------------------------------------------------------------- 辞書ストア */
const IMEDICT = {
  dicts: new Map(),          // id -> {id,label,n,map:Map<reading,string>,keys:string[]|null}
  list: [],                  // manifest
  enabled: new Set(),
  conn: null, connN: 0, connScale: 64,
  pos: [],
  _pending: 0, _waiters: [],
  _cache: new Map(),

  manifest(list) { this.list = list; },
  loadPos(arr) { this.pos = arr; },

  _b64ToBytes(b64) {
    const bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
  async _gunzip(bytes) {
    if (typeof DecompressionStream === 'undefined')
      throw new Error('このブラウザは DecompressionStream に対応していません(Chrome/Edge 80以降が必要)');
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  },
  _begin() { this._pending++; },
  _end() { this._pending--; if (this._pending === 0) { const w = this._waiters; this._waiters = []; w.forEach(f => f()); } },
  whenIdle() { return this._pending === 0 ? Promise.resolve() : new Promise(r => this._waiters.push(r)); },

  async loadGz(id, label, n, b64) {
    this._begin();
    try {
      const bytes = await this._gunzip(this._b64ToBytes(b64));
      const text = new TextDecoder('utf-8').decode(bytes);
      this.load(id, label, n, text);
    } catch (e) { console.error('辞書読み込み失敗', id, e); IMEDICT.onError && IMEDICT.onError(id, e); }
    this._end();
  },
  load(id, label, n, text) {
    const map = new Map();
    let s = 0;
    while (s < text.length) {
      let e = text.indexOf('\n', s); if (e < 0) e = text.length;
      const t = text.indexOf('\t', s);
      if (t > s && t < e) map.set(text.substring(s, t), text.substring(t + 1, e));
      s = e + 1;
    }
    this.dicts.set(id, { id, label, n, map, keys: null });
    this._cache.clear();
    this.onLoaded && this.onLoaded(id);
  },
  async loadConnectionGz(n, scale, b64) {
    this._begin();
    try {
      this.conn = await this._gunzip(this._b64ToBytes(b64));
      this.connN = n; this.connScale = scale;
    } catch (e) { console.error('接続表読み込み失敗', e); IMEDICT.onError && IMEDICT.onError('connection', e); }
    this._end();
  },
  setEnabled(id, on) { if (on) this.enabled.add(id); else this.enabled.delete(id); this._cache.clear(); },

  /** 接続コスト (右文脈id r → 左文脈id l) */
  connCost(r, l) {
    if (!this.conn) return 0;
    return this.conn[r * this.connN + l] * this.connScale;
  },
  posOf(id) { return this.pos[id] || ''; },

  /** 読みで検索。 戻り値: [{s:表記,l,r,c,cm:コメント,d:辞書id}] */
  lookup(reading) {
    const hit = this._cache.get(reading);
    if (hit) return hit;
    const out = [];
    for (const d of this.dicts.values()) {
      if (!this.enabled.has(d.id)) continue;
      const line = d.map.get(reading);
      if (!line) continue;
      for (const item of line.split('\t')) {
        // item = l[/r]:c:surface[\x1f comment]
        const c1 = item.indexOf(':'), c2 = item.indexOf(':', c1 + 1);
        if (c1 < 0 || c2 < 0) continue;
        const idpart = item.substring(0, c1), sl = idpart.indexOf('/');
        const l = +(sl < 0 ? idpart : idpart.substring(0, sl));
        const r = sl < 0 ? l : +idpart.substring(sl + 1);
        const c = +item.substring(c1 + 1, c2);
        let s = item.substring(c2 + 1), cm = '';
        const us = s.indexOf('\x1f');
        if (us >= 0) { cm = s.substring(us + 1); s = s.substring(0, us); }
        out.push({ s, l, r, c, cm, d: d.id });
      }
    }
    if (this._cache.size > 20000) this._cache.clear();
    this._cache.set(reading, out);
    return out;
  },
  _keysOf(d) {
    if (!d.keys) { d.keys = Array.from(d.map.keys()); d.keys.sort(); }
    return d.keys;
  },
  /* ---- 逆引き(表記 → 読み): 確定済み文字列・音声入力結果の「再変換」用。初回に有効な辞書から構築する ---- */
  _rev: null, _revKey: '',
  _reverseIndex() {
    const key = Array.from(this.enabled).sort().join(',');
    if (this._rev && this._revKey === key) return this._rev;
    const rev = new Map();      // surface -> [reading, cost]
    for (const d of this.dicts.values()) {
      if (!this.enabled.has(d.id)) continue;
      for (const [reading, line] of d.map) {
        let p = 0;
        while (p < line.length) {
          let e = line.indexOf('\t', p); if (e < 0) e = line.length;
          const c1 = line.indexOf(':', p), c2 = line.indexOf(':', c1 + 1);
          if (c1 > 0 && c2 > 0 && c2 < e) {
            const c = +line.substring(c1 + 1, c2);
            let se = line.indexOf('\x1f', c2 + 1); if (se < 0 || se > e) se = e;
            const surf = line.substring(c2 + 1, se);
            if (surf !== reading && /[^ぁ-ゖー]/.test(surf)) {     // ひらがなだけの表記は読みそのもの
              const prev = rev.get(surf);
              if (!prev || c < prev[1]) rev.set(surf, [reading, c]);
            }
          }
          p = e + 1;
        }
      }
    }
    this._rev = rev; this._revKey = key;
    return rev;
  },
  /** 表記(漢字かな交じり) → 読み(ひらがな)。辞書の表記を最長一致で切りながら読みを連結する。求まらない部分があれば null */
  readingOf(text) {
    const rev = this._reverseIndex();
    let out = '';
    let i = 0;
    while (i < text.length) {
      const ch = text[i], o = ch.charCodeAt(0);
      if ((o >= 0x3041 && o <= 0x3096) || ch === 'ー' || ch === 'ゝ' || ch === 'ゞ') { out += ch; i++; continue; }          // ひらがな
      if (o >= 0x30A1 && o <= 0x30F6) { out += JP.kataToHira(ch); i++; continue; }                                        // カタカナ
      if (o < 0x80 || (o >= 0xFF01 && o <= 0xFF5E)) { out += JP.toHankakuAscii ? JP.toHankakuAscii(ch) : ch; i++; continue; }   // 英数字・記号
      if (/[、。，．・「」『』（）()！？!?\s]/.test(ch)) { out += ch; i++; continue; }
      let hit = null;
      for (let len = Math.min(16, text.length - i); len >= 1; len--) {
        const r = rev.get(text.substring(i, i + len));
        if (r) { hit = [len, r[0]]; break; }
      }
      if (!hit) return null;
      out += hit[1]; i += hit[0];
    }
    return out;
  },
  /** 前方一致する読みを列挙 (推測変換用) */
  prefixKeys(prefix, limit) {
    const res = [];
    for (const d of this.dicts.values()) {
      if (!this.enabled.has(d.id)) continue;
      const keys = this._keysOf(d);
      let lo = 0, hi = keys.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (keys[m] < prefix) lo = m + 1; else hi = m; }
      for (let i = lo; i < keys.length && res.length < limit * 4; i++) {
        if (!keys[i].startsWith(prefix)) break;
        if (keys[i] !== prefix) res.push(keys[i]);
      }
    }
    res.sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
    return res.slice(0, limit);
  },
  loadedCount() { return this.dicts.size; }
};

/* ---------------------------------------------------------------- 文字ユーティリティ */
const JP = {
  hiraToKata(s) { return s.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60)); },
  kataToHira(s) { return s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)); },
  toZenkakuAscii(s) { return s.replace(/[!-~]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)).replace(/ /g, '　'); },
  toHankakuAscii(s) { return s.replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' '); },
  // 全角カタカナ → 半角カタカナ
  _hk: { 'ア':'ｱ','イ':'ｲ','ウ':'ｳ','エ':'ｴ','オ':'ｵ','カ':'ｶ','キ':'ｷ','ク':'ｸ','ケ':'ｹ','コ':'ｺ','サ':'ｻ','シ':'ｼ','ス':'ｽ','セ':'ｾ','ソ':'ｿ',
    'タ':'ﾀ','チ':'ﾁ','ツ':'ﾂ','テ':'ﾃ','ト':'ﾄ','ナ':'ﾅ','ニ':'ﾆ','ヌ':'ﾇ','ネ':'ﾈ','ノ':'ﾉ','ハ':'ﾊ','ヒ':'ﾋ','フ':'ﾌ','ヘ':'ﾍ','ホ':'ﾎ',
    'マ':'ﾏ','ミ':'ﾐ','ム':'ﾑ','メ':'ﾒ','モ':'ﾓ','ヤ':'ﾔ','ユ':'ﾕ','ヨ':'ﾖ','ラ':'ﾗ','リ':'ﾘ','ル':'ﾙ','レ':'ﾚ','ロ':'ﾛ','ワ':'ﾜ','ヲ':'ｦ','ン':'ﾝ',
    'ァ':'ｧ','ィ':'ｨ','ゥ':'ｩ','ェ':'ｪ','ォ':'ｫ','ャ':'ｬ','ュ':'ｭ','ョ':'ｮ','ッ':'ｯ','ー':'ｰ','、':'､','。':'｡','「':'｢','」':'｣','・':'･',
    'ガ':'ｶﾞ','ギ':'ｷﾞ','グ':'ｸﾞ','ゲ':'ｹﾞ','ゴ':'ｺﾞ','ザ':'ｻﾞ','ジ':'ｼﾞ','ズ':'ｽﾞ','ゼ':'ｾﾞ','ゾ':'ｿﾞ','ダ':'ﾀﾞ','ヂ':'ﾁﾞ','ヅ':'ﾂﾞ','デ':'ﾃﾞ','ド':'ﾄﾞ',
    'バ':'ﾊﾞ','ビ':'ﾋﾞ','ブ':'ﾌﾞ','ベ':'ﾍﾞ','ボ':'ﾎﾞ','パ':'ﾊﾟ','ピ':'ﾋﾟ','プ':'ﾌﾟ','ペ':'ﾍﾟ','ポ':'ﾎﾟ','ヴ':'ｳﾞ','ヮ':'ﾜ','ヵ':'ｶ','ヶ':'ｹ' },
  toHankakuKana(s) { return Array.from(JP.hiraToKata(s)).map(c => JP._hk[c] || c).join(''); },
  kataToHankaku(s) { return Array.from(s).map(c => (/[\u30A1-\u30FC]/.test(c) && JP._hk[c]) ? JP._hk[c] : c).join(''); },
  hankakuToKata(s) {   // 半角カナ→全角カタカナ (濁点合成)
    if (!JP._hkInv) { JP._hkInv = {}; for (const k in JP._hk) if (!(JP._hk[k] in JP._hkInv) || JP._hk[k].length === 1) JP._hkInv[JP._hk[k]] = k; }
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i], n = s[i + 1];
      if (n === 'ﾞ' || n === 'ﾟ') { const k = JP._hkInv[c + n]; if (k) { out += k; i++; continue; } }
      out += JP._hkInv[c] || c;
    }
    return out;
  },
  isHiragana(c) { const o = c.charCodeAt(0); return (o >= 0x3041 && o <= 0x3096) || o === 0x30FC || o === 0x309D || o === 0x309E; },
  isKana(c) { const o = c.charCodeAt(0); return (o >= 0x3041 && o <= 0x30FF); },
  isDigit(c) { return c >= '0' && c <= '9'; },
  isAlpha(c) { return /[A-Za-z]/.test(c); },
  charWidth(c) { // 半角=1 全角=2 (秀丸の桁計算用)
    const o = c.charCodeAt(0);
    if (o < 0x7f) return 1;
    if (o >= 0xFF61 && o <= 0xFF9F) return 1;
    return 2;
  },
  normKey(s) { return JP.kataToHira(s).replace(/[A-Z]/g, c => c.toLowerCase()); }
};

/* ---------------------------------------------------------------- ローマ字かな変換 */
const ROMAJI = (() => {
  const t = {
    a:'あ', i:'い', u:'う', e:'え', o:'お',
    ka:'か', ki:'き', ku:'く', ke:'け', ko:'こ', ga:'が', gi:'ぎ', gu:'ぐ', ge:'げ', go:'ご',
    sa:'さ', si:'し', shi:'し', su:'す', se:'せ', so:'そ', za:'ざ', zi:'じ', ji:'じ', zu:'ず', ze:'ぜ', zo:'ぞ',
    ta:'た', ti:'ち', chi:'ち', tu:'つ', tsu:'つ', te:'て', to:'と', da:'だ', di:'ぢ', du:'づ', de:'で', do:'ど',
    na:'な', ni:'に', nu:'ぬ', ne:'ね', no:'の',
    ha:'は', hi:'ひ', hu:'ふ', fu:'ふ', he:'へ', ho:'ほ', ba:'ば', bi:'び', bu:'ぶ', be:'べ', bo:'ぼ', pa:'ぱ', pi:'ぴ', pu:'ぷ', pe:'ぺ', po:'ぽ',
    ma:'ま', mi:'み', mu:'む', me:'め', mo:'も', ya:'や', yu:'ゆ', yo:'よ', ra:'ら', ri:'り', ru:'る', re:'れ', ro:'ろ',
    wa:'わ', wo:'を', wi:'うぃ', we:'うぇ', wyi:'ゐ', wye:'ゑ', nn:'ん', "n'":'ん', xn:'ん',
    kya:'きゃ', kyi:'きぃ', kyu:'きゅ', kye:'きぇ', kyo:'きょ', gya:'ぎゃ', gyi:'ぎぃ', gyu:'ぎゅ', gye:'ぎぇ', gyo:'ぎょ',
    sya:'しゃ', syi:'しぃ', syu:'しゅ', sye:'しぇ', syo:'しょ', sha:'しゃ', shu:'しゅ', she:'しぇ', sho:'しょ',
    zya:'じゃ', zyi:'じぃ', zyu:'じゅ', zye:'じぇ', zyo:'じょ', ja:'じゃ', ju:'じゅ', je:'じぇ', jo:'じょ', jya:'じゃ', jyi:'じぃ', jyu:'じゅ', jye:'じぇ', jyo:'じょ',
    tya:'ちゃ', tyi:'ちぃ', tyu:'ちゅ', tye:'ちぇ', tyo:'ちょ', cha:'ちゃ', chu:'ちゅ', che:'ちぇ', cho:'ちょ', cya:'ちゃ', cyi:'ちぃ', cyu:'ちゅ', cye:'ちぇ', cyo:'ちょ',
    dya:'ぢゃ', dyi:'ぢぃ', dyu:'ぢゅ', dye:'ぢぇ', dyo:'ぢょ',
    tha:'てゃ', thi:'てぃ', thu:'てゅ', the:'てぇ', tho:'てょ', dha:'でゃ', dhi:'でぃ', dhu:'でゅ', dhe:'でぇ', dho:'でょ',
    twa:'とぁ', twi:'とぃ', twu:'とぅ', twe:'とぇ', two:'とぉ', dwa:'どぁ', dwi:'どぃ', dwu:'どぅ', dwe:'どぇ', dwo:'どぉ',
    nya:'にゃ', nyi:'にぃ', nyu:'にゅ', nye:'にぇ', nyo:'にょ', hya:'ひゃ', hyi:'ひぃ', hyu:'ひゅ', hye:'ひぇ', hyo:'ひょ',
    bya:'びゃ', byi:'びぃ', byu:'びゅ', bye:'びぇ', byo:'びょ', pya:'ぴゃ', pyi:'ぴぃ', pyu:'ぴゅ', pye:'ぴぇ', pyo:'ぴょ',
    fa:'ふぁ', fi:'ふぃ', fe:'ふぇ', fo:'ふぉ', fya:'ふゃ', fyu:'ふゅ', fyo:'ふょ', fwa:'ふぁ', fwi:'ふぃ', fwu:'ふぅ', fwe:'ふぇ', fwo:'ふぉ',
    mya:'みゃ', myi:'みぃ', myu:'みゅ', mye:'みぇ', myo:'みょ', rya:'りゃ', ryi:'りぃ', ryu:'りゅ', rye:'りぇ', ryo:'りょ',
    va:'ゔぁ', vi:'ゔぃ', vu:'ゔ', ve:'ゔぇ', vo:'ゔぉ', vya:'ゔゃ', vyu:'ゔゅ', vyo:'ゔょ',
    tsa:'つぁ', tsi:'つぃ', tse:'つぇ', tso:'つぉ', kwa:'くぁ', kwi:'くぃ', kwu:'くぅ', kwe:'くぇ', kwo:'くぉ', gwa:'ぐぁ', gwi:'ぐぃ', gwu:'ぐぅ', gwe:'ぐぇ', gwo:'ぐぉ',
    wha:'うぁ', whi:'うぃ', whu:'う', whe:'うぇ', who:'うぉ', ye:'いぇ',
    xa:'ぁ', xi:'ぃ', xu:'ぅ', xe:'ぇ', xo:'ぉ', la:'ぁ', li:'ぃ', lu:'ぅ', le:'ぇ', lo:'ぉ',
    xya:'ゃ', xyu:'ゅ', xyo:'ょ', lya:'ゃ', lyu:'ゅ', lyo:'ょ', xtu:'っ', xtsu:'っ', ltu:'っ', ltsu:'っ', xwa:'ゎ', lwa:'ゎ', xka:'ヵ', xke:'ヶ', lka:'ヵ', lke:'ヶ',
    xyi:'ぃ', xye:'ぇ', lyi:'ぃ', lye:'ぇ',
    '-':'ー', ',':'、', '.':'。', '/':'・', '[':'「', ']':'」', '~':'〜', '!':'！', '?':'？', '(':'（', ')':'）', ':':'：', ';':'；',
    '<':'＜', '>':'＞', '"':'”', "'":'’', '&':'＆', '*':'＊', '+':'＋', '=':'＝', '_':'＿', '\\':'＼', '^':'＾', '|':'｜', '`':'｀', '{':'｛', '}':'｝', '#':'＃', '$':'＄',
  };
  const keys = Object.keys(t);
  const prefixSet = new Set();
  for (const k of keys) for (let i = 1; i < k.length; i++) prefixSet.add(k.substring(0, i));
  const isCons = c => /[bcdfghjklmnpqrstvwxyz]/.test(c);
  return {
    table: t,
    /** pending(未確定ローマ字)に1文字追加して {out:確定かな, pending:残り} を返す */
    feed(pending, ch, opt) {
      let buf = pending + ch, out = '';
      for (;;) {
        if (!buf) break;
        if (Object.prototype.hasOwnProperty.call(t, buf)) {
          let v = t[buf];
          if (opt) {
            if (buf === '/' && opt.slashZen) v = '／';
            if (v === '、' && opt.touten) v = opt.touten;
            if (v === '。' && opt.kuten) v = opt.kuten;
            if (opt.bracketHan && (v === '「' || v === '」')) v = v === '「' ? '｢' : '｣';
          }
          out += v; buf = ''; break;
        }
        if (prefixSet.has(buf)) break;                 // まだ続く可能性
        // 先頭を確定して残りを再処理
        const c0 = buf[0];
        if (buf.length >= 2 && c0 === buf[1] && isCons(c0) && c0 !== 'n') { out += 'っ'; buf = buf.substring(1); continue; }
        if (c0 === 'n' && buf.length >= 2 && !/[aiueoyn']/.test(buf[1])) { out += 'ん'; buf = buf.substring(1); continue; }
        if (Object.prototype.hasOwnProperty.call(t, c0)) { out += t[c0]; buf = buf.substring(1); continue; }
        out += c0; buf = buf.substring(1);
      }
      return { out, pending: buf };
    },
    /** 入力終了時の残り処理 ("n"→ん、その他はそのまま) */
    flush(pending) {
      if (pending === 'n') return 'ん';
      if (Object.prototype.hasOwnProperty.call(t, pending)) return t[pending];
      return pending;
    }
  };
})();

/* ---------------------------------------------------------------- 学習・ユーザー辞書 */
class Learner {
  constructor(storageKey) {
    this.key = storageKey;
    this.seg = {};    // 文節読み -> [表記,...] 最新優先
    this.word = {};   // 単語読み -> {表記: true}
    try { const j = JSON.parse(localStorage.getItem(storageKey) || '{}'); this.seg = j.seg || {}; this.word = j.word || {}; } catch (e) {}
  }
  save() { try { localStorage.setItem(this.key, JSON.stringify({ seg: this.seg, word: this.word })); } catch (e) {} }
  learnSegment(reading, surface, words) {
    if (!reading || !surface) return;
    const a = (this.seg[reading] || []).filter(s => s !== surface);
    a.unshift(surface); this.seg[reading] = a.slice(0, 6);
    if (words) for (const w of words) { if (w.reading && w.s && w.s !== w.reading) (this.word[w.reading] = this.word[w.reading] || {})[w.s] = 1; }
    this.save();
  }
  isLearnedWord(reading, surface) { const m = this.word[reading]; return !!(m && m[surface]); }
  segmentPrefs(reading) { return this.seg[reading] || []; }
  /** 推測用: prefix で始まる学習済み読み */
  predict(prefix, limit) {
    const out = [];
    for (const k in this.seg) if (k.startsWith(prefix) && k !== prefix) out.push({ reading: k, s: this.seg[k][0] });
    out.sort((a, b) => a.reading.length - b.reading.length);
    return out.slice(0, limit);
  }
  clear() { this.seg = {}; this.word = {}; this.save(); }
}

class UserDict {
  constructor(storageKey) {
    this.key = storageKey; this.entries = [];
    try { this.entries = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch (e) {}
    this._index();
  }
  static POS = { '名詞': 1851, '固有名詞': 1920, '人名': 1921, '地名': 1924, '組織': 1929, 'サ変名詞': 1841, '形容動詞': 1931, '副詞': 12, '連体詞': 2659, '記号': 2644 };
  _index() { this.map = new Map(); for (const e of this.entries) { const k = JP.normKey(e.y); if (!this.map.has(k)) this.map.set(k, []); this.map.get(k).push(e); } }
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.entries)); } catch (e) {} }
  add(y, w, pos, cm) {
    y = y.trim(); w = w.trim(); if (!y || !w) return false;
    this.entries = this.entries.filter(e => !(e.y === y && e.w === w));
    this.entries.push({ y, w, pos: pos || '名詞', cm: cm || '' });
    this._index(); this.save(); return true;
  }
  remove(y, w) { this.entries = this.entries.filter(e => !(e.y === y && e.w === w)); this._index(); this.save(); }
  lookup(reading) {
    const a = this.map.get(reading); if (!a) return [];
    return a.map(e => ({ s: e.w, l: UserDict.POS[e.pos] || 1851, r: UserDict.POS[e.pos] || 1851, c: 2500, cm: e.cm || '', d: 'user' }));
  }
  prefixKeys(prefix, limit) { const o = []; for (const k of this.map.keys()) if (k.startsWith(prefix) && k !== prefix) o.push(k); return o.slice(0, limit); }
  exportText() { return '!!ATOK_TANGO_TEXT_HEADER_1\n' + this.entries.map(e => `${e.y}\t${e.w}\t${e.pos}${e.cm ? '\t' + e.cm : ''}`).join('\n') + '\n'; }
  importText(text) {
    let n = 0;
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith('!')) continue;
      const f = line.split('\t'); if (f.length < 2) continue;
      if (this.add(f[0], f[1], (f[2] || '名詞').replace(/\*$/, ''), f[3] || '')) n++;
    }
    return n;
  }
}

/* ---------------------------------------------------------------- 変換エンジン */
const ID_NOUN = 1851, ID_NUM = 2043, ID_ALPHA = 2643, ID_SYM = 2644, ID_KUTEN = 2646, ID_TOUTEN = 2658, ID_KAKKO_OPEN = 2656, ID_KAKKO_CLOSE = 2655;
const MAX_READING = 24;
const BOS_ATTACH_PENALTY = 2500;   // 文頭に助詞・助動詞・接尾語・非自立語が来る経路へのペナルティ (「ないかを」→「内科を」)

class Converter {
  constructor(learner, userdict) { this.learner = learner; this.user = userdict; this.posCache = new Map(); this.kataHankaku = false; }

  posInfo(id) {
    let p = this.posCache.get(id);
    if (p) return p;
    const s = IMEDICT.posOf(id), f = s.split(',');
    p = {
      pos: f[0] || '', sub: f[1] || '',
      attach: f[0] === '助詞' || f[0] === '助動詞' || f[1] === '接尾' || f[1] === '非自立' || f[0] === '記号' || f[0] === 'フィラー' || f[0] === 'BOS/EOS',
      prefix: f[0] === '接頭詞',
      noun: f[0] === '名詞' && f[1] !== '接尾' && f[1] !== '非自立'
    };
    this.posCache.set(id, p); return p;
  }

  _lookupAll(key) {
    const a = IMEDICT.lookup(key);
    const u = this.user.lookup(key);
    return u.length ? u.concat(a) : a;
  }

  /** 読み kana のラティスを作る。 nodesAt[i] = i から始まるノード配列 */
  buildLattice(kana) {
    const n = kana.length, nodesAt = [];
    for (let i = 0; i < n; i++) nodesAt.push([]);
    const push = (i, j, s, l, r, c, cm, d) => nodesAt[i].push({ start: i, end: j, s, l, r, c, cm, d, reading: kana.substring(i, j) });
    for (let i = 0; i < n; i++) {
      const ch = kana[i];
      // 辞書引き (ひらがな・記号どちらでも)
      const maxLen = Math.min(MAX_READING, n - i);
      for (let len = 1; len <= maxLen; len++) {
        const key = kana.substring(i, i + len);
        const ents = this._lookupAll(key);
        for (const e of ents) {
          let c = e.c;
          if (this.learner.isLearnedWord(key, e.s)) c = Math.max(0, c - 1500);
          push(i, i + len, e.s, e.l, e.r, c, e.cm, e.d);
        }
      }
      // 未知語ノード
      if (JP.isHiragana(ch)) {
        push(i, i + 1, ch, ID_NOUN, ID_NOUN, 7000, '', 'unk');
        for (let len = 2; len <= Math.min(12, n - i); len++) {
          if (!JP.isHiragana(kana[i + len - 1])) break;
          const span = kana.substring(i, i + len);
          push(i, i + len, JP.hiraToKata(span), ID_NOUN, ID_NOUN, 4000 + 2000 * len, '', 'unk');
        }
      } else if (JP.isDigit(ch)) {
        let j = i + 1; while (j < n && (JP.isDigit(kana[j]) || (kana[j] === '.' && j + 1 < n && JP.isDigit(kana[j + 1])))) j++;
        push(i, j, kana.substring(i, j), ID_NUM, ID_NUM, 5000, '', 'unk');
        push(i, j, JP.toZenkakuAscii(kana.substring(i, j)), ID_NUM, ID_NUM, 5500, '', 'unk');
      } else if (JP.isAlpha(ch) || ch === '@') {
        let j = i + 1; while (j < n && (JP.isAlpha(kana[j]) || JP.isDigit(kana[j]))) j++;
        push(i, j, kana.substring(i, j), ID_ALPHA, ID_ALPHA, 7000, '', 'unk');
        push(i, j, JP.toZenkakuAscii(kana.substring(i, j)), ID_ALPHA, ID_ALPHA, 7500, '', 'unk');
      } else {
        let id = ID_SYM;
        if ('。．.！？!?'.includes(ch)) id = ID_KUTEN; else if ('、，,'.includes(ch)) id = ID_TOUTEN;
        else if ('「『（(［[｛{'.includes(ch)) id = ID_KAKKO_OPEN; else if ('」』）)］]｝}'.includes(ch)) id = ID_KAKKO_CLOSE;
        push(i, i + 1, ch, id, id, 1500, '', 'unk');
      }
    }
    return nodesAt;
  }

  /** Viterbi: 最小コスト経路を返す (単語配列) */
  viterbi(kana, nodesAt, leftR) {
    const n = kana.length;
    const endAt = []; for (let i = 0; i <= n; i++) endAt.push([]);
    const bos = { end: 0, r: leftR || 0, best: 0, prev: null, bos: true };
    endAt[0].push(bos);
    for (let i = 0; i < n; i++) {
      const prevs = endAt[i]; if (!prevs.length) continue;
      for (const node of nodesAt[i]) {
        let best = Infinity, bp = null;
        const attach = this.posInfo(node.l).attach;
        for (const p of prevs) {
          let cst = p.best + IMEDICT.connCost(p.r, node.l);
          if (attach && p.bos && !p.r) cst += BOS_ATTACH_PENALTY;
          if (cst < best) { best = cst; bp = p; }
        }
        node.best = best + node.c; node.prev = bp;
        endAt[node.end].push(node);
      }
    }
    let best = Infinity, last = null;
    for (const p of endAt[n]) { const cst = p.best + IMEDICT.connCost(p.r, 0); if (cst < best) { best = cst; last = p; } }
    const words = [];
    for (let p = last; p && !p.bos; p = p.prev) words.unshift(p);
    return words;
  }

  /** 単語列 → 文節 [{start,end,words}] */
  toSegments(words) {
    const segs = [];
    let cur = null, prevPrefix = false, prevSahen = false;
    for (const w of words) {
      const pi = this.posInfo(w.l);
      const sahenVerb = prevSahen && pi.pos === '動詞' && /^[しすさせ]/.test(w.reading);
      const startNew = !cur || !(pi.attach || prevPrefix || sahenVerb);
      if (startNew) { cur = { start: w.start, end: w.end, words: [w] }; segs.push(cur); }
      else { cur.end = w.end; cur.words.push(w); }
      prevPrefix = pi.prefix; prevSahen = pi.sub === 'サ変接続';
    }
    return segs;
  }

  /** 文節 [a,b) の候補列挙 */
  segmentCandidates(kana, nodesAt, a, b, leftR, rightL) {
    const K = 60;
    const paths = []; for (let i = 0; i <= b; i++) paths.push([]);
    paths[a].push({ cost: 0, r: leftR || 0, surf: '', words: [], n: 0, lastNoun: false, lastPrefix: false });
    for (let p = a; p < b; p++) {
      const cur = paths[p]; if (!cur.length) continue;
      cur.sort((x, y) => x.cost - y.cost); if (cur.length > K) cur.length = K;
      for (const node of nodesAt[p]) {
        if (node.end > b) continue;
        const pi = this.posInfo(node.l);
        for (const path of cur) {
          if (path.n > 0 && !pi.attach) {
            // 2語目以降の自立語: 接頭詞の後、名詞+名詞(複合)、サ変名詞+する のみ許可
            const sahen = path.lastSahen && pi.pos === '動詞' && /^[しすさせ]/.test(node.reading);
            if (!(path.lastPrefix || (path.lastNoun && pi.noun) || sahen)) continue;
          }
          let cost = path.cost + IMEDICT.connCost(path.r, node.l) + node.c;
          if (pi.attach && path.n === 0 && !(leftR || 0)) cost += BOS_ATTACH_PENALTY;
          paths[node.end].push({ cost, r: node.r, surf: path.surf + node.s, words: path.words.concat([node]), n: path.n + 1,
            lastNoun: pi.noun, lastPrefix: pi.prefix, lastSahen: pi.sub === 'サ変接続' });
        }
      }
    }
    const fin = paths[b].map(p => ({ s: p.surf, r: p.r, l: p.words[0].l, cost: p.cost + IMEDICT.connCost(p.r, rightL || 0), words: p.words, cm: p.words.length === 1 ? p.words[0].cm : '' }));
    fin.sort((x, y) => x.cost - y.cost);
    const seen = new Set(), out = [];
    for (const f of fin) { if (seen.has(f.s)) continue; seen.add(f.s); out.push(f); }
    // 固定候補: ひらがな / カタカナ / 半角カナ
    const span = kana.substring(a, b);
    const fixed = this.kataHankaku ? [span, JP.toHankakuKana(span), JP.hiraToKata(span)] : [span, JP.hiraToKata(span), JP.toHankakuKana(span)];
    if (/[!-~]/.test(span)) fixed.push(JP.toZenkakuAscii(span));
    for (const s of fixed) if (!seen.has(s)) { seen.add(s); out.push({ s, r: ID_NOUN, l: ID_NOUN, cost: 99999, words: [], cm: '' }); }
    // 学習: 文節単位の選択履歴を先頭へ
    const prefs = this.learner.segmentPrefs(span);
    if (prefs.length) {
      const pick = [];
      for (let i = prefs.length - 1; i >= 0; i--) {
        const idx = out.findIndex(c => c.s === prefs[i]);
        if (idx >= 0) pick.unshift(...out.splice(idx, 1));
      }
      out.unshift(...pick);
    }
    return out;
  }

  /** 全文変換: 文節配列を返す */
  convert(kana) {
    const nodesAt = this.buildLattice(kana);
    const words = this.viterbi(kana, nodesAt, 0);
    const segs = this.toSegments(words);
    return this._fillCands(kana, nodesAt, segs, 0);
  }
  _fillCands(kana, nodesAt, segs, startIdx) {
    for (let i = startIdx; i < segs.length; i++) {
      const s = segs[i];
      const leftR = i > 0 ? segs[i - 1].cands[segs[i - 1].idx].r : 0;
      const rightL = i + 1 < segs.length ? segs[i + 1].words[0].l : 0;
      s.reading = kana.substring(s.start, s.end);
      s.cands = this.segmentCandidates(kana, nodesAt, s.start, s.end, leftR, rightL);
      // Viterbi が選んだ表記を先頭候補に
      const surf = s.words.map(w => w.s).join('');
      const idx = s.cands.findIndex(c => c.s === surf);
      s.idx = 0;
      if (idx > 0) {
        const prefs = this.learner.segmentPrefs(s.reading);
        if (!prefs.length || prefs[0] === surf) { s.cands.unshift(...s.cands.splice(idx, 1)); }
      }
    }
    return { segs, nodesAt };
  }
  /** 文節 k の長さを変更し、それ以降を再変換 */
  resize(kana, nodesAt, segs, k, newEnd) {
    const n = kana.length;
    if (newEnd <= segs[k].start || newEnd > n) return segs;
    const head = segs.slice(0, k);
    const leftR = k > 0 ? head[k - 1].cands[head[k - 1].idx].r : 0;
    const seg = { start: segs[k].start, end: newEnd, words: [] };
    seg.reading = kana.substring(seg.start, seg.end);
    // まず文節 k の候補 (右文脈は未確定なので 0)
    seg.cands = this.segmentCandidates(kana, nodesAt, seg.start, seg.end, leftR, 0); seg.idx = 0;
    seg.words = seg.cands[0].words.length ? seg.cands[0].words : [{ start: seg.start, end: newEnd, s: seg.cands[0].s, l: ID_NOUN, r: ID_NOUN, c: 0, cm: '', reading: seg.reading }];
    let rest = [];
    if (newEnd < n) {
      const sub = kana.substring(newEnd), subNodes = this.buildLattice(sub);
      const words = this.viterbi(sub, subNodes, seg.cands[0].r);
      for (const w of words) { w.start += newEnd; w.end += newEnd; w.reading = kana.substring(w.start, w.end); }
      rest = this.toSegments(words);
      // 右文脈を反映して k の候補を作り直す
      seg.cands = this.segmentCandidates(kana, nodesAt, seg.start, seg.end, leftR, rest.length ? rest[0].words[0].l : 0);
    }
    const all = head.concat([seg], rest);
    this._fillCands(kana, nodesAt, all, k + 1);
    return all;
  }
  /** 推測変換候補 */
  predict(prefix, limit) {
    const key = JP.normKey(prefix);
    const out = [], seen = new Set();
    for (const p of this.learner.predict(key, limit)) if (!seen.has(p.s)) { seen.add(p.s); out.push({ s: p.s, reading: p.reading, cm: '', learned: true }); }
    const keys = this.user.prefixKeys(key, 20).concat(IMEDICT.prefixKeys(key, 60));
    const scored = [];
    for (const k of keys) {
      const ents = this._lookupAll(k); if (!ents.length) continue;
      let best = ents[0]; for (const e of ents) if (e.c < best.c) best = e;
      scored.push({ s: best.s, reading: k, cm: best.cm, cost: best.c + 100 * (k.length - key.length) });
    }
    scored.sort((x, y) => x.cost - y.cost);
    for (const c of scored) { if (out.length >= limit) break; if (!seen.has(c.s)) { seen.add(c.s); out.push(c); } }
    return out;
  }
}

/* ---------------------------------------------------------------- IME 本体 (状態機械) */
const IME_MODES = { hira: 'あ', kata: 'ア', hankata: '_ｱ', zenei: 'Ａ', hanei: 'A' };

class IME {
  constructor(opts) {
    this.opts = Object.assign({ digitsZen: false, spaceZen: true, slashZen: false, predictAuto: true, candPerPage: 9,
                                kuten: '。', touten: '、', kataHankaku: false, alphaZen: false, bracketHan: false, startMode: 'hira' }, opts || {});
    this.learner = new Learner('jpime_learn');
    this.user = new UserDict('jpime_userdict');
    this.conv = new Converter(this.learner, this.user);
    this.on = true;
    this.mode = this.opts.startMode || 'hira';
    this.reset();
    this.lastCommit = null;      // 確定取り消し用 {text, kana}
  }
  reset() {
    this.state = 'none';         // none | input | convert
    this.kana = '';              // 入力中の読み(ひらがな、記号はそのまま)
    this.raw = '';               // 入力されたキー列(英字) F9/F10 用
    this.pending = '';           // 未確定ローマ字
    this.caret = 0;              // kana 内のカーソル位置
    this.alpha = false;          // 英字入力(大文字で開始)状態
    this.segs = null; this.nodesAt = null; this.focus = 0;
    this.candOpen = false;
    this.pred = null; this.predIdx = -1;
    this.fcycle = null;          // F9/F10 連打用
  }
  get active() { return this.state !== 'none'; }
  modeLabel() { return this.on ? IME_MODES[this.mode] : '--'; }

  /* ---- 表示用 ---- */
  displayPreedit() {
    const conv = this.pending ? this.pending : '';
    const text = this.kana.substring(0, this.caret) + conv + this.kana.substring(this.caret);
    return this._modeText(text);
  }
  _modeText(t) {
    if (this.alpha) return this.opts.alphaZen ? JP.toZenkakuAscii(t) : t;
    if (this.mode === 'kata') return JP.hiraToKata(t);
    if (this.mode === 'hankata') return JP.toHankakuKana(t);
    return t;
  }
  /** 描画用: [{text, kind:'raw'|'seg'|'focus'}], caret(文字位置) */
  display() {
    if (this.state === 'input') {
      const t = this.displayPreedit();
      return { parts: [{ text: t, kind: 'raw' }], caret: this.caret + this.pending.length, text: t };
    }
    if (this.state === 'convert') {
      const parts = this.segs.map((s, i) => ({ text: s.cands[s.idx].s, kind: i === this.focus ? 'focus' : 'seg' }));
      return { parts, caret: -1, text: parts.map(p => p.text).join('') };
    }
    return { parts: [], caret: 0, text: '' };
  }
  candidates() {
    if (this.state !== 'convert' || !this.candOpen) return null;
    const s = this.segs[this.focus], per = this.opts.candPerPage;
    const page = Math.floor(s.idx / per);
    return { list: s.cands.slice(page * per, page * per + per), index: s.idx - page * per, page, pages: Math.ceil(s.cands.length / per), total: s.cands.length, reading: s.reading };
  }
  predictions() { return this.pred ? { list: this.pred, index: this.predIdx } : null; }

  /* ---- 内部 ---- */
  _hira() { return this.kana; }
  _flushPending() {
    if (this.pending) { const o = ROMAJI.flush(this.pending); this.kana = this.kana.substring(0, this.caret) + o + this.kana.substring(this.caret); this.caret += o.length; this.pending = ''; }
  }
  _commitText() {
    let t;
    if (this.state === 'convert') t = this.segs.map(s => s.cands[s.idx].s).join('');
    else { this._flushPending(); t = this._modeText(this.kana); if (this.alpha && this.opts.alphaZen && this.state === 'input') t = JP.toZenkakuAscii(t); }
    return this._post(t);
  }
  /** 確定文字列の既定幅を適用 (カタカナ→半角など) */
  _post(t) {
    if (this.opts.kataHankaku) t = JP.kataToHankaku(t);
    return t;
  }
  /** 確定済み文字列の再変換: 読みを与えて変換状態から始める */
  reconvert(reading) {
    this.reset(); this.on = true; this.mode = "hira";
    this.kana = reading; this.caret = reading.length; this.raw = ''; this.pending = ''; this.alpha = false; this.state = 'input';
    this._startConvert();
  }
  _startConvert() {
    this._flushPending();
    if (!this.kana) return;
    const key = JP.normKey(this.kana);
    const r = this.conv.convert(key);
    this.segs = r.segs; this.nodesAt = r.nodesAt; this.focus = 0; this.candOpen = false;
    this.state = 'convert';
    this._keyNorm = key;
    this.pred = null; this.predIdx = -1;
  }
  _updatePredict() {
    if (!this.opts.predictAuto || this.state !== 'input' || this.kana.length + this.pending.length < 2) { this.pred = null; this.predIdx = -1; return; }
    const prefix = this.kana + (this.pending === 'n' ? 'ん' : this.pending);
    const list = this.conv.predict(prefix, 7);
    this.pred = list.length ? list : null; this.predIdx = -1;
  }
  _learnAndCommitSegs(segs) {
    for (const s of segs) {
      const c = s.cands[s.idx];
      this.learner.learnSegment(s.reading, c.s, c.words.map(w => ({ reading: w.reading, s: w.s })));
    }
  }

  /** キー処理。戻り値 {handled, commit, beep} */
  handleKey(e) {
    const k = e.key, ctrl = e.ctrlKey, shift = e.shiftKey, alt = e.altKey;
    const R = (commit) => ({ handled: true, commit: commit || '' });
    if (alt) return { handled: false };

    // ---- IME ON/OFF (半角/全角 / Ctrl+Space / 変換キー)
    if (k === 'Zenkaku' || k === 'Hankaku' || k === 'KanjiMode' || k === 'ZenkakuHankaku' || (ctrl && k === ' ') || (ctrl && k === 'Spacebar')) {
      const c = this.active ? this._commitText() : '';
      this.reset(); this.on = !this.on; return R(c);
    }
    if (!this.on) {
      if (k === 'Convert' || k === 'KanaMode' || k === 'Hiragana' || k === 'HiraganaKatakana') { this.on = true; this.mode = 'hira'; return R(); }
      return { handled: false };
    }

    // ---- 変換中 ----
    if (this.state === 'convert') return this._keyConvert(e);
    // ---- 入力中 ----
    if (this.state === 'input') return this._keyInput(e);
    // ---- 待機中 ----
    return this._keyIdle(e);
  }

  _keyIdle(e) {
    const k = e.key, ctrl = e.ctrlKey, shift = e.shiftKey;
    const R = (c) => ({ handled: true, commit: c || '' });
    if (k === 'NonConvert') {          // 無変換: あ→ア→_ｱ
      if (shift) this.mode = (this.mode === 'zenei') ? 'hanei' : 'zenei';
      else this.mode = this.mode === 'hira' ? 'kata' : this.mode === 'kata' ? 'hankata' : 'hira';
      return R();
    }
    if (k === 'Convert' || k === 'KanaMode' || k === 'Hiragana') { this.mode = 'hira'; return R(); }
    if (ctrl && k === 'Backspace' && this.lastCommit) {     // 確定取り消し
      const lc = this.lastCommit; this.lastCommit = null;
      this.kana = lc.kana; this.caret = this.kana.length; this.raw = lc.raw || ''; this.state = 'input';
      this._startConvert();
      return { handled: true, commit: '', retract: lc.text.length };
    }
    if (ctrl) return { handled: false };
    if (k.length !== 1) return { handled: false };
    // 英数モード: 直接確定
    if (this.mode === 'hanei') return R(k);
    if (this.mode === 'zenei') return R(k === ' ' ? '　' : JP.toZenkakuAscii(k));
    if (k === ' ') return R(shift ? ' ' : (this.opts.spaceZen ? '　' : ' '));
    // かな入力開始
    this.state = 'input'; this.kana = ''; this.caret = 0; this.pending = ''; this.raw = ''; this.alpha = false;
    return this._typeChar(k, e);
  }

  _typeChar(k, e) {
    const R = (c) => ({ handled: true, commit: c || '' });
    this.fcycle = null;
    if (/[A-Z]/.test(k) && e.shiftKey) {            // Shift+英字 → 英字入力
      this._flushPending();
      this.alpha = true;
    }
    if (this.alpha) {
      this.kana = this.kana.substring(0, this.caret) + k + this.kana.substring(this.caret); this.caret++; this.raw += k;
      this._updatePredict(); return R();
    }
    if (/[A-Z]/.test(k)) k = k.toLowerCase();        // CapsLock
    this.raw += k;
    if (JP.isDigit(k)) {
      this._flushPending();
      const d = this.opts.digitsZen ? JP.toZenkakuAscii(k) : k;
      this.kana = this.kana.substring(0, this.caret) + d + this.kana.substring(this.caret); this.caret += d.length;
      this._updatePredict(); return R();
    }
    if (k === '@' && this.kana === '' && !this.pending) {   // @略語 入力 (医療辞書)
      this.alpha = true; this.kana = '@'; this.caret = 1; this._updatePredict(); return R();
    }
    const r = ROMAJI.feed(this.pending, k, this.opts);
    this.pending = r.pending;
    if (r.out) { this.kana = this.kana.substring(0, this.caret) + r.out + this.kana.substring(this.caret); this.caret += r.out.length; }
    this._updatePredict();
    return R();
  }

  _keyInput(e) {
    const k = e.key, ctrl = e.ctrlKey, shift = e.shiftKey;
    const R = (c) => ({ handled: true, commit: c || '' });
    // 推測候補の選択中
    if (this.pred && this.predIdx >= 0) {
      if (k === 'Tab' && !shift) { this.predIdx = (this.predIdx + 1) % this.pred.length; return R(); }
      if (k === 'Tab' && shift) { this.predIdx = (this.predIdx - 1 + this.pred.length) % this.pred.length; return R(); }
      if (k === 'Enter' || (ctrl && k === 'Enter')) { const p = this.pred[this.predIdx]; const t = this._post(p.s); this.learner.learnSegment(p.reading, p.s, null); this.reset(); return R(t); }
      if (k === 'Escape') { this.predIdx = -1; return R(); }
      if (k === 'ArrowDown') { this.predIdx = Math.min(this.pred.length - 1, this.predIdx + 1); return R(); }
      if (k === 'ArrowUp') { this.predIdx = Math.max(0, this.predIdx - 1); return R(); }
      // それ以外は選択解除して通常処理
      this.predIdx = -1;
    }
    if (k === 'Tab') {                                   // 省入力(推測)変換
      if (!this.pred) { const prefix = this.kana + (this.pending === 'n' ? 'ん' : this.pending); const l = this.conv.predict(prefix, 9); this.pred = l.length ? l : null; }
      if (this.pred) this.predIdx = shift ? this.pred.length - 1 : 0;
      return R();
    }
    if ((shift || ctrl) && k === 'Enter' && this.pred && this.pred.length) {   // 推測変換確定 (Shift+Enter / Ctrl+Enter)
      const p = this.pred[0]; this.learner.learnSegment(p.reading, p.s, null); this.reset(); return R(this._post(p.s));
    }
    if (k === ' ' || k === 'Convert' || (k === 'ArrowDown' && !ctrl)) {   // 変換
      if (k === ' ' && this.alpha === false && this.kana === '' && this.pending === '') return R(this.opts.spaceZen ? '　' : ' ');
      this._startConvert();
      if (this.state === 'convert') return R();
      return R();
    }
    if (k === 'Enter') { const t = this._commitText(); this.lastCommit = { text: t, kana: this.kana, raw: this.raw }; this.reset(); return R(t); }
    if (k === 'Escape' || (ctrl && k === '[')) { this.reset(); return R(); }     // 全文字削除
    if (k === 'Backspace' || (ctrl && k === 'h')) {
      if (this.pending) this.pending = this.pending.slice(0, -1);
      else if (this.caret > 0) { this.kana = this.kana.substring(0, this.caret - 1) + this.kana.substring(this.caret); this.caret--; }
      if (!this.kana && !this.pending) this.reset(); else this._updatePredict();
      return R();
    }
    if (k === 'Delete' || (ctrl && k === 'g')) {
      this._flushPending();
      if (this.caret < this.kana.length) this.kana = this.kana.substring(0, this.caret) + this.kana.substring(this.caret + 1);
      if (!this.kana) this.reset(); else this._updatePredict();
      return R();
    }
    if (k === 'ArrowLeft' || (ctrl && k === 'k')) { this._flushPending(); if (ctrl && k === 'ArrowLeft') this.caret = 0; else this.caret = Math.max(0, this.caret - 1); return R(); }
    if (k === 'ArrowRight' || (ctrl && k === 'l')) { this._flushPending(); if (ctrl && k === 'ArrowRight') this.caret = this.kana.length; else this.caret = Math.min(this.kana.length, this.caret + 1); return R(); }
    if (k === 'Home') { this._flushPending(); this.caret = 0; return R(); }
    if (k === 'End') { this._flushPending(); this.caret = this.kana.length; return R(); }
    // F6〜F10 / Ctrl+U,I,O,P,@ : 文字種変換して確定待ち
    const fk = this._fkey(k, ctrl);
    if (fk) { this._applyFkey(fk); return R(); }
    if (k === 'NonConvert') {              // 無変換: 読みの文字種をローテーション
      this._applyFkey(this.mode === 'hira' ? 'kata' : this.mode === 'kata' ? 'hankata' : 'hira');
      return R();
    }
    if (ctrl) return { handled: false };
    if (k.length === 1) return this._typeChar(k, e);
    return { handled: true, commit: '' };  // その他のキーは無視
  }

  _fkey(k, ctrl) {
    if (k === 'F6' || (ctrl && k === 'u')) return 'hira';
    if (k === 'F7' || (ctrl && k === 'i')) return 'kata';
    if (k === 'F8' || (ctrl && k === 'o')) return 'hankata';
    if (k === 'F9' || (ctrl && k === 'p')) return 'zenei';
    if (k === 'F10' || (ctrl && k === '@')) return 'hanei';
    return null;
  }
  /** F6〜F10: 読み全体を文字種変換した「確定待ち」状態にする */
  _applyFkey(kind) {
    this._flushPending();
    const base = this.fcycle && this.fcycle.base ? this.fcycle.base : this.kana;
    const raw = this.fcycle && this.fcycle.raw ? this.fcycle.raw : this.raw;
    if (!this.fcycle) this.fcycle = { base, raw, kind: null, step: 0 };
    if (this.fcycle.kind === kind) this.fcycle.step++; else { this.fcycle.kind = kind; this.fcycle.step = 0; }
    const st = this.fcycle.step;
    let out;
    const rawSeq = raw.replace(/[^ -~]/g, '');
    if (kind === 'hira') { out = JP.kataToHira(base); this.alpha = false; }
    else if (kind === 'kata') { out = JP.hiraToKata(base); this.alpha = true; }
    else if (kind === 'hankata') { out = JP.toHankakuKana(base); this.alpha = true; }
    else if (kind === 'zenei' || kind === 'hanei') {
      const seq = rawSeq || base;
      const v = [seq.toLowerCase(), seq.toUpperCase(), seq.charAt(0).toUpperCase() + seq.slice(1).toLowerCase()][st % 3];
      out = kind === 'zenei' ? JP.toZenkakuAscii(v) : v;
      this.alpha = true;
    }
    this.kana = out; this.caret = out.length; this.pending = '';
    this.pred = null; this.predIdx = -1;
    if (this.state === 'convert') { this.state = 'input'; this.segs = null; }
  }

  _keyConvert(e) {
    const k = e.key, ctrl = e.ctrlKey, shift = e.shiftKey;
    const R = (c) => ({ handled: true, commit: c || '' });
    const seg = this.segs[this.focus];
    const per = this.opts.candPerPage;
    if (k === ' ' || k === 'Convert') {                   // 次候補 (Shift も次候補: ATOK)
      if (!this.candOpen && seg.cands.length > 1) {
        // 1回目: 候補ウィンドウを開き次候補へ
        this.candOpen = true; seg.idx = (seg.idx + 1) % seg.cands.length;
      } else { seg.idx = (seg.idx + 1) % seg.cands.length; this.candOpen = true; }
      return R();
    }
    if (k === 'ArrowUp') { seg.idx = (seg.idx - 1 + seg.cands.length) % seg.cands.length; this.candOpen = true; return R(); }
    if (k === 'PageDown' && this.candOpen) { seg.idx = Math.min(seg.cands.length - 1, seg.idx + per); return R(); }
    if (k === 'PageUp' && this.candOpen) { seg.idx = Math.max(0, seg.idx - per); return R(); }
    if (k === 'Home' && this.candOpen) { seg.idx = 0; return R(); }
    if (k === 'End' && this.candOpen) { seg.idx = seg.cands.length - 1; return R(); }
    if (/^[1-9]$/.test(k) && this.candOpen) {             // 番号で選択
      const c = this.candidates(); const i = +k - 1;
      if (i < c.list.length) { seg.idx = c.page * per + i; this.candOpen = false; }
      return R();
    }
    if (k === 'ArrowDown') {                              // 部分確定 (注目文節を確定して次へ)
      return this._partialCommit();
    }
    if (k === 'Enter') {                                  // 全確定
      const t = this._commitText(); this._learnAndCommitSegs(this.segs);
      this.lastCommit = { text: t, kana: this.kana, raw: this.raw }; this.reset(); return R(t);
    }
    if (k === 'Backspace' || (ctrl && k === 'h') || k === 'Insert') {   // 変換取消 → 読みに戻る
      this.state = 'input'; this.segs = null; this.candOpen = false; this.caret = this.kana.length; this._updatePredict(); return R();
    }
    if (k === 'Escape' || (ctrl && k === '[')) {
      if (this.candOpen) { this.candOpen = false; return R(); }
      this.state = 'input'; this.segs = null; this.caret = this.kana.length; this._updatePredict(); return R();
    }
    if (k === 'Delete' && shift) {                        // 注目文節削除
      const s = this.segs[this.focus];
      this.kana = this.kana.substring(0, s.start) + this.kana.substring(s.end);
      this.raw = ''; this.caret = this.kana.length;
      if (!this.kana) { this.reset(); return R(); }
      this.state = 'input'; this._startConvert(); this.focus = Math.min(this.focus, this.segs.length - 1); return R();
    }
    if (k === 'ArrowLeft' && shift || (ctrl && k === 'k')) {   // 文節縮小
      if (seg.end - seg.start > 1) { this.segs = this.conv.resize(this._keyNorm, this.nodesAt, this.segs, this.focus, seg.end - 1); this.candOpen = false; }
      return R();
    }
    if (k === 'ArrowRight' && shift || (ctrl && k === 'l')) {  // 文節伸長
      if (seg.end < this._keyNorm.length) { this.segs = this.conv.resize(this._keyNorm, this.nodesAt, this.segs, this.focus, seg.end + 1); this.candOpen = false; }
      return R();
    }
    if (k === 'ArrowLeft') { if (ctrl) this.focus = 0; else this.focus = Math.max(0, this.focus - 1); this.candOpen = false; return R(); }
    if (k === 'ArrowRight') { if (ctrl) this.focus = this.segs.length - 1; else this.focus = Math.min(this.segs.length - 1, this.focus + 1); this.candOpen = false; return R(); }
    if (k === 'Home' ) { this.focus = 0; this.candOpen = false; return R(); }
    if (k === 'End' ) { this.focus = this.segs.length - 1; this.candOpen = false; return R(); }
    const fk = this._fkey(k, ctrl);
    if (fk) {
      // 変換中のF6〜: 注目文節のみ文字種変換 (ATOK: 注目文節が対象)
      const span = this.kana.substring(seg.start, seg.end), rawSpan = '';
      let out = span;
      if (fk === 'hira') out = span; else if (fk === 'kata') out = JP.hiraToKata(span); else if (fk === 'hankata') out = JP.toHankakuKana(span);
      else if (fk === 'zenei') out = JP.toZenkakuAscii(span); else out = span;
      const idx = seg.cands.findIndex(c => c.s === out);
      if (idx >= 0) seg.idx = idx; else { seg.cands.push({ s: out, r: ID_NOUN, l: ID_NOUN, cost: 99999, words: [], cm: '' }); seg.idx = seg.cands.length - 1; }
      this.candOpen = false; return R();
    }
    if (k === 'Tab' || k === 'NonConvert') return R();
    if (ctrl) return { handled: false };
    if (k.length === 1) {                                 // 文字入力 → 確定して続行
      const t = this._commitText(); this._learnAndCommitSegs(this.segs);
      this.lastCommit = { text: t, kana: this.kana, raw: this.raw }; this.reset();
      const r = this._keyIdle(e);
      return { handled: true, commit: t + (r.commit || '') };
    }
    return R();
  }

  _partialCommit() {
    const R = (c) => ({ handled: true, commit: c || '' });
    const done = this.segs.slice(0, this.focus + 1);
    const text = this._post(done.map(s => s.cands[s.idx].s).join(''));
    this._learnAndCommitSegs(done);
    if (this.focus + 1 >= this.segs.length) { this.lastCommit = { text, kana: this.kana, raw: this.raw }; this.reset(); return R(text); }
    const cut = this.segs[this.focus].end;
    this.kana = this.kana.substring(cut); this._keyNorm = this._keyNorm.substring(cut); this.raw = '';
    const rest = this.segs.slice(this.focus + 1);
    for (const s of rest) { s.start -= cut; s.end -= cut; for (const w of s.words) { w.start -= cut; w.end -= cut; } }
    this.segs = rest; this.focus = 0; this.candOpen = false;
    this.nodesAt = this.conv.buildLattice(this._keyNorm);
    // 候補を左文脈なしで再計算
    this.conv._fillCands(this._keyNorm, this.nodesAt, this.segs, 0);
    return R(text);
  }

  /** マウス等で候補を直接選ぶ */
  selectCandidate(absIndex) {
    if (this.state !== 'convert') return;
    const seg = this.segs[this.focus];
    if (absIndex >= 0 && absIndex < seg.cands.length) seg.idx = absIndex;
  }
  /** 外部から確定 (フォーカス喪失など) */
  forceCommit() {
    if (!this.active) return '';
    const t = this._commitText();
    if (this.state === 'convert') this._learnAndCommitSegs(this.segs);
    this.reset(); return t;
  }
  /** 単語登録 */
  registerWord(y, w, pos, cm) { const ok = this.user.add(y, w, pos, cm); IMEDICT._cache.clear(); return ok; }
}

window.IMEDICT = IMEDICT; window.IME = IME; window.JP = JP; window.ROMAJI = ROMAJI; window.UserDict = UserDict;
