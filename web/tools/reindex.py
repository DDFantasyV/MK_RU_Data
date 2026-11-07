"""Rebuild ``data/index.json`` from the period files already on disk.

Useful for previewing a partially finished build, or after editing a single
period file by hand.
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build import OUT, parse_version  # noqa: E402


def sort_tuple(name):
    return parse_version(name) or (9999, 99, 99)


def main():
    pdir = os.path.join(OUT, "periods")
    entries = []
    for name in os.listdir(pdir):
        if not name.endswith(".json"):
            continue
        path = os.path.join(pdir, name)
        with open(path, "r", encoding="utf-8") as fh:
            blob = json.load(fh)
        entries.append({
            "id": blob["id"],
            "new": blob["new"],
            "old": blob["old"],
            "rule": blob["rule"],
            "counts": blob["counts"],
            "types": blob["types"],
            "bytes": os.path.getsize(path),
        })
    entries.sort(key=lambda e: sort_tuple(e["new"]["name"]), reverse=True)
    meta = {"generated": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "periods": entries,
            "partial": True}
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"index.json: {len(entries)} periods")


if __name__ == "__main__":
    main()
