# -*- coding: utf-8 -*-
"""
make_ime_files.py -- atokdic_dump.py が出力した TSV(#yomi word pos attr comment) から
                     Google日本語入力(Mozc) 用と Microsoft IME 用のインポートファイルを作る
使い方:  python3 make_ime_files.py <tsvのあるフォルダ> <出力フォルダ> [ファイル名の接頭辞 (既定: 辞書名から)]

 - 読みがひらがな(＋ー)だけの単語を出力する(英字・数字の読みは IME のユーザー辞書に登録できないため除外)
 - 動詞語幹・口語形など、そのままでは登録できない品詞は除外する(除外数はレポートに出る)
 - 形容詞語幹(新し) は「い」を付けて形容詞として登録する
 - 旧形式(4列: #yomi word attr comment) の TSV も読める
"""
import sys, os, glob, re, collections, datetime

# 抽出した品詞ラベル -> (Google日本語入力 の品詞, MS-IME の品詞)。None = 登録しない
POS = {
    '名詞': ('名詞', '名詞'), '名詞(御〜)': ('名詞', '名詞'), '単漢字': ('名詞', '名詞'),
    '英単語': ('アルファベット', '名詞'), '記号': ('記号', '名詞'), '数詞': ('数', '名詞'),
    'サ変名詞': ('名詞サ変', 'さ変名詞'), 'サ変名詞/形容動詞': ('名詞サ変', 'さ変名詞'),
    '形容動詞': ('名詞形動', '形容動詞'), '形容動詞(タリ)': ('名詞形動', '形容動詞'),
    '副詞': ('副詞', '副詞'), '副詞(〜と)': ('副詞', '副詞'), '副詞(2)': ('副詞', '副詞'),
    '連体詞': ('連体詞', '連体詞'), '接続詞': ('接続詞', '接続詞'), '感動詞': ('感動詞', '感動詞'),
    '独立語': ('独立語', '独立語'), '接頭語': ('接頭語', '接頭語'), '接頭語(数)': ('接頭語', '接頭語'),
    '接尾語': ('接尾一般', '接尾語'),
    '固有名詞': ('固有名詞', '固有名詞'), '商品名': ('固有名詞', '固有名詞'), '組織': ('組織', '固有名詞'),
    '人名': ('人名', '人名'), '人名(外国)': ('人名', '人名'), '姓': ('姓', '姓'), '姓/地名': ('姓', '姓'),
    '名': ('名', '名'), '地名': ('地名', '地名'), '地名/組織': ('地名', '地名'),
    '形容詞語幹': ('形容詞', '形容詞'),        # 「い」を付けて登録
    '住所': ('地名', '地名'), '文字': ('名詞', '名詞'), '名詞(時相)': ('名詞', '名詞'),
    # 旧形式(医療辞書'07)のラベル
    '品詞27': ('名詞形動', '形容動詞'), '品詞25': ('連体詞', '連体詞'), '品詞0e': ('副詞', '副詞'),
}
SKIP_PREFIX = ('動詞語幹', '口語', '形容詞語幹(口語)', '品詞')   # 登録しない品詞ラベルの先頭
DEFAULT = ('名詞', '名詞')
OLD_POS = {0x01: '名詞', 0x07: '固有名詞', 0x09: 'サ変名詞', 0x06: '組織', 0x27: '形容動詞', 0x25: '連体詞', 0x0e: '副詞'}

KANA = re.compile(r'^[ぁ-ゖー]+$')

def load_tsv(path):
    rows = []
    seen = set()
    name = None
    skipped = collections.Counter()
    with open(path, encoding='utf-8') as f:
        for line in f:
            if line.startswith('#dict\t'):
                name = line.split('\t')[1]
                continue
            if line.startswith('#') or not line.strip():
                continue
            cols = line.rstrip('\n').split('\t')
            if len(cols) == 4:                       # 旧形式: yomi word attr comment
                yomi, word, attr, comment = cols
                pos = OLD_POS.get(int(attr[4:6], 16) if len(attr) >= 6 else 1, '名詞')
            else:
                yomi, word, pos, attr, comment = cols[:5]
            yomi = yomi.replace('・', '').replace('゙', '').replace('゚', '')
            if not yomi or not word:
                skipped['空'] += 1; continue
            if not KANA.match(yomi):
                skipped['読みが仮名以外'] += 1; continue
            if pos == '形容詞語幹':
                yomi += 'い'; word += 'い'
            elif pos.startswith(SKIP_PREFIX) or pos not in POS:
                skipped[pos] += 1; continue
            key = (yomi, word)
            if key in seen:
                skipped['重複'] += 1; continue
            seen.add(key)
            rows.append((yomi, word, pos, comment))
    return name, rows, skipped

def write_google(rows, path):
    with open(path, 'w', encoding='utf-8', newline='\r\n') as f:
        for yomi, word, pos, comment in rows:
            f.write(f'{yomi}\t{word}\t{POS.get(pos, DEFAULT)[0]}\t{comment}\n')

def write_msime(rows, path, title):
    now = datetime.datetime.now().strftime('%Y/%m/%d %H:%M:%S')
    with open(path, 'w', encoding='utf-16-le', newline='\r\n') as f:
        f.write('﻿')
        f.write('!Microsoft IME Dictionary Tool\n!Version:\n!Format:WORDLIST\n')
        f.write(f'!User Dictionary Name: {title}\n!Output Date: {now}\n!\n')
        f.write('!読み\t語句\t品詞\tユーザーコメント\n')
        for yomi, word, pos, comment in rows:
            f.write(f'{yomi}\t{word}\t{POS.get(pos, DEFAULT)[1]}\t{comment}\n')

# IME のユーザー辞書向きでない辞書(文字表・部首表など)は作らない
EXCLUDE = ('文字コード', 'IVS辞書', '部首変換', '文書学習ツール')

def main():
    src, dst = sys.argv[1], sys.argv[2]
    prefix = sys.argv[3] if len(sys.argv) > 3 else ''
    os.makedirs(os.path.join(dst, 'google'), exist_ok=True)
    os.makedirs(os.path.join(dst, 'msime'), exist_ok=True)
    report = []
    for path in sorted(glob.glob(os.path.join(src, '*.tsv'))):
        stem = os.path.splitext(os.path.basename(path))[0]
        name, rows, skipped = load_tsv(path)
        jp = name or stem
        if any(x in jp for x in EXCLUDE) or not rows:
            print(f'{jp} ({stem}): スキップ (IME 登録向きでない / 登録できる語がない)')
            continue
        base = f'{prefix}_{jp}' if prefix else jp
        write_google(rows, os.path.join(dst, 'google', f'{base}_google.txt'))
        write_msime(rows, os.path.join(dst, 'msime', f'{base}_msime.txt'), base)
        pos = collections.Counter(POS.get(p, DEFAULT)[0] for _, _, p, _ in rows)
        report.append((jp, stem, len(rows), dict(pos.most_common(6)), dict(skipped.most_common(6))))
    for jp, stem, n, pos, skipped in report:
        print(f'{jp} ({stem}): {n} 語  品詞: {pos}  除外: {skipped}')

if __name__ == '__main__':
    main()
