/* GameParams per-period change browser — 专业版 */
'use strict';

const BASE = (document.documentElement.dataset.base || './').replace(/\/+$/, '') + '/';
const PAGE_SIZE = 100;

const t = (msgid, vars) => MK_i18n.t(msgid, vars);
const tn = (msgid, n, vars) => MK_i18n.tn(msgid, n, vars);
const f1 = (n) => MK_i18n.num(n);
const fmtBig = (n) => MK_i18n.compact(n);

const state = {
  index: null,
  period: null,
  periodCache: new Map(),
  filter: { kind: 'all', type: 'all', q: '' },
  page: 0,
  expanded: new Set(),
  loading: false,
  pending: null,
  channel: 'PT',
  empty: {
    titleKey: '正在载入数据…',
    titleVars: null,
    bodyKey: '如果长时间无响应，请确认通过 HTTP 服务访问本页（直接双击打开的 file:// 页面可能被浏览器限制读取 JSON）。',
    bodyVars: null,
  },
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

function channelLabel(channel) {
  return channel === 'Live' ? t('正式服 Live') : t('测试服 PT');
}

function kindLabel(kind) {
  if (kind === 'a') return t('新增');
  if (kind === 'r') return t('删除');
  if (kind === 'm') return t('修改');
  return kind;
}

/* empty-state 的文案按“词条 + 变量”保存，切换语言时可以重画 */
function setEmpty(titleKey, titleVars, bodyKey, bodyVars) {
  state.empty = {
    titleKey,
    titleVars: titleVars || null,
    bodyKey,
    bodyVars: bodyVars || null,
  };
  paintEmpty();
}

function paintEmpty() {
  const box = el('emptyState');
  if (!box) return;
  box.hidden = false;
  box.querySelector('h2').textContent = t(state.empty.titleKey, state.empty.titleVars);
  box.querySelector('p').textContent = t(state.empty.bodyKey, state.empty.bodyVars);
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
function channelPeriods() {
  return state.index.periods.filter((p) => p.new.channel === state.channel);
}

function groupOf(name) {
  if (name === 'latest') return 'latest';
  return name.split('.')[0] + '.x';
}

function renderSidebar() {
  const list = el('periodList');
  const periods = channelPeriods();
  el('periodCount').textContent = tn('{n} 期', periods.length, { n: f1(periods.length) });

  const all = state.index.periods;
  el('chCountPT').textContent = all.filter((p) => p.new.channel === 'PT').length;
  el('chCountLive').textContent = all.filter((p) => p.new.channel === 'Live').length;
  document.querySelectorAll('#channelSeg button').forEach((b) => {
    const on = b.dataset.ch === state.channel;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  const groups = new Map();
  for (const p of periods) {
    const g = groupOf(p.new.label);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p);
  }

  let html = '';
  for (const [group, items] of groups) {
    html += `<div class="group-head">${esc(group)}<span class="muted" style="letter-spacing:0;text-transform:none;font-weight:400">${items.length}</span></div>`;
    for (const p of items) {
      const c = p.counts;
      const badge = p.new.isLatest
        ? `<span class="pitem-badge latest">${esc(t('LATEST'))}</span>`
        : '';
      html += `
        <button class="pitem" type="button" data-id="${esc(p.id)}">
          <div class="pitem-top">
            <span class="pitem-name">${esc(p.new.label)}</span>
            ${badge}
          </div>
          <div class="pitem-vs">${esc(t('对比 {channel} {label}', { channel: p.old.channel, label: p.old.label }))}</div>
          <div class="pitem-chips">
            <span class="c-a">+${f1(c.a)}</span>
            <span class="c-r">−${f1(c.r)}</span>
            <span class="c-m">~${f1(c.m)}</span>
          </div>
        </button>`;
    }
  }
  if (!periods.length) {
    html = `<div class="empty-state" style="padding:24px 12px;font-size:12px">${esc(t('暂无数据'))}</div>`;
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
  const ps = channelPeriods();
  const totalEntries = ps.reduce((s, p) => s + p.counts.a + p.counts.r + p.counts.m, 0);
  const totalFields = ps.reduce((s, p) => s + p.counts.f, 0);
  const names = ps.map((p) => p.new.label);
  el('topstats').innerHTML = `
    <div class="topstat"><b>${ps.length}</b><span>${esc(t('{channel} 总期次', { channel: state.channel }))}</span></div>
    <div class="topstat"><b>${fmtBig(totalEntries)}</b><span>${esc(t('总条目变动'))}</span></div>
    <div class="topstat"><b>${fmtBig(totalFields)}</b><span>${esc(t('总字段变化'))}</span></div>
    <div class="topstat"><b>${esc(names[names.length - 1] || '—')} → ${esc(names[0] || '—')}</b><span>${esc(t('版本跨度'))}</span></div>`;
}

function renderGenerated() {
  const raw = state.index && state.index.generated;
  el('generatedAt').textContent = t('数据生成于 {time}', {
    time: raw ? MK_i18n.dateTime(raw) : '—',
  });
}

/* ------------------------------------------------------------- period view */
function ruleLabel(rule) {
  switch (rule) {
    case 'latest-vs-latest': return t('对比正式服最新版');
    case 'same-version-prev-patch': return t('对比同版本上一测试版');
    case 'previous-live-release': return t('对比上一正式服版本');
    case 'live-vs-pt': return t('对比同版本PT版');
    case 'live-latest-vs-pt-last': return t('对比PT服最新版本');
    default: return t('对比旧版本');
  }
}

function renderPeriodShell(p) {
  const c = p.counts;
  const n = p.new;
  const o = p.old;
  const kicker = n.isLatest
    ? (n.channel === 'PT' ? t('最新测试服 PT') : t('最新正式服 Live'))
    : `${channelLabel(n.channel)} · ${n.label}`;

  el('periodView').innerHTML = `
    <section class="pv-head">
      <div class="pv-kicker">${esc(kicker)}</div>
      <h2 class="pv-title">
        <span class="new">${esc(n.channel)} ${esc(n.label)}</span>
        <span class="sep">/</span>
        <span class="old">${esc(t('对比 {channel} {label}', { channel: o.channel, label: o.label }))}</span>
      </h2>

      <div class="rule-note">
        <span class="rule-pill">${esc(ruleLabel(p.rule))}</span>
        <span>${esc(t('旧版 {old} 条 → 新版 {new} 条', { old: f1(c.oldEntries), new: f1(c.newEntries) }))}</span>
      </div>
    </section>

    <div class="stats">
      <div class="stat" style="--c:var(--green);--c2:var(--green)">
        <div class="k">${esc(t('新增条目'))}</div><div class="v">${fmtBig(c.a)}</div>
      </div>
      <div class="stat" style="--c:var(--red);--c2:var(--red)">
        <div class="k">${esc(t('删除条目'))}</div><div class="v">${fmtBig(c.r)}</div>
      </div>
      <div class="stat" style="--c:var(--amber);--c2:var(--amber)">
        <div class="k">${esc(t('修改条目'))}</div><div class="v">${fmtBig(c.m)}</div>
      </div>
      <div class="stat" style="--c:var(--accent);--c2:var(--accent)">
        <div class="k">${esc(t('字段变化'))}</div><div class="v">${fmtBig(c.f)}</div>
      </div>
    </div>

    <div class="toolbar">
      <div class="seg" id="kindSeg">
        <button type="button" data-kind="all" class="${state.filter.kind === 'all' ? 'on' : ''}">${esc(t('全部'))}<span class="n">${f1(c.a + c.r + c.m)}</span></button>
        <button type="button" data-kind="a" class="${state.filter.kind === 'a' ? 'on' : ''}">${esc(t('新增'))}<span class="n">${f1(c.a)}</span></button>
        <button type="button" data-kind="r" class="${state.filter.kind === 'r' ? 'on' : ''}">${esc(t('删除'))}<span class="n">${f1(c.r)}</span></button>
        <button type="button" data-kind="m" class="${state.filter.kind === 'm' ? 'on' : ''}">${esc(t('修改'))}<span class="n">${f1(c.m)}</span></button>
      </div>
      <div class="search">
        <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
        </svg>
        <input id="searchInput" type="search" placeholder="${esc(t('搜索条目名 / 主词条 / 字段路径 / 数值…'))}" value="${esc(state.filter.q)}" autocomplete="off" spellcheck="false">
        <button class="clear" id="searchClear" ${state.filter.q ? '' : 'hidden'} title="${esc(t('清空'))}">×</button>
      </div>
      <button class="btn" id="toggleAllBtn" type="button">${esc(t('展开当前页'))}</button>
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
  let html = `<button class="tchip ${state.filter.type === 'all' ? 'on' : ''}" type="button" data-type="all">${esc(t('全部类型'))}<span class="n">${f1(entries.length)}</span></button>`;
  for (const [type, count] of sorted) {
    html += `<button class="tchip ${state.filter.type === type ? 'on' : ''}" type="button" data-type="${esc(type)}">${esc(type)}<span class="n">${f1(count)}</span></button>`;
  }
  return html;
}

/* ------------------------------------------------------------- entries */
function haystack(entry) {
  if (entry.__hay) return entry.__hay;
  let s = (entry.p ? entry.p.toLowerCase() + ' >> ' : '') + entry.n.toLowerCase() + ' ' + entry.t.toLowerCase();
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

/** A collapsed subtree row stands for many hidden leaves. */
function fweight(entry) {
  if (!entry.f) return 0;
  let n = 0;
  for (const row of entry.f) n += row[3] === 'grp' ? row[2] : 1;
  return n;
}

/* ------------------------------------------------------------- field tree */
/* 树的渲染与折叠在 assets/fields.js，专业版 / 简洁版共用 */
function toggleFieldGroup(rowEl) {
  const box = rowEl.closest('.entry');
  if (!box) return;
  const entry = state.period.entries.find((e) => e.n === box.dataset.name);
  if (!entry) return;
  MK_fields.toggleGroup(rowEl, entry);
}

function summaryHtml(entry) {
  if (!entry.s) return '';
  const parts = [];
  const map = {
    index: t('编号'),
    level: t('等级'),
    species: t('舰种'),
    nation: t('国家'),
    name: t('名称'),
  };
  if (entry.p) parts.push(`<span>${esc(t('主词条'))} <b>${esc(entry.p)}</b></span>`);
  for (const [k, v] of Object.entries(entry.s)) {
    if (v === null || v === '') continue;
    parts.push(`<span>${esc(map[k] || k)} <b>${esc(fmtVal(v))}</b></span>`);
  }
  if (!parts.length) return '';
  return `<div class="summary-row">${parts.join('')}</div>`;
}

function renderEntry(entry) {
  const open = state.expanded.has(entry.n);
  const weight = fweight(entry);
  const countTxt = entry.f
    ? `<span class="ecount">${esc(tn('{n} 项', weight, { n: fmtBig(weight) }))}</span>`
    : '';
  const nameHtml = entry.p
    ? `<span class="eparent">${esc(entry.p)}</span><span class="esep">&gt;&gt;</span>${esc(entry.n)}`
    : esc(entry.n);
  const fullName = entry.p ? entry.p + ' >> ' + entry.n : entry.n;
  return `<div class="entry${open ? ' open' : ''}${entry.p ? ' sub' : ''}" data-name="${esc(entry.n)}">
    <button class="entry-head" type="button" aria-expanded="${open ? 'true' : 'false'}">
      <span class="kind kind-${entry.k}">${esc(kindLabel(entry.k))}</span>
      <span class="ename" title="${esc(fullName)}">${nameHtml}</span>
      <span class="etype">${esc(entry.t)}</span>
      ${countTxt}
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>
    </button>
    ${open ? summaryHtml(entry) + (entry.f ? MK_fields.rowsHtml(entry) : '') : ''}
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
         <h2>${esc(t('本期与旧版完全一致'))}</h2>
         <p>${esc(t('按当前比较口径，GameParams 没有任何条目新增、删除或字段变化。'))}</p>
       </div>`
    : `<div class="empty-state" style="padding:40px">
         <h2>${esc(t('没有匹配的条目'))}</h2>
         <p>${esc(t('试试放宽筛选条件或清空搜索关键词。'))}</p>
       </div>`);

  const from = view.length ? start + 1 : 0;
  const to = Math.min(start + PAGE_SIZE, view.length);
  el('resultMeta').innerHTML = `
    <span>${esc(t('显示 {from}–{to} / 共 {total} 条', { from: f1(from), to: f1(to), total: f1(view.length) }))}</span>
    <span>${esc(t('字段变化 {n} 项', { n: fmtBig(view.reduce((s, e) => s + fweight(e), 0)) }))}</span>`;

  renderPager(totalPages);
  el('typeChips').innerHTML = typeChipsHtml(kindFiltered());
  updateToggleAll();
}

function updateToggleAll() {
  const btn = el('toggleAllBtn');
  if (!btn || !state.period) return;
  const view = filtered();
  const start = state.page * PAGE_SIZE;
  const slice = view.slice(start, start + PAGE_SIZE);
  const allOpen = slice.length > 0 && slice.every((e) => state.expanded.has(e.n));
  btn.textContent = allOpen ? t('收起当前页') : t('展开当前页');
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
  const res = await fetch(BASE + 'data/periods/' + encodeURIComponent(id) + '.json');
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

  if (meta.new.channel !== state.channel) {
    state.channel = meta.new.channel;
    renderSidebar();
    renderTopStats();
  }

  state.loading = true;
  state.pending = null;
  markActive(id);
  setHash(id);
  setEmpty('正在载入 {label} …', { label: meta.new.label }, '正在读取本期差异数据…', null);

  try {
    const data = await loadPeriod(id);
    state.period = data;
    state.filter = { kind: 'all', type: 'all', q: '' };
    state.page = 0;
    state.expanded = new Set();
    renderPeriodShell(data);
    renderEntries();
    window.scrollTo(0, 0);
  } catch (err) {
    el('emptyState').hidden = false;
    el('periodView').hidden = true;
    setEmpty('载入失败', null,
      '无法读取 {path}（{err}）。请通过本地 HTTP 服务访问。',
      { path: 'data/periods/' + id + '.json', err: err.message });
  } finally {
    state.loading = false;
    if (state.pending && state.pending !== id) {
      const next = state.pending;
      state.pending = null;
      showPeriod(next);
    }
  }
}

/* ------------------------------------------------------------- locale */
function onLocaleChange() {
  if (!state.index) { paintEmpty(); return; }
  renderSidebar();
  renderTopStats();
  renderGenerated();
  if (state.period) {
    renderPeriodShell(state.period);
    renderEntries();
  } else {
    paintEmpty();
  }
}

/* ------------------------------------------------------------- events */
function bindEvents() {
  el('periodList').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.pitem');
    if (!btn) return;
    showPeriod(btn.dataset.id);
  });

  el('channelSeg').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-ch]');
    if (!btn || btn.dataset.ch === state.channel) return;
    state.channel = btn.dataset.ch;
    state.period = null;
    renderSidebar();
    renderTopStats();
    const first = channelPeriods()[0];
    if (first) {
      showPeriod(first.id);
    } else {
      el('periodView').hidden = true;
      setEmpty('暂无数据', null, '该数据通道暂时没有可用的期次。', null);
    }
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

    const fgroup = ev.target.closest('.frow.group');
    if (fgroup) {
      toggleFieldGroup(fgroup);
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
        box.insertAdjacentHTML('beforeend', summaryHtml(entry) + (entry.f ? MK_fields.rowsHtml(entry) : ''));
      }
      updateToggleAll();
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

  el('periodView').addEventListener('keydown', (ev) => {
    const g = ev.target.closest('.frow.group');
    if (!g) return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      toggleFieldGroup(g);
    }
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
  await MK_i18n.init();
  MK_chrome.mount();
  document.addEventListener('mk:localechange', onLocaleChange);
  paintEmpty();

  try {
    const res = await fetch(BASE + 'data/index.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.index = await res.json();
  } catch (err) {
    el('periodView').hidden = true;
    setEmpty('无法载入数据', null,
      '读取 {path} 失败（{err}）。请用 HTTP 服务打开本页，例如在 web 目录执行 python -m http.server。',
      { path: 'data/index.json', err: err.message });
    return;
  }

  const want = currentId();
  const wanted = want ? state.index.periods.find((p) => p.id === want) : null;
  if (wanted) state.channel = wanted.new.channel;

  renderSidebar();
  renderTopStats();
  renderGenerated();
  bindEvents();

  const first = channelPeriods()[0];
  const target = wanted ? wanted.id : (first && first.id);
  if (target) showPeriod(target);
}

boot();
