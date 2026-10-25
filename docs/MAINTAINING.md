# dsh-tokstats 维护说明

> 状态：Active
> 适用范围：本仓库的维护流程与插件实现细节
> 维护责任：修改对应流程或契约的提交者
> 最后核验：2026-10-21

本文件承载**维护者向**的内容。使用者视角的安装与用法见 [README](../README.md)，仓库级硬规则、变更路由与提交规范见 [AGENTS.md](../AGENTS.md)，不变量编号的定义与证据指针见 [INVARIANTS.md](./INVARIANTS.md)。四者分工：AGENTS.md 是**规则**，本文件是**详述**，不变量登记表是**证据指针**，README 只讲使用者看得见的东西。

## 包结构（为什么是混合包）

本包从 v0.2.4 起是**混合包**：tokprev 是纯浏览器 UI；tokstats 与 promptopt 含 host 半边实现（tokstats 注册一个 per-session 投影单元，持久化交给官方会话投影缓存；promptopt 注册 RPC 通道做一次旁路模型调用，计数器落官方存储域）。**两个 host 半边都不写 `$DSH_HOME` 下的自有文件**——这是 v0.6.0 起的硬约束，由结构 guard 静态把关。

## 发布到 GitHub

```powershell
git remote add origin git@github.com:PlusQi/dsh-tokstats.git
git push -u origin master
git tag vX.Y.Z; git push origin refs/tags/vX.Y.Z   # 必做：#vX.Y.Z 固定安装靠它，漏打则该版本号装不上；显式 ref 而非 --tags
```

**打 tag 前的硬门槛**：link 安装目标提交 -> 重启 dsh web -> 刷新页面，目检**每个插件**的 UI 元素实际渲染。"启动无报错 ≠ 插件正常工作"——slot 注册是副作用，apply 提前返回或抛错都可能静默失效。目检不过不打 tag。

推上去即可被安装，无需注册表。`files` 字段保证打包形态（git 安装 / npm 安装都走打包）只带运行必需件加文档：
`lib/` + `icon.svg` + `cordis.patch.yml` + `locale/` + `screenshots.json` + `docs/assets/` 下的截图与位图店招（README 嵌图与市场卡片图，**漏了则打包形态下 README 图片断链、市场卡片丢图**）+ `AGENTS.md` / `CHANGELOG.md` / `docs/MAINTAINING.md` / `docs/INVARIANTS.md`（README / LICENSE / package.json 由打包器自动附带，不必列）。
`icon.svg` **必须**在 `files` 里：`package.json` 的 `icon` 指向它，宿主按包内相对路径读成 data URL 内联；漏了只会在插件元数据里留一条 `meta.error`，界面表现是「没有图标」而不是报错。

**本包只从 GitHub 分发**：不要在任何文档里写「从 npm 装 `dsh-plugins`」——npm 上那个名字是别人的包，见下节「分发与元数据纪律」。

**`docs/INVARIANTS.md` 必须进包**：AGENTS.md 的路由表指向它，包内若缺这份文件，装包者拿到的就是一张指空的必读清单。同理，AGENTS.md 里不得再引用 `docs/specs/`（本地 gitignored，不随包分发）——需要引证据时引 `docs/INVARIANTS.md` 的行号。

`docs/assets/` 的六张截图**现在进包**（v0.7.0 起；promptopt 两张为后续新增）：`screenshots.json` 用**相对路径**引用它们，而相对路径在打包形态下必须能找到文件，否则市场详情页拿到的是死链。它们也让包内 README 的效果图可见。六个文件合计约 690 KB（其中 tokstats 两张约 380 KB，`--dpr 1.6` 出的 1600×1884），是包体增长的主要来源；若日后要瘦身，优先考虑改用 GitHub 绝对 URL 并撤掉 `files` 里的六条（`npm pack --dry-run --json` 可复核实际体积）。

**截图必须跟着界面改，不能长期复用**：v0.7.1 之前 README 用的是 v0.6.0 前后的图，图里还画着三档时间窗、7 个 2 的幂桶和已删除的每轮徽标——读者照着旧图找界面会以为装错了版本。改 `.dsh-tokstats-switch` 档位、桶边界、或删掉某个 slot 时，**同批重截对应截图**；判据是「图里的每一处文案都能在 `lib/client.js` 的词典里找到」。

tokstats 的两张图由 `scripts/render-screenshots.mjs` 生成，**不再从真宿主截图**：

```bash
node scripts/render-screenshots.mjs --lang zh   # → docs/assets/tokstats.png
node scripts/render-screenshots.mjs --lang en   # → docs/assets/tokstats-en.png
```

- **数据是脚本内固定的示例**（模型 `example/*` / `demo/*`、工作区 `D://projects//*`、128 个会话）：真宿主截图必然带本机的模型名、工作区路径与会话标题，那些不该进公开仓库；固定示例也让任何人跑出来的图一致。
- **渲染走真实产物**：脚本经 `test/client-harness.mjs` 捕获真实 `lib/client.js`，用真实组件树 + 真实 CSS 落成静态页，再用无头 chromium 截图——手抄 DOM 只能证明「抄的那份能对齐」。主题 token 取自 `app.asar` 的两个主题块（`body` = 亮色、`body[data-ds-dark-theme]` = 暗色），`--theme light` 可出亮色版。
- **默认是「近 30 天」档**（`--range` 可换）：这一档能同时看到逐日柱图、周趋势条列表（含本周「进行中」）与自适应两列，信息最全；缺省「当日」档看不到周趋势卡，不适合当效果图。
- 需要指定浏览器时用 `--chrome <path>`（或 `CHROME_PATH`），否则按 Playwright 的缓存目录找；找不到时退回 PATH 上的 `chrome`。
- 尺寸固定 `960×1160 @1.6x`（输出 1600×1884）：`--dpr 1` 在 HiDPI 屏上发虚，`--dpr 2` 体积翻倍而 README 显示宽度只有约 800px。

## 新增插件（本包的维护模式）

1. `lib/client.js` 的 `PLUGINS` 注册表加一段：`css` + **`ns`** + **`dicts`** + `apply(ctx)`（helpers、组件、词典、`ctx.slots.inject(...)` 注册块都放这段里）：
   ```js
   const LOCALE_NS_XXX = "dsh-tokstats.xxx";
   const xxxZh = { "row.title": "标题" };
   const xxxEn = { "row.title": "Title" };
   // PLUGINS 内：xxx: { css: xxxCss, apply: xxxApply, ns: LOCALE_NS_XXX, dicts: { zh: xxxZh, en: xxxEn } }
   ```
   `npm run guard` 会拦下漏带 `ns` / `dicts` 的注册块；该插件确无任何界面文案时显式写 `ns: null`。
2. `cordis.patch.yml` 加一行（`name` 固定 `'dsh-tokstats'`，`config.plugin` 指向注册表键；id 带自己的前缀，别撞 dsh-base/dsh-web-app 内置 id）：
   ```yaml
   - id: xxx
     name: 'dsh-tokstats'
     config:
       plugin: xxx
   ```
3. **文案一律走词典**：slot 注册声明 `locale: ns` 取得标准席位 `t`，文案写成 `{name}` 占位符整句模板（英文按英文语序重写，不做片段拼接），带计数的文案按 `.one` / `.other` 成对出键；测试里调 `assertDictPair`（`test/client-harness.mjs`）断言 zh/en 键集一致——本包无构建步骤，官方那层编译期保障只能由它替代。术语对照见 [AGENTS.md](../AGENTS.md) 硬规则 7。
4. 在本地留存该插件的决策记录（不随仓库分发，供维护者回溯）；
5. 重启进程。**零安装操作。**

## 多插件结构的四条硬约束

（来自 DSH 本体，调整前先读）

