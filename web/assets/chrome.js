/* ------------------------------------------------------------------
 * MK_chrome — 两个版本共用的顶栏控件
 * ------------------------------------------------------------------
 * 1) 专业版 / 简洁版切换（两个独立入口页，切换时保留 #/<期次>）
 * 2) 语言下拉框（语言清单来自 i18n.js）
 *
 * 页面通过 <html data-base="…" data-edition="pro|simple"> 声明自己
 * 在哪里、属于哪个版本；本文件不写死任何路径或文案。
 * ------------------------------------------------------------------ */
'use strict';

const MK_chrome = (function () {
  const DOC = document.documentElement;
  const BASE = (DOC.dataset.base || './').replace(/\/+$/, '') + '/';
  const EDITION = DOC.dataset.edition === 'simple' ? 'simple' : 'pro';
  const MODE_URL = {
    pro: BASE + 'index.html',
    simple: BASE + 'simple/index.html',
  };

  let mounted = false;

  function syncModeLinks() {
    const hash = location.hash || '';
    document.querySelectorAll('[data-mode]').forEach((link) => {
      const mode = link.dataset.mode === 'simple' ? 'simple' : 'pro';
      const active = mode === EDITION;
      link.setAttribute('href', MODE_URL[mode] + hash);
      link.classList.toggle('on', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function syncLangSelect() {
    const select = document.getElementById('langSelect');
    if (!select) return;
    const list = MK_i18n.locales();
    if (select.options.length !== list.length) {
      select.textContent = '';
      for (const locale of list) select.appendChild(document.createElement('option'));
    }
    list.forEach((locale, index) => {
      const option = select.options[index];
      option.value = locale.code;
      option.textContent = MK_i18n.t(locale.label);
    });
    select.value = MK_i18n.locale();
  }

  function bindModeLinks() {
    document.querySelectorAll('[data-mode]').forEach((link) => {
      link.addEventListener('click', (ev) => {
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
        const mode = link.dataset.mode === 'simple' ? 'simple' : 'pro';
        /* 已经在这个版本里：不重载页面 */
        ev.preventDefault();
        if (mode === EDITION) return;
        location.href = MODE_URL[mode] + (location.hash || '');
      });
    });
  }

  function bindLangSelect() {
    const select = document.getElementById('langSelect');
    if (!select) return;
    select.addEventListener('change', () => {
      MK_i18n.setLocale(select.value).catch((err) => console.error('[i18n]', err));
    });
  }

  /* 顶栏在中等宽度或长语言标签下会换行；侧栏/工具栏的粘性偏移跟随实际高度 */
  function syncTopbarHeight() {
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    const height = Math.round(bar.getBoundingClientRect().height);
    DOC.style.setProperty('--topbar-h', height + 'px');
  }

  function watchTopbarHeight() {
    syncTopbarHeight();
    const bar = document.querySelector('.topbar');
    if (window.ResizeObserver && bar) {
      new ResizeObserver(syncTopbarHeight).observe(bar);
    } else {
      window.addEventListener('resize', syncTopbarHeight);
    }
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    syncModeLinks();
    syncLangSelect();
    bindModeLinks();
    bindLangSelect();
    watchTopbarHeight();
    window.addEventListener('hashchange', syncModeLinks);
    MK_i18n.onChange(() => {
      syncLangSelect();
      syncModeLinks();
      syncTopbarHeight();
    });
  }

  return { mount, edition: () => EDITION };
})();
