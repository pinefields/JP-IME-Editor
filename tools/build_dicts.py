# -*- coding: utf-8 -*-
"""
build_dicts.py -- ブラウザIME用の辞書データ(JS)を生成する

  使い方:  python3 build_dicts.py <Mozc辞書フォルダ> <ATOK Pro 4 TSVフォルダ> <医療辞書TSVフォルダ|-> <出力フォルダ(dict/)>

  入力:  Mozc OSS 辞書 (dictionary0?.txt, id.def, connection_single_column.txt)  … 接続コスト表・機能語・コストの基準
         ATOK Pro 4 の TSV (atokdic_dump.py の出力: ATOK30*.tsv, ATOKAC.tsv, ATOKY7.tsv …)
         医療辞書07 の TSV (省略可)
  出力:  dict/general.js(Mozc), dict/atok_*.js, dict/med_*.js, dict/connection.js, dict/posdef.js, dict/manifest.js

  辞書JSの中身:  IMEDICT.loadGz(id, 表示名, 語数, gzip+base64テキスト)
    テキストは1行1読み:  読み \\t 項目 \\t 項目 ...
    項目 = lid[/rid]:cost:表記[\\x1fコメント]      (lid/rid は Mozc の品詞id)

  ATOK 辞書のコスト:
    - 同じ(読み, 表記)が Mozc 辞書にあれば Mozc の品詞id・コスト(=頻度に基づく)をそのまま使う
    - なければ品詞ごとの基本コストから語長に応じて少し引く(長い複合語を分割されにくくする)
    - 動詞語幹(五段・一段)と形容詞語幹は活用形を生成して登録する(ATOK には語幹しか入っていないため)
"""
import sys, os, re, json, glob, base64, collections, unicodedata, gzip

MOZC = sys.argv[1]
ATOK = sys.argv[2]
MED  = sys.argv[3] if len(sys.argv) > 3 else '-'
OUT  = sys.argv[4] if len(sys.argv) > 4 else 'dict'
os.makedirs(OUT, exist_ok=True)

US = '\x1f'
MANIFEST = []

# ---------------- id.def ----------------
ids = {}
for line in open(os.path.join(MOZC, 'id.def'), encoding='utf-8'):
    i, s = line.rstrip('\n').split(' ', 1)
    ids[int(i)] = s
NID = len(ids)
def idof(name):
    for i, s in ids.items():
        if s == name:
            return i
    raise KeyError(name)

# ---------------- 一般辞書 (Mozc) ----------------
KEEP_ALL = {'助詞', '助動詞', '記号', '接続詞', '連体詞', '感動詞', '副詞', '接頭詞', 'フィラー', 'その他'}
def keep(pos, cost):
    if pos in KEEP_ALL:
        return True
    if pos in ('動詞', '形容詞'):
        return cost <= 9000
    return cost <= 7000          # 名詞

def norm_reading(y):
    # 読みキーの正規化: 全角→半角(NFKC)、ASCII英字は小文字、カタカナ→ひらがな
    y = unicodedata.normalize('NFKC', y)
    out = []
    for ch in y:
        o = ord(ch)
        if 0x30A1 <= o <= 0x30F6:
            ch = chr(o - 0x60)
        elif 'A' <= ch <= 'Z':
            ch = ch.lower()
        out.append(ch)
    return ''.join(out)

general = collections.defaultdict(list)
mozc_all = {}          # (key, surface) -> (l, r, cost)
seen = set()
n_in = n_keep = 0
for path in sorted(glob.glob(os.path.join(MOZC, 'dictionary0*.txt'))):
    for line in open(path, encoding='utf-8'):
        y, l, r, c, w = line.rstrip('\n').split('\t')[:5]
        n_in += 1
        l, r, c = int(l), int(r), int(c)
        pos = ids[l].split(',')[0]
        key = norm_reading(y)
        if not key:
            continue
        prev = mozc_all.get((key, w))
        # 名詞,一般(1851) を優先しつつ最小コストを採用
        if prev is None or (c < prev[2] - 500) or (l == 1851 and prev[0] != 1851 and c < prev[2] + 500):
            mozc_all[(key, w)] = (l, r, c)
        if not keep(pos, c):
            continue
        k2 = (key, w, l, r)
        if k2 in seen:
            continue
        seen.add(k2)
        general[key].append((l, r, c, w, ''))
        n_keep += 1
