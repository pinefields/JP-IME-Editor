# -*- coding: utf-8 -*-
"""
atokdic_dump.py -- ATOK の辞書ファイル(.dic / .DIC) から 読み・単語・品詞・コメント を抽出して TSV に書き出す

使い方:  python3 atokdic_dump.py <辞書ファイル> [出力.tsv]

対応形式(解析・検証済み):
  形式1  "DIC\\0\\0\\0\\0\\0ATOK\\0\\0\\0\\0"   版情報 0x10: 00 00 00 A0 ..   (医療辞書'07 for ATOK: Atk_MD*.dic)
         単語属性が 6 バイト固定  03 01 品詞 02 F1 F2  (+拡張)
  形式2  "DIC\\0\\0\\0\\0\\0ATOK30\\0\\0"  版情報 0x10: 00 00 00 19 ..   (ATOK Pro 4 / ATOK 2017 世代の
         標準辞書・人名辞書・単漢字辞書・記号辞書・専門用語辞書・カタカナ語英語辞書・日本語英語辞書など)
         単語属性が可変長のビットフィールド  A0 A1 [A0 のビットで決まる付加バイト] F1 F2 [F1/F2 のビットで決まる可変長フィールド]
  どちらも 読みのトライ(ダブル配列) + グループ表 + 単語データ というブロック構造は共通。
  形式はヘッダーで判定し、ブロックの先頭グループで検証して決める(判定できなければ両方試す)。

  ※ 同じ "ATOK" ヘッダーでも 郵便番号辞書/町名住所変換辞書/文字コード辞書/部首変換辞書/IVS辞書 などの
    特殊用途辞書は別のブロック構造で、このスクリプトでは blocks=0 となり何も出力されません。

共通構造:
  0x000  ヘッダー: "DIC\\0\\0\\0\\0\\0ATOK..", 0x40〜 辞書名(Shift_JIS)
  0x700  文字コード表: 読みの1バイト文字(JIS X 0201 半角カナ/ASCII) → 内部コード (256 x u16BE)
  0x900〜 ブロック索引(読み先頭 → ブロック; 本スクリプトは全走査するので未使用)
  データブロック(多くは 0x100 境界):
    [ノード配列]  u16BE (val, chk) のペア。node0=(最大ノード番号, グループ数), node1=ルート(BASE, 0)
                   ダブル配列トライ: 子ノード = BASE[親] + 内部コード(文字), chk[子] = 親
                   終端は内部コード 0x01 の遷移先で、val が負(= −グループ番号)
    [グループ表]   flags(4B) + off(u16BE) + len(u16BE) × グループ数
    [件数]         先頭グループの単語数 (00 + LEB128)
    [単語データ]   グループ(=読み)ごとに [LEB128長][単語 UTF-16BE][属性] ... 末尾 = 次グループの件数(00 + LEB128)
                   単語長0 = 読みのカタカナ表記、単語 00(1B) = 読みそのもの(ひらがな語)

形式1 の属性:  03 01 品詞 X F1 F2   (X: 02 通常 / 03 IVS など)
                 F1&0x10: タグ1B
                 F2&0x10: LEB128長 + [件数][各項目: LEB128長 + ff 02 LEB128長 + コメント UTF-16BE]
形式2 の属性:  A0 A1 [付加] F1 F2 [可変長フィールド]
                 A1 = 品詞クラス (01 名詞, 02 固有名詞, 08 サ変名詞, 0c 形容動詞, 10 副詞, 80/82 動詞語幹,
                      a0 形容詞語幹, e0 単漢字/英単語, e1 記号 など)
                 A0 のビット → 付加バイト数: 0x80→1 (固有名詞の種別: 80 姓, 40 名, 20 外国人名, 10 地名, 08 組織, 04 商品名),
                      0x20→2, 0x10→3, 0x08→3, 0x04→1
                 F1: 0x10 タグ1B, 0x08 2B, 0x02 LEB128長+データ, 0x01 LEB128長+u16列(連接情報)
                 F2: 0x80 LEB128長+データ, 0x40 LEB128長+連接語, 0x20/0x10 LEB128長+項目リスト(コメント等),
                     0x04 LEB128長+構成語    (この順に並ぶ)
                 項目リスト = [件数] { [LEB128長][種別1B][内容] }
                     種別 0f/07: 12 長 表記, n 長 テキスト×n (64文字=128Bごとに分割されたコメント)
                     種別 ff   : 02 長 テキスト (旧形式と同じコメント)
                     種別 01/08: 02 長 テキスト (正しい読み)   02/03: 02 長 テキスト (本則の読み)
                     種別 04/1e: 10 件数 {長 テキスト} (商標の一般名称)   それ以外: 連語・用例などの内部データ(未出力)
"""
import sys, struct, os, collections, unicodedata

