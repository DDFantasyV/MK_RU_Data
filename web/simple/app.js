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

/* ---------------------------------------------------------------------------
 * 未归属配件的按名归舰
 *
 * 构建数据时只有“唯一引用到一艘战舰”的条目才有 p；被多艘舰共用、或引用
 * 链里找不到唯一舰的配件会落到“未归属配件”。有些全局配件（Ability /
 * Modernization）本身没有归属，但字段路径的第一段就是舰船键，例如：
 *
 *   USSR_CA_MOONSUND.reloadTime      -> PRSC540_Moonsund_1965
 *   IT_CA_ISONZO.workTime           -> PISC509_Isonzo
 *   UK_DD_WATERLOO.numConsumables   -> PBSD511_Waterloo
 *   Hakusan_BB.numConsumables       -> PJSB569_Hakusan
 *
 * 这里只拿这类字段键去和本期变更的 Ship 名字匹配；条目名本身不参与，
 * 所以匹配不到具体舰的条目仍留在“未归属配件”。
 * ------------------------------------------------------------------------- */

/* 不作为“舰名实词”的通用词：舰种、国家/等级代号、活动/涂装修饰、连接词等。 */
const NAME_STOP = new Set([
  'black', 'white', 'colorful', 'azur', 'arp', 'hsf', 'smf', 'tst',
  'stock', 'test', 'subtest', 'bot', 'event', 'space', 'premium', 'gold',
  'supertest', 'challenge', 'ranked', 'bumblebee', 'camo', 'mut', 'legacy',
  'special', 'sanzang', 'arpeggio', 'hound', 'duck', 'boss', 'ny', 'new', 'year',
  'battleship', 'cruiser', 'destroyer', 'sub', 'type', 'class', 'top',
  'one', 'two', 'three', 'four', 'five', 'of', 'the', 'and', 'for', 'in',
  'on', 'a', 'an', 'le', 'la', 'les', 'des', 'du', 'de', 'von', 'van',
  'der', 'die', 'das', 'el', 'los', 'las', 'san', 'saint', 'st', 'ste',
  'admiral', 'duke', 'duca', 'general', 'marshal', 'pr',
  /* 字段路径里的通用键名 */
  'ships', 'excludes', 'modifiers', 'default', 'rarity', 'index', 'name',
  'typeinfo', 'canbuy', 'costcr',
  /* 国家 / 舰种 / 等级代号 */
  'ussr', 'usa', 'us', 'uk', 'it', 'de', 'fr', 'jp', 'jap', 'ger',
  'cv', 'bb', 'ca', 'dd', 'cl', 'ss', 'pam', 'pa', 'lvl',
]);

/* 战舰名末尾的修饰词：年份、活动代号、测试/涂装/联动后缀。 */
const NAME_TAIL = new Set([
  'stock', 'test', 'subtest', 'tst', 'bot', 'event', 'space', 'pa', 'pr',
  'vl', 'smf', 'azur', 'arp', 'hsf', 'black', 'white', 'colorful', 'gold',
  'premium', 'supertest', 'challenge', 'ranked', 'bumblebee', 'camo', 'ny',
  'sanzang', 'arpeggio', 'hound', 'boss',
]);

/* H2017 / H2019 / H2020 / FA2023 这类活动家族代号。 */
const EVENT_CODE = /^(?:h|fa)20\d\d$/;