print(f'general: {n_in} -> {n_keep} entries, {len(general)} readings')

def emit(path, dict_id, label, default_on, table, note=''):
    lines = []
    for key in sorted(table):
        items = sorted(table[key], key=lambda t: t[2])
        parts = []
        for l, r, c, w, cm in items:
            p = f'{l}' + (f'/{r}' if r != l else '') + f':{c}:{w}'
            if cm:
                p += US + cm
            parts.append(p)
        lines.append(key + '\t' + '\t'.join(parts))
    text = '\n'.join(lines)
    gz = gzip.compress(text.encode('utf-8'), 9)
    b64 = base64.b64encode(gz).decode('ascii')
    nent = sum(len(v) for v in table.values())
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(f'IMEDICT.loadGz({json.dumps(dict_id)},{json.dumps(label, ensure_ascii=False)},{nent},"{b64}");\n')
    MANIFEST.append({'id': dict_id, 'label': label, 'file': os.path.basename(path), 'on': default_on, 'entries': nent,
                     'size': os.path.getsize(path), 'note': note})
    print(f'  wrote {path}  ({os.path.getsize(path)/1e6:.1f} MB, {len(lines)} readings, {nent} entries)')

emit(os.path.join(OUT, 'general.js'), 'general', '一般辞書 (Mozc)', True, general,
     '助詞・助動詞・活用形・コストの基準になる基本辞書。常に ON を推奨')

# ---------------- コスト校正表 (Mozc 全語: 読み+表記 -> 品詞id・コスト) ----------------
# ブラウザ内で ATOK 辞書ファイルを取り込むとき(js/dictimport.js)に使う。取り込み時だけ読み込まれる。
cal = collections.defaultdict(list)
for (key, w), (l, r, c) in mozc_all.items():
    cal[key].append(f'{l}' + (f'/{r}' if r != l else '') + f':{c}:{w}')
text = '\n'.join(k + '\t' + '\t'.join(v) for k, v in cal.items())
b64 = base64.b64encode(gzip.compress(text.encode('utf-8'), 9)).decode('ascii')
with open(os.path.join(OUT, 'mozc_cal.js'), 'w', encoding='utf-8', newline='\n') as f:
    f.write(f'DictImport.loadCalGz("{b64}");\n')
print(f'  wrote mozc_cal.js ({os.path.getsize(os.path.join(OUT, "mozc_cal.js"))/1e6:.1f} MB, {len(mozc_all)} entries)')
del cal, text, b64

