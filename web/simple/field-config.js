/* ------------------------------------------------------------------
 * MK_simpleFields — 简洁版共用的字段显示清单
 * ------------------------------------------------------------------
 * 「版本变更」与「历史变更」都从 simple/field-tree.conf 读取同一份
 * 继承语义配置：
 *   - 显式 true：该节点及整棵子树可见；
 *   - 显式 false：该节点及整棵子树隐藏；
 *   - 没写到的路径继承父项；顶级路径默认不可见。
 *
 * 版本变更页用它在运行时过滤字段树；历史变更页用它在运行时过滤
 * 单舰历史行。build_history.py 在生成数据时也使用同样的语义。
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

  /** 把配置 Map 变成 `(keys) => boolean`，语义与旧版 app.js 完全一致。 */
  function createFilter(config) {
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

  function parse(text) {
    const config = new Map();
    for (const line of String(text).split(/\r?\n/)) {
      const value = line.trim();
      if (!value || value.charAt(0) === '#') continue;
      const match = /^(.*?):\s*(true|false)\s*;?\s*$/.exec(value);
      if (match) config.set(match[1].trim(), match[2] === 'true');
    }
    return config;
  }

  let promise = null;

  /**
   * 载入并解析清单一遍。失败时 resolve 一个 filter=null 的结果，
   * 由调用页面决定退回“全部显示”还是显示警告。
   */
  function load(url) {
    if (promise) return promise;
    promise = (async () => {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        const config = parse(text);
        return { filter: createFilter(config), config, error: null };
      } catch (err) {
        return { filter: null, config: new Map(), error: err };
      }
    })();
    return promise;
  }

  return { load, parse, createFilter, pathSegments };
})();

window.MK_simpleFields = MK_simpleFields;
