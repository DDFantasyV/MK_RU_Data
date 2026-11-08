/* 历史变更页 — 逐舰回看 GameParams 参数的时间线
 *
 * 数据由 web/tools/build_history.py 生成：
 *   data/history.json           战舰目录 + 期次表 + 每舰的条目分组与参数变更事件
 *
 * 页面本身不复制任何 GameParams 数据，只读取上面的静态 JSON。
 * 整包在启动时加载一次，之后切换战舰直接读内存，不再逐舰发请求。
 * 时间线列只包含“该舰发生过变更”的期次；版本从左到右递增。
 */
'use strict';

const BASE = (document.documentElement.dataset.base || './').replace(/\/+$/, '') + '/';
const AUTO_OPEN = 30;          // 参数分组超过这么多叶子就默认收起

const t = (msgid, vars) => MK_i18n.t(msgid, vars);
const tn = (msgid, n, vars) => MK_i18n.tn(msgid, n, vars);
const num = (n) => MK_i18n.num(n);
const compact = (n) => MK_i18n.compact(n);

const NATIONS = {
  USA: '美国',
  Japan: '日本',
  Russia: '苏联',
  Germany: '德国',
  United_Kingdom: '英国',
  France: '法国',
  Italy: '意大利',
  Pan_Asia: '泛亚',
  Europe: '欧洲',
  Netherlands: '荷兰',
  Spain: '西班牙',
  Pan_America: '泛美',
  Commonwealth: '英联邦',
  Events: '活动',
};

const TYPES = {
  Battleship: '战列舰',
  Cruiser: '巡洋舰',
  Destroyer: '驱逐舰',
  AirCarrier: '航空母舰',
  Submarine: '潜艇',
  Auxiliary: '辅助舰',
  Unknown: '未知',
};

const NATION_ORDER = Object.keys(NATIONS);
const TYPE_ORDER = Object.keys(TYPES);

const el = (id) => document.getElementById(id);

const state = {
  bundle: null,
  index: null,
  ships: [],
  byId: new Map(),
  dupeCn: new Set(),
  dataStart: '25.03_1',
  ship: null,
  data: null,
  cache: new Map(),
  seq: 0,
  loading: false,
  loadError: null,
  errorPath: '',
  fieldFilter: null,
  fieldConfigFailed: false,
  fieldConfigPromise: null,
  view: null,
  viewSrc: null,
  viewFilter: null,
  shipQuery: '',
  nation: '',
  type: '',
  paramQuery: '',
  closedEntries: new Set(),
  collapsedGroups: new Set(),
  expandedGroups: new Set(),
  forceOpen: false,
  forceClose: false,
  nodeMap: new Map(),
};

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
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = String(v);
  return s === '' ? '""' : s;
}

function zhMode() {
  return MK_i18n.locale() === MK_i18n.DEFAULT_CODE;
}

function displayShip(ship) {
  return ship ? (zhMode() ? ship.cn : ship.id) : '';
}

function displayEntry(entry) {
  return zhMode() ? (entry.cn || entry.name) : entry.name;
}

function nationLabel(value) {
  return NATIONS[value] ? t(NATIONS[value]) : (value || '—');
}

function typeLabel(value) {
  return TYPES[value] ? t(TYPES[value]) : (value || '—');
}

function channelClass(channel) {
  return channel === 'PT' ? 'pt' : 'live';
}

