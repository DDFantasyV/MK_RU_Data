/* ------------------------------------------------------------------
 * MK_i18n — gettext 风格的界面文本运行时（无需构建步骤）
 * ------------------------------------------------------------------
 * 界面上的每一段文字都来自 web/i18n/*.po：
 *
 *   msgid  = 简体中文原文（源语言）
 *   msgstr = 目标语言译文
 *
 * 三种语言各一个文件：zh_CN.po（源）、en.po、ru.po。
 * 浏览器端直接 fetch + 解析，改完 .po 刷新页面即可生效。
 *
 * 占位符写作 {name}；复数词条使用 msgid_plural + msgstr[N]。
 * 语言名称、PT/Live、GameParams.data 这类专有名词在各语言里保持原样。
 * ------------------------------------------------------------------ */
'use strict';

const MK_i18n = (function () {
  const DOC = document.documentElement;
  const BASE = (DOC.dataset.base || './').replace(/\/+$/, '') + '/';

  /* 语言清单：code 同时用于 <html lang>、localStorage 和 Intl；
     label 是语言自称（本身也是 msgid，允许被翻译，但默认保留原文）；
     plural 把 Intl.PluralRules 的分类映射到 msgstr[N] 的下标。 */
  const LOCALES = [
    { code: 'zh-CN', file: 'zh_CN.po', tag: 'zh-CN', plural: { other: 0 }, label: '简体中文' },
    { code: 'en', file: 'en.po', tag: 'en', plural: { one: 0, other: 1 }, label: 'English' },
    { code: 'ru', file: 'ru.po', tag: 'ru', plural: { one: 0, few: 1, many: 2, other: 2 }, label: 'Русский' },
  ];
  const DEFAULT_CODE = 'zh-CN';
  const STORAGE_KEY = 'mk.locale';

  const catalogs = new Map(); /* code -> Promise<Map<msgid, entry>> */
  const listeners = new Set();
  const numberFormats = new Map();
  const pluralRules = new Map();
  const dateFormats = new Map();

  let current = DEFAULT_CODE;
  let active = new Map();
  let initPromise = null;
  let seq = 0;

  /* ---------------------------------------------------- PO parsing */

  function unescapePo(value) {
    return value.replace(/\\(.)/g, (match, ch) => {
      switch (ch) {
        case 'n': return '\n';
        case 't': return '\t';
        case 'r': return '\r';
        case 'b': return '\b';
        case 'f': return '\f';
        case 'v': return '\v';
        case 'a': return '\x07';
        case '"': return '"';
        case '\\': return '\\';
        default: return ch;
      }
    });
  }

  /** Parse a .po file into [{msgid, plural, msgstr[], fuzzy}] (header dropped). */
  function parsePo(text) {
    const entries = [];
    let cur = null;
    let field = null;
    let fuzzy = false;

    const begin = () => {
      cur = { msgid: '', plural: null, msgstr: [], fuzzy };
      fuzzy = false;
      field = null;
    };

    const append = (fragment) => {
      if (!cur) begin();
      const value = unescapePo(fragment);
      if (field === 'msgid') {
        cur.msgid += value;
      } else if (field === 'msgid_plural') {
        cur.plural = (cur.plural === null ? '' : cur.plural) + value;
      } else if (field && field.indexOf('msgstr') === 0) {
        const m = /^msgstr\[(\d+)\]$/.exec(field);
        const index = m ? Number(m[1]) : 0;
        cur.msgstr[index] = (cur.msgstr[index] || '') + value;
      }
    };

    const flush = () => {
      if (cur && cur.msgid) entries.push(cur);
      cur = null;
      field = null;
    };

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) { flush(); continue; }

      if (line.charAt(0) === '#') {
        if (line.indexOf('#,') === 0 && /(^|[\s,])fuzzy([\s,]|$)/.test(line)) fuzzy = true;
        continue;
      }

      const keyword = /^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)[ \t]+"(.*)"$/.exec(line);
      if (keyword) {
        if (!cur) begin();
        field = keyword[1];
        if (field !== 'msgctxt') append(keyword[2]);
        continue;
      }

      const continuation = /^"(.*)"$/.exec(line);
      if (continuation) {
        append(continuation[1]);
        continue;
      }
      /* 其它内容（例如格式错误）忽略，不让整页崩掉 */
    }
    flush();
    return entries;
  }

  function buildCatalog(entries) {
    const map = new Map();
    for (const entry of entries) {
      if (entry.fuzzy) continue;
      const forms = entry.msgstr || [];
      const text = forms[0] || '';
      /* 空译文保留 msgid 作为兜底，不写进目录 */
      if (!text && entry.plural === null) continue;
      map.set(entry.msgid, { text, forms: entry.plural === null ? null : forms });
    }
    return map;
  }

  /* ---------------------------------------------------- loading */

  function metaOf(code) {
    return LOCALES.find((l) => l.code === code) || LOCALES[0];
  }

  /* 只认 LOCALES 里列出的语言：zh、zh-Hans、zh-TW 一律归到简体中文，
     en-GB / ru-RU 等区域变体归到对应语言。 */
  function normalizeLocale(code) {
    if (!code) return null;
    const value = String(code).trim().replace(/_/g, '-').toLowerCase();
    if (!value) return null;
    for (const locale of LOCALES) {
      if (value === locale.code.toLowerCase() || value === locale.tag.toLowerCase()) return locale.code;
    }
    for (const locale of LOCALES) {
      const base = locale.tag.toLowerCase().split('-')[0];
      if (value === base || value.indexOf(base + '-') === 0) return locale.code;
    }
    return null;
  }

  /* 浏览器 / 系统的语言偏好：navigator.languages 按优先级排列（Windows 上
     就是“首选语言”列表），navigator.language 是其中第一项；Intl 的
     resolved locale 反映浏览器 / 系统的区域设置，作为最后的兜底。 */
  function preferredLanguages() {
    const list = [];
    const add = (value) => {
      if (typeof value === 'string' && value && list.indexOf(value) === -1) list.push(value);
    };
    try {
      if (Array.isArray(navigator.languages)) navigator.languages.forEach(add);
      add(navigator.language);
    } catch (err) { /* 老浏览器 / 隐私模式：忽略 */ }
    try {
      add(Intl.DateTimeFormat().resolvedOptions().locale);
    } catch (err) { /* 没有 Intl：忽略 */ }
    return list;
  }

  /** 按浏览器 / 系统语言偏好返回最合适的界面语言，识别不了返回 null。 */
  function detectLocale() {
    for (const language of preferredLanguages()) {
      const code = normalizeLocale(language);
      if (code) return code;
    }
    return null;
  }

  function loadCatalog(code) {
    if (catalogs.has(code)) return catalogs.get(code);
    const meta = metaOf(code);
    const url = BASE + 'i18n/' + meta.file;
    const promise = fetch(url, { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + url);
        return res.text();
      })
      .then((text) => buildCatalog(parsePo(text)))
      .catch((err) => {
        console.warn('[i18n] 无法载入 ' + meta.file + '：' + err.message);
        return new Map();
      });
    catalogs.set(code, promise);
    return promise;
  }

  function saveLocale(code) {
    try { localStorage.setItem(STORAGE_KEY, code); } catch (err) { /* 隐私模式忽略 */ }
  }

  function clearStoredLocale() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (err) { /* 隐私模式忽略 */ }
  }

  /* ?lang=auto 只用于“重新自动识别”，用完从地址栏去掉，避免刷新时反复清空手动选择。 */
  function dropLangParam() {
    try {
      const url = new URL(location.href);
      if (!url.searchParams.has('lang')) return;
      url.searchParams.delete('lang');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (err) { /* file:// 或旧浏览器：保持原样 */ }
  }

  function pickLocale() {
    let param = '';
    try { param = new URLSearchParams(location.search).get('lang') || ''; } catch (err) { param = ''; }

    if (param.trim().toLowerCase() === 'auto') {
      clearStoredLocale();
      dropLangParam();
      return { code: detectLocale() || DEFAULT_CODE, persist: false };
    }

    const fromParam = normalizeLocale(param);
    if (fromParam) return { code: fromParam, persist: true };

    let stored = '';
    try { stored = localStorage.getItem(STORAGE_KEY) || ''; } catch (err) { stored = ''; }
    const fromStore = normalizeLocale(stored);
    if (fromStore) return { code: fromStore, persist: false };

    /* 没有手动选择时跟随浏览器 / 系统：中文 → zh-CN、英文 → en、俄文 → ru；
       其它语言回退到页面声明的 <html lang>，再回退到默认中文。 */
    const fromBrowser = detectLocale();
    if (fromBrowser) return { code: fromBrowser, persist: false };

    const fromHtml = normalizeLocale(DOC.lang);
    if (fromHtml) return { code: fromHtml, persist: false };

    return { code: DEFAULT_CODE, persist: false };
  }

  /* ---------------------------------------------------- API */

  function interpolate(text, vars) {
    if (!vars) return text;
    return String(text).replace(/\{(\w+)\}/g, (match, key) => (
      Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
    ));
  }

  function t(msgid, vars) {
    const entry = active.get(msgid);
    return interpolate(entry && entry.text ? entry.text : msgid, vars);
  }

  /** 复数翻译：按语言规则选 msgstr[N]。n 用于选形式，{n} 默认取 n，可用 vars.n 覆盖为格式化后的值。 */
  function tn(msgid, n, vars) {
    const entry = active.get(msgid);
    let text = msgid;
    if (entry) {
      if (entry.forms && entry.forms.length) {
        const meta = metaOf(current);
        let category = 'other';
        try { category = pluralRule(meta.tag).select(Number(n)); } catch (err) { category = 'other'; }
        const index = Object.prototype.hasOwnProperty.call(meta.plural, category) ? meta.plural[category] : 0;
        text = entry.forms[index] || entry.forms[0] || msgid;
      } else if (entry.text) {
        text = entry.text;
      }
    }
    return interpolate(text, Object.assign({ n }, vars || {}));
  }

  function numberLocale() {
    return metaOf(current).tag;
  }

  /* Intl 对象创建开销不小，列表渲染时按语言缓存复用 */
  function numberFormat(tag, options) {
    const key = tag + '|' + (options ? JSON.stringify(options) : '');
    let formatter = numberFormats.get(key);
    if (!formatter) {
      formatter = new Intl.NumberFormat(tag, options);
      numberFormats.set(key, formatter);
    }
    return formatter;
  }

  function pluralRule(tag) {
    let rules = pluralRules.get(tag);
    if (!rules) {
      rules = new Intl.PluralRules(tag);
      pluralRules.set(tag, rules);
    }
    return rules;
  }

  function num(value) {
    if (typeof value !== 'number' || !isFinite(value)) return String(value);
    try {
      return numberFormat(numberLocale()).format(value);
    } catch (err) {
      return String(value);
    }
  }

  /** 大数字：万以内用分组，以上按语言的紧凑单位（万/亿、K/M、тыс./млн）。 */
  function compact(value) {
    if (typeof value !== 'number' || !isFinite(value)) return String(value);
    if (!value) return '0';
    if (Math.abs(value) < 1e4) return num(value);
    try {
      return numberFormat(numberLocale(), {
        notation: 'compact',
        maximumFractionDigits: 2,
      }).format(value);
    } catch (err) {
      return num(value);
    }
  }

  /** 数据时间戳：按数据生成地（+0800）显示，格式跟随当前语言。 */
  function dateTime(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (isNaN(date.getTime())) return String(iso);
    const tag = numberLocale();
    try {
      let formatter = dateFormats.get(tag);
      if (!formatter) {
        formatter = new Intl.DateTimeFormat(tag, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'Asia/Shanghai',
        });
        dateFormats.set(tag, formatter);
      }
      return formatter.format(date);
    } catch (err) {
      return String(iso);
    }
  }

  const DOM_TARGETS = [
    ['data-i18n', 'text'],
    ['data-i18n-html', 'html'],
    ['data-i18n-title', 'title'],
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-aria-label', 'aria-label'],
    ['data-i18n-content', 'content'],
  ];

  /** 把 data-i18n* 标注的静态文本刷成当前语言。 */
  function applyDom(root) {
    const scope = root || document;
    for (const [attr, kind] of DOM_TARGETS) {
      scope.querySelectorAll('[' + attr + ']').forEach((node) => {
        const text = t(node.getAttribute(attr));
        if (kind === 'text') node.textContent = text;
        else if (kind === 'html') node.innerHTML = text;
        else node.setAttribute(kind, text);
      });
    }
  }

  function syncDocument() {
    const meta = metaOf(current);
    DOC.lang = meta.code;
    DOC.dir = 'ltr';
    DOC.setAttribute('data-locale', meta.code);
  }

  function notify() {
    listeners.forEach((fn) => {
      try { fn(current); } catch (err) { console.error(err); }
    });
    document.dispatchEvent(new CustomEvent('mk:localechange', { detail: { locale: current } }));
  }

  function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const picked = pickLocale();
      current = picked.code;
      active = await loadCatalog(current);
      if (picked.persist) saveLocale(current);
      applyDom(document);
      syncDocument();
      return current;
    })();
    return initPromise;
  }

  async function setLocale(code) {
    const next = normalizeLocale(code);
    if (!next) return current;
    const ticket = ++seq;
    current = next;
    saveLocale(next);
    const catalog = await loadCatalog(next);
    if (ticket !== seq) return current;
    active = catalog;
    applyDom(document);
    syncDocument();
    notify();
    return current;
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    LOCALES,
    DEFAULT_CODE,
    init,
    t,
    tn,
    num,
    compact,
    dateTime,
    applyDom,
    setLocale,
    onChange,
    locale: () => current,
    localeMeta: () => metaOf(current),
    locales: () => LOCALES.slice(),
    parsePo,
  };
})();

window.MK_i18n = MK_i18n;
