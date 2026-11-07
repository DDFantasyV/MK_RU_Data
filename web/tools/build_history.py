"""Build the per-ship history dataset for the simple edition's 历史变更 page.

The simple edition answers "what changed in this period"; this tool answers
"how did one ship evolve across every period".  It walks the existing period
diffs chronologically and turns them into one compact file per ship:

    web/data/history/index.json          ship roster + metadata + counts
    web/data/history/<ship-key>.json     parameter timelines for one ship

Design rules:

* Only changes are emitted.  The period in which a ship is added is its
  starting point, not a change, so every entry owned by that ship in its
  introduction period is skipped.  Components added later are recorded as an
  entry-level ``add`` event without dumping their initial parameters.
* Ship attribution follows the simple edition: the build's unique ``p`` first,
  then (for entries without ``p``) the ship-name phrase in the first field
  path segment.
* Collapsed (``grp``) and truncated rows are re-diffed from the source
  snapshots, so a history row always carries a concrete parameter path.
* Periods that compare against the same baseline (``PT/<ver>_1`` and
  ``PT/<ver>_2`` versus ``Live/<ver>``) can report the same change twice.
  Consecutive identical events are collapsed; on a same-version branch the
  later event's old value is rebased onto the value already shown.
* Output is deterministic: sorted keys, no timestamps, no absolute paths.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gpdiff  # noqa: E402
import gen_simple_fields as gsf  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA = os.path.join(ROOT, "web", "data")
PERIODS = os.path.join(DATA, "periods")
OUT = os.path.join(DATA, "history")
FIELD_CONF = os.path.join(ROOT, "web", "simple", "field-tree.conf")
NAMES = os.path.join(DATA, "names.json")

#: same set as simple/app.js and gen_names.py
SHIP_TYPES = {
    "Ship", "Unit", "Component", "Gun", "Projectile", "Aircraft",
    "Radar", "Director", "Finder", "Catapult", "Modernization", "Ability",
}

TYPE_ORDER = {
    "Ship": 0, "Unit": 1, "Component": 2, "Gun": 3, "Projectile": 4,
    "Director": 5, "Radar": 6, "Finder": 7, "Catapult": 8, "Aircraft": 9,
    "Modernization": 10, "Ability": 11, "Other": 12,
}

#: same stop words as simple/app.js
NAME_STOP = set("""
black white colorful azur arp hsf smf tst stock test subtest bot event space
premium gold supertest challenge ranked bumblebee camo mut legacy special
sanzang arpeggio hound duck boss ny new year battleship cruiser destroyer sub
type class top one two three four five of the and for in on a an le la les des
du de von van der die das el los las san saint st ste admiral duke duca
general marshal pr ships excludes modifiers default rarity index name typeinfo
canbuy costcr ussr usa us uk it de fr jp jap ger cv bb ca dd cl ss pam pa lvl
""".split())
NAME_TAIL = set("""
stock test subtest tst bot event space pa pr vl smf azur arp hsf black white
colorful gold premium supertest challenge ranked bumblebee camo ny sanzang
arpeggio hound boss
""".split())
EVENT_CODE = re.compile(r"^(?:h|fa)20\d\d$")


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------
def period_meta(p):
    """Parse ``pt-26.11_1`` / ``live-25.03`` into sortable pieces."""
    m = re.match(r"^(pt|live)-(\d+)\.(\d+)(?:_(\d+))?$", p["id"])
    if not m:
        raise ValueError("bad period id: %s" % p["id"])
    channel = "PT" if m.group(1) == "pt" else "Live"
    major, minor, patch = int(m.group(2)), int(m.group(3)), int(m.group(4) or 0)
    if channel == "Live":
        patch = 0
    return {
        "id": p["id"],
        "channel": channel,
        "major": major,
        "minor": minor,
        "patch": patch,
        "version": "%d.%02d" % (major, minor),
        "label": p["new"]["label"],
        "order": (major, minor, 0 if channel == "PT" else 1, patch),
        "rule": p.get("rule"),
        "old": p.get("old", {}),
        "new": p.get("new", {}),
    }


def load_field_filter():
    """Parse ``field-tree.conf`` with the same inheritance the pages use.

    ``true`` shows a node and its whole subtree, ``false`` hides it, unlisted
    children inherit their parent, and top-level paths default to hidden.
    A missing config falls back to “show everything”.
    """
    config = {}
    try:
        with open(FIELD_CONF, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                m = re.match(r"^(.*?):\s*(true|false)\s*;?\s*$", line)
                if m:
                    config[m.group(1).strip()] = m.group(2) == "true"
    except OSError:
        return lambda keys: True
    if not config:
        return lambda keys: True

    def visible(keys):
        path = ""
        shown = False
        for key in keys:
            path = path + " >> " + key if path else key
            value = config.get(path)
            if value is False:
                return False
            if value is True:
                shown = True
        return shown

    return visible


def load_names():
    try:
        with open(NAMES, "r", encoding="utf-8") as fh:
            blob = json.load(fh)
        return blob.get("names") or {}
    except Exception:
        return {}


def split_path(path):
    """Same segmentation as assets/fields.js."""
    out = []
    for part in str(path).split("."):
        m = re.match(r"^([^\[\]]*)((?:\[\d+\])*)$", part)
        if not m:
            out.append(part)
            continue
        if m.group(1):
            out.append(m.group(1))
        out.extend(re.findall(r"\[\d+\]", m.group(2)))
    return out


def is_noise_path(path, value, asset_like):
    """Same noise rules as the simple edition's field list, applied per path.

    ``field-tree.conf`` only carries first-level groups, so armour tables,
    model/effect paths and internal keys would otherwise leak into a history.
    """
    keys = tuple(split_path(path))
    if not keys:
        return True
    if gsf.is_noise(keys, asset_like):
        return True
    if isinstance(value, str) and value and gsf.ASSET_PATH.search(value):
        return True
    return False


def collect_asset_like(periods):
    """``{path tuple: True}`` for paths whose values are always resource paths."""
    state = {}
    for pm in periods:
        with open(os.path.join(PERIODS, pm["id"] + ".json"), "r", encoding="utf-8") as fh:
            blob = json.load(fh)
        for entry in blob.get("entries", ()):
            if not is_ship_related(entry):
                continue
            for row in entry.get("f") or ():
                if len(row) > 3 and row[3] == "grp":
                    continue
                keys = tuple(gsf.segments(row[0]))
                value = row[2] if row[2] is not None else row[1]
                if not isinstance(value, str) or not value:
                    continue
                state[keys] = state.get(keys, 0) | (
                    1 if gsf.ASSET_PATH.search(value) else 2)
    return {keys: value == 1 for keys, value in state.items()}


# --------------------------------------------------------------------------
# ship name matcher (ported from web/simple/app.js)
# --------------------------------------------------------------------------
def name_tokens(name):
    return [t for t in re.split(
        r"[^a-z0-9]+",
        re.sub(r"^p[a-z]{2,4}\d+_", "", str(name), flags=re.I).lower(),
    ) if t]


def is_strong_token(token):
    return (len(token) >= 3 and not token.isdigit()
            and token not in NAME_STOP and not EVENT_CODE.match(token))


def ship_name_tokens(name):
    tokens = name_tokens(name)
    while tokens:
        last = tokens[-1]
        if (last in NAME_TAIL or last.isdigit()
                or re.match(r"^(?:test|tst|subtest)\d*$", last)
                or EVENT_CODE.match(last)):
            tokens.pop()
        else:
            break
    while tokens and not is_strong_token(tokens[-1]):
        if not any(is_strong_token(t) for t in tokens[:-1]):
            return []
        tokens.pop()
    return tokens


class ShipMatcher:
    def __init__(self, ship_names):
        self.phrases = {}
        self.max_len = 0
        self._cache = {}
        for name in ship_names:
            tokens = ship_name_tokens(name)
            for i in range(len(tokens)):
                phrase = tokens[i:]
                if not any(is_strong_token(t) for t in phrase):
                    continue
                key = "_".join(phrase)
                self.phrases.setdefault(key, set()).add(name)
                self.max_len = max(self.max_len, len(phrase))

    def phrase(self, key):
        if key in self._cache:
            return self._cache[key]
        tokens = name_tokens(key)
        result = set()
        for length in range(min(len(tokens), self.max_len), 0, -1):
            hits = set()
            for i in range(0, len(tokens) - length + 1):
                ships = self.phrases.get("_".join(tokens[i:i + length]))
                if ships:
                    hits.update(ships)
            if hits:
                result = hits
                break
        self._cache[key] = result
        return result


# --------------------------------------------------------------------------
# ship metadata
# --------------------------------------------------------------------------
def collect_ship_meta():
    """``{name: summary}`` from the latest PT snapshot plus removed ships."""
    meta = {}
    latest = None
    latest_dir = os.path.join(ROOT, "PT", "latest", "content")
    for fname in ("GameParams_py2.data", "GameParams.data", "GameParams_py3.data"):
        candidate = os.path.join(latest_dir, fname)
        if os.path.isfile(candidate):
            latest = candidate
            break
    if latest:
        data = gpdiff.load(latest)
        for name, entry in data.items():
            if gpdiff.entry_type(entry) == "Ship":
                meta[name] = gpdiff.entry_summary(entry)

    # removed / renamed ships that no longer exist in the latest snapshot
    for fname in sorted(os.listdir(PERIODS)):
        if not fname.endswith(".json"):
            continue
        with open(os.path.join(PERIODS, fname), "r", encoding="utf-8") as fh:
            blob = json.load(fh)
        for entry in blob.get("entries", ()):
            if entry.get("t") == "Ship" and entry.get("s"):
                meta.setdefault(entry["n"], entry["s"])
    return meta


# --------------------------------------------------------------------------
# raw diff expansion for collapsed / truncated period rows
# --------------------------------------------------------------------------
def raw_diff(old_entry, new_entry):
    a = gpdiff.flatten(old_entry) if old_entry is not None else {}
    b = gpdiff.flatten(new_entry) if new_entry is not None else {}
    rows = []
    for path in sorted(set(a) | set(b)):
        va = a.get(path)
        vb = b.get(path)
        if path not in a:
            rows.append([path, None, vb, "add"])
        elif path not in b:
            rows.append([path, va, None, "del"])
        elif va != vb:
            rows.append([path, va, vb, "chg"])
    return rows


class SnapshotPair:
    """Lazily load the two GameParams snapshots a period compares."""

    def __init__(self, pmeta):
        self.old_path = self._abs(pmeta["old"].get("rel"))
        self.new_path = self._abs(pmeta["new"].get("rel"))
        self.old = None
        self.new = None

    @staticmethod
    def _abs(rel):
        if not rel:
            return None
        return os.path.join(ROOT, rel.replace("\\", os.sep).replace("/", os.sep))

    def entries(self, name):
        if self.old is None:
            self.old = gpdiff.load(self.old_path) if self.old_path else {}
        if self.new is None:
            self.new = gpdiff.load(self.new_path) if self.new_path else {}
        return self.old.get(name), self.new.get(name)

    def close(self):
        self.old = None
        self.new = None


# --------------------------------------------------------------------------
# history building
# --------------------------------------------------------------------------
class ShipHistory:
    def __init__(self, name, meta):
        self.name = name
        self.meta = meta or {}
        self.intro = None          # period meta
        self.removed = None        # period meta
        self.entries = {}          # entry name -> entry record
        self.columns = {}          # period id -> column meta

    def entry(self, name, etype):
        rec = self.entries.get(name)
        if rec is None:
            rec = {
                "name": name,
                "type": etype,
                "added": None,
                "removed": None,
                "rows": {},
            }
            self.entries[name] = rec
        return rec

    def note_column(self, pm):
        if pm["id"] not in self.columns:
            self.columns[pm["id"]] = pm

    def has_events(self):
        for rec in self.entries.values():
            if rec["rows"]:
                return True
        return False


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--from-major", type=int, default=25,
                        help="only periods whose major version is >= N (default: 25)")
    parser.add_argument("--out", default=OUT, help="output directory")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    with open(os.path.join(DATA, "index.json"), "r", encoding="utf-8") as fh:
        index = json.load(fh)

    periods = []
    for p in index.get("periods", []):
        pm = period_meta(p)
        if pm["major"] < args.from_major:
            continue
        periods.append(pm)
    periods.sort(key=lambda pm: pm["order"])
    if not periods:
        raise SystemExit("no periods in scope")

    names = load_names()
    field_filter = load_field_filter()
    asset_like = collect_asset_like(periods)
    meta = collect_ship_meta()

    # roster: every ship that appears in any period, plus latest metadata
    roster = set(meta)
    for pm in periods:
        with open(os.path.join(PERIODS, pm["id"] + ".json"), "r", encoding="utf-8") as fh:
            blob = json.load(fh)
        for entry in blob.get("entries", ()):
            if entry.get("t") == "Ship":
                roster.add(entry["n"])
            if entry.get("p"):
                roster.add(entry["p"])

    matcher = ShipMatcher(roster)
    histories = {name: ShipHistory(name, meta.get(name)) for name in roster}

    # ------------------------------------------------------------------
    # first pass: introductions (a Ship entry cannot be introduced twice)
    # ------------------------------------------------------------------
    for pm in periods:
        with open(os.path.join(PERIODS, pm["id"] + ".json"), "r", encoding="utf-8") as fh:
            blob = json.load(fh)
        for entry in blob.get("entries", ()):
            if entry.get("t") == "Ship" and entry.get("k") == "a":
                hist = histories.get(entry["n"])
                if hist is not None and hist.intro is None:
                    hist.intro = pm

    # ------------------------------------------------------------------
    # second pass: collect changes
    # ------------------------------------------------------------------
    stats = {"periods": len(periods), "files": 0, "rows": 0, "events": 0,
             "entries": 0, "expanded": 0, "skipped_intro": 0,
             "skipped_pre_intro": 0}
    for idx, pm in enumerate(periods, 1):
        path = os.path.join(PERIODS, pm["id"] + ".json")
        with open(path, "r", encoding="utf-8") as fh:
            blob = json.load(fh)

        pair = None                    # source snapshots, only when needed
        pair_used = False
        for entry in blob.get("entries", ()):
            etype = entry.get("t")
            name = entry.get("n")
            kind = entry.get("k")
            if not name or not is_ship_related(entry):
                continue

            owners = entry_owners(entry, matcher)
            if not owners:
                continue

            needs_expand = bool(entry.get("x")) or any(
                len(row) > 3 and row[3] == "grp" for row in (entry.get("f") or ()))
            rows = entry.get("f") or ()
            if kind == "m" and needs_expand:
                if pair is None:
                    pair = SnapshotPair(pm)
                    pair_used = True
                old_entry, new_entry = pair.entries(name)
                rows = raw_diff(old_entry, new_entry)
                stats["expanded"] += 1

            # Entries without a unique parent (global consumables, shared
            # modules) can contain fields for several ships.  Only keep the
            # rows whose first path segment names the ship being attributed.
            row_owner_map = None
            if kind == "m" and not entry.get("p") and etype != "Ship":
                row_owner_map = {}
                for row in rows:
                    if len(row) > 3 and row[3] == "grp":
                        continue
                    seg = str(row[0]).split(".", 1)[0]
                    if seg not in row_owner_map:
                        row_owner_map[seg] = matcher.phrase(seg)

            for owner in owners:
                hist = histories.get(owner)
                if hist is None:
                    hist = histories[owner] = ShipHistory(owner, meta.get(owner))
                # A ship has no history before the period it was added.
                # Everything in its introduction period is the initial state.
                if hist.intro is not None and pm["order"] <= hist.intro["order"]:
                    stats["skipped_intro" if pm["order"] == hist.intro["order"]
                          else "skipped_pre_intro"] += 1
                    continue

                rec = hist.entry(name, etype)
                hist.note_column(pm)

                if kind == "a":
                    if rec["added"] is None:
                        rec["added"] = pm["id"]
                    continue
                if kind == "r":
                    rec["removed"] = pm["id"]
                    if etype == "Ship" and owner == name:
                        hist.removed = pm
                    continue
                if kind != "m":
                    continue
                for row in rows:
                    if len(row) > 3 and row[3] == "grp":
                        continue
                    field_path = row[0]
                    if row_owner_map is not None:
                        seg = str(field_path).split(".", 1)[0]
                        if owner not in row_owner_map.get(seg, ()):
                            continue
                    if not field_filter(split_path(field_path)):
                        continue
                    before, after, change = row[1], row[2], row[3]
                    if is_noise_path(field_path,
                                     after if after is not None else before,
                                     asset_like):
                        continue
                    rec["rows"].setdefault(field_path, []).append(
                        [pm["id"], change, before, after])

        if pair is not None:
            pair.close()
        if not args.quiet and idx % 5 == 0:
            print("  scanned %d/%d periods" % (idx, len(periods)))

    # ------------------------------------------------------------------
    # normalise: de-duplicate branch overlaps, build per-ship columns
    # ------------------------------------------------------------------
    period_versions = {pm["id"]: pm["version"] for pm in periods}
    period_order = {pm["id"]: i for i, pm in enumerate(periods)}
    for hist in histories.values():
        dedupe_history(hist, period_versions, period_order)

    os.makedirs(args.out, exist_ok=True)
    # full rebuild: drop files for ships that no longer have any history
    for fname in os.listdir(args.out):
        if fname.endswith(".json"):
            os.remove(os.path.join(args.out, fname))
    ship_index = []
    for name in sorted(histories):
        hist = histories[name]
        if not hist.has_events():
            ship_index.append(index_row(hist, names, None))
            continue
        payload = build_payload(hist, names)
        if payload is None:
            ship_index.append(index_row(hist, names, None))
            continue
        fname = safe_filename(name) + ".json"
        with open(os.path.join(args.out, fname), "w", encoding="utf-8", newline="\n") as fh:
            json.dump(payload, fh, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"))
            fh.write("\n")
        stats["files"] += 1
        stats["rows"] += payload["stats"]["params"]
        stats["events"] += payload["stats"]["events"]
        stats["entries"] += payload["stats"]["entries"]
        ship_index.append(index_row(hist, names, payload))

    # index is sorted for the sidebar: nation, tier, type, name
    ship_index.sort(key=lambda row: (
        nation_order(row.get("nation")), row.get("tier") or 0,
        row.get("type") or "", row.get("cn") or row["id"], row["id"]))
    index_payload = {
        "generated": index.get("generated"),
        "scope": {"from_major": args.from_major},
        "versions": [version_row(pm) for pm in periods],
        "ships": ship_index,
    }
    with open(os.path.join(args.out, "index.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(index_payload, fh, ensure_ascii=False, sort_keys=True,
                  separators=(",", ":"))
        fh.write("\n")

    if not args.quiet:
        print("history: %d ships, %d files, %d params, %d events, %d entries"
              % (len(ship_index), stats["files"], stats["rows"], stats["events"],
                 stats["entries"]))
        print("         %d periods, %d expanded entries, %d intro-period skips, "
              "%d pre-intro skips"
              % (stats["periods"], stats["expanded"], stats["skipped_intro"],
                 stats["skipped_pre_intro"]))
    return 0


def is_ship_related(entry):
    """The history page tracks ship/equipment parameters, not event scripts.

    ``Other`` entries (RageMode, event heal-coefficient tables, ...) are
    deliberately excluded: some of them carry thousands of generated rows that
    would drown the actual warship parameters.
    """
    return entry.get("t") in SHIP_TYPES


def entry_owners(entry, matcher):
    name = entry.get("n")
    etype = entry.get("t")
    if etype == "Ship":
        return [name]
    parent = entry.get("p")
    if parent:
        return [parent]
    rows = entry.get("f") or ()
    if not rows:
        return []
    hits = set()
    seen = set()
    for row in rows:
        if len(row) > 3 and row[3] == "grp":
            continue
        key = str(row[0]).split(".", 1)[0]
        if not key or key in seen:
            continue
        seen.add(key)
        hits.update(matcher.phrase(key))
    return sorted(hits)


def safe_filename(name):
    return re.sub(r"[^A-Za-z0-9_.-]", "_", name)


def nation_order(nation):
    order = {
        "USA": 0, "Japan": 1, "Russia": 2, "Germany": 3,
        "United_Kingdom": 4, "France": 5, "Italy": 6,
        "Pan_Asia": 7, "Europe": 8, "Netherlands": 9, "Spain": 10,
        "Pan_America": 11, "Commonwealth": 12, "Events": 13,
    }
    return (order.get(nation, 99), str(nation))


def version_row(pm):
    return {
        "period": pm["id"],
        "label": pm["label"],
        "version": pm["version"],
        "channel": pm["channel"],
        "patch": pm["patch"],
        "rule": pm["rule"],
    }


def dedupe_history(hist, versions, order):
    """Collapse the same diff reported by a PT patch and its Live period.

    ``versions`` maps period id -> game version (e.g. ``25.09``), ``order``
    maps period id -> chronological index.  A later event on the same branch
    keeps the value chain continuous by taking the already-displayed value as
    its old value.
    """
    for rec in hist.entries.values():
        for field_path, events in list(rec["rows"].items()):
            out = []
            for period_id, change, before, after in sorted(
                    events, key=lambda ev: order.get(ev[0], 0)):
                if out:
                    prev = out[-1]
                    if (prev[1] == change and prev[2] == before
                            and prev[3] == after):
                        continue                   # same diff in PT patch + Live
                    if (change == "chg" and prev[1] == "chg"
                            and prev[2] == before and prev[3] != after
                            and versions.get(prev[0]) == versions.get(period_id)):
                        # same baseline, later branch: follow the shown value
                        before = prev[3]
                out.append([period_id, change, before, after])
            if out:
                rec["rows"][field_path] = out
            else:
                del rec["rows"][field_path]


def build_payload(hist, names):
    # periods that actually carry an event for this ship
    used = set()
    for rec in hist.entries.values():
        if not rec["rows"]:
            continue
        if rec["added"]:
            used.add(rec["added"])
        if rec["removed"]:
            used.add(rec["removed"])
        for events in rec["rows"].values():
            for ev in events:
                used.add(ev[0])
    if not used:
        return None

    # column meta for the versions this ship touched, in period order
    cols = [pm for pid, pm in hist.columns.items() if pid in used]
    # hist.columns only holds periods with a change; sort by order
    cols.sort(key=lambda pm: pm["order"])
    col_index = {pm["id"]: i for i, pm in enumerate(cols)}

    entries = []
    total_params = total_events = 0
    for rec in hist.entries.values():
        rows = []
        for field_path, events in rec["rows"].items():
            out = []
            for period_id, change, before, after in events:
                out.append([col_index[period_id], change, before, after])
            if not out:
                continue
            rows.append([field_path, out])
        if not rows:
            continue
        rows.sort(key=lambda item: item[0])
        total_params += len(rows)
        total_events += sum(len(item[1]) for item in rows)
        if rec["added"]:
            total_events += 1
        if rec["removed"]:
            total_events += 1
        entries.append({
            "name": rec["name"],
            "type": rec["type"],
            "cn": names.get(rec["name"]) or rec["name"],
            "added": col_index.get(rec["added"]) if rec["added"] else None,
            "removed": col_index.get(rec["removed"]) if rec["removed"] else None,
            "rows": rows,
        })
    if not entries:
        return None
    entries.sort(key=lambda e: (
        TYPE_ORDER.get(e["type"], 99), e["name"]))

    intro = hist.intro
    removed = hist.removed
    summary = hist.meta or {}
    payload = {
        "id": hist.name,
        "name": hist.name,
        "cn": names.get(hist.name) or hist.name,
        "index": summary.get("index") or hist.name.split("_", 1)[0],
        "tier": summary.get("level"),
        "type": summary.get("species") or "Unknown",
        "nation": summary.get("nation") or "Unknown",
        "intro": {
            "known": bool(intro),
            "label": intro["label"] if intro else None,
            "period": intro["id"] if intro else None,
            "channel": intro["channel"] if intro else None,
            "version": intro["version"] if intro else None,
        },
        "removed": {
            "label": removed["label"] if removed else None,
            "period": removed["id"] if removed else None,
            "channel": removed["channel"] if removed else None,
        },
        "versions": [version_row(pm) for pm in cols],
        "entries": entries,
        "stats": {
            "params": total_params,
            "entries": len(entries),
            "events": total_events,
            "versions": len(cols),
        },
    }
    return payload


def index_row(hist, names, payload):
    summary = hist.meta or {}
    stats = payload["stats"] if payload else {"params": 0, "entries": 0,
                                              "events": 0, "versions": 0}
    return {
        "id": hist.name,
        "cn": names.get(hist.name) or hist.name,
        "index": summary.get("index") or hist.name.split("_", 1)[0],
        "tier": summary.get("level"),
        "type": summary.get("species") or "Unknown",
        "nation": summary.get("nation") or "Unknown",
        "intro": {
            "known": bool(hist.intro),
            "label": hist.intro["label"] if hist.intro else None,
            "period": hist.intro["id"] if hist.intro else None,
            "channel": hist.intro["channel"] if hist.intro else None,
            "version": hist.intro["version"] if hist.intro else None,
        },
        "removed": {
            "label": hist.removed["label"] if hist.removed else None,
            "period": hist.removed["id"] if hist.removed else None,
            "channel": hist.removed["channel"] if hist.removed else None,
        },
        "has": bool(payload),
        "params": stats["params"],
        "entries": stats["entries"],
        "events": stats["events"],
        "versions": stats["versions"],
    }


if __name__ == "__main__":
    sys.exit(main())