function parseHash() {
  let raw = '';
  try { raw = decodeURIComponent(location.hash.replace(/^#\/?/, '').trim()); } catch (err) { raw = ''; }
  return raw;
}

function setHash(id) {
  const next = '#/' + encodeURIComponent(id);
  if (location.hash !== next) history.replaceState(null, '', next);
}

function fetchJSON(url) {
  return fetch(url, { cache: 'no-cache' }).then((res) => {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  });
}

/* ------------------------------------------------------------- field filter */
/* 与「版本变更」共用 simple/field-tree.conf：历史数据在构建时已按同一份清单
 * 过滤过一次，这里再在运行时应用一次，这样改完清单刷新页面就能同时影响两页，
 * 不必先重新生成 data/history.json。 */
function ensureFieldConfig() {
  if (state.fieldConfigPromise) return state.fieldConfigPromise;
  state.fieldConfigPromise = MK_simpleFields.load(BASE + 'simple/field-tree.conf').then((result) => {
    state.fieldFilter = result.filter;
    if (result.error) {
      console.warn('[history] 无法载入 field-tree.conf，历史参数将全部显示：' + result.error.message);
      state.fieldConfigFailed = true;
    }
    return state.fieldFilter;
  });
  return state.fieldConfigPromise;
}

/**
 * 按 field-tree.conf 过滤一艘船的历史：
 *   - 隐藏所有路径都不可见的参数行；
 *   - 隐藏因此没有可见参数行的条目；
 *   - 重新计算版本列（只保留仍有可见事件/标记的版本）并重排事件下标；
 *   - 重算统计，保证顶部计数与表格一致。
 * 返回新对象，不修改缓存里的原始 payload。
 */
function filteredView(data) {
  if (!data || !state.fieldFilter) return data;
  const filter = state.fieldFilter;
  const segs = MK_simpleFields.pathSegments;
  const used = new Set();

  for (const entry of data.entries) {
    const rows = entry.rows.filter(([path]) => filter(segs(path)));
    if (!rows.length) continue;
    if (entry.added !== null && entry.added !== undefined) used.add(entry.added);
    if (entry.removed !== null && entry.removed !== undefined) used.add(entry.removed);
    for (const [, events] of rows) {
      for (const ev of events) used.add(ev[0]);
    }
  }

  const versions = [];
  const oldToNew = new Map();
  data.versions.forEach((col, index) => {
    if (used.has(index)) {
      oldToNew.set(index, versions.length);
      versions.push(col);
    }
  });

  const entries = [];
  let params = 0;
  let events = 0;
  for (const entry of data.entries) {
    const rows = [];
    for (const [path, rowEvents] of entry.rows) {
      if (!filter(segs(path))) continue;
      const mapped = [];
      for (const ev of rowEvents) {
        const next = oldToNew.get(ev[0]);
        if (next === undefined) continue;
        mapped.push([next, ev[1], ev[2], ev[3]]);
      }
      if (!mapped.length) continue;
      rows.push([path, mapped]);
      params += 1;
      events += mapped.length;
    }
    if (!rows.length) continue;
    let added = (entry.added !== null && entry.added !== undefined)
      ? oldToNew.get(entry.added) : null;
    let removed = (entry.removed !== null && entry.removed !== undefined)
      ? oldToNew.get(entry.removed) : null;
    if (added === undefined) added = null;
    if (removed === undefined) removed = null;
    if (added !== null) events += 1;
    if (removed !== null) events += 1;
    entries.push(Object.assign({}, entry, { rows, added, removed }));
  }

  return Object.assign({}, data, {
    versions,
    entries,
    stats: { params, entries: entries.length, events, versions: versions.length },
  });
}

/** 带缓存的当前视图：配置或原始数据变化时才重新过滤。 */
function viewData() {
  if (!state.data) return null;
  if (state.viewSrc === state.data && state.viewFilter === state.fieldFilter) {
    return state.view;
  }
  state.view = filteredView(state.data);
  state.viewSrc = state.data;
  state.viewFilter = state.fieldFilter;
  return state.view;
}

/* ------------------------------------------------------------- path tree */
/** Same segmentation as assets/fields.js: `A_Hull.HP_1[0]` → [A_Hull, HP_1, [0]]. */
function pathSegments(path) {
  const out = [];
  for (const part of String(path).split('.')) {
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

function buildTree(rows) {
  const root = { key: '', full: '', children: new Map(), childList: [], leaf: null, leaves: 0 };
  for (const [path, events] of rows) {
    const segs = pathSegments(path);
    let node = root;
    for (const seg of segs) {
      let child = node.children.get(seg);
      if (!child) {
        const full = seg.charAt(0) === '[' ? node.full + seg
          : (node.full ? node.full + '.' + seg : seg);
        child = { key: seg, full, children: new Map(), childList: [], leaf: null, leaves: 0 };
        node.children.set(seg, child);
        node.childList.push(child);
      }
      node = child;
    }
    node.leaf = { path, events };
  }
  const count = (node) => {
    let n = node.leaf ? 1 : 0;
    for (const child of node.childList) n += count(child);
    node.leaves = n;
    return n;
  };
  count(root);
  const sort = (node) => {
    node.childList.sort((a, b) => segCompare(a.key, b.key));
    for (const child of node.childList) sort(child);
  };
  sort(root);
  return root;
}

/* ------------------------------------------------------------- labels */
function versionSubLabel(col, group) {
  if (col.channel === 'PT') {
    const patch = col.patch || 1;
    return group.length > 1 ? ('PT ' + patch) : 'PT';
  }
  return 'Live';
}

function introText(ship) {
  const intro = ship.intro || {};
  if (intro.known) {
    return t('{label}（{channel}）', {
      label: intro.label,
      channel: intro.channel === 'PT' ? 'PT' : 'Live',
    });
  }
  return t('早于 {label}', { label: state.dataStart });
}

/* ------------------------------------------------------------- sidebar */
function renderFilters() {
  const nations = [...new Set(state.ships.map((s) => s.nation).filter(Boolean))];
  nations.sort((a, b) => {
    const ia = NATION_ORDER.indexOf(a);
    const ib = NATION_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const types = [...new Set(state.ships.map((s) => s.type).filter(Boolean))];
  types.sort((a, b) => {
    const ia = TYPE_ORDER.indexOf(a);
    const ib = TYPE_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

  const nation = el('nationFilter');
  nation.innerHTML = `<option value="">${esc(t('全部国家'))}</option>` +
    nations.map((value) => `<option value="${esc(value)}">${esc(nationLabel(value))}</option>`).join('');
  nation.value = state.nation;

  const type = el('typeFilter');
  type.innerHTML = `<option value="">${esc(t('全部舰种'))}</option>` +
    types.map((value) => `<option value="${esc(value)}">${esc(typeLabel(value))}</option>`).join('');
  type.value = state.type;
}

function filteredShips() {
  const q = state.shipQuery.trim().toLowerCase();
  return state.ships.filter((ship) => {
    if (state.nation && ship.nation !== state.nation) return false;
    if (state.type && ship.type !== state.type) return false;
    if (!q) return true;
    return (ship.id + ' ' + (ship.cn || '') + ' ' + (ship.index || ''))
      .toLowerCase().includes(q);
  });
}

function shipItemHtml(ship) {
  const active = state.ship && state.ship.id === ship.id;
  const removed = ship.removed && ship.removed.label;
  const count = ship.has
    ? `<span class="ship-count" title="${esc(t('生成时的参数总数；表格按 field-tree.conf 实时过滤'))}">${esc(tn('{n} 项', ship.params, { n: compact(ship.params) }))}</span>`
    : `<span class="ship-count">—</span>`;
  const intro = ship.intro && ship.intro.known
    ? `<span class="ship-intro">${esc(ship.intro.label)}</span>`
    : '';
  const title = [ship.id, ship.intro && ship.intro.known
    ? t('加入 {label}', { label: ship.intro.label }) : '']
    .filter(Boolean).join(' · ');
  const keyLine = zhMode() && state.dupeCn.has(ship.cn)
    ? `<span class="ship-key">${esc(ship.id)}</span>` : '';
  return `<button class="ship-item history-ship${active ? ' on' : ''}${ship.has ? ' has-history' : ''}${removed ? ' is-removed' : ''}"
      type="button" data-ship="${esc(ship.id)}" title="${esc(title)}">
    <span class="ship-main">
      <span class="ship-name">${esc(displayShip(ship))}</span>
      ${keyLine}
      <span class="ship-meta">
        ${ship.tier ? `<span class="tier">${esc(ship.tier)}</span>` : ''}
        <span>${esc(typeLabel(ship.type))}</span>
        ${removed ? `<span>· ${esc(t('已移除'))}</span>` : ''}
        ${intro}
      </span>
    </span>
    ${count}
  </button>`;
}

function renderShips(keepScroll) {
  const list = el('shipList');
  const scrollTop = list.scrollTop;
  if (!state.ships.length) {
    list.innerHTML = `<div class="ship-empty">${esc(t('暂无数据'))}</div>`;
    return;
  }
  const visible = filteredShips();
  el('shipCount').textContent = tn('{n} 艘', visible.length, { n: num(visible.length) });

  const groups = new Map();
  for (const ship of visible) {
    const key = ship.nation || 'Unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ship);
  }
  const parts = [];
  for (const [nation, ships] of groups) {
    parts.push(`<div class="ship-group"><span>${esc(nationLabel(nation))}</span><b>${num(ships.length)}</b></div>`);
    for (const ship of ships) parts.push(shipItemHtml(ship));
  }
  if (!visible.length) {
    parts.push(`<div class="ship-empty">${esc(t('没有匹配的战舰'))}</div>`);
  }
  list.innerHTML = parts.join('');
  if (keepScroll) {
    list.scrollTop = scrollTop;
    const active = list.querySelector('.history-ship.on');
    if (active) {
      const listBox = list.getBoundingClientRect();
      const box = active.getBoundingClientRect();
      if (box.top < listBox.top) list.scrollTop += box.top - listBox.top - 8;
      else if (box.bottom > listBox.bottom) list.scrollTop += box.bottom - listBox.bottom + 8;
    }
  }
}

/* ------------------------------------------------------------- hero */
function renderHero() {
  const ship = state.ship;
  if (!ship) return;
  const data = viewData();
  const versions = data ? data.stats.versions : ship.versions;
  const hasVisible = data ? data.entries.length > 0 : ship.has;
  el('historyKicker').textContent = t('历史变更') + (versions
    ? ' · ' + tn('{n} 个版本', versions, { n: num(versions) })
    : '');

  el('historyTitle').innerHTML =
    `<span class="new">${esc(displayShip(ship))}</span>` +
    `<span class="hist-key">${esc(ship.id)}</span>`;

  const badges = [];
  if (ship.tier) {
    badges.push(`<span class="hist-badge tier"><span class="b-k">${esc(t('等级'))}</span>${num(ship.tier)}</span>`);
  }
  badges.push(`<span class="hist-badge"><span class="b-k">${esc(t('舰种'))}</span>${esc(typeLabel(ship.type))}</span>`);
  badges.push(`<span class="hist-badge"><span class="b-k">${esc(t('国家'))}</span>${esc(nationLabel(ship.nation))}</span>`);
  if (ship.intro && ship.intro.known) {
    badges.push(`<span class="hist-badge intro"><span class="b-k">${esc(t('加入'))}</span>${esc(introText(ship))}</span>`);
  } else {
    badges.push(`<span class="hist-badge pre"><span class="b-k">${esc(t('数据起点'))}</span>${esc(state.dataStart)}</span>`);
  }
  if (ship.removed && ship.removed.label) {
    badges.push(`<span class="hist-badge removed"><span class="b-k">${esc(t('移除'))}</span>${esc(ship.removed.label)}</span>`);
  }
  el('historyBadges').innerHTML = badges.join('');

  let sub = '';
  if (ship.intro && ship.intro.known) {
    sub = t('该舰于 {label}加入；加入时的初始参数不计入变更。', { label: introText(ship) });
    if (hasVisible) sub += ' ' + t('下表列出加入后发生变更的参数。');
    else if (ship.has) sub += ' ' + t('当前字段清单隐藏了该舰的全部参数。');
  } else {
    if (hasVisible) {
      sub = t('该舰在数据起点 {label} 之前已加入；下表列出 {label} 起的参数变更。', { label: state.dataStart });
    } else if (ship.has) {
      sub = t('该舰在数据起点 {label} 之前已加入。', { label: state.dataStart }) + ' '
        + t('当前字段清单隐藏了该舰的全部参数。');
    } else {
      sub = t('该舰在数据起点 {label} 之前已加入。', { label: state.dataStart });
    }
  }
  if (ship.removed && ship.removed.label) {
    sub += ' ' + t('该舰于 {label}移除。', { label: ship.removed.label });
  }
  el('historySub').textContent = sub;
}

function renderStats() {
  const box = el('historyStats');
  const data = viewData();
  if (!data || !data.entries.length) { box.innerHTML = ''; return; }
  const s = data.stats;
  box.innerHTML = `
    <div class="schip f"><span class="k">${esc(t('变更版本'))}</span><b>${num(s.versions)}</b></div>
    <div class="schip m"><span class="k">${esc(t('变更参数'))}</span><b>${compact(s.params)}</b></div>
    <div class="schip a"><span class="k">${esc(t('涉及条目'))}</span><b>${num(s.entries)}</b></div>
    <div class="schip"><span class="k">${esc(t('变更次数'))}</span><b>${compact(s.events)}</b></div>`;
}

function renderNote() {
  if (!state.data) { el('historyNote').innerHTML = ''; return; }
  el('historyNote').innerHTML =
    `<span>${esc(t('仅列出有变更的版本；参数按条目分组，版本从左到右递增。'))}</span>` +
    (state.fieldConfigFailed ? '' : `<span class="hn-chip">${esc(t('字段范围：simple/field-tree.conf'))}</span>`) +
    `<span class="hn-legend">` +
      `<span class="hn-chip chg">${esc(t('旧值'))} → ${esc(t('新值'))}</span>` +
      `<span class="hn-chip add">+ ${esc(t('参数新增'))}</span>` +
      `<span class="hn-chip del">− ${esc(t('参数移除'))}</span>` +
    `</span>`;
}

function renderGenerated() {
  const raw = state.index && state.index.generated;
  el('generatedAt').textContent = t('数据生成于 {time}', {
    time: raw ? MK_i18n.dateTime(raw) : '—',
  });
}

/* ------------------------------------------------------------- empty / loading */
function showEmpty(html) {
  el('historyEmpty').hidden = false;
  el('historyEmpty').innerHTML = html;
  el('historyToolbar').hidden = true;
  el('historyScroll').hidden = true;
  el('historyScrollbar').hidden = true;
  el('historyNote').innerHTML = '';
  el('historyTable').innerHTML = '';
}

function hideEmpty() {
  el('historyEmpty').hidden = true;
}

function showLoading() {
  showEmpty(`<h2>${esc(t('正在载入…'))}</h2><p>${esc(t('正在读取该舰的历史变更数据。'))}</p>`);
}

function showNoHistory(ship) {
  let title = t('暂无记录到的变更');
  let body = t('该舰在数据起点 {label} 之前已加入；{label} 起没有记录到参数变更。', {
    label: state.dataStart,
  });
  if (ship.intro && ship.intro.known) {
    title = t('该舰加入后暂无变更');
    body = t('该舰于 {label}加入；加入时的初始参数不计入变更。', { label: introText(ship) });
  }
  if (ship.removed && ship.removed.label) {
    title = t('该舰已移除');
    body = t('该舰于 {label}移除，未记录到参数变更。', { label: ship.removed.label });
  }
  showEmpty(`<h2>${esc(title)}</h2><p>${esc(body)}</p>`);
}

function showError(path, err) {
  showEmpty(`<h2>${esc(t('载入失败'))}</h2>` +
    `<p>${esc(t('无法读取 {path}（{err}）。请通过本地 HTTP 服务访问。', {
      path, err: err.message,
    }))}</p>`);
}

/* ------------------------------------------------------------- table */
function renderHead(data) {
  const cols = data.versions || [];
  const groups = [];
  for (const col of cols) {
    const last = groups[groups.length - 1];
    if (last && last.version === col.version) last.cols.push(col);
    else groups.push({ version: col.version, cols: [col] });
  }
  let colCursor = 2;
  let groupHtml = '';
  let subHtml = '';
  for (const group of groups) {
    const channels = new Set(group.cols.map((c) => c.channel));
    const cls = channels.size > 1 ? 'mixed' : channelClass(group.cols[0].channel);
    groupHtml += `<div class="hist-vgroup ${cls}" style="grid-column:${colCursor} / span ${group.cols.length};grid-row:1"
      title="${esc(group.cols.map((c) => c.label).join(' · '))}">${esc(group.version)}${
        group.cols.length > 1 ? `<span class="vg-n">×${group.cols.length}</span>` : ''}</div>`;
    for (const col of group.cols) {
      subHtml += `<div class="hist-vsub ${channelClass(col.channel)}"
        style="grid-column:${colCursor};grid-row:2"
        title="${esc(col.label)}">${esc(versionSubLabel(col, group.cols))}</div>`;
      colCursor += 1;
    }
  }
  return `<div class="hist-head">
    <div class="hist-corner" style="grid-column:1;grid-row:1 / span 2">
      <span>${esc(t('参数'))}</span><span class="hist-axis">${esc(t('版本 →'))}</span>
    </div>
    ${groupHtml}${subHtml}
  </div>`;
}

function numericDelta(oldV, newV) {
  if (typeof oldV !== 'number' || typeof newV !== 'number') return 0;
  const d = Number((newV - oldV).toPrecision(10));
  return d === 0 ? 0 : d;
}

function eventHtml(event, col, data) {
  const [v, kind, oldV, newV] = event;
  const period = data.versions[v] || {};
  const label = period.label || '';
  const oldText = fmtVal(oldV);
  const newText = fmtVal(newV);
  if (kind === 'add') {
    return `<span class="hist-ev add" title="${esc(label + ' · ' + t('参数新增') + ' ' + newText)}">
      <span class="hv new">+ ${esc(newText)}</span></span>`;
  }
  if (kind === 'del') {
    return `<span class="hist-ev del" title="${esc(label + ' · ' + t('参数移除') + ' ' + oldText)}">
      <span class="hv old">− ${esc(oldText)}</span></span>`;
  }
  const delta = numericDelta(oldV, newV);
  const deltaHtml = delta
    ? `<span class="hdelta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${esc(fmtNum(delta))}</span>`
    : '';
  return `<span class="hist-ev" title="${esc(label + ' · ' + oldText + ' → ' + newText)}">
    <span class="hv old">${esc(oldText)}</span>
    <span class="harr">→</span>
    <span class="hv new">${esc(newText)}</span>
    ${deltaHtml}
  </span>`;
}

function cellsHtml(events, data) {
  const byVersion = new Map();
  for (const event of events) {
    let list = byVersion.get(event[0]);
    if (!list) byVersion.set(event[0], (list = []));
    list.push(event);
  }
  let html = '';
  const n = data.versions.length;
  for (let v = 0; v < n; v++) {
    const list = byVersion.get(v);
    if (!list) {
      html += '<div class="hist-cell"></div>';
      continue;
    }
    html += `<div class="hist-cell has-ev">${list.map((event) => eventHtml(event, v, data)).join('')}</div>`;
  }
  return html;
}

function leafHtml(leaf, node, depth, data) {
  return `<div class="hist-row" data-path="${esc(node.full)}">
    <div class="hist-param" style="--d:${depth}" title="${esc(node.full)}">
      <span class="hp-key">${esc(node.key)}</span>
    </div>
    ${cellsHtml(leaf.events, data)}
  </div>`;
}

function groupOpen(node, gkey, query) {
  if (query) return true;
  if (state.expandedGroups.has(gkey)) return true;
  if (state.forceClose || state.collapsedGroups.has(gkey)) return false;
  if (state.forceOpen) return true;
  return node.leaves <= AUTO_OPEN;
}

function renderChildren(node, depth, ctx) {
  let html = '';
  if (node.leaf) html += leafHtml(node.leaf, node, depth, ctx.data);
  for (const child of node.childList) html += nodeHtml(child, depth, ctx);
  return html;
}

function nodeHtml(node, depth, ctx) {
  if (!node.childList.length) {
    return node.leaf ? leafHtml(node.leaf, node, depth, ctx.data) : '';
  }
  const gkey = ctx.entryName + '\u0001' + node.full;
  const open = groupOpen(node, gkey, ctx.query);
  state.nodeMap.set(gkey, { node, depth, ctx });
  const inner = open ? renderChildren(node, depth + 1, ctx) : '';
  return `<div class="hist-group${open ? ' open' : ''}" data-gkey="${esc(gkey)}"
      style="--d:${depth}" role="button" tabindex="0" aria-expanded="${open ? 'true' : 'false'}"
      title="${esc(node.full)}">
    <span class="hg-inner">
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>
      <span class="hg-key">${esc(node.key)}</span>
      <span class="hg-count">${esc(tn('{n} 项', node.leaves, { n: compact(node.leaves) }))}</span>
    </span>
  </div>
  <div class="hist-group-body"${open ? '' : ' hidden'}${open ? ' data-loaded="1"' : ''}>${inner}</div>`;
}

function renderEntry(entry, rows, data, query) {
  const open = query ? true : !state.closedEntries.has(entry.name);
  const versionLabel = (v) => (v === null || v === undefined || !data.versions[v])
    ? '' : data.versions[v].label;
  const badges = [];
  if (entry.added !== null && entry.added !== undefined) {
    badges.push(`<span class="he-badge add">${esc(t('新增于 {label}', { label: versionLabel(entry.added) }))}</span>`);
  }
  if (entry.removed !== null && entry.removed !== undefined) {
    badges.push(`<span class="he-badge del">${esc(t('移除于 {label}', { label: versionLabel(entry.removed) }))}</span>`);
  }
  const name = entry.type === 'Ship' ? t('战舰本体') : displayEntry(entry);
  const key = entry.type === 'Ship' || !zhMode() || displayEntry(entry) === entry.name
    ? '' : `<span class="he-key">${esc(entry.name)}</span>`;

  let body = '';
  if (open) {
    if (rows.length) {
      const tree = buildTree(rows);
      const ctx = { entryName: entry.name, data, query };
      body = `<div class="hist-entry-body">${renderChildren(tree, 0, ctx)}</div>`;
    } else {
      let note;
      if (entry.type === 'Ship') {
        if (entry.removed !== null && entry.removed !== undefined) {
          note = t('该舰移除时没有记录到参数变化。');
        } else if (entry.added !== null && entry.added !== undefined) {
          note = t('该舰加入时的初始参数不计入变更。');
        } else {
          note = t('该舰没有记录到参数变化。');
        }
      } else {
        note = entry.added !== null && entry.added !== undefined
          ? t('该配件新增后尚无参数变更。')
          : t('该配件没有记录到参数变更。');
      }
      body = `<div class="hist-entry-note">${esc(note)}</div>`;
    }
  }
  const count = rows.length
    ? `<span class="he-count">${esc(tn('{n} 项参数', rows.length, { n: compact(rows.length) }))}</span>`
    : '';

  return `<section class="hist-entry${open ? ' open' : ''}" data-entry="${esc(entry.name)}">
    <button class="hist-entry-head" type="button" aria-expanded="${open ? 'true' : 'false'}">
      <span class="he-inner">
        <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>
        <span class="he-name">
          <b>${esc(name)}</b>
          ${key}
          ${entry.type === 'Ship' ? '' : `<span class="he-type">${esc(entry.type)}</span>`}
        </span>
        <span class="he-badges">${badges.join('')}</span>
        ${count}
      </span>
    </button>
    ${body}
  </section>`;
}

/** 顶部的横向滚动条：让很宽的时间线在表格顶部也能左右拖动。 */
function syncScrollbar() {
  const scroll = el('historyScroll');
  const bar = el('historyScrollbar');
  const inner = el('historyScrollbarInner');
  if (!scroll || !bar || !inner) return;
  const overflow = !scroll.hidden && scroll.scrollWidth > scroll.clientWidth + 1;
  bar.hidden = !overflow;
  if (!overflow) return;
  inner.style.width = scroll.scrollWidth + 'px';
  bar.scrollLeft = scroll.scrollLeft;
}

function renderTable() {
  const data = viewData();
  if (!data) return;
  el('historyToolbar').hidden = false;
  const query = state.paramQuery.trim().toLowerCase();
  const table = el('historyTable');
  const n = data.versions.length;
  const grid = n
    ? `minmax(var(--hist-param-w, 240px), 1.7fr) repeat(${n}, minmax(var(--hist-col-w, 132px), 1fr))`
    : 'minmax(var(--hist-param-w, 240px), 1.7fr)';
  table.style.setProperty('--hist-grid', grid);
  table.style.setProperty('--hist-cols', String(n));
  state.nodeMap.clear();

  // 字段清单把该舰的所有参数都隐藏了：不再显示空表头。
  if (!data.entries.length) {
    el('historyScroll').hidden = false;
    table.innerHTML = `<div class="history-no-match">${esc(t('当前字段清单隐藏了该舰的全部参数。'))}</div>`;
    el('historyScrollbar').hidden = true;
    el('historyScroll').scrollLeft = 0;
    state.scrollLeft = 0;
    return;
  }

  const entries = [];
  for (const entry of data.entries) {
    const entryMatch = !query ||
      (entry.name + ' ' + (entry.cn || '') + ' ' + entry.type).toLowerCase().includes(query);
    const rows = entryMatch ? entry.rows
      : entry.rows.filter(([path]) => path.toLowerCase().includes(query));
    const hasMarker = (entry.added !== null && entry.added !== undefined)
      || (entry.removed !== null && entry.removed !== undefined);
    if (!rows.length && !entryMatch && query) continue;
    if (!rows.length && !hasMarker) continue;
    entries.push(renderEntry(entry, rows, data, query));
  }

  if (!entries.length) {
    const scroll = el('historyScroll');
    scroll.hidden = false;
    table.innerHTML = renderHead(data) +
      `<div class="history-no-match">${esc(t('没有匹配的参数'))}</div>`;
    scroll.scrollLeft = state.scrollLeft || 0;
    requestAnimationFrame(syncScrollbar);
    return;
  }

  el('historyScroll').hidden = false;
  table.innerHTML = renderHead(data) + entries.join('');
  el('historyScroll').scrollLeft = state.scrollLeft || 0;
  requestAnimationFrame(syncScrollbar);
}

/* ------------------------------------------------------------- loading */
async function loadShip(ship) {
  const ticket = ++state.seq;
  state.loading = true;
  state.loadError = null;
  state.errorPath = '';
  state.data = null;
  state.view = null;
  state.viewSrc = null;
  state.viewFilter = null;
  state.nodeMap.clear();
  hideEmpty();
  renderHero();
  renderStats();
  renderNote();
  el('historyScroll').hidden = true;
  el('historyTable').innerHTML = '';

  if (!state.fieldFilter && !state.fieldConfigFailed) {
    await ensureFieldConfig();
    if (ticket !== state.seq) return;
  }

  if (!ship.has) {
    state.loading = false;
    showNoHistory(ship);
    return;
  }

  showLoading();
  try {
    let data = state.cache.get(ship.id);
    if (!data) {
      // 单文件打包：时间线已随 history.json 一次载入，这里只查表。
      data = state.bundle && state.bundle.data ? state.bundle.data[ship.id] : null;
      if (!data) throw new Error('data/history.json 中没有该舰的记录：' + ship.id);
      state.cache.set(ship.id, data);
    }
    if (ticket !== state.seq || !state.ship || state.ship.id !== ship.id) return;
    state.data = data;
    state.view = null;
    state.viewSrc = null;
    state.viewFilter = null;
    hideEmpty();
    renderHero();
    renderStats();
    renderNote();
    renderTable();
    state.loading = false;
  } catch (err) {
    if (ticket !== state.seq) return;
    state.loading = false;
    state.loadError = err;
    state.errorPath = 'data/history.json';
    showError(state.errorPath, err);
  }
}

function selectShip(id) {
  if (!state.ships.length) return;
  let ship = state.byId.get(id);
  if (!ship) ship = state.ships.find((s) => s.has) || state.ships[0];
  if (state.ship && ship.id === state.ship.id && state.data) return;
  state.ship = ship;
  state.paramQuery = '';
  el('paramSearch').value = '';
  el('paramClear').hidden = true;
  state.closedEntries = new Set();
  state.collapsedGroups = new Set();
  state.expandedGroups = new Set();
  state.forceOpen = false;
  state.forceClose = false;
  state.scrollLeft = 0;
  el('historyScroll').scrollLeft = 0;
  el('historyScrollbar').scrollLeft = 0;
  el('historyScrollbar').hidden = true;
  setHash(ship.id);
  renderShips(true);
  renderHero();
  loadShip(ship);
  window.scrollTo({ top: 0, behavior: 'auto' });
  document.title = displayShip(ship) + ' · ' + t('历史变更') + ' — ' + t('Мир кораблей 数据变更');
}

/* ------------------------------------------------------------- locale */
function onLocaleChange() {
  renderFilters();
  renderShips(true);
  renderHero();
  renderStats();
  renderNote();
  renderGenerated();
  if (state.data) {
    renderTable();
  } else if (state.loadError) {
    showError(state.errorPath, state.loadError);
  } else if (state.loading) {
    showLoading();
  } else if (state.ship) {
    showNoHistory(state.ship);
  }
  if (state.ship) {
    document.title = displayShip(state.ship) + ' · ' + t('历史变更') + ' — ' + t('Мир кораблей 数据变更');
  }
}

/* ------------------------------------------------------------- events */
let shipSearchTimer = 0;

function toggleEntry(box) {
  const name = box.dataset.entry;
  const head = box.querySelector('.hist-entry-head');
  const body = box.querySelector('.hist-entry-body, .hist-entry-note');
  if (state.closedEntries.has(name)) {
    state.closedEntries.delete(name);
    state.forceClose = false;      // 收起全部之后重新打开条目，恢复分组默认展开
    box.classList.add('open');
    head.setAttribute('aria-expanded', 'true');
    if (!body && state.data) {
      /* body was not rendered: force a rebuild of just this entry */
      renderTable();
      return;
    }
    if (body) body.hidden = false;
  } else {
    state.closedEntries.add(name);
    box.classList.remove('open');
    head.setAttribute('aria-expanded', 'false');
    if (body) body.hidden = true;
  }
}

function toggleGroup(row) {
  const gkey = row.dataset.gkey;
  const rec = state.nodeMap.get(gkey);
  if (!rec) return;
  const body = row.nextElementSibling;
  const open = !row.classList.contains('open');
  if (open) {
    if (body && !body.dataset.loaded) {
      body.innerHTML = renderChildren(rec.node, rec.depth + 1, rec.ctx);
      body.dataset.loaded = '1';
    }
    if (body) body.hidden = false;
    row.classList.add('open');
    row.setAttribute('aria-expanded', 'true');
    state.expandedGroups.add(gkey);
    state.collapsedGroups.delete(gkey);
  } else {
    if (body) body.hidden = true;
    row.classList.remove('open');
    row.setAttribute('aria-expanded', 'false');
    state.collapsedGroups.add(gkey);
    state.expandedGroups.delete(gkey);
  }
}

function bindEvents() {
  el('shipSearch').addEventListener('input', (ev) => {
    const value = ev.target.value;
    clearTimeout(shipSearchTimer);
    shipSearchTimer = setTimeout(() => {
      state.shipQuery = value;
      renderShips();
    }, 120);
  });

  el('nationFilter').addEventListener('change', (ev) => {
    state.nation = ev.target.value;
    renderShips();
  });

  el('typeFilter').addEventListener('change', (ev) => {
    state.type = ev.target.value;
    renderShips();
  });

  el('shipList').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.history-ship');
    if (!btn) return;
    selectShip(btn.dataset.ship);
  });

  el('paramSearch').addEventListener('input', (ev) => {
    state.paramQuery = ev.target.value;
    el('paramClear').hidden = !ev.target.value;
    renderTable();
  });

  el('paramClear').addEventListener('click', () => {
    const input = el('paramSearch');
    input.value = '';
    el('paramClear').hidden = true;
    state.paramQuery = '';
    renderTable();
    input.focus();
  });

  el('expandAll').addEventListener('click', () => {
    state.forceOpen = true;
    state.forceClose = false;
    state.collapsedGroups = new Set();
    state.expandedGroups = new Set();
    state.closedEntries = new Set();
    renderTable();
  });

  el('collapseAll').addEventListener('click', () => {
    state.forceOpen = false;
    state.forceClose = true;
    state.collapsedGroups = new Set();
    state.expandedGroups = new Set();
    state.closedEntries = new Set((state.data ? state.data.entries : []).map((e) => e.name));
    renderTable();
  });

  el('historyTable').addEventListener('click', (ev) => {
    const group = ev.target.closest('.hist-group');
    if (group) { toggleGroup(group); return; }
    const head = ev.target.closest('.hist-entry-head');
    if (!head) return;
    const box = head.closest('.hist-entry');
    if (box) toggleEntry(box);
  });

  el('historyTable').addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const group = ev.target.closest('.hist-group');
    if (group) {
      ev.preventDefault();
      toggleGroup(group);
    }
  });

  el('historyScroll').addEventListener('scroll', () => {
    /* 参数列用 position: sticky 固定，这里只记录横向位置，防止重绘后跳回最左。 */
    state.scrollLeft = el('historyScroll').scrollLeft;
    const bar = el('historyScrollbar');
    if (!bar.hidden && bar.scrollLeft !== state.scrollLeft) bar.scrollLeft = state.scrollLeft;
  }, { passive: true });

  el('historyScrollbar').addEventListener('scroll', () => {
    const scroll = el('historyScroll');
    if (scroll.scrollLeft !== el('historyScrollbar').scrollLeft) {
      scroll.scrollLeft = el('historyScrollbar').scrollLeft;
    }
  }, { passive: true });

  window.addEventListener('resize', () => { requestAnimationFrame(syncScrollbar); });

  window.addEventListener('hashchange', () => {
    const id = parseHash();
    if (id && (!state.ship || state.ship.id !== id)) selectShip(id);
  });
}

/* ------------------------------------------------------------- boot */
async function boot() {
  await MK_i18n.init();
  MK_chrome.mount();
  document.addEventListener('mk:localechange', onLocaleChange);
  renderGenerated();
  bindEvents();

  // 字段清单与数据并行加载；列表渲染前要拿到清单，第一次打开就应用同一份过滤。
  const fieldConfigReady = ensureFieldConfig();

  try {
    state.bundle = await fetchJSON(BASE + 'data/history.json');
    state.index = state.bundle;
  } catch (err) {
    el('shipList').innerHTML = '';
    el('shipCount').textContent = '';
    showEmpty(`<h2>${esc(t('无法载入数据'))}</h2>` +
      `<p>${esc(t('读取 {path} 失败（{err}）。请用 HTTP 服务打开本页。', {
        path: 'data/history.json', err: err.message,
      }))}</p>`);
    return;
  }

  await fieldConfigReady;

  state.ships = state.index.ships || [];
  state.byId = new Map(state.ships.map((ship) => [ship.id, ship]));
  const cnCount = new Map();
  for (const ship of state.ships) {
    cnCount.set(ship.cn, (cnCount.get(ship.cn) || 0) + 1);
  }
  state.dupeCn = new Set([...cnCount].filter(([, n]) => n > 1).map(([cn]) => cn));
  state.dataStart = (state.index.versions && state.index.versions[0] && state.index.versions[0].label)
    || '25.03_1';

  renderFilters();
  renderShips();
  renderGenerated();

  const wanted = parseHash();
  selectShip(wanted || (state.ships.find((s) => s.has) || {}).id);
}

boot();
