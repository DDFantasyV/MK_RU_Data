# GameParams 数据变更浏览器

静态站点，逐期展示《战舰世界》`GameParams.data` 的相对上一版的**条目增删**与**字段改动**，可直接发布到 GitHub Pages。

站点提供两个版本：根目录的**专业版**（完整侧栏、字段树、分页器）和 `simple/` 下的**简洁版**。简洁版里又有两个并列页面：**版本变更**（只保留战舰及其配件，左侧按战舰汇总新增/删除/修改）和**历史变更**（左侧列出全部战舰，右侧逐舰回看自加入版本以来的参数时间线）。界面支持**简体中文 / English / Русский** 三种语言，默认简体中文。

当前站点只收录 **主版本 25 起** 的数据：PT 期次 24 个（`PT/25.03_1` … `PT/26.11_1`，外加识别为 `26.12_1` 的 `PT/latest`）、Live 期次 21 个（`Live/25.03` … `Live/26.10`，外加识别为 `26.11` 的 `Live/latest`），共 45 期。13.x 及更早的版本不保留。需要其它范围时用 `--from-major` 调整，见下文。

### `latest` 目录的版本识别

`PT/latest`、`Live/latest` 是滚动的「最新拆包」目录，没有版本号。构建时按**同通道最大数字版本号 + 1** 识别：

| 场景 | 识别结果 |
| --- | --- |
| PT 最大是 `26.11_1` | `PT/latest` → `26.12_1` |
| PT 最大是 `25.12_1` | `PT/latest` → `26.01_1`（跨年进主版本，不是 `25.13`） |
| Live 最大是 `26.10` | `Live/latest` → `26.11`（Live 不带补丁号） |

识别结果同时用于页面显示、期次排序和 `#/` 链接（`#/pt-26.12_1`、`#/live-26.11`）；原始目录名仍显示在对比卡的文件路径里。

## 目录

```
web/
├── index.html                专业版页面外壳
├── assets/
│   ├── style.css             两版共用的配色 / 顶栏 / 条目与字段行样式
│   ├── i18n.js               词条运行时：解析 i18n/*.po、复数、数字/日期格式
│   ├── chrome.js             专业版 / 简洁版切换 + 语言下拉框（两版共用）
│   ├── fields.js             两版共用的字段差异树（按路径折叠）
│   └── app.js                专业版前端逻辑（无框架、无构建步骤）
├── simple/                   简洁版工作目录
│   ├── index.html            版本变更入口
│   ├── history.html          历史变更入口
│   ├── style.css             简洁版覆盖样式（只写覆盖，复用 assets/style.css）
│   ├── history.css           历史变更页的时间线 / 参数矩阵样式
│   ├── field-config.js       两页共用的 field-tree.conf 解析 / 继承过滤
│   ├── app.js                版本变更逻辑
│   ├── history.js            历史变更逻辑（逐舰时间线）
│   ├── field-tree.conf       简洁版字段显示清单（自动生成，当前仅一级路径）
│   └── README.md             简洁版约定与扩展说明
├── i18n/
│   ├── zh_CN.po              简体中文（源语言，msgid 就是界面原文）
│   ├── en.po                 English
│   ├── ru.po                 Русский
│   └── README.md             词条维护说明
├── data/
│   ├── index.json            期次索引（含每期统计）
│   ├── names.json            GameParams 键名 → 中文名（简洁版，仅简体中文界面）
│   ├── periods/<id>.json     每期的差异数据，按需加载
│   └── history/              逐舰历史数据（build_history.py 生成，按需加载）
│       ├── index.json        战舰目录 + 全局期次表
│       └── <ship-key>.json   单舰参数时间线
└── tools/                    本地脚本（不参与页面功能）
    ├── gpdiff.py             GameParams 解码 / 归一化 / 差异 / 折叠
    ├── build.py              期次配对 + 生成 data/
    ├── build_history.py      从期次 JSON 生成逐舰历史 data/history/
    ├── gen_names.py          从 PT/latest/global.mo 生成 data/names.json
    ├── reindex.py            仅用已有 periods/*.json 重建 index.json
    ├── i18n_check.py         校验三种语言的词条与源码引用
    └── gen_simple_fields.py  生成简洁版字段显示清单 field-tree.conf
```

## 专业版 / 简洁版

