"""Generate ``web/data/names.json``: GameParams entry key -> 简体中文名.

The game localisation lives in a gettext ``.mo`` file whose keys are the IDS
strings used by the client, e.g.::

    IDS_PBSB521                              贝蒂            (舰船：键名 → 编号)
    IDS_PBPA311_508MM_HE_BEATTY              508 mm HE Mk II (配件：键名原样)
    IDS_DOCK_CONSUME_TITLE_PCY010_REGENCREWPREMIUM  维修小组  (带前缀的 IDS)

GameParams entry keys are what the change browser displays, so the IDS is
derived from the key:

* ``Ship`` entries use the index (``PBSB521_Beatty`` -> ``IDS_PBSB521_FULL``),
  falling back to ``IDS_PBSB521``;
* every other type uses its own key (``IDS_<NAME>``), falling back to
  ``IDS_<NAME>_FULL``;
* when neither exists, IDS keys *ending* with ``_<NAME>`` are considered
  (``PCY010_RegenCrewPremium`` ->
  ``IDS_DOCK_CONSUME_TITLE_PCY010_REGENCREWPREMIUM``), preferring ``TITLE``
  keys and skipping description / tooltip keys.

Only the entries that actually appear in the simple edition (``SHIP_TYPES``
plus ``Other`` entries with a parent ship) are emitted, so the file stays
small (~0.6 MB).  Entries without a translation are simply absent and the
page keeps showing the raw GameParams key.

Usage::

    py -3 web/tools/gen_names.py                 # PT/latest/global.mo
    py -3 web/tools/gen_names.py --mo Live/latest/global.mo
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PERIOD_DIR = os.path.join(ROOT, "web", "data", "periods")
OUT = os.path.join(ROOT, "web", "data", "names.json")
DEFAULT_MO = os.path.join(ROOT, "PT", "latest", "global.mo")
FALLBACK_MO = os.path.join(ROOT, "Live", "latest", "global.mo")

#: must mirror ``SHIP_TYPES`` / ``isShipRelated()`` in web/simple/app.js
SHIP_TYPES = {
    "Ship", "Unit", "Component", "Gun", "Projectile", "Aircraft",
    "Radar", "Director", "Finder", "Catapult", "Modernization", "Ability",
}

_WS = re.compile(r"\s+")
#: msgids that are descriptions / tooltips, never a display name
_NON_NAME = re.compile(r"(?:^|_)(?:DESCRIPTION|DESC|TOOLTIP|HINT)(?:$|_)")


def build_suffix_index(mo):
    """``{trailing token run: [msgid, ...]}`` for suffix lookups.

    Every trailing ``_``-separated run of every msgid is indexed, so an entry
    name can find prefixed IDS keys that end with it
    (``PCY010_RegenCrewPremium`` -> ``IDS_DOCK_CONSUME_TITLE_PCY010_...``).
    """
    index = {}
    for key in mo:
        parts = key.upper().split("_")
        for i in range(len(parts)):
            index.setdefault("_".join(parts[i:]), []).append(key)
    return index


def read_mo(path):
    """Parse a GNU gettext ``.mo`` file into ``{msgid: msgstr}``."""
    with open(path, "rb") as fh:
        data = fh.read()
    if len(data) < 20:
        raise ValueError("not a gettext .mo file: %s" % path)
    magic, version = struct.unpack_from("<II", data, 0)
    if magic == 0x950412DE:            # little endian
        endian = "<"
    elif magic == 0xDE120495:          # big endian
        endian = ">"
    else:
        raise ValueError("unknown .mo magic 0x%08X in %s" % (magic, path))
    count, off_orig, off_trans = struct.unpack_from(endian + "III", data, 8)
    out = {}
    for i in range(count):
        olen, ooff = struct.unpack_from(endian + "II", data, off_orig + 8 * i)
        tlen, toff = struct.unpack_from(endian + "II", data, off_trans + 8 * i)
        orig = data[ooff:ooff + olen].decode("utf-8", "replace")
        trans = data[toff:toff + tlen].decode("utf-8", "replace")
        out[orig] = trans
    return out


def ids_candidates(name, entry_type):
    """IDS keys that may hold the display name of a GameParams entry."""
    index = name.split("_", 1)[0].upper()
    if entry_type == "Ship":
        # FULL 是舰船的完整名（含军衔/前缀），优先使用；缺失时退回短名
        return ("IDS_" + index + "_FULL", "IDS_" + index)
    # non-ship entries carry their own key; never fall back to the index,
    # which may belong to an unrelated entry (e.g. a ship with the same index)
    key = "IDS_" + name.upper()
    return (key, key + "_FULL")


def clean(value):
    """Normalise a msgstr; ``None`` when it cannot be a display name."""
    if not value:
        return None
    text = _WS.sub(" ", value).strip()
    if not text or text.startswith("<"):
        return None
    return text


def resolve(name, entry_type, mo, suffix_index):
    """Chinese display name for ``entry_type:name``; ``None`` when unknown."""
    for key in ids_candidates(name, entry_type):
        text = clean(mo.get(key))
        if text and text != key:
            return text

    # Suffix matching: the game uses prefixed IDS for consumables / upgrades,
    # e.g. IDS_DOCK_CONSUME_TITLE_<NAME> or IDS_TITLE_<NAME>.  Prefer TITLE
    # keys (and the type-specific prefix), never descriptions/tooltips.
    ranked = []
    upper_name = name.upper()
    for key in suffix_index.get(upper_name, ()):
        upper = key.upper()
        if _NON_NAME.search(upper):
            continue
        text = clean(mo.get(key))
        if not text:
            continue
        score = 2 if "_TITLE_" in upper else 0
        if entry_type == "Ability" and upper.startswith("IDS_DOCK_CONSUME_TITLE_"):
            score += 1
        elif entry_type == "Modernization" and upper.startswith("IDS_TITLE_"):
            score += 1
        ranked.append((-score, len(key), key, text))
    if ranked:
        ranked.sort()
        return ranked[0][3]
    return None


def collect_entries():
    """``{entry name: type}`` for everything the simple edition can display."""
    wanted = {}
    files = sorted(glob.glob(os.path.join(PERIOD_DIR, "*.json")))
    if not files:
        raise SystemExit("no period data under %s; run web/tools/build.py first"
                         % PERIOD_DIR)
    for path in files:
        with open(path, "r", encoding="utf-8") as fh:
            blob = json.load(fh)
        for entry in blob.get("entries", ()):
            kind = entry.get("t")
            name = entry.get("n")
            if not name:
                continue
            if kind in SHIP_TYPES or (kind == "Other" and entry.get("p")):
                wanted.setdefault(name, kind)
            parent = entry.get("p")
            if parent:
                # ``p`` always points at a Ship entry
                wanted.setdefault(parent, "Ship")
    return wanted


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--mo", default=None, help="path to global.mo")
    parser.add_argument("--out", default=OUT, help="output JSON path")
    parser.add_argument("--quiet", action="store_true", help="only print errors")
    args = parser.parse_args(argv)

    mo_path = args.mo or DEFAULT_MO
    if not os.path.isfile(mo_path):
        if args.mo or not os.path.isfile(FALLBACK_MO):
            raise SystemExit("找不到本地化文件：%s" % mo_path)
        mo_path = FALLBACK_MO

    mo = read_mo(mo_path)
    suffix_index = build_suffix_index(mo)
    wanted = collect_entries()
    names = {}
    for name, entry_type in wanted.items():
        text = resolve(name, entry_type, mo, suffix_index)
        if text:
            names[name] = text

    payload = {
        "source": os.path.relpath(mo_path, ROOT).replace(os.sep, "/"),
        "count": len(names),
        "names": names,
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(payload, fh, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        fh.write("\n")

    if not args.quiet:
        print("names: %d translated / %d candidates from %s -> %s (%d bytes)"
              % (len(names), len(wanted), payload["source"],
                 os.path.relpath(args.out, ROOT), os.path.getsize(args.out)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