- **client bundle 按包名发现**：host 按 entry 的 `name` 解析 `<name>/package.json` 读 `dsh.client` 声明，整包服务 `exports["./client"]`。行 name 必须是裸包名 `dsh-plugins`；写成 `dsh-plugins/xxx` 子路径只剩 host 半边（dsh-web-app 的 `web-startup` 行就是这种 host-only 子路径用法）。
- **client 模块图按包扁平**：一个包的 client 半边 = 一个模块节点，包内不能拆多文件（bundle factory 里的 `require` 只认模块表词，相对路径直接抛错）。所有插件共用 `lib/client.js` 单文件靠分段纪律维护，这是"无构建步骤"的边界。
- **host 按行分 fiber，client 每包单 fiber**：patch 每行建一个 **host** fiber，`config.plugin` 是 host 侧分发键（dsh-base 的 `tool-subagent` / `tool-subagent-fork` 是同名多行参考）。本包 `lib/index.js` 的 `apply(ctx, config)` 按该键分发：纯 UI 插件的 host 半边为空（行即存在/禁用锚点），tokstats 的 host 聚合器宿主在 `tokstats` 行的 fiber 上（行禁用 = 统计停摆）。**client 侧** **`__DSH_BOOT__`** **每包只建一个条目且不传 config**（`dsh-client-modules` 按包名构建 boot graph），因此 `lib/client.js` 的 apply 无条件注册 `PLUGINS` 全部插件，靠组件数据不可用时返回 null 降级；客户端不存在"第二行再跑一遍 apply"，也不可能在客户端按 `config.plugin` 分发。host 半边额外受模块图约束：pnpm link 安装下插件真实路径不在宿主 node\_modules 树内，**npm 包 import 不可解析**——`lib/index.js` 只用 `node:` 内建 + `apply(ctx, config)` 参数，不 import cordis/zod 等运行时依赖。
- **样式按插件分 tag**：每插件一个 `data-plugin-css="dsh-tokstats/<id>"` tag（`ensurePluginStyles` 幂等注入、随包 fiber 停止移除）；保持插件块独立颗粒度，日后单插件独立成包时连样式原样带走。

插件长大了要独立发布/独立 repo？把注册块连同 patch 行复制出去单开包即可（可参考本仓库已有插件的实现与打包方式）。

## 插件的 host 侧行为与宿主契约

### tokprev

UI slot `conversation.composer.dock`（**只此一个**：`conversation.chat.assistant-actions` 的每轮徽标已在 v0.6.0 删除，官方 TurnUsagePanel 已覆盖该信息）；投影字段 `contextPressure`（**只此一个**：`contextBreakdown` 依赖已删）；`AssistantMessageNode.usage`（仅取输出历史算 P25–P75）。所有读取路径均带优雅降级（拿不到数据渲染 null，不会报错）。

### tokstats host 侧行为（v0.6.0 起；v0.7.0 加每日序列与路由维度）

架构：**注册一个 per-session 投影单元**，持久化与冷启动交给官方管线，本插件不写任何自有文件。

- **单元**：`key: "dsh-plugins.tokstats"`、`stateVersion: 6`、`state: { w, seed, epoch, rows, last }`。宿主 `ctx.sessionProjections` 在每个已提交事件上驱动 `apply`；`init(header, inheritedEventCount)` 记下 `w`（会话自身 cwd）与 `seed`（fork 继承前缀长度）。
  - **key 带包前缀**：v0.7.0 由 `"tokstats"` 改名，消除与宿主日后注册同名单元的撞车风险（撞车时注册抛错、`startTokstats` catch 后静默退回冷折叠，属极难排查的降级）。宿主对 key 的字符集**零限制**，且 key 只进缓存文件内的字段名、不进文件路径。
  - **旧 key 残留**：官方缓存从不在 `session/disposed` 删记录，改名后旧的 `tokstats` 行留在 `<id>.json` 里不再被读取（每会话数百字节），本版不处理。
- **必须带 `wire`**：只有带 wire 块的单元才出现在 `snapshot` / `cachedSnapshot` / `viewCheckpoint` / `restore` 的公开读取面上（host-only 单元被全部跳过）。`wire.view` 只返回 `{ w, e, rows }`——浏览器侧拿不到跨会话聚合；路由以单个**不透明字符串** `rt` 随 cell 自然带出。
- **cell 三维**：`{ d, b, rt, calls, in, cr, cw, out }`，单元键为 `d \x1f b \x1f rt`。
  - `rt = provider + "/" + model`，由 host 侧拼合并解释；client 把它当整串标签渲染，**不拆、不按 provider/model 做维度用法**（guard 的 `DIMENSION_USE` 四条正则仍在扫 client 产物）。
  - **`rt` 唯一来源**是 `assistant/message` 的 `message.source`（实测带 usage 的 message 100% 齐备）。**刻意不读请求侧事件**：那是请求侧配置快照（带 initial / change / series / resume 四种 reason），与 usage 的结算语义不同源，混用会让「路由」与「用量」来自两条独立路径、数字再也无法对账。guard 静态项会拦 `request/header` 字面量（含注释行）与 `header.config` 读取。
  - **空串 `""` 是「未标注」的唯一表示**（不引入 `null`：JSON 往返与 Map 键都要额外分支，空串天然可排序）。唯一现实来源是「只有 usage chunk、没有同 step 的 message 终值」的步（实测 0.18%），它们仍计入 `calls`。
- **折叠语义**：计费输入 = `in + cr + cw` 落**市面计费档 6 桶**（边界 `[8K, 32K, 128K, 256K, 512K]`，标签 `[0,8K)`…`[512K,∞)`；对齐厂商「按输入长度分档」的真实档位，**不是 2 的幂**）；`seq < seed` 的样本跳过（fork 前缀父会话已计过）；同 `(turn, step)` 的后一样本替换前一样本（差值法：先减旧再加新，**按 `(d, b, rt)` 定位**——旧采样与新采样可能落在不同路由，跨桶跨路由都正确）；无关事件返回同一引用（`Object.is` 成立）。
  - **桶边界与 `stateVersion` 必须同批变更（TS-18）**：cell 只存桶序号 `b`、不存区间，边界一变同一个 `b` 就指向另一个区间，只改边界不抬版本是**静默错位**而不是报错。边界数组（`TOKSTATS_BUCKET_BOUNDS`）与版本号钉在同一条测试断言里，改任一半都必须显式改另一半。
- **E1 折叠**：窗口（`config.windowDays`，缺省 90）之外的明细按「桶 × 路由」加进 `epoch.routes: [{ rt, buckets[6] }]`，`rows` 本体不删不改；读取期按 `[epoch.start, epoch.end)` 排除明细并改计 epoch 合计，因此「折叠前后明细条数不变、各桶数字逐项一致、逐路由合计一致」三条同时成立。
  - **面板的四个时间档位都只发 `windowDays` 一个入参**（TS-20）：近 7 天 = 7、近 30 天 = 30、全部 = 0，**「本月」= 当天日期数**——因为 `tokstatsWindowStart` 的定义是 `today - (windowDays - 1)`，取「今天是几号」代入即落在当月 1 日。不要为「本月」给 host 加第二种窗口口径：那样折叠窗口（`config.windowDays`，决定 epoch 边界）与读取窗口会出现两套语义，而 epoch 区间一旦与读取口径不一致就会双计或漏计。客户端侧的折算函数是 `tokstatsRangeDays`，与这里的式子由 `test/host-tokstats.test.mjs` 的 TS-20 用例跨模块钉住。
  - **内层字段名是 `buckets`**（沿用旧结构同名），外层是 `routes`。
  - **旧结构防御**：读到无 `routes` 但有 `buckets` 的 epoch 时，视为单一路由 `""` 的一组桶（`stateVersion` 抬升后旧缓存行本就会被丢弃，但 `tokstatsSummaryOf` 对 `e` 只校验 start/end，兜底成本极低）。
