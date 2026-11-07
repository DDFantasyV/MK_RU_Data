"""Build the static GitHub Pages dataset for GameParams per-period diffs.

Pairing rules (as requested):
  1. ``PT/latest``      -> old = ``Live/latest``
  2. ``PT/<ver>_1``     -> old = newest ``Live/<v>`` with ``v < ver``
     (e.g. ``PT/26.11_1`` vs ``Live/26.10``)
  3. ``PT/<ver>_<n>``   -> old = ``PT/<ver>_<n-1>`` when that snapshot exists
     (e.g. ``PT/13.00_2`` vs ``PT/13.00_1``)
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gpdiff  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "web", "data")
# keep the digest cache out of web/ so it is never published with the site
CACHE = os.path.join(ROOT, ".gpcache")
CACHE_VERSION = 5

VARIANTS = ["GameParams_py2.data", "GameParams.data", "GameParams_py3.data"]


# --------------------------------------------------------------------------
# inventory
# --------------------------------------------------------------------------
def find_data(directory):
    for cand in ([os.path.join(directory, "content", v) for v in VARIANTS]
                 + [os.path.join(directory, v) for v in VARIANTS]):
        if os.path.isfile(cand):
            return cand
    return None


def parse_version(name):
    m = re.match(r"^(\d+)\.(\d+)(?:_(\d+))?$", name)
    if not m:
        return None
    return (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))


def collect():
    snapshots = {}
    for channel in ("Live", "PT"):
        base = os.path.join(ROOT, channel)
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base)):
            d = os.path.join(base, name)
            if not os.path.isdir(d):
                continue
            path = find_data(d)
            if not path:
                continue
            key = f"{channel}/{name}"
            snapshots[key] = {
                "key": key,
                "channel": channel,
                "name": name,
                "path": path,
                "rel": os.path.relpath(path, ROOT),
                "size": os.path.getsize(path),
                "version": parse_version(name),
            }
    return snapshots


def build_periods(snapshots, major_min=None):
    live = [s for s in snapshots.values() if s["channel"] == "Live" and s["version"]]
    live.sort(key=lambda s: s["version"])
    pt = [s for s in snapshots.values() if s["channel"] == "PT" and s["version"]]
    pt.sort(key=lambda s: s["version"])
    if major_min is not None:
        # "from 25 onwards" - keep 25.x, 26.x, ... and drop the 12.x/13.x era
        pt = [s for s in pt if s["version"][0] >= major_min]

    by_version = {}
    for s in pt:
        by_version.setdefault(s["version"][:2], []).append(s)

    periods = []
    for s in pt:
        major, minor, patch = s["version"]
        old = None
        rule = None
        if patch > 1:
            prev = by_version.get((major, minor), [])
            prev = [p for p in prev if p["version"][2] == patch - 1]
            if prev:
                old = prev[0]
                rule = "same-version-prev-patch"
        if old is None:
            # compare on major.minor only: a PT patch belongs to that release cycle
            cycle = s["version"][:2]
            smaller = [l for l in live if l["version"][:2] < cycle]
            if smaller:
                old = smaller[-1]
                rule = "previous-live-release"
        if old is None:
            continue
        periods.append({"new": s, "old": old, "rule": rule})

    # PT/latest -> Live/latest (latest is the newest build, so it is in scope)
    pt_latest = snapshots.get("PT/latest")
    live_latest = snapshots.get("Live/latest")
    if pt_latest and live_latest:
        periods.append({"new": pt_latest, "old": live_latest, "rule": "latest-vs-latest"})

    # newest first
    def sort_key(p):
        v = p["new"]["version"]
        return v if v else (9999, 99, 99)

    periods.sort(key=sort_key, reverse=True)
    return periods


def period_id(p):
    s = p["new"]
    if s["version"] is None:
        return f"pt-{s['name']}"
    return "pt-%d.%02d_%d" % s["version"]


# --------------------------------------------------------------------------
# digest cache
# --------------------------------------------------------------------------
def cache_file(snapshot):
    slug = snapshot["key"].replace("/", "_")
    return os.path.join(CACHE, f"{slug}.json")


def get_digests(snapshot):
    cf = cache_file(snapshot)
    if os.path.isfile(cf):
        try:
            with open(cf, "r", encoding="utf-8") as fh:
                blob = json.load(fh)
            if blob.get("v") == CACHE_VERSION and blob.get("size") == snapshot["size"]:
                return blob["digests"], blob["count"]
        except Exception:
            pass

    t0 = time.time()
    data = gpdiff.load(snapshot["path"])
    digests = {}
    for name, entry in data.items():
        digests[name] = gpdiff.digest(entry)
    count = len(data)
    del data
    os.makedirs(CACHE, exist_ok=True)
    with open(cf, "w", encoding="utf-8") as fh:
        json.dump({"v": CACHE_VERSION, "size": snapshot["size"], "count": count,
                   "digests": digests}, fh, separators=(",", ":"))
    print(f"    digest {snapshot['key']}: {count} entries in {time.time()-t0:.1f}s")
    return digests, count


def load_side(snapshot):
    t0 = time.time()
    data = gpdiff.load(snapshot["path"])
    print(f"    load {snapshot['key']}: {len(data)} entries in {time.time()-t0:.1f}s")
    return data


# --------------------------------------------------------------------------
# diff
# --------------------------------------------------------------------------
MAX_FIELDS_PER_ENTRY = 400


def row_weight(row):
    """A collapsed ``grp`` row stands for however many leaves it hides."""
    if len(row) > 3 and row[3] == "grp":
        return row[2]
    return 1


def diff_period(period):
    new_s, old_s = period["new"], period["old"]
    print(f"  period {period_id(period)}: {new_s['key']}  <-  {old_s['key']}")
    new_dig, new_count = get_digests(new_s)
    old_dig, old_count = get_digests(old_s)

    added = [n for n in new_dig if n not in old_dig]
    removed = [n for n in old_dig if n not in new_dig]
    modified = [n for n in new_dig if n in old_dig and new_dig[n] != old_dig[n]]

    print(f"    added {len(added)} removed {len(removed)} touched {len(modified)}")

    new_data = load_side(new_s) if (modified or added) else {}
    old_data = load_side(old_s) if (modified or removed) else {}

    entries = []
    for n in sorted(added):
        e = new_data.get(n)
        if e is None:
            continue
        entries.append({"n": n, "t": gpdiff.entry_type(e), "k": "a",
                        "s": gpdiff.entry_summary(e)})
    for n in sorted(removed):
        e = old_data.get(n)
        if e is None:
            continue
        entries.append({"n": n, "t": gpdiff.entry_type(e), "k": "r",
                        "s": gpdiff.entry_summary(e)})
    for n in sorted(modified):
        e_new, e_old = new_data.get(n), old_data.get(n)
        if e_new is None or e_old is None:
            continue
        rows = gpdiff.diff_entries(e_old, e_new)
        if not rows:
            continue
        dropped = None
        if len(rows) > MAX_FIELDS_PER_ENTRY:
            dropped = len(rows) - MAX_FIELDS_PER_ENTRY
            rows = rows[:MAX_FIELDS_PER_ENTRY]
        item = {"n": n, "t": gpdiff.entry_type(e_new), "k": "m", "f": rows}
        if dropped:
            item["x"] = dropped
        entries.append(item)

    types = {}
    for item in entries:
        slot = types.setdefault(item["t"], {"a": 0, "r": 0, "m": 0, "f": 0})
        slot[item["k"]] += 1
        slot["f"] += sum(row_weight(r) for r in (item.get("f") or ()))

    counts = {
        "a": sum(1 for e in entries if e["k"] == "a"),
        "r": sum(1 for e in entries if e["k"] == "r"),
        "m": sum(1 for e in entries if e["k"] == "m"),
        "f": sum(sum(row_weight(r) for r in (e.get("f") or ())) for e in entries),
        "newEntries": new_count,
        "oldEntries": old_count,
    }

    payload = {
        "id": period_id(period),
        "new": {"key": new_s["key"], "channel": new_s["channel"], "name": new_s["name"],
                "rel": new_s["rel"], "size": new_s["size"]},
        "old": {"key": old_s["key"], "channel": old_s["channel"], "name": old_s["name"],
                "rel": old_s["rel"], "size": old_s["size"]},
        "rule": period["rule"],
        "counts": counts,
        "types": types,
        "entries": entries,
    }
    return payload


def main(major_min=None):
    os.makedirs(OUT, exist_ok=True)
    period_dir = os.path.join(OUT, "periods")
    os.makedirs(period_dir, exist_ok=True)
    for stale in os.listdir(period_dir):
        if stale.endswith(".json"):
            os.remove(os.path.join(period_dir, stale))
    snapshots = collect()
    periods = build_periods(snapshots, major_min)
    scope = f"major>={major_min}" if major_min is not None else "all majors"
    print(f"{len(snapshots)} snapshots, {len(periods)} periods ({scope})")

    index = []
    total = len(periods)
    t_start = time.time()
    for i, p in enumerate(periods, 1):
        t0 = time.time()
        print(f"[{i}/{total}] {period_id(p)}")
        try:
            payload = diff_period(p)
        except Exception:
            traceback.print_exc()
            continue
        out_path = os.path.join(OUT, "periods", payload["id"] + ".json")
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        size = os.path.getsize(out_path)
        print(f"    wrote {size:,} bytes in {time.time()-t0:.1f}s")
        index.append({
            "id": payload["id"],
            "new": payload["new"],
            "old": payload["old"],
            "rule": payload["rule"],
            "counts": payload["counts"],
            "types": payload["types"],
            "bytes": size,
        })

    index.sort(key=lambda e: _sort_tuple(e["new"]["name"]), reverse=True)

    meta = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "scope": {"from_major": major_min},
        "periods": index,
    }
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    print(f"done: {len(index)} periods in {time.time()-t_start:.0f}s")


def _sort_tuple(name):
    v = parse_version(name)
    return v if v else (9999, 99, 99)


def _parse_from_major(argv):
    for i, arg in enumerate(argv):
        if arg == "--from-major":
            return int(argv[i + 1])
        if arg.startswith("--from-major="):
            return int(arg.split("=", 1)[1])
    return None


if __name__ == "__main__":
    major = _parse_from_major(sys.argv)
    if "--plan" in sys.argv:
        snapshots = collect()
        for p in build_periods(snapshots, major):
            print(f"{p['new']['key']:16} <- {p['old']['key']:16}  {p['rule']}")
    else:
        main(major)
