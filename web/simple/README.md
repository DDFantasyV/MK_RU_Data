# 简洁版（simple/）

这是**简洁版的工作目录**，与根目录的专业版并列、互不影响。简洁版只关注**战舰及其配件**的变更：`index.html` 按战舰汇总本期变更，`history.html` 逐舰回看自加入版本以来的参数时间线。

```
web/
├── index.html          专业版入口（data-edition="pro"）
├── assets/             共用资源
│   ├── style.css       两版共用的配色 / 顶栏 / 条目 / 字段行样式
│   ├── i18n.js         词条运行时（解析 i18n/*.po）
│   ├── chrome.js       专业版 / 简洁版切换 + 语言切换 + 顶栏高度
│   └── fields.js       两版共用的字段差异树（按路径折叠）
├── i18n/               三语词条（msgid = 简体中文原文）
├── tools/              生成脚本（gen_names.py、gen_simple_fields.py 等）
├── data/history.json   逐舰历史数据（build_history.py 生成，单文件整包加载）
└── simple/             简洁版（本目录）
    ├── index.html      版本变更入口（data-edition="simple"）
    ├── history.html    历史变更入口
    ├── style.css       仅在共用样式之上覆盖布局（左侧导航 + 窄正文）
    ├── history.css     历史变更页的时间线 / 参数矩阵样式
    ├── field-config.js 两页共用的 field-tree.conf 解析 / 继承过滤
    ├── app.js          版本变更逻辑
    ├── history.js      历史变更逻辑（逐舰时间线）
    ├── field-tree.conf 字段显示清单（自动生成，当前仅一级路径，约 34 KB）
    └── README.md       本文件
```

两个并列页面：顶栏的「版本变更 / 历史变更」切换。`index.html` 仍是逐期差异；`history.html` 是逐舰回看，左侧列出所有战舰，右侧把所选战舰自加入版本以来的参数变更按“参数 × 版本”排成时间线。

## 它现在做什么

- 同样的 `data/index.json` 与 `data/periods/*.json`，不复制任何数据；
- **只显示战舰及其配件**的条目（规则见下），涂装 / 旗帜 / 贴花等独立内容不出现；
- 条目名与左侧战舰名在**简体中文界面**显示 `global.mo` 里的中文名（`data/names.json`）；
  切换到 English / Русский 后与专业版一致，显示原始 GameParams 键名；中文界面下没有对应 IDS 的条目也保持原始键名；
- 左侧导航：
  - 顶部是「全部战舰」，带全部条目的 `+新增 −删除 ~修改` 计数；
  - 下面是本期有变更的战舰，按名称排序，每艘显示自己的 `+ / − / ~` 计数；
  - 没有唯一归属的配件先收在「未归属配件」，再按字段键回填到本期变更的战舰；
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

无法落到具体战舰的配件（例如全局 `Modernization`、`Ability`，或 `Unit` 没有 `p`）统一归入「未归属配件」；页面会再按下面的字段键规则尝试回填，仍未命中的才留在那里。

### 未归属配件按字段键回填

有些全局配件本身没有 `p`，但字段路径的第一段就是舰船键。例如：

```text
USSR_CA_MOONSUND.reloadTime      -> PRSC540_Moonsund_1965
IT_CA_ISONZO.workTime           -> PISC509_Isonzo
UK_DD_WATERLOO.numConsumables   -> PBSD511_Waterloo
Hakusan_BB.numConsumables       -> PJSB569_Hakusan
```

简洁版在渲染前用这段字段键和本期有变更的 `Ship` 名字匹配（`app.js` 的 `buildShipMatcher()` / `shipKeys()`）：

- 战舰名去掉前缀编号和尾部修饰（年份、`TST`、`Black`、`H2019` 等），取从某个词到末尾的连续片段；
  字段键里出现同样的连续词片段就归给该舰，优先最长片段。
- 通用国家/舰种/等级词（`USSR`、`CA`、`BB`、`Lvl` 等）和路径属性名（`ships`、`default`、`typeinfo` 等）不参与匹配。
- 字段键命中多艘战舰时分别归入每一艘；活动代号（`H2017`…`H2020`、`FA2023`）只作为家族标签，
  在没有任何具体舰名命中时才使用。
- 已有 `p` 的条目、`Ship` 本体、以及没有字段路径的条目不参与重新匹配。
- 同一配件在「全部战舰」只计一次，在各自战舰下各计一次；条目行显示 `→ 舰名`，命中多艘时显示 `+N`。
- 条目名本身**不**参与匹配：例如 `PCY010_RegenCrewPremium` 只因为字段里有 `USSR_CA_MOONSUND` 才归到 Moonsund；
  找不到具体舰船键的配件继续留在「未归属配件」。