- **汇总**：面板打开时经 RPC 现算。逐会话先 `cachedSnapshot(meta, ["dsh-plugins.tokstats"])`（零 I/O），取不到才 `readSession` + `coldSnapshot` 冷折叠兜底。**活会话（`record.live === true`）跳过缓存**直接冷读——官方检查点可能滞后于日志且其 `asOfSeq` 无法与调用方稍后打开的日志关联（实测踩到 fork 会话少报 80%）。根工作区在汇总侧按 `listSessions()` 的 header 链解析（`init` 拿不到 headersById）。
- **汇总输出形状**（RPC `summary` 端点返回值，面板唯一消费面）：
  ```
  { buckets[6], daily[], weekly[], heatDaily[], routes[], workspaces[], totals, windowStart, windowDays, generatedAt, workspace?,
    coverage: { sessions, skipped }, epoch: { start, end, calls } | null, day?, dayFolded? }
  totals / 每个 daily 行 / 每个 heatDaily 行 / 每个 route 行 / 每个 workspace 行：{ calls, in, cr, cw, out }
  route 行额外带 rt；未标注行的 rt 是空串
  day 是请求入参的回显；dayFolded 只在 day 存在时出现
  ```
  - **`coverage` 与 `epoch` 是本变更新增的两个纯增量字段**（TS-21 / TS-22），语义分别是「这次请求的覆盖率」与「本次聚合是否把折叠历史并入了某个代表日」：
    - `coverage.sessions` = 通过 `header.id` 校验**且通过 workspace 过滤**的会话数；`coverage.skipped` = 其中 `summary === undefined` 的条数（日志读不出来）。两条恒等约束：`sessions - skipped` 必须等于实际贡献了数字的会话数；**分母与分子同源**——切到单个工作区时别的工作区的会话不进分母，否则页脚会写「已统计 50 个」而数字只来自 2 个。
    - `coverage.priced` **刻意不存在**：PK-09 禁止成本维度，这里显式记一笔防止日后误加。
    - `epoch` 无折叠历史被计入时**必须是 `null`**（不是 `{}`、不是 `undefined`）——client 用 `!== null` 判定，形状模棱两可会让 client 走进「有折叠」分支去读 `end`。`end` 是 epoch 区间的末端，代表日由 client 算 `end - 1`（与 host 的 `tokstatsDayBefore` 同口径）；`calls` 是所有经 epoch 路径计入的调用数，只用于 tooltip 说明。
    - **`epoch` 有三个「不报」的边角**，都是打标会指错列的形态：代表日落在窗口外（切到「近 7 天」时最常见）、epoch 各格全零（那列可能压根不存在）、以及只读到 epoch 结构但没有非零格被计入。多个会话各有不同 `epoch.end` 时取**最早**的代表日、`calls` 求和（PLAN §3.3：区间端点互不重叠，取最小保证是真实的合成日）。
    - **两个字段都不进投影状态**（不在 `state` / `wire.view` 里），因此**不抬 `stateVersion`、不需要清缓存**——这正是 TS-03 举的反例：只给聚合输出加字段不需要抬版本。`wire.view` 键集仍必须是 `w` / `e` / `rows`，那条既有断言若变红说明字段被误塞进状态。
    - 旧 host 消费方（读不到这两个字段）不受影响：纯增量、可缺省，client 走 `undefined` 分支（与 `routes` / `daily` 同一手法）；新 client + 旧 host 时整句不渲染、不打标、不抛错。
  - **client 侧消费（第二批）**：页脚渲染 `已统计 N 个会话`，`skipped > 0` 时追加 `· 跳过 M 个（日志不可读）`；`skipped === 0` **不渲染**那半句（不写「跳过 0 个」这种假零）。日柱里代表日落在该列区间的柱子带 `dsh-tokstats-barEpoch` 类（斜纹 + 次要底色）并在 tooltip 写明「含折叠历史（区间末归并）· N 次」。
  - **热力图与单日模式（第四批，TS-28 / TS-29）**：本批给 `summary` 端点加了**一个并列入参**（`day`）与**三个纯增量输出字段**（`heatDaily` / `epoch.start` / `dayFolded`），不改折叠策略、不进投影状态。
    - **`day` 入参与优先级**：`day` 存在时**覆盖** `windowDays`（SPEC 裁决 C，显式裁决不是实现巧合）。它**不改** TS-20 的「五档共用 `windowDays` 一个入参」契约——client 在单日模式下**仍会传 `windowDays`**（它不知道 host 的优先级规则，传了也无害），所以两者必须能并存：若改成「同时传就报错」，面板在单日下会整块空态，比「静默按 day 算」糟得多。**明细过滤必须双端钳**（`if (day !== undefined && cell.d !== day) continue;`）——只把 `windowStart` 换成 `day` 的语义是「下界」，会把 day 之后的每一天都放进来，多报且看起来完全正常（`AC-1` 用例名里的「双端钳」就是钉这个）。非法 `day`（不合 `^\d{4}-\d{2}-\d{2}$`）按 `undefined` 处理，不抛错、也不退化成整窗。
    - **`heatDaily` 恒 84 天**：固定窗口（`TOKSTATS_HEATMAP_DAYS = 84`），**不跟 `request.windowDays` 走**——否则切到「近 7 天」时热力图会缩成 7 格，失去「稳定时间轴」职责。取法是**同请求多带一次聚合**（复用同一份 `entries` 再跑一次 `tokstatsAggregate`，实测增量 **0.021 ms**）而不是独立发 RPC：宿主 `listSessions` 实测 **58–803 ms** 是单次请求里最贵的一段，而它对两个窗口**完全相同**，独立请求等于把已算好的东西再走一遍。单日模式下照常返回 84 天（**不特判**，SPEC D15：为它写分支反而增加状态机 bug 面）。
    - **`epoch.start`**：新增的纯增量字段，client 用它把热力图的折叠区截断成「不可按日拆」（`[start, end)`）。不加的话折叠区会被渲染成「无记录」——那天有量、只是被 E1 归并进区间了，那是谎报。多个会话各有不同 `start` 时取**最早**（区间端点互不重叠，取最小保证是真实区间起点）；`start` 缺失时回落成 `end` 自身（宁可把折叠区截成空区间，也不给错位起点）。
    - **`dayFolded`**：`day` 落在某会话 `[start, end)` 内时为 `true`（多会话取**或**），且**不把 epoch 合计挂到任何单日上**（区间合计不是那天的真实用量），但 epoch 端点仍要报出来（client 靠它截断热力图）。字段只在 `day` 存在时出现——旧 client 读不到它，纯增量。
    - **单日页脚必须换文案**：页脚区间右端取「今天」、`windowStart` 在单日下等于所选日，于是会写成「10/20 – 10/25」而面板里全是 10/20 的数——读者会以为面板算错了区间。单日下改为只显示那一天并标明「单日」（词典键 `foot.rangeSingle`），且**不得出现 `–` 连接**。这条是目检才发现、浅渲染拦不住的形态，已补断言。
    - **client 侧约定**：热力图折叠格用 `.dsh-tokstats-heatFolded`，**不复用**柱图的 `.dsh-tokstats-barEpoch`——两者是不同图形元素，共用类名会让「改柱图的折叠样式」意外改到热力图（有用例断言它不得出现柱图类名）。网格必须 `grid-auto-flow:column` + `grid-template-rows:repeat(7,…)`（配 `grid-template-columns:repeat(12,…)`），否则 12 个格子会横排成「十二个周一」；DOM 顺序是「一周七天连排」，靠 `grid-auto-flow` 才转成列。**格子必须有尺寸上限**（`minmax(0,24px)` 双向钳 + 整图 `max-width:310px` + `margin:2px auto 0` 居中）：纯 `1fr` 在整行卡片里把每格拉到约 95px，热力图变成七行巨大色块、把下面所有卡片挤出首屏（实测全宽 1600×1000 下整屏只剩热力图），封顶后的余量必须两侧均分否则图挤在左缘；图例的 `justify-content` 必须与网格一致（实测全宽下错开约 390px，读起来像两个无关元素）。三条都是「能看但读错」的形态，由样式断言钉住（含「不得退回纯 `1fr`」的反向断言）。**24px 是与日柱图并排、且间距整体收紧后的取值**（比独占整行时的 34px、上一版的 30px 都矮），它同时是可点目标的下限——格子是按钮，再小就难点。
    - **不抬 `stateVersion`、不清缓存**：与 TS-03 的反例同构——只加聚合输出字段与请求入参，**不进投影状态**。`wire.view` 键集仍必须是 `w` / `e` / `rows`，`heatDaily` / `epoch.start` / `dayFolded` **都不得**进 `state`（TS-01 / TS-28 既有断言兜底）。
  - **卡片栅格（第五批：上方并排、下方自适应 + 整体收紧）**：结构分上下两段。
    1. **顶部时间图**：`.dsh-tokstats-pairGrid`（`1fr 1fr` + `align-items:stretch`，≤820px 折单列），**日柱图在左、热力图在右**（主图优先）。两张都是图、天然等高，stretch 只是把余量交给柱图绘图区；只有一张时独占整行。
    2. **下方卡片**：`.dsh-tokstats-columns`（`display:flex` + `align-items:flex-start`）里放两个 `.dsh-tokstats-column`（`flex:1` + `flex-direction:column` + `gap:10px`）。**每张卡保持自己的高度**，按估算高度（行数 × 46px，promptopt 用 24px）**贪心塞进较矮的那一列**，列内自上而下紧挨着排。分配顺序即阅读顺序：模型排行固定第一张（左列顶部），其余按高度补位。

    **为什么不再用 grid + stretch**：栅格的行高由该行最高的卡决定，矮卡被拉高后下半张是空的——实测「上下文长度分布 6 行 vs 模型排行 16 行」时那片空白有 400+px。flex 列容器里卡片是普通块级项，高度由内容决定，空白只会留在页尾。**估算只用来决定「放进哪一列」**，不参与渲染，所以不必精确到像素；量错一两行只影响分配。
    - **只有一张卡时独占整行**：另一列留空比独占更难看（单日模式隐藏柱图、旧 host 无 `heatDaily`、周趋势不足 2 行都会触发「少卡」）。
    - **间距是一套值，别各写一套**：栅格 `gap:10px`、卡片内边距 `10px`、卡片头下沿 `6px`、页面左右 `20px` / 上下 `10–14px`、图表与图例的 `margin-top:2–4px`。
    - **断点只有一处（820px）**：等宽分栏后每张卡只剩约 `(视口 − 侧栏 − 48) / 2`，低于 820px 时热力图格子会压到 18px 以下、横向刻度开始挤，并排已不划算；窄窗下列容器折成单列。断点按**视口**判定（面板宽度不等于视口，宿主侧栏可折叠），与既有 `@media` 一致，是刻意接受的近似。
  - **色彩约定（第五批，TS-32）**：面板不再直接用宿主的 `--dsw-alias-brand-primary` 画数据，而是在 `.dsh-tokstats-page` 上定义三个变量：
    - `--dsh-tokstats-accent` = `var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary))`。宿主的 brand 在**暗色里近白**（`neutral-bluish-50` `#f9fafb`）、**亮色里近黑**（`bluish-1000` `#0f1115`），色相为零——柱、热力图、比例条、选中态全是它，整块面板就退化成灰阶（这就是第五批要修的「难看」）。业务色是宿主自己的品牌蓝：暗色 `deepseek-400` `#7aaaff`、亮色 `deepseek-500` `#4176e6`，也是宿主 focus ring 的 fallback，借来最不容易撞车。兜底写 `, ` 回落 brand：缺 token 时退回原观感，不要变成无色。
    - `--dsh-tokstats-on-accent` = `var(--dsw-alias-bg-layer-1)`，即「落在数据色上的文字」取**卡片底色**（挖空）：暗色下深字、亮色下白字，两套主题自动成立。**不要用 `label-primary-inverted`**——它是「与 brand 相反」的色，brand 换成蓝之后那个反色就失效（亮色下会变成白底白字）。
    - `--dsh-tokstats-cell` = `color-mix(in srgb, var(--dsw-alias-label-primary) 5%, var(--dsw-alias-bg-layer-1))`，热力图零日格与色阶的基准底。**不能直接取 `bg-layer-2`**：亮色主题里 `bg-base` / `layer-1` / `layer-2` / `layer-3` **全是纯白**（实测 asar 两个主题块），零日格会隐形、整张热力图只剩有量的几格浮着。
    - 五档色阶用 `color-mix(accent 26/44/62/81/100%, cell)` 而不是「同色 + opacity」：opacity 会把背后卡片底色一起透出来（暗色下第一档几乎与零日格同色），且图例无法与格子对上同一档（图例得自己再叠一层）。现在格子与图例**共用** `.dsh-tokstats-ramp` + `data-level` 一套规则，颜色必然一致。
    - 要换色相（比如换成紫/青）只改 `--dsh-tokstats-accent` 的取值来源，其余全部跟随；三处变量都有样式断言兜住，退回 brand-primary 或改成 opacity 方案都会红。

  - **日柱图的窗口跟档位走、但不短于 7 天（第五批，TS-33）**：`chartDays = days > 0 ? max(days, 7) : 0`——当日 → 7 天、近 7 天 → 7 天、本月 / 近 30 天 → 各自窗口逐日、全部 → 全历史（超 30 列按整日合并）。7 天是**下限**：更短的窗口画不出形状（一根柱），更长的窗口不该被砍成 7 天（锁死 7 天那一版让「近 30 天 / 本月」看不到逐日走势，是本次补上的真缺口）。实现三件事：① **数据源按窗口分情况**：窗口 ≥ 7 天用 `daily`（当前窗口的逐日真源）；窗口 < 7 天（当日档）`daily` 只有一行，借与档位无关的 `heatDaily`（host 固定 84 天、已按 workspace 过滤）取最近 7 天；旧 host 没有 `heatDaily` 时退回 `daily`（退化成一根柱，但不整卡消失）。② **窗口起点与列算法同源**：都用 `generatedAt` 的本地日算 `today - (chartDays - 1)`，不能借热力图那个「真实今天」——差一天就与列计算错位。③ **窗口口径写在卡头**（`TokstatsCard` 的 `note`：`近 N 天 · 峰值 …` / `全部 · 峰值 …`）——「图比档位长」只剩当日档一处，不标出来读者会以为图少画了。推论：列数由窗口决定，列密时（>12 列）不标柱顶峰值（见下条）。
  - **日柱图的结构约定（第三批起；第五批改为两行 grid，TS-23）**：`.dsh-tokstats-chart` 是 `display:grid`，`grid-template-columns:auto minmax(0,1fr)` × `grid-template-rows:minmax(0,1fr) auto`：第 1 行 = 纵轴刻度列 `.dsh-tokstats-axisY`（`grid-area:1/1`，宽 40px）+ 绘图区 `.dsh-tokstats-chartMain`（`grid-area:1/2`，内含 `.dsh-tokstats-chartPlot`），第 2 行 = 横轴 `.dsh-tokstats-axis`（**必须写 `grid-area:2/2`**）。
    - **纵轴刻度必须与绘图区同高、且不共用容器**：刻度按 `bottom:70.7%` 绝对定位，参照系是所在盒子的高度。用 flex 布局时纵轴只能写死高度（`height:112px` 与绘图区互相抄一个数字），卡片一被拉伸（与热力图并排后两卡等高）0 刻度就浮在柱体中部；grid 的行定义让「纵轴只跨绘图区那一行、高度由行决定」成为结构事实，`height:auto` 即可。
    - **横轴必须显式落位**：不写 `grid-area` 时自动排进第 2 行第 1 列（纵轴那列），`auto` 列宽会被 7 个刻度槽撑到 300+px——绘图区被整体推右、日期标签挤成一团、柱与刻度彻底错位。这一条只有目检（截图）能发现，浅渲染拦不住，已补样式断言。
    - **横轴与柱位共用一条轨道**：柱容器 `.dsh-tokstats-bars` 与横轴 `.dsh-tokstats-axis` 共用 `.dsh-tokstats-track`（`gap` + `justify-content:center`），每个柱位与每个刻度槽共用 `.dsh-tokstats-trackItem`（`flex:1` + `min-width:3px` + `max-width:48px`）。同一套约束作用于同一列数，第 i 个槽必然落在第 i 根柱的正下方；每列都渲染槽（只有首/中/末三处写字），空槽是撑出列宽的那一层。**不得让横轴自己写 `justify-content`**：曾经的 `space-between` 把首末标签钉在容器两端，而柱组在少列时是居中的，两者相差可达半个容器宽。
    - **刻度位置按平方根刻度算**：峰值在 `100%`、`峰值÷2` 在 `sqrt(0.5)=70.7%`、`0` 在 `0%`。等距三档（100/50/0）会让读者按线性读，而柱高是 `sqrt(calls/peak)`——两者对不上就是「轴在撒谎」。网格线 `.dsh-tokstats-gridLine` 与刻度共用同一组 bottom 值，**改一处必须改两处**。
    - **柱宽上限 48px 必须配 `justify-content`**：`flex:1` 触顶后剩余空间不再分给柱体，容器不显式决定（`center`）就全部落在右侧，少列时看起来像图没画完。列数由窗口决定（TS-33）：当日 / 近 7 天 7 列（每列约 40px），近 30 天 / 本月最多 30 列（每列约 8–10px，`TOKSTATS_DAILY_COLUMNS = 30` 是合并上限）。
    - **峰值柱顶标数值，其余柱只留 tooltip**：峰值标签 `.dsh-tokstats-barPeak` 绝对定位在**柱体内部顶端**（`top:2px` + 反色文字），并给 `z-index:2`——放在柱顶上方（`bottom:calc(100%+2px)`）时因为峰值柱恒为 100% 高，标签必然溢出绘图区、与卡片标题行撞在一起。**列数 > 12 时不标**（`TOKSTATS_PEAK_LABEL_MAX_COLUMNS`）：30 列时每列只剩 8–10px，标签（约 24px）会被相邻柱压成半个数字，读出来是「5」；峰值数值在卡头「峰值 …」里始终可读。并列峰值只标第一根（`peakDayKey`），否则同屏出现两个同值标签。
    - **窄窗（≤900px）隐藏中间刻度**：三行标签在 40px 轴列里会互相挤压，留首末两个仍能读出量级。
    - **KPI 副值必须是对主值的拆分（TS-17）**：调用次数 = **日均**（多天窗口）/ **占 84 天份额**（单天窗口，日均会等于主值本身）/ **全部历史**（「全部」档）；输入 = 未缓存 / 缓存读；输出 = **占输入的比例**（`tokstatsPct`，分母为 0 时破折号，不编 0%）；命中率 = **分子 / 分母**（`命中 X / 计费输入 Y`）。判据是「四卡副值两两不等」断言——只要有一条复述别的卡，它就红。
    - **四卡的口径跟随档位（TS-30）**：四张卡与下方图表**同一个窗口**，都取 `totals`（host 已按窗口 + 工作区过滤）。缺省档位是「当日」，所以打开面板第一眼就是今天的数；切到「近 30 天」四卡同步变成 30 天合计。**不要**再引入第二套「当日」取值——两套口径并存时，图表上方挂着的永远是「另一天的数」，读者得自己记住哪块是哪个口径。当日档下顺带隐藏周趋势卡（窗口只有一天，周合计恒等于 `totals`）：这属于「复述主值」，与单日模式同一条理由。
    - 词典新增 10 个键（`foot.coverage` / `foot.skipped` / `tip.coverage` / `tip.coverageSkipped` / `tip.dayEpoch` 各 `.one`/`.other`）。**占位符名必须与 `tCount` 注入的一致**：`tCount` 只注入 `{count}`，模板里写 `{sessions}` 会原样显示花括号（本批真实踩到，已加「不得残留未替换占位符」断言）。第三批另加 `tip.dailyScale`（刻度口径说明）并改写 `kpi.outputHint` / `kpi.hitHint`。
    - **代表日由 client 也算一遍 `end - 1`**：与 host 的 `tokstatsDayBefore` 是同一条式子的两份实现（两个模块图没有共享常量）。改任一边都要改另一边，否则打标会落到错误的列上——host 侧有「end 与读取期代表日同口径」用例钉住自己的那半。
    - **判据是「代表日落在列区间内」而不是 `=== startDay`**：长窗口下列会被合并（跨度 > 1 天），只比首日在「全部 / 近 30 天」档必然漏标。
    - 词典新增 10 个键（`foot.coverage` / `foot.skipped` / `tip.coverage` / `tip.coverageSkipped` / `tip.dayEpoch` 各 `.one`/`.other`）。**占位符名必须与 `tCount` 注入的一致**：`tCount` 只注入 `{count}`，模板里写 `{sessions}` 会原样显示花括号（本批真实踩到，已加「不得残留未替换占位符」断言）。
  - `daily` 是**时间维度的唯一真源**：`weekly` 由它按自然周（周一）归并，不再独立遍历明细——两趟各自过滤 epoch 与窗口时，任一处漏条件都会让「周合计 ≠ 日合计」只能靠人工对账发现。现在周合计之和恒等于 `totals`。
  - `workspaces` 与 `routes` 都按各自键**累加**合并（同工作区多会话是常态：fork 与并行对话；同 rt 也可能出现在多个会话）。v0.6.0 曾在 `workspaces` 上用 `set()` 覆盖，后一个会话整段盖掉前一个；v0.7.0 修。`routes` 是同一形状的同一个坑，实现时直接按累加写。
  - `routes` 排序写死两步：`calls` 降序；空串「未标注」**显式排最后**（空串在字典序里最前，直接按 `rt` 排会与界面直觉相反）；其余同次数时按 `rt` 字典序，保证输出完全确定。**epoch 的合计同时计入 `routes`**，否则排行会随窗口推进悄悄少行。
  - `daily` 的 `day` 是 host 本地自然日键；epoch 合计用区间末前一天当代表日（与既有周归并口径一致，只影响桶分布/趋势的落点，不影响排行）。