| | 专业版（`/`） | 简洁版 · 版本变更（`/simple/`） | 简洁版 · 历史变更（`/simple/history.html`） |
| --- | --- | --- | --- |
| 期次入口 | 左侧版本侧栏 + PT/Live 分段 | PT/Live 分段 + 期次下拉框 | 左侧战舰目录（按国家分组） |
| 导航 | 无（按版本列表浏览） | 左侧列出发生变更的战舰，带新增/删除/修改计数 | 左侧列出全部战舰，支持名称/国家/舰种筛选 |
| 主视图 | 条目列表，分页器每页 100 条 | 仅战舰及配件，每次 60 条，“加载更多” | 单舰参数 × 版本时间线（参数行、版本列、旧值 → 新值） |
| 字段差异 | 按路径折叠的树，可逐层展开 | 与专业版相同的折叠树（共用 `assets/fields.js`） | 历史事件按条目 / 字段路径分组，分组可折叠 |
| 其他 | 顶部汇总卡、类型标签云、展开当前页 | 四个计数、搜索、变更类型筛选、战舰搜索 | 加入版本 / 数据起点、移除标记、横向滚动条、展开/收起全部 |

简洁版只收录**战舰本体与配件**：`Ship`、`Unit`、`Component`、`Gun`、`Projectile`、`Aircraft`、`Radar`、`Director`、`Finder`、`Catapult`、`Modernization`、`Ability`，以及挂在某艘战舰下的 `Other`（RageMode 等舰船机制）。涂装、旗帜、贴花（`Exterior`）、`Crew`、`Achievement`、`Collection`、`Campaign`、`DogTag`、`Building`、`BattleScript` 等独立内容不显示；没有唯一归属的配件先收进左侧的“未归属配件”，再按字段路径里的舰船键回填到本期变更的战舰。规则写在 `simple/app.js` 顶部的 `SHIP_TYPES` / `isShipRelated()` / `buildShipMatcher()`。

**历史变更**页把同一套归属规则沿时间轴复用，但只保留真正的参数：`Other`（活动机制 / RageMode）不进入历史；战舰加入期及更早的事件全部丢弃，加入时的初始参数不算变更；只有参数变更的配件才会出现，加入之后新增/移除且之后有改动的配件在条目行显示标记，没有参数变更的纯配件增删不单独列出；参数级增删仍照常显示。`PT/<ver>_2` 与 `Live/<ver>` 同基线比较产生的重复事件会去重；构建时折叠的 `grp` / 截断的 `x` 会回源快照展开成具体路径；最后再套 `gen_simple_fields.py` 的噪音规则和 `field-tree.conf` 的完整继承语义。数据和页面细节见 `simple/README.md` 的“历史变更页”一节。

简洁版的字段树由 `simple/field-tree.conf` 控制，**「版本变更」与「历史变更」两页共用** `simple/field-config.js` 解析同一份清单；历史页在运行时过滤单舰历史行，`build_history.py` 也用同一套继承语义生成数据。清单采用**继承语义**：`true` 显示该节点及其整棵子树，`false` 隐藏该节点及其整棵子树；没写到的子路径继承父项，顶级路径默认不显示（祖先 `false` 优先于更深层的 `true`）。该文件由 `py -3 web/tools/gen_simple_fields.py` 扫描所有期次的战舰相关条目生成（全量约 14.7 万条路径 / 8 MB；`--max-depth N` 可只输出到第 N 层）；`--reset` 可按默认值重写。生成脚本会按顶部规则把模型/特效等资源路径、内部 `id` 与键名、装甲厚度/系数/分区映射、以及 `AIParams` / `BattleUpgradeInfo` / `formations` 这类非战舰系统置为 `false`（规则全开时约 4.6 万条），`--all-true` 则忽略规则、全部写成 `true`。**当前清单只保留 1 525 条一级路径（`--max-depth 1`，另有 41 条深层路径），一级 `true` 即代表整棵子树显示；某个条目的差异若全被清单隐藏，该条目不再出现在列表和统计里。** 规则与调整方式见 `simple/README.md`。

简洁版渲染字段树时还会把**同一层里内容完全相同的同族实例**（`HP_AGS_1…10`、`AuraFar` / `AuraFar_Bubbles`、`A_Hull` / `B_Hull`）合并成一组显示，组名后标 `×N`；数组下标与纯数字键不合并，取值恰好相同的不同参数也不合并。逻辑在 `assets/fields.js`，`simple/app.js` 通过 `{ mergeDuplicates: true }` 开启，专业版不受影响。

三个页面共用 `data/`、`i18n/`、`assets/style.css`、`assets/fields.js` 和顶栏控件；切换时保留当前期次（`#/pt-26.12_1`）与语言设置。**新增功能请放在各自目录**：专业版改 `assets/app.js`，简洁版版本变更改 `simple/app.js`，简洁版历史变更改 `simple/history.js`，共用样式改 `assets/style.css`，字段树改 `assets/fields.js`。