# --------------------------------------------------------------------------- 基本
def varint(b, i):
    """LEB128 (7bit little-endian groups, MSB = continue)"""
    v = 0; shift = 0
    while True:
        x = b[i]; i += 1
        v |= (x & 0x7f) << shift
        if not (x & 0x80):
            return v, i
        shift += 7

def load(path):
    with open(path, 'rb') as f:
        return f.read()

def header_info(d):
    magic = d[8:16].rstrip(b'\0').decode('ascii', 'replace')
    name = d[0x40:0x80].split(b'\0')[0].decode('cp932', 'replace')
    return magic, name, d[0x10:0x18].hex(' ')

def code_table(d):
    """byte -> code, and inverse code -> byte"""
    fwd = [struct.unpack('>H', d[0x700 + 2*i:0x702 + 2*i])[0] for i in range(256)]
    inv = {}
    for b, c in enumerate(fwd):
        inv.setdefault(c, b)
    return fwd, inv

def find_blocks(d):
    """ブロック(ノード配列+グループ表+単語データ)の先頭位置を全走査で探す。
    多くは 0x100 境界にあるが、そうでないものも少数ある。"""
    blocks = []
    n = len(d)
    p = 0x100
    unpack4 = struct.Struct('>HHHH').unpack_from
    unpackHH = struct.Struct('>HH').unpack_from
    while p < n - 16:
        maxnode, nl, rb, rc = unpack4(d, p)
        if rc != 0 or nl < 1 or nl > 4000 or maxnode < nl or maxnode > 0x8000 or rb < 1:
            p += 1; continue
        gt = p + (maxnode + 1) * 4
        if gt + 8*nl + 2 > n:
            p += 1; continue
        rng = [unpackHH(d, gt + 8*k + 4) for k in range(nl)]
        if any(ln < 2 for off, ln in rng):
            p += 1; continue
        ok = True; expect = 0                      # グループは順不同でもよいが、隙間なく敷き詰められていること
        for off, ln in sorted(rng):
            if off != expect:
                ok = False; break
            expect = off + ln
        if not ok:
            p += 1; continue
        base = gt + 8*nl + 2                       # 各グループ直前の 00(件数マーカー) と件数(1以上)を確認
        if any(d[base + off - 2] != 0 or d[base + off - 1] == 0 for off, ln in rng):
            p += 1; continue
        nterm = 0
        for i in range(2, maxnode + 1):
            v, c = struct.unpack_from('>hH', d, p + 4*i)
            if v < 0 and c != 0:
                nterm += 1
        if nterm != nl:
            p += 1; continue
        blocks.append(p)
        p = gt + 8*nl + expect          # skip past this block's entry data (the last group's
                                        # len covers 2 bytes that may already belong to the next block)
    return blocks

def kana_to_hira(s):
    s = unicodedata.normalize('NFKC', s)   # 半角カナ→全角カナ(濁点合成)
    out = []
    for ch in s:
        o = ord(ch)
        if 0x30A1 <= o <= 0x30F6:
            out.append(chr(o - 0x60))
        else:
            out.append(ch)
    return ''.join(out)

