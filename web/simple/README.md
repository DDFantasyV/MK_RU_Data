# 简洁版（simple/）

这是**简洁版的工作目录**，与根目录的专业版并列、互不影响。简洁版只关注**战舰及其配件**的变更，并在左侧按战舰汇总。

```
web/
├── index.html          专业版入口（data-edition="pro"）
├── assets/             共用资源
│   ├── style.css       两版共用的配色 / 顶栏 / 条目 / 字段行样式
│   ├── i18n.js         词条运行时（解析 i18n/*.po）
│   ├── chrome.js       专业版 / 简洁版切换 + 语言切换 + 顶栏高度
│   └── fields.js       两版共用的字段差异树（按路径折叠）
├── i18n/               三语词条（msgid = 简体中文原文）
├── tools/              生成脚本（gen_simple_fields.py 等）
└── simple/             简洁版（本目录）
    ├── index.html      入口（data-edition="simple"）
    ├── style.css       仅在共用样式之上覆盖布局（左侧导航 + 窄正文）
    ├── app.js          简洁版逻辑
    ├── field-tree.conf 字段显示清单（自动生成，约 8 MB）
    └── README.md       本文件
```

## 它现在做什么

- 同样的 `data/index.json` 与 `data/periods/*.json`，不复制任何数据；
- **只显示战舰及其配件**的条目（规则见下），涂装 / 旗帜 / 贴花等独立内容不出现；
- 左侧导航：
  - 顶部是「全部战舰」，带全部条目的 `+新增 −删除 ~修改` 计数；
  - 下面是本期有变更的战舰，按名称排序，每艘显示自己的 `+ / − / ~` 计数；
  - 没有归属到具体战舰的配件收在「未归属配件」；
  - 「搜索战舰…」只过滤这个列表；
  - 点击某艘战舰，右侧清单只显示该舰及其配件，四个计数同步变成该舰的范围；
- 页面上方仍然选择 PT / Live 与期次，下面是四个计数（新增 / 删除 / 修改 / 字段变化）；
- 右侧条目清单每次加载 60 条，底部“加载更多”；
- 点开条目显示摘要和**与专业版相同的可折叠字段树**：按字段路径分段，分组行可逐层展开/收起，构建时折叠的子树只显示汇总；
- 没有分页器；字段树的渲染与折叠在 `../assets/fields.js`，两版共用。

## 筛选规则

`app.js` 顶部的 `SHIP_TYPES` 与 `isShipRelated()` 决定哪些条目进入简洁版：

| 收录 | 说明 |
| --- | --- |
| `Ship` | 战舰本体 |
| `Unit` / `Component` | 船体、火炮、引擎等 unit / 组件 |
| `Gun` / `Projectile` | 火炮、炮弹 / 鱼雷 / 炸弹 |
| `Aircraft` | 舰载机 |
| `Radar` / `Director` / `Finder` / `Catapult` | 雷达、射控、测距仪、弹射器 |
| `Modernization` / `Ability` | 升级品、消耗品 |
| `Other` 且带 `p` | 挂在某艘战舰下的舰船机制（RageMode 等） |

| 排除 | 说明 |
| --- | --- |
| `Exterior` | 涂装、皮肤、贴花、旗帜（含挂在战舰上的） |
| `Crew` | 指挥官 / 船员，属于独立内容 |
| `Achievement` / `Collection` / `Campaign` / `DogTag` / `Reward` | 成就、收藏、活动、狗牌、奖励 |
| `Building` / `BattleScript` | 建筑、战斗脚本等 |
| `Other` 无 `p` | 没有归属的杂项（成就条件、任务等） |

> `Finder`（测距仪）是战舰配件，已在收录表中；以后新增、未列出的类型默认不收录。

无法落到具体战舰的配件（例如全局 `Modernization`、`Ability`，或 `Unit` 没有 `p`）统一归入「未归属配件」，不会被丢掉。

## 字段显示清单（field-tree.conf）

`field-tree.conf` 决定字段树里哪些路径可见。它由脚本扫描 `web/data/periods/*.json`
里所有战舰相关条目、按页面同样的分段规则生成，路径形如：

```text
AIParams: true;
AIParams >> default_distance: true;
A_Hull >> HP_BGS_1 >> ammoList: true;
```

- **继承语义**：`true` 让该节点及其整棵子树显示；`false` 让该节点及其整棵子树隐藏。
  - 没写到的子路径**继承父项**，所以只写 `A_ATBA: true;` 就够整棵 AA 子树显示；
  - 顶级路径默认**不显示**（文件里没有的顶级分组不出现）；
  - 祖先写了 `false` 时，即使更深层写了 `true` 也仍然隐藏。
- 路径层级用 ` >> ` 分隔，数组下标按实际节点写成 `[0]`、`[1]`。
- 分组行里的“N 项”是过滤后仍可见的叶子数；条目行右侧的“N 项”和顶部“字段变化”仍是数据里的总差异数。
- **所有差异都被清单隐藏的条目不再显示**：列表、左侧战舰和顶部统计都只算还有可见差异的条目
  （删除条目等没有字段行的条目仍保留摘要）。
- 页面启动时就加载该文件（因为要先判断哪些条目“差异全被隐藏”），之后复用；加载失败会在控制台告警，并退回显示全部字段/条目。

### 噪音规则（可选隐藏）