## 界面文案与多语言

界面上的每一段文字都来自 `web/i18n/*.po`，采用 gettext 的 **msgid → msgstr** 结构：

```po
msgid "新增条目"                 # 简体中文原文（源语言）
msgstr "Added entries"           # 英文译文
```

* 默认语言 **简体中文**；可在顶栏切换 **English / Русский**。选择存于 `localStorage.mk.locale`，也可用 `?lang=en` / `?lang=ru` 直接打开（如 `http://127.0.0.1:8000/simple/?lang=ru`）。
* 代码里用 `t('中文原文', {占位符})`；带数量的文案用 `tn('中文原文', n, …)`，俄语复数由 `msgid_plural` + `msgstr[0..2]` 提供，运行时按 `Intl.PluralRules` 选形式。
* HTML 静态文案用 `data-i18n`（纯文本）、`data-i18n-html`（含 `<code>` / `<span>` 等受信任标签）、`data-i18n-placeholder`、`data-i18n-title`、`data-i18n-aria-label`、`data-i18n-content` 标注。
* 占位符写作 `{name}`，译文必须保留同名占位符；数字、日期用 `Intl.NumberFormat` / `Intl.DateTimeFormat` 跟随当前语言，不写进词条。
* `简体中文` / `English` / `Русский` 三个语言名以各自语言显示（词条中标记 `#, keep-original`）。
* 条目名不属于界面词条：简洁版只有在**简体中文界面**才用 `data/names.json` 把 GameParams 键名换成 `global.mo` 里的中文名；English / Русский 界面显示原始键名，也不下载该文件（切回中文时按需加载）。
* 新增语言的步骤：在 `i18n/` 放一份 `<code>.po`，在 `assets/i18n.js` 的 `LOCALES` 里补一项（`code` / `file` / Intl `tag` / 复数类别映射），顶栏下拉框会自动出现该语言。

改完词条或新增文案后运行校验：

```powershell
py -3 web/tools/i18n_check.py
```

它会检查：三种语言的 msgid 集合一致、英文/俄文无空译文、占位符与 HTML 标签一致、源码 `t()` / `tn()` / `setEmpty()` / `data-i18n*` 用到的词条都存在，并提示已不再使用的词条。

## 期次配对规则

站点分两组：**测试服 PT**（左侧列表默认）和**正式服 Live**，侧边栏顶部可切换。

### PT 期次（新 = PT，旧 = 基线）

| 规则 | 新版本 | 旧版本（基线） | 例子 |
| --- | --- | --- | --- |
| `latest-vs-latest` | `PT/latest`（识别为 `26.12_1`） | `Live/latest`（识别为 `26.11`） | PT 26.12_1 ↔ Live 26.11 |
| `previous-live-release` | `PT/<ver>_1` | 小于该版本号的最近一个 `Live/<ver>` | PT/26.11_1 ↔ Live/26.10 |
| `same-version-prev-patch` | `PT/<ver>_<n>`（n>1） | 同版本的 `PT/<ver>_<n-1>` | PT/25.09_2 ↔ PT/25.09_1 |

### Live 期次（新 = Live，旧 = PT）

| 规则 | 新版本 | 旧版本（基线） | 例子 |
| --- | --- | --- | --- |
| `live-vs-pt` | `Live/<ver>` | 同版本的 `PT/<ver>_1` | Live/26.10 ↔ PT/26.10_1 |
| `live-latest-vs-pt-last` | `Live/latest`（识别为 `26.11`） | 版本号最大的 `PT/<ver>_<n>` | Live 26.11 ↔ PT/26.11_1 |

比较版本号时只看 `主版本.次版本`，`_n` 补丁号不参与 `Live` 基线选择。`Live/25.01`、`Live/25.02` 没有对应的 PT 快照，因此不生成期次。

## 条目归属（主词条 / 子词条）

GameParams 没有显式的父子字段，条目之间的关系只能从引用里还原：

* 舰船（`Ship`）通过 `ShipUpgradeInfo` 的 **键名**引用自己的 unit（船体 / 火炮 / 引擎 / 射控）；
* 舰船内嵌的 `A_Artillery`、`A_Hull`、`A_Directors` 等结构里，以字符串值直接引用 gun、projectile、director、radar、aircraft、catapult 等条目；
* 引用可以继续向下传递（例如炸弹 → 舰载机 → 舰船）。