- **版本作废**：抬 `stateVersion` 即让旧缓存行被 `row.ver !== def.stateVersion` 丢弃，不需要写迁移。本次（3 → 6）抬版本的原因是 **桶边界改了三轮、同一个桶序号 `b` 会指向另一个区间**（TS-18）；上一次（2 → 3）是 cell 形状与 epoch 形状都变了。反例：仅给聚合输出加字段（如 v0.7.0 加 `daily`）**不需要**抬——那是聚合期派生、不进投影状态。
- **检查点滞后补偿（TS-19）**：已结束会话走 `cachedSnapshot` 时可能采信**远早于日志末尾**的检查点，实测本机 50 会话里 11 个滞后（最严重缓存 `seq=793` 而日志末序号 162925），面板少报 4.4% 调用 / 4.6% 计费输入。补偿是**逐会话惰性基线**：某会话首次汇总时冷读一次、把**本次读到的 events 最大 seq** 记进进程内记忆（`observedSeq`）；之后读缓存时若 `cachedSnapshot().asOfSeq` 低于基线，就判定滞后并冷读覆盖。
  - **基线不能取 `coldSnapshot().asOfSeq`**：实测 v0 格式会话它返回旧检查点水位（如 1126）而非日志末尾（148654），取它会让判定永不成立（`1126 < 1126` 为 false），冷读算出的正确结果被下一轮旧缓存覆盖。这是本次排查踩到的真实坑。
  - **代价**：进程启动后首次汇总要建立基线（每会话冷读一次）。**该代价已由 TS-24 移出首帧**：首次请求不再串行等待全量冷读，而是先用缓存秒开、把需要校验的会话排进后台队列，返回值带 `verifying: true`，客户端按 1500 ms 退避自动重拉直到收敛。`config.verifyStale: false` 仍可整块关闭，退回「只按 live 判定」（不建基线、不排队，采信滞后检查点）。
  - **TS-24 的性能事实（2026-10-22 实测，70 会话 / 约 50 MB 压缩日志）**：串行 `readSession` 累计 **16.9 s**（均值 238 ms、最长 1.26 s），而单会话折叠只有 **1–5 ms**——慢的全部是宿主 `readSession` 里的读+解压+`Session.create` 全量回放校验+深拷贝。**并发读无效**（上限 4 实测 16.97 s vs 串行 16.98 s：瓶颈是 CPU 同步回放，不是 I/O 等待，已回退）。**有效的是两条**：活会话走投影注册表零回放（宿主的 `drive()` 在每个 `session/event` 上已经增量推进过本单元，正确值本来就在内存里）；已结束会话的冷读移出首帧、改后台。改后同口径：首帧 RPC **39 ms**、面板 **85 ms** 出数、后台 **13 s** 收敛；缓存已在的重启场景面板 **102 ms** 直接显示终值。
  - **后台队列的三条纪律**：单飞（全进程一个 drain）、去重（同会话只排一次）、每会话**重试预算 2 次**。预算上限是双向必需的——读不出日志的会话永远建不了基线，无上限会让队列永不空、`verifying` 恒 true、客户端无限重拉；只试一次又修不了 TS-19 的「水位再次回退」。校验结果先进一次性内存表 `fresh`（下一帧立即可见），不必等缓存写回落盘。
  - **已知未解**：7 个 v0 格式会话的 `readSession` 只返回旧检查点之前的事件（缓存 `seq` 与日志 `maxPlain` 比值 0.5%–1.5%），冷读也拿不到后续事件。这是宿主侧格式迁移的截断行为，插件无法绕过；表现是这些会话的用量仍偏低（`ark-codingplan/glm-5.3` 少 115 次）。若日后宿主修复，本机制自动受益，无需改插件。