def hira_to_kata(s):
    return ''.join(chr(ord(c) + 0x60) if 0x3041 <= ord(c) <= 0x3096 else c for c in s)

def block_readings(d, p, inv, stats):
    """ブロック内の 終端ノード → 読み を復元して {グループ番号: 読み} を返す"""
    maxnode, nl, rootbase, _ = struct.unpack('>HHHH', d[p:p+8])
    readings = {}
    for i in range(2, maxnode + 1):
        val, chk = struct.unpack('>hH', d[p + 4*i:p + 4*i + 4])
        if val >= 0 or chk == 0:
            continue
        g = -val
        codes = []
        cur = chk
        guard = 0
        while cur != 1 and guard < 64:
            v, c = struct.unpack('>hH', d[p + 4*cur:p + 4*cur + 4])
            pv, _ = struct.unpack('>hH', d[p + 4*c:p + 4*c + 4])
            codes.append(cur - pv)
            cur = c
            guard += 1
        if cur != 1:
            stats['bad_walk'] += 1
            continue
        try:
            raw = bytes(inv[cc] for cc in reversed(codes))
            yomi = kana_to_hira(raw.decode('cp932'))
        except Exception:
            stats['bad_code'] += 1
            yomi = '?' + ','.join(f'{cc:x}' for cc in reversed(codes))
        if g in readings:
            stats['dup_group'] += 1
        readings[g] = yomi
    if len(readings) != nl:
        stats['group_count_mismatch'] += 1
    return readings

def block_groups(d, p):
    """(グループ表の [(off,len)...], 単語データ基点) を返す"""
    maxnode, nl, _, _ = struct.unpack('>HHHH', d[p:p+8])
    gt = p + (maxnode + 1) * 4
    groups = [struct.unpack('>HH', d[gt + 8*k + 4:gt + 8*k + 8]) for k in range(nl)]
    return groups, gt + 8*nl + 2

def word_of(wraw, wl, yomi, stats):
    if wraw == b'\x00':
        stats['word_eq_yomi'] += 1
        return yomi                      # 単語＝読み(ひらがな語)の省略表記
    if wl == 0:
        stats['word_eq_kata'] += 1
        return hira_to_kata(yomi)        # 単語＝読みのカタカナ表記の省略表記
    try:
        return wraw.decode('utf-16-be')
    except Exception:
        stats['bad_word'] += 1
        return '<' + wraw.hex() + '>'

def utf16(b):
    return b.decode('utf-16-be', 'replace').replace('\n', '／').replace('\t', ' ').replace('\r', '')

# --------------------------------------------------------------------------- 形式1 (医療辞書'07 世代)
POS_V1 = {
    0x01: '名詞', 0x02: '姓', 0x03: '名', 0x04: '人名', 0x05: '地名', 0x06: '組織', 0x07: '固有名詞',
    0x09: 'サ変名詞', 0x0e: '副詞', 0x25: '連体詞', 0x27: '形容動詞', 0x29: '文字',
}

def parse_group_v1(g, yomi, stats):
    """1グループ(=1読み)の単語データを解析して [(yomi, word, pos, attr, comment)] を返す"""
    q = 0
    ents = []
    while q < len(g):
        wl, q = varint(g, q)
        wraw = g[q:q+wl]; q += wl
        word = word_of(wraw, wl, yomi, stats)
        attr = g[q:q+6]; q += 6
        if len(attr) < 6 or attr[0] != 0x03 or attr[1] != 0x01 or not (2 <= attr[3] <= 4):
            raise ValueError('attr %s' % attr.hex())
        comments = []
        tag = None
        if attr[4] & 0x10:
            tag = g[q]; q += 1
            stats['tags'][tag] += 1
        if attr[5] & 0x10:
            l1, q = varint(g, q)
            body = g[q:q+l1]; q += l1
            n_items, j = varint(body, 0)
            for _ in range(n_items):
                li, j = varint(body, j)
                item = body[j:j+li]; j += li
                try:
                    comments.extend(parse_item_v2(item, stats))
                except Exception:
                    stats['item_err'] += 1
            if j != len(body):
                stats['body_leftover'] += 1
        pos = POS_V1.get(attr[2], '品詞%02x' % attr[2])
        a = attr.hex() + ('/%02x' % tag if tag is not None else '')
        stats['attr'][attr.hex()] += 1
        ents.append((yomi, word, pos, a, '｜'.join(comments)))
    return ents

