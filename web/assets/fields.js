/* ------------------------------------------------------------------
 * MK_fields — 共用的字段差异树
 * ------------------------------------------------------------------
 * 专业版和简洁版渲染完全相同的可折叠结构：
 *   - 按字段路径分段建树（`A_ATBA.HP_BGS_1.ammoList[0]` → 逐层节点）
 *   - 分组行默认收起，点击/回车按需加载子节点
 *   - 构建时已折叠的 grp 行只显示汇总
 *
 * 依赖 i18n.js 提供的 t / tn / num / compact；两版只负责决定
 * “什么时候把哪些条目展开”，树本身的行为都在这里。
 * ------------------------------------------------------------------ */
'use strict';

const MK_fields = (function () {
  const t = (msgid, vars) => MK_i18n.t(msgid, vars);
  const tn = (msgid, n, vars) => MK_i18n.tn(msgid, n, vars);
  const num = (n) => MK_i18n.num(n);
  const compact = (n) => MK_i18n.compact(n);

  const FIELD_CHEV = '<svg class="fchev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>';

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtNum(n) {
    if (typeof n !== 'number' || !isFinite(n)) return String(n);
    if (Number.isInteger(n)) return String(n);
    return String(Number(n.toPrecision(12)));
  }

  function fmtVal(v) {
    if (v === null) return 'null';
    if (typeof v === 'number') return fmtNum(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    const s = String(v);
    return s === '' ? '""' : s;
  }

  /** Split `A_ATBA.HP_BGS_1.ammoList[0]` into path segments. */
  function pathSegments(path) {
    const out = [];
    for (const part of path.split('.')) {
      const m = /^([^\[\]]*)((?:\[\d+\])*)$/.exec(part);
      if (!m) { out.push(part); continue; }
      if (m[1]) out.push(m[1]);
      const idx = m[2].match(/\[\d+\]/g);
      if (idx) out.push(...idx);
    }
    return out;
  }

  function segCompare(a, b) {
    const ia = /^\[(\d+)\]$/.exec(a);
    const ib = /^\[(\d+)\]$/.exec(b);
    if (ia && ib) return Number(ia[1]) - Number(ib[1]);
    if (ia) return 1;
    if (ib) return -1;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /** Build (and cache) a collapsible tree from the flat field rows. */
  function buildTree(entry) {
    if (entry.__tree) return entry.__tree;
    const root = { key: '', full: '', keys: [], map: new Map(), children: [], row: null, leaves: 0 };
    const grp = [];
    for (const row of entry.f) {
      if (row[3] === 'grp') { grp.push(row); continue; }
      const segs = pathSegments(row[0]);
      let node = root;
      for (const seg of segs) {
        let child = node.map.get(seg);
        if (!child) {
          const full = seg.charAt(0) === '[' ? node.full + seg : (node.full ? node.full + '.' + seg : seg);
          child = {
            key: seg, full, keys: node.keys.concat(seg),
            map: new Map(), children: [], row: null, leaves: 0,
          };
          node.map.set(seg, child);
          node.children.push(child);
        }
        node = child;
      }
      node.row = row;
    }
    const count = (node) => {
      let n = node.row ? 1 : 0;
      for (const c of node.children) n += count(c);
      node.leaves = n;
      return n;
    };
    count(root);
    const sort = (node) => {
      node.children.sort((a, b) => segCompare(a.key, b.key));
      for (const c of node.children) sort(c);
    };
    sort(root);
    entry.__tree = { root, grp };
    return entry.__tree;
  }

  /* ---------------- 重复分组合并 ----------------
   * 同一父节点下、内容完全一样的分组只保留第一组（例如 HP_AGS_1…HP_AGS_10、
   * AuraFar / AuraFar_Bubbles、A_Hull / B_Hull）。只有“同一实例系列”的
   * 名字才会合并，避免把恰好取值相同的不同参数（pitch / yaw、armourCas /
   * armourCit）当成重复；数组下标和纯数字键不参与。
   * ---------------------------------------------------------------- */

  const INDEX_SEG = /^\[\d+\]$/;          // [0]、[1] …
  const NUM_SEG = /^-?\d+(?:\.\d+)?$/;    // 65568、-10.0 之类的字典键

  /** 实例名 → 族名：HP_AGS_1 / HP_AGS_2 → AGS，AuraFar_Bubbles → AuraFar，A_Hull / B_Hull → Hull。 */
  function familyKey(key) {
    if (INDEX_SEG.test(key) || NUM_SEG.test(key)) return null;
    let s = key.replace(/_?bubbles$/i, '');
    s = s.replace(/[\s\-_]*\d+$/, '');
    s = s.replace(/^[A-Z]{1,2}\d*[_\-\s]/, '');
    return s || null;
  }

  /**
   * 把同级里“同族 + 内容完全相同”的分组合并成一组：保留第一组，
   * 其余从树上摘掉，并在保留项上记 dup（合并了多少组）。
   * 返回该节点去重后的子树签名，供上一层比较。
   */
  function mergeDuplicateGroups(tree, filter) {
    const visit = (node) => {
      let sig = '';
      if (node.row) {
        const r = node.row;
        sig += 'r' + typeof r[1] + ':' + r[1] + '\u0001'
          + typeof r[2] + ':' + r[2] + '\u0001' + r[3] + '\u0003';
      }
      if (!node.children.length) return sig;
      const kept = [];
      const seen = new Map();
      for (const child of node.children) {
        if (filter && !filter(child.keys)) {
          kept.push(child);            // 被清单隐藏的节点照旧留着，渲染时自然不出现
          continue;
        }
        const childSig = visit(child);
        if (child.children.length) {
          const fam = familyKey(child.key);
          if (fam) {
            const slot = fam + '\u0004' + childSig;
            const first = seen.get(slot);
            if (first) {
              first.dup = (first.dup || 1) + 1;
              continue;
            }
            seen.set(slot, child);
          }
        }
        kept.push(child);
        sig += child.key + '\u0002' + childSig + '\u0001';
      }
      node.children = kept;
      return sig;
    };
    visit(tree.root);
  }

  function fieldLeafHtml(node, depth) {
    const [path, oldV, newV, kind] = node.row;
    const cls = kind === 'add' ? ' added' : kind === 'del' ? ' removed' : '';
    const oldTxt = kind === 'add' ? '—' : esc(fmtVal(oldV));
    const newTxt = kind === 'del' ? '—' : esc(fmtVal(newV));
    let delta = '';
    if (kind === 'chg' && typeof oldV === 'number' && typeof newV === 'number' && oldV !== newV) {
      const d = Number((newV - oldV).toPrecision(10));
      if (d !== 0) {
        delta = `<span class="fdelta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${fmtNum(d)}</span>`;
      }
    }
    return `<div class="frow${cls}" style="--d:${depth}" title="${esc(node.full)}">
      <span class="fpath">${esc(node.key)}</span>
      <span class="fold ${kind === 'add' ? 'void' : ''}">${oldTxt}</span>
      <span class="farr">→</span>
      <span class="fnew ${kind === 'del' ? 'void' : ''}">${newTxt}</span>
      ${delta || '<span></span>'}
    </div>`;
  }

  function fieldGroupHtml(node, depth, leaves) {
    const count = leaves === undefined ? node.leaves : leaves;
    const dup = node.dup > 1
      ? `<span class="fdup" title="${esc(t('{n} 组重复数据已合并显示', { n: num(node.dup) }))}">×${num(node.dup)}</span>`
      : '';
    return `<div class="frow group" data-fsegs="${esc(JSON.stringify(node.keys))}" style="--d:${depth}" role="button" tabindex="0" aria-expanded="false" title="${esc(node.full)}">
      <span class="fpath">${FIELD_CHEV}<span class="fkey">${esc(node.key)}</span><span class="fcount">${compact(count)}</span>${dup}</span>
      <span class="fold void">—</span>
      <span class="farr">→</span>
      <span class="fnew groupnote">${esc(tn('{n} 项', count, { n: compact(count) }))}</span>
      <span></span>
    </div>
    <div class="fchildren" hidden></div>`;
  }

  function fieldStaticGrpHtml(row) {
    return `<div class="frow grp static" title="${esc(t('构建时折叠的子树汇总'))}">
      <span class="fpath">${esc(row[0])}</span>
      <span class="fold void">—</span>
      <span class="farr">→</span>
      <span class="fnew grpnote">${esc(t('子树内 {n} 处差异', { n: compact(row[2]) }))}</span>
      <span></span>
    </div>`;
  }

  /** 过滤后某个分组下还有多少可见叶子；无 filter 时直接复用缓存的 leaves。 */
  function visibleLeaves(node, filter) {
    if (!filter) return node.leaves;
    if (!filter(node.keys)) return 0;
    if (node.row) return 1;
    let count = 0;
    for (const child of node.children) count += visibleLeaves(child, filter);
    return count;
  }

  function fieldNodeHtml(node, depth, filter) {
    if (!filter) {
      if (node.children.length) return fieldGroupHtml(node, depth);
      if (node.row) return fieldLeafHtml(node, depth);
      return '';
    }
    if (!filter(node.keys)) return '';
    if (node.children.length) {
      const leaves = visibleLeaves(node, filter);
      if (!leaves) return '';
      return fieldGroupHtml(node, depth, leaves);
    }
    return node.row ? fieldLeafHtml(node, depth) : '';
  }

  /**
   * 把某个条目的字段差异渲染成可折叠树。
   * filter 可选：接收路径分段数组，返回 false 的节点不显示；
   * 父节点为 false 时，调用方应保证其子节点也不会被渲染（filter 自己检查祖先）。
   * opts.mergeDuplicates 为 true 时，同族且内容完全一致的分组只显示第一组。
   */
  function rowsHtml(entry, filter, opts) {
    const tree = buildTree(entry);
    if (filter && opts && opts.mergeDuplicates && !tree.merged) {
      mergeDuplicateGroups(tree, filter);
      tree.merged = true;
    }
    let body = '';
    for (const row of tree.grp) {
      if (filter && !filter(pathSegments(row[0]))) continue;
      body += fieldStaticGrpHtml(row);
    }
    for (const node of tree.root.children) body += fieldNodeHtml(node, 0, filter);
    if (!body) {
      if (!entry.f || !entry.f.length) return '';
      // 过滤后一条都不剩：这条目的差异全是模型 / 特效 / 内部标识之类，
      // 不显示空的字段树，给一句说明。
      let note = `<div class="more-note">${esc(t('该条目的差异都属于无关字段（模型、特效、装甲、内部标识等），已隐藏。'))}</div>`;
      if (entry.x) {
        note += `<div class="more-note">${esc(t('另有 {n} 处字段差异未显示（超出单条目上限）', { n: num(entry.x) }))}</div>`;
      }
      return note;
    }
    let html = '<div class="fields">' + body + '</div>';
    if (entry.x) {
      html += `<div class="more-note">${esc(t('另有 {n} 处字段差异未显示（超出单条目上限）', { n: num(entry.x) }))}</div>`;
    }
    return html;
  }

  /** 展开 / 收起一个分组行；entry 由调用方按 data-name 找到后传入。 */
  function toggleGroup(rowEl, entry, filter) {
    if (!entry) return;
    const tree = buildTree(entry);
    let segs;
    try { segs = JSON.parse(rowEl.dataset.fsegs || '[]'); } catch (err) { return; }
    let node = tree.root;
    for (const seg of segs) {
      node = node.map.get(seg);
      if (!node) return;
    }
    const wrap = rowEl.nextElementSibling;
    if (!wrap || !wrap.classList.contains('fchildren')) return;

    if (rowEl.classList.contains('open')) {
      rowEl.classList.remove('open');
      rowEl.setAttribute('aria-expanded', 'false');
      wrap.hidden = true;
      return;
    }
    if (!wrap.dataset.loaded) {
      let inner = '';
      for (const child of node.children) inner += fieldNodeHtml(child, segs.length, filter);
      wrap.innerHTML = inner;
      wrap.dataset.loaded = '1';
    }
    wrap.hidden = false;
    rowEl.classList.add('open');
    rowEl.setAttribute('aria-expanded', 'true');
  }

  return { rowsHtml, toggleGroup, buildTree, pathSegments };
})();

window.MK_fields = MK_fields;