- **冷折叠耗时实测**（2026-10-21，本机 42 会话 / 24.1 MB 压缩日志）：清掉本插件缓存行后，从点开面板到出现首行数据 **6.7 s**；缓存建好后再次打开 **125 ms**；单次 `summary` RPC **26–31 ms**。冷折叠是一次性代价，`stateVersion` 变更的直接后果。**本次 3 → 6 升级后按同一口径复测**（清空 50 个会话文件的 tokstats 缓存行 → 点开面板 → 轮询到首行数值）：**8.3 s**，缓存建好后切窗口 **105 ms**——会话数由 42 增到 50，耗时同比放大，仍是一次性代价。**注意聚合数字会受检查点影响**：已结束会话走 `cachedSnapshot`（可能滞后于日志），活会话才冷读——实测同一时刻面板显示 2674 次而全量日志折叠是 2771 次，差额全部来自检查点滞后，不是归因缺陷。TS-19 落地后这个差额已由滞后补偿处理。
- **不改的东西（v0.7.0 改名时的冻结清单）**：投影单元 key `dsh-plugins.tokstats`、RPC 通道名 `/dsh-plugins.tokstats` 与 `/dsh-plugins.promptopt`、存储域名 `dsh_plugins_*`——三者都是持久化或跨侧契约，**包名已改为 `dsh-tokstats` 但它们的值仍是历史名 `dsh-plugins`**。这不是遗留疏漏，是刻意冻结：改 key 等于让每个用户的全部缓存行作废、重付一次全量冷折叠，而宿主对 key 零校验（不是路径、无字符集限制），改名买不到任何正确性。判据一句话：**有持久化或跨侧契约 ⇒ 冻结；纯进程内/纯展示 ⇒ 跟着包名走**（所以 locale `ns` 与样式 tag 前缀已改成 `dsh-tokstats.*`）。