# --------------------------------------------------------------------------- 形式2 (ATOK30 = ATOK Pro 4 世代)
A0_EXTRA = {0x80: 1, 0x20: 2, 0x10: 3, 0x08: 3, 0x04: 1, 0x02: 1, 0x01: 1}   # A0 のビット → 付加バイト数
A0_UNKNOWN = 0x40

POS_V2 = {
    0x01: '名詞', 0x08: 'サ変名詞', 0x0a: '名詞(御〜)', 0x0c: '形容動詞', 0x0e: 'サ変名詞/形容動詞',
    0x10: '副詞', 0x11: '副詞(〜と)', 0x20: '数詞', 0x40: '連体詞', 0x42: '接続詞', 0x44: '感動詞',
    0x46: '独立語', 0x60: '接頭語', 0x62: '接頭語(数)', 0x64: '接尾語',
    0x80: '動詞語幹(五段)', 0x82: '動詞語幹(一段)', 0x84: '動詞語幹(カ変)', 0x86: '動詞語幹(86)',
    0x88: '動詞語幹(88)', 0x8a: '動詞語幹(サ変)', 0xa0: '形容詞語幹', 0xa2: '形容詞語幹(口語)',
    0xc0: '副詞(2)', 0xc2: '形容動詞(タリ)', 0xe0: '単漢字', 0xe1: '記号', 0xf2: '口語', 0xf3: '口語(形容詞)',
}

def pos_v2(a0, a1, extra, word):
    if a1 == 0x02:
        s = extra[0] if (a0 & 0x80) and extra else 0
        if s & 0xc0 == 0xc0: return '人名'
        if s & 0x80:          return '姓/地名' if s & 0x10 else '姓'
        if s & 0x40:          return '名'
        if s & 0x20:          return '人名(外国)'
        if s & 0x10:          return '地名/組織' if s & 0x08 else '地名'
        if s & 0x08:          return '組織'
        if s & 0x04:          return '商品名'
        return '固有名詞'
    if a1 == 0xe0 and word and all(ord(c) < 0x80 for c in word):
        return '英単語'
    if a1 == 0x08 and (a0 & 0x20):                 # 2バイトの素性: 下位バイト 0x10 = 時相名詞(今日・昨日など)
        f = extra[1:3] if (a0 & 0x80) else extra[0:2]
        if len(f) == 2 and (f[1] & 0x10) and not (f[1] & 0x04):
            return '名詞(時相)'
    return POS_V2.get(a1, '品詞%02x' % a1)

def item_fields(item):
    """項目のフィールド列を返す。項目 = [種別1B] { [hdr1B] チャンク... }
         hdr & 0x10 : 後続フィールドあり     hdr & 0x0f : チャンク数(各チャンクは LEB128長 + データ)
         先頭フィールドだけは例外で hdr 02/12 が 1 チャンク(=表記)。
       戻り値: [[chunk bytes, ...], ...]  (項目末尾まで過不足なく読めなければ ValueError)"""
    fields = []
    k = 1
    first = True
    while k < len(item):
        hdr = item[k]; k += 1
        n = hdr & 0x0f
        if first and n == 2:
            n = 1
        chunks = []
        for _ in range(n):
            cl, k = varint(item, k); chunks.append(item[k:k+cl]); k += cl
        fields.append(chunks)
        first = False
        if not hdr & 0x10:
            break
    if k != len(item):
        raise ValueError('item leftover')
    return fields