# ---------------- ATOK Pro 4 辞書 ----------------
ID = dict(
    noun=1851, sahen=1841, adv_noun=idof('名詞,副詞可能,*,*,*,*,*'), keiyodo=1931, adv=12, rentai=2659,
    setsuzoku=idof('接続詞,*,*,*,*,*,*'), kandou=idof('感動詞,*,*,*,*,*,*'), prefix=idof('接頭詞,名詞接続,*,*,*,*,*'),
    suffix=idof('名詞,接尾,一般,*,*,*,*'), num=2043, sei=idof('名詞,固有名詞,人名,姓,*,*,*'), mei=idof('名詞,固有名詞,人名,名,*,*,*'),
    jinmei=idof('名詞,固有名詞,人名,一般,*,*,*'), chimei=idof('名詞,固有名詞,地域,一般,*,*,*'), soshiki=1929, koyu=1920,
    kigou=2644, alpha=idof('記号,アルファベット,*,*,*,*,*'),
)
# 品詞ラベル -> (Mozc id, 基本コスト)
POS_ATOK = {
    '名詞': ('noun', 6500), '名詞(御〜)': ('noun', 6800), '独立語': ('noun', 6800), '単漢字': ('noun', 7800),
    'サ変名詞': ('sahen', 6500), 'サ変名詞/形容動詞': ('sahen', 6500), '名詞(時相)': ('adv_noun', 6300),
    '形容動詞': ('keiyodo', 6500), '形容動詞(タリ)': ('keiyodo', 7000),
    '副詞': ('adv', 6000), '副詞(〜と)': ('adv', 6200), '副詞(2)': ('adv', 6200),
    '連体詞': ('rentai', 5800), '接続詞': ('setsuzoku', 5800), '感動詞': ('kandou', 6200),
    '接頭語': ('prefix', 6200), '接頭語(数)': ('prefix', 6500), '接尾語': ('suffix', 6200), '数詞': ('num', 7000),
    '姓': ('sei', 7000), '姓/地名': ('sei', 7000), '名': ('mei', 7200), '人名': ('jinmei', 7000), '人名(外国)': ('jinmei', 7200),
    '地名': ('chimei', 7300), '地名/組織': ('chimei', 7300), '組織': ('soshiki', 7000),
    '商品名': ('koyu', 7200), '固有名詞': ('koyu', 7000), '英単語': ('noun', 7500), '記号': ('kigou', 8000), '住所': ('chimei', 8000),
}
SKIP_POS = ('口語', '形容詞語幹(口語)', '動詞語幹(86)', '動詞語幹(88)', '動詞語幹(カ変)', '動詞語幹(サ変)', '品詞', '文字')

# 五段活用の行 (ATOK 属性の付加バイト1) -> (活用形名 -> (送り仮名, Mozc活用クラス名))
GODAN_ROW = {
    0x01: ('ワ', {'基本形': 'う', '未然形': 'わ', '未然ウ接続': 'お', '連用形': 'い', '連用タ接続': 'っ', '仮定形': 'え', '命令ｅ': 'え'}, '五段・ワ行促音便'),
    0x02: ('カ', {'基本形': 'く', '未然形': 'か', '未然ウ接続': 'こ', '連用形': 'き', '連用タ接続': 'い', '仮定形': 'け', '命令ｅ': 'け'}, '五段・カ行イ音便'),
    0x0c: ('カ促', {'基本形': 'く', '未然形': 'か', '未然ウ接続': 'こ', '連用形': 'き', '連用タ接続': 'っ', '仮定形': 'け', '命令ｅ': 'け'}, '五段・カ行促音便ユク'),
    0x03: ('ガ', {'基本形': 'ぐ', '未然形': 'が', '未然ウ接続': 'ご', '連用形': 'ぎ', '連用タ接続': 'い', '仮定形': 'げ', '命令ｅ': 'げ'}, '五段動詞'),
    0x04: ('サ', {'基本形': 'す', '未然形': 'さ', '未然ウ接続': 'そ', '連用形': 'し', '仮定形': 'せ', '命令ｅ': 'せ'}, '五段動詞'),
    0x05: ('タ', {'基本形': 'つ', '未然形': 'た', '未然ウ接続': 'と', '連用形': 'ち', '連用タ接続': 'っ', '仮定形': 'て', '命令ｅ': 'て'}, '五段動詞'),
    0x06: ('ナ', {'基本形': 'ぬ', '未然形': 'な', '未然ウ接続': 'の', '連用形': 'に', '連用タ接続': 'ん', '仮定形': 'ね', '命令ｅ': 'ね'}, '五段動詞'),
    0x07: ('バ', {'基本形': 'ぶ', '未然形': 'ば', '未然ウ接続': 'ぼ', '連用形': 'び', '連用タ接続': 'ん', '仮定形': 'べ', '命令ｅ': 'べ'}, '五段動詞'),
    0x08: ('マ', {'基本形': 'む', '未然形': 'ま', '未然ウ接続': 'も', '連用形': 'み', '連用タ接続': 'ん', '仮定形': 'め', '命令ｅ': 'め'}, '五段動詞'),
    0x09: ('ラ', {'基本形': 'る', '未然形': 'ら', '未然ウ接続': 'ろ', '連用形': 'り', '連用タ接続': 'っ', '仮定形': 'れ', '命令ｅ': 'れ'}, '五段動詞'),
    0x0b: ('ワウ', {'基本形': 'う', '未然形': 'わ', '未然ウ接続': 'お', '連用形': 'い', '連用タ接続': 'う', '仮定形': 'え', '命令ｅ': 'え'}, '五段・ワ行ウ音便'),
}
ICHIDAN = {'基本形': 'る', '未然形': '', '連用形': '', '仮定形': 'れ', '命令ｒｏ': 'ろ', '命令ｙｏ': 'よ', '未然ウ接続': 'よ'}
KEIYOSHI = {'基本形': 'い', '連用テ接続': 'く', '連用タ接続': 'かっ', '仮定形': 'けれ', '未然ウ接続': 'かろ', 'ガル接続': ''}
I_DAN = set('きしちにひみりぎじぢびぴ')

