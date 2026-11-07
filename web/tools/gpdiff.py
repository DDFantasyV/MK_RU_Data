"""GameParams decoding, normalisation, digesting and field-level diffing."""
from __future__ import annotations

import io
import os
import pickle
import sys
import zlib

GP_MOD = r"E:\Korabli_localization_chs\GameParam"
if GP_MOD not in sys.path:
    sys.path.insert(0, GP_MOD)
import GameParams  # noqa: E402,F401  stub classes required by the pickle

# --------------------------------------------------------------------------
# security: only allow the classes this data legitimately references
# --------------------------------------------------------------------------
_ALLOWED = {
    ("GameParams", "TypeInfo"),
    ("GameParams", "GPData"),
    ("GameParams", "GameParams"),
    ("GameParams", "UIParams"),
    ("copyreg", "_reconstructor"),
    ("copy_reg", "_reconstructor"),
    ("builtins", "object"),
    ("builtins", "set"),
    ("builtins", "frozenset"),
    ("builtins", "bytearray"),
    ("__builtin__", "object"),
    ("__builtin__", "set"),
    ("__builtin__", "frozenset"),
    ("__builtin__", "bytearray"),
}


class _SafeUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        if (module, name) in _ALLOWED:
            return super().find_class(module, name)
        raise pickle.UnpicklingError("blocked global %s.%s" % (module, name))


# --------------------------------------------------------------------------
# noise control
# --------------------------------------------------------------------------
#: top level keys dropped from the comparison: pure camera/visual payloads
SKIP_KEYS = {"Cameras", "DockCamera", "UnderwaterCamera", "exteriorDecalsData",
             "exteriorDecals", "flagsAnimations"}
#: a value in the list below is what a `GPData` object expands to
SEQ_EXPAND_LIMIT = 128
STR_LIMIT = 400
SKIP_FIELDS = {"id"}          # derived content hash, changes with anything


def load(path):
    """Decode a packed GameParams file into ``{name: object}``."""
    with open(path, "rb") as fh:
        raw = fh.read()
    plain = zlib.decompress(raw[::-1])
    obj = _SafeUnpickler(io.BytesIO(plain), encoding="latin1", errors="replace").load()
    data = obj[0] if isinstance(obj, (tuple, list)) else obj
    if hasattr(data, "__dict__"):
        data = data.__dict__
    return data


def _attrs(obj):
    d = getattr(obj, "__dict__", None)
    if d is not None:
        return d
    return None


def fmt_scalar(v):
    """Render a leaf value into a stable, JSON-safe, compact value."""
    if v is None:
        return None
    if v is True:
        return True
    if v is False:
        return False
    if isinstance(v, float):
        if v != v:
            return "NaN"
        if v == _INF:
            return "Infinity"
        if v == -_INF:
            return "-Infinity"
        return v
    if isinstance(v, int):
        return v
    if isinstance(v, (bytes, bytearray)):
        try:
            v = v.decode("latin1")
        except Exception:
            return repr(v)
    if isinstance(v, str):
        return v if len(v) <= STR_LIMIT else v[:STR_LIMIT] + "\u2026"
    return str(v)


_INF = float("inf")


def iter_flat(obj, prefix="", depth=0):
    """Yield ``(path, leaf)`` pairs in a canonical order.

    Both the digest and the field-level diff are derived from this single
    traversal so the two can never disagree about what changed.
    """
    d = _attrs(obj)
    if d is not None:
        obj = d
    if isinstance(obj, dict):
        for k in sorted(obj, key=lambda x: str(x)):
            ks = str(k)
            if depth == 0 and (ks in SKIP_KEYS or ks in SKIP_FIELDS):
                continue
            yield from iter_flat(obj[k], f"{prefix}.{ks}" if prefix else ks, depth + 1)
    elif isinstance(obj, (list, tuple)):
        n = len(obj)
        limit = n if n <= SEQ_EXPAND_LIMIT else SEQ_EXPAND_LIMIT
        for i in range(limit):
            yield from iter_flat(obj[i], f"{prefix}[{i}]", depth + 1)
        if n > SEQ_EXPAND_LIMIT:
            yield (prefix, f"<{type(obj).__name__} len={n}>")
    elif isinstance(obj, (set, frozenset)):
        items = sorted(obj, key=repr)
        n = len(items)
        limit = n if n <= SEQ_EXPAND_LIMIT else SEQ_EXPAND_LIMIT
        for i in range(limit):
            yield from iter_flat(items[i], f"{prefix}[{i}]", depth + 1)
        if n > SEQ_EXPAND_LIMIT:
            yield (prefix, f"<set len={n}>")
    else:
        yield (prefix, fmt_scalar(obj))