def parse_item_v2(item, stats):
    """項目リストの1項目 → コメント文字列のリスト"""
    kind = item[0]
    stats['itemkind'][kind] += 1
    out = []
    if kind == 0xff:                                   # 旧来の TLV 形式: 12 長 表記(捨てる), 01/02 長 テキスト
        k = 1
        while k < len(item):
            ty = item[k]; cl, k = varint(item, k+1); data = item[k:k+cl]; k += cl
            if ty == 0x12:
                continue
            out.append(utf16(data) if ty in (0x01, 0x02) else '<%02x:%s>' % (ty, data.hex()))
        return out
    fields = item_fields(item)
    text = lambda chunks: ''.join(utf16(c) for c in chunks)
    if kind in (0x0f, 0x07):                           # 表記 + コメント(64文字ごとに分割)
        out += [text(f) for f in fields[1:]]
    elif kind in (0x01, 0x08):                         # 正しい読み
        out.append('正しい読み:' + text(fields[0]))
    elif kind in (0x02, 0x03):                         # 本則の読み
        out.append('本則の読み:' + text(fields[0]))
    elif kind in (0x04, 0x1e):                         # 商標の一般名称
        names = [utf16(c) for f in fields[1:] for c in f]
        if names:
            out.append('一般名称:' + '、'.join(names))
    elif kind == 0x82:                                 # 郵便番号辞書: (区切り位置, 区切り位置, 住所の読み)
        for f in fields[1:]:
            for c in f:
                t = utf16(c)
                if any(ord(ch) > 0x7f for ch in t):
                    out.append('読み:' + unicodedata.normalize('NFKC', t))
    elif kind == 0x0c:                                 # 郵便番号/住所辞書: 表記=レベル, (区切り位置, 郵便番号)
        for f in fields[1:]:
            for c in f:
                t = utf16(c)
                if '-' in t and t.replace('-', '').isdigit():
                    out.append('〒' + t)
    else:
        stats['item_skipped'][kind] += 1               # 連語・用例・活用情報などの内部データ
    return out

def a0_extra_len(a0):
    """A0 のビットから付加バイト数を予測する(標準辞書などで検証済みの表)"""
    return sum(n for bit, n in A0_EXTRA.items() if a0 & bit)

def parse_entry_v2(g, q, yomi, stats, a0len):
    wl, q = varint(g, q)
    wraw = g[q:q+wl]; q += wl
    word = word_of(wraw, wl, yomi, stats)
    a0, a1 = g[q], g[q+1]; q += 2
    n = a0len.get(a0)
    if n is None:
        if a0 & A0_UNKNOWN:
            raise ValueError('unknown A0 bits %02x' % a0)
        n = a0_extra_len(a0)
    extra = g[q:q+n]; q += n
    f1, f2 = g[q], g[q+1]; q += 2
    if f1 & ~0x1b or f2 & ~0xf4:
        raise ValueError('unknown flag bits F1=%02x F2=%02x' % (f1, f2))
    tag = None
    if f1 & 0x10: tag = g[q]; q += 1; stats['tags'][tag] += 1
    if f1 & 0x08: q += 2
    if f1 & 0x02: l, q = varint(g, q); q += l
    if f1 & 0x01: l, q = varint(g, q); q += l
    if f2 & 0x80: l, q = varint(g, q); q += l
    if f2 & 0x40: l, q = varint(g, q); q += l          # 連接語(読み+表記): 未出力
    comments = []
    for bit in (0x20, 0x10):
        if f2 & bit:
            l, q = varint(g, q); body = g[q:q+l]; q += l
            n_items, j = varint(body, 0)
            for _ in range(n_items):
                li, j = varint(body, j); item = body[j:j+li]; j += li
                try:
                    comments.extend(parse_item_v2(item, stats))
                except Exception:
                    stats['item_err'] += 1
            if j != len(body):
                stats['body_leftover'] += 1
    if f2 & 0x04: l, q = varint(g, q); q += l          # 構成語(読み+表記): 未出力
    if q > len(g):
        raise ValueError('overrun')
    pos = pos_v2(a0, a1, extra, word)
    a = '%02x%02x%s/%02x%02x' % (a0, a1, extra.hex(), f1, f2) + ('/%02x' % tag if tag is not None else '')
    stats['attr']['%02x%02x' % (a0, a1)] += 1
    return q, (yomi, word, pos, a, '｜'.join(c for c in comments if c))