_vid = {}
def verb_id(cls, form, pos='動詞,自立'):
    k = (cls, form, pos)
    if k not in _vid:
        try:
            _vid[k] = idof(f'{pos},*,*,{cls},{form},*')
        except KeyError:
            _vid[k] = idof(f'{pos},*,*,五段動詞,{form},*')     # 促音便ユクなどに無い活用形は一般の五段で代用
    return _vid[k]

def read_tsv(path):
    rows = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            if line.startswith('#') or not line.strip():
                continue
            y, w, pos, attr, cm = line.rstrip('\n').split('\t')[:5]
            rows.append((y, w, pos, attr, cm))
    return rows

def a0_extra_bytes(attr):
    """attr 'A0A1付加/F1F2/タグ' -> (a0, a1, 付加バイト列, タグ)"""
    parts = attr.split('/')
    head = bytes.fromhex(parts[0])
    tag = int(parts[2], 16) if len(parts) > 2 else None
    return head[0], head[1], head[2:], tag

def add(table, seen, key, w, lid, rid, cost, cm):
    if not key or not w or (key, w) in seen:
        return
    seen.add((key, w))
    table[key].append((lid, rid, cost, w, cm))

def calibrated(key, w, lid, basecost, bonus_per_char=50, maxlen=10):
    """Mozc にある語は Mozc の id/コストを採用、なければ基本コスト−語長ボーナス"""
    m = mozc_all.get((key, w))
    if m:
        return m[0], m[1], m[2]
    return lid, lid, max(2500, basecost - bonus_per_char * min(len(w), maxlen))

def conjugate(table, seen, y, w, pos, attr, stats):
    """動詞語幹・形容詞語幹から活用形を生成して登録"""
    a0, a1, extra, tag = a0_extra_bytes(attr)
    forms = []
    if pos == '動詞語幹(五段)':
        row = extra[0] if (a0 & 0x80) and extra else None
        if row not in GODAN_ROW:
            stats['verb_skip'] += 1; return
        _, okuri, cls = GODAN_ROW[row]
        for form, k in okuri.items():
            forms.append((y + k, w + k, verb_id(cls, form)))
    elif pos == '動詞語幹(一段)':
        for form, k in ICHIDAN.items():
            forms.append((y + k, w + k, verb_id('一段', form)))
    elif pos == '形容詞語幹':
        cls = '形容詞・イ段' if (y and y[-1] in I_DAN) else '形容詞・アウオ段'
        for form, k in KEIYOSHI.items():
            forms.append((y + k, w + k, verb_id(cls, form, '形容詞,自立')))
    else:
        return
    for ry, rw, vid in forms:
        key = norm_reading(ry)
        lid, rid, cost = calibrated(key, rw, vid, 6800, 40, 12)
        add(table, seen, key, rw, lid, rid, cost, '')
        stats['verb_forms'] += 1