> **改 host 半边必须重启宿主进程（踩过的坑，2026-10-21）**
>
> 宿主的 `@deepseek-ai/dsh-client-hmr` 会**热替换 client bundle**（每 500 ms 比对 `lib/client.js` 的 mtime/ctime/size，变了就 `rebuilt()` 并经 `/plugins/events` SSE 推给浏览器），所以改 `lib/client.js` 后刷新页面即生效。但它**只管 browser 侧**：`lib/index.js` 的 host 半边由 cordis 在启动时 import 并常驻内存，**hmr 不会重新加载它**，必须重启宿主进程。
>
> 误判的典型症状：**新的客户端 + 旧的 host**。此时聚合返回值里没有 `routes` 字段，而新 client 按硬规则 6 的旧-host 兼容设计**整卡不渲染**——表现是「刷新了还是没有模型排行卡」，而不是「卡显示旧数据」。同时缓存里会继续出现旧 key `tokstats@ver2` 的行（那是旧 host 写的），这是最快的判别信号：
>
> ```powershell
> # 有 tokstats@ver2 → host 半边还是旧的
> Select-String -Path "$env:DSH_HOME\storages\session_projcache\sessions\*.json" -Pattern '"tokstats":\{"ver":2'
> ```
>
> 注意 desktop profile 由 Electron 独占，**不能**用 `dsh --profile desktop` 另起实例（会报 `profile "desktop" is managed exclusively by the Electron application`），只能退出应用再重开（不是关窗口——可能只是隐藏到托盘）。

依赖（全部软依赖，缺席均不抛错）：
- slot：`main`（关键 keyed slot，id 必须与 panellist 的 `id` 一致）+ `sidebar.panellist`（列表项，第二参数是 `({ size })` 图标组件）；
- host 服务：`ctx.sessionProjections`（`register`）、`ctx.sessionQuery`（`listSessions` / `readSession`）、`ctx.sessionProjectionCache`（`cachedSnapshot` / `coldSnapshot`，经 `ctx.get` 惰性取）、`ctx.webServer`（自建 prefix 路由挂 RPC 通道）；
- `sessionQuery` 契约提醒：base 以 `path: ':memory:'` + `openAt: never` 挂载，**服务照常注册**（注册在构造函数里），`openAt: never` 只关全文检索。`listSessions` / `readSession` 走 live-preferred 语料，从不打开 SQLite——这是本插件敢直接依赖它、而不去碰 `sessionPersistence` 私有面的原因。

### promptopt host 侧行为

- 注册 RPC 通道 `/dsh-plugins.promptopt`（`ctx.connection.rpc.handle(channel, handler)`，随本行 fiber 卸载即摘），三个端点：
  - `optimize`：收 `{ text }` → 加内置 meta-prompt → `ctx.llm.stream` 收集完整输出 → 返回 `{ text, durationMs, noChange, usage? }`。`noChange` 由「产出与原文等价」判定，不是模型自报的标记；
  - `event`：收 `{ event: "adopted"|"dismissed", before?, after? }`，写计数器；
  - `counters`：读计数器。
- **meta-prompt 是内容协议，不进词典**：五条约束见 `lib/index.js` 的 `PROMPTOPT_META_PROMPT`（禁新增事实 / 不确定保留原样 / 已够结构化则原样返回 / 跟随草稿语言 / 只返回结果）。改它要同步 `test/host-promptopt.test.mjs` 的文本断言——[PO-01](./INVARIANTS.md) 靠那组断言把关。
- 错误只回机器码（`bad-request` / `model-unavailable` / `internal` / `cancelled`），由浏览器侧查词典渲染——host 侧没有 locale 服务，不拼人类可读文案；
- 60s 双保险超时；浏览器 abort（关闭弹层）即中止这次调用；
- **计数器落官方存储域**（域 `dsh_plugins_promptopt`、表 `counters`、单键 `totals`）：`spec` 是**手写**的，因为 `defineDomain` 在 npm 包里、硬规则 5 禁止 import。只提供设施真正读取的形状（`name` / `version` / `tables.<name>.valueSchema`，而 `valueSchema` 只要有个 `parse` 方法）。这是对官方内部契约的一处真实耦合——**DSH 升级后如果计数器整块消失，先查 `ctx.storageDomain.open()` 是否还接受这种 spec 形状**；
- **降级**：`connection` 或 `llm` 缺席时通道不注册，点按钮显示「模型调用失败」而不是白屏；`storageDomain` 缺席或域打不开时计数器停用（记一条 warn），优化功能不受影响；`connection` 用 `ctx.get` 惰性取而不是 `inject`——后者是硬依赖，缺席会连带 tokprev / tokstats 一起不加载。

依赖：UI slot `conversation.input.right`（composer 卡片**内部**工具行）；`InputActions.setDraft` 与 `InputState`（`draft` / `imageIds` / `occurrences` / `claim`）；客户端服务 `ctx.connection.rpc.call`；host 服务 `ctx.connection.rpc.handle`、`ctx.llm`（`stream` / `listProviders` / `listModels`）与 `ctx.storageDomain`（`open` / `get`）。

DSH 升级后若按钮点了没反应或一直报错，先对照这些契约——尤其是 RPC 响应信封（成功必须是 `{ ok: true, value }`，错误码取自宿主闭集）与 `GenerateOptions` 的 `provider` / `model` 必填约束。

### 触发位置的迁移史

v0.5.0 起初把 promptopt 放在 `conversation.composer.dock`（与 tokprev 预告行同带），实际用起来发现 dock 是宿主契约标注的「环境读数带」、可点控件本就该在 tool row——v0.5.1 挪到 `conversation.input.right` 符合「发送前顺手点」的操作逻辑。

## 分发与元数据纪律

- **本包没有发布到任何 registry，只能从 GitHub 安装**。npm 上的 `dsh-plugins@0.1.2` 是 MeCKodo 的插件市场 CLI（bin `dsp`），与本项目无关；dshfind 等索引曾把两者混成一条记录（og:description 是本项目文案，Version / 安装命令指向别人的包）。
  - 因此**任何文档都不得写「从 npm 装 `dsh-plugins`」**——照做会装上别人的包，且失败时表现为「插件没生效」而不是「装错了」。README 中英已删掉该句并改成显式警告。
