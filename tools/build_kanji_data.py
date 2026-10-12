#!/usr/bin/env python3
"""Build data/kanji.json from KanjiVG + KANJIDIC2.

Usage:
  python3 -I tools/build_kanji_data.py path/to/kanjivg.xml path/to/kanjidic2.xml data/kanji.json

Sources (both CC BY-SA, so the output is CC BY-SA too; see data/ATTRIBUTION.md):
  KanjiVG   https://github.com/KanjiVG/kanjivg/releases   (kanjivg-YYYYMMDD.xml.gz)
  KANJIDIC2 http://www.edrdg.org/kanjidic/kanjidic2.xml.gz

Output shape:
  {
    "v": 1,
    "k": { "<kanji>": {
        "g": grade (1-6 kyouiku, 8 secondary jouyou, 9/10 jinmeiyou) | null,
        "j": old 4-level JLPT | null,
        "f": newspaper frequency rank | null,
        "s": stroke count,
        "r": classical radical number,
        "on": [...], "kun": [...], "m": [...meanings],
        "c": [ { "e": component, "o": original form?, "rad": true?, "ph": true?, "inf": true? } ]
    } },
    "x": { "<component char not in k>": ["meaning", ...] },
    "rad": { "<radical number>": ["<char>", "<english name>"] }
  }

"c" holds the top-level visual components from KanjiVG. "ph" marks the phonetic
component: either annotated by KanjiVG (kvg:phon) or, failing that, inferred when a
non-radical component's on'yomi overlaps the kanji's ("inf": true).
"""
import gzip
import json
import sys
import unicodedata
import xml.etree.ElementTree as ET

KVG = '{http://kanjivg.tagaini.net}'


def open_any(path):
    return gzip.open(path, 'rb') if path.endswith('.gz') else open(path, 'rb')


def parse_kanjidic(path):
    out = {}
    for _, el in ET.iterparse(open_any(path), events=('end',)):
        if el.tag != 'character':
            continue
        lit = el.findtext('literal')
        misc = el.find('misc')
        rad = el.find("radical/rad_value[@rad_type='classical']")
        rm = el.find('reading_meaning/rmgroup')
        on, kun, meanings = [], [], []
        if rm is not None:
            for r in rm.findall('reading'):
                if r.get('r_type') == 'ja_on':
                    on.append(r.text)
                elif r.get('r_type') == 'ja_kun':
                    kun.append(r.text)
            meanings = [m.text for m in rm.findall('meaning') if m.get('m_lang') is None]

        def num(tag):
            t = misc.findtext(tag) if misc is not None else None
            return int(t) if t else None

        sc = misc.findall('stroke_count') if misc is not None else []
        out[lit] = {
            'g': num('grade'), 'j': num('jlpt'), 'f': num('freq'),
            's': int(sc[0].text) if sc else None,
            'r': int(rad.text) if rad is not None else None,
            'on': on, 'kun': kun, 'm': meanings,
        }
        el.clear()
    return out


def kvg_components(root_g):
    """Top-level components of a kanji's root <g>, merging kvg:part splits and
    descending through unlabeled wrapper groups."""
    comps = []
    by_key = {}

    def visit(g):
        for child in g:
            if child.tag != 'g':
                continue
            elem = child.get(KVG + 'element')
            if not elem:
                visit(child)
                continue
            key = (elem, child.get(KVG + 'original'))
            info = by_key.get(key) if child.get(KVG + 'part') else None
            if info is None:
                info = {'e': elem}
                if child.get(KVG + 'original') and child.get(KVG + 'original') != elem:
                    info['o'] = child.get(KVG + 'original')
                comps.append(info)
                by_key[key] = info
            if child.get(KVG + 'radical') in ('general', 'tradit'):
                info['rad'] = True
            phon = child.get(KVG + 'phon')
            if phon:
                info['ph'] = True
            # Phonetic or radical annotations sometimes sit one level deeper.
            for sub in child.iter('g'):
                if sub is child:
                    continue
                if sub.get(KVG + 'phon') and 'ph' not in info and sub.get(KVG + 'element'):
                    info.setdefault('sub_ph', sub.get(KVG + 'element'))

    visit(root_g)
    return comps


def parse_kanjivg(path):
    out = {}
    for _, el in ET.iterparse(open_any(path), events=('end',)):
        if el.tag != 'kanji':
            continue
        kid = el.get('id', '')
        hexpart = kid.rsplit('_', 1)[-1]
        if '-' in hexpart:  # variant drawings (Kaisho, etc.)
            el.clear()
            continue
        try:
            ch = chr(int(hexpart, 16))
        except ValueError:
            el.clear()
            continue
        g = el.find('g')
        if g is not None:
            out[ch] = kvg_components(g)
        el.clear()
    return out


KATA_VOICE = str.maketrans('ガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポ',
                           'カキクケコサシスセソタチツテトハヒフヘホハヒフヘホ')


def norm_on(r):
    r = r.replace('-', '').translate(KATA_VOICE)
    return r[:2]


def radical_names():
    names = {}
    for n in range(1, 215):
        cp = 0x2F00 + n - 1
        name = unicodedata.name(chr(cp), '')
        eng = name.replace('KANGXI RADICAL ', '').lower()
        names[n] = [unicodedata.normalize('NFKC', chr(cp)), eng]
    return names


def main(kvg_path, kd_path, out_path):
    kd = parse_kanjidic(kd_path)
    kvg = parse_kanjivg(kvg_path)
    keep = {c for c, d in kd.items() if d['g'] or d['j'] or d['f']}
    result, extra = {}, {}
    inferred = annotated = 0
    for ch in sorted(keep):
        d = dict(kd[ch])
        comps = kvg.get(ch, [])
        if len(comps) == 1 and comps[0]['e'] == ch:
            comps = []
        own_on = {norm_on(r) for r in d['on']}
        if comps and not any(c.get('ph') for c in comps):
            for c in comps:
                if c.get('rad'):
                    continue
                src = kd.get(c.get('o') or c['e']) or kd.get(c['e'])
                if src and own_on & {norm_on(r) for r in src['on']}:
                    c['ph'] = True
                    c['inf'] = True
                    inferred += 1
                    break
        elif comps:
            annotated += 1
        for c in comps:
            c.pop('sub_ph', None)
            for k in (c['e'], c.get('o')):
                if k and k not in keep and k in kd and kd[k]['m']:
                    extra[k] = kd[k]['m'][:3]
        d['c'] = comps
        result[ch] = {k: v for k, v in d.items() if v not in (None, [], '')}
    data = {'v': 1, 'k': result, 'x': extra, 'rad': radical_names()}
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(result)} kanji, {len(extra)} extra components, '
          f'{annotated} with KanjiVG phonetic, {inferred} inferred', file=sys.stderr)


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
