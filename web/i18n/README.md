# 界面词条（i18n）

`web/i18n/*.po` 是本网站**唯一**的界面文案来源，采用 gettext 的 PO 格式：

```po
#. 统计卡标题
msgid "新增条目"
msgstr "Added entries"
```

* **msgid** = 简体中文原文，也是默认语言与兜底文案；
* **msgstr** = 目标语言译文；
* 三种语言各一个文件：`zh_CN.po`（源语言）、`en.po`、`ru.po`。

页面在运行时 `fetch` 对应 `.po` 并用 `assets/i18n.js` 解析，没有构建步骤：改完词条刷新页面即可。

## 文件角色

| 文件 | 语言 | 说明 |
| --- | --- | --- |
| `zh_CN.po` | 简体中文 | **源语言**：新增词条先写在这里，msgstr 与 msgid 相同 |
| `en.po` | English | 英文译文 |
| `ru.po` | Русский | 俄文译文（含复数形式） |

`Language:` 与 `Plural-Forms:` 头字段用于声明语言和复数规则，不要删除。

## 写法约定

### 占位符

词条里的 `{name}` 是运行时替换的变量，**译文必须保留同名占位符**：

```po
msgid "显示 {from}–{to} / 共 {total} 条"
msgstr "Showing {from}–{to} of {total}"
```

代码里这样用：

```js
t('显示 {from}–{to} / 共 {total} 条', { from: '1', to: '100', total: '2,073' })
```

### 复数

中文没有复数变化，但俄语需要。词条写成 `msgid` + `msgid_plural`，每种语言按自己的 `Plural-Forms` 提供若干 `msgstr[N]`：

```po
# en.po（nplurals=2）
msgid "{n} 项"
msgid_plural "{n} 项"
msgstr[0] "{n} change"
msgstr[1] "{n} changes"

# ru.po（nplurals=3）
msgstr[0] "{n} изменение"
msgstr[1] "{n} изменения"
msgstr[2] "{n} изменений"
```

代码里用 `tn('{n} 项', n, { n: formatted })`：`n` 只用来选复数形式，`{n}` 显示的是格式化后的值。新增复数词条时，三种语言的 `msgstr` 数量必须分别等于各自头部的 `nplurals`。

### 保留原文的词条

语言名称（`简体中文` / `English` / `Русский`）和徽标 `LATEST` 等故意不翻译，词条前加：

```po
#, keep-original
msgid "English"
msgstr "English"
```

校验脚本不会把这类词条报成“未翻译”。

### 含 HTML 的词条

少量词条带 `<code>`、`<span>` 等标签（标题、副标题），由 `data-i18n-html` 注入。**只有本地受信任的词条才会走 innerHTML**，不要在词条里放用户数据；普通文案一律用 `data-i18n` / `t()` 走纯文本。

### 不翻译的内容

`PT`、`Live`、`GameParams.data`、版本号（`26.12_1`）、`python -m http.server` 等命令与标识符保持原样。

## 修改流程

1. 在代码里写 `t('新的中文原文')`（或给 HTML 加 `data-i18n="新的中文原文"`）；
2. 在 `zh_CN.po` 加词条（msgid/msgstr 相同），再补 `en.po`、`ru.po`；
3. 运行校验：

   ```powershell
   py -3 web/tools/i18n_check.py
   ```

4. 本地起服务刷新页面：<http://127.0.0.1:8000/>，用顶栏语言下拉框逐个检查。

校验脚本会报告：三种语言 msgid 是否一致、英文/俄文是否漏译、占位符与 HTML 标签是否一致、源码引用的 msgid 是否都存在，以及哪些词条已不再被使用。

## 新建语言

1. 复制 `en.po` 为 `xx.po`，翻译并改好 `Language:` / `Plural-Forms:`；
2. 在 `web/assets/i18n.js` 的 `LOCALES` 里加一项，例如：

   ```js
   { code: 'de', file: 'de.po', tag: 'de', plural: { one: 0, other: 1 }, label: 'Deutsch' },
   ```

   `label` 本身也是一个 msgid（语言自称），需要在三个语言文件里都存在；
3. 顶栏下拉框由 `LOCALES` 自动生成，无需改 HTML；
4. 运行校验脚本。

## 运行时行为

* 语言优先级：`?lang=` 参数 → `localStorage.mk.locale` → `<html lang>` → 默认 `zh-CN`；
* 找不到译文时回退到 msgid（即简体中文），页面不会因缺词条而空白；
* `.po` 读取失败只在控制台告警，界面保持中文；
* 切换语言会重画当前页面，保留期次、筛选条件和已展开的条目；
* 数字与日期使用 `Intl.NumberFormat` / `Intl.DateTimeFormat`，跟随当前语言（俄语会用不换行空格分组）。