def build_atok(stem, dict_id, label, default_on, note, zip_key=False):
    path = os.path.join(ATOK, stem + '.tsv')
    if not os.path.exists(path):
        print(f'  (skip {stem}: not found)'); return
    table = collections.defaultdict(list)
    seen = set()
    stats = collections.Counter()
    for y, w, pos, attr, cm in read_tsv(path):
        if pos.startswith('動詞語幹') or pos == '形容詞語幹':
            conjugate(table, seen, y, w, pos, attr, stats)
            if pos.startswith('動詞語幹'):
                continue                       # 語幹そのものは登録しない
            # 形容詞語幹は「〜さ」「〜そう」等のため語幹も登録(ガル接続で生成済み)
            continue
        if pos.startswith(SKIP_POS):
            stats['skip_pos'] += 1; continue
        if pos not in POS_ATOK:
            stats['skip_pos'] += 1; continue
        pid, base = POS_ATOK[pos]
        lid = ID[pid]
        key = norm_reading(y)
        if zip_key:                            # 郵便番号: かな入力時にハイフンは「ー」になるので両方の表記で引けるように
            key = key.replace('-', 'ー')
        if not key:
            continue
        l, r, cost = calibrated(key, w, lid, base)
        a0, a1, extra, tag = a0_extra_bytes(attr) if '/' in attr else (0, 0, b'', None)
        if pos == '単漢字' and tag == 0x40:
            cost += 500                        # 非印刷標準字体(異体字)は後ろに
        if pos == '記号' and not cm:
            cost += 200
        if '読み:' in cm or '正しい読み' in cm or '本則の読み' in cm:
            cm2 = cm
        else:
            cm2 = cm
        add(table, seen, key, w, l, r, cost, cm2)
    if stats:
        print(f'  {stem}: ' + ', '.join(f'{k}={v}' for k, v in stats.items()))
    emit(os.path.join(OUT, dict_id + '.js'), dict_id, label, default_on, table, note)

ATOK_DICTS = [
    # (tsv, id, 表示名, 既定ON, 説明)
    ('ATOK30',   'atok_std',  'ATOK Pro 4 標準辞書',           True,  '一般語・地名・人名・活用形(語幹から生成)。主辞書'),
    ('ATOK30NM', 'atok_nm',   'ATOK Pro 4 人名辞書',           True,  '姓・名 16万語'),
    ('ATOK30TK', 'atok_tk',   'ATOK Pro 4 単漢字辞書',         True,  '単漢字 2.6万字(印刷標準字体の注記付き)'),
    ('ATOK30KG', 'atok_kg',   'ATOK Pro 4 記号辞書',           True,  '「きごう」「かっこ」「やじるし」などで記号'),
    ('ATOK30TR', 'atok_tr',   'ATOK Pro 4 トレンド辞書',       True,  '新語・商品名・人名'),
    ('ATOK30CS', 'atok_cs',   'ATOK Pro 4 人文科学用語辞書',   True,  ''),
    ('ATOK30SE', 'atok_se',   'ATOK Pro 4 理工学用語辞書',     True,  ''),
    ('ATOK30LE', 'atok_le',   'ATOK Pro 4 法律経済用語辞書',   True,  ''),
    ('ATOK30KE', 'atok_ke',   'ATOK Pro 4 カタカナ語英語辞書', False, 'カタカナ語の読みから英語綴りに変換(候補に英語が混じる)'),
    ('ATOK30JE', 'atok_je',   'ATOK Pro 4 日本語英語辞書',     False, '日本語の読みから英単語に変換'),
    ('ATOKAC',   'atok_ac',   'ATOK Pro 4 町名住所変換辞書',   False, '町名の読みから都道府県付きの住所に変換(18万語)'),
]
if ATOK != '-':        # '-' を指定すると ATOK 辞書を同梱しない(公開用: 利用者がエディタの「変換辞書」画面から取り込む)
    for stem, did, label, on, note in ATOK_DICTS:
        build_atok(stem, did, label, on, note)
    build_atok('ATOKY7', 'atok_y7', 'ATOK Pro 4 郵便番号辞書', False, '郵便番号(例: 100ー0001)から住所に変換', zip_key=True)