> **当前清单只保留一级条目（`--max-depth 1`，共 1 485 行）。**
> 配合继承语义，一级 `true` 就代表整棵子树显示；要隐藏某个顶级分组，
> 把它改成 `false` 即可，不需要再维护几万条深层路径。

生成脚本顶部有四组规则，路径命中任意一条就写 `false`（连同整棵子树），
可以把字段树收敛到只保留与战舰数据有关的参数：

| 规则 | 判据 | 例子 |
| --- | --- | --- |
| 资源与表现层 | 字段名含 `effect` / `model` / `camera` / `sound` / `tint` / `trail` / `visual`，或取值本身就是资源路径 | `model`、`shotEffect`、`position`、`A_Hull >> water` |
| 内部标识 | 引擎用的 id、内部键名、类型标签 | `id`、`index`、`name`、`typeinfo`、`ucType`、`burnNode` |
| 非战舰系统 | 挂在战舰条目下、但属于别的系统 | `AIParams`、`BattleUpgradeInfo`、`formations` |
| 装甲参数 | 字段名含 `armor` / `armour`，或字段名为 `barbettes` | `armor`（按分区 id 的厚度表）、`armorCoeff`、`armourCas` / `armourCit` / `armourDeck` / `armourExtremities`、`splashArmorCoeff`、`barbettes` |

四组装甲／资源／标识／附属系统规则全开时，147 079 条路径里会隐藏约 4.6 万条
（`true` 约 10.1 万）。要调整可见范围：

- 改 `web/tools/gen_simple_fields.py` 顶部的 `ASSET_WORDS` / `ASSET_NAMES` /
  `IDENT_NAMES` / `NON_SHIP_ROOTS` / `ARMOR_WORDS` / `ARMOR_NAMES`，再重新生成；
- 只想临时看某条路径，把 `field-tree.conf` 里对应行改成 `true` 即可
  （重新生成时非噪音路径的 `false` 会保留，噪音路径仍会被规则压回 `false`）。

生成 / 更新：

```powershell
py -3 web/tools/gen_simple_fields.py                          # 保留已有 false，新路径默认 true（规则生效）
py -3 web/tools/gen_simple_fields.py --reset                  # 忽略现有清单，按默认值重写（规则仍生效）
py -3 web/tools/gen_simple_fields.py --all-true               # 所有路径一律 true（忽略规则，全部显示）
py -3 web/tools/gen_simple_fields.py --all-true --max-depth 1 # 只保留一级条目（当前清单）
```

`--max-depth N` 只输出深度 ≤ N 的路径；文件头会记一行“仅输出深度 ≤ N 的路径”。

每次运行 `build.py` 更新数据后都要重新生成一次，否则新增字段会因缺失而隐藏。
脚本会删除数据里已不存在的路径；已有的 `false` 会保留。

### 重复分组只显示一组

同一层里内容完全相同的“同族实例”只保留第一组，组名后面标 `×N`（N＝合并进来的组数，
鼠标悬停有说明）。例如：

```text
A_ATBA
  HP_AGS_1  ×2      ← HP_AGS_10 与它完全相同，合并
  HP_AGS_2  ×2
  Aura_5010         ← 与 Aura_5010_Bubbles 有 7 个值不同，两组都保留
```

- 判据是**同族名 + 可见内容完全一致**（相对路径、旧值、新值、变更类型都相同）。
  族名由实例名归一化得到：去掉尾部数字、`_Bubbles`、`A_`/`B_`/`A1_` 这类配置前缀，
  所以 `HP_AGS_1…10` 同族、`AuraFar` 与 `AuraFar_Bubbles` 同族、`A_Hull` 与 `B_Hull` 同族。
- 数组下标 `[0]` / `[1]`、纯数字键（`65568`、`-10`）不参与合并，位置本身就是语义。
- 不同参数只是恰好取值相同（`pitch` / `yaw`、`armourCas` / `armourCit`）不会合并。
- 合并发生在打开条目时（`MK_fields.rowsHtml(entry, filter, { mergeDuplicates: true })`），
  只作用于简洁版；专业版仍然逐条列出。分组行的“N 项”是合并后可见的叶子数。

## 约定

- **文案一律走词条**：`t('中文原文', {占位符})` / `tn('中文原文', n, …)`，
  `index.html` 里用 `data-i18n` / `data-i18n-html` / `data-i18n-placeholder` 等标注。
  新增文案后同步 `web/i18n/zh_CN.po`、`en.po`、`ru.po`，再运行：
  ```powershell
  py -3 web/tools/i18n_check.py
  ```
- **路径前缀**：本页通过 `<html data-base="../" data-edition="simple">` 声明自己
  在 `web/simple/` 下；读取数据用 `BASE + 'data/…'`，不要写死相对路径。
- **切换回专业版**：顶栏的“专业版 / 简洁版”开关会保留当前 `#/<期次>`，
  语言选择存在 `localStorage.mk.locale`，两个版本共享。
- 共用样式都在 `../assets/style.css`，本目录的 `style.css` 只写覆盖规则，
  避免两版视觉各改各的。
- 字段树（路径分段、分组展开、懒加载子节点）在 `../assets/fields.js`，两版共用；
  简洁版只负责决定条目何时展开，不要再复制一份树逻辑。
- 左侧导航的粘性偏移使用 `--topbar-h`，由 `assets/chrome.js` 按顶栏实际高度写入；
  不要改回固定的 `71px`。
