#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成简洁版的字段显示清单 web/simple/field-tree.conf。

扫描 web/data/periods/*.json 里所有“战舰相关”条目的字段行，按页面同样的
路径分段规则还原成树，输出成扁平清单：

    AIParams: true;
    AIParams >> default_distance: true;
    ...

规则（页面按继承语义解析）：
  * true 显示该节点及其整棵子树；false 隐藏该节点及其整棵子树；
  * 没写到的路径继承父项，顶级路径默认不显示；
  * 新增路径默认 true；重新生成会保留已有的 false（手工隐藏的路径不会被翻回来）；
  * 命中下方“噪音规则”的路径一律写成 false —— 这些是模型/特效等
    资源路径、引擎内部标识、装甲厚度/系数、以及挂在战舰下但不属于
    战舰数据的附属系统；
  * --reset 忽略现有清单、全部按默认（true，噪音规则仍然生效）重写；
  * --all-true 忽略现有清单和噪音规则，所有路径一律写成 true（全部显示）；
  * --no-noise 忽略噪音规则，但保留现有清单里的 false、新增路径默认 true
    （用来生成“全部可见、只留手工 false”的清单模板）；
  * --max-depth N 只输出深度 ≤ N 的路径（1 = 只保留一级条目，2 = 保留到二级）。

用法：
  py -3 web/tools/gen_simple_fields.py
  py -3 web/tools/gen_simple_fields.py --reset
  py -3 web/tools/gen_simple_fields.py --all-true
  py -3 web/tools/gen_simple_fields.py --all-true --max-depth 1   # 只留一级条目
  py -3 web/tools/gen_simple_fields.py --no-noise --max-depth 2   # 保留到二级，不套噪音规则
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from functools import cmp_to_key
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parent.parent          # web/
PERIODS = ROOT / 'data' / 'periods'
OUT = ROOT / 'simple' / 'field-tree.conf'

# 与 web/simple/app.js 的 SHIP_TYPES 保持一致
SHIP_TYPES = {
    'Ship', 'Unit', 'Component', 'Gun', 'Projectile', 'Aircraft',
    'Radar', 'Director', 'Finder', 'Catapult', 'Modernization', 'Ability',
}

# ---------------------------------------------------------------------------
# 噪音规则：与战舰数据无关、简洁版里默认隐藏的路径
# 命中任意一条 → 该路径及其整棵子树写成 false。
# 想调松/调紧，只改这三组常量即可；改完重新运行本脚本。
# ---------------------------------------------------------------------------

# 1) 资源与表现层：模型、粒子特效、拖尾、音效、相机、颜色、UI 图标等。
#    字段名只要“包含”下面任意一个词（不区分大小写）就隐藏。
ASSET_WORDS = ('effect', 'model', 'camera', 'sound', 'tint', 'trail', 'visual')

#    字段名精确匹配这些（词组里没有上面的关键词，但同样是表现层参数）。
ASSET_NAMES = {
    'xml',                               # 粒子/特效描述文件路径
    'position',                          # 炮位/挂点坐标
    'repairLight',                       # 修理小组灯效（可挂点也可挂粒子）
    'ShellCasing',                       # 抛壳动画参数
    'planeOffsets',                      # 甲板停机位坐标
    'flagsScale', 'hatSizeScale', 'nationFlagScale',   # 旗帜/舰长帽缩放
    'planeToPlaneAnimationEasing',       # 机群编队动画曲线
    'dockYOffset',                       # 港口停泊高度
    'crackNodes',                        # 沉没裂纹节点
    'shieldColor', 'shieldResponseDamageColor',
    'shieldResponseNotDamageColor',      # 护盾反馈配色（活动舰）
    'unpeculiarCamouflageColorSchemeId',  # 涂装配色方案
    'customUIPostfix', 'uiType', 'uiShotPattern',
    'uiBuffDuration', 'uiBuffCategory',  # UI 图标/文案后缀
}

#    字段值本身就是资源路径（content/…/*.model、particles/*.xml、trails/*.trail…）。
ASSET_PATH = re.compile(
    r'^(?:content|res|gui|audio|particles|trails|spaces|shaders|sound|effects)/'
    r'|\.(?:model|xml|dds|png|tga|trail|wav|ogg|mp3|fx|skn|visual|py|json|cfg|txt)$',
    re.I,
)

# 2) 引擎内部标识与元数据：id / 内部键名 / 类型标签，玩家看不到也不需要跟踪。
IDENT_NAMES = {
    'id',                # 内容哈希
    'index',             # 内部编号（如 PAGS010）
    'name',              # 内部键名（如 PAGS010_5in38_Mk32_Mod12）
    'typeinfo',          # 子元件类型/国别/种类/model 的元数据组
    'ucType',            # 升级品槽位类型（_Engine/_Hull…）
    'hlType',            # 命中区内部类型名
    'clusterID',         # 命中区簇编号
    'parentHL',          # 命中区父节点名
    'burnNode',          # 起火节点名
    'gunNode',           # 炮位节点名
    'splashBoxes',       # 溅射判定盒节点名
    'miscFilter', 'miscFilterMode',   # 挂件过滤（外观用）
    'peculiarity',       # “奇特舰”标签
    'tags', 'eventTags',  # 活动/玩法标签
    'sortIndex',         # 排序序号
    'groupsNames',       # 分组名 IDS 键
    'descIDs', 'titleIDs', 'iconIDs', 'descriptionIDS',   # 文案/图标本地化键
    'permoflages',       # 永久涂装 id 列表（外饰，简洁版不收录）
    'canEquipCamouflage', 'canEquipDecal',   # 能否装涂装/贴花
}

# 3) 挂在战舰下、但不属于战舰数据的附属系统：隐藏整棵子树。
NON_SHIP_ROOTS = {
    'AIParams',           # 电脑瞄准距离
    'BattleUpgradeInfo',  # 活动 PvE 升级奖励
    'formations',         # 机队攻击编队几何
}

# 4) 装甲参数：装甲厚度表、装甲系数、分区映射。
#    字段名含 armor / armour 的：armor（按装甲分区 id 的厚度表）、armorCoeff、
#    armourCas / armourCit / armourDeck / armourExtremities、splashArmorCoeff；
#    另外 barbettes（炮座 → 装甲分区 id 的映射）也随之隐藏。
ARMOR_WORDS = ('armor', 'armour')
ARMOR_NAMES = {'barbettes'}


def seg_base(seg: str) -> str:
    """`[0]` → ''，`ammoList[0]` → 'ammoList'。"""
    return re.sub(r'\[\d+\]$', '', seg)


def is_noise(keys: tuple[str, ...], asset_like: dict[tuple[str, ...], bool]) -> bool:
    """这条路径是不是与战舰数据无关的噪音？"""
    if keys and keys[0] in NON_SHIP_ROOTS:
        return True
    for seg in keys:
        base = seg_base(seg)
        if base in IDENT_NAMES or base in ASSET_NAMES or base in ARMOR_NAMES:
            return True
        low = base.lower()
        if any(word in low for word in ASSET_WORDS):
            return True
        if any(word in low for word in ARMOR_WORDS):
            return True
    return asset_like.get(keys, False)


HEADER = [
    '# 简洁版字段显示清单（自动生成，路径顺序按页面字段树排列）',
    '# 生成/更新：py -3 web/tools/gen_simple_fields.py',
    '# 规则（继承）：true 显示该节点及整棵子树，false 隐藏该节点及整棵子树；',
    '#       没写到的路径继承父项，顶级路径默认不显示。',
    '# 路径用 “ >> ” 分隔，数组下标形如 [0]；新增路径默认 true。',
    '# 可选噪音规则（见生成脚本顶部）：资源路径、内部 id 与键名、装甲参数、非战舰系统；',
    '#       普通生成会把这些路径写成 false，--all-true 则一律 true，--no-noise 不套规则。',
]


def segments(path: str) -> tuple[str, ...]:
    """与 assets/fields.js 的 pathSegments 完全一致。"""
    out: list[str] = []
    for part in str(path).split('.'):
        match = re.match(r'^([^\[\]]*)((?:\[\d+\])*)$', part)
        if not match:
            out.append(part)
            continue
        if match.group(1):
            out.append(match.group(1))
        out.extend(re.findall(r'\[\d+\]', match.group(2)))
    return tuple(seg for seg in out if seg)


def seg_compare(a: str, b: str) -> int:
    ia = re.fullmatch(r'\[(\d+)\]', a)
    ib = re.fullmatch(r'\[(\d+)\]', b)
    if ia and ib:
        return int(ia.group(1)) - int(ib.group(1))
    if ia:
        return 1
    if ib:
        return -1
    return -1 if a < b else (1 if a > b else 0)


def is_ship_related(entry: dict) -> bool:
    if entry.get('t') in SHIP_TYPES:
        return True
    return entry.get('t') == 'Other' and bool(entry.get('p'))


def collect_paths() -> tuple[set[tuple[str, ...]], dict[tuple[str, ...], bool], int, int, int]:
    nodes: set[tuple[str, ...]] = set()
    # 每条叶子路径的取值是不是清一色的资源路径：1=见过资源路径，2=见过非资源值
    asset_state: dict[tuple[str, ...], int] = {}
    files = sorted(PERIODS.glob('*.json'))
    entries = 0
    rows = 0
    for path in files:
        data = json.loads(path.read_text(encoding='utf-8'))
        for entry in data.get('entries', []):
            if not is_ship_related(entry):
                continue
            entries += 1
            for row in entry.get('f') or []:
                rows += 1
                keys = segments(row[0])
                for depth in range(1, len(keys) + 1):
                    nodes.add(keys[:depth])
                if not keys or row[3] == 'grp':
                    continue
                value = row[2] if row[2] is not None else row[1]
                if not isinstance(value, str) or not value:
                    continue
                state = asset_state.get(keys, 0)
                asset_state[keys] = state | (1 if ASSET_PATH.search(value) else 2)
    asset_like = {keys: state == 1 for keys, state in asset_state.items()}
    return nodes, asset_like, len(files), entries, rows


def build_trie(nodes: set[tuple[str, ...]]) -> dict:
    tree: dict = {}
    for path in nodes:
        node = tree
        for seg in path:
            node = node.setdefault(seg, {})
    return tree


def walk(node: dict, prefix: tuple[str, ...] = ()):
    for key in sorted(node.keys(), key=cmp_to_key(seg_compare)):
        path = prefix + (key,)
        yield path
        yield from walk(node[key], path)


def read_existing(path: Path) -> dict[str, bool]:
    values: dict[str, bool] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding='utf-8').splitlines():
        text = line.strip()
        if not text or text.startswith('#'):
            continue
        match = re.match(r'^(.*?):\s*(true|false)\s*;?\s*$', text)
        if match:
            values[match.group(1).strip()] = match.group(2) == 'true'
    return values


def main() -> int:
    parser = argparse.ArgumentParser(description='生成简洁版字段显示清单')
    parser.add_argument('--reset', action='store_true',
                        help='忽略现有清单，按默认值重写（噪音规则仍然生效）')
    parser.add_argument('--all-true', action='store_true',
                        help='全部写成 true（忽略现有清单与噪音规则，等于“全部显示”）')
    parser.add_argument('--no-noise', action='store_true',
                        help='忽略噪音规则，但保留现有清单里的 false（新增路径默认 true）')
    parser.add_argument('--max-depth', type=int, default=0, metavar='N',
                        help='只输出深度 ≤ N 的路径（0 = 全部；1 = 仅一级条目；2 = 保留到二级）')
    parser.add_argument('--out', type=Path, default=OUT, help='输出路径（默认 web/simple/field-tree.conf）')
    args = parser.parse_args()

    if not PERIODS.is_dir():
        print(f'找不到期次目录：{PERIODS}', file=sys.stderr)
        return 1

    nodes, asset_like, file_count, entry_count, row_count = collect_paths()
    if not nodes:
        print('没有收集到任何字段路径，已中止。', file=sys.stderr)
        return 1

    existing = {} if (args.reset or args.all_true) else read_existing(args.out)
    tree = build_trie(nodes)

    lines: list[str] = []
    true_count = 0
    false_count = 0
    noise_count = 0
    added = 0
    for keys in walk(tree):
        if args.max_depth and len(keys) > args.max_depth:
            continue
        path = ' >> '.join(keys)
        if args.all_true:
            value = True
        elif is_noise(keys, asset_like) and not args.no_noise:
            value = False
            noise_count += 1
        elif path in existing:
            value = existing[path]
        else:
            value = True
            added += 1
        if value:
            true_count += 1
        else:
            false_count += 1
        lines.append(f'{path}: {"true" if value else "false"};')

    notes = []
    if args.max_depth:
        notes.append(f'# 仅输出深度 ≤ {args.max_depth} 的路径')
    if args.no_noise:
        notes.append('# 噪音规则：本次未启用（--no-noise），所有未列出的子路径继承父项')
    header = HEADER + notes + [
        f'# 路径总数：{len(lines)}（true {true_count}，false {false_count}；'
        f'其中噪音规则隐藏 {noise_count}，本次新增 {added}）',
        '',
    ]
    text = '\n'.join(header + lines) + '\n'
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text, encoding='utf-8', newline='\n')

    size_mb = len(text.encode('utf-8')) / (1024 * 1024)
    try:
        shown = args.out.relative_to(ROOT.parent)
    except ValueError:
        shown = args.out
    print(f'期次 {file_count} 个，战舰相关条目 {entry_count} 个，字段行 {row_count} 行')
    print(f'路径 {len(lines)} 条（true {true_count}，false {false_count}；'
          f'噪音规则隐藏 {noise_count}，本次新增 {added}）')
    print(f'已写入 {shown}  {size_mb:.2f} MB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