def flatten(obj):
    """Flatten nested GPData/dict/sequence values to ``{path: leaf}``."""
    return dict(iter_flat(obj))


def digest(obj):
    """Structural digest of a value, derived from the same traversal as flatten."""
    import hashlib

    hasher = hashlib.blake2b(digest_size=12)
    for path, value in iter_flat(obj):
        hasher.update(path.encode("utf-8", "replace"))
        hasher.update(b"\x1f")
        hasher.update(repr(value).encode("utf-8", "replace"))
        hasher.update(b"\x1e")
    return hasher.hexdigest()


def entry_type(entry):
    ti = getattr(entry, "typeinfo", None)
    if ti is None and isinstance(entry, dict):
        ti = entry.get("typeinfo")
    if ti is None:
        return "Unknown"
    if hasattr(ti, "type"):
        return ti.type
    if isinstance(ti, dict):
        return ti.get("type", "Unknown")
    return "Unknown"


def entry_summary(entry):
    """A few identifying fields, for added/removed entries."""
    flat = flatten(entry)
    keep = ("index", "level", "typeinfo.species", "typeinfo.nation", "name")
    out = {}
    for k in keep:
        if k in flat and flat[k] is not None:
            out[k.split(".", 1)[-1]] = flat[k]
    return out


L1_COLLAPSE = 200      # a whole top-level subtree with more changed leaves than this
L2_COLLAPSE = 30       # ...is summarised as one row; so is a second-level subtree


def collapse_rows(rows):
    """Keep detail where it is readable, summarise subtrees that blow up.

    Commander ``Skills`` trees, for example, are regenerated wholesale on a
    rework: hundreds of leaves differ and every one of them is noise.  Such a
    subtree is replaced by a single ``grp`` row carrying the number of hidden
    leaves, so the entry still shows *that* it changed and *where*.
    """
    by1 = {}
    for row in rows:
        by1.setdefault(row[0].split(".", 1)[0], []).append(row)

    out = []
    for key1, items in by1.items():
        if len(items) > L1_COLLAPSE:
            out.append([key1, None, len(items), "grp"])
            continue
        by2 = {}
        for row in items:
            segs = row[0].split(".")
            key = ".".join(segs[:2]) if len(segs) > 2 else row[0]
            by2.setdefault(key, []).append(row)
        for key2, sub in by2.items():
            if len(sub) > L2_COLLAPSE:
                out.append([key2, None, len(sub), "grp"])
            else:
                out.extend(sub)
    out.sort(key=lambda r: r[0])
    return out


def diff_entries(old_entry, new_entry):
    """Field level diff between two entries -> list of ``[path, old, new, kind]``."""
    a = flatten(old_entry)
    b = flatten(new_entry)
    rows = []
    for path in sorted(set(a) | set(b)):
        va = a.get(path, _MISSING)
        vb = b.get(path, _MISSING)
        if va is _MISSING:
            rows.append([path, None, vb, "add"])
        elif vb is _MISSING:
            rows.append([path, va, None, "del"])
        elif va != vb:
            rows.append([path, va, vb, "chg"])
    return collapse_rows(rows)


class _MissingType:
    def __repr__(self):
        return "<missing>"


_MISSING = _MissingType()
