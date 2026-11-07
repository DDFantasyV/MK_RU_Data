#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""校验 web/i18n/*.po 与页面源码是否一致。

检查项：
  1. 三种语言的 .po 都能解析，头部声明了 Language / Plural-Forms；
  2. 三种语言的 msgid 集合完全相同（没有漏翻或多余词条）；
  3. 英文 / 俄文没有空译文；与中文原文相同的词条必须标 #, keep-original；
  4. 每条译文的 {占位符} 与 msgid 完全一致，复数各形式也一致；
  5. HTML 词条的标签（<code> / <span> …）在译文里保留；
  6. 源码里 t() / tn() / setEmpty() / data-i18n* 用到的 msgid 都能在 .po 里找到；
  7. 报告 .po 中存在但源码已不再使用的词条（仅提示）。

用法：
  py -3 web/tools/i18n_check.py           # 在仓库任意目录运行
退出码：0 通过，1 有错误。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# 输出统一用 UTF-8，避免 Windows 控制台默认代码页把中文/符号变成乱码。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parent.parent          # web/
I18N = ROOT / 'i18n'
LOCALES = [('zh_CN', 'zh_CN.po'), ('en', 'en.po'), ('ru', 'ru.po')]
SOURCE_DIRS = [ROOT, ROOT / 'assets', ROOT / 'simple']
HTML_FILES = [ROOT / 'index.html', ROOT / 'simple' / 'index.html']
JS_FILES = [ROOT / 'assets' / 'chrome.js', ROOT / 'assets' / 'fields.js',
            ROOT / 'assets' / 'app.js', ROOT / 'simple' / 'app.js']

errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


# --------------------------------------------------------------- PO parsing
class Entry:
    def __init__(self) -> None:
        self.msgid = ''
        self.msgid_plural: str | None = None
        self.msgstr: dict[int, str] = {}
        self.flags: set[str] = set()
        self.lineno = 0


def unescape(value: str) -> str:
    out = []
    i = 0
    mapping = {'n': '\n', 't': '\t', 'r': '\r', 'b': '\b', 'f': '\f', 'v': '\v',
               'a': '\x07', '"': '"', '\\': '\\'}
    while i < len(value):
        ch = value[i]
        if ch == '\\' and i + 1 < len(value):
            nxt = value[i + 1]
            out.append(mapping.get(nxt, nxt))
            i += 2
        else:
            out.append(ch)
            i += 1
    return ''.join(out)


def parse_po(path: Path) -> tuple[dict[str, Entry], dict[str, str]]:
    entries: list[Entry] = []
    headers: dict[str, str] = {}
    cur: Entry | None = None
    field: str | None = None
    pending_flags: set[str] = set()
    lineno = 0

    def begin(at: int) -> Entry:
        entry = Entry()
        entry.flags = set(pending_flags)
        entry.lineno = at
        pending_flags.clear()
        return entry

    def append(entry: Entry, which: str, text: str) -> None:
        if which == 'msgid':
            entry.msgid += text
        elif which == 'msgid_plural':
            entry.msgid_plural = (entry.msgid_plural or '') + text
        else:
            m = re.match(r'msgstr\[(\d+)\]$', which)
            index = int(m.group(1)) if m else 0
            entry.msgstr[index] = entry.msgstr.get(index, '') + text

    with path.open(encoding='utf-8') as fh:
        for lineno, raw in enumerate(fh, 1):
            line = raw.strip()
            if not line:
                if cur is not None and (cur.msgid or cur.msgstr):
                    entries.append(cur)
                cur = None
                field = None
                continue
            if line.startswith('#'):
                if line.startswith('#,'):
                    pending_flags.update(x.strip() for x in line[2:].split(',') if x.strip())
                continue
            m = re.match(r'^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s+"(.*)"$', line)
            if m:
                if cur is None:
                    cur = begin(lineno)
                field = m.group(1)
                if field != 'msgctxt':
                    append(cur, field, unescape(m.group(2)))
                continue
            m = re.match(r'^"(.*)"$', line)
            if m and cur is not None and field:
                append(cur, field, unescape(m.group(1)))
                continue
            if not line.startswith('#'):
                warn(f'{path.name}:{lineno} 无法识别的行：{line[:60]}')
    if cur is not None and (cur.msgid or cur.msgstr):
        entries.append(cur)

    catalog: dict[str, Entry] = {}
    for entry in entries:
        if not entry.msgid:  # header
            raw_header = entry.msgstr.get(0, '')
            for line in raw_header.splitlines():
                if ':' in line:
                    key, value = line.split(':', 1)
                    headers[key.strip()] = value.strip()
            continue
        if entry.msgid in catalog:
            err(f'{path.name}:{entry.lineno} 重复的 msgid：{entry.msgid}')
        catalog[entry.msgid] = entry
    return catalog, headers