function nameTokens(name) {
  return String(name)
    .replace(/^p[a-z]{2,4}\d+_/i, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isStrongNameToken(token) {
  return token.length >= 3 &&
    !/^\d+$/.test(token) &&
    !NAME_STOP.has(token) &&
    !EVENT_CODE.test(token);
}

/** 战舰名去掉尾部修饰后剩下的“名字词”。全是被忽略的通用词时返回空。 */
function shipNameTokens(name) {
  const tokens = nameTokens(name);
  while (tokens.length) {
    const last = tokens[tokens.length - 1];
    if (NAME_TAIL.has(last) || /^\d+$/.test(last) ||
        /^(?:test|tst|subtest)\d*$/.test(last) || EVENT_CODE.test(last)) {
      tokens.pop();
    } else {
      break;
    }
  }
  while (tokens.length && !isStrongNameToken(tokens[tokens.length - 1])) {
    if (!tokens.slice(0, -1).some(isStrongNameToken)) return [];
    tokens.pop();
  }
  return tokens;
}

/**
 * 为一个期次建立匹配器。phrase(字段键) 先找最长的舰名片段；
 * family(字段键) 再用活动代号兜底。
 */
function buildShipMatcher(entries) {
  const phrases = new Map();   // "moonsund" / "graf_spee" -> Set(舰名)
  const families = new Map();  // "h2020" -> Set(舰名)
  let maxLen = 0;

  for (const entry of entries) {
    if (entry.t !== 'Ship') continue;
    const raw = nameTokens(entry.n);
    for (const token of raw) {
      if (!EVENT_CODE.test(token)) continue;
      let set = families.get(token);
      if (!set) families.set(token, (set = new Set()));
      set.add(entry.n);
    }
    const tokens = shipNameTokens(entry.n);
    for (let i = 0; i < tokens.length; i++) {
      const phrase = tokens.slice(i);
      if (!phrase.some(isStrongNameToken)) continue;
      const key = phrase.join('_');
      let set = phrases.get(key);
      if (!set) phrases.set(key, (set = new Set()));
      set.add(entry.n);
      if (phrase.length > maxLen) maxLen = phrase.length;
    }
  }

  return {
    /** 字段键里最长的舰名片段；没有就返回空数组。 */
    phrase(key) {
      const tokens = nameTokens(key);
      for (let len = Math.min(tokens.length, maxLen); len >= 1; len--) {
        const hits = new Set();
        for (let i = 0; i + len <= tokens.length; i++) {
          const ships = phrases.get(tokens.slice(i, i + len).join('_'));
          if (!ships) continue;
          for (const ship of ships) hits.add(ship);
        }
        if (hits.size) return [...hits];
      }
      return [];
    },

    /** 字段键里的活动家族代号。 */
    family(key) {
      const hits = new Set();
      for (const token of nameTokens(key)) {
        const ships = families.get(token);
        if (!ships) continue;
        for (const ship of ships) hits.add(ship);
      }
      return [...hits];
    },
  };
}

/** 条目最终归属的战舰；Ship 本体归自己，已有 p 的沿用 p。 */
function shipKeys(entry) {
  if (entry.__ships) return entry.__ships;
  let keys = [];
  if (entry.t === 'Ship') {
    keys = [entry.n];
  } else if (entry.p) {
    keys = [entry.p];
  } else if (state.shipMatcher && entry.f) {
    const specific = new Set();
    const families = new Set();
    const seen = new Set();
    for (const row of entry.f) {
      const key = String(row[0]).split('.')[0];
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const hits = state.shipMatcher.phrase(key);
      if (hits.length) {
        for (const ship of hits) specific.add(ship);
      } else {
        for (const ship of state.shipMatcher.family(key)) families.add(ship);
      }
    }
    keys = specific.size ? [...specific] : [...families];
  }
  entry.__ships = keys;
  return keys;
}

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
  shipMatcher: null,
  fieldFilter: null,
  fieldConfigFailed: false,
  names: {},
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

/* ------------------------------------------------------------- 词条中文名 */
/* data/names.json 把 GameParams 键名映射到 global.mo 里的中文名；
 * 没有译名时（例如尚未本地化的新条目）继续显示原始键名。 */
function cn(name) {
  return (state.names && state.names[name]) || name;
}

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
  const ships = shipKeys(entry);
  let s = (ships.length ? ships.join(' ') + ' ' + ships.map(cn).join(' ') + ' >> ' : '') +
    entry.n.toLowerCase() + ' ' + cn(entry.n).toLowerCase() + ' ' + entry.t.toLowerCase();
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
    const keys = shipKeys(entry);
    if (state.ship === UNATTACHED) return keys.length === 0;
    return keys.includes(state.ship);
  });
}