`gpdiff.ship_owners()` 会沿这些引用做传递闭包，但**不会穿过舰船**，因此 `parentShip` / `childShips` 这类舰船之间的科技树链接不会被误当成归属。只有能唯一落到一艘舰船的条目才记录归属；被多艘舰船共用的模块、迷彩、消耗品不强行挂到某一艘船上。**简洁版**会在此基础上，把这批没有 `p` 的未归属配件按字段路径第一段的舰船键回填到本期变更的战舰（可命中多艘，规则见 `simple/README.md` 的“未归属配件按字段键回填”）；专业版仍只显示构建时的唯一 `p`。

构建时有归属的条目会多一个 `p` 字段（主词条名），页面显示为：

```
PBSB521_Beatty >> PBPA311_508MM_HE_BEATTY
```

同一主词条的条目在列表里相邻排列，主词条本身在前；搜索时输入主词条名也能命中它的子条目。没有任何舰船引用的独立条目（例如单独的旗帜、模板迷彩）保持原样显示。

## 本地预览

```powershell
cd web
python -m http.server 8000
```

* 专业版：<http://127.0.0.1:8000/>
* 简洁版 · 版本变更：<http://127.0.0.1:8000/simple/>
* 简洁版 · 历史变更：<http://127.0.0.1:8000/simple/history.html>
* 指定语言：<http://127.0.0.1:8000/?lang=en>、<http://127.0.0.1:8000/simple/?lang=ru>

直接双击 `index.html`（`file://`）会被浏览器的跨域策略拦住 `fetch`（数据 JSON 和词条 `.po` 都读不到），必须走 HTTP。

## 重新生成数据

仓库根目录需要存在 `Live/` 与 `PT/` 的拆包结果（由 `mkunpack.bat` 生成）。

**`mkunpack.bat` 现在是全自动的**：拆包 → 增量构建站点数据 → 生成简洁版字段清单 → `git add .` → `git commit -m "update to <PT版本号>"` → `git push`，任一步失败就停下来并说明原因。一般不需要手动执行下面的命令；只有单独重建时才用：

```powershell
python web/tools/build.py --from-major 25   # 当前站点：25.x 起（含 26.x 与 latest）
python web/tools/build.py --from-major 25 --force   # 强制全部重建
python web/tools/build.py                   # 全部系列（含 12.x / 13.x）
python web/tools/build.py --from-major 25 --plan   # 只打印配对关系，不解码
```

构建完成后同步简洁版的数据（`mkunpack.bat` 已包含这三步；单独重建数据时需要手动补跑）：

```powershell
py -3 web/tools/gen_names.py                       # 重新生成 data/names.json（简洁版中文界面词条名）
py -3 web/tools/gen_simple_fields.py --max-depth 1 # 字段清单：只保留一级路径，保留已有的 false
py -3 web/tools/build_history.py --from-major 25   # 逐舰历史：data/history/index.json + 单舰 JSON
```

`build_history.py` 只读 `data/periods/*.json` 和 `data/index.json`，不会重新解码 GameParams；只有折叠/截断的条目需要回源快照展开时，才读取该期的两个 `GameParams*.data`。全量生成通常需要约 3 分钟，输出约 14 MB。

提交信息取自 `workspace/cn` 下最新的 PT 目录名（形如 `26.12pt1`），所以最终是 `update to 26.12pt1` —— 正好匹配 `release.yml` 里的 `([0-9]+\.[0-9]+)pt1$`，出包和部署会一起触发。

自动流程的几道闸门：

* **拆包结果只按「输出文件是否存在」判定**：拆完在 `Live\latest`、`PT\latest` 下找不到 `GameParams*.data` 就标记失败。不看 `pfsunpack.exe` 的退出码 —— 不同版本对成功/失败的返回码并不可靠。
* `copy idx`、`copy global.mo` 失败同样标记失败（这两条是明确的文件复制，退出码可信）。
* 标记失败时**跳过构建与推送**，避免把半成品写进缓存和线上。
* 简洁版字段清单生成失败同样会停止，避免新增字段路径没进 `field-tree.conf`。
* 构建失败、`git add/commit/push` 失败、当前目录不是 git 仓库 → 各自给出提示并停止，不会留下半推状态。

> 存在性检查的边界：如果 `pfsunpack` 完全没执行、而 `latest` 里还留着上一次的文件，检查会通过。实践中 `copy idx` 那一步通常先失败并拦住这种情况；真要保险，可以在拆包前先 `del "PT\latest\content\GameParams*.data"`。

`mkunpack.bat` 里查找 Python 的顺序是：`..\.venv\Scripts\python.exe` → `py` 启动器 → `python`；都没找到就只警告并跳过构建与推送，拆包本身不受影响。