## 词条中文名（names.json）

页面显示的条目名来自 `web/data/names.json`，由 `web/tools/gen_names.py` 从
`PT/latest/global.mo`（gettext MO）生成。**只有简体中文界面启用替换**：`app.js` 的
`zhNames()` / `cn()` 在当前语言是 `zh-CN` 时才使用文件里的中文名；English / Русский
界面保持原始 GameParams 键名，也不会下载 `names.json`（从英文 / 俄文切回简体中文时
才按需加载并重画）。GameParams 键名到 IDS 的对应规则：

| 类型 | 键名 | 使用的 IDS |
| --- | --- | --- |
| `Ship` | `PBSB521_Beatty` | `IDS_PBSB521_FULL`（完整舰名，缺失时回退 `IDS_PBSB521`） |
| 其他 | `PBPA311_508MM_HE_BEATTY` | `IDS_PBPA311_508MM_HE_BEATTY`（缺失时回退 `…_FULL`） |
| 带前缀 | `PCY010_RegenCrewPremium` | `IDS_DOCK_CONSUME_TITLE_PCY010_REGENCREWPREMIUM` |

带前缀的 IDS 用**后缀匹配**：只要 MO 的 msgid 以 `_<键名>` 结尾就算命中，不要求整串相等
（例如消耗品用 `IDS_DOCK_CONSUME_TITLE_…`、升级品用 `IDS_TITLE_…`）。同名下有多个候选时
优先 `TITLE` 类词条，跳过 `DESCRIPTION` / `DESC` / `TOOLTIP` / `HINT` 等非名称词条。

- 只收录简洁版会显示的条目，文件本身很小（约 0.57 MB）；专业版不受影响。
- **找不到对应 IDS（或 IDS 值为空 / 未翻译）的条目不会写进文件**，中文界面继续显示原始键名
  （例如尚未本地化的 `PBOM001_BeattyRageMode`、`PBSC558_AZUR_Cheshire`）。
- 原始键名保留在条目行 / 左侧战舰的 `title` 提示里；搜索在中文界面同时匹配中文名和原始键名，
  英文 / 俄文界面匹配原始键名（切语言时会清掉搜索索引里缓存的中文名）。
- 生成结果是确定性的（键排序、无时间戳），只有 `global.mo` 或数据真的变化时才会改动。

更新数据后重新生成（`mkunpack.bat` 在 `build.py` 之后已自动执行）：

```powershell
py -3 web/tools/gen_names.py
```

## 字段显示清单（field-tree.conf）

`field-tree.conf` 决定字段树里哪些路径可见，**同时控制「版本变更」与「历史变更」两页**：两页共用 `field-config.js`，启动时各自载入同一份清单；历史数据生成脚本 `build_history.py` 也按同一套继承语义过滤一次。它由脚本扫描 `web/data/periods/*.json`
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
- 历史变更页也会在运行时过滤单舰历史行：隐藏的行同时影响条目、版本列和顶部统计（`变更参数 / 涉及条目 / 变更次数 / 变更版本`）。因此**只改 `field-tree.conf`、不重跑 `build_history.py`** 时，历史页的表格和顶部统计会立即生效；左侧战舰列表里的参数计数仍是生成时按当时清单统计的总数，重跑 `build_history.py` 后才会一起更新。
- 反过来，把 `false` 改回 `true` 时，如果 `history.json` 是在 `false` 状态下生成的，需要重跑 `build_history.py` 才会把字段重新写回——运行时过滤只能隐藏数据里已有的行，不能恢复构建时已经丢弃的行。

### 噪音规则（可选隐藏）

> **当前清单只保留一级条目（`--max-depth 1`，共 1 525 行，另含 41 条深层路径）。**
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

## 历史变更页（history.html）

`history.html` 与 `index.html` 并列，顶栏「版本变更 / 历史变更」切换。它不复用逐期差异的渲染方式，而是把每个期次的差异按**战舰**归并成一条时间线：

