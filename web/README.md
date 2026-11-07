# GameParams 数据变更浏览器

静态站点，逐期展示《战舰世界》`GameParams.data` 的相对上一版的**条目增删**与**字段改动**，可直接发布到 GitHub Pages。

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
├── index.html            页面外壳
├── assets/
│   ├── style.css         样式
│   └── app.js            前端逻辑（无框架、无构建步骤）
├── data/
│   ├── index.json         期次索引（含每期统计）
│   └── periods/<id>.json  每期的差异数据，按需加载
└── tools/                 本地生成脚本（不参与页面功能）
    ├── gpdiff.py          GameParams 解码 / 归一化 / 差异 / 折叠
    ├── build.py           期次配对 + 生成 data/
    └── reindex.py         仅用已有 periods/*.json 重建 index.json
```

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

`gpdiff.ship_owners()` 会沿这些引用做传递闭包，但**不会穿过舰船**，因此 `parentShip` / `childShips` 这类舰船之间的科技树链接不会被误当成归属。只有能唯一落到一艘舰船的条目才记录归属；被多艘舰船共用的模块、迷彩、消耗品不强行挂到某一艘船上。

构建时有归属的条目会多一个 `p` 字段（主词条名），页面显示为：

```
PBSB521_Beatty >> PBPA311_508MM_HE_BEATTY
```

同一主词条的条目在列表里相邻排列，主词条本身在前；搜索时输入主词条名也能命中它的子条目。没有任何舰船引用的独立条目（例如单独的旗帜、模板迷彩）保持原样显示。

## 本地预览

```powershell
cd web
python -m http.server 8000
# 打开 http://127.0.0.1:8000
```

直接双击 `index.html`（`file://`）会被浏览器的跨域策略拦住 `fetch`，必须走 HTTP。

## 重新生成数据

仓库根目录需要存在 `Live/` 与 `PT/` 的拆包结果（由 `mkunpack.bat` 生成）。

**`mkunpack.bat` 现在是全自动的**：拆包 → 增量构建站点数据 → `git add .` → `git commit -m "update to <PT版本号>"` → `git push`，任一步失败就停下来并说明原因。一般不需要手动执行下面的命令；只有单独重建时才用：

```powershell
python web/tools/build.py --from-major 25   # 当前站点：25.x 起（含 26.x 与 latest）
python web/tools/build.py --from-major 25 --force   # 强制全部重建
python web/tools/build.py                   # 全部系列（含 12.x / 13.x）
python web/tools/build.py --from-major 25 --plan   # 只打印配对关系，不解码
```

提交信息取自 `workspace/cn` 下最新的 PT 目录名（形如 `26.12pt1`），所以最终是 `update to 26.12pt1` —— 正好匹配 `release.yml` 里的 `([0-9]+\.[0-9]+)pt1$`，出包和部署会一起触发。

自动流程的几道闸门：

* **拆包结果只按「输出文件是否存在」判定**：拆完在 `Live\latest`、`PT\latest` 下找不到 `GameParams*.data` 就标记失败。不看 `pfsunpack.exe` 的退出码 —— 不同版本对成功/失败的返回码并不可靠。
* `copy idx`、`copy global.mo` 失败同样标记失败（这两条是明确的文件复制，退出码可信）。
* 标记失败时**跳过构建与推送**，避免把半成品写进缓存和线上。
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