def parse_group_v2(g, yomi, stats, count=None):
    """グループを解析する。未知の A0 値が出たら、グループ全体が件数どおりに解析できる付加バイト数を
    0〜8 の範囲で探して stats['a0len'] に記憶する(辞書ごとに付加フィールドの長さが異なるため)。"""
    a0len = stats['a0len']
    def run():
        q = 0
        ents = []
        while q < len(g):
            q, e = parse_entry_v2(g, q, yomi, stats, a0len)
            ents.append(e)
        return ents
    try:
        return run()
    except Exception as e:
        if count is None:
            raise
    # 校正: このグループに現れる A0 のうち未登録のものを順に試す
    tried = set()
    while True:
        a0 = None
        q = 0
        try:                                   # 最初に失敗する(未登録の) A0 を見つける
            while q < len(g):
                wl, q2 = varint(g, q)
                cand = g[q2 + wl]
                if cand not in a0len and cand not in tried:
                    a0 = cand; break
                q, _ = parse_entry_v2(g, q, yomi, new_stats_light(a0len), a0len)
        except Exception:
            pass
        if a0 is None:
            raise ValueError('calibration failed')
        tried.add(a0)
        ok = None
        pred = a0_extra_len(a0)
        for n in [pred] + [k for k in range(0, 9) if k != pred]:
            a0len[a0] = n
            try:
                ents = run()
            except Exception:
                continue
            if len(ents) == count:
                ok = n; break
        if ok is None:
            del a0len[a0]
            raise ValueError('calibration failed for A0=%02x' % a0)
        stats['a0_calibrated'][a0] = ok
        try:
            return run()
        except Exception:
            continue

def new_stats_light(a0len):
    st = collections.defaultdict(int)
    for k in ('attr', 'tags', 'items', 'itemkind', 'item_skipped'):
        st[k] = collections.Counter()
    st['a0len'] = a0len
    return st

PARSERS = {1: lambda g, y, st, count=None: parse_group_v1(g, y, st), 2: parse_group_v2}

# --------------------------------------------------------------------------- ブロック処理
def group_data(d, base, off, ln):
    """グループの (件数, 単語データ) を返す。グループ表の off は 00+件数 の 2 バイト後を指すので、
    件数(LEB128)は base+off-1 から読む(2バイト以上の件数はグループ領域に食い込む)。"""
    count, qstart = varint(d, base + off - 1)
    return count, d[qstart: base + off + ln - 2]       # 末尾の "00 <次の件数>" は含めない

def detect_format(d, blocks, inv, magic):
    """ヘッダーの magic を手掛かりに、先頭ブロックの全グループが矛盾なく解析できる形式を選ぶ"""
    order = [2, 1] if magic.startswith('ATOK30') else [1, 2]
    if not blocks:
        return order[0]
    p = blocks[0]
    readings = block_readings(d, p, inv, collections.defaultdict(int))
    groups, base = block_groups(d, p)
    for v in order:
        st = new_stats()
        ok = True
        for gi, (off, ln) in enumerate(groups):
            count, g = group_data(d, base, off, ln)
            try:
                ents = PARSERS[v](g, readings.get(gi + 1, '?'), st, count)
            except Exception:
                ok = False; break
            if len(ents) != count:
                ok = False; break
        if ok:
            return v
    return order[0]