# --------------------------------------------------------------- source refs
def js_unquote(token: str) -> str | None:
    token = token.strip()
    if len(token) < 2 or token[0] not in "'\"" or token[-1] != token[0]:
        return None
    body = token[1:-1]
    return unescape(body)


def find_calls(src: str, name: str) -> list[str]:
    """Return the raw argument text of every call to `name(`."""
    results = []
    for match in re.finditer(r'(?<![\w$.])' + re.escape(name) + r'\s*\(', src):
        start = match.end()
        depth = 1
        quote = None
        i = start
        while i < len(src) and depth > 0:
            ch = src[i]
            if quote:
                if ch == '\\':
                    i += 2
                    continue
                if ch == quote:
                    quote = None
            else:
                if ch in "'\"`":
                    quote = ch
                elif ch == '(':
                    depth += 1
                elif ch == ')':
                    depth -= 1
            i += 1
        results.append(src[start:i - 1])
    return results


def split_args(text: str) -> list[str]:
    args: list[str] = []
    buf: list[str] = []
    depth = 0
    quote = None
    i = 0
    while i < len(text):
        ch = text[i]
        if quote:
            buf.append(ch)
            if ch == '\\' and i + 1 < len(text):
                buf.append(text[i + 1])
                i += 2
                continue
            if ch == quote:
                quote = None
        else:
            if ch in "'\"`":
                quote = ch
                buf.append(ch)
            elif ch in '([{':
                depth += 1
                buf.append(ch)
            elif ch in ')]}':
                depth -= 1
                buf.append(ch)
            elif ch == ',' and depth == 0:
                args.append(''.join(buf).strip())
                buf = []
            else:
                buf.append(ch)
        i += 1
    if ''.join(buf).strip():
        args.append(''.join(buf).strip())
    return args


def collect_js_refs(path: Path, refs: set[str], where: dict[str, str]) -> None:
    src = path.read_text(encoding='utf-8')
    for name in ('t', 'tn'):
        for call in find_calls(src, name):
            args = split_args(call)
            if not args:
                continue
            key = js_unquote(args[0])
            if key is None:
                # 动态键（例如 paintEmpty 里的 state.empty.titleKey）不参与静态校验
                continue
            refs.add(key)
            where.setdefault(key, f'{path.relative_to(ROOT)}:{name}()')
    for call in find_calls(src, 'setEmpty'):
        args = split_args(call)
        for index in (0, 2):
            if len(args) <= index:
                continue
            key = js_unquote(args[index])
            if key is None:
                continue
            refs.add(key)
            where.setdefault(key, f'{path.relative_to(ROOT)}:setEmpty()')


ATTR_RE = re.compile(r'data-i18n(?:-[a-z-]+)?="([^"]*)"')


def collect_html_refs(path: Path, refs: set[str], where: dict[str, str]) -> None:
    src = path.read_text(encoding='utf-8')
    for value in ATTR_RE.findall(src):
        refs.add(value)
        where.setdefault(value, str(path.relative_to(ROOT)))


# --------------------------------------------------------------- validation
PLACEHOLDER_RE = re.compile(r'\{(\w+)\}')
TAG_RE = re.compile(r'<[^>]+>')


def check_placeholders(name: str, entry: Entry, forms: dict[int, str]) -> None:
    expected = set(PLACEHOLDER_RE.findall(entry.msgid))
    if entry.msgid_plural:
        expected |= set(PLACEHOLDER_RE.findall(entry.msgid_plural))
    for index, text in forms.items():
        got = set(PLACEHOLDER_RE.findall(text))
        if got != expected:
            err(f'{name} 词条「{entry.msgid}」msgstr[{index}] 占位符不一致：'
                f'需要 {sorted(expected) or "无"}，实际 {sorted(got) or "无"}')


def check_tags(name: str, entry: Entry, forms: dict[int, str]) -> None:
    expected = sorted(TAG_RE.findall(entry.msgid))
    if not expected:
        return
    for index, text in forms.items():
        got = sorted(TAG_RE.findall(text))
        if got != expected:
            err(f'{name} 词条「{entry.msgid}」msgstr[{index}] HTML 标签不一致：'
                f'需要 {expected}，实际 {got}')


