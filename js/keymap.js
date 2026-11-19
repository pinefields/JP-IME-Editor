/* keymap.js — エディタのキー配列 (秀丸 / VS Code / Atom / Emacs / vi・Vim / nano / VZ Editor)
 *
 *   動作環境 → 環境 → キー配列 で選ぶ。秀丸(標準)は editor.js の onKey がそのまま処理し、
 *   それ以外は、ここで「その配列が割り当てているキー」だけを先に処理する(割り当てのないキーは標準の動作)。
 *   かな漢字変換の入力中・変換中は、どの配列でも IME(ATOK 準拠)のキーが優先される。
 *
 *   キー名:  C- = Ctrl, M- = Alt, S- = Shift (英字と特殊キーのみ)。 'C-x C-s' のような 2 ストロークも書ける。
 */
const Keymap = (() => {
  const N = { shiftKey: false };
  const L = (ja, en) => (Settings.data.lang === 'en' ? en : ja);
  const st = { id: 'hidemaru', prefix: '', prev: '', stack: [], clipLine: null, mark: null };
  const LIST = [['hidemaru', '秀丸エディタ (標準)'], ['vscode', 'Visual Studio Code'], ['atom', 'Atom'], ['emacs', 'Emacs'], ['vim', 'vi / Vim'], ['nano', 'nano'], ['vz', 'VZ Editor']];

  /* ------------------------------------------------------------ 共通の部品 */
  const eolPos = (ed, l) => ({ line: l, col: ed.doc.lines[l].length });
  const firstNB = (s) => s.match(/^[ \t　]*/)[0].length;
  const lastLine = (ed) => ed.doc.lines.length - 1;
  function setClip(ed, text, isLine) {
    ed.internalClip = text; st.clipLine = isLine ? text : null;
    ed.clipHistory.unshift(text); if (ed.clipHistory.length > 30) ed.clipHistory.pop();
    try { if (navigator.clipboard) navigator.clipboard.writeText(text.replace(/\n/g, ed.doc.eol)).catch(() => {}); } catch (e) {}
  }
  function remove(ed, a, b, kill, append) {
    if (posEq(a, b)) return;
    const t = ed.doc.getRange(a, b);
    if (kill) setClip(ed, append ? ed.internalClip + t : t, false);
    ed.doc.replaceRange(a, b, ''); ed.cur = { ...a }; ed.clearSelection(); ed.prefCol = null;
  }
  /** fn でカーソルを動かしてみて、行き先だけを返す(カーソルと選択は元に戻す) */
  function probe(ed, fn) {
    const c = { ...ed.cur }, an = ed.anchor, sm = ed.selMode, pc = ed.prefCol;
    ed.anchor = null; ed.selMode = false; fn();
    const r = { ...ed.cur }; ed.cur = c; ed.anchor = an; ed.selMode = sm; ed.prefCol = pc; return r;
  }
  function selLines(ed) { const s = ed.selection(); return s ? [s.a.line, (s.b.col === 0 && s.b.line > s.a.line) ? s.b.line - 1 : s.b.line] : [ed.cur.line, ed.cur.line]; }
  function cutLines(ed, l0, l1, kill, append) {
    const Ls = ed.doc.lines, text = Ls.slice(l0, l1 + 1).join('\n') + '\n';
    let a, b;
    if (l1 < Ls.length - 1) { a = { line: l0, col: 0 }; b = { line: l1 + 1, col: 0 }; }
    else if (l0 > 0) { a = eolPos(ed, l0 - 1); b = eolPos(ed, l1); }
    else { a = { line: 0, col: 0 }; b = eolPos(ed, l1); }
    if (kill) setClip(ed, append ? ed.internalClip + text : text, true);
    ed.doc.replaceRange(a, b, ''); ed.clearSelection();
    const nl = Math.min(l0, lastLine(ed)); ed.cur = { line: nl, col: firstNB(ed.doc.lines[nl]) }; ed.prefCol = null;
    return text;
  }
  function pasteLinewise(ed, text, above) {
    const t = text.replace(/\n$/, ''), l = ed.cur.line;
    if (above) { ed.doc.replaceRange({ line: l, col: 0 }, { line: l, col: 0 }, t + '\n'); ed.cur = { line: l, col: firstNB(ed.doc.lines[l]) }; }
    else { const e = eolPos(ed, l); ed.doc.replaceRange(e, e, '\n' + t); ed.cur = { line: l + 1, col: firstNB(ed.doc.lines[l + 1]) }; }
    ed.clearSelection(); ed.prefCol = null;
  }
  function moveLines(ed, dir) {
    const [l0, l1] = selLines(ed), Ls = ed.doc.lines;
    if (dir < 0 ? l0 === 0 : l1 === Ls.length - 1) return;
    const a = dir < 0 ? l0 - 1 : l0, b = dir < 0 ? l1 : l1 + 1, blk = Ls.slice(a, b + 1);
    if (dir < 0) blk.push(blk.shift()); else blk.unshift(blk.pop());
    const cur = { line: ed.cur.line + dir, col: ed.cur.col }, an = ed.anchor ? { line: ed.anchor.line + dir, col: ed.anchor.col } : null, sm = ed.selMode;
    ed.doc.replaceRange({ line: a, col: 0 }, eolPos(ed, b), blk.join('\n'));
    ed.cur = cur; ed.anchor = an; ed.selMode = sm;
  }
  function copyLines(ed, dir) {
    const [l0, l1] = selLines(ed), text = ed.doc.lines.slice(l0, l1 + 1).join('\n'), e = eolPos(ed, l1);
    const cur = { ...ed.cur }, an = ed.anchor ? { ...ed.anchor } : null, sm = ed.selMode, n = l1 - l0 + 1;
    ed.doc.replaceRange(e, e, '\n' + text);
    if (dir > 0) { cur.line += n; if (an) an.line += n; }
    ed.cur = cur; ed.anchor = an; ed.selMode = sm;
  }
  function commentPrefix(ed) {
    const m = /\.([^.]+)$/.exec(ed.fileName), x = m ? m[1].toLowerCase() : '';
    if (/^(py|sh|bash|rb|pl|ya?ml|toml|conf|ini|r|ps1|mk|awk)$/.test(x)) return '#';
    if (/^(bas|vbs|vba|frm|cls)$/.test(x)) return "'";
    if (/^(asm|z80|s|lisp|el|scm|clj)$/.test(x)) return ';';
    if (/^(sql|lua|hs|ada)$/.test(x)) return '--';
    if (/^(tex|sty|m)$/.test(x)) return '%';
    return '//';
  }
  function toggleComment(ed) {
    const [l0, l1] = selLines(ed), p = commentPrefix(ed), Ls = ed.doc.lines.slice(l0, l1 + 1);
    const re = new RegExp('^(\\s*)' + p.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') + ' ?');
    const all = Ls.some(s => s.trim()) && Ls.filter(s => s.trim()).every(s => re.test(s));
    const out = Ls.map(s => !s.trim() ? s : all ? s.replace(re, '$1') : s.replace(/^(\s*)/, (m0, w) => w + p + ' '));
    const cur = { ...ed.cur };
    ed.doc.replaceRange({ line: l0, col: 0 }, eolPos(ed, l1), out.join('\n')); ed.cur = cur; ed.clearSelection();
  }
  const BR = '()[]{}（）「」『』［］｛｝【】';
  function matchBracket(ed, pos) {
    const Ls = ed.doc.lines; let l = pos.line, c = -1, i = -1;
    for (let k = pos.col; k < Ls[l].length; k++) { const j = BR.indexOf(Ls[l][k]); if (j >= 0) { i = j; c = k; break; } }
    if (i < 0) return null;
    const open = BR[i & ~1], close = BR[i | 1], dir = (i & 1) ? -1 : 1; let depth = 0;
    for (;;) {
      const ch = Ls[l][c];
      if (ch === open) depth++; else if (ch === close) depth--;
      if (depth === 0) return { line: l, col: c };
      c += dir;
      while (c < 0 || c >= Ls[l].length) { l += dir; if (l < 0 || l >= Ls.length) return null; c = dir > 0 ? 0 : Ls[l].length - 1; }
    }
  }
  /** 検索して、見つかった先頭にカーソルを置く(選択はしない)。 pat を渡すと検索文字列を置き換える */
  function search(ed, dir, pat, regex) {
    if (pat !== undefined) { ed.find.text = pat; ed.find.regex = !!regex; ed.find.word = false; ed.find.fuzzy = false; ed.find.inSel = false; }
    const c0 = { ...ed.cur }, an = ed.anchor, sm = ed.selMode;
    ed.anchor = null; ed.selMode = false;
    if (dir > 0 && ed.cur.col < ed.doc.lines[ed.cur.line].length) ed.cur.col++;
    const ok = ed.findNext(dir);
    if (ok) { const s = ed.selection(); if (s) ed.cur = { ...s.a }; } else ed.cur = c0;
    ed.anchor = an; ed.selMode = sm; ed.prefCol = null;
    return ok;
  }
  function wordAt(ed) { const c = { ...ed.cur }; ed.selectWordAt(ed.cur.line, ed.cur.col); const t = ed.selectedText(); ed.clearSelection(); ed.cur = c; return t; }
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  function yank(ed) {
    const t = ed.internalClip; if (!t) { ed.cmd('paste'); return; }
    if (st.clipLine === t && !ed.selection()) { const c = ed.cur.col; pasteLinewise(ed, t, true); ed.cur = { line: ed.cur.line + t.split('\n').length - 1, col: Math.min(c, ed.doc.lines[Math.min(lastLine(ed), ed.cur.line + t.split('\n').length - 1)].length) }; }
    else ed.insertText(t);
  }
  /** 単語の終わりへ進む (Emacs の M-f) */
  function wordEndFwd(ed) {
    ed.startSelIfShift(N); ed.prefCol = null;
    const Ls = ed.doc.lines; let l = ed.cur.line, c = ed.cur.col;
    for (;;) { const s = Ls[l]; while (c < s.length && !/[\wぁ-ヶー一-龠々]/.test(s[c])) c++; if (c < s.length || l >= Ls.length - 1) break; l++; c = 0; }
    const s = Ls[l]; if (c < s.length) { const cls = ed.wordClass(s[c]); while (c < s.length && ed.wordClass(s[c]) === cls) c++; }
    ed.cur = { line: l, col: c };
  }
  function recenter(ed) { const lh = ed.lineHeight(), el = ed.el.editor; el.scrollTop = Math.max(0, ed.cur.line * lh - el.clientHeight / 2); }

  /* ------------------------------------------------------------ 動作 (名前 → [関数, 日本語, 英語]) */
  const A = {
    left: [(ed) => ed.moveHoriz(-1, N), '1 文字左', 'Left'], right: [(ed) => ed.moveHoriz(1, N), '1 文字右', 'Right'],
    up: [(ed) => ed.moveVert(-1, N), '1 行上', 'Up'], down: [(ed) => ed.moveVert(1, N), '1 行下', 'Down'],
    wordEnd: [(ed) => wordEndFwd(ed), '単語の終わりへ', 'Forward to end of word'],
    delWordEnd: [(ed) => remove(ed, ed.cur, probe(ed, () => wordEndFwd(ed)), true, st.prev === 'delWordEnd'), '単語の終わりまで削除', 'Kill to end of word'],
    wordLeft: [(ed) => ed.moveWord(-1, N), '前の単語', 'Previous word'], wordRight: [(ed) => ed.moveWord(1, N), '次の単語', 'Next word'],
    bol: [(ed) => { if (Settings.data.wrap) ed.rowEdge(-1, N); else { ed.startSelIfShift(N); ed.prefCol = null; ed.cur.col = 0; } }, '行頭', 'Start of line'],
    eol: [(ed) => { if (Settings.data.wrap) ed.rowEdge(1, N); else { ed.startSelIfShift(N); ed.prefCol = null; ed.cur.col = ed.doc.lines[ed.cur.line].length; } }, '行末', 'End of line'],
    top: [(ed) => { ed.startSelIfShift(N); ed.pushPos(); ed.cur = { line: 0, col: 0 }; }, '文書の先頭', 'Start of document'],
    bottom: [(ed) => { ed.startSelIfShift(N); ed.pushPos(); ed.cur = ed.docEnd(); }, '文書の末尾', 'End of document'],
    pgUp: [(ed) => ed.moveVert(-ed.pageLines(), N), '前のページ', 'Page up'], pgDn: [(ed) => ed.moveVert(ed.pageLines(), N), '次のページ', 'Page down'],
    scrollUp: [(ed) => { ed.el.editor.scrollTop -= ed.lineHeight(); return 'noscroll'; }, '1 行スクロール(上)', 'Scroll up one line'],
    scrollDown: [(ed) => { ed.el.editor.scrollTop += ed.lineHeight(); return 'noscroll'; }, '1 行スクロール(下)', 'Scroll down one line'],
    screenTop: [(ed) => { ed.startSelIfShift(N); ed.cur.line = Math.min(lastLine(ed), Math.ceil(ed.el.editor.scrollTop / ed.lineHeight())); }, '画面の先頭行', 'Top of screen'],
    screenBottom: [(ed) => { ed.startSelIfShift(N); ed.cur.line = Math.min(lastLine(ed), Math.floor((ed.el.editor.scrollTop + ed.el.editor.clientHeight) / ed.lineHeight()) - 1); }, '画面の最終行', 'Bottom of screen'],
    recenter: [(ed) => { recenter(ed); return 'noscroll'; }, 'カーソル行を画面中央に', 'Center cursor line'],
    del: [(ed) => { if (!ed.deleteSelection()) remove(ed, ed.cur, probe(ed, () => ed.moveHoriz(1, N))); }, '1 文字削除', 'Delete character'],
    bs: [(ed) => { if (!ed.deleteSelection()) remove(ed, probe(ed, () => ed.moveHoriz(-1, N)), ed.cur); }, '前の 1 文字を削除', 'Delete previous character'],
    delWordFwd: [(ed) => remove(ed, ed.cur, probe(ed, () => ed.moveWord(1, N)), true, st.prev === 'delWordFwd'), '単語を削除', 'Delete word'],
    delWordBack: [(ed) => remove(ed, probe(ed, () => ed.moveWord(-1, N)), ed.cur, true), '前の単語を削除', 'Delete previous word'],
    killToEol: [(ed) => remove(ed, ed.cur, eolPos(ed, ed.cur.line), true), '行末まで削除', 'Delete to end of line'],
    killToBol: [(ed) => remove(ed, { line: ed.cur.line, col: 0 }, ed.cur, true), '行頭まで削除', 'Delete to start of line'],
    killLine: [(ed) => { const e = eolPos(ed, ed.cur.line), ap = st.prev === 'killLine'; if (ed.cur.col < e.col) remove(ed, { ...ed.cur }, e, true, ap); else if (ed.cur.line < lastLine(ed)) remove(ed, { ...ed.cur }, { line: ed.cur.line + 1, col: 0 }, true, ap); }, '行末まで切り取り(続けて押すと追加)', 'Kill to end of line (repeats append)'],
    cutLine: [(ed) => { const s = ed.selection(); if (s) remove(ed, s.a, s.b, true); else cutLines(ed, ed.cur.line, ed.cur.line, true, st.prev === 'cutLine'); }, '行(選択範囲)を切り取り(続けて押すと追加)', 'Cut line or selection (repeats append)'],
    copyLine: [(ed) => { const s = ed.selection(); if (s) { setClip(ed, ed.doc.getRange(s.a, s.b), false); ed.clearSelection(); } else setClip(ed, ed.doc.lines[ed.cur.line] + '\n', true); }, '行(選択範囲)をコピー', 'Copy line or selection'],
    delLine: [(ed) => { const [a, b] = selLines(ed); cutLines(ed, a, b, false); }, '行を削除', 'Delete line'],
    dupLine: [(ed) => copyLines(ed, 1), '行(選択範囲の行)を複製', 'Duplicate line'],
    yank: [(ed) => yank(ed), '貼り付け', 'Paste'],
    setMark: [(ed) => { ed.selMode = true; ed.anchor = { ...ed.cur }; ed.flash(L('マークを設定しました', 'Mark set')); }, 'マーク設定(選択開始)', 'Set mark (start selection)'],
    markToggle: [(ed) => { if (ed.selMode || ed.selection()) ed.clearSelection(); else { ed.selMode = true; ed.anchor = { ...ed.cur }; } }, '選択の開始/解除', 'Toggle selection mode'],
    swapMark: [(ed) => { if (ed.anchor) { const a = ed.anchor; ed.anchor = { ...ed.cur }; ed.cur = { ...a }; } }, '選択範囲の反対側へ', 'Jump to other end of selection'],
    cancel: [(ed) => { ed.clearSelection(); UI.closeDialogs(); Menu.close(); }, '取り消し(選択解除)', 'Cancel'],
    killRegion: [(ed) => { const s = ed.selection(); if (s) remove(ed, s.a, s.b, true); }, '選択範囲を切り取り', 'Cut selection'],
    copyRegion: [(ed) => { const s = ed.selection(); if (s) { setClip(ed, ed.doc.getRange(s.a, s.b), false); ed.clearSelection(); } }, '選択範囲をコピー', 'Copy selection'],
    cutOrLine: [(ed) => { if (ed.selection()) return 'pass'; cutLines(ed, ed.cur.line, ed.cur.line, true); }, '切り取り(選択なしなら行ごと)', 'Cut (whole line if no selection)'],
    copyOrLine: [(ed) => { if (ed.selection()) return 'pass'; setClip(ed, ed.doc.lines[ed.cur.line] + '\n', true); }, 'コピー(選択なしなら行ごと)', 'Copy (whole line if no selection)'],
    pasteOrLine: [(ed) => { if (st.clipLine && st.clipLine === ed.internalClip && !ed.selection()) { yank(ed); return; } return 'pass'; }, '貼り付け', 'Paste'],
    newline: [(ed) => { let ins = '\n'; if (Settings.data.autoIndent) ins += ed.doc.lines[ed.cur.line].substring(0, ed.cur.col).match(/^[ \t　]*/)[0]; ed.insertText(ins); }, '改行', 'New line'],
    tab: [(ed) => ed.insertText(Settings.data.tabSpaces ? ' '.repeat(Settings.data.tabWidth - (ed.colWidth(ed.cur.line, ed.cur.col) % Settings.data.tabWidth)) : '\t'), 'タブ', 'Tab'],
    openLine: [(ed) => { const c = { ...ed.cur }; ed.doc.replaceRange(c, c, '\n'); ed.cur = c; }, 'カーソル位置で行を分割', 'Open line'],
    openBelow: [(ed) => { const l = ed.cur.line, e = eolPos(ed, l), ind = Settings.data.autoIndent ? ed.doc.lines[l].match(/^[ \t　]*/)[0] : ''; ed.clearSelection(); ed.doc.replaceRange(e, e, '\n' + ind); ed.cur = { line: l + 1, col: ind.length }; }, '下に行を挿入', 'Insert line below'],
    openAbove: [(ed) => { const l = ed.cur.line, ind = Settings.data.autoIndent ? ed.doc.lines[l].match(/^[ \t　]*/)[0] : ''; ed.clearSelection(); ed.doc.replaceRange({ line: l, col: 0 }, { line: l, col: 0 }, ind + '\n'); ed.cur = { line: l, col: ind.length }; }, '上に行を挿入', 'Insert line above'],
    moveLineUp: [(ed) => moveLines(ed, -1), '行を上へ移動', 'Move line up'], moveLineDown: [(ed) => moveLines(ed, 1), '行を下へ移動', 'Move line down'],
    copyLineUp: [(ed) => copyLines(ed, -1), '行を上へコピー', 'Copy line up'], copyLineDown: [(ed) => copyLines(ed, 1), '行を下へコピー', 'Copy line down'],
    selectLine: [(ed) => { const s = ed.selection(), l = s ? s.b.line + (s.b.col === 0 && s.b.line > s.a.line ? 0 : 1) : ed.cur.line + 1; if (!s) ed.anchor = { line: ed.cur.line, col: 0 }; ed.cur = l <= lastLine(ed) ? { line: l, col: 0 } : eolPos(ed, lastLine(ed)); }, '行を選択', 'Select line'],
    selectWord: [(ed) => ed.selectWordAt(ed.cur.line, ed.cur.col), '単語を選択', 'Select word'],
    selectAll: [(ed) => ed.cmd('selectAll'), 'すべて選択', 'Select all'],
    joinLines: [(ed) => { const l = ed.cur.line; if (l >= lastLine(ed)) return; const nx = ed.doc.lines[l + 1], e = eolPos(ed, l); ed.doc.replaceRange(e, { line: l + 1, col: firstNB(nx) }, (e.col && /[!-~]$/.test(ed.doc.lines[l]) && /^\s*[!-~]/.test(nx)) ? ' ' : ''); ed.cur = e; ed.clearSelection(); }, '次の行と連結', 'Join lines'],
    indent: [(ed) => ed.indent(), 'インデント', 'Indent'], unindent: [(ed) => ed.unindent(), '逆インデント', 'Outdent'],
    comment: [(ed) => toggleComment(ed), '行コメントの切り替え', 'Toggle line comment'],
    bracket: [(ed) => { const p = matchBracket(ed, ed.cur); if (p) { ed.startSelIfShift(N); ed.pushPos(); ed.cur = p; } }, '対応する括弧へ', 'Jump to matching bracket'],
    upper: [(ed) => ed.cmd('upper'), '大文字にする', 'Upper case'], lower: [(ed) => ed.cmd('lower'), '小文字にする', 'Lower case'],
    undo: [(ed) => ed.cmd('undo'), '元に戻す', 'Undo'], redo: [(ed) => ed.cmd('redo'), 'やり直し', 'Redo'],
    find: [() => UI.openFind(false), '検索', 'Find'], replace: [() => UI.openFind(true), '置換', 'Replace'],
    findNext: [(ed) => { ed.findNext(1); }, '次を検索', 'Find next'], findPrev: [(ed) => { ed.findNext(-1); }, '前を検索', 'Find previous'],
    findWord: [(ed) => { const w = wordAt(ed); if (w.trim()) search(ed, 1, w, false); }, 'カーソル位置の単語を検索', 'Search for word at cursor'],
    goto: [() => UI.openGoto(), '指定行へ移動', 'Go to line'],
    save: [(ed) => { ed.saveFile(false); }, '保存', 'Save'], saveAs: [(ed) => ed.cmd('saveAs'), '名前を付けて保存', 'Save as'],
    open: [(ed) => { ed.openFile(false); }, '開く', 'Open'], insertFile: [(ed) => ed.cmd('insertFile'), 'ファイルを挿入', 'Insert file'],
    exit: [(ed) => ed.cmd('exit'), '終了', 'Exit'], saveExit: [(ed) => ed.cmd('saveExit'), '保存して終了', 'Save and exit'],
    help: [() => UI.openHelp(), 'キー割り当ての表示', 'Show key bindings'],
    curPos: [(ed) => ed.flash(L(`${ed.cur.line + 1} / ${ed.doc.lines.length} 行、${ed.colWidth(ed.cur.line, ed.cur.col) + 1} 桁`, `line ${ed.cur.line + 1}/${ed.doc.lines.length}, col ${ed.colWidth(ed.cur.line, ed.cur.col) + 1}`)), 'カーソル位置を表示', 'Show cursor position'],
    imeToggle: [(ed) => ed.cmd('imetoggle'), 'IME の ON/OFF', 'Toggle IME'],
    overwrite: [(ed) => { ed.overwrite = !ed.overwrite; }, '挿入/上書きの切り替え', 'Toggle insert/overwrite'],
    wrap: [(ed) => ed.cmd('wrap'), '折り返しの切り替え', 'Toggle word wrap'], lineNumbers: [(ed) => ed.cmd('lineNumbers'), '行番号の表示切り替え', 'Toggle line numbers'],
    posMark: [(ed) => { st.mark = { ...ed.cur }; ed.flash(L('現在位置をマークしました', 'Position marked')); }, '現在位置をマーク', 'Mark position'],
    posJump: [(ed) => { if (st.mark) { const p = st.mark; st.mark = { ...ed.cur }; ed.jumpTo(p); } }, 'マークした位置へ', 'Jump to marked position'],
    // VZ のテキストスタック
    stackCut: [(ed) => { const s = ed.selection(); if (s) { st.stack.push({ t: ed.doc.getRange(s.a, s.b), l: false }); remove(ed, s.a, s.b, true); } else { const t = cutLines(ed, ed.cur.line, ed.cur.line, true); st.stack.push({ t, l: true }); } }, '行(選択範囲)を切り取ってスタックに積む', 'Cut line/selection (push to text stack)'],
    stackCopy: [(ed) => { const s = ed.selection(); if (s) { const t = ed.doc.getRange(s.a, s.b); st.stack.push({ t, l: false }); setClip(ed, t, false); ed.clearSelection(); } else { const t = ed.doc.lines[ed.cur.line] + '\n'; st.stack.push({ t, l: true }); setClip(ed, t, true); } }, '行(選択範囲)をコピーしてスタックに積む', 'Copy line/selection (push to text stack)'],
    stackPop: [(ed) => { const it = st.stack.pop(); if (!it) { yank(ed); return; } if (it.l) { const c = ed.cur.col; pasteLinewise(ed, it.t, true); ed.cur.col = Math.min(c, ed.doc.lines[ed.cur.line].length); } else ed.insertText(it.t); }, '貼り付け(スタックから取り出す)', 'Paste (pop from text stack)'],
    stackPaste: [(ed) => { const it = st.stack[st.stack.length - 1]; if (!it) { yank(ed); return; } if (it.l) { const c = ed.cur.col; pasteLinewise(ed, it.t, true); ed.cur.col = Math.min(c, ed.doc.lines[ed.cur.line].length); } else ed.insertText(it.t); }, '貼り付け(スタックは残す)', 'Paste (keep text stack)'],
    stackClear: [(ed) => { st.stack.length = 0; ed.flash(L('テキストスタックを空にしました', 'Text stack cleared')); }, 'テキストスタックを空にする', 'Clear text stack'],
  };

  /* ------------------------------------------------------------ キー配列 */
  const MAPS = {
    vscode: { keys: {
      'M-ArrowUp': 'moveLineUp', 'M-ArrowDown': 'moveLineDown', 'M-S-ArrowUp': 'copyLineUp', 'M-S-ArrowDown': 'copyLineDown',
      'C-S-k': 'delLine', 'C-Enter': 'openBelow', 'C-S-Enter': 'openAbove', 'C-l': 'selectLine', 'C-d': 'selectWord',
      'C-x': 'cutOrLine', 'C-c': 'copyOrLine', 'C-v': 'pasteOrLine', 'C-]': 'indent', 'C-[': 'unindent', 'C-/': 'comment', 'C-|': 'bracket', 'C-S-\\': 'bracket',
      'C-Backspace': 'delWordBack', 'C-Delete': 'delWordFwd', 'C-S-Backspace': 'killToBol', 'C-S-Delete': 'killToEol',
      'C-h': 'replace', 'C-g': 'goto', 'C-S-z': 'redo', 'M-z': 'wrap', 'S-Enter': 'findPrev' } },
    atom: { keys: {
      'C-ArrowUp': 'moveLineUp', 'C-ArrowDown': 'moveLineDown', 'C-S-d': 'dupLine', 'C-S-k': 'delLine', 'C-l': 'selectLine', 'C-d': 'selectWord',
      'C-x': 'cutOrLine', 'C-c': 'copyOrLine', 'C-v': 'pasteOrLine', 'C-j': 'joinLines', 'C-Enter': 'openBelow', 'C-S-Enter': 'openAbove',
      'C-]': 'indent', 'C-[': 'unindent', 'C-/': 'comment', 'C-m': 'bracket', 'C-Backspace': 'delWordBack', 'C-Delete': 'delWordFwd',
      'C-g': 'goto', 'C-S-z': 'redo', 'C-k C-u': 'upper', 'C-k C-l': 'lower' } },
    emacs: { meta: true, keys: {
      'C-f': 'right', 'C-b': 'left', 'C-n': 'down', 'C-p': 'up', 'C-a': 'bol', 'C-e': 'eol', 'M-f': 'wordEnd', 'M-b': 'wordLeft',
      'M-<': 'top', 'M->': 'bottom', 'C-v': 'pgDn', 'M-v': 'pgUp', 'C-l': 'recenter',
      'C-d': 'del', 'M-d': 'delWordEnd', 'M-Backspace': 'delWordBack', 'C-k': 'killLine', 'C-y': 'yank', 'C-w': 'killRegion', 'M-w': 'copyRegion',
      'C-Space': 'setMark', 'C-@': 'setMark', 'C-x C-x': 'swapMark', 'C-x h': 'selectAll', 'C-g': 'cancel',
      'C-/': 'undo', 'C-_': 'undo', 'C-x u': 'undo', 'C-?': 'redo', 'C-M-_': 'redo',
      'C-s': 'find', 'C-r': 'findPrev', 'M-%': 'replace', 'M-g g': 'goto', 'M-g M-g': 'goto',
      'C-o': 'openLine', 'C-j': 'newline', 'C-m': 'newline', 'M-^': 'joinLines', 'M-;': 'comment', 'M-u': 'upper', 'M-l': 'lower',
      'C-x C-s': 'save', 'C-x C-w': 'saveAs', 'C-x C-f': 'open', 'C-x i': 'insertFile', 'C-x C-c': 'exit', 'C-h': 'help', 'C-\\': 'imeToggle', 'C-x =': 'curPos' } },
    nano: { keys: {
      'C-g': 'help', 'F1': 'help', 'C-x': 'exit', 'F2': 'exit', 'C-o': 'save', 'F3': 'save', 'C-s': 'save', 'C-r': 'insertFile', 'F5': 'insertFile',
      'C-w': 'find', 'F6': 'find', 'C-\\': 'replace', 'M-r': 'replace', 'M-w': 'findNext', 'M-q': 'findPrev',
      'C-k': 'cutLine', 'F9': 'cutLine', 'C-u': 'yank', 'F10': 'yank', 'M-6': 'copyLine', 'M-^': 'copyLine', 'C-6': 'markToggle', 'C-^': 'markToggle', 'M-a': 'markToggle',
      'C-c': 'curPos', 'C-_': 'goto', 'C-/': 'goto', 'M-g': 'goto', 'C-y': 'pgUp', 'F7': 'pgUp', 'C-v': 'pgDn', 'F8': 'pgDn',
      'C-a': 'bol', 'C-e': 'eol', 'C-p': 'up', 'C-n': 'down', 'C-f': 'right', 'C-b': 'left', 'M-Space': 'wordLeft', 'M-\\': 'top', 'M-/': 'bottom', 'M-]': 'bracket',
      'C-d': 'del', 'C-h': 'bs', 'C-i': 'tab', 'C-m': 'newline', 'M-u': 'undo', 'M-e': 'redo', 'M-}': 'indent', 'M-{': 'unindent', 'M-3': 'comment',
      'C-l': 'recenter', 'M-n': 'lineNumbers', 'M-s': 'wrap', 'M-Delete': 'delLine', 'C-Delete': 'delWordFwd', 'C-Backspace': 'delWordBack' } },
    vz: { loose: true, keys: {
      'C-e': 'up', 'C-x': 'down', 'C-s': 'left', 'C-d': 'right', 'C-a': 'wordLeft', 'C-f': 'wordRight', 'C-r': 'pgUp', 'C-c': 'pgDn', 'C-w': 'scrollUp', 'C-z': 'scrollDown',
      'C-q s': 'bol', 'C-q d': 'eol', 'C-q r': 'top', 'C-q c': 'bottom', 'C-q e': 'screenTop', 'C-q x': 'screenBottom',
      'C-b': 'markToggle', 'C-q b': 'swapMark', 'C-q k': 'bracket', 'C-q j': 'goto', 'C-q m': 'posMark', 'C-q p': 'posJump',
      'C-h': 'bs', 'C-g': 'del', 'C-q h': 'delWordBack', 'C-t': 'delWordFwd', 'C-q t': 'killToBol', 'C-q y': 'killToEol', 'C-u': 'undo',
      'C-i': 'tab', 'C-m': 'newline', 'C-n': 'openAbove', 'C-k d': 'dupLine',
      'C-y': 'stackCut', 'C-j': 'stackPop', 'C-k k': 'stackCopy', 'C-k c': 'stackPaste', 'C-k y': 'stackClear',
      'C-q f': 'find', 'C-q a': 'replace', 'C-l': 'findWord', 'C-k u': 'undo', 'M-Backspace': 'undo', 'M-S-Backspace': 'redo', 'C-k s': 'save' } },
  };
  for (const m of Object.values(MAPS)) {
    if (m.meta) { for (const [k, a] of Object.entries(m.keys)) if (k.startsWith('M-') && !k.includes(' ')) m.keys['Escape ' + k.slice(2)] = a; }   // Esc x = M-x
    m.prefixes = new Set(); for (const k of Object.keys(m.keys)) { const i = k.indexOf(' '); if (i > 0) m.prefixes.add(k.substring(0, i)); }
  }
  /** ブラウザが先に取ってしまい、ページ側では止められないキー (通常のタブ)。全画面表示(F11)の間は使える */
  const RESERVED = ['C-n', 'C-t', 'C-w', 'C-S-n', 'C-S-t', 'C-S-w'];

  function keyName(e) {
    let k = e.key; if (k === ' ') k = 'Space';
    const letter = k.length === 1 && /[a-z]/i.test(k);
    if (letter) k = k.toLowerCase();
    return (e.ctrlKey ? 'C-' : '') + (e.altKey ? 'M-' : '') + (e.shiftKey && (letter || k.length > 1) ? 'S-' : '') + k;
  }
  function run(ed, act) {
    const r = A[act][0](ed); st.prev = act;            // 動作の中では st.prev が「直前の動作」(続けて押したかの判定用)
    if (r === 'pass') return 'pass';
    ed.clampCur(); if (r === 'noscroll') { const t = ed.el.editor.scrollTop; ed.render(); ed.el.editor.scrollTop = t; } else ed.render();
    return r;
  }

  /* ------------------------------------------------------------ vi / Vim */
  const v = { ic: false, mode: 'normal', count: '', op: '', opCount: 1, pend: '', vl: 0, keylog: [], last: null, changed: false, replaying: false, lastF: null, sdir: 1, vrange: null };
  const vReset = () => { v.count = ''; v.op = ''; v.opCount = 1; v.pend = ''; };
  const isVisual = () => v.mode === 'visual' || v.mode === 'vline';
  function exitVisual(ed) { if (isVisual()) v.mode = 'normal'; ed.clearSelection(); }
  function insertMode(ed) { exitVisual(ed); v.mode = 'insert'; }
  function fixV(ed) { if (v.mode !== 'vline') return; const l = ed.cur.line; if (l >= v.vl) { ed.anchor = { line: v.vl, col: 0 }; ed.cur = eolPos(ed, l); } else { ed.anchor = eolPos(ed, v.vl); ed.cur = { line: l, col: 0 }; } ed.selMode = true; }
  function wordEnd(ed) {
    const Ls = ed.doc.lines; let l = ed.cur.line, c = ed.cur.col + 1;
    for (;;) { const s = Ls[l]; while (c < s.length && /\s/.test(s[c])) c++; if (c < s.length) break; if (l >= Ls.length - 1) { ed.cur = { line: l, col: Math.max(0, s.length - 1) }; return; } l++; c = 0; }
    const s = Ls[l], cls = ed.wordClass(s[c]); while (c + 1 < s.length && ed.wordClass(s[c + 1]) === cls) c++;
    ed.cur = { line: l, col: c };
  }
  function findChar(ed, f, ch, n) {
    const s = ed.doc.lines[ed.cur.line]; let c = ed.cur.col;
    for (let i = 0; i < n; i++) { c = (f === 'f' || f === 't') ? s.indexOf(ch, c + 1 + (f === 't' && i === 0 && s[c + 1] === ch ? 1 : 0)) : s.lastIndexOf(ch, c - 1 - (f === 'T' && i === 0 && s[c - 1] === ch ? 1 : 0)); if (c < 0) return false; }
    ed.cur.col = f === 't' ? c - 1 : f === 'T' ? c + 1 : c; return true;
  }
  /** 移動コマンド。カーソルを動かして { lw: 行単位, inc: 終点を含む } を返す。移動コマンドでなければ null */
  function motion(ed, k, n, hasN) {
    const Ls = ed.doc.lines, cur = ed.cur; ed.prefCol = (k === 'j' || k === 'k') ? ed.prefCol : null;
    switch (k) {
      case 'h': cur.col = Math.max(0, cur.col - n); return {};
      case 'l': case ' ': cur.col = Math.min(Ls[cur.line].length, cur.col + n); return {};
      case 'j': case 'k': if (v.op) cur.line = Math.max(0, Math.min(Ls.length - 1, cur.line + (k === 'j' ? n : -n))); else ed.moveVert(k === 'j' ? n : -n, N); return { lw: true };      // オペレータの対象は論理行で数える
      case 'w': case 'W': for (let i = 0; i < n; i++) ed.moveWord(1, N); return {};
      case 'b': case 'B': for (let i = 0; i < n; i++) ed.moveWord(-1, N); return {};
      case 'e': case 'E': for (let i = 0; i < n; i++) wordEnd(ed); return { inc: true };
      case '0': cur.col = 0; return {};
      case '^': cur.col = firstNB(Ls[cur.line]); return {};
      case '$': cur.line = Math.min(Ls.length - 1, cur.line + n - 1); cur.col = Ls[cur.line].length; return {};
      case 'G': ed.pushPos(); cur.line = Math.min(Ls.length - 1, hasN ? n - 1 : Ls.length - 1); cur.col = firstNB(Ls[cur.line]); return { lw: true };
      case '}': for (let i = 0; i < n; i++) { let l = cur.line + 1; while (l < Ls.length - 1 && Ls[l].trim()) l++; cur.line = Math.min(l, Ls.length - 1); } cur.col = 0; return {};
      case '{': for (let i = 0; i < n; i++) { let l = cur.line - 1; while (l > 0 && Ls[l].trim()) l--; cur.line = Math.max(l, 0); } cur.col = 0; return {};
      case '%': { const p = matchBracket(ed, cur); if (!p) return { fail: true }; ed.pushPos(); ed.cur = p; return { inc: true }; }
      case ';': if (!v.lastF || !findChar(ed, v.lastF.f, v.lastF.ch, n)) return { fail: true }; return { inc: v.lastF.f === 'f' || v.lastF.f === 't' };
      case 'n': case 'N': { const d = (k === 'n' ? 1 : -1) * v.sdir; for (let i = 0; i < n; i++) if (!search(ed, d)) return { fail: true }; return {}; }
      case '+': ed.moveVert(n, N); ed.cur.col = firstNB(Ls[ed.cur.line]); return { lw: true };
      case '-': ed.moveVert(-n, N); ed.cur.col = firstNB(Ls[ed.cur.line]); return { lw: true };
      case 'H': A.screenTop[0](ed); return { lw: true };
      case 'L': A.screenBottom[0](ed); return { lw: true };
    }
    return null;
  }
  const flipCase = (t) => t.replace(/[a-zA-Zａ-ｚＡ-Ｚ]/g, c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase());
  function operate(ed, op, a, b, lw) {
    v.changed = op !== 'y';
    const conv = op === '~' ? flipCase : op === 'u' ? (t => t.toLowerCase()) : op === 'U' ? (t => t.toUpperCase()) : null;
    if (op === '>' || op === '<') {
      ed.selMode = false; ed.anchor = { line: a.line, col: 0 }; ed.cur = eolPos(ed, (!lw && b.col === 0 && b.line > a.line) ? b.line - 1 : b.line);
      if (op === '>') ed.indent(); else ed.unindent();
      ed.clearSelection(); ed.cur = { line: a.line, col: firstNB(ed.doc.lines[a.line]) };
    } else if (lw) {
      const l0 = a.line, l1 = b.line, text = ed.doc.lines.slice(l0, l1 + 1).join('\n') + '\n';
      if (conv) { ed.doc.replaceRange({ line: l0, col: 0 }, eolPos(ed, l1), conv(text.slice(0, -1))); ed.cur = { line: l0, col: firstNB(ed.doc.lines[l0]) }; }
      else if (op === 'y') { setClip(ed, text, true); ed.cur = { line: l0, col: Math.min(ed.cur.col, ed.doc.lines[l0].length) }; if (l1 > l0) ed.flash(L(`${l1 - l0 + 1} 行コピーしました`, `${l1 - l0 + 1} lines yanked`)); }
      else if (op === 'd') cutLines(ed, l0, l1, true);
      else if (op === 'c') { setClip(ed, text, true); const ind = Settings.data.autoIndent ? ed.doc.lines[l0].match(/^[ \t　]*/)[0] : ''; ed.doc.replaceRange({ line: l0, col: 0 }, eolPos(ed, l1), ind); ed.cur = { line: l0, col: ind.length }; }
    } else if (!posEq(a, b)) {
      const t = ed.doc.getRange(a, b);
      if (conv) { ed.doc.replaceRange(a, b, conv(t)); ed.cur = { ...a }; }
      else if (op === 'y') { setClip(ed, t, false); ed.cur = { ...a }; }
      else remove(ed, a, b, true);
    }
    exitVisual(ed);
    if (op === 'c') insertMode(ed);
  }
  function vimPaste(ed, before, n) {
    const t = ed.internalClip; if (!t) return; const lw = st.clipLine === t;
    for (let i = 0; i < n; i++) {
      if (lw) pasteLinewise(ed, t, before);
      else { if (!before && ed.cur.col < ed.doc.lines[ed.cur.line].length) ed.cur.col++; const s = { ...ed.cur }, end = ed.doc.replaceRange(s, s, t); ed.cur = t.includes('\n') ? s : { line: end.line, col: Math.max(0, end.col - 1) }; }
    }
    v.changed = true;
  }
  function textObj(ed, kind, k) {
    const s = ed.doc.lines[ed.cur.line], l = ed.cur.line, c = Math.min(ed.cur.col, Math.max(0, s.length - 1)); let a, b;
    if (!s.length) return null;
    if (k === 'w' || k === 'W') {
      const cls = ed.wordClass(s[c]); a = c; b = c + 1;
      while (a > 0 && ed.wordClass(s[a - 1]) === cls) a--; while (b < s.length && ed.wordClass(s[b]) === cls) b++;
      if (kind === 'a') { let b2 = b; while (b2 < s.length && /\s/.test(s[b2])) b2++; if (b2 > b) b = b2; else while (a > 0 && /\s/.test(s[a - 1])) a--; }
      return { a: { line: l, col: a }, b: { line: l, col: b } };
    }
    const P = { '"': '""', "'": "''", '`': '``', '(': '()', ')': '()', b: '()', '[': '[]', ']': '[]', '{': '{}', '}': '{}', B: '{}', '<': '<>', '>': '<>', '「': '「」', '」': '「」', '（': '（）', '）': '（）' }[k];
    if (!P) return null;
    const o = P[0], cl = P[1]; a = -1; b = -1;
    if (o === cl) { const ix = []; for (let i = 0; i < s.length; i++) if (s[i] === o) ix.push(i); for (let i = 0; i + 1 < ix.length; i += 2) if (ix[i + 1] >= c) { a = ix[i]; b = ix[i + 1]; break; } }
    else {
      let d = 0; for (let i = c; i >= 0; i--) { if (s[i] === cl && i !== c) d++; else if (s[i] === o) { if (d === 0) { a = i; break; } d--; } }
      if (a >= 0) { d = 0; for (let i = a + 1; i < s.length; i++) { if (s[i] === o) d++; else if (s[i] === cl) { if (d === 0) { b = i; break; } d--; } } }
    }
    if (a < 0 || b < 0) return null;
    return kind === 'i' ? { a: { line: l, col: a + 1 }, b: { line: l, col: b } } : { a: { line: l, col: a }, b: { line: l, col: b + 1 } };
  }
  /** 移動を実行する。オペレータ(d/y/c/>/<)が待っていれば、その範囲に適用する */
  function doMotion(ed, runM, n) {
    if (!v.op) { const m = runM(); vReset(); if (m) fixV(ed); return; }
    const start = { ...ed.cur }, sa = ed.anchor, sm = ed.selMode; ed.anchor = null; ed.selMode = false;
    const m = runM(), end = { ...ed.cur }; ed.cur = start; ed.anchor = sa; ed.selMode = sm;
    const op = v.op; vReset();
    if (!m || m.fail) return;
    let a = posLt(end, start) ? end : start, b = posLt(end, start) ? start : end;
    if (m.inc && !m.lw) b = { line: b.line, col: Math.min(b.col + 1, ed.doc.lines[b.line].length) };
    operate(ed, op, a, b, !!m.lw);
  }
  function vimJoin(ed, l0, l1) {
    for (let i = l0; i < l1 && l0 < lastLine(ed); i++) { ed.cur = { line: l0, col: 0 }; A.joinLines[0](ed); }
    v.changed = true;
  }
  function vimFeed(ed, k) {
    const Ls = ed.doc.lines;
    if (v.pend === 'r') { const n = parseInt(v.count, 10) || 1, s = Ls[ed.cur.line]; vReset(); if (k.length === 1 && ed.cur.col + n <= s.length) { const a = { ...ed.cur }; ed.doc.replaceRange(a, { line: a.line, col: a.col + n }, k.repeat(n)); ed.cur = { line: a.line, col: a.col + n - 1 }; v.changed = true; } return; }
    if (v.pend && 'fFtT'.includes(v.pend)) { const f = v.pend, n = (parseInt(v.count, 10) || 1) * v.opCount; v.pend = ''; v.lastF = { f, ch: k }; doMotion(ed, () => findChar(ed, f, k, n) ? { inc: f === 'f' || f === 't' } : { fail: true }); return; }
    if (/[1-9]/.test(k) || (k === '0' && v.count)) { v.count += k; return; }
    const hasN = v.count !== '' || v.opCount > 1, n = (parseInt(v.count, 10) || 1) * v.opCount;
    if (v.pend === 'g') {
      v.pend = '';
      if (k === 'g') { doMotion(ed, () => { ed.pushPos(); ed.cur.line = Math.min(lastLine(ed), hasN ? n - 1 : 0); ed.cur.col = firstNB(Ls[ed.cur.line]); return { lw: true }; }); return; }
      vReset(); return;
    }
    if (v.pend === 'Z') { vReset(); if (k === 'Z') ed.cmd('saveExit'); else if (k === 'Q') ed.cmd('exit'); return; }
    if (v.pend === 'i' || v.pend === 'a') {
      const o = textObj(ed, v.pend, k), op = v.op; vReset();
      if (!o) return;
      if (op) operate(ed, op, o.a, o.b, false); else if (isVisual()) { v.mode = 'visual'; ed.selMode = true; ed.anchor = o.a; ed.cur = { line: o.b.line, col: Math.max(o.a.col, o.b.col - 1) }; }
      return;
    }
    if (v.op) {
      if (k === v.op) { const op = v.op, l0 = ed.cur.line, l1 = Math.min(lastLine(ed), l0 + n - 1); vReset(); operate(ed, op, { line: l0, col: 0 }, { line: l1, col: 0 }, true); return; }
      if (k === 'i' || k === 'a' || k === 'g' || 'fFtT'.includes(k)) { v.pend = k; return; }
      let kk = k; if (v.op === 'c' && (k === 'w' || k === 'W') && /\S/.test(Ls[ed.cur.line][ed.cur.col] || '')) kk = 'e';
      doMotion(ed, () => motion(ed, kk, n, hasN)); return;
    }
    if (isVisual()) {
      const s = ed.selection() || { a: { ...ed.cur }, b: { ...ed.cur } }, lw = v.mode === 'vline';
      const opk = { d: 'd', x: 'd', X: 'd', D: 'd', y: 'y', Y: 'y', c: 'c', s: 'c', '>': '>', '<': '<', '~': '~', u: 'u', U: 'U' }[k];
      if (opk) { vReset(); operate(ed, opk, s.a, lw ? s.b : { line: s.b.line, col: Math.min(s.b.col + 1, Ls[s.b.line].length) }, lw); return; }      // ビジュアルモードはカーソル位置の文字を含む
      switch (k) {
        case 'J': vReset(); exitVisual(ed); vimJoin(ed, s.a.line, Math.max(s.b.line, s.a.line + 1)); return;
        case 'v': vReset(); if (v.mode === 'visual') exitVisual(ed); else v.mode = 'visual'; return;
        case 'V': vReset(); if (v.mode === 'vline') exitVisual(ed); else { v.mode = 'vline'; v.vl = ed.anchor ? ed.anchor.line : ed.cur.line; fixV(ed); } return;
        case 'o': vReset(); if (v.mode === 'visual' && ed.anchor) { const a = ed.anchor; ed.anchor = { ...ed.cur }; ed.cur = { ...a }; } return;
        case 'p': case 'P': { vReset(); const t = ed.internalClip, wasLine = st.clipLine; ed.doc.replaceRange(s.a, lw ? s.b : { line: s.b.line, col: Math.min(s.b.col + 1, Ls[s.b.line].length) }, ''); ed.cur = { ...s.a }; exitVisual(ed); ed.internalClip = t; st.clipLine = wasLine; vimPaste(ed, true, 1); return; }
        case ':': vReset(); v.vrange = [s.a.line, (s.b.col === 0 && s.b.line > s.a.line) ? s.b.line - 1 : s.b.line]; exitVisual(ed); cmdline(ed, ':', "'<,'>"); return;
        case 'i': case 'a': v.pend = k; return;
      }
    }
    switch (k) {
      case 'i': vReset(); insertMode(ed); return;
      case 'a': vReset(); if (ed.cur.col < Ls[ed.cur.line].length) ed.cur.col++; insertMode(ed); return;
      case 'I': vReset(); ed.cur.col = firstNB(Ls[ed.cur.line]); insertMode(ed); return;
      case 'A': vReset(); ed.cur.col = Ls[ed.cur.line].length; insertMode(ed); return;
      case 'o': vReset(); A.openBelow[0](ed); insertMode(ed); return;
      case 'O': vReset(); A.openAbove[0](ed); insertMode(ed); return;
      case 'x': vReset(); remove(ed, { ...ed.cur }, { line: ed.cur.line, col: Math.min(Ls[ed.cur.line].length, ed.cur.col + n) }, true); v.changed = true; return;
      case 'X': vReset(); remove(ed, { line: ed.cur.line, col: Math.max(0, ed.cur.col - n) }, { ...ed.cur }, true); v.changed = true; return;
      case 'D': vReset(); remove(ed, { ...ed.cur }, eolPos(ed, ed.cur.line), true); v.changed = true; return;
      case 'C': vReset(); remove(ed, { ...ed.cur }, eolPos(ed, ed.cur.line), true); insertMode(ed); return;
      case 's': vReset(); remove(ed, { ...ed.cur }, { line: ed.cur.line, col: Math.min(Ls[ed.cur.line].length, ed.cur.col + n) }, true); insertMode(ed); return;
      case 'S': vReset(); operate(ed, 'c', { line: ed.cur.line, col: 0 }, { line: Math.min(lastLine(ed), ed.cur.line + n - 1), col: 0 }, true); return;
      case 'Y': vReset(); operate(ed, 'y', { line: ed.cur.line, col: 0 }, { line: Math.min(lastLine(ed), ed.cur.line + n - 1), col: 0 }, true); return;
      case 'p': vReset(); vimPaste(ed, false, n); return;
      case 'P': vReset(); vimPaste(ed, true, n); return;
      case 'u': vReset(); for (let i = 0; i < n; i++) { const p = ed.doc.doUndo(); if (!p) { ed.flash(L('これ以上戻せません', 'Already at oldest change')); break; } ed.cur = p; } ed.clearSelection(); return;
      case 'J': vReset(); vimJoin(ed, ed.cur.line, ed.cur.line + Math.max(1, n - 1)); return;
      case '~': { vReset(); const a = { ...ed.cur }, b = { line: a.line, col: Math.min(Ls[a.line].length, a.col + n) }; if (!posEq(a, b)) { ed.doc.replaceRange(a, b, flipCase(ed.doc.getRange(a, b))); ed.cur = b; v.changed = true; } return; }
      case 'v': vReset(); v.mode = 'visual'; ed.selMode = true; ed.anchor = { ...ed.cur }; return;
      case 'V': vReset(); v.mode = 'vline'; v.vl = ed.cur.line; fixV(ed); return;
      case ':': vReset(); v.vrange = null; cmdline(ed, ':', ''); return;
      case '/': case '?': vReset(); cmdline(ed, k, ''); return;
      case '*': case '#': { vReset(); const w = wordAt(ed); if (w.trim()) { v.sdir = k === '*' ? 1 : -1; ed.find.icase = v.ic; search(ed, v.sdir, /^\w+$/.test(w) ? '\\b' + w + '\\b' : reEsc(w), true); fixV(ed); } return; }
      case '.': { vReset(); if (!v.last || v.replaying) return; v.replaying = true; for (let i = 0; i < n; i++) for (const kk of v.last) vimFeed(ed, kk); v.replaying = false; return; }
      case 'r': v.pend = 'r'; return;
      case 'd': case 'y': case 'c': case '>': case '<': v.op = k; v.opCount = n; v.count = ''; return;
      case 'g': case 'Z': case 'f': case 'F': case 't': case 'T': v.pend = k; return;
    }
    doMotion(ed, () => motion(ed, k, n, hasN));
  }
  function vimKey(ed, e) {
    const k = e.key, ctrl = e.ctrlKey;
    if (e.altKey) return false;
    if (v.mode === 'insert') {
      if (k === 'Escape' || (ctrl && k === '[')) { v.mode = 'normal'; if (ed.cur.col > 0) ed.cur.col--; ed.clearSelection(); ed.render(); return true; }
      return false;
    }
    if (ctrl) {
      const half = Math.max(1, ed.pageLines() >> 1);
      switch (k.toLowerCase()) {
        case 'f': ed.moveVert(ed.pageLines(), N); break;
        case 'b': ed.moveVert(-ed.pageLines(), N); break;
        case 'd': ed.moveVert(half, N); break;
        case 'u': ed.moveVert(-half, N); break;
        case 'e': ed.el.editor.scrollTop += ed.lineHeight(); return true;
        case 'y': ed.el.editor.scrollTop -= ed.lineHeight(); return true;
        case 'r': { const p = ed.doc.doRedo(); if (p) ed.cur = p; ed.clearSelection(); break; }
        case 'v': vimFeed(ed, 'v'); break;
        case '[': vReset(); exitVisual(ed); break;
        default: return false;
      }
      fixV(ed); ed.clampCur(); ed.render(); return true;
    }
    if (k.length > 1) {
      if (k === 'Escape') { vReset(); exitVisual(ed); v.keylog = []; }
      else if (k === 'Enter') { vReset(); ed.moveVert(1, N); ed.cur.col = firstNB(ed.doc.lines[ed.cur.line]); fixV(ed); }
      else if (k === 'Backspace') { vReset(); ed.moveHoriz(-1, N); }
      else if (/^F\d+$/.test(k)) return false;
      else { vReset(); return false; }                     // 矢印・Home・End・PageUp/Down・Delete は標準の動作
      ed.clampCur(); ed.render(); return true;
    }
    v.keylog.push(k);
    vimFeed(ed, k);
    if (!v.count && !v.op && !v.pend) { if (v.changed && v.mode !== 'insert' && !v.replaying) v.last = v.keylog.slice(); v.keylog = []; v.changed = false; }
    ed.clampCur(); ed.render(); return true;
  }
  /* ---- : / ? の入力行 */
  let box = null;
  function cmdline(ed, ch, preset) {
    if (!box) {
      box = document.createElement('div'); box.id = 'kmline'; box.setAttribute('data-noi18n', '');
      box.innerHTML = '<span></span><input type="text" spellcheck="false" autocomplete="off">';
      document.body.appendChild(box);
    }
    const inp = box.querySelector('input'), r = ed.el.editor.getBoundingClientRect();
    box.style.left = r.left + 'px'; box.style.width = r.width + 'px'; box.style.top = (r.bottom - 26) + 'px';
    box.querySelector('span').textContent = ch; inp.value = preset || ''; box.style.display = 'flex';
    const hide = () => { box.style.display = 'none'; };
    inp.onkeydown = (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); const val = inp.value; inp.onblur = null; hide(); ed.focus(); vimExec(ed, ch, val); ed.clampCur(); ed.render(); }
      else if (e.key === 'Escape' || (e.key === 'Backspace' && !inp.value)) { e.preventDefault(); e.stopPropagation(); inp.onblur = null; hide(); ed.focus(); }
    };
    inp.onblur = hide;
    setTimeout(() => inp.focus(), 0);
  }
  function vimExec(ed, ch, val) {
    const d = Settings.data;
    if (ch === '/' || ch === '?') { ed.find.icase = v.ic; v.sdir = ch === '/' ? 1 : -1; if (val) search(ed, v.sdir, val, true); else search(ed, v.sdir); return; }
    const cmd = val.trim(); if (!cmd) return;
    let m;
    if (/^\d+$/.test(cmd)) { ed.jumpTo({ line: Math.min(lastLine(ed), Math.max(0, parseInt(cmd, 10) - 1)), col: 0 }); return; }
    if (cmd === '$') { ed.jumpTo({ line: lastLine(ed), col: 0 }); return; }
    if ((m = /^(%|'<,'>|(\d+|\.|\$),(\d+|\.|\$))?s([^\w\s\\|"])(.*)$/.exec(cmd))) {
      const D = m[4], parts = ['']; let esc = false;
      for (const c of m[5]) { if (esc) { parts[parts.length - 1] += (c === D ? '' : '\\') + c; esc = false; } else if (c === '\\') esc = true; else if (c === D && parts.length < 3) parts.push(''); else parts[parts.length - 1] += c; }
      const pat = parts[0] || ed.find.text, flags = parts[2] || '';
      const rep = (parts[1] || '').replace(/\$/g, '$$$$').replace(/\\([0-9])/g, '$$$1').replace(/\\&/g, '\u0000').replace(/&/g, '$$&').replace(/\u0000/g, '&').replace(/\\r|\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
      const num = (x) => x === '.' ? ed.cur.line : x === '$' ? lastLine(ed) : parseInt(x, 10) - 1;
      let l0 = ed.cur.line, l1 = ed.cur.line;
      if (m[1] === '%') { l0 = 0; l1 = lastLine(ed); } else if (m[1] === "'<,'>") { if (v.vrange) [l0, l1] = v.vrange; } else if (m[1]) { l0 = num(m[2]); l1 = num(m[3]); }
      l0 = Math.max(0, Math.min(l0, lastLine(ed))); l1 = Math.max(l0, Math.min(l1, lastLine(ed)));
      let re; try { re = new RegExp(pat, (flags.includes('g') ? 'g' : '') + (flags.includes('i') || (v.ic && !flags.includes('I')) ? 'i' : '')); } catch (err) { ed.flash(L('正規表現が正しくありません: ', 'Invalid pattern: ') + pat); return; }
      let cnt = 0; const cre = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      const out = ed.doc.lines.slice(l0, l1 + 1).map(s => { const k = (s.match(cre) || []).length; cnt += re.global ? k : Math.min(1, k); return k ? s.replace(re, rep) : s; });
      if (!cnt) { ed.flash(L('見つかりません: ', 'Pattern not found: ') + pat); return; }
      ed.doc.replaceRange({ line: l0, col: 0 }, eolPos(ed, l1), out.join('\n')); ed.cur = { line: l0, col: 0 }; ed.clearSelection();
      ed.find.text = pat; ed.find.regex = true; ed.flash(L(`${cnt} 箇所を置換しました`, `${cnt} substitution${cnt > 1 ? 's' : ''}`)); return;
    }
    if ((m = /^se(?:t)?\s+(\w+?)(?:=(\d+))?$/.exec(cmd))) {
      const o = m[1], val2 = m[2] ? parseInt(m[2], 10) : 0, no = /^no/.test(o), name = o.replace(/^no/, '');
      if (name === 'nu' || name === 'number') d.lineNumbers = !no;
      else if (name === 'wrap') d.wrap = !no;
      else if (name === 'ic' || name === 'ignorecase') { v.ic = !no; ed.find.icase = v.ic; }
      else if (name === 'et' || name === 'expandtab') d.tabSpaces = !no;
      else if (name === 'ai' || name === 'autoindent') d.autoIndent = !no;
      else if ((name === 'ts' || name === 'tabstop' || name === 'sw' || name === 'shiftwidth') && val2 > 0) d.tabWidth = Math.min(16, val2);
      else { ed.flash(L('未対応のオプションです: ', 'Unknown option: ') + o); return; }
      Settings.save(); ed.applySettings(); return;
    }
    switch (cmd) {
      case 'w': case 'w!': ed.saveFile(false); return;
      case 'wq': case 'wq!': case 'x': ed.cmd('saveExit'); return;
      case 'q': ed.cmd('exit'); return;
      case 'q!': ed.doc.dirty = false; ed.cmd('exit'); return;
      case 'e': ed.openFile(false); return;
      case 'enew': case 'new': ed.cmd('new'); return;
      case 'sav': case 'saveas': ed.cmd('saveAs'); return;
      case 'r': ed.cmd('insertFile'); return;
      case 'u': case 'undo': ed.cmd('undo'); return;
      case 'red': case 'redo': ed.cmd('redo'); return;
      case 'noh': case 'nohlsearch': return;
      case 'h': case 'help': UI.openHelp(); return;
    }
    ed.flash(L('未対応のコマンドです: ', 'Not an editor command: ') + cmd);
  }
  const VIM_HELP = [
    ['h j k l / w b e / 0 ^ $ / gg G {n}G / { } / % / H L', 'カーソル移動(数を前置できる)', 'Cursor motions (with counts)'],
    ['f F t T ;', '行内の文字へ移動', 'Jump to a character in the line'],
    ['Ctrl+F Ctrl+B / Ctrl+D Ctrl+U / Ctrl+E Ctrl+Y', 'ページ・半ページ・1 行スクロール', 'Page, half page, line scroll'],
    ['i a I A o O', '挿入モードへ (Esc または Ctrl+[ で戻る)', 'Enter insert mode (Esc or Ctrl+[ to leave)'],
    ['x X D C s S r ~ J', '削除・置き換え・大小文字・行の連結', 'Delete, replace, case, join'],
    ['d y c > <  + 移動 / dd yy cc >> <<', 'オペレータ (dw, d$, y3j, ci" など)', 'Operators (dw, d$, y3j, ci" …)'],
    ['iw aw i" a" i( a( i[ i{ i「', 'テキストオブジェクト(括弧・引用符は同じ行の中)', 'Text objects (brackets and quotes within one line)'],
    ['p P / u Ctrl+R / .', '貼り付け / 元に戻す・やり直し / 繰り返し', 'Paste / undo, redo / repeat'],
    ['v V', 'ビジュアルモード (d y c > < ~ u U J p o :)', 'Visual mode (d y c > < ~ u U J p o :)'],
    ['/ ? n N * #', '検索 (JavaScript の正規表現)', 'Search (JavaScript regular expressions)'],
    [':w :q :q! :wq :x ZZ :e :r :{n} :$', '保存・終了・開く・挿入・行へ移動', 'Save, quit, open, read, go to line'],
    [':s/a/b/ :%s/a/b/g :\'<,\'>s/a/b/', '置換 (\\1 と & が使える)', 'Substitute (\\1 and & supported)'],
    [':set nu|nonu wrap|nowrap ic|noic et|noet ts=4', '表示・検索の設定', 'Options'],
  ];

  /* ------------------------------------------------------------ 入口 */
  function current() { const id = Settings.data.keymap || 'hidemaru'; if (id !== st.id) { st.id = id; st.prefix = ''; st.prev = ''; vReset(); v.mode = 'normal'; v.keylog = []; } return id; }
  function handle(ed, e) {
    const id = current(), k = e.key;
    if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'Process' || k === 'CapsLock') return false;
    if (ed.ime.active) return false;
    if (ed.keisenMode) {
      if (/^Arrow/.test(k) && !e.altKey) { Keisen.step(ed, k.slice(5).toLowerCase(), e.ctrlKey ? 0 : e.shiftKey ? 2 : 1); ed.render(); return true; }
      if (k === 'Escape') { ed.cmd('keisenToggle'); return true; }
    }
    if (id === 'hidemaru') return false;
    if (id === 'vim') return vimKey(ed, e);
    const map = MAPS[id], name = keyName(e);
    if (st.prefix) {
      const pre = st.prefix; st.prefix = '';
      let act = map.keys[pre + ' ' + name];
      if (!act && map.loose) act = map.keys[pre + ' ' + (name.startsWith('C-') ? name.slice(2) : 'C-' + name)];
      if (act) { if (run(ed, act) === 'pass') return false; }
      else { if (name !== 'C-g' && name !== 'Escape') ed.flash(show(pre + ' ' + name) + L(' は割り当てられていません', ' is undefined')); ed.render(); }
      return true;
    }
    if (map.prefixes.has(name)) { st.prefix = name; ed.render(); return true; }
    const act = map.keys[name];
    if (!act) { if (k.length === 1 || /^(Arrow|Page|Home|End|Enter|Backspace|Delete|Tab)/.test(k)) st.prev = ''; return false; }
    return run(ed, act) !== 'pass';
  }
  /** メニューの Alt+英字 より先に、キー配列がそのキーを使うか */
  function claims(e) {
    const ed = window.editor, id = current();
    if (!ed || id === 'hidemaru' || id === 'vim' || ed.ime.active || document.activeElement !== ed.el.kb) return false;
    if (st.prefix) return true;
    const name = keyName(e), map = MAPS[id];
    return !!map.keys[name] || map.prefixes.has(name);
  }
  const show = (k) => k.split(' ').map(s => s.replace(/^C-/, 'Ctrl+').replace(/(^|\+)M-/, '$1Alt+').replace(/(^|\+)S-/, '$1Shift+').replace(/Arrow(Up|Down|Left|Right)/, (m, d) => ({ Up: '↑', Down: '↓', Left: '←', Right: '→' })[d]).replace(/\+([a-z])$/, (m, c) => '+' + c.toUpperCase())).join(' ');
  /** ステータスバーの表示とカーソルの形 */
  function status(ed) {
    const id = current(); let el = document.getElementById('st-keymap');
    if (!el) { el = document.createElement('span'); el.id = 'st-keymap'; el.setAttribute('data-noi18n', ''); const ref = document.getElementById('st-msg'); ref.parentNode.insertBefore(el, ref); }
    let t = '';
    if (id === 'vim') t = (v.mode === 'insert' ? '-- INSERT --' : v.mode === 'visual' ? '-- VISUAL --' : v.mode === 'vline' ? '-- VISUAL LINE --' : '-- NORMAL --') + (v.count || v.op || v.pend ? '  ' + (v.opCount > 1 ? v.opCount : '') + v.op + v.count + v.pend : '');
    else if (st.prefix) t = show(st.prefix) + ' -';
    if (ed.keisenMode) t = L('[罫線モード] ', '[Line drawing] ') + t;
    el.textContent = t; el.style.display = t ? '' : 'none';
    ed.el.editor.classList.toggle('blockcaret', id === 'vim' && v.mode !== 'insert');
  }
  /** キー割り当て一覧 (ヘルプ画面用の HTML) */
  function helpHtml() {
    const id = current(), en = Settings.data.lang === 'en', escH = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    if (id === 'hidemaru') return '';
    const name = LIST.find(x => x[0] === id)[1];
    let rows = '';
    if (id === 'vim') rows = VIM_HELP.map(r => `<tr><td>${escH(r[0])}</td><td>${escH(en ? r[2] : r[1])}</td></tr>`).join('');
    else {
      const by = new Map();
      for (const [k, a] of Object.entries(MAPS[id].keys)) { if (k.startsWith('Escape ')) continue; if (!by.has(a)) by.set(a, []); by.get(a).push(show(k) + (RESERVED.includes(k) ? ' *' : '')); }
      rows = [...by].map(([a, ks]) => `<tr><td>${escH(ks.join(' / '))}</td><td>${escH(en ? A[a][2] : A[a][1])}</td></tr>`).join('');
    }
    const half = Math.ceil((rows.match(/<tr>/g) || []).length / 2), list = rows.split('</tr>').filter(Boolean).map(r => r + '</tr>');
    const note = id === 'vim' ? '' : `<div class="dim" style="margin-top:6px">${en
      ? '* The browser handles this key itself in a normal tab (new window, new tab, close tab). It reaches the editor only in full-screen mode (F11, or View → Full screen).' + (MAPS[id].meta ? ' Esc then a key works as Alt+key.' : '') + ' Keys not listed here keep their standard behaviour.'
      : '* 通常のタブではブラウザ自身が処理するキーです(新しいウィンドウ・新しいタブ・タブを閉じる)。全画面表示(F11 または 表示→全画面表示)の間だけエディタに届きます。' + (MAPS[id].meta ? ' Esc に続けてキーを押すと Alt+キー と同じ働きをします。' : '') + ' ここにないキーは標準の動作のままです。'}</div>`;
    return `<table class="keys">${list.join('')}</table>${note}`;
  }
  return { LIST, handle, claims, status, helpHtml, state: st, vim: v, MAPS, RESERVED };
})();
