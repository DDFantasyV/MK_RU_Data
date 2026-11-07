/* GameParams per-period change browser */
'use strict';

const PAGE_SIZE = 100;

const state = {
  index: null,
  period: null,
  periodCache: new Map(),
  filter: { kind: 'all', type: 'all', q: '' },
  page: 0,
  expanded: new Set(),
  loading: false,
  pending: null,
};

const el = (id) => document.getElementById(id);

/* ------------------------------------------------------------- utilities */
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

function fmtBytes(n) {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

/* Windows build paths -> URL-ish display */
function fmtRel(rel) {
  return esc(String(rel || '').replace(/\\/g, '/'));
}

function f1(n) {
  return n.toLocaleString('zh-CN');
}

/* large counters read better in 万 / 亿 */
function fmtBig(n) {
  if (!n) return '0';
  if (n >= 1e8) return (n / 1e8).toFixed(2).replace(/\.?0+$/, '') + ' 亿';
  if (n >= 1e4) return (n / 1e4).toFixed(2).replace(/\.?0+$/, '') + ' 万';
  return f1(n);
}

/* ------------------------------------------------------------- routing */
function currentId() {
  return decodeURIComponent(location.hash.replace(/^#\/?/, '').trim());
}

function setHash(id) {
  const next = '#/' + id;
  if (location.hash !== next) {
    history.replaceState(null, '', next);
  }
}

/* ------------------------------------------------------------- sidebar */
function groupOf(name) {
  if (name === 'latest') return 'latest';
  return name.split('.')[0] + '.x';
}

function renderSidebar() {
  const list = el('periodList');
  const periods = state.index.periods;
  el('periodCount').textContent = periods.length + ' 期';

  const groups = new Map();
  for (const p of periods) {
    const g = groupOf(p.new.name);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p);
  }

  let html = '';
  for (const [group, items] of groups) {
    html += `<div class="group-head">${esc(group)}<span class="muted" style="letter-spacing:0;text-transform:none;font-weight:400">${items.length}</span></div>`;
    for (const p of items) {
      const c = p.counts;
      const badge = p.new.name === 'latest'
        ? '<span class="pitem-badge latest">LATEST</span>'
        : `<span class="pitem-badge">${esc(p.new.channel)}</span>`;
      html += `
        <button class="pitem" type="button" data-id="${esc(p.id)}">
          <div class="pitem-top">
            <span class="pitem-name">${esc(p.new.name)}</span>
            ${badge}
          </div>
          <div class="pitem-vs">vs ${esc(p.old.channel)} ${esc(p.old.name)}</div>
          <div class="pitem-chips">
            <span class="c-a">+${f1(c.a)}</span>
            <span class="c-r">−${f1(c.r)}</span>
            <span class="c-m">~${f1(c.m)}</span>
          </div>
        </button>`;
    }
  }
  list.innerHTML = html;
}

function markActive(id) {
  document.querySelectorAll('.pitem').forEach((b) => {
    const on = b.dataset.id === id;
    b.classList.toggle('active', on);
    if (on) b.scrollIntoView({ block: 'nearest' });
  });
}

/* ------------------------------------------------------------- top stats */
function renderTopStats() {
  const ps = state.index.periods;
  const totalEntries = ps.reduce((s, p) => s + p.counts.a + p.counts.r + p.counts.m, 0);
  const totalFields = ps.reduce((s, p) => s + p.counts.f, 0);
  const names = ps.map((p) => p.new.name).filter((n) => n !== 'latest');
  el('topstats').innerHTML = `
    <div class="topstat"><b>${ps.length}</b><span>期次</span></div>
    <div class="topstat"><b>${fmtBig(totalEntries)}</b><span>条目变动</span></div>
    <div class="topstat"><b>${fmtBig(totalFields)}</b><span>字段变化</span></div>
    <div class="topstat"><b>${esc(names[names.length - 1] || '—')} → ${esc(names[0] || '—')}</b><span>版本跨度</span></div>`;
}

/* ------------------------------------------------------------- period view */
function ruleLabel(rule) {
  switch (rule) {
    case 'latest-vs-latest': return '对比 Live 最新一期';
    case 'same-version-prev-patch': return '对比同版本上一测试版';
    case 'previous-live-release': return '对比上一期正式服版本';
    default: return '对比旧版本';
  }
}

function renderPeriodShell(p) {
  const c = p.counts;
  const n = p.new;
  const o = p.old;
  const kicker = n.name === 'latest'
    ? '最新测试服快照'
    : `PT 测试服 · ${esc(n.name)}`;

  el('periodView').innerHTML = `
    <section class="pv-head">
      <div class="pv-kicker">${kicker}</div>
      <h2 class="pv-title">
        <span class="new">${esc(n.channel)} ${esc(n.name)}</span>
        <span class="sep">/</span>
        <span class="old">对比 ${esc(o.channel)} ${esc(o.name)}</span>
      </h2>

      <div class="pv-compare">
        <div class="side-card old">
          <div class="side-label">旧版基线</div>
          <div class="side-name">${esc(o.channel)} ${esc(o.name)}</div>
          <div class="side-meta">${fmtRel(o.rel)} · ${fmtBytes(o.size)}</div>
        </div>
        <div class="arrow-mid">→</div>
        <div class="side-card new">
          <div class="side-label">新版</div>
          <div class="side-name">${esc(n.channel)} ${esc(n.name)}</div>
          <div class="side-meta">${fmtRel(n.rel)} · ${fmtBytes(n.size)}</div>
        </div>
      </div>

      <div class="rule-note">
        <span class="rule-pill">${ruleLabel(p.rule)}</span>
        <span>旧版 ${f1(c.oldEntries)} 条 → 新版 ${f1(c.newEntries)} 条</span>
      </div>
    </section>

    <div class="stats">
      <div class="stat" style="--c:var(--green);--c2:var(--green)">
        <div class="k">新增条目</div><div class="v">${fmtBig(c.a)}</div>
      </div>
      <div class="stat" style="--c:var(--red);--c2:var(--red)">
        <div class="k">删除条目</div><div class="v">${fmtBig(c.r)}</div>
      </div>
      <div class="stat" style="--c:var(--amber);--c2:var(--amber)">
        <div class="k">修改条目</div><div class="v">${fmtBig(c.m)}</div>
      </div>
      <div class="stat" style="--c:var(--accent);--c2:var(--accent)">
        <div class="k">字段变化</div><div class="v">${fmtBig(c.f)}</div>
      </div>
    </div>

    <div class="toolbar">
      <div class="seg" id="kindSeg">
        <button type="button" data-kind="all" class="on">全部<span class="n">${f1(c.a + c.r + c.m)}</span></button>
        <button type="button" data-kind="a">新增<span class="n">${f1(c.a)}</span></button>
        <button type="button" data-kind="r">删除<span class="n">${f1(c.r)}</span></button>
        <button type="button" data-kind="m">修改<span class="n">${f1(c.m)}</span></button>
      </div>
      <div class="search">
        <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
        </svg>
        <input id="searchInput" type="search" placeholder="搜索条目名 / 字段路径 / 数值…" autocomplete="off" spellcheck="false">
        <button class="clear" id="searchClear" hidden title="清空">×</button>
      </div>
      <button class="btn" id="toggleAllBtn" type="button">展开当前页</button>
    </div>

    <div class="typechips" id="typeChips"></div>
    <div class="result-meta" id="resultMeta"></div>
    <div class="entries" id="entries"></div>
    <div class="pager" id="pager"></div>
  `;
  el('periodView').hidden = false;
  el('emptyState').hidden = true;
}

function typeChipsHtml(entries) {
  const counts = new Map();
  for (const e of entries) counts.set(e.t, (counts.get(e.t) || 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  let html = `<button class="tchip ${state.filter.type === 'all' ? 'on' : ''}" type="button" data-type="all">全部类型<span class="n">${f1(entries.length)}</span></button>`;
  for (const [t, n] of sorted) {
    html += `<button class="tchip ${state.filter.type === t ? 'on' : ''}" type="button" data-type="${esc(t)}">${esc(t)}<span class="n">${f1(n)}</span></button>`;
  }
  return html;
}

/* ------------------------------------------------------------- entries */
function haystack(entry) {
  if (entry.__hay) return entry.__hay;
  let s = entry.n.toLowerCase() + ' ' + entry.t.toLowerCase();
  if (entry.f) {
    for (const row of entry.f) {
      s += ' ' + row[0].toLowerCase() + ' ' + String(row[1]).toLowerCase() + ' ' + String(row[2]).toLowerCase();
    }
  }
  entry.__hay = s;
  return s;
}

function filtered() {
  const entries = state.period.entries;
  const { kind, type, q } = state.filter;
  const needle = q.trim().toLowerCase();
  return entries.filter((e) => {
    if (kind !== 'all' && e.k !== kind) return false;
    if (type !== 'all' && e.t !== type) return false;
    if (needle && !haystack(e).includes(needle)) return false;
    return true;
  });
}

const KIND_LABEL = { a: '新增', r: '删除', m: '修改' };

/** A collapsed subtree row stands for many hidden leaves. */
function fweight(entry) {
  if (!entry.f) return 0;
  let n = 0;
  for (const row of entry.f) n += row[3] === 'grp' ? row[2] : 1;
  return n;
}

function fieldRowsHtml(entry) {
  let html = '<div class="fields">';
  for (const [path, oldV, newV, kind] of entry.f) {
    if (kind === 'grp') {
      html += `<div class="frow grp">
        <span class="fpath">${esc(path)}</span>
        <span class="fold void">—</span>
        <span class="farr">→</span>
        <span class="fnew grpnote">子树内 ${fmtBig(newV)} 处差异</span>
        <span></span>
      </div>`;
      continue;
    }
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
    html += `<div class="frow${cls}">
      <span class="fpath">${esc(path)}</span>
      <span class="fold ${kind === 'add' ? 'void' : ''}">${oldTxt}</span>
      <span class="farr">→</span>
      <span class="fnew ${kind === 'del' ? 'void' : ''}">${newTxt}</span>
      ${delta || '<span></span>'}
    </div>`;
  }
  html += '</div>';
  if (entry.x) {
    html += `<div class="more-note">另有 ${f1(entry.x)} 处字段差异未显示（超出单条目上限）</div>`;
  }
  return html;
}

function summaryHtml(entry) {
  if (!entry.s) return '';
  const parts = [];
  const map = { index: '编号', level: '等级', species: '舰种', nation: '国家', name: '名称' };
  for (const [k, v] of Object.entries(entry.s)) {
    if (v === null || v === '') continue;
    parts.push(`<span>${esc(map[k] || k)} <b>${esc(fmtVal(v))}</b></span>`);
  }
  if (!parts.length) return '';
  return `<div class="summary-row">${parts.join('')}</div>`;
}

function renderEntry(entry) {
  const open = state.expanded.has(entry.n);
  const countTxt = entry.k === 'm'
    ? `<b>${fmtBig(fweight(entry))}</b> 项`
    : '';
  return `<div class="entry${open ? ' open' : ''}" data-name="${esc(entry.n)}">
    <button class="entry-head" type="button" aria-expanded="${open ? 'true' : 'false'}">
      <span class="kind kind-${entry.k}">${KIND_LABEL[entry.k]}</span>
      <span class="ename">${esc(entry.n)}</span>
      <span class="etype">${esc(entry.t)}</span>
      ${countTxt ? `<span class="ecount">${countTxt}</span>` : ''}
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>
    </button>
    ${open ? summaryHtml(entry) + (entry.f ? fieldRowsHtml(entry) : '') : ''}
  </div>`;
}

function kindFiltered() {
  const { kind, q } = state.filter;
  const needle = q.trim().toLowerCase();
  return state.period.entries.filter((e) => {
    if (kind !== 'all' && e.k !== kind) return false;
    if (needle && !haystack(e).includes(needle)) return false;
    return true;
  });
}

function renderEntries() {
  const view = filtered();
  const totalPages = Math.max(1, Math.ceil(view.length / PAGE_SIZE));
  if (state.page >= totalPages) state.page = totalPages - 1;
  if (state.page < 0) state.page = 0;
  const start = state.page * PAGE_SIZE;
  const slice = view.slice(start, start + PAGE_SIZE);

  el('entries').innerHTML = slice.map(renderEntry).join('') || (state.period.entries.length === 0
    ? `<div class="empty-state" style="padding:48px 24px">
         <h2>本期与旧版完全一致</h2>
         <p>按当前比较口径，GameParams 没有任何条目新增、删除或字段变化。</p>
       </div>`
    : `<div class="empty-state" style="padding:40px">
         <h2>没有匹配的条目</h2>
         <p>试试放宽筛选条件或清空搜索关键词。</p>
       </div>`);

  const from = view.length ? start + 1 : 0;
  const to = Math.min(start + PAGE_SIZE, view.length);
  el('resultMeta').innerHTML = `
    <span>显示 <b style="color:var(--text-2)">${f1(from)}–${f1(to)}</b> / 共 ${f1(view.length)} 条</span>
    <span>字段变化 ${fmtBig(view.reduce((s, e) => s + fweight(e), 0))} 项</span>`;

  renderPager(totalPages);
  el('typeChips').innerHTML = typeChipsHtml(kindFiltered());
}

function renderPager(totalPages) {
  const pager = el('pager');
  if (totalPages <= 1) { pager.innerHTML = ''; return; }
  const cur = state.page;
  const make = (label, page, opts = {}) =>
    `<button type="button" data-page="${page}" ${opts.on ? 'class="on"' : ''} ${opts.disabled ? 'disabled' : ''}>${label}</button>`;

  const parts = [make('‹', cur - 1, { disabled: cur === 0 })];
  const wanted = [...new Set([0, totalPages - 1, cur, cur - 1, cur + 1])]
    .filter((p) => p >= 0 && p < totalPages)
    .sort((a, b) => a - b);
  let prev = -1;
  for (const p of wanted) {
    if (prev !== -1 && p - prev > 1) parts.push('<span class="gap">…</span>');
    parts.push(make(String(p + 1), p, { on: p === cur }));
    prev = p;
  }
  parts.push(make('›', cur + 1, { disabled: cur === totalPages - 1 }));
  pager.innerHTML = parts.join('');
}

/* ------------------------------------------------------------- loading */
async function loadPeriod(id) {
  if (state.periodCache.has(id)) return state.periodCache.get(id);
  const res = await fetch('data/periods/' + encodeURIComponent(id) + '.json');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  state.periodCache.set(id, data);
  return data;
}

async function showPeriod(id) {
  const meta = state.index.periods.find((p) => p.id === id);
  if (!meta) {
    const first = state.index.periods[0];
    if (first && first.id !== id) return showPeriod(first.id);
    return;
  }
  if (state.loading) {
    state.pending = id;
    return;
  }

  state.loading = true;
  state.pending = null;
  markActive(id);
  setHash(id);
  el('emptyState').hidden = false;
  el('emptyState').querySelector('h2').textContent = '正在载入 ' + meta.new.name + ' …';
  el('emptyState').querySelector('p').textContent = '正在读取本期差异数据…';

  try {
    const data = await loadPeriod(id);
    state.period = data;
    state.filter = { kind: 'all', type: 'all', q: '' };
    state.page = 0;
    state.expanded = new Set();
    renderPeriodShell(data);
    el('toggleAllBtn').textContent = '展开当前页';
    renderEntries();
    window.scrollTo(0, 0);
  } catch (err) {
    el('emptyState').hidden = false;
    el('emptyState').querySelector('h2').textContent = '载入失败';
    el('emptyState').querySelector('p').textContent =
      '无法读取 data/periods/' + id + '.json（' + err.message + '）。请通过本地 HTTP 服务访问。';
    el('periodView').hidden = true;
  } finally {
    state.loading = false;
    if (state.pending && state.pending !== id) {
      const next = state.pending;
      state.pending = null;
      showPeriod(next);
    }
  }
}

/* ------------------------------------------------------------- events */
function bindEvents() {
  el('periodList').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.pitem');
    if (!btn) return;
    showPeriod(btn.dataset.id);
  });

  el('periodView').addEventListener('click', (ev) => {
    const seg = ev.target.closest('#kindSeg button');
    if (seg) {
      state.filter.kind = seg.dataset.kind;
      document.querySelectorAll('#kindSeg button').forEach((b) => b.classList.toggle('on', b === seg));
      state.page = 0;
      renderEntries();
      return;
    }

    const chip = ev.target.closest('.tchip');
    if (chip) {
      state.filter.type = chip.dataset.type;
      state.page = 0;
      renderEntries();
      return;
    }

    const head = ev.target.closest('.entry-head');
    if (head) {
      const box = head.closest('.entry');
      const name = box.dataset.name;
      const entry = state.period.entries.find((e) => e.n === name);
      if (!entry) return;
      if (state.expanded.has(name)) {
        state.expanded.delete(name);
        box.classList.remove('open');
        head.setAttribute('aria-expanded', 'false');
        box.querySelectorAll('.fields, .summary-row, .more-note').forEach((n) => n.remove());
      } else {
        state.expanded.add(name);
        box.classList.add('open');
        head.setAttribute('aria-expanded', 'true');
        box.insertAdjacentHTML('beforeend', summaryHtml(entry) + (entry.f ? fieldRowsHtml(entry) : ''));
      }
      return;
    }

    const page = ev.target.closest('#pager button');
    if (page && !page.disabled) {
      state.page = Number(page.dataset.page);
      renderEntries();
      el('entries').scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }

    if (ev.target.closest('#toggleAllBtn')) {
      const view = filtered();
      const start = state.page * PAGE_SIZE;
      const slice = view.slice(start, start + PAGE_SIZE);
      const allOpen = slice.every((e) => state.expanded.has(e.n));
      for (const e of slice) {
        if (allOpen) state.expanded.delete(e.n);
        else state.expanded.add(e.n);
      }
      el('toggleAllBtn').textContent = allOpen ? '展开当前页' : '收起当前页';
      renderEntries();
    }
  });

  el('periodView').addEventListener('input', (ev) => {
    if (ev.target.id !== 'searchInput') return;
    state.filter.q = ev.target.value;
    const clear = el('searchClear');
    if (clear) clear.hidden = !ev.target.value;
    state.page = 0;
    renderEntries();
  });

  el('periodView').addEventListener('click', (ev) => {
    if (ev.target.id !== 'searchClear') return;
    const input = el('searchInput');
    input.value = '';
    ev.target.hidden = true;
    state.filter.q = '';
    state.page = 0;
    renderEntries();
    input.focus();
  });

  document.addEventListener('keydown', (ev) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (ev.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) {
      ev.preventDefault();
      const input = el('searchInput');
      if (input) input.focus();
    }
    if (ev.key === 'Escape' && document.activeElement.id === 'searchInput') {
      document.activeElement.blur();
    }
  });

  window.addEventListener('hashchange', () => {
    const id = currentId();
    if (id && (!state.period || state.period.id !== id)) showPeriod(id);
  });
}

/* ------------------------------------------------------------- boot */
async function boot() {
  try {
    const res = await fetch('data/index.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.index = await res.json();
  } catch (err) {
    el('emptyState').innerHTML =
      `<h2>无法载入数据</h2><p>读取 <code>data/index.json</code> 失败（${esc(err.message)}）。` +
      `请用 HTTP 服务打开本页，例如在 <code>web/</code> 目录执行 <code>python -m http.server</code>。</p>`;
    return;
  }

  renderSidebar();
  renderTopStats();
  el('generatedAt').textContent = '数据生成于 ' + (state.index.generated || '—');
  bindEvents();

  const want = currentId();
  const target = want && state.index.periods.some((p) => p.id === want)
    ? want
    : (state.index.periods[0] && state.index.periods[0].id);
  if (target) showPeriod(target);
}

boot();