- **改名已执行（v0.7.0）：`dsh-plugins` → `dsh-tokstats`**。当时的决策记录与成本实测见本地 `docs/specs/active/ASSESS-pack-rename.md`（不随仓库分发），结论留在这里：
  - **改动面（代码侧）**：4–9 个文件 / 6–34 行。本次实际做了 R1 包身份 + R2 派生命名空间，**R3（投影 key）刻意不做**。
  - **用户代价**：依赖键变更 ⇒ `dsh plugin update/remove` 用旧名失效，每个已装用户必须 `remove` + `add` 一次（README 中英已写迁移步骤）。**缓存零损失**——因为冻结项没跟改。
  - **冻结清单（改名时必须不动的标识，[判据：有持久化或跨侧契约 ⇒ 冻结]**）：
    | 标识 | 值 | 位置 |
    | --- | --- | --- |
    | 投影单元 key | `dsh-plugins.tokstats` | `lib/index.js` `TOKSTATS_KEY` |
    | 存储域名 | `dsh_plugins_tokstats` / `dsh_plugins_promptopt` | `lib/index.js`（`UNIT_NAME_RE` 不允许点号） |
    | RPC 通道名 | `/dsh-plugins.tokstats` / `/dsh-plugins.promptopt` | `lib/client.js` + `lib/index.js` 两侧契约 |
  - **guard 是这次的防线**：`PK-14` 以 `package.json` 的 `name` 为唯一真源，派生校验 patch 行 `name`、`client.js` 的 `__ModuleLoader__.load({id})`、`ns` 前缀、`data-plugin-css` 前缀。改名时**先补 guard 再动名字**——漏改 `id:` 的形态是「插件 UI 整个消失而 guard 与测试全绿」（ASSESS §3.5 实测）。
  - 早先写的「爆炸半径是 10 个文件」是**代码文件口径**、且描述的是**文本散布面**（`dsh[-_]plugins` 共 144 处 / 16 个文件，含 6 个文档），不是改动面。**不要再用「文件数」当成本代理。**
- **`engines.dsh` 写精确版本，不写区间**。宿主 `evaluatePluginCompatibility` 的判定是：**有 `engines.dsh` 时它单独决定、忽略 `peerDependencies`**；不满足就整包跳过（`loadProfileDirectory` 把它记进 `skippedBundles`，**不打印任何东西**）。写一条没实测过的区间等于替未知版本放行，而 rc 阶段官方保留破坏权。当前 pin 是 `0.2.1-rc.3`；升级宿主后按下面「升级宿主后的三步重验」跑完，再抬 pin 并同步本文件「开发所对版本」。当前实测版本见 `package.json` 的 `engines.dsh`（README 面向使用者，只说明「版本不匹配时插件会静默消失」，不再维护版本表）。
  - **升级宿主后的三步重验**（宿主契约一旦漂移，表现是插件静默不工作而不是报错，三步缺一不可）：① `node scripts/check-plugin-structure.js` → 输出含 `OK:` 且零 `WARN`（PK-01 / PK-02 / PK-03 / PK-05 / PK-07 / PK-08 / PK-11 / PK-12 全在这里）；② `npm test` → 0 fail（投影单元形状、RPC 信封、词典键集、降级矩阵）；③ 重启 dsh web → 刷新 → 逐个插件目检（这一步只有人能做，前两步都不覆盖「slot 注册了但界面没渲染」）。前两步是秒级的，能省掉绝大多数重启；三步都过了才抬 pin。
  - **这条 pin 已经真实咬过高版本一次（v0.7.0 → 0.7.1 的起因）**：宿主 nightly 升到 `0.2.1-rc.3` 后，`engines.dsh` 仍钉 `0.2.1-rc.2`，`dsh plugin --profile web list` 只给一句 `is incompatible with dsh 0.2.1-rc.3` 的告警，而**运行期宿主启动时一行日志都没有**——三个插件的 UI 整块消失，用户看到的是「插件失效了」。排查顺序因此固定为：① 先跑 `dsh plugin --profile <p> list` 看有没有 incompatible 告警（这是唯一会说话的入口）；② 再比宿主版本（`dsh-runtimes/*/runtime.json` 的 `desktopVersion` 会滞后于 asar 内的真实版本，**以 `@deepseek-ai/dsh-app-boot/package.json` 为准**，`getDshRuntimeVersion()` 读的就是它）。
  - **抬 pin 不是改一个字符串**：抬之前要按上面「升级宿主后的三步重验」（guard → `npm test` → 重启目检三插件），抬的时候 `engines.dsh` 与 `dsh.compatibility.dshReleases` **一起改**。漏改后者已由 guard 的 **PK-15** 拦下（反向验证：pin 写 rc.4 / 删掉 engines / 写成区间三种形态均变红）。
  - `dsh.compatibility.dshReleases` 是**描述性**元数据（**无任何自动化消费方，仅人读**），只列实测过的版本。实测依据（2026-10-24 复核，宿主 `0.2.1-rc.3`）：asar 内 7131 个 `.js` 条目全文扫 `dshReleases` **0 命中**（另有 336 个 unpacked/无 offset 条目跳过）；官方 `dsh-plugin-market` 只从 registry 读 `engines.dsh`；第三方 `dshmarket@1.66.45` 同样 **0 命中**。它和 `engines.dsh` 必须表达同一事实，不能一个说兼容、另一个把整包挡掉。
- **`icon` 字段**：值是包内相对路径（绝对路径与 `file:` 之类的 scheme 会被宿主拒绝），宿主按 SVG/PNG/JPEG/WebP 读成 data URL 内联，**上限 256 KiB**，且必须留在 manifest 所在目录内。当前 `icon.svg` 与侧栏图标同一造型、单色 `currentColor`。`files` 必须含它，否则 git 安装后读不到（宿主此时只回一条 `meta.error`，界面表现为没图标）。
  - 另有一份**同造型的位图** `docs/assets/icon-180.png`（180×180 RGBA，品牌色 `#4D6BFE` 写死）：社区目录只接受 GitHub 托管的**位图**（SVG 与第三方图床会被拒），它只服务目录卡片，宿主侧仍然读 `icon.svg`。生成方式是无头 Edge 渲染——原 SVG 的 `currentColor` 单独渲染时无继承色会变黑，必须替换成品牌色再截图；宿主侧的 `currentColor` 不用改。

### 展示元数据与运行时词典是两层（不要合并）

插件页的标题/描述**不来自** `lib/client.js` 的 `LOCALE_NS_*` + `dicts`——那是运行时界面文案。宿主读的是**包级** `locale/{en,zh}.json`，链路有**四道门**（`dsh-app-boot` 的 `readPluginMeta`，`0.2.1-rc.3` 下 L2217）：

```
barePackageName(specifier)                        ← 必须是裸包名
  ↓ optionalResourcePath(`${spec}/locale/en.json`)  ← ① exports 必须放行 "./locale/*.json"
  ↓ dictionariesOf(dirname(en.json))                ← ② 语言文件同目录、文件名必须是语言 id
  ↓ localizedText("title" / "description")          ← ③ 只读 meta.title / meta.description
                                                      ④ files 必须含 "locale"（打包丢失）
```

四道门**缺任何一道都不报错**：宿主把字典当成空、`localizedText` 回退到 `package.json.name`，插件页就显示原始包名 `dsh-plugins`；而 `npm test` 依然全绿。所以这条由 guard 的 **PK-13** 静态兜住（文件与 `meta` 结构 / 语言 id 文件名 / `exports` 键 / `files` 项），**缺 `meta` 外壳**（写成 `{"title":…}`）也在拦截范围内——那种形态 JSON 完全合法，正是最容易「顺手简化」掉的一层。

维护要点：

