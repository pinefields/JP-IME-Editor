/* i18n.js — 表示言語の切り替え (日本語 / English)
 *   画面の文字列は日本語で書かれている。英語モードでは、表示直前に日本語 → 英語の対訳表(I18N_EN, js/i18n_en.js)で置き換える。
 *   - 静的な HTML・動的に作られる一覧・ステータスバーなど: MutationObserver でテキストノードと title/placeholder を置換
 *   - メニュー: Menu.build が I18N.t() を通す ("&File" の & は Alt キーの英字)
 *   - confirm / prompt: window.confirm / prompt を包んで置換
 *   編集領域(#text)・プレビュー・変換候補は対象外。
 */
const I18N = {
  lang: 'ja', dict: {}, rules: [], orig: new WeakMap(), missing: new Set(), obs: null,
  JA: /[ぁ-んァ-ヶ一-龠々〇（）「」、。・：→⇔]/,
  SKIP: '#text, #preview, #cand, #pred, #kb, script, style, [data-noi18n]',
  /** 1 つの文字列を訳す (前後の空白は保つ)。訳がなければそのまま返す */
  t(s) {
    if (this.lang !== 'en' || !s || typeof s !== 'string') return s;
    const k = s.trim();
    if (!k || !this.JA.test(k)) return s;
    let v = this.dict[k];
    if (v === undefined) for (const [re, rep] of this.rules) { if (re.test(k)) { v = k.replace(re, rep); break; } }
    if (v === undefined) { this.missing.add(k); return s; }
    return s.replace(k, () => v);
  },
  /** メニュー用: "&File" 形式 → { text: 'File', html: '<u>F</u>ile', mn: 'F' }。日本語 "ファイル(F)" は mn: 'F' */
  menu(label) {
    const s = this.t(label || '');
    const i = s.indexOf('&');
    const escH = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    if (i >= 0 && i < s.length - 1) return { text: s.slice(0, i) + s.slice(i + 1), html: escH(s.slice(0, i)) + '<u>' + escH(s[i + 1]) + '</u>' + escH(s.slice(i + 2)), mn: s[i + 1].toUpperCase() };
    const m = /\(([A-Z0-9])\)/.exec(s);
    return { text: s, html: escH(s), mn: m ? m[1] : null };
  },
  _text(n) {
    const p = n.parentElement; if (!p || p.closest(this.SKIP)) return;
    const cur = n.nodeValue, o = this.orig.get(n);
    if (o && o.out === cur) return;
    const out = this.t(cur);
    this.orig.set(n, { src: cur, out });
    if (out !== cur) n.nodeValue = out;
  },
  _attrs(el) {
    for (const a of ['title', 'placeholder']) {
      if (!el.hasAttribute || !el.hasAttribute(a)) continue;
      const cur = el.getAttribute(a), key = 'i18n' + a, saved = el.dataset[key];
      if (saved !== undefined && el.dataset[key + 'out'] === cur) continue;
      const out = this.t(cur); el.dataset[key] = cur; el.dataset[key + 'out'] = out;
      if (out !== cur) el.setAttribute(a, out);
    }
  },
  walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { this._text(root); return; }
    if (root.nodeType !== 1 || root.closest(this.SKIP)) return;
    this._attrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: (n) => (n.nodeType === 1 && n.matches(this.SKIP)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    let n; while ((n = w.nextNode())) { if (n.nodeType === 3) this._text(n); else this._attrs(n); }
  },
  restore() {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n; while ((n = w.nextNode())) {
      if (n.nodeType === 3) { const o = this.orig.get(n); if (o && o.out === n.nodeValue && o.src !== o.out) n.nodeValue = o.src; this.orig.delete(n); }
      else for (const a of ['title', 'placeholder']) { const key = 'i18n' + a; if (n.dataset && n.dataset[key] !== undefined) { if (n.getAttribute(a) === n.dataset[key + 'out']) n.setAttribute(a, n.dataset[key]); delete n.dataset[key]; delete n.dataset[key + 'out']; } }
    }
  },
  setLang(lang) {
    lang = lang === 'en' ? 'en' : 'ja';
    if (lang === this.lang) return false;
    if (this.lang === 'en') { if (this.obs) this.obs.disconnect(); this.lang = 'ja'; this.restore(); }
    this.lang = lang;
    document.documentElement.lang = lang;
    if (lang === 'en') {
      if (typeof I18N_EN !== 'undefined' && !this._loaded) { this.dict = I18N_EN.dict; this.rules = I18N_EN.rules; this._loaded = true; }
      this.walk(document.body);
      if (!this.obs) this.obs = new MutationObserver((ms) => {
        for (const m of ms) {
          const t = m.target, el = t.nodeType === 1 ? t : t.parentElement;
          if (!el || el.closest(this.SKIP)) continue;
          if (m.type === 'characterData') this._text(t);
          else if (m.type === 'attributes') this._attrs(t);
          else for (const n of m.addedNodes) this.walk(n);
        }
      });
      this.obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder'] });
    }
    return true;
  },
};
// confirm / prompt のメッセージも訳す
(() => { const c = window.confirm.bind(window), p = window.prompt.bind(window); window.confirm = (m) => c(I18N.t(m)); window.prompt = (m, d) => p(I18N.t(m), d); })();