function groupShips() {
  const ships = new Map();
  const total = { a: 0, r: 0, m: 0, entries: 0 };
  let unattached = null;
  for (const entry of shipRelated()) {
    total[entry.k] = (total[entry.k] || 0) + 1;
    total.entries += 1;
    const keys = shipKeys(entry);
    if (!keys.length) {
      if (!unattached) unattached = { kinds: { a: 0, r: 0, m: 0 }, entries: 0 };
      unattached.kinds[entry.k] = (unattached.kinds[entry.k] || 0) + 1;
      unattached.entries += 1;
      continue;
    }
    for (const key of keys) {
      let row = ships.get(key);
      if (!row) {
        row = { name: key, kinds: { a: 0, r: 0, m: 0 }, entries: 0 };
        ships.set(key, row);
      }
      row.kinds[entry.k] = (row.kinds[entry.k] || 0) + 1;
      row.entries += 1;
    }
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
  return `<button class="ship-item${active ? ' on' : ''}" type="button" data-ship="${esc(value)}" title="${esc(value || label)}">
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
  const visible = query
    ? ships.filter((s) => s.name.toLowerCase().includes(query) || cn(s.name).toLowerCase().includes(query))
    : ships;
  const parts = [shipRowHtml('', t('全部战舰'), total, !state.ship)];
  for (const ship of visible) parts.push(shipRowHtml(ship.name, cn(ship.name), ship.kinds, state.ship === ship.name));
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
  if (entry.p) parts.push(`<span>${esc(t('主词条'))} <b>${esc(cn(entry.p))}</b></span>`);
  for (const [k, v] of Object.entries(entry.s)) {
    if (v === null || v === '') continue;
    const text = k === 'name' && typeof v === 'string' ? cn(v) : fmtVal(v);
    const title = k === 'name' && typeof v === 'string' && text !== v ? ` title="${esc(v)}"` : '';
    parts.push(`<span>${esc(map[k] || k)} <b${title}>${esc(text)}</b></span>`);
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
  const matched = !entry.p && entry.t !== 'Ship' ? shipKeys(entry) : [];
  const shownMatches = matched.length && state.ship && state.ship !== UNATTACHED && matched.includes(state.ship)
    ? [state.ship, ...matched.filter((name) => name !== state.ship)]
    : matched;
  const matchBadge = shownMatches.length
    ? `<span class="ematch" title="${esc(shownMatches.join(' · '))}">→ ${esc(cn(shownMatches[0]))}${
      shownMatches.length > 1 ? ` +${num(shownMatches.length - 1)}` : ''
    }</span>`
    : '';
  const name = entry.p
    ? `<span class="eparent">${esc(cn(entry.p))}</span><span class="esep">&gt;&gt;</span>${esc(cn(entry.n))}`
    : esc(cn(entry.n));
  const fullName = entry.p
    ? entry.p + ' >> ' + entry.n
    : shownMatches.length ? shownMatches.join(' / ') + ' >> ' + entry.n : entry.n;
  return `<div class="entry${open ? ' open' : ''}${entry.p || matched.length ? ' sub' : ''}" data-name="${esc(entry.n)}">
    <button class="entry-head" type="button" aria-expanded="${open ? 'true' : 'false'}">
      <span class="kind kind-${entry.k}">${esc(kindLabel(entry.k))}</span>
      <span class="ename" title="${esc(fullName)}">${name}</span>
      ${matchBadge}
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
  return state.ship === UNATTACHED ? t('未归属配件') : cn(state.ship);
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

let namesPromise = null;

/** 载入 data/names.json（GameParams 键名 -> global.mo 中文名），失败时退回原始键名。 */
function ensureNames() {
  if (namesPromise) return namesPromise;
  namesPromise = (async () => {
    try {
      const res = await fetch(BASE + 'data/names.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.json();
      if (blob && blob.names && typeof blob.names === 'object') state.names = blob.names;
    } catch (err) {
      console.warn('[simple] 无法载入 names.json，词条名保持 GameParams 键名：' + err.message);
      state.names = {};
    }
    return state.names;
  })();
  return namesPromise;
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
    state.shipMatcher = buildShipMatcher(data.entries || []);
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

  // 字段清单、中文名与数据并行加载：列表渲染前要先拿到前两者。
  const fieldConfigReady = ensureFieldConfig();
  const namesReady = ensureNames();

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

  await Promise.all([fieldConfigReady, namesReady]);

  const first = channelPeriods()[0];
  const target = wanted ? wanted.id : (first && first.id);
  if (target) showPeriod(target);
}

boot();