- 左侧列出数据里出现过的全部 1 196 艘战舰，按国家分组、按等级/舰种/名称排序；支持按名称/键名搜索，以及国家、舰种两个下拉筛选。中文界面显示 `names.json` 里的中文名，英文 / 俄文界面显示原始 GameParams 键名。
- 右侧顶部是战舰信息（等级、舰种、国家、加入版本或“数据起点”、移除版本）和统计（变更版本 / 变更参数 / 涉及条目 / 变更次数）。
- 主表每一行是一个参数，列是“该舰发生过变更”的版本；版本从左到右递增，同一游戏版本的 PT 补丁与 Live 正式版分成子列（例如 `25.08 ×2` 下是 `PT 1`、`PT 2`，`25.03 ×2` 下是 `PT 1`、`Live`）。
- 参数按条目分组（战舰本体、船体、火炮、炮弹、舰载机、消耗品等），条目内再按字段路径分段折叠；叶子行显示 `旧值 → 新值`，参数新增显示 `+ 值`，参数移除显示 `− 值`，数值变化附带 `+/−` 差值。空单元格画一条淡淡的连接线，表示该值在这段时间里没有变化。
- 只有**发生过变更**的版本才会生成列，所以版本号可能跳跃（25.03 → 25.06 → 26.01），但始终从左到右递增；每个列组的悬停提示里保留完整期次名。
- 「展开全部 / 收起全部」控制条目和参数分组；参数分组超过 30 个叶子时默认收起（避免重巡/战列舰的一千多个 AA 炮位参数一次铺开），点击分组行按需展开。
- 表格顶部另有一条横向滚动条，和表格底部联动，方便在几十列的时间线里左右拖动。

### 历史数据的生成（build_history.py）

历史数据由 `web/tools/build_history.py` 从**已有的** `web/data/periods/*.json` 生成，不重新解码 GameParams：

```powershell
py -3 web/tools/build_history.py --from-major 25
```

输出：

```text
web/data/history.json                战舰目录 + 期次表 + 每舰的条目分组与参数事件
```

当前全量约 1 181 条战舰时间线，`history.json` 约 13.8 MB（Pages 上 gzip 传输约 1 MB）；页面启动时下载一次，之后切换战舰直接读内存，不再逐舰请求。

#### 归并规则

1. **战舰归属**：优先用构建时写入的 `p`（唯一父舰船）；没有 `p` 的条目沿用简洁版的字段键匹配（字段路径第一段里的舰名片段，只匹配具体舰名，不做事后活动家族兜底）。`Other` 类型不进入历史（RageMode、活动治疗系数表等动辄上万行，会淹没真正的战舰参数）。
2. **加入不算变更**：如果某舰在数据范围内有 `Ship` 的 `k="a"`，该期就是它的加入版本；**加入期及之前的所有事件都丢弃**，加入时的初始参数不列为变更。更早就在游戏里的战舰没有加入记录，时间线从数据起点（`25.03_1`）开始。
3. **只列参数变更**：战舰加入之后新增/移除、并且之后有参数变更的配件，会在条目行显示“新增于 X / 移除于 X”作为上下文；**没有参数变更的纯配件增删不单独列出**。参数级的 `add` / `del` 仍照常显示。
4. **同基线去重**：`PT/<ver>_2` 与 `Live/<ver>` 都相对 `PT/<ver>_1` 比较，同一个 `old → new` 会在两期各出现一次。生成时按时间顺序合并：完全相同的连续事件只保留第一次；旧值相同但新值不同的同版本分支，把后一个事件的旧值接到已显示的新值上，保持时间线连续。
5. **折叠 / 截断展开**：期次 JSON 里构建时折叠成 `grp` 的子树、以及超过单条目上限的 `x`，会用该期的源快照重新做一次**不折叠**的字段差异，保证历史行始终有具体参数路径。
6. **字段清单与噪音过滤**：先套 `gen_simple_fields.py` 的 `is_noise()` 规则（模型/特效/资源路径、`id`/内部键名、装甲厚度与系数、`AIParams`/`BattleUpgradeInfo`/`formations` 等），再按 `field-tree.conf` 的完整继承语义过滤（含 `>>` 深层路径）。历史页运行时还会用同一份清单再过滤一次，所以改清单后刷新即可同时影响两页；重跑 `build_history.py` 则会把过滤结果固化进 `history.json`，并同步左侧计数。

#### 数据约定

- 事件存成紧凑数组 `[版本列下标, "chg"|"add"|"del", 旧值, 新值]`；版本列下标指向该舰在 `history.json` 里的 `versions`。
- 每舰时间线的 `entries` 按类型排序（Ship → Unit → Component → Gun → Projectile → Director → Radar → Finder → Catapult → Aircraft → Modernization → Ability），条目内按字段路径排序。
- 生成是确定性的（`sort_keys`、无时间戳、无绝对路径）；`generated` 直接取自 `data/index.json` 的生成时间。
- 每次 `build.py` 更新期次后都要重跑 `build_history.py`；`mkunpack.bat` 已把这一步放在 `gen_simple_fields.py` 之后，失败会中止提交。
- 历史页的文案同样全部走 `web/i18n/*.po`；新增词条后运行 `py -3 web/tools/i18n_check.py`。`i18n_check.py` 已把 `history.html` / `history.js` 纳入源码引用检查，并会检查 `NATIONS` / `TYPES` 常量表里的动态词条。

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