def main() -> int:
    catalogs: dict[str, dict[str, Entry]] = {}
    for code, filename in LOCALES:
        path = I18N / filename
        if not path.exists():
            err(f'缺少词条文件：{path}')
            continue
        catalog, headers = parse_po(path)
        catalogs[code] = catalog

        plural = headers.get('Plural-Forms', '')
        m = re.search(r'nplurals\s*=\s*(\d+)', plural)
        print(f'  {filename:<12} {len(catalog):>3} 条词条   nplurals={m.group(1) if m else "?"}')

        if headers.get('Language', '').replace('-', '_') != code:
            warn(f'{filename} 头部 Language 为 {headers.get("Language", "（空）")}，'
                 f'与文件名 {code} 不一致')
        if not m:
            err(f'{filename} 头部缺少可解析的 Plural-Forms')
            continue
        nplurals = int(m.group(1))

        for entry in catalog.values():
            if 'fuzzy' in entry.flags:
                warn(f'{filename} 词条被标记 fuzzy，运行时会被忽略：{entry.msgid}')
            forms = entry.msgstr
            if entry.msgid_plural is None:
                if 0 not in forms or not forms[0]:
                    err(f'{filename} 词条缺少译文：{entry.msgid}')
                    continue
                check_placeholders(filename, entry, {0: forms[0]})
                check_tags(filename, entry, {0: forms[0]})
            else:
                missing = [i for i in range(nplurals) if not forms.get(i)]
                if missing:
                    err(f'{filename} 复数词条「{entry.msgid}」缺少 msgstr{missing}'
                        f'（nplurals={nplurals}）')
                    continue
                check_placeholders(filename, entry, {i: forms[i] for i in range(nplurals)})
                check_tags(filename, entry, {i: forms[i] for i in range(nplurals)})

    # 三种语言的 msgid 集合必须完全一致
    if len(catalogs) == len(LOCALES):
        base_code = LOCALES[0][0]
        base = set(catalogs[base_code])
        for code, _ in LOCALES[1:]:
            current = set(catalogs[code])
            for missing in sorted(base - current):
                err(f'{code}.po 缺少词条：{missing}')
            for extra in sorted(current - base):
                err(f'{code}.po 多出词条（源语言没有）：{extra}')

    # 英文 / 俄文不应照抄中文，除非明确标注 keep-original
    for code in ('en', 'ru'):
        for msgid, entry in catalogs.get(code, {}).items():
            text = entry.msgstr.get(0, '')
            if text == msgid and 'keep-original' not in entry.flags:
                warn(f'{code}.po 译文与中文原文相同，确认是否需要翻译或加 #, keep-original：{msgid}')

    # 源码引用
    refs: set[str] = set()
    where: dict[str, str] = {}
    for path in JS_FILES:
        if path.exists():
            collect_js_refs(path, refs, where)
    for path in HTML_FILES:
        if path.exists():
            collect_html_refs(path, refs, where)
    for path in SOURCE_DIRS[1:]:
        for extra in path.glob('*.html'):
            if extra not in HTML_FILES:
                collect_html_refs(extra, refs, where)

    # 语言名称（简体中文 / English / Русский）在 i18n.js 的 LOCALES 里作为 label 引用
    i18n_js = ROOT / 'assets' / 'i18n.js'
    if i18n_js.exists():
        for match in re.finditer(r"label:\s*'([^']*)'", i18n_js.read_text(encoding='utf-8')):
            refs.add(match.group(1))
            where.setdefault(match.group(1), 'assets/i18n.js:LOCALES')

    print(f'  源码引用     {len(refs):>3} 条 msgid')

    if catalogs:
        known = set(catalogs[LOCALES[0][0]])
        for missing in sorted(refs - known):
            err(f'源码使用了词条表里不存在的 msgid（{where[missing]}）：{missing}')
        for unused in sorted(known - refs):
            warn(f'词条已不再被源码使用（可删除或补回使用处）：{unused}')

    if errors:
        print('\n错误：')
        for item in errors:
            print('  [x] ' + item)
    if warnings:
        print('\n提示：')
        for item in warnings:
            print('  [!] ' + item)
    print(f'\n结果：{len(errors)} 个错误，{len(warnings)} 条提示。')
    return 1 if errors else 0


if __name__ == '__main__':
    print('i18n check — web/i18n/*.po')
    sys.exit(main())