- **宿主没有「按行」的显示名通道，一个包只能有一个标题——三行同名是设计上限，不是 bug**（2026-10-24 逐条复核，勿再当缺陷排查）：
  - 标题只有一个来源：`readPluginMeta` 全 asar 仅**一处**调用（`dsh-app-boot/lib/index.js` 的 `metaOf` → `readPluginMeta`），入参是**包名**；
  - 行 meta 也按包名取：`dsh-plugin-manager/lib/index.js` 的 `declaredRows` 里 `const meta = packages?.metaOf(row.name, base)`——`row.name` 是本行配置的模块名，即裸包名；
  - 客户端行标题只读 `row.meta.title`（`dsh-client-ui-plugin-manager/lib/client.js` 的 `rowText`），**不存在** `row.label` / `row.title` 字段；
  - 所以三行共用一份 `locale/zh.json`。要按行区分，只能拆成三个独立包（各自一个 `package.json`），代价是三条发布线 + 冻结项（投影 key / RPC 通道 / 存储域名）迁移，本包**不做**。
  - **千万不要为此把行 `name` 改成子路径**（如 `dsh-tokstats/tokprev`）来蹭 `<specifier>/locale/en.json`：`client-modules` 的 `exactPackageSpecifier` 明确拒绝含 `/` 的标识符（`!specifier.includes("/")`），`locatePkgJson` 随即返回 `undefined`，该行**不进入 client 图 → 插件 UI 整块消失**。这正是 AGENTS.md 硬规则 1 的实物证据，guard L71 会直接拦。
- **只放 `meta.title` / `meta.description` 两个键**，别加 `meta.icon` 之类——`readPluginMeta` 不读它们，加了是死字段（guard 会给 WARN）。
- **`meta.description` 与 `package.json.description` 是两回事**：前者是插件页/市场卡片上的一句人读简介（两个语言各一份），后者是 npm 元数据里的中文长句。宿主对包卡片用的是**前者**（`readPluginMeta`），`listBundles` 另有独立的 `description` 字段取自**后者**——两边措辞不必一致，也不必同步改。
- **改完必须目检**：静态项只能证明「结构对」，证明不了「宿主真的加载了新元数据」。重启宿主（desktop profile 由 Electron 独占，要退出应用重开，不是关窗口）→ 设置 → 插件 → 看「已安装插件」卡片的标题与描述；切英文应变成 `locale/en.json` 的内容。`npm test` 与 guard 都覆盖不到这一步。
- **`files` 只能用 `npm pack --dry-run --json` 验**：本机 `link:` 安装是 junction 直通仓库，`files` 白名单根本不生效，link 下永远看不出丢文件。


### 市场卡片（dsh-market / awesome-dsh-plugin）的三处数据源

卡片不是宿主画的，是市场按目录数据渲染的。想改卡上什么，就去改对应的源：

| 卡上元素 | 数据源 | 生效路径 |
| --- | --- | --- |
| 简介文案 | 目录仓库 `awesome-dsh-plugin/awesome-dsh-plugin` 的 `data/plugins/PlusQi__dsh-tokstats.yml` 的 `description.{en,zh}`（**手写字段**） | 提 PR 精确替换，合并后站点重建即换 |
| 截图顺序与内容 | 本仓库 `screenshots.json`（1–8 张相对路径；目录 nightly 构建重读，raw HEAD 直出） | **推仓库即生效，不用 PR**；不声明则市场退回抽 README 图 |
| 图标 | 条目 YAML 的 `icon:` 指向包内 `docs/assets/icon-180.png`（只收 GitHub 托管位图，约 96px 方形显示） | 换文件即生效 |
| 「宿主要求未知」chip | 市场读目录条目的 engines 信息，而条目 schema 没有该字段——`package.json` 的 `engines.dsh` 不会被采集 | 仓库侧无解；发 npm（registry manifest 天然带 engines）或找目录维护者 |

- 收录事实（2026-10-25 核验）：条目 `PlusQi/dsh-tokstats`，`added 2026-10-23`，category `usage`，安装命令 `github:PlusQi/dsh-tokstats`（未固定 ref，默认分支最新）。另一家目录 dshpluginhub.ai 的收录停留在旧名 `dsh-plugins` + pre-rename commit，**勿以它为准**。
- 截图序按「卡片可读性」排：宽幅在前（tokprev / promptopt / hero），近方形全图垫底——卡片首屏只展示前两张。
- 内容多的面板可用「总览 + 详情」两张刻意图覆盖全部卡片（当前 `tokstats-hero` + `tokstats-detail`）：单图塞全会退回竖比例、卡片里照样糊；裁切带落在**行边界**上，读作滚动中的面板而非残缺；无卡头的续行（如 detail 顶部的模型排行剩余行）只服务市场卡片，不要单独进 README。
- 可选大招（未做）：打 GitHub Release 预构建 tarball + 条目加 `tarball:` 字段，市场优先展示它、免 `allowBuilds` 警告；发 npm 则连 engines chip 一起解掉。两者都动「不发 registry」的既定发布线，需维护者裁决。

## 维护须知

- **无构建步骤**：`lib/client.js` 即最终产物（纯 JS，不用 TS/JSX，React 经 ModuleLoader 注入）。改动 = 编辑 + 重启。`lib/index.js`（host 半边）同为纯 JS：只 import `node:` 内建（fs/os/path），不引 npm 运行时依赖。
- **兼容面**：tokprev 依赖 UI slot `conversation.composer.dock` 与投影字段 `contextPressure`；tokstats 依赖 `main` + `sidebar.panellist` slot、`ctx.sessionProjections`、`ctx.sessionQuery` 与 `ctx.sessionProjectionCache`；promptopt 依赖 `conversation.input.right` slot、`InputActions.setDraft`、`ctx.connection.rpc.call`、`ctx.connection.rpc.handle`、`ctx.llm` 与 `ctx.storageDomain`（明细见上节）。界面文案另依赖客户端服务 `ctx.locale`（注册词典 + slot 注册声明 `locale` 命名空间取得 `t` 席位）——它是硬依赖，缺席时整包不加载。DSH 升级后若插件消失，先对照这些契约。所有读取路径均带优雅降级（拿不到数据渲染 null，不会报错）。
- **开发所对版本**：DSH `@deepseek-ai/dsh 0.2.1-rc.3`（`package.json` 的 `engines.dsh` 钉的就是它；宿主版本号从 `@deepseek-ai/dsh-app-boot/package.json` 读——注意 `dsh-runtimes/*/runtime.json` 的 `desktopVersion` 在 rc.3 上**仍是 rc.2**，它是运行时包清单里的值，不跟随后续 nightly 升级，别拿它当宿主版本）。host 侧是**一次性压多个深契约**（`InputActions` / `connection.rpc` / `llm.stream` / `sessionProjections` / `sessionQuery` / `sessionProjectionCache` / `storageDomain`），且 rc 阶段官方保留破坏权——升级后优先重验：RPC 信封形状（成功必须是 `{ ok: true, value }`，错误码取自宿主闭集）、`GenerateOptions` 的 `provider` / `model` 是否仍必填、`connection.rpc.handle` 的签名（**0.2.1-rc.2 起只有两参，旧的 `options.authority` 已不存在**）、投影单元的 `init(header, inheritedEventCount)` 与 `wire` 读取面、`sessionQuery` 的 `listSessions` / `readSession` 返回形状、`storageDomain.open()` 是否仍接受手写 spec。
  - `0.2.1-rc.3` 的复核结论（2026-10-24，asar 源码逐条对读，**七条全部成立**）：`rpc.handle` 仍两参（`dsh-client-connection/lib/index.js`）、`sessionProjections` 单元字段集与 `snapshot` / `cachedSnapshot` 公开面不变、`sessionPersistence.stat` 仍返回 `revision`、`storageDomain.open(spec)` 仍接受手写 spec、`GenerateOptions.provider` / `model` 仍必填、`conversation.composer.dock` / `conversation.input.right` / `main` / `sidebar.panellist` 四条 slot 全在。**rc.3 上未改一行 lib/ 代码即可运行**，本版只抬 pin。
- **开发循环**：先用动态 Cordis 插件（`cordis_define` -> `cordis_run`）在会话内热迭代原型，满意后落入本包。
- **单插件开关的真实语义**：`disabled: true` 只摘除该行的 **host 侧** fiber，浏览器侧 bundle 是否加载取决于**包内是否还有任一行存活**（DSH 的 boot graph 按包名判活，客户端每包一个 fiber、无条件注册全部插件）。对 tokstats 这类 host 半边有实际工作的插件，禁用行即停掉聚合器与统计（客户端按钮还在但无数据）；对 tokprev 这类纯 UI 插件，禁用一行**不会**移除其浏览器 UI（tokstats 行会让整个 bundle 存活）。需要按插件独立开关，请把该插件独立成包（见「新增插件」末尾）。
