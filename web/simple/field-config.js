/* ------------------------------------------------------------------
 * MK_simpleFields — 简洁版共用的字段显示清单
 * ------------------------------------------------------------------
 * 「版本变更」与「历史变更」都从 simple/field-tree.conf 读取同一份
 * 继承语义配置：
 *   - 显式 true：该节点及整棵子树可见；
 *   - 显式 false：该节点及整棵子树隐藏；
 *   - 没写到的路径继承父项；顶级路径默认不可见。
 *
 * 同时读取 simple/field-ignore.conf（手工维护的屏蔽词）：字段路径的任意
 * 一级名称包含屏蔽词（或与 `=name` 精确相等）时，该节点及其整棵子树隐藏；
 * 屏蔽词优先于上面的清单，且不需要重新生成 field-tree.conf。
 *
 * 版本变更页用它在运行时过滤字段树；历史变更页用它在运行时过滤
 * 单舰历史行。build_history.py 生成数据时只套内置噪音规则，不固化这两份
 * 配置，所以改完任一文件刷新页面即可生效。
 * ------------------------------------------------------------------ */
'use strict';

const MK_simpleFields = (function () {
  /** `A_Hull.HP_1[0]` → ['A_Hull', 'HP_1', '[0]']，与 assets/fields.js 一致。 */
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

  /** 把屏蔽词变成 `(keys) => boolean`：任意一级命中即隐藏该级及子树。 */
  function createIgnoreFilter(ignoreWords) {
    const exact = new Set();
    const words = [];
    for (const raw of (ignoreWords || [])) {
      if (!raw) continue;
      if (raw.charAt(0) === '=') {
        if (raw.length > 1) exact.add(raw.slice(1));
      } else {
        words.push(raw);
      }
    }
    if (!exact.size && !words.length) return () => true;
    return (keys) => {
      for (const key of keys) {
        const low = String(key).toLowerCase();
        if (exact.has(low)) return false;
        for (const word of words) {
          if (low.indexOf(word) !== -1) return false;
        }
      }
      return true;
    };
  }

  /** 把配置 Map 变成 `(keys) => boolean`，语义与旧版 app.js 完全一致。 */
  function createFilter(config, ignoreWords) {
    const allowed = createIgnoreFilter(ignoreWords);
    return (keys) => {
      if (!allowed(keys)) return false;
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

  function parse(text) {
    const config = new Map();
    for (const line of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const value = line.trim();
      if (!value || value.charAt(0) === '#') continue;
      const match = /^(.*?):\s*(true|false)\s*;?\s*$/.exec(value);
      if (match) config.set(match[1].trim(), match[2] === 'true');
    }
    return config;
  }

  /** 解析屏蔽词清单：每行一个词或 `=精确名`，# 开头为注释，空行忽略，统一小写。 */
  function parseIgnore(text) {
    const words = [];
    const seen = new Set();
    for (const line of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const value = line.trim();
      if (!value || value.charAt(0) === '#') continue;
      const word = value.toLowerCase();
      if (seen.has(word)) continue;
      seen.add(word);
      words.push(word);
    }
    return words;
  }

  let promise = null;

  /**
   * 载入并解析清单一遍。field-tree.conf 载入失败时 resolve 一个
   * filter=null 的结果，由调用页面决定退回“全部显示”还是显示警告；
   * field-ignore.conf 载入失败只会按“没有屏蔽词”处理并告警。
   */
  function load(url, ignoreUrl) {
    if (promise) return promise;
    promise = (async () => {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        const config = parse(text);
        let ignore = [];
        let ignoreError = null;
        if (ignoreUrl) {
          try {
            const ires = await fetch(ignoreUrl, { cache: 'no-cache' });
            if (!ires.ok) throw new Error('HTTP ' + ires.status);
            ignore = parseIgnore(await ires.text());
          } catch (err) {
            ignoreError = err;
            if (typeof console !== 'undefined' && console.warn) {
              console.warn('[simple] 无法载入 field-ignore.conf，按没有屏蔽词处理：' + err.message);
            }
          }
        }
        return {
          filter: createFilter(config, ignore), config, ignore,
          error: null, ignoreError,
        };
      } catch (err) {
        return { filter: null, config: new Map(), ignore: [], error: err, ignoreError: null };
      }
    })();
    return promise;
  }

  return { load, parse, parseIgnore, createFilter, createIgnoreFilter, pathSegments };
})();

window.MK_simpleFields = MK_simpleFields;
