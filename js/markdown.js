/* ============================================================================
 *  markdown.js -- 小さな Markdown (GFM風) レンダラ / 行ハイライト用トークナイザ
 * ========================================================================== */
'use strict';

const MD = {
  esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },

  /* ---------- インライン ---------- */
  inline(s) {
    let out = '', i = 0;
    const codes = [];
    // コードスパンを先に退避
    s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m, t, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    let h = this.esc(s);
    h = h.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (m, alt, src, title) => `<img alt="${alt}" src="${src}"${title ? ` title="${title}"` : ''}>`);
    h = h.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (m, t, href, title) => `<a href="${href}"${title ? ` title="${title}"` : ''}>${t}</a>`);
    h = h.replace(/&lt;(https?:\/\/[^&\s]+)&gt;/g, '<a href="$1">$1</a>');
    h = h.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>');
    h = h.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>');
    h = h.replace(/(\*|_)(?=\S)([^*_]*?\S)\1/g, '<em>$2</em>');
    h = h.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
    h = h.replace(/\\([\\`*_{}\[\]()#+\-.!>|~])/g, '$1');
    h = h.replace(/ {2,}$|\\$/, '<br>');
    h = h.replace(/\u0000(\d+)\u0000/g, (m, n) => `<code>${this.esc(codes[+n])}</code>`);
    return h;
  },

  /* ---------- ブロック ---------- */
  render(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    return this.blocks(lines);
  },
  blocks(lines) {
    let out = '', i = 0, para = [];
    const flush = () => { if (para.length) { out += `<p>${this.inline(para.join('\n'))}</p>\n`; para = []; } };
    while (i < lines.length) {
      const l = lines[i];
      // フェンスコード
      let m = l.match(/^ {0,3}(```+|~~~+)\s*([^`\s]*)/);
      if (m) { flush(); const fence = m[1][0], lang = m[2]; const buf = []; i++; while (i < lines.length && !lines[i].match(new RegExp(`^ {0,3}${fence === '`' ? '`{3,}' : '~{3,}'}\\s*$`))) buf.push(lines[i++]); i++; out += `<pre><code${lang ? ` class="language-${this.esc(lang)}"` : ''}>${this.esc(buf.join('\n'))}\n</code></pre>\n`; continue; }
      // 見出し
      m = l.match(/^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (m) { flush(); out += `<h${m[1].length}>${this.inline(m[2])}</h${m[1].length}>\n`; i++; continue; }
      // setext
      if (para.length && /^ {0,3}(=+|-+)\s*$/.test(l)) { const lv = l.trim()[0] === '=' ? 1 : 2; const t = para.join('\n'); para = []; out += `<h${lv}>${this.inline(t)}</h${lv}>\n`; i++; continue; }
      // 水平線
      if (/^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); out += '<hr>\n'; i++; continue; }
      // 引用
      if (/^ {0,3}>/.test(l)) { flush(); const buf = []; while (i < lines.length && /^ {0,3}>/.test(lines[i])) buf.push(lines[i++].replace(/^ {0,3}> ?/, '')); out += `<blockquote>\n${this.blocks(buf)}</blockquote>\n`; continue; }
      // 表
      if (/\|/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
        flush();
        const cells = (s) => { s = s.trim(); if (s.startsWith('|')) s = s.slice(1); if (s.endsWith('|')) s = s.slice(0, -1); return s.split(/(?<!\\)\|/).map(c => c.trim()); };
        const head = cells(l), aligns = cells(lines[i + 1]).map(a => /^:-+:$/.test(a) ? 'center' : /^-+:$/.test(a) ? 'right' : /^:-+$/.test(a) ? 'left' : '');
        out += '<table>\n<thead><tr>' + head.map((c, k) => `<th${aligns[k] ? ` align="${aligns[k]}"` : ''}>${this.inline(c)}</th>`).join('') + '</tr></thead>\n<tbody>\n';
        i += 2;
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) { const row = cells(lines[i++]); out += '<tr>' + head.map((_, k) => `<td${aligns[k] ? ` align="${aligns[k]}"` : ''}>${this.inline(row[k] || '')}</td>`).join('') + '</tr>\n'; }
        out += '</tbody>\n</table>\n'; continue;
      }
      // リスト
      m = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (m) {
        flush();
        const ordered = /\d/.test(m[2]), baseIndent = m[1].length;
        const items = [];
        while (i < lines.length) {
          const mm = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
          if (mm && mm[1].length <= baseIndent) { if (mm[1].length < baseIndent) break; items.push({ text: [mm[3]], sub: [] }); i++; continue; }
          if (!lines[i].trim()) { // 空行: 次がインデント継続なら続行
            if (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && items.length) { items[items.length - 1].sub.push(''); i++; continue; }
            break;
          }
          if (/^\s+/.test(lines[i]) && items.length) { items[items.length - 1].sub.push(lines[i].replace(new RegExp(`^ {0,${baseIndent + 2}}`), '')); i++; continue; }
          break;
        }
        const tag = ordered ? 'ol' : 'ul';
        out += `<${tag}>\n` + items.map(it => {
          let t = it.text.join(' '), cls = '';
          const task = t.match(/^\[([ xX])\]\s+(.*)$/);
          if (task) { cls = ' class="task"'; t = `<input type="checkbox" disabled${task[1] !== ' ' ? ' checked' : ''}> ${task[2]}`; }
          else t = this.inline(t);
          const sub = it.sub.length ? this.blocks(it.sub) : '';
          return `<li${cls}>${t}${sub ? '\n' + sub : ''}</li>`;
        }).join('\n') + `\n</${tag}>\n`;
        continue;
      }
      // インデントコード
      if (/^( {4}|\t)/.test(l) && !para.length) { const buf = []; while (i < lines.length && (/^( {4}|\t)/.test(lines[i]) || !lines[i].trim())) buf.push(lines[i++].replace(/^( {4}|\t)/, '')); while (buf.length && !buf[buf.length - 1].trim()) buf.pop(); out += `<pre><code>${this.esc(buf.join('\n'))}\n</code></pre>\n`; continue; }
      // HTMLブロック (そのまま)
      if (/^ {0,3}<\/?[a-zA-Z][^>]*>/.test(l) && !para.length) { flush(); const buf = []; while (i < lines.length && lines[i].trim()) buf.push(lines[i++]); out += buf.join('\n') + '\n'; continue; }
      // 空行
      if (!l.trim()) { flush(); i++; continue; }
      para.push(l); i++;
    }
    flush();
    return out;
  },

  /* ---------- 見出し一覧 ---------- */
  headings(lines) {
    const out = []; let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^ {0,3}(```|~~~)/.test(l)) { inFence = !inFence; continue; }
      if (inFence) continue;
      const m = l.match(/^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (m) out.push({ line: i, level: m[1].length, text: m[2] });
      else if (i + 1 < lines.length && l.trim() && /^ {0,3}(=+|-+)\s*$/.test(lines[i + 1]) && !/^\s*[-*+]\s/.test(l)) out.push({ line: i, level: lines[i + 1].trim()[0] === '=' ? 1 : 2, text: l.trim() });
    }
    return out;
  },

  /* ---------- 行ハイライト用: 行内トークン [a,b,cls] ---------- */
  fenceMap(lines) {
    const inFence = new Array(lines.length); let f = false;
    for (let i = 0; i < lines.length; i++) { const isFence = /^ {0,3}(```|~~~)/.test(lines[i]); if (isFence) { inFence[i] = 'fence'; f = !f; continue; } inFence[i] = f; }
    return inFence;
  },
  lineTokens(text, fenceState) {
    const t = [];
    if (fenceState === 'fence') return [[0, text.length, 'md-fence']];
    if (fenceState === true) return [[0, text.length, 'md-code']];
    let m;
    if ((m = text.match(/^ {0,3}#{1,6}\s/))) { t.push([0, text.length, 'md-h' + Math.min(6, m[0].trim().length)]); return t; }
    if ((m = text.match(/^ {0,3}>+/))) t.push([0, m[0].length, 'md-quote']);
    if ((m = text.match(/^(\s*)([-*+]|\d+[.)])\s/))) { t.push([m[1].length, m[0].length, 'md-bullet']); const task = text.slice(m[0].length).match(/^\[[ xX]\]/); if (task) t.push([m[0].length, m[0].length + 3, 'md-task']); }
    if (/^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(text)) { t.push([0, text.length, 'md-hr']); return t; }
    if (/^\s*\|.*\|\s*$/.test(text) || /^\s*\|?\s*:?-+:?\s*\|/.test(text)) { for (const mm of text.matchAll(/\|/g)) t.push([mm.index, mm.index + 1, 'md-pipe']); }
    const re = /(`+)[^`]+?\1|!\[[^\]]*\]\([^)]*\)|\[[^\]]+\]\([^)]*\)|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*\s][^*]*\*|_[^_\s][^_]*_|https?:\/\/[^\s<)]+/g;
    for (const mm of text.matchAll(re)) {
      const s = mm[0]; let cls = 'md-em';
      if (s[0] === '`') cls = 'md-icode'; else if (s[0] === '!') cls = 'md-img'; else if (s[0] === '[' || s.startsWith('http')) cls = 'md-link'; else if (s.startsWith('**') || s.startsWith('__')) cls = 'md-strong'; else if (s.startsWith('~~')) cls = 'md-del';
      t.push([mm.index, mm.index + s.length, cls]);
    }
    return t;
  },

  /* ---------- HTML 書き出し ---------- */
  document(title, body, dark) {
    return `<!DOCTYPE html>\n<html lang="ja"><head><meta charset="utf-8"><title>${this.esc(title)}</title>\n<style>${this.css(dark)}</style></head>\n<body class="md">\n${body}</body></html>\n`;
  },
  css(dark) {
    return `body.md,.md{font-family:-apple-system,"Segoe UI","Meiryo",sans-serif;line-height:1.7;max-width:860px;margin:0 auto;padding:16px 28px;color:${dark ? '#ddd' : '#24292f'};background:${dark ? '#1e1e1e' : '#fff'}}
.md h1,.md h2{border-bottom:1px solid ${dark ? '#444' : '#d8dee4'};padding-bottom:.3em;margin-top:1.4em}.md h1{font-size:1.9em}.md h2{font-size:1.5em}.md h3{font-size:1.25em}
.md pre{background:${dark ? '#2d2d2d' : '#f6f8fa'};padding:12px 14px;border-radius:6px;overflow:auto;font-size:.92em}.md code{font-family:Consolas,"MS Gothic",monospace;background:${dark ? '#333' : '#eef1f4'};padding:1px 5px;border-radius:4px;font-size:.92em}.md pre code{background:none;padding:0}
.md blockquote{border-left:4px solid ${dark ? '#555' : '#d0d7de'};color:${dark ? '#aaa' : '#57606a'};margin:0;padding:0 1em}
.md table{border-collapse:collapse;margin:1em 0}.md th,.md td{border:1px solid ${dark ? '#555' : '#d0d7de'};padding:5px 12px}.md th{background:${dark ? '#333' : '#f6f8fa'}}
.md img{max-width:100%}.md hr{border:0;border-top:2px solid ${dark ? '#444' : '#d8dee4'};margin:1.5em 0}.md li.task{list-style:none;margin-left:-1.3em}.md a{color:${dark ? '#6cb6ff' : '#0969da'}}`;
  }
};
window.MD = MD;