def decode_block(d, p, inv, stats, fmt):
    readings = block_readings(d, p, inv, stats)
    groups, base = block_groups(d, p)
    # 先頭グループがまったく解析できないブロックは、更新で残った未使用領域の残骸(ブロックの形をした
    # ごみデータ)なので読み飛ばす
    count0, g0 = group_data(d, base, groups[0][0], groups[0][1])
    try:
        probe = PARSERS[fmt](g0, readings.get(1, '?'), new_stats(), count0)
    except Exception:
        probe = []
    if not probe:
        stats['stale_block'] += 1
        return []
    out = []
    for gi, (off, ln) in enumerate(groups):
        count, g = group_data(d, base, off, ln)
        yomi = readings.get(gi + 1, '?')
        try:
            ents = PARSERS[fmt](g, yomi, stats, count)
        except Exception as e:
            ents = []
            stats['group_parse_error'] += 1
            if stats['group_parse_error'] <= 3:
                print(f'  parse error block {p:#x} group {gi} ({e}) count={count} raw={g[:96].hex(" ")}')
        if len(ents) != count:
            stats['count_mismatch'] += 1
            if stats['count_mismatch'] <= 3:
                print(f'  count mismatch block {p:#x} group {gi}: parsed {len(ents)} expected {count}; raw={g[:120].hex(" ")}')
        out.extend(ents)
    return out

def new_stats():
    stats = collections.defaultdict(int)
    for k in ('attr', 'tags', 'items', 'itemkind', 'item_skipped', 'a0_calibrated'):
        stats[k] = collections.Counter()
    stats['a0len'] = {}
    return stats

def dump(src, dst):
    d = load(src)
    magic, name, ver = header_info(d)
    if not d.startswith(b'DIC\0\0\0\0\0ATOK'):
        print(f'{os.path.basename(src)}: ATOK 辞書ではありません (header={d[:16].hex(" ")})')
        return 0
    fwd, inv = code_table(d)
    blocks = find_blocks(d)
    fmt = detect_format(d, blocks, inv, magic)
    stats = new_stats()
    n = 0
    poscount = collections.Counter()
    with open(dst, 'w', encoding='utf-8', newline='\n') as f:
        f.write(f'#dict\t{name}\t{os.path.basename(src)}\tformat={fmt}\tmagic={magic}\tver={ver}\n')
        f.write('#yomi\tword\tpos\tattr\tcomment\n')
        addr = ('郵便番号' in name) or ('住所' in name)
        for p in blocks:
            for yomi, word, pos, attr, comment in decode_block(d, p, inv, stats, fmt):
                if addr:
                    pos = '住所'
                f.write(f'{yomi}\t{word}\t{pos}\t{attr}\t{comment}\n'); n += 1
                poscount[pos] += 1
    print(f'{os.path.basename(src)}  [{name}]  format={fmt}  blocks={len(blocks)}  entries={n}')
    print('  pos:', dict(poscount.most_common(12)))
    for k in ('bad_walk', 'bad_code', 'bad_word', 'word_eq_yomi', 'word_eq_kata', 'dup_group', 'group_count_mismatch',
              'group_parse_error', 'count_mismatch', 'body_leftover', 'item_err', 'stale_block'):
        if stats[k]: print(f'  {k}={stats[k]}')
    if stats['a0_calibrated']:
        print('  A0 付加バイト数(自動校正):', {f'{k:02x}': v for k, v in stats['a0_calibrated'].items()})
    if stats['itemkind']:
        print('  comment items:', {f'{k:02x}': v for k, v in stats['itemkind'].most_common(10)},
              ' skipped kinds:', {f'{k:02x}': v for k, v in stats['item_skipped'].most_common(8)})
    print('  ->', dst)
    return n

def main():
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.splitext(os.path.basename(src))[0] + '.tsv'
    dump(src, dst)

if __name__ == '__main__':
    main()