# ---------------- 医療辞書 ----------------
if MED != '-' and os.path.isdir(MED):
    POSMAP_MED = {'名詞': 1851, '固有名詞': 1920, 'サ変名詞': 1841, '組織': 1929, '形容動詞': 1931, '連体詞': 2659, '副詞': 12}
    OLD_CODE = {0x01: '名詞', 0x07: '固有名詞', 0x09: 'サ変名詞', 0x06: '組織', 0x27: '形容動詞', 0x25: '連体詞', 0x0e: '副詞'}
    MEDS = [  # (tsv名, id, 表示名, 既定ON, 基本コスト)
        ('Atk_MD',  'med_main',  '医療辞書07 メイン辞書',   False, 6000),
        ('Atk_MDY', 'med_drug',  '医療辞書07 薬品辞書',     False, 7000),
        ('Atk_MDG', 'med_gen',   '医療辞書07 先発後発辞書', False, 7200),
        ('Atk_MDI', 'med_icd',   '医療辞書07 ICD10辞書',    False, 7000),
        ('Atk_MDS', 'med_ident', '医療辞書07 識別辞書',     False, 7000),
        ('Atk_MDE', 'med_je',    '医療辞書07 和英辞書',     False, 7400),
    ]
    for stem, did, label, on, basecost in MEDS:
        path = os.path.join(MED, stem + '.tsv')
        if not os.path.exists(path):
            continue
        table = collections.defaultdict(list)
        seen = set()
        for line in open(path, encoding='utf-8'):
            if line.startswith('#'):
                continue
            cols = line.rstrip('\n').split('\t')
            if len(cols) == 4:
                y, w, attr, cm = cols; pos = OLD_CODE.get(int(attr[4:6], 16) if len(attr) >= 6 else 1, '名詞')
            else:
                y, w, pos, attr, cm = cols[:5]
            key = norm_reading(y.replace('・', ''))
            if not key or not w or (key, w) in seen:
                continue
            seen.add((key, w))
            m = mozc_all.get((key, w))
            cost = max(2000, basecost - 60 * min(len(w), 12))
            if '(' in w and re.search(r'\([A-Z]\d', w):
                cost += 1000
            if m:
                lid, rid = m[0], m[1]
                cost = min(cost - 300, max(1000, m[2] - 900))
            else:
                lid = rid = POSMAP_MED.get(pos, 1851)
            table[key].append((lid, rid, cost, w, cm))
        emit(os.path.join(OUT, did + '.js'), did, label, on, table, '医療用語(オフィス21 医療辞書\'07)。必要なときだけ ON')

# ---------------- 接続コスト表 ----------------
with open(os.path.join(MOZC, 'connection_single_column.txt')) as f:
    n = int(f.readline())
    vals = bytearray(n * n)
    for i in range(n * n):
        v = int(f.readline())
        vals[i] = min(255, (v + 32) // 64)
b64 = base64.b64encode(gzip.compress(bytes(vals), 9)).decode('ascii')
with open(os.path.join(OUT, 'connection.js'), 'w', encoding='utf-8') as f:
    f.write(f'IMEDICT.loadConnectionGz({n},64,"{b64}");\n')
print(f'  wrote connection.js ({os.path.getsize(os.path.join(OUT,"connection.js"))/1e6:.1f} MB)')

# ---------------- 品詞情報 (lid -> 品詞文字列) ----------------
pos_arr = [ids[i] for i in range(NID)]
with open(os.path.join(OUT, 'posdef.js'), 'w', encoding='utf-8') as f:
    f.write('IMEDICT.loadPos(' + json.dumps(pos_arr, ensure_ascii=False) + ');\n')
print('  wrote posdef.js')
with open(os.path.join(OUT, 'manifest.js'), 'w', encoding='utf-8') as f:
    f.write('IMEDICT.manifest(' + json.dumps(MANIFEST, ensure_ascii=False, indent=1) + ');\n')
print('  wrote manifest.js')
