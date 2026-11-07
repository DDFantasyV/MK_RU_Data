/* GameParams per-period change browser — 简洁版
 *
 * 只保留“战舰 + 战舰配件”相关的条目，并在左侧按战舰汇总：
 *   - Ship / Unit / Component / Gun / Projectile / Aircraft / Radar /
 *     Director / Finder / Catapult / Modernization / Ability
 *   - 以及挂了 parentShip 的 Other（RageMode 等舰船机制）
 * 涂装、旗帜、贴花、成就、收藏、船长等独立内容不在此列。
 *
 * 视觉上仍是“扁平清单 + 展开”，没有字段树；每次加载 60 条。
 */
'use strict';

const BASE = (document.documentElement.dataset.base || './').replace(/\/+$/, '') + '/';
const PAGE = 60;
const UNATTACHED = '__unattached__';

/* 战舰本体与配件；Exterior（涂装/旗帜/贴花）、Crew、Achievement 等不在其中 */
const SHIP_TYPES = new Set([
  'Ship', 'Unit', 'Component', 'Gun', 'Projectile', 'Aircraft',
  'Radar', 'Director', 'Finder', 'Catapult', 'Modernization', 'Ability',
]);

const t = (msgid, vars) => MK_i18n.t(msgid, vars);
const tn = (msgid, n, vars) => MK_i18n.tn(msgid, n, vars);
const num = (n) => MK_i18n.num(n);
const compact = (n) => MK_i18n.compact(n);

const state = {
  index: null,
  periods: [],
  period: null,
  channel: 'PT',
  periodCache: new Map(),
  kind: 'all',
  q: '',
  ship: '',
  shipQuery: '',
  fieldFilter: null,
  fieldConfigFailed: false,
  expanded: new Set(),
  limit: PAGE,
  loading: false,
  pending: null,
  empty: {
    titleKey: '正在载入数据…',
    titleVars: null,
    bodyKey: '如果长时间无响应，请确认通过 HTTP 服务访问本页（直接双击打开的 file:// 页面可能被浏览器限制读取 JSON）。',
    bodyVars: null,
  },
};

const el = (id) => document.getElementById(id);

/* ------------------------------------------------------------- helpers */
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

function kindLabel(kind) {
  if (kind === 'a') return t('新增');
  if (kind === 'r') return t('删除');
  if (kind === 'm') return t('修改');
  return kind;
}

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