`--from-major N` 表示只保留主版本号 ≥ N 的快照，因此 13.x 及更早的版本不会出现在站点里，也不会被解码。

### 增量构建

`build.py` 默认**只重建真正变化了的期次**，其余直接复用已有 JSON。仓库根目录的 `.gpcache/`（不随 `web/` 发布）里存了两层缓存：

| 文件 | 内容 |
| --- | --- |
| `.gpcache/<通道>_<版本>.json` | 该快照每个条目的结构摘要，避免重复解码后重新计算 |
| `.gpcache/manifest.json` | 每期的**输入指纹**（新旧文件的路径 / 大小 / 修改时间 + 规则 + 管线版本）与统计汇总 |

所以日常更新一个版本时，通常只有 2–4 期需要重算（新的 `latest`、被顶替下来的那个版本号），其余 40 多期在一秒内跳过；而每期的时间几乎都花在解码两个十几 MB 的 `GameParams.data` 上。

* `--force` 忽略清单全部重建；改动 `gpdiff.py` 的遍历或折叠逻辑后，把 `build.py` 里的 `PIPELINE_VERSION` 加 1 效果相同。
* 删掉 `.gpcache/` 等同于全量重建（会重新计算所有结构摘要，最慢）。
* 清单只记录本机状态，**不要提交到仓库**（已在 `.gitignore` 中）。

## 发布到 GitHub Pages

仓库：`DDFantasyV/MK_RU_Data`（public），站点地址：

**https://ddfantasyv.github.io/MK_RU_Data/**

⚠️ 「Deploy from a branch」只能选 `/ (root)` 或 `/docs`，**选不到 `/web`**。所以这里用 Actions 发布：

1. 仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**（只需设置一次）。
2. 仓库里已有 `.github/workflows/pages.yml`，只在 `web/**` 变化时触发，把 `web/` 整个目录作为 artifact 发布。检出用的是稀疏检出（`sparse-checkout: web` + `filter: blob:none`），不会把 `Live/`、`PT/` 那 3 GB 拆包数据拉下来。
3. `git push` 到 `main` 后，到 **Actions → Deploy Pages** 看进度；首次部署完成后（约 1–2 分钟）访问上面的地址。

不依赖 Actions 的替代方案：

* 把 `web/` 重命名为 `docs/`，再用分支部署选 `/docs`；
* 或用 `git subtree push --prefix web origin gh-pages` 把 `web/` 推到 `gh-pages` 分支，再以该分支为发布源。

注意：仓库根目录的 `release.yml`（Lesta 服版本包）与 Pages 互不影响 —— 发布站点只需推 `web/`，提交信息写 `web update` 就会让 `release.yml` 跳过。

## 数据说明

* 每期 JSON 只包含**发生变化的条目**，未变化的条目不会输出。
* 新增条目输出完整字段行（`add`）且不在构建时折叠，页面按路径渲染成可折叠树：`A_ATBA`、`A_AirDefense` 等子树以及 `primaryShipTags` → `[0]`、`[1]` 这类数组都能逐层展开，默认收起；单条上限 12000 行。
* 修改条目仍对超大树做汇总（超过 200 行折叠为“子树内 N 处差异”，单条上限 400 行），这类汇总行只展示数量、不可展开，避免单期 JSON 膨胀；删除条目只保留摘要。
* 相机、甲板相机、水下相机、涂装贴花等纯视觉字段（`Cameras`、`DockCamera`、`UnderwaterCamera`、`exteriorDecalsData` …）以及派生字段 `id` 已从比较中剔除。
* 超过 128 项的序列折叠为 `<list len=N>`（只展开前 128 项）；超长字符串截断到 400 字符。
* 计算结构摘要与计算字段差异使用**同一套遍历规则**（`gpdiff.iter_flat`），因此“有变化”的条目一定能列出具体字段，不会出现空差异。
* 同一版本同时存在 `py2` / `py3` 两种序列化文件时，统一使用 `py2`（老的 `GameParams.data` 同样是 py2 格式），保证跨版本比较口径一致。
* `data/history/` 是 `build_history.py` 从上面的期次差异归并出的逐舰时间线：每艘战舰一个文件，只记录**加入之后**的参数变更；加入时、以及加入之前的初始参数不列为变更。它复用期次数据的归属和噪音规则，并按 `field-tree.conf` 的完整继承语义过滤；同时去掉 `Other` 活动机制，把构建时折叠的 `grp` / 截断的 `x` 回源展开成具体字段路径。页面运行时还会再套一次同一份字段清单，因此直接改清单刷新即可影响两页。