function currentId() {
  return decodeURIComponent(location.hash.replace(/^#\/?/, '').trim());
}

function setHash(id) {
  const next = '#/' + id;
  if (location.hash !== next) history.replaceState(null, '', next);
}

function channelPeriods() {
  return state.periods.filter((p) => p.new.channel === state.channel);
}

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

function fweight(entry) {
  if (!entry.f) return 0;
  let n = 0;
  for (const row of entry.f) n += row[3] === 'grp' ? row[2] : 1;
  return n;
}

/* ------------------------------------------------------------- ship filter */
function isShipRelated(entry) {
  if (SHIP_TYPES.has(entry.t)) return true;
  return entry.t === 'Other' && !!entry.p;
}

function shipOf(entry) {
  if (entry.t === 'Ship') return entry.n;
  return entry.p || null;
}

/**
 * 条目在字段清单下是否还有可见差异。所有差异都被隐藏的条目不再出现在
 * 列表和计数里；没有字段行的条目（已删除、只有摘要等）照常保留。
 */
function entryHasVisibleFields(entry) {
  if (!entry.f || !entry.f.length) return true;
  if (!state.fieldFilter) return true;              // 清单未就绪 / 加载失败 → 全部显示
  if (entry.__visFilter === state.fieldFilter) return entry.__vis;
  const pathSegments = MK_fields.pathSegments;
  const visible = entry.f.some((row) => state.fieldFilter(pathSegments(row[0])));
  entry.__vis = visible;
  entry.__visFilter = state.fieldFilter;
  return visible;
}

function shipRelated() {
  return state.period.entries.filter(isShipRelated).filter(entryHasVisibleFields);
}

/** 当前选中的战舰（或全部 / 未归属）下的条目，不套用搜索与变更类型筛选 */
function scopedEntries() {
  const rows = shipRelated();
  if (!state.ship) return rows;
  return rows.filter((entry) => {
    const key = shipOf(entry);
    if (state.ship === UNATTACHED) return !key;
    return key === state.ship;
  });
}

function groupShips() {
  const ships = new Map();
  const total = { a: 0, r: 0, m: 0, entries: 0 };
  let unattached = null;
  for (const entry of shipRelated()) {
    total[entry.k] = (total[entry.k] || 0) + 1;
    total.entries += 1;
    const key = shipOf(entry);
    let row;
    if (!key) {
      if (!unattached) unattached = { kinds: { a: 0, r: 0, m: 0 }, entries: 0 };
      row = unattached;
    } else {
      row = ships.get(key);
      if (!row) {
        row = { name: key, kinds: { a: 0, r: 0, m: 0 }, entries: 0 };
        ships.set(key, row);
      }
    }
    row.kinds[entry.k] = (row.kinds[entry.k] || 0) + 1;
    row.entries += 1;
  }
  const list = [...ships.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { ships: list, unattached, total };
}

function chipsHtml(kinds) {
  let html = '';
  if (kinds.a) html += `<span class="c-a">+${num(kinds.a)}</span>`;
  if (kinds.r) html += `<span class="c-r">−${num(kinds.r)}</span>`;
  if (kinds.m) html += `<span class="c-m">~${num(kinds.m)}</span>`;
  return html;
}

function shipRowHtml(value, label, kinds, active) {
  const chips = chipsHtml(kinds);
  return `<button class="ship-item${active ? ' on' : ''}" type="button" data-ship="${esc(value)}" title="${esc(label)}">
    <span class="ship-name">${esc(label)}</span>
    ${chips ? `<span class="ship-chips">${chips}</span>` : ''}
  </button>`;
}

function renderShips() {
  const { ships, unattached, total } = groupShips();
  el('shipCount').textContent = tn('{n} 艘', ships.length, { n: num(ships.length) });

  const list = el('shipList');
  if (!total.entries) {
    list.innerHTML = `<div class="ship-empty">${esc(t('暂无数据'))}</div>`;
    return;
  }

  const query = state.shipQuery.trim().toLowerCase();
  const visible = query ? ships.filter((s) => s.name.toLowerCase().includes(query)) : ships;
  const parts = [shipRowHtml('', t('全部战舰'), total, !state.ship)];
  for (const ship of visible) parts.push(shipRowHtml(ship.name, ship.name, ship.kinds, state.ship === ship.name));
  if (!query && unattached) {
    parts.push(shipRowHtml(UNATTACHED, t('未归属配件'), unattached.kinds, state.ship === UNATTACHED));
  }
  if (query && !visible.length) parts.push(`<div class="ship-empty">${esc(t('没有匹配的战舰'))}</div>`);
  list.innerHTML = parts.join('');
}

/* ------------------------------------------------------------- empty state */
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
  const box = el('simpleEmpty');
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `<h2>${esc(t(state.empty.titleKey, state.empty.titleVars))}</h2>` +
    `<p>${esc(t(state.empty.bodyKey, state.empty.bodyVars))}</p>`;
}

function hideEmpty() {
  el('simpleEmpty').hidden = true;
}

/* ------------------------------------------------------------- chrome parts */
function renderChannels() {
  el('simpleCountPT').textContent = state.periods.filter((p) => p.new.channel === 'PT').length;
  el('simpleCountLive').textContent = state.periods.filter((p) => p.new.channel === 'Live').length;
  document.querySelectorAll('#simpleChannels button').forEach((b) => {
    const on = b.dataset.ch === state.channel;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

function renderPeriodSelect() {
  const select = el('periodSelect');
  const list = channelPeriods();
  select.innerHTML = list.map((p) => `<option value="${esc(p.id)}">${esc(p.new.label)}</option>`).join('');
  if (state.period) select.value = state.period.id;
}

function renderHead() {
  const p = state.period;
  const n = p.new;
  const o = p.old;
  el('simpleKicker').textContent = ruleLabel(p.rule);
  el('simpleTitle').innerHTML =
    `<span class="new">${esc(n.channel)} ${esc(n.label)}</span>` +
    `<span class="sep">/</span>` +
    `<span class="old">${esc(t('对比 {channel} {label}', { channel: o.channel, label: o.label }))}</span>`;
}

function renderStats() {
  const stats = { a: 0, r: 0, m: 0, f: 0 };
  for (const entry of scopedEntries()) {
    stats[entry.k] = (stats[entry.k] || 0) + 1;
    stats.f += fweight(entry);
  }
  el('simpleStats').innerHTML = `
    <div class="schip a"><span class="k">${esc(t('新增'))}</span><b>${compact(stats.a)}</b></div>
    <div class="schip r"><span class="k">${esc(t('删除'))}</span><b>${compact(stats.r)}</b></div>
    <div class="schip m"><span class="k">${esc(t('修改'))}</span><b>${compact(stats.m)}</b></div>
    <div class="schip f"><span class="k">${esc(t('字段变化'))}</span><b>${compact(stats.f)}</b></div>`;
}

function renderGenerated() {
  const raw = state.index && state.index.generated;
  el('generatedAt').textContent = t('数据生成于 {time}', {
    time: raw ? MK_i18n.dateTime(raw) : '—',
  });
}

/* ------------------------------------------------------------- entry rendering */
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

function entryBody(entry) {
  let html = summaryHtml(entry);
  if (entry.f) html += MK_fields.rowsHtml(entry, state.fieldFilter, { mergeDuplicates: true });
  else if (entry.k === 'r') html += `<div class="more-note">${esc(t('该条目已删除，仅保留摘要。'))}</div>`;
  return html;
}

function entryHtml(entry) {
  const open = state.expanded.has(entry.n);
  const weight = fweight(entry);
  const count = entry.f ? `<span class="ecount">${esc(tn('{n} 项', weight, { n: compact(weight) }))}</span>` : '';
  const name = entry.p
    ? `<span class="eparent">${esc(entry.p)}</span><span class="esep">&gt;&gt;</span>${esc(entry.n)}`
    : esc(entry.n);
  const fullName = entry.p ? entry.p + ' >> ' + entry.n : entry.n;
  return `<div class="entry${open ? ' open' : ''}${entry.p ? ' sub' : ''}" data-name="${esc(entry.n)}">
    <button class="entry-head" type="button" aria-expanded="${open ? 'true' : 'false'}">
      <span class="kind kind-${entry.k}">${esc(kindLabel(entry.k))}</span>
      <span class="ename" title="${esc(fullName)}">${name}</span>
      <span class="etype">${esc(entry.t)}</span>
      ${count}
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>
    </button>
    ${open ? entryBody(entry) : ''}
  </div>`;
}

/* ------------------------------------------------------------- list */
function filtered() {
  const needle = state.q.trim().toLowerCase();
  return scopedEntries().filter((entry) => {
    if (state.kind !== 'all' && entry.k !== state.kind) return false;
    if (needle && !haystack(entry).includes(needle)) return false;
    return true;
  });
}

function scopeLabel() {
  return state.ship === UNATTACHED ? t('未归属配件') : state.ship;
}

function entryOf(node) {
  const box = node.closest('.entry');
  if (!box) return null;
  return state.period.entries.find((e) => e.n === box.dataset.name) || null;
}

/* ------------------------------------------------------------- field whitelist */
/**
 * 继承语义：
 *   - 显式 `true`：该节点及其整棵子树可见（没列出来的子路径继承父项）；
 *   - 显式 `false`：该节点及其整棵子树不可见（优先于更深层的 true）；
 *   - 没写到的路径：继承父项；顶级路径默认不可见。
 * 所以只写一级条目的清单（例如 `A_ATBA: true;`）就能控制整棵子树。
 */
function createFieldFilter(config) {
  return (keys) => {
    let path = '';
    let visible = false;
    for (const key of keys) {
      path = path ? path + ' >> ' + key : key;
      const value = config.get(path);
      if (value === false) return false;
      if (value === true) visible = true;
    }
    return visible;
  };
}

let fieldConfigPromise = null;

/** 首次展开条目时载入 field-tree.conf；失败时退回“全部显示”。 */
function ensureFieldConfig() {
  if (fieldConfigPromise) return fieldConfigPromise;
  fieldConfigPromise = (async () => {
    try {
      const res = await fetch(BASE + 'simple/field-tree.conf', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const config = new Map();
      for (const line of text.split(/\r?\n/)) {
        const value = line.trim();
        if (!value || value.charAt(0) === '#') continue;
        const match = /^(.*?):\s*(true|false)\s*;?\s*$/.exec(value);
        if (match) config.set(match[1].trim(), match[2] === 'true');
      }
      state.fieldFilter = createFieldFilter(config);
    } catch (err) {
      console.warn('[simple] 无法载入 field-tree.conf，字段树将全部显示：' + err.message);
      state.fieldFilter = null;
      state.fieldConfigFailed = true;
    }
    return state.fieldFilter;
  })();
  return fieldConfigPromise;
}

function renderList() {
  const all = shipRelated();
  const view = filtered();
  const total = view.length;
  const slice = view.slice(0, state.limit);
  el('simpleList').innerHTML = slice.map(entryHtml).join('');

  if (state.period.entries.length === 0) {
    el('simpleMeta').innerHTML = '';
    el('simpleEmpty').hidden = false;
    el('simpleEmpty').innerHTML =
      `<h2>${esc(t('本期与旧版完全一致'))}</h2>` +
      `<p>${esc(t('按当前比较口径，GameParams 没有任何条目新增、删除或字段变化。'))}</p>`;
  } else if (all.length === 0) {
    el('simpleMeta').innerHTML = '';
    el('simpleEmpty').hidden = false;
    el('simpleEmpty').innerHTML =
      `<h2>${esc(t('该期没有战舰或配件变更'))}</h2>` +
      `<p>${esc(t('按当前比较口径，GameParams 没有任何条目新增、删除或字段变化。'))}</p>`;
  } else if (total === 0) {
    el('simpleMeta').innerHTML = '';
    el('simpleEmpty').hidden = false;
    el('simpleEmpty').innerHTML =
      `<h2>${esc(t('没有匹配的条目'))}</h2>` +
      `<p>${esc(t('试试放宽筛选条件或清空搜索关键词。'))}</p>`;
  } else {
    hideEmpty();
    const scope = state.ship
      ? `<span class="simple-scope">${esc(scopeLabel())}</span>`
      : '';
    el('simpleMeta').innerHTML = scope +
      `<span>${esc(t('显示 {from}–{to} / 共 {total} 条', {
        from: num(1),
        to: num(slice.length),
        total: num(total),
      }))}</span>`;
  }
  renderMore(total);
}

function renderMore(total) {
  const box = el('simpleMore');
  if (total > state.limit) {
    box.innerHTML = `<button class="btn" id="simpleMoreBtn" type="button">${esc(t('加载更多'))}</button>`;
  } else if (total > 0) {
    box.innerHTML = `<span class="simple-note">${esc(t('已显示全部 {n} 条', { n: num(total) }))}</span>`;
  } else {
    box.innerHTML = '';
  }
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

function syncKindButtons() {
  document.querySelectorAll('#simpleKind button').forEach((b) => {
    b.classList.toggle('on', b.dataset.kind === state.kind);
  });
}

async function showPeriod(id) {
  if (state.loading) {
    state.pending = id;
    return;
  }
  const meta = state.periods.find((p) => p.id === id);
  if (!meta) {
    const first = channelPeriods()[0];
    if (first && first.id !== id) return showPeriod(first.id);
    return;
  }

  if (meta.new.channel !== state.channel) {
    state.channel = meta.new.channel;
    renderChannels();
    renderPeriodSelect();
  }

  state.loading = true;
  state.pending = null;
  setHash(id);
  setEmpty('正在载入 {label} …', { label: meta.new.label }, '正在读取本期差异数据…', null);
  el('simpleList').innerHTML = '';
  el('simpleMeta').innerHTML = '';
  el('simpleMore').innerHTML = '';

  try {
    const data = await loadPeriod(id);
    state.period = data;
    state.kind = 'all';
    state.q = '';
    state.ship = '';
    state.shipQuery = '';
    state.expanded = new Set();
    state.limit = PAGE;
    el('simpleSearch').value = '';
    el('simpleClear').hidden = true;
    el('shipSearch').value = '';
    syncKindButtons();
    hideEmpty();
    renderShips();
    renderHead();
    renderStats();
    renderPeriodSelect();
    renderList();
    window.scrollTo(0, 0);
  } catch (err) {
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
  renderChannels();
  renderPeriodSelect();
  renderGenerated();
  if (!state.period) { paintEmpty(); return; }
  renderShips();
  renderHead();
  renderStats();
  renderList();
}

/* ------------------------------------------------------------- events */
function bindEvents() {
  el('simpleChannels').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-ch]');
    if (!btn || btn.dataset.ch === state.channel) return;
    state.channel = btn.dataset.ch;
    renderChannels();
    renderPeriodSelect();
    const first = channelPeriods()[0];
    if (first) showPeriod(first.id);
  });

  el('periodSelect').addEventListener('change', (ev) => {
    showPeriod(ev.target.value);
  });

  el('shipSearch').addEventListener('input', (ev) => {
    state.shipQuery = ev.target.value;
    renderShips();
  });

  el('shipList').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.ship-item');
    if (!btn) return;
    const next = btn.dataset.ship || '';
    if (next === state.ship) return;
    state.ship = next;
    state.limit = PAGE;
    renderShips();
    renderStats();
    renderList();
    el('simpleList').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  el('simpleKind').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-kind]');
    if (!btn || btn.dataset.kind === state.kind) return;
    state.kind = btn.dataset.kind;
    state.limit = PAGE;
    syncKindButtons();
    renderList();
  });

  el('simpleSearch').addEventListener('input', (ev) => {
    state.q = ev.target.value;
    state.limit = PAGE;
    el('simpleClear').hidden = !ev.target.value;
    renderList();
  });

  el('simpleClear').addEventListener('click', () => {
    const input = el('simpleSearch');
    input.value = '';
    el('simpleClear').hidden = true;
    state.q = '';
    state.limit = PAGE;
    renderList();
    input.focus();
  });

  el('simpleList').addEventListener('click', async (ev) => {
    const group = ev.target.closest('.frow.group');
    if (group) {
      const entry = entryOf(group);
      if (entry) MK_fields.toggleGroup(group, entry, state.fieldFilter);
      return;
    }
    const head = ev.target.closest('.entry-head');
    if (!head) return;
    const box = head.closest('.entry');
    const name = box.dataset.name;
    const entry = state.period.entries.find((e) => e.n === name);
    if (!entry) return;
    if (state.expanded.has(name)) {
      state.expanded.delete(name);
      box.classList.remove('open');
      head.setAttribute('aria-expanded', 'false');
      box.querySelectorAll('.fields, .summary-row, .more-note, .fields-loading').forEach((n) => n.remove());
      return;
    }

    state.expanded.add(name);
    box.classList.add('open');
    head.setAttribute('aria-expanded', 'true');

    const needsConfig = entry.f && !state.fieldFilter && !state.fieldConfigFailed;
    if (needsConfig) {
      box.insertAdjacentHTML('beforeend', `<div class="fields-loading">${esc(t('正在载入字段清单…'))}</div>`);
      await ensureFieldConfig();
      const loading = box.querySelector('.fields-loading');
      if (loading) loading.remove();
    }
    if (!box.isConnected || !box.classList.contains('open')) return;
    box.insertAdjacentHTML('beforeend', entryBody(entry));
  });

  el('simpleList').addEventListener('keydown', (ev) => {
    const group = ev.target.closest('.frow.group');
    if (!group) return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      const entry = entryOf(group);
      if (entry) MK_fields.toggleGroup(group, entry, state.fieldFilter);
    }
  });

  el('simpleMore').addEventListener('click', (ev) => {
    if (!ev.target.closest('#simpleMoreBtn')) return;
    state.limit += PAGE;
    renderList();
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

  // 字段清单与数据并行加载：条目是否“全部差异被隐藏”要先知道清单，列表渲染前等它。
  const fieldConfigReady = ensureFieldConfig();

  try {
    const res = await fetch(BASE + 'data/index.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.index = await res.json();
  } catch (err) {
    setEmpty('无法载入数据', null,
      '读取 {path} 失败（{err}）。请用 HTTP 服务打开本页，例如在 web 目录执行 python -m http.server。',
      { path: 'data/index.json', err: err.message });
    return;
  }

  state.periods = state.index.periods || [];
  const want = currentId();
  const wanted = want ? state.periods.find((p) => p.id === want) : null;
  if (wanted) state.channel = wanted.new.channel;

  renderChannels();
  renderPeriodSelect();
  renderGenerated();
  bindEvents();

  await fieldConfigReady;

  const first = channelPeriods()[0];
  const target = wanted ? wanted.id : (first && first.id);
  if (target) showPeriod(target);
}

boot();
