window.__ModuleLoader__.load({
	id: "dsh-tokstats",
	factory: (require) => {
		const react = require("react");

		// ── pack bootstrap ─────────────────────────────────────────────────────────
		// One pack = ONE client bundle: the client module graph is flat per package
		// (a bundle factory's require only knows module-table words, so the pack
		// cannot split into multiple files without a build step).
		// Server-side: cordis.patch.yml carries one row per pack plugin, each row
		// keeps name 'dsh-tokstats' and config.plugin dispatches to the right block.
		// Client-side: the boot manifest creates ONE entry per package with no
		// config, so the client apply registers ALL plugins' UI unconditionally.
		// Adding a plugin: one block below + one patch row (see docs/MAINTAINING.md).
		// Locale: each plugin owns one namespace `dsh-tokstats.<id>`, registered by
		// apply from the PLUGINS entry (zh is the key-set source of truth; the
		// language itself follows the host preference — Settings → General →
		// Language). `ctx.locale` is a hard dependency (as in every official UI
		// pack): when the host has no locale service, this bundle does not load
		// at all rather than showing half-translated copy.

		/** Per-plugin style tag: idempotent insert, fiber-scoped removal. */
		function ensurePluginStyles(pluginId, css) {
			if (typeof document === "undefined") return () => {};
			const selector = 'style[data-plugin-css="dsh-tokstats/' + pluginId + '"]';
			let tag = document.querySelector(selector);
			if (tag === null) {
				tag = document.createElement("style");
				tag.dataset.pluginCss = "dsh-tokstats/" + pluginId;
				tag.textContent = css;
				document.head.appendChild(tag);
			}
			return () => {
				if (tag !== null && tag.parentNode !== null) tag.parentNode.removeChild(tag);
			};
		}

		/**
		 * 复数键选择：英文有 one/other 两形，中文同形。词典里 one/other 必须成对
		 * 出现（键集一致性由测试断言，我们无 TS 可校验）。
		 */
		function tCount(t, base, count, params) {
			return t(count === 1 ? base + ".one" : base + ".other", { ...params, count });
		}

		// ── plugin: tokprev ────────────────────────────────────────────────────────
		//
		// 只保留官方结构上给不了的增量（SPEC §方案 3，Q8 = P1）：官方 ContextMeter 已
		// 给上下文绝对数与三段明细、TurnUsagePanel 给逐轮四桶与命中率，故本插件删掉
		// 「上下文基线 / 窗口占比 / 排队估算 / 每轮徽标」四项重复信息，只留：
		//   下一轮输入合计 · 草稿增量 · 输出预估区间
		// 投影依赖因此只剩 contextPressure（I10）；草稿用本地启发式（estimateText）。

		function fmtTok(n) {
			if (!Number.isFinite(n)) return "?";
			if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + "M";
			if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "K";
			return String(Math.round(n));
		}

		/** Same fixed-density heuristic as dsh-token-meter's estimate.ts (CHARS_PER_TOKEN 4, block overhead 4, role overhead 4). */
		function estimateText(text) {
			if (typeof text !== "string" || text.length === 0) return 0;
			return Math.ceil(text.length / 4) + 8;
		}

		function percentile(sorted, q) {
			const n = sorted.length;
			if (n === 0) return undefined;
			return sorted[Math.min(n - 1, Math.floor(q * (n - 1)))];
		}

		/** Per-turn output totals over completed turns, newest 5, oldest-to-newest. */
		function selectOutputHistory(s) {
			const nodes = s.nodes;
			const turnEnds = s.turnEnds;
			if (!Array.isArray(nodes) || !turnEnds) return [];
			const byTurn = new Map();
			for (const n of nodes) {
				if (n === null || n.kind !== "assistant" || n.usage === undefined) continue;
				if (!turnEnds.has(n.turn)) continue;
				const out = Number(n.usage.outputTokens);
				if (!Number.isFinite(out) || out <= 0) continue;
				byTurn.set(n.turn, (byTurn.get(n.turn) || 0) + out);
			}
			const turns = [];
			for (const t of byTurn.keys()) turns.push(t);
			turns.sort((a, b) => a - b);
			const recent = turns.slice(-5);
			const values = [];
			for (const t of recent) values.push(byTurn.get(t));
			return values;
		}

		/**
		 * 三点式预告行：`下一轮输入 ≈ N · 草稿 M · 输出预估 X–Y`。
		 *
		 * 只读 contextPressure 一个投影（I10）；不再读 contextBreakdown、不再排队估算
		 * （官方 ContextMeter 已给绝对数，重复显示反而是噪音）。
		 */
		function PredictionLine({ useSession, useProjection, useInput, t }) {
			const pressure = useProjection("contextPressure");
			const hist = useSession(selectOutputHistory);
			const running = useSession((s) => s.running);
			const draft = useInput((s) => s.draft) ?? "";

			if (running) return null;

			const draftTokens = estimateText(draft);
			const anchored = pressure !== undefined
				&& (Number.isFinite(pressure.projectedTokens) || Number.isFinite(pressure.pressureTokens));
			const base = anchored
				? (Number.isFinite(pressure.projectedTokens) ? pressure.projectedTokens : pressure.pressureTokens)
				: 0;
			const nextInput = base + draftTokens;

			const sorted = hist.slice().sort((a, b) => a - b);
			let outLabel = "-";
			if (sorted.length === 1) outLabel = "\u2248" + fmtTok(sorted[0]);
			else if (sorted.length > 1) {
				const lo = percentile(sorted, 0.25);
				const hi = percentile(sorted, 0.75);
				outLabel = fmtTok(lo) + "\u2013" + fmtTok(hi);
			}

			// "*" 是「无真实请求锚点」的记号，不是语言的一部分，留在模板外。
			const parts = [
				(anchored ? "" : "*") + t("line.next", { tokens: fmtTok(nextInput) }),
				t("line.draft", { tokens: fmtTok(draftTokens) }),
				t("line.output", { range: outLabel }),
			];
			const title = t(anchored ? "tip.anchored" : "tip.estimated");

			return react.createElement("div", { className: "dsh-tokprev-line", title: title },
				parts.map((p, i) => react.createElement("span", {
					key: String(i),
					className: i === 0 ? "" : "dsh-tokprev-dim"
				}, (i > 0 ? "\u00b7 " : "") + p))
			);
		}

		const tokprevCss = [
			".dsh-tokprev-line{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;white-space:nowrap;overflow:hidden;user-select:none}",
			".dsh-tokprev-dim{opacity:.55}"
		].join("\n");

		/**
		 * tokprev 词典（zh 为键集真源，en 必须逐键对应）。
		 * 术语：输入 in / 输出 out / 草稿 draft / 估算 est.。
		 *
		 * 英文文案刻意避开「提供商」这个词的英文形式——guard 的 I1 规则对整个
		 * client 产物做字面量扫描，保留文案里出现该词会让规则长期失效。
		 */
		const LOCALE_NS_TOKPREV = "dsh-tokstats.tokprev";

		const tokprevZh = {
			"line.next": "下一轮输入 ≈ {tokens}",
			"line.draft": "草稿 {tokens}",
			"line.output": "输出预估 {range}",
			"tip.anchored": "下一轮输入：锚定上次真实请求 + 草稿增量估算",
			"tip.estimated": "尚无真实请求锚点：仅按启发式估算（不含系统提示与工具定义）",
		};

		const tokprevEn = {
			"line.next": "Next input ≈ {tokens}",
			"line.draft": "Draft {tokens}",
			"line.output": "Est. output {range}",
			"tip.anchored": "Next input: anchored to the last real request plus the draft estimate",
			"tip.estimated": "No real request anchor yet: heuristic estimate only (system prompt and tool schemas excluded)",
		};

		/**
		 * tokprev registration body: conversation.composer.dock (list) —— 发送前的
		 * 三点式预告行。
		 *
		 * 不再注册 conversation.chat.assistant-actions（I9）：每轮真实消耗官方
		 * TurnUsagePanel 已经给了，重复实现只会与宿主口径漂移。
		 *
		 * 声明 locale 命名空间才会拿到 `t` 席位（renderer 对已声明命名空间的组件
		 * 要求 locale 服务存在——这就是 inject 里那条硬依赖）。
		 */
		function tokprevApply(ctx) {
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register(
				{ name: "conversation.composer.dock", id: "tok-preview", order: 20, locale: LOCALE_NS_TOKPREV },
				PredictionLine
			));
		}

		// ── plugin: tokstats ────────────────────────────────────────────────────────
		//
		// 形态（SPEC-v0.6.0 §方案 2，决策 Q13 = U1）：侧栏 panellist 列表项 + root
		// `main` keyed slot 全局面板。`sidebar.footer.action` 已被官方 cordis-panel
		// 占用（P11），全局面板的正路是 `main`。
		//
		// 数据通道：面板打开 / 切窗口 / 切工作区各向 host 发一次 RPC，返回已汇总的
		// 桶分布 + 周趋势 + 工作区分组。不做推送、不做轮询、不常驻订阅（Q3）——面板
		// 不需要实时跳动，浏览器侧也不再持有「全部会话 cells」（I1）。

		/** 主面板 id：panellist 的 id 与 `main` 的 key 必须一致（p0-b，否则 selectPanel 抛错）。 */
		const TOKSTATS_PANEL_ID = "tokstats";
		const TOKSTATS_CHANNEL = "/dsh-plugins.tokstats";
		const TOKSTATS_ENDPOINT = "summary";
		/** promptopt 计数器读数（跨插件观测面，AC-13）。 */
		const TOKSTATS_PROMPTOPT_ENDPOINT = "promptopt";

		/**
		 * 桶标签：对齐市面「按输入长度分档计费」的真实边界（见 host 侧
		 * `TOKSTATS_BUCKET_BOUNDS` 的口径说明与 TS-18）。是非语言记号（区间边界），
		 * 按 AGENTS 规则 7 不进词典；与 host 边界数组逐项对应，改一边必须改另一边。
		 *
		 * 最高桶是 `[512K,∞)`：1M 已是市面所有模型上下文窗口的最大值，单请求 prompt
		 * 结构上超不过它，再切 `[1M,∞)` 只是多一行永远为空的格子。
		 */
		const TOKSTATS_BUCKET_LABELS = ["[0,8K)", "[8K,32K)", "[32K,128K)", "[128K,256K)", "[256K,512K)", "[512K,∞)"];

		/**
		 * 时间窗口档位（按日期统计）：当日 / 近 7 天 / 本月 / 近 30 天 / 全部。
		 *
		 * `days` 是发给 host 的 rolling 天数（host 语义：`today - (days - 1)` 起算；
		 * 0 / 非正数 = 不设窗口）。`days: null` 表示**按当天日期折算**——「本月」就是
		 * 「当月 1 日到今天」，正好等于今天的日期数，因此不必给 host 增加一种新的
		 * 窗口口径，五档共用同一个 `windowDays` 入参（TS-20）。
		 *
		 * 档位按 id 而非天数寻址：两个档位的 `days` 可能随时间取到相同值（「本月」
		 * 在 7 号正好也是 7 天），用天数当选中态会让两个按钮同时高亮。
		 */
		const TOKSTATS_RANGES = [
			// 「当日」用 `days: 1` 表达，不需要新入参：host 的 windowStart 定义是
			// `today - (days - 1)`，取 1 正好落在今天，与其余四档共用同一条口径（TS-20）。
			{ id: "today", days: 1 },
			{ id: "days7", days: 7 },
			{ id: "month", days: null },
			{ id: "days30", days: 30 },
			{ id: "all", days: 0 },
		];

		/**
		 * 缺省档位：**当日**。
		 *
		 * 打开面板最先要答的问题是「今天用了多少」，不是「这周用了多少」——四张
		 * 指标卡与其余区块都跟着档位走（TS-30），所以缺省档位就是缺省口径。
		 *
		 * 代价是日柱图在当日档下只有一根柱（没有形状可言）：这一档由读者主动选择，
		 * 而「一根柱 + 顶上的数值」仍然如实回答问题；不因此特判隐藏柱图卡——隐藏会
		 * 让切换档位时整页重排，那比一根柱更难受。
		 *
		 * 不取「本月」：月初打开时窗口只有 1–2 天，KPI 与日柱都近乎空图，容易被读成
		 * 「统计坏了」。
		 */
		const TOKSTATS_DEFAULT_RANGE = "today";

		/**
		 * 每日柱状图的最大列数。
		 *
		 * 上限不是「为了好看」而是「还读得出来」的边界：列宽低于约 6px 时相邻柱
		 * 已经糊成一片。日卡片与热力图**并排**后只有约 330–450px 可用宽度（此前
		 * 独占整行 800–1200px），30 列约合每列 9–13px，正好还在「看得出是一根
		 * 柱」的范围内；更长的窗口按整日合并，30 天以内的窗口保持**逐日**分辨率。
		 */
		const TOKSTATS_DAILY_COLUMNS = 30;

		/**
		 * 日柱图窗口的**下限**（7 天，TS-33）。
		 *
		 * 图跟着档位走，但窗口再短也不少于 7 天：「当日」档只有一天，画一根柱没有形状，
		 * 而其它的档位（近 7 天 / 本月 / 近 30 天 / 全部）都有自己的跨度，照实画即可。
		 * 7 天以下借 `heatDaily`（固定 84 天）取最近 7 天，所以当日档也能看出走势。
		 */
		const TOKSTATS_CHART_MIN_DAYS = 7;

		/**
		 * 峰值柱顶部数值标签的列数上限（12 列）。
		 *
		 * 标签约 24px 宽，列宽 = 绘图区 ÷ 列数：半宽卡片里 12 列约 25–30px，还放得下；
		 * 30 列（近 30 天 / 本月档）只剩 8–10px，硬标会被相邻柱压成半个数字。此时
		 * 峰值数值在卡片头部的「峰值 …」里仍然可读。
		 */
		const TOKSTATS_PEAK_LABEL_MAX_COLUMNS = 12;

		/**
		 * 热力图窗口：固定 12 周 = 84 天（SPEC D2）。
		 *
		 * **不得跟档位走**：热力图承担「稳定时间轴」职责，宽度随窗口跳变会让读者
		 * 失去跨档位的位置感（SPEC P-3）。与 host 侧的 `TOKSTATS_HEATMAP_DAYS`
		 * 必须逐值一致——两个模块图没有共享常量文件，改一边必须改另一边。
		 *
		 * 为什么是 84 而不是 371（53 周）：默认折叠窗口 90 天下折叠区起点在
		 * 「今天 − 89」，84 天窗口完全落在它之外，一格都不撞（SPEC D2）。
		 */
		const TOKSTATS_HEATMAP_DAYS = 84;

		/**
		 * 热力图的自然周列数（84 / 7）。
		 *
		 * 列 = 自然周（周一为起点，与 host 的 `tokstatsWeekStartOf` 同口径），
		 * 行 = 周内第几天（0 = 周一在最上）。两张时间图都按自然周，读者不会看到
		 * 「热力图的周三与趋势表的周三不是同一天」。
		 */
		const TOKSTATS_HEAT_WEEKS = TOKSTATS_HEATMAP_DAYS / 7;

		/**
		 * 后台校验未完成时的重拉间隔（毫秒，TS-24）。
		 *
		 * host 首帧秒开、把滞后会话的冷读排进后台；本面板据此按此间隔自动重拉，
		 * 直到 `verifying` 消失。取 1500：本机 70 会话后台校验约 4–5 s 收敛，
		 * 1.5 s 的粒度让「变成准确值」的观感是「几秒后自己刷新」，同时不会把
		 * 面板刷成轮询器（最坏情况 3–4 次请求）。
		 */
		const TOKSTATS_VERIFY_RETRY_MS = 1500;

		/**
		 * 后台自动重拉的最小间隔（毫秒，TS-25）。
		 *
		 * 与 `TOKSTATS_VERIFY_RETRY_MS` 分开：那个是「多久后重拉一次」，这个是
		 * 「两次后台重拉之间至少隔多久」。分开的原因是**后台重拉不能刷屏**——
		 * TS-25 修的正是「面板整块被换成『统计中…』再挂回来」的高频闪烁，
		 * 1.5 s 一次、连续 3–4 轮时用户根本来不及看清任何一帧数据。
		 *
		 * 取 3000：后台校验本机实测 4–5 s 收敛，3 s 的间隔让重拉次数从 3–4 次
		 * 降到 1–2 次，同时「数字几秒后自己变准」的观感不变（页脚的「校验中…」
		 * 全程在场，读者始终知道「这是过渡态，不是终值」）。
		 */
		const TOKSTATS_VERIFY_BACKOFF_MS = 3000;

		/**
		 * 固定 24 小时制时钟。不跟浏览器 locale：`t` 席位只给翻译函数、不给当前
		 * 语言 id，用 toLocaleTimeString 会与 dsh 的语言偏好打架（中文界面配英文
		 * 浏览器会显示英文时间格式）。
		 */
		function tokstatsClock(ts) {
			const d = new Date(ts);
			const pad = (v) => String(v).padStart(2, "0");
			return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
		}

		/** 周粒度标签：在本机时区把周起点日键格式化成 M/D。 */
		function tokstatsDayLabel(day) {
			const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
			if (m === null) return day;
			return String(Number(m[2])) + "/" + String(Number(m[3]));
		}

		/**
		 * 惰性取 connection 服务。
		 *
		 * 刻意不放进 inject：inject 是「齐备才加载」的硬依赖，connection 一旦缺席
		 * 会连带 tokprev / promptopt 一起不加载。用 ctx.get 惰性取则只有 tokstats
		 * 降级成空态（硬规则 6）。
		 */
		function tokstatsConnection(ctx) {
			if (ctx === null || ctx === undefined || typeof ctx.get !== "function") return undefined;
			try {
				return ctx.get("connection");
			} catch {
				return undefined;
			}
		}

		/**
		 * 一次汇总请求；connection 缺席或传输失败都返回 undefined（调用方转空态）。
		 */
		async function tokstatsRpc(ctx, endpoint, request, signal) {
			const rpc = tokstatsConnection(ctx)?.rpc;
			if (rpc === undefined || rpc === null || typeof rpc.call !== "function") return undefined;
			try {
				const response = await rpc.call(TOKSTATS_CHANNEL, endpoint, request, signal);
				if (response === undefined || response === null) return undefined;
				if (response.ok === true) return response.value;
				return null;
			} catch {
				return null;
			}
		}

		const tokstatsFetchSummary = (ctx, request, signal) => tokstatsRpc(ctx, TOKSTATS_ENDPOINT, request, signal);
		/** promptopt 计数器（AC-13）；不可用时返回 null，面板隐藏该区块。 */
		const tokstatsFetchPromptopt = (ctx, signal) => tokstatsRpc(ctx, TOKSTATS_PROMPTOPT_ENDPOINT, {}, signal);

		/** 侧栏列表项图标（自绘 inline SVG：三柱直方 + 基线，宿主无图标库约定）。 */
		function TokstatsIcon({ size }) {
			return react.createElement("svg", {
				width: size, height: size, viewBox: "0 0 16 16", fill: "none",
				"aria-hidden": "true", style: { display: "block" }
			},
				react.createElement("path", {
					d: "M2.5 13.5h11M4 11V7.5M7.5 11V3.5M11 11V6",
					stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", fill: "none"
				}));
		}

		/**
		 * 面板上「输入」的唯一口径 = 输入 + 缓存读 + 缓存写（与 host 侧落桶口径一致）。
		 *
		 * 所有显示「输入」的地方都必须过这个函数（TS-17）：实测缓存读占输入的
		 * 97–99%，只显示 `in` 会让排行/趋势与 KPI 卡差 1–2 个数量级。三列分开存
		 * 是对的（命中率 `cr / billed` 与对账都需要原始桶），只是显示要合计。
		 */
		function tokstatsBilled(cell) {
			return (cell?.in ?? 0) + (cell?.cr ?? 0) + (cell?.cw ?? 0);
		}

		/** 缓存命中率（整数百分比）；计费输入为 0 时按 0 计。 */
		function tokstatsHit(cell) {
			const billed = tokstatsBilled(cell);
			if (billed <= 0) return 0;
			return Math.round(((cell?.cr ?? 0) / billed) * 100);
		}

		/**
		 * 占比（百分比文本，自适应精度）——只用于 KPI 副值这类「比值口径」。
		 *
		 * 精度按量级自适应：输出占计费输入实测只有 0.1% 量级，固定一位小数会
		 * 全部显示成 `0.0%`（看起来像假零）。分母为 0 时返回 null，由调用方
		 * 决定「不渲染副值」而不是编一个 0%（那个比值在数学上无定义）。
		 */
		function tokstatsPct(part, whole) {
			const p = Number.isFinite(part) ? part : 0;
			if (!Number.isFinite(whole) || whole <= 0) return null;
			const pct = (p / whole) * 100;
			if (pct >= 10) return String(Math.round(pct));
			if (pct >= 1) return pct.toFixed(1);
			return pct.toFixed(2);
		}

		/** 日键（浏览器本地自然日）——只用于把日序列摆到时间轴上。 */
		function tokstatsDayKeyLocal(ts) {
			const d = new Date(ts);
			const pad = (v) => String(v).padStart(2, "0");
			return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
		}

		/** 日键减一天（UTC 解析，不随宿主时区漂移）——与 host 的 `tokstatsDayBefore` 同口径。 */
		function tokstatsDayBeforeLocal(day) {
			const d = new Date(day + "T00:00:00Z");
			if (!Number.isFinite(d.getTime())) return null;
			d.setUTCDate(d.getUTCDate() - 1);
			return d.toISOString().slice(0, 10);
		}

		/** 日键 → 毫秒（UTC 解析，只用来算天数差，与 host 侧 windowStart 同口径）。 */
		function tokstatsDayMs(day) {
			return Date.parse(day + "T00:00:00Z");
		}

		/**
		 * 档位 → 发给 host 的 `windowDays`（`0` = 全部）。
		 *
		 * 固定天数档直接返回；`days: null` 的档位（「本月」）按**浏览器本地自然日**
		 * 折算成「今天是几号」——host 侧 `tokstatsWindowStart` 的定义是
		 * `today - (windowDays - 1)`，取当天日期数代入即得当月 1 日。
		 *
		 * 这里按浏览器本地日期而非 host 日期算：跨时区的理论上限是一天偏差，而
		 * 本面板是单机自用工具（host 与浏览器同机同时区），没必要为它引入时区协商。
		 */
		function tokstatsRangeDays(range, ts) {
			if (range === undefined || range === null) return 0;
			if (typeof range.days === "number") return range.days;
			const d = new Date(Number.isFinite(ts) ? ts : Date.now());
			return d.getDate();
		}

		/**
		 * 每日序列 → 图表列（最多 24 列）。
		 *
		 * 逐日一根柱在「90 天窗口 + 稀疏活跃日」下会退化成一排 2px 的零柱，所以按
		 * 需要的跨度合并相邻若干天成一列；列标题仍给精确数字（合并列给区间）。
		 *
		 * 起点取 `windowStart` 与**首个有数据的日**的较大者：实测本机只有两个活跃
		 * 周，从窗口下界画起会让左侧 1/3 全是空柱，看起来像「图表没加载」。
		 * 末列右端钳到今天，否则合并列会越过当天（轴上出现未来日期）。
		 *
		 * 四桶必须逐列累加：`in` 只是未缓存部分，缓存读/写占了实测输入的 97–99%，
		 * 只累加 `in` 会让日柱 tooltip 与其他卡片的「输入」差两个数量级（TS-17）。
		 *
		 * @returns `{ startDay, endDay, calls, in, cr, cw, out }[]`，按时间升序。
		 */
		function tokstatsDailyColumns(daily, windowStart, generatedAt) {
			const DAY = 86400000;
			const rows = Array.isArray(daily) ? daily : [];
			// 没有日序列就不画图：补一串零柱会让「无数据」看起来像「有数据但为零」。
			if (rows.length === 0) return [];
			const today = tokstatsDayKeyLocal(Number.isFinite(generatedAt) ? generatedAt : Date.now());
			const last = rows.length > 0 && rows[rows.length - 1].day > today ? rows[rows.length - 1].day : today;
			const first = rows[0].day;
			const start = typeof windowStart === "string" && windowStart.length > 0 && windowStart > first
				? windowStart
				: first;
			const startMs = tokstatsDayMs(start);
			const lastMs = tokstatsDayMs(last);
			if (!Number.isFinite(startMs) || !Number.isFinite(lastMs) || startMs > lastMs) return [];
			const totalDays = Math.round((lastMs - startMs) / DAY) + 1;
			const span = Math.max(1, Math.ceil(totalDays / TOKSTATS_DAILY_COLUMNS));
			const count = Math.ceil(totalDays / span);
			const columns = [];
			for (let i = 0; i < count; i += 1) {
				const colStart = startMs + i * span * DAY;
				const colEnd = Math.min(colStart + (span - 1) * DAY, lastMs);
				columns.push({
					startDay: new Date(colStart).toISOString().slice(0, 10),
					endDay: new Date(colEnd).toISOString().slice(0, 10),
					calls: 0, in: 0, cr: 0, cw: 0, out: 0,
				});
			}
			for (const row of rows) {
				const offset = Math.round((tokstatsDayMs(row.day) - startMs) / DAY);
				if (!Number.isFinite(offset) || offset < 0) continue;
				const col = columns[Math.floor(offset / span)];
				if (col === undefined) continue;
				col.calls += row.calls ?? 0;
				col.in += row.in ?? 0;
				col.cr += row.cr ?? 0;
				col.cw += row.cw ?? 0;
				col.out += row.out ?? 0;
			}
			return columns;
		}

		/**
		 * 色阶档位（0–5）：与柱图**同构**的平方根映射（SPEC D7 / TS-28）。
		 *
		 * 位置 = `sqrt(calls / peak)`，与 TS-23 已钉死的柱高公式完全相同——两张图对
		 * 同一天给出同一视觉强度，不会出现「热力图很深但柱子不高」。
		 *
		 * 为什么必须用 sqrt 而不是线性：本机实测极差 71 倍（34 → 2430 次），线性
		 * 归一下 6/11 个活跃日全落在最浅档（1.4%–9.4%），五档色阶实际只剩三档。
		 * sqrt 后散开到 12%–31%，正好铺满前两档（SPEC §1 的 P-6）。
		 *
		 * 返回 **0 表示「无数据」**（零调用），由调用方渲染成无填充——它**不是**最浅
		 * 档。零日画最浅实心格会让「那天没用量」与「那天用了很少」视觉上几乎无差
		 * （SPEC D9：本机 84 天里 73 天为零）。
		 *
		 * @returns 0（无数据）/ 1–5（对应 opacity 20% / 40% / 60% / 80% / 100%）。
		 */
		function tokstatsHeatLevel(calls, peak) {
			if (!Number.isFinite(calls) || calls <= 0) return 0;
			if (!Number.isFinite(peak) || peak <= 0) return 0;
			const ratio = Math.sqrt(calls / peak);
			if (ratio >= 0.8) return 5;
			if (ratio >= 0.6) return 4;
			if (ratio >= 0.4) return 3;
			if (ratio >= 0.2) return 2;
			return 1;
		}

		/**
		 * 84 天逐日序列 → 12 列 × 7 行网格（周一在最上）。
		 *
		 * 列 = 自然周（与 host 的 `tokstatsWeekStartOf` 同口径：周一为周起点），
		 * 行 = 周内第几天（0 = 周一 … 6 = 周日）。
		 *
		 * **末列可能不满 7 格**：今天所在的周还没过完，未来日期渲染成 `null` 而不是
		 * 零格——渲染成零会被读成「那天没用量」，而它其实还没到（PLAN §3.2.2）。
		 *
		 * **折叠区判定在 client 侧**（SPEC 裁决 D）：`heatDaily` 只含真实逐日明细，
		 * 已折叠区间内的天**不以任何形式出现在数组里**。所以「数组里没有」= 「没有
		 * 逐日数据」，而它可能有两种含义（那天没用量 / 那天被折叠了），必须靠
		 * `epoch.start` / `epoch.end` 区分——否则折叠区会被渲染成「无记录」，那是
		 * 谎报（那天有量，只是被归并进区间了，AC-9）。
		 *
		 * @returns `{ weeks: [{ weekStart, cells: [cell|null × 7] }] }`，cells 长度恒 7。
		 */
		function tokstatsHeatGrid(heatDaily, today, epoch) {
			const rows = Array.isArray(heatDaily) ? heatDaily : [];
			// 没有逐日序列就不画图：补一串空格会让「无数据」看起来像「有数据但为零」。
			if (rows.length === 0) return { weeks: [] };
			const byDay = new Map();
			for (const row of rows) {
				if (row !== null && typeof row === "object" && typeof row.day === "string") byDay.set(row.day, row);
			}
			// 折叠区间 [start, end)：半开，end 当天不属于折叠区（与 host 读取期排除同口径）。
			const epochStart = epoch !== null && typeof epoch.start === "string" ? epoch.start : null;
			const epochEnd = epoch !== null && typeof epoch.end === "string" ? epoch.end : null;
			const hasEpoch = epochStart !== null && epochEnd !== null && epochStart < epochEnd;
			const todayKey = typeof today === "string" && today.length > 0 ? today : null;
			// 末列右端：序列最后一天与今天的较大者（跨零点时序列可能停在昨天）。
			const lastDay = rows.reduce((max, row) => (typeof row.day === "string" && row.day > max ? row.day : max), "");
			const endDay = todayKey !== null && todayKey > lastDay ? todayKey : lastDay;
			if (endDay === "") return { weeks: [] };
			// 起点：末列往回 12 个自然周。用自然周的周一对齐，列才是真正的自然周
			// （否则第一列会是一个半周，读者会把它当成完整一周读）。
			const endMs = tokstatsDayMs(endDay);
			if (!Number.isFinite(endMs)) return { weeks: [] };
			const endWeekStart = tokstatsDayMs(tokstatsWeekStartLocal(new Date(endMs).toISOString().slice(0, 10)));
			const firstWeekStartMs = endWeekStart - (TOKSTATS_HEAT_WEEKS - 1) * 7 * 86400000;
			const weeks = [];
			for (let w = 0; w < TOKSTATS_HEAT_WEEKS; w += 1) {
				const weekStartMs = firstWeekStartMs + w * 7 * 86400000;
				const weekStart = new Date(weekStartMs).toISOString().slice(0, 10);
				const cells = [];
				for (let r = 0; r < 7; r += 1) {
					const dayKey = new Date(weekStartMs + r * 86400000).toISOString().slice(0, 10);
					// 未来日期不渲染格子（不是零格）：今天之后的天还没到。
					if (todayKey !== null && dayKey > todayKey) {
						cells.push(null);
						continue;
					}
					const row = byDay.get(dayKey);
					const calls = row !== undefined && Number.isFinite(row.calls) ? row.calls : 0;
					const folded = hasEpoch && dayKey >= epochStart && dayKey < epochEnd;
					cells.push({
						day: dayKey,
						calls,
						folded,
						// `hasRecord` 区分「有逐日明细」与「数组里没有这一天」——后者可能是
						// 零用量，也可能是被折叠（见上面的说明）。
						hasRecord: row !== undefined,
						row,
					});
				}
				weeks.push({ weekStart, cells });
			}
			return { weeks };
		}

		/** 日键加减天数（UTC 解析，不随宿主时区漂移）。非法输入返回 null。 */
		function tokstatsDayShiftLocal(day, delta) {
			const d = new Date(day + "T00:00:00Z");
			if (!Number.isFinite(d.getTime()) || !Number.isInteger(delta)) return null;
			d.setUTCDate(d.getUTCDate() + delta);
			return d.toISOString().slice(0, 10);
		}

		/** 自然周起点（周一）的日键——与 host 的 `tokstatsWeekStartOf` 同一条式子。 */
		function tokstatsWeekStartLocal(day) {
			const d = new Date(day + "T00:00:00Z");
			if (!Number.isFinite(d.getTime())) return day;
			d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
			return d.toISOString().slice(0, 10);
		}

		/**
		 * 一张 KPI 卡（标签 / 主值 / 副值）。
		 *
		 * 主值与副值各带一个 `title`：24px 的七位数字与中文副值在 160px 卡宽里
		 * 都可能走省略号，而**被截断的数字比被截断的标签更难发现**——读者会
		 * 把「7,80…」当成完整值。原生 tooltip 是省略态下成本最低的完整值入口
		 * （SPEC §5.4）。标签不挂 title：它始终完整可见，多一个悬停提示只是噪音。
		 */
		function TokstatsKpi({ label, value, hint }) {
			return react.createElement("div", { className: "dsh-tokstats-kpi" },
				react.createElement("span", { className: "dsh-tokstats-kpiLabel" }, label),
				react.createElement("span", { className: "dsh-tokstats-kpiValue", title: value }, value),
				react.createElement("span", { className: "dsh-tokstats-kpiHint", title: hint }, hint));
		}

		/**
		 * 卡片外壳。
		 *
		 * `note` 是**这张卡自己的时间跨度**（「近 7 天」/「12 周」），`extra` 是卡片内的
		 * 结论（「峰值 …」）。两者分开传，是因为它们回答两个不同的问题：note 说
		 * 「覆盖了多久」，extra 说「算出了什么」。
		 *
		 * **没有副标题（cardmeta）**：样稿的每张卡是「标题 + 灰色副标题」，本面板
		 * 试过照搬，结果全是复述——标题已写「上下文长度分布（按计费输入）」，
		 * 再补一行「按计费输入分桶」；卡片里已有「发起 / 采纳 / 放弃」三行，
		 * 再补一行「发起 / 采纳 / 弃用」。样稿需要副标题，是因为它的卡内没有这些
		 * 标签与说明；本面板已经有了，再加一行只是把同一句话说两遍。
		 * 真需要解释的口径（平方根刻度、键盘操作）挂在 tooltip / aria 上，
		 * 不占版面。
		 */
		/**
		 * 页脚状态徽标：**颜色 + 圆点 + 文字**三重表达（SPEC §7：状态不能用颜色单独编码）。
		 *
		 * `state` 四种取值：
		 * - `done`      数据就绪且后台校验已结束 → 成功色
		 * - `verifying` 这一帧是缓存值、滞后会话仍在后台冷读 → 警告色 + 圆点脉冲
		 * - `failed`    拿不到数据（服务不可用）→ 错误色
		 * - `null`      首屏加载中，页脚不表态（页头角标已写着「统计中…」）
		 *
		 * 颜色全部取宿主语义 token（`--dsw-alias-state-{success,warn,error}-primary`），
		 * 底色是同一 token 混入 12% —— 与宿主自己的徽标写法一致，换主题不用改代码，
		 * 也不会出现「面板的绿和别处的绿不是同一个绿」。
		 */
		function TokstatsStatusChip({ state, t }) {
			if (state === null) return null;
			const label = t("status." + state);
			return react.createElement("span", {
				className: "dsh-tokstats-status dsh-tokstats-status-" + state,
				title: label,
			},
				// 圆点：颜色之外的第二重线索。校验中的圆点会脉冲（减少动效时静止）。
				react.createElement("i", { className: "dsh-tokstats-statusDot", "aria-hidden": "true" }),
				label);
		}

		/**
		 * 首屏骨架：**与成品同布局**（四张 KPI + 两张时间图），只把内容换成灰块。
		 *
		 * 为什么需要：加载态原来是一行「统计中…」，加载完整页铺开——这就是样稿说的
		 * 「跳版」。骨架直接复用 `.kpiGrid` / `.pairGrid`，所以窄屏折叠行为与成品
		 * 完全一致，不会出现「骨架两列、成品一列」的二次跳变。
		 *
		 * 无障碍：灰块 `aria-hidden`，真话放在 `aria-busy` + 一段**只给屏幕阅读器**
		 * 的「统计中…」里——骨架不是内容，不该被逐个读出来。
		 */
		function TokstatsSkeleton({ t }) {
			const bar = (key, width) => react.createElement("i", {
				key, className: "dsh-tokstats-skBar", style: width === undefined ? undefined : { width },
			});
			return react.createElement("div", { className: "dsh-tokstats-skeleton", "aria-busy": "true" },
				react.createElement("span", { className: "dsh-tokstats-srOnly" }, t("state.pending")),
				react.createElement("div", { className: "dsh-tokstats-kpiGrid", "aria-hidden": "true" },
					[0, 1, 2, 3].map((i) => react.createElement("div", {
						key: i, className: "dsh-tokstats-skCard",
					},
						bar("label", "42%"),
						react.createElement("i", { key: "value", className: "dsh-tokstats-skNumber" }),
						bar("hint", "64%")))),
				react.createElement("div", { className: "dsh-tokstats-pairGrid", "aria-hidden": "true" },
					[0, 1].map((i) => react.createElement("div", {
						key: i, className: "dsh-tokstats-skCard dsh-tokstats-skChartCard",
					},
						bar("title", "34%"),
						react.createElement("div", { key: "bars", className: "dsh-tokstats-skBars" },
							[46, 62, 55, 78, 68, 88].map((h, j) => react.createElement("i", {
								key: j, style: { height: h + "%" },
							})))))));
		}

		function TokstatsCard({ title, extra, note, children }) {
			return react.createElement("section", { className: "dsh-tokstats-card" },
				react.createElement("div", { className: "dsh-tokstats-cardHead" },
					react.createElement("span", { className: "dsh-tokstats-cardTitle" }, title),
					extra === undefined && note === undefined
						? null
						: react.createElement("span", { className: "dsh-tokstats-cardExtra" },
							note === undefined ? null : note + " · ",
							extra)),
				children);
		}

		/**
		 * 一行「标签 · 比例条 · 数值 + 明细」——桶分布与工作区排行共用。
		 *
		 * 数值只放计数（短），四桶明细落到第二行：把 `输入 407M · 输出 971K · 命中
		 * 98%` 塞在同一行会把比例条挤成一小段，条长就失去可比性。
		 */
		function TokstatsMeter({ label, value, detail, ratio, title, dim }) {
			const width = Math.max(0, Math.min(100, (Number.isFinite(ratio) ? ratio : 0) * 100));
			return react.createElement("div", {
				className: "dsh-tokstats-meter" + (dim ? " dsh-tokstats-dim" : ""), title: title
			},
				react.createElement("span", { className: "dsh-tokstats-meterLabel" }, label),
				react.createElement("span", { className: "dsh-tokstats-meterTrack" },
					// 零值行不画填充：min-width 会让 0% 也留一截，看起来像「有数据」。
					width > 0
						? react.createElement("span", {
							className: "dsh-tokstats-meterFill", style: { width: width.toFixed(1) + "%" }
						})
						: null),
				react.createElement("span", { className: "dsh-tokstats-meterValue" }, value),
				detail === undefined || detail === null || detail === ""
					? null
					: react.createElement("span", { className: "dsh-tokstats-meterDetail" }, detail));
		}

		/**
		 * 工作区路径的可读尾段：末两段目录（`…\JavaScript\dsh-plugins`）。
		 *
		 * 排行表里要的是「哪个项目」，前缀对每一行都相同，占满列宽反而把差异挤没了；
		 * 完整路径仍在 tooltip 里。
		 */
		function tokstatsPathTail(path) {
			const parts = String(path ?? "").split(/[\\/]+/).filter((part) => part.length > 0);
			if (parts.length <= 2) return String(path ?? "");
			return "\u2026\\" + parts.slice(-2).join("\\");
		}

		function TokstatsRow({ label, value, title, dim }) {
			return react.createElement("div", {
				className: "dsh-tokstats-row" + (dim ? " dsh-tokstats-dim" : ""), title: title
			},
				react.createElement("span", { className: "dsh-tokstats-rowLabel" }, label),
				react.createElement("span", { className: "dsh-tokstats-rowValue" }, value));
		}

		function TokstatsRefreshIcon() {
			return react.createElement("svg", {
				width: 14, height: 14, viewBox: "0 0 16 16", fill: "none",
				"aria-hidden": "true", style: { display: "block" }
			},
				react.createElement("path", {
					d: "M13.2 8a5.2 5.2 0 1 1-1.7-3.9M13.4 2.6v2.8h-2.8",
					stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round",
					strokeLinejoin: "round", fill: "none"
				}));
		}

		/**
		 * 全局面板（root `main` keyed slot，id = TOKSTATS_PANEL_ID）。
		 *
		 * 主体只有两块独有价值（Q5：用法健康度）：上下文桶分布 + 周粒度趋势；
		 * 工作区是分组维度。模型与成本维度整体删除（Q6），故不渲染模型表、不含金额。
		 */
		function TokstatsPanel({ t }) {
			const [rangeId, setRangeId] = react.useState(TOKSTATS_DEFAULT_RANGE);
			const [workspace, setWorkspace] = react.useState("");
			const [phase, setPhase] = react.useState("loading");
			const [data, setData] = react.useState(null);
			// promptopt 计数器（AC-13）：与主报表分开拉，取不到就整块不渲染——
			// 它只是「这个功能用没用起来」的旁证，不该拖累桶分布。
			const [promptopt, setPromptopt] = react.useState(null);
			// 手动刷新计数：只用来把 effect 再跑一遍（窗口/工作区未变时按钮仍要能拉一次）。
			const [nonce, setNonce] = react.useState(0);
			// ctx 在 apply 时由闭包持有（slot 组件不接收 ctx）；每次请求取一份新控制器，
			// effect 清理时 abort 掉在飞请求。
			const ctxRef = react.useRef(tokstatsCtx);
			// 「这次 effect 是后台自动重拉」的标记（TS-25）。
			//
			// 它是 ref 而不是 state：它只影响**本次 effect 的行为**（要不要把
			// 已有内容换成「统计中…」），不需要触发渲染——真正要渲染的「有没有
			// 数据」由 `data` 承担。
			//
			// 为什么要这个标记：自动重拉期间**旧数据仍然有效**（它就是 host 手头
			// 能给出的最好值，只是可能偏低），把它换成「统计中…」会让整块内容
			// 卸载再挂回——1.5 s 一轮、连续 3–4 轮时用户看到的是高频闪烁，而
			// 闪烁期间一行数字都读不到。改成「保留旧内容 + 页脚提示校验中」后，
			// 数据始终在屏上，只是数值随后台校验逐步变准。
			const backgroundRef = react.useRef(false);
			// ── 单日模式（SPEC D1 / TS-29）────────────────────────────────────
			//
			// `null` = 区间模式（现状五档）；`"YYYY-MM-DD"` = 单日模式（面板整体重算
			// 成那一天的数）。热力图同时承担「一眼看形状」与「选日期」两个职责，不另
			// 加独立的「今日卡」（SPEC D1 否决项①）。
			const [singleDay, setSingleDay] = react.useState(null);
			// 键盘光标：热力图上当前聚焦的日键（roving tabindex 的简化版）。
			//
			// 为什么不用「聚焦在哪个 DOM 节点」：浅渲染下没有真实 DOM，且方向键需要
			// 知道「从哪一格出发」——把它存在 state 里既能在渲染时标 aria-selected，
			// 也能让方向键算出下一格。
			const [cursorDay, setCursorDay] = react.useState(null);

			const range = TOKSTATS_RANGES.find((r) => r.id === rangeId) ?? TOKSTATS_RANGES[0];
			// 请求期的折算时刻：同一档位内多次重拉要用同一个 `today`，否则跨零点
			// 前后算出的 windowDays 会差一天（「本月」在 1 号零点最明显）。
			const rangeDays = tokstatsRangeDays(range, Date.now());

			react.useEffect(() => {
				const controller = new AbortController();
				// 后台自动重拉：**不**把 phase 打回 loading，已有内容继续留在屏上。
				// 首次加载与用户主动操作（切档位/切工作区/点刷新）才走 loading。
				const background = backgroundRef.current;
				if (!background) setPhase("loading");
				void (async () => {
					const request = { windowDays: rangeDays };
					if (workspace !== "") request.workspace = workspace;
					// 单日模式：仍传 `windowDays`（host 按裁决 C 用 day 覆盖它）。
					// 不传反而要求 client 知道 host 的优先级规则，耦合更紧（PLAN §3.3.2）。
					if (singleDay !== null) request.day = singleDay;
					const [value, counters] = await Promise.all([
						tokstatsFetchSummary(ctxRef.current, request, controller.signal),
						tokstatsFetchPromptopt(ctxRef.current, controller.signal),
					]);
					if (controller.signal.aborted) return;
					setPromptopt(counters === undefined || counters === null ? null : counters);
					if (value === undefined || value === null) {
						setPhase("empty");
						setData(null);
						return;
					}
					setData(value);
					if (!background) setPhase("ready");
					// 后台校验未完成（TS-24）：host 先用缓存秒开、把滞后会话的冷读排进
					// 后台队列。这里按退避自动重拉一次，直到 `verifying` 消失——用户看到的
					// 是「立刻有数 → 几秒后自动变成准确值」，而不是十几秒空等。
					//
					// 只在 `verifying === true` 时重拉：旧 host 没有该字段（undefined），
					// 不能因此陷入无限重拉（硬规则 6）。`nonce` 是手动刷新计数，也参与
					// 依赖，避免重拉时把用户的刷新意图丢掉。
					if (value.verifying === true) {
						const timer = setTimeout(() => {
							if (controller.signal.aborted) return;
							// 标记下一次 effect 是后台重拉：不卸载已有内容（TS-25）。
							backgroundRef.current = true;
							setNonce((n) => n + 1);
						}, background ? TOKSTATS_VERIFY_BACKOFF_MS : TOKSTATS_VERIFY_RETRY_MS);
						// 清理时取消重拉：组件卸载或档位切换后不该再打旧请求。
						controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
					}
				})();
				return () => controller.abort();
			}, [rangeDays, workspace, nonce, singleDay]);

			const rangeButton = (entry) => react.createElement("button", {
				key: entry.id,
				type: "button",
				className: "dsh-tokstats-switch" + (rangeId === entry.id ? " dsh-tokstats-switchOn" : ""),
				// 单日模式下五档**置灰**（AC-10 / PLAN §3.3.1）：置灰而非隐藏——
				// 隐藏会让工具条高度变化、面板内容整体跳动；置灰保留布局稳定，且读者
				// 能看到「这里有五档，只是当前不可用」。
				disabled: singleDay !== null,
				// 用户主动切档位：清掉「后台重拉」标记（TS-25）。新窗口的旧数据与
				// 新窗口口径不同，留着会显示「上一个窗口的数字」——那种错比闪烁更糟。
				onClick: () => { backgroundRef.current = false; setRangeId(entry.id); }
			}, t("range." + entry.id));

			const buckets = data !== null && Array.isArray(data.buckets) ? data.buckets : [];
			const weekly = data !== null && Array.isArray(data.weekly) ? data.weekly : [];
			const daily = data !== null && Array.isArray(data.daily) ? data.daily : [];
			const workspaces = data !== null && Array.isArray(data.workspaces) ? data.workspaces : [];
			// `routes` 是第二批才有的字段：旧 host 返回没有它时这里拿到空数组，
			// 整卡不渲染（与 daily 同一手法，硬规则 6 的优雅降级）。
			const routes = data !== null && Array.isArray(data.routes) ? data.routes : [];
			// ── 热力图数据源（TS-28）──────────────────────────────────────────
			//
			// `heatDaily` 是 host 的**固定 84 天**序列（不随档位变，SPEC D5 / AC-4）。
			// 旧 host 返回没有这个字段时拿到 undefined → 热力图整块不渲染（硬规则 6，
			// 与 routes / daily / coverage 同一手法）。**不得**退化成用 `daily` 顶上：
			// 那是当前档位窗口内的天（「近 7 天」档只有 7 行），热力图会缩成 7 格。
			const heatDaily = data !== null && Array.isArray(data.heatDaily) ? data.heatDaily : [];
			// 热力图有自己的数据源：当前档位窗口内没有数据时（例如「近 7 天」里恰好
			// 一次都没用，但 12 周里有量），面板不该整块落进「暂无数据」——那样读者
			// 会以为统计坏了，而热力图本来就能画出形状。
			const hasHeat = heatDaily.some((row) => (row?.calls ?? 0) > 0);
			const totals = data !== null && data.totals !== null && typeof data.totals === "object"
				? data.totals
				: { calls: 0, in: 0, cr: 0, cw: 0, out: 0 };

			const hasBuckets = buckets.some((b) => (b?.calls ?? 0) > 0);
			const hasWeekly = weekly.length > 0;
			const hasData = hasBuckets || hasWeekly || daily.length > 0 || (totals.calls ?? 0) > 0 || hasHeat;

			const totalCalls = totals.calls ?? 0;
			// 窗口天数（host 回显的 `windowDays`）：0 = 「全部」档没有窗口；旧 host 缺
			// 该字段时退回本次请求折算出的天数（`rangeDays`），否则「日均」与「当日」
			// 两个副值都会算错。
			const days = data !== null && Number.isFinite(data.windowDays) ? data.windowDays : rangeDays;
			const windowStart = data !== null && typeof data.windowStart === "string" ? data.windowStart : "";

			// ── 覆盖率披露（TS-21 / AC-2）──────────────────────────────────────
			//
			// `coverage` 是 batch 1 才有的字段：旧 host 返回没有它时拿到 undefined，
			// 整句不渲染（与 routes / daily 同一手法，硬规则 6 的优雅降级）——**不得**
			// 退化成「已统计 0 个会话」，那是假零。
			//
			// `skipped === 0` 时也不渲染「跳过」半句：把「一个都没跳过」写成「跳过 0 个」
			// 会让读者以为这条路走过、只是恰好没问题，而动过它。
			const coverage = data !== null && data.coverage !== null && typeof data.coverage === "object"
				? data.coverage
				: null;
			const coverageSessions = coverage !== null && Number.isFinite(coverage.sessions) ? coverage.sessions : null;
			// 后台校验中（TS-24）时**不得**把待校验的会话算进「跳过（日志不可读）」：
			// 它们的 summary 只是还没读出来，不是读不出来。首帧实测会把 68 个待校验
			// 会话写成「跳过 68 个（日志不可读）」——那是对用户谎报故障。
			const verifying = data !== null && data.verifying === true;
			// 页脚状态徽标的取值（见 `TokstatsStatusChip`）：失败优先于校验中——
			// 拿不到数据时「还在校验」是误导；加载中不表态（页头角标已写「统计中…」）。
			const statusState = phase === "empty"
				? "failed"
				: verifying
					? "verifying"
					: phase === "ready" ? "done" : null;
			const coverageSkipped = !verifying && coverage !== null && Number.isFinite(coverage.skipped)
				? coverage.skipped
				: 0;

			// ── 折叠历史代表日（TS-22 / AC-3）──────────────────────────────────
			//
			// host 的 epoch.end 是折叠区间末端，明细在读取期被挂到**前一天**当代表日
			// （host 侧 tokstatsDayBefore 同口径）。这里必须用同一条式子算那个日键，
			// 才能在图里找到对应列——两边各写一份时，一边改成「end 当天」就打不中。
			//
			// 只有 epoch 非 null 且有 calls 才算有折叠历史；host 已经在三种边角
			// （代表日窗口外 / 全零 / 无格被计入）返回 null，这里不重复判断窗口。
			const epoch = data !== null && data.epoch !== null && typeof data.epoch === "object"
				&& typeof data.epoch.end === "string"
				? data.epoch
				: null;
			const epochDay = epoch === null ? null : tokstatsDayBeforeLocal(epoch.end);
			const epochCalls = epoch !== null && Number.isFinite(epoch.calls) ? epoch.calls : 0;

			// ── 热力图（TS-28）────────────────────────────────────────────────
			//
			// 数据源已在上面取出（heatDaily / hasHeat）。这里只做网格化与色阶。
			const todayKey = tokstatsDayKeyLocal(Date.now());
			const heatGrid = tokstatsHeatGrid(heatDaily, todayKey, epoch);
			const heatCells = heatGrid.weeks.flatMap((week) => week.cells).filter((cell) => cell !== null);
			// 色阶峰值：只看**有逐日明细且非折叠**的格子。折叠区的 calls 是「区间合计
			// 挂到代表日」的派生值，把它当峰值会让其余所有格子偏浅。
			const heatPeak = heatCells.reduce((max, cell) => (cell.folded ? max : Math.max(max, cell.calls ?? 0)), 0);
			// 单日模式下 KPI「调用次数」副值的分母：heatDaily 的合计（SPEC D13）。
			//
			// **不能取 totals**：单日下 totals 就是那一天，用它算份额恒得 100%，
			// 既毫无信息、又复述主值（触发 TS-17 的「四卡副值两两不等」判据）。
			const heatTotalCalls = heatDaily.reduce((sum, row) => sum + (Number.isFinite(row?.calls) ? row.calls : 0), 0);
			// host 回显的单日/折叠态（旧 host 无这两个字段）。
			const dayEcho = data !== null && typeof data.day === "string" ? data.day : null;
			const dayFolded = data !== null && data.dayFolded === true;

			const peakBucketIndex = buckets.reduce(
				(best, cell, i) => ((cell?.calls ?? 0) > (buckets[best]?.calls ?? 0) ? i : best), 0);
			// ── 日柱图的窗口：**跟随档位，但不少于 7 天**（TS-33）──────────────
			//
			// 上一次把这张图锁在 7 天，代价是「近 30 天 / 本月」看不到逐日走势——
			// 热力图只给 12 周的形状、没有数字，那是个真缺口。现在改成跟随档位：
			//   当日 → 7 天（下限；画一根柱没有形状）｜近 7 天 → 7 天
			//   本月 / 近 30 天 → 各自窗口，逐日｜全部 → 全历史，超 30 列按整日合并
			// 于是「图比档位长」只剩当日档一处，卡头会写明实际跨度，不会误读。
			//
			// 数据源要分情况：窗口 ≥ 下限时直接用 `daily`（就是当前窗口的逐日真源）；
			// 窗口 < 下限（当日档）时 `daily` 只有一行，借与档位无关的 `heatDaily`
			// （host 固定返回 84 天、已按 workspace 过滤）取最近 7 天。旧 host 没有
			// `heatDaily` 时退回 `daily`（退化成一根柱，但不整卡消失，硬规则 6）。
			//
			// 窗口起点必须与 `tokstatsDailyColumns` 用的「今天」同源（`generatedAt`），
			// 不能借热力图那个「真实今天」：两处口径不一致时窗口会和列算法错位
			// （跨零点渲染旧帧、或夹具的 generatedAt 与当下不同日时最明显）。
			const chartDays = days > 0 ? Math.max(days, TOKSTATS_CHART_MIN_DAYS) : 0;
			const chartToday = tokstatsDayKeyLocal(Number.isFinite(data?.generatedAt) ? data.generatedAt : Date.now());
			const chartStart = chartDays > 0 ? tokstatsDayShiftLocal(chartToday, -(chartDays - 1)) : null;
			const chartDaily = days > 0 && days < TOKSTATS_CHART_MIN_DAYS && heatDaily.length > 0
				? heatDaily
				: daily;
			const dailyColumns = tokstatsDailyColumns(chartDaily, chartStart ?? windowStart, data?.generatedAt);
			const peakDay = dailyColumns.reduce((max, col) => Math.max(max, col.calls), 0);
			const peakDayLabel = dailyColumns.reduce(
				(best, col) => (col.calls > (best?.calls ?? 0) ? col : best), null);
			// 峰值柱的**唯一**标识：并列峰值时只标第一根（见柱渲染处的说明）。
			const peakDayKey = peakDay > 0 && peakDayLabel !== null ? peakDayLabel.startDay : null;
			// 横轴刻度的列位：首 / 中 / 末三列（列数 ≤ 2 时只留现有的列）。刻度
			// **按列位落点**而不是按容器两端均分——这正是「日期标签与量柱对齐」的
			// 保证：轴与柱共用同一套 flex 约束（.dsh-tokstats-track +
			// .dsh-tokstats-trackItem），第 i 个刻度天然落在第 i 根柱的正下方。
			//
			// 只标三处是因为列宽会压到 9–13px：每列都标会在窄卡里糊成一片日期。
			const dailyTickIndexes = dailyColumns.length <= 2
				? dailyColumns.map((col, index) => index)
				: [0, Math.floor((dailyColumns.length - 1) / 2), dailyColumns.length - 1];
			const workspaceTotalCalls = workspaces.reduce((sum, entry) => sum + (entry.calls ?? 0), 0);
			const routeTotalCalls = routes.reduce((sum, entry) => sum + (entry.calls ?? 0), 0);

			// ── KPI 四卡的口径：**跟随时间档位**（TS-30）──────────────────────
			//
			// 四张卡回答「所选区间一共用了多少」，缺省档位是「当日」，所以打开面板
			// 第一眼就是今天的数。此前它们被钉死在「当日」、不随档位变——那会让
			// 「近 30 天」的图表上面挂着一天的数，读者得自己记住两套口径。
			//
			// 口径只有一个真源：`totals`（host 已按窗口 + 工作区过滤）。**没有**
			// 第二套「当日」取值，也就不存在两套数打架的面。
			const kpiBilled = tokstatsBilled(totals);
			const kpiHit = tokstatsHit(totals);
			// 「调用次数」副值：窗口只有一天（当日档 / 单日模式）时「日均」等于主值
			// 本身，改成「占 84 天份额」（分母取 heatDaily 合计，TS-17 的复述判据）；
			// 多天窗口给日均；「全部」档没有天数概念，写明是全历史。
			const kpiSingle = singleDay !== null || days === 1;
			// 分母为 0（旧 host 没有 heatDaily）时给破折号，不编一个 0%——那个比值
			// 在数学上无定义（TS-17）。
			const kpiShare = kpiSingle ? tokstatsPct(totalCalls, heatTotalCalls) : null;
			const kpiCallsHint = kpiSingle
				? (kpiShare === null ? "\u2014" : t("kpi.callsHintShare", { pct: kpiShare }))
				: days > 0
					? t("kpi.callsHintDays", { rate: (totalCalls / days).toFixed(1) })
					: t("kpi.callsHintAll");
			// 「输出」副值 = 输出占计费输入的比值（TS-17）：它拆的是本卡的主值，
			// 而不是复述别的卡。分母为 0 时返回 null，副值渲染破折号而不是编 0%。
			const kpiOutputShare = tokstatsPct(totals.out ?? 0, kpiBilled);

			const kpis = react.createElement("div", { className: "dsh-tokstats-kpiGrid" },
				react.createElement(TokstatsKpi, {
					label: t("kpi.calls"),
					value: fmtTok(totalCalls),
					hint: kpiCallsHint,
				}),
				react.createElement(TokstatsKpi, {
					label: t("kpi.billed"),
					value: fmtTok(kpiBilled),
					hint: t("kpi.billedHint", { uncached: fmtTok(totals.in ?? 0), cached: fmtTok(totals.cr ?? 0) }),
				}),
				react.createElement(TokstatsKpi, {
					label: t("kpi.output"),
					value: fmtTok(totals.out ?? 0),
					hint: kpiOutputShare === null ? "\u2014" : t("kpi.outputHint", { pct: kpiOutputShare }),
				}),
				// 「缓存命中率」副值 = 这个百分比的分子与分母（命中 tokens / 计费输入），
				// 让人能心算校验 1% 是怎么来的。
				react.createElement(TokstatsKpi, {
					label: t("kpi.hit"),
					value: kpiHit + "%",
					hint: t("kpi.hitHint", { cached: fmtTok(totals.cr ?? 0), billed: fmtTok(kpiBilled) }),
				}));

			// ── 热力图卡（TS-28）──────────────────────────────────────────────
			//
			// 它同时是**日期选择器**（SPEC D1）：点某一天 → 面板整体重算成那一天。
			// 旧 host 没有 `heatDaily` 时 `heatGrid.weeks` 为空 → 整卡不渲染（硬规则 6）。
			const heatCard = heatGrid.weeks.length > 0
				? react.createElement(TokstatsCard, {
					title: t("section.heat"),
					extra: tCount(t, "extra.weeks", heatGrid.weeks.length, {}),
				},
					// 热力图**必须带坐标**：12×7 的纯色块矩阵读不出「哪一列是哪一周、哪一行是周几」
					// ——样稿里有 W01/W04/W07/W10 与「一…日」，这里对齐。坐标与格子分成两套
					// grid、共用同一组轨道宽度与 gap：`.heat` 自己的「12 列 × 7 行」结构由 TS-28
					// 的用例钉住，不能为了让标签挤进去而改成 13 列（那会破掉「列 = 自然周」）。
					react.createElement("div", { className: "dsh-tokstats-heatFrame" },
						react.createElement("div", { className: "dsh-tokstats-heatCorner" }),
						// 周标：每三周一标，与样稿同节奏——十二个都标会挤成一片 W01W02…。
						// 「W」是记号不是词，不进词典（硬规则 7）。
						react.createElement("div", { className: "dsh-tokstats-heatWeeks" },
							heatGrid.weeks.map((week, index) => react.createElement("span", {
								key: index,
								className: "dsh-tokstats-heatWeekTick",
							}, index % 3 === 0 ? "W" + String(index + 1).padStart(2, "0") : ""))),
						// 行标：周一在最上（与 `grid-template-rows:repeat(7,…)` 的填充方向一致）。
						react.createElement("div", { className: "dsh-tokstats-heatDows" },
							["heat.dow1", "heat.dow2", "heat.dow3", "heat.dow4", "heat.dow5", "heat.dow6", "heat.dow7"]
								.map((key) => react.createElement("span", { key, className: "dsh-tokstats-heatDow" }, t(key)))),
						react.createElement("div", {
							className: "dsh-tokstats-heat",
						role: "grid",
						"aria-label": t("section.heat"),
						// 键盘提示：方向键可用这件事不写在格子上（会挡住图形），
						// 而是挂在整图的 tooltip 与 aria 上。
						title: t("heat.keyHint"),
						onKeyDown: (event) => {
							const key = event?.key;
							// 只在格子上有光标时接管方向键（否则会抢走页面滚动）。
							if (cursorDay === null) return;
							const flat = heatCells;
							const index = flat.findIndex((cell) => cell.day === cursorDay);
							if (index < 0) return;
							// 跨日 / 跨周（SPEC 裁决 B）：←/→ 一天，↑/↓ 一周（7 天）。
							// 顺序遍历，越界不环绕——环绕会让「按了 5 次 →」跑到几周外。
							let delta = 0;
							if (key === "ArrowLeft") delta = -1;
							else if (key === "ArrowRight") delta = 1;
							else if (key === "ArrowUp") delta = -7;
							else if (key === "ArrowDown") delta = 7;
							else if (key === "Enter" || key === " " || key === "Spacebar") {
								// Enter / Space 选中（只有可点的格子才进单日模式）。
								event?.preventDefault?.();
								const cell = flat[index];
								if (cell !== undefined && !cell.folded && (cell.calls ?? 0) > 0) {
									backgroundRef.current = false;
									setSingleDay(cell.day);
								}
								return;
							} else if (key === "Escape") {
								// Esc 退出单日模式（与 promptopt 弹层的 Esc 惯例对齐）。
								backgroundRef.current = false;
								setSingleDay(null);
								return;
							} else {
								return;
							}
							event?.preventDefault?.();
							// 只落在「真实存在且可选」的格子上：跨到未来日期或折叠区时
							// 直接停住，不跳到下一个可点格（那会让光标位置不可预测）。
							const nextDay = tokstatsDayShiftLocal(cursorDay, delta);
							if (nextDay !== null) setCursorDay(nextDay);
						},
					},
						heatGrid.weeks.flatMap((week) => week.cells.map((cell, rowIndex) => {
							const key = week.weekStart + "#" + String(rowIndex);
							// 未来日期：渲染成不可交互的占位（**不是**零格——那天还没到）。
							if (cell === null) {
								return react.createElement("span", {
									key, className: "dsh-tokstats-heatCell dsh-tokstats-heatCellEmpty", "aria-hidden": "true"
								});
							}
							const dateLabel = tokstatsDayLabel(cell.day);
							// 折叠区（SPEC D12 / AC-9）：**不可点**、**不显示数字**。
							// 判据在 client 侧用 epoch.start/end 自行算出，不需要先请求
							// （PLAN §3.3.4）——点进去只会得到一个偏低的数，那是谎报。
							if (cell.folded) {
								return react.createElement("button", {
									key,
									type: "button",
									className: "dsh-tokstats-heatCell dsh-tokstats-heatFolded",
									disabled: true,
									"aria-label": t("heat.foldedAria", { date: dateLabel }),
									title: t("heat.folded", {
										date: dateLabel,
										start: tokstatsDayLabel(epoch?.start ?? ""),
										end: tokstatsDayLabel(epoch?.end ?? ""),
									}),
									// 折叠格不参与色阶：它的 calls 是派生值（区间合计挂到
									// 代表日），用它上色会让读者以为那天真用了这么多。
									"data-folded": "1",
								});
							}
							const level = tokstatsHeatLevel(cell.calls, heatPeak);
							// 零日（AC-8）：无填充（不设 data-level），tooltip 写「无记录」。
							const tipParams = {
								date: dateLabel,
								input: fmtTok(tokstatsBilled(cell.row ?? {})),
								output: fmtTok(cell.row?.out ?? 0),
							};
							const title = (cell.calls ?? 0) > 0
								? tCount(t, "heat.cellTip", cell.calls, tipParams)
								: t("heat.empty", { date: dateLabel });
							const aria = (cell.calls ?? 0) > 0
								? tCount(t, "heat.cellAria", cell.calls, { date: dateLabel })
								: t("heat.empty", { date: dateLabel });
							// 零日与折叠区都**不可点**（SPEC D10）：零日点进去只有全零面板，
							// 是噪音；两者都在 tooltip 里写明不可选原因（上两行）。
							const selectable = (cell.calls ?? 0) > 0;
							return react.createElement("button", {
								key,
								type: "button",
								className: "dsh-tokstats-heatCell dsh-tokstats-ramp",
								// 零日不设 data-level（= 无填充），CSS 落到默认背景色。
								"data-level": level > 0 ? String(level) : undefined,
								disabled: !selectable,
								title: title,
								"aria-label": aria,
								// 选中态：单日模式下选中的那一天（TS-29）。键盘光标是另一层
								// （cursorDay），两者可以不同——光标是「停在哪」，选中是「在看哪天」。
								"aria-selected": cell.day === singleDay ? "true" : undefined,
								"data-cursor": cell.day === cursorDay ? "1" : undefined,
								onFocus: () => setCursorDay(cell.day),
								onClick: () => {
									if (!selectable) return;
									// 点已选中的格 → 退出单日模式（PLAN §3.3.1 的出口之一）。
									backgroundRef.current = false;
									setCursorDay(cell.day);
									setSingleDay((current) => (current === cell.day ? null : cell.day));
								},
							});
						})),
						// 图例（SPEC D8）：「少」← 五档色块 →「多」。色块与格子共用色阶，
					// 读者能对照出「这一格大概是哪一档」。
					)),
					// 图例单独一行放在网格下方：放进网格会占掉 12 列中的列位，
					// 打乱「列 = 自然周」的读法。
					react.createElement("div", { className: "dsh-tokstats-heatLegend" },
						react.createElement("span", null, t("heat.less")),
						// 图例与格子**共用**同一套色阶规则（`dsh-tokstats-ramp` + data-level），
						// 只是形状更小。此前图例用 inline opacity 模拟，底色仍是卡片底色：
						// 与格子（brand 色 + opacity）算出来不是同一个颜色，读者对照时会
						// 「明明一样深却对不上档」。
						[1, 2, 3, 4, 5].map((lv) => react.createElement("span", {
							key: lv,
							className: "dsh-tokstats-heatLegendSwatch dsh-tokstats-ramp",
							"data-level": String(lv),
						})),
						react.createElement("span", null, t("heat.more"))),
					// 折叠日说明（TS-29）：`dayFolded === true` 时显式说出来，且**不显示
					// 任何数字**——显示偏低数字是谎报。
					dayFolded
						? react.createElement("div", { className: "dsh-tokstats-heatNote" }, t("single.folded"))
						: null)
				: null;

			const bucketCard = react.createElement(TokstatsCard, {
				title: t("section.bucket"),
				extra: hasBuckets ? t("extra.peakBucket", { bucket: TOKSTATS_BUCKET_LABELS[peakBucketIndex] }) : undefined,
			},
				TOKSTATS_BUCKET_LABELS.map((label, i) => {
					const cell = buckets[i] ?? { calls: 0, in: 0, cr: 0, cw: 0, out: 0 };
					const billed = tokstatsBilled(cell);
					const hit = tokstatsHit(cell);
					const calls = cell.calls ?? 0;
					const ratio = totalCalls > 0 ? calls / totalCalls : 0;
					return react.createElement(TokstatsMeter, {
						key: label,
						label: label,
						dim: calls === 0,
						ratio: ratio,
						value: calls > 0 ? tCount(t, "cell.calls", calls, {}) : "\u2014",
						detail: calls > 0
							? t("cell.bucketDetail", {
								input: fmtTok(billed), output: fmtTok(cell.out ?? 0), hit: hit
							})
							: undefined,
						title: tCount(t, "tip.bucket", calls, {
							bucket: label, input: fmtTok(billed), output: fmtTok(cell.out ?? 0), hit: hit
						}),
					});
				}));

			// ── 每日柱状图的三块（纵轴 / 绘图区 / 横轴）────────────────────────
			//
			// 拆成三个局部节点而不是一路 createElement 套下去：`.chart` 是两行两列的
			// grid，纵轴、绘图区、横轴**必须是同一层级的三个子节点**（横轴在绘图区
			// 下方那一行，纵轴只跨绘图区那一行）——嵌在 chartMain 里时横轴会变成
			// 绘图区的兄弟 flex 项，日期标签直接跑到图里去。
			//
			// 左轴：三个刻度值（0 / 峰值÷2 / 峰值）。**位置按平方根刻度算**，而不是
			// 均分——柱高是 `sqrt(calls / peak)`，把「峰值÷2」画在绘图区正中间会让
			// 读者按线性比例读出一个不存在的值（那个位置实际是峰值÷4）。
			// `sqrt(0.5) ≈ 70.7%` 就是峰值÷2 的真实高度。
			//
			// `fmtTok` 负责 K/M 记号；记号本身不进词典（AGENTS 硬规则 7）。
			// 窄窗（≤900px）隐藏中间刻度：三行标签在 40px 宽轴里会互相挤压，
			// 留首末两个仍能读出量级（见 CSS 的 @media）。
			const dailyAxisY = react.createElement("div", { className: "dsh-tokstats-axisY" },
				react.createElement("span", { className: "dsh-tokstats-axisTick dsh-tokstats-axisTickTop" },
					fmtTok(peakDay)),
				react.createElement("span", { className: "dsh-tokstats-axisTick dsh-tokstats-axisTickMid" },
					fmtTok(peakDay / 2)),
				react.createElement("span", { className: "dsh-tokstats-axisTick dsh-tokstats-axisTickBase" },
					"0"));

			// 绘图区：网格线绝对定位在绘图区底边之上，柱体按 flex 排。
			// `title` 是 TS-23 要求的刻度口径说明——`Math.sqrt` 未声明时读者会按
			// 线性误读「三根差不多高 = 三天差不多量」。
			const dailyBars = react.createElement("div", { className: "dsh-tokstats-bars dsh-tokstats-track" },
				dailyColumns.map((col) => {
					// 平方根刻度：实测日量差异可达 100 倍（单日 1286 次 vs 12 次），
					// 线性刻度下除峰值外全部压成 1–2px 的细线，趋势就看不出来了。
					// 精确数值在 tooltip 与页脚，柱子只负责表达形状。
					const ratio = peakDay > 0 ? Math.sqrt(Math.max(0, col.calls) / peakDay) : 0;
					const height = ratio > 0 ? Math.max(4, Math.round(ratio * 100)) : 0;
					const span = col.startDay === col.endDay
						? col.startDay
						: t("daily.span", { start: tokstatsDayLabel(col.startDay), end: tokstatsDayLabel(col.endDay) });
					// 折叠历史标记（TS-22）：这一列含 epoch 归并进来的历史明细，
					// 它的高度不代表那一天真的用了这么多。判据是「代表日落在该列的
					// [startDay, endDay] 区间内」——列会被合并（跨度大于一天），只比
					// startDay 会在合并列上漏标。
					const hasEpochHistory = epochDay !== null && epochDay >= col.startDay && epochDay <= col.endDay;
					const tipParams = { span: span, input: fmtTok(tokstatsBilled(col)), output: fmtTok(col.out ?? 0) };
					const baseTip = tCount(t, "tip.day", col.calls, tipParams);
					// 峰值柱顶标数值（TS-23）：其余柱只在 hover 时给 tooltip，
					// 峰值那根是读者第一眼要读的数，不该要求他去悬停。
					// 并列峰值只标第一根：同一屏上出现两个同值标签会让读者
					// 以为「两根都标了 = 都值得看」，而它们本来就是同一个数。
					//
					// 列密时不标（`TOKSTATS_PEAK_LABEL_MAX_COLUMNS`）：近 30 天 / 本月档
					// 每列只剩 8–10px，硬标会被相邻柱压成半个数字；峰值数值在卡头
					// 「峰值 …」里始终可读。
					const showPeakLabel = peakDayKey !== null
						&& col.startDay === peakDayKey
						&& dailyColumns.length <= TOKSTATS_PEAK_LABEL_MAX_COLUMNS;
					return react.createElement("span", {
						key: col.startDay,
						className: "dsh-tokstats-bar dsh-tokstats-trackItem"
							+ (hasEpochHistory ? " dsh-tokstats-barEpoch" : ""),
						title: hasEpochHistory
							? tCount(t, "tip.dayEpoch", col.calls, { ...tipParams, epochCalls: epochCalls })
							: baseTip,
					},
						// 零列不画柱：基线由容器底边承担，画 2px 灰柱会连成虚线，
						// 看起来像「有很小的数据」。
						height > 0
							? react.createElement("span", {
								className: "dsh-tokstats-barFill",
								style: { height: height + "%" }
							},
								showPeakLabel
									? react.createElement("span", {
										className: "dsh-tokstats-barPeak"
									}, fmtTok(col.calls))
									: null)
							: null);
				}));

			const dailyPlot = react.createElement("div", {
				className: "dsh-tokstats-chartPlot",
				title: t("tip.dailyScale")
			},
				react.createElement("span", { className: "dsh-tokstats-gridLine dsh-tokstats-gridLineTop" }),
				react.createElement("span", { className: "dsh-tokstats-gridLine dsh-tokstats-gridLineMid" }),
				dailyBars);

			// 横轴在绘图区**下方**，且**与柱位同轨**：每列一个刻度槽，槽与柱共用
			// `.dsh-tokstats-track` / `.dsh-tokstats-trackItem` 的同一组 flex 约束，
			// 因此第 i 个刻度永远落在第 i 根柱的正下方。此前用
			// `justify-content:space-between` 把首末两个标签钉在容器两端——柱组在
			// 少列时是居中的，两者相差可达一屏的一小半，日期读起来像标错了柱子。
			//
			// 空槽也要渲染：它们是撑出列宽的那一层，不渲染等于把刻度退回「均分容器」。
			const dailyAxis = react.createElement("div", { className: "dsh-tokstats-axis dsh-tokstats-track" },
				dailyColumns.map((col, index) => {
					const isFirst = index === 0;
					const isLast = index === dailyColumns.length - 1;
					// 末列标右端（合并列时右端才是窗口末），其余标左端。
					const label = dailyTickIndexes.includes(index)
						? tokstatsDayLabel(isLast && !isFirst ? col.endDay : col.startDay)
						: "";
					return react.createElement("span", {
						key: col.startDay,
						className: "dsh-tokstats-axisSlot dsh-tokstats-trackItem"
							+ (isFirst ? " dsh-tokstats-axisSlotFirst" : "")
							+ (isLast && !isFirst ? " dsh-tokstats-axisSlotLast" : ""),
					}, label);
				}));

			const dailyCard = dailyColumns.length > 0
				? react.createElement(TokstatsCard, {
					title: t("section.daily"),
					// 卡片自带口径：写出**实际跨度**。当日档的图比档位长（7 天下限），
					// 不标出来读者会以为图画错了。
					note: chartDays > 0
						? t("extra.windowDays", { days: chartDays })
						: t("extra.windowAll"),
					extra: peakDay > 0
						? tCount(t, "extra.peakDay", peakDay, { day: peakDayLabel?.startDay ?? "" })
						: undefined,
				},
					react.createElement("div", { className: "dsh-tokstats-chart" },
						dailyAxisY,
						react.createElement("div", { className: "dsh-tokstats-chartMain" }, dailyPlot),
						dailyAxis))
				: null;

			// ── 周趋势卡（第五批改造：四列表格 → 条列表）────────────────────
			//
			// 原来是一张「周起点 / 次数 / 输入 / 输出」四列表：读者要自己心算两个数
			// 才知道「这周比上周多还是少」，而且它是全页唯一不讲视觉语言的卡——
			// 别的卡都是条/柱/格。现在改成与分布、排行同构的条列表：条长 = 该周占
			// **最大周**的比例（这是「趋势」不是「构成」，按窗口份额归一会让十来周里
			// 每根条都短得看不出差），副行仍给输入 / 输出。
			//
			// 少于 2 行就整卡不渲染：那时那一行恒等于四卡合计（当日档、本月 1 号到
			// 7 号、单日模式），属于复述主值。判据用**行数**而不是档位天数——只判
			// `days === 1` 会漏掉「本月」月初那几天，那是同一个毛病。
			const weekMaxCalls = weekly.reduce((max, week) => Math.max(max, week.calls ?? 0), 0);
			// 「本周」= 含 `generatedAt` 当天的那一自然周（与 host 的周起点同一条式子）。
			const currentWeekStart = tokstatsWeekStartLocal(
				tokstatsDayKeyLocal(Number.isFinite(data?.generatedAt) ? data.generatedAt : Date.now()));
			const weeklyCard = weekly.length > 1
				? react.createElement(TokstatsCard, {
					title: t("section.trend"),
					extra: tCount(t, "extra.weeks", weekly.length, {}),
				},
					weekly.map((week) => {
						// 本周还没过完：数字每天在涨，把它和完整的周并排比会读成「用量掉了」。
						// 因此整行置灰 + 标签后缀「进行中」+ tooltip 说明，三处一起说清楚。
						// 只标本周不标「被窗口切掉的头尾周」：那种截断是「窗口内合计」的
						// 固有口径，读者按「本周仍未完」判断即可，多标反而噪音。
						const inProgress = week.weekStart === currentWeekStart;
						const weekEnd = tokstatsDayShiftLocal(week.weekStart, 6) ?? week.weekStart;
						const span = t("daily.span", {
							start: tokstatsDayLabel(week.weekStart),
							end: tokstatsDayLabel(weekEnd),
						});
						const tipParams = {
							span,
							input: fmtTok(tokstatsBilled(week)),
							output: fmtTok(week.out ?? 0),
						};
						return react.createElement(TokstatsMeter, {
							key: week.weekStart,
							label: [
								tokstatsDayLabel(week.weekStart),
								inProgress
									? react.createElement("span", { key: "now", className: "dsh-tokstats-weekNow" },
										t("week.inProgress"))
									: null,
							],
							ratio: weekMaxCalls > 0 ? (week.calls ?? 0) / weekMaxCalls : 0,
							value: tCount(t, "cell.calls", week.calls ?? 0, {}),
							detail: t("cell.weekDetail", {
								input: fmtTok(tokstatsBilled(week)),
								output: fmtTok(week.out ?? 0),
							}),
							dim: inProgress,
							title: tCount(t, inProgress ? "tip.weekOpen" : "tip.week", week.calls ?? 0, tipParams),
						});
					}))
				: null;

			const workspaceCard = workspaces.length > 0
				? react.createElement(TokstatsCard, {
					title: t("section.workspace"),
					extra: tCount(t, "extra.workspaces", workspaces.length, {}),
				},
					workspaces.map((entry) => react.createElement(TokstatsMeter, {
						key: entry.path,
						label: tokstatsPathTail(entry.path),
						ratio: workspaceTotalCalls > 0 ? (entry.calls ?? 0) / workspaceTotalCalls : 0,
						value: tCount(t, "cell.calls", entry.calls ?? 0, {}),
						detail: t("cell.workspaceDetail", {
							input: fmtTok(tokstatsBilled(entry)), output: fmtTok(entry.out ?? 0)
						}),
						title: tCount(t, "tip.workspace", entry.calls ?? 0, {
							path: entry.path, input: fmtTok(tokstatsBilled(entry)), output: fmtTok(entry.out ?? 0)
						}),
					})))
				: null;

			// 模型排行（Q11/Q13）：与工作区卡同构——全量列出、占比条、次数、明细。
			// 标签是 host 拼好的不透明串（client 不拆、不解释，I1′）；空串行是
			// 「未标注」，文案走词典并加 dim（既有的 .dsh-tokstats-dim）。
			const routeCard = routes.length > 0
				? react.createElement(TokstatsCard, {
					title: t("section.route"),
					extra: tCount(t, "extra.routes", routes.length, {}),
				},
					routes.map((entry) => {
						const unattributed = entry.rt === "";
						const label = unattributed ? t("route.unattributed") : entry.rt;
						const hit = tokstatsHit(entry);
						const billed = tokstatsBilled(entry);
						return react.createElement(TokstatsMeter, {
							// 空串不能当 React key（重复 key 警告且会错配行），换固定非空串。
							key: unattributed ? "\u0000unattributed" : entry.rt,
							label: label,
							dim: unattributed,
							ratio: routeTotalCalls > 0 ? (entry.calls ?? 0) / routeTotalCalls : 0,
							value: tCount(t, "cell.calls", entry.calls ?? 0, {}),
							detail: t("cell.routeDetail", {
								input: fmtTok(billed), output: fmtTok(entry.out ?? 0), hit: hit
							}),
							title: tCount(t, "tip.route", entry.calls ?? 0, {
								route: label,
								input: fmtTok(billed),
								output: fmtTok(entry.out ?? 0),
								hit: hit,
							}),
						});
					}))
				: null;

			// promptopt 使用情况（AC-13）：只有计数可用时才渲染整块。
			const promptoptCounters = promptopt !== null && typeof promptopt === "object" ? promptopt : null;
			const promptoptStarted = promptoptCounters?.started ?? 0;
			const promptoptAdopted = promptoptCounters?.adopted ?? 0;
			const promptoptRate = promptoptStarted > 0 ? Math.round((promptoptAdopted / promptoptStarted) * 100) : 0;
			const promptoptCard = promptoptCounters !== null
				? react.createElement(TokstatsCard, {
					title: t("section.promptopt"),
					extra: promptoptStarted > 0 ? t("extra.adoptRate", { rate: promptoptRate }) : undefined,
				},
					react.createElement("div", { className: "dsh-tokstats-miniGrid" },
						react.createElement(TokstatsRow, {
							label: t("row.promptopt"),
							value: t("value.promptopt", {
								started: promptoptStarted,
								adopted: promptoptAdopted,
								dismissed: promptoptCounters.dismissed ?? 0,
							}),
							title: t("tip.promptopt", {
								started: promptoptStarted,
								adopted: promptoptAdopted,
								dismissed: promptoptCounters.dismissed ?? 0,
								delta: (promptoptCounters.charsDelta ?? 0) >= 0
									? "+" + String(promptoptCounters.charsDelta ?? 0)
									: String(promptoptCounters.charsDelta ?? 0),
							}),
						}),
						react.createElement(TokstatsRow, {
							label: t("row.charsDelta"),
							dim: (promptoptCounters.charsDelta ?? 0) === 0,
							value: ((promptoptCounters.charsDelta ?? 0) >= 0 ? "+" : "") + String(promptoptCounters.charsDelta ?? 0),
							title: t("tip.charsDelta"),
						})))
				: null;

			// ── 顶部：两张时间图并排（柱图在左、热力图在右）──────────────────
			//
			// 只有一张时（单日模式隐藏柱图 / 旧 host 没有 heatDaily）独占整行：
			// 套双列会空出另一半。两张都是图、天然等高，`stretch` 正好把余量交给
			// 柱图的绘图区（不浪费）。
			const chartCards = [singleDay !== null ? null : dailyCard, heatCard]
				.filter((card) => card !== null && card !== undefined);
			const chartRow = chartCards.length === 0
				? null
				: chartCards.length === 1
					? react.createElement("div", { className: "dsh-tokstats-grid" }, chartCards)
					: react.createElement("div", { className: "dsh-tokstats-pairGrid" }, chartCards);

			// ── 下方：**自适应两列**（每张卡保持自己的高度，不再强行等高）──────
			//
			// 原来是「一行两卡 + align-items:stretch」：两卡内容高度经常差一大截
			// （上下文长度分布 6 行 vs 模型排行 16 行，实测矮的那张下方空了 400+px），
			// 强行等高只是把空白搬进卡片里。现在按**估算高度**把卡片贪心分进两列，
			// 列内自上而下紧挨着排——空白只可能出现在最后一屏的页尾。
			//
			// 估算用「行数 × 单行高度 + 卡片头」：模型的条一行约 46px（标签行 + 明细行），
			// 两列的这份估算只用来决定「放进哪一列」，不参与任何数值展示，因此不需要
			// 精确到像素（量错一两行只影响分配，不影响渲染）。
			const estimateCard = (rows, rowHeight = 46) => 26 + rows * rowHeight;
			const flowCards = [
				// 顺序即「左列优先」：模型排行放左上，其余按高度往较矮的那列塞。
				{ card: routeCard, weight: estimateCard(routes.length) },
				{ card: bucketCard, weight: estimateCard(TOKSTATS_BUCKET_LABELS.length) },
				{ card: weeklyCard, weight: estimateCard(weekly.length) },
				{ card: workspaceCard, weight: estimateCard(workspaces.length) },
				{ card: promptoptCard, weight: estimateCard(2, 24) },
			].filter((entry) => entry.card !== null && entry.card !== undefined);

			const flowColumns = [[], []];
			const flowHeights = [0, 0];
			for (const entry of flowCards) {
				const target = flowHeights[0] <= flowHeights[1] ? 0 : 1;
				flowColumns[target].push(entry.card);
				flowHeights[target] += entry.weight;
			}
			// 一张卡时独占整行（另一列留空会更难看）；两张时正好一边一张。
			const flowRow = flowCards.length === 0
				? null
				: flowCards.length === 1
					? react.createElement("div", { className: "dsh-tokstats-grid" }, flowCards.map((entry) => entry.card))
					: react.createElement("div", { className: "dsh-tokstats-columns" },
						flowColumns.map((cards, index) => react.createElement("div", {
							key: index, className: "dsh-tokstats-column",
						}, cards)));

			const cards = react.createElement("div", { className: "dsh-tokstats-grid" },
				chartRow, flowRow);

			// 单日模式点进折叠日（TS-29）：面板**不显示任何数字**——那天的明细在读取期
			// 被 E1 排除，totals 会是 0，若照常渲染 KPI 四卡与各排行，读者看到的是
			// 「这一天一次都没用过」，而真相是「有量、但被归并进区间、按日拆不出来」。
			// 所以这种情况只渲染热力图卡（它自带折叠说明），且**不落进「暂无数据」空态**
			// ——空态文案「还没有 usage 记录」在这里同样是谎报。
			const body = phase === "loading"
				// 骨架而不是一行「统计中…」：加载完整页铺开就是跳版（样稿的第一条状态）。
				? react.createElement(TokstatsSkeleton, { t })
				: phase === "empty"
					? react.createElement("div", { className: "dsh-tokstats-empty" }, t("empty.noService"))
					: dayFolded
						? react.createElement(react.Fragment, null,
							react.createElement("div", { className: "dsh-tokstats-grid" }, heatCard))
						: !hasData
							// 空态要给出**下一步**（样稿：「说明原因，并提供明确下一步」）。
							// 这里的下一步是扩大时间范围：切到「全部」档本来就是已有能力，
							// 不是新异步；同时退出单日模式，否则「全部」会被 day 覆盖。
							? react.createElement("div", { className: "dsh-tokstats-empty" },
								react.createElement("div", { className: "dsh-tokstats-emptyText" }, t("empty.noData")),
								react.createElement("button", {
									type: "button",
									className: "dsh-tokstats-emptyAction",
									onClick: () => {
										backgroundRef.current = false;
										setSingleDay(null);
										setRangeId("all");
									},
								}, t("empty.allTime")))
							: react.createElement(react.Fragment, null, kpis, cards);

			// 页脚区间：单日模式必须显示**那一天**，不是「窗口下界 – 今天」。
			//
			// 为什么必须改：`windowStart` 在单日模式下等于所选日，而右端仍取「今天」
			// ——于是页脚会写「10/20 – 10/25」而面板里全是 10/20 的数，读者会以为
			// 面板算错了区间。单日模式下左右两端都是同一天。
			// 「当日」档与单日模式都只有一个日期：写成「10/25 – 10/25」既啰嗦又像算错了
			// 区间，统一用单日形态（`foot.rangeSingle`）。
			const singleLabelDay = singleDay !== null
				? singleDay
				: (days === 1 && windowStart.length > 0 ? windowStart : null);
			const rangeLabel = singleLabelDay !== null
				? t("foot.rangeSingle", { day: tokstatsDayLabel(singleLabelDay) })
				: windowStart.length > 0
					? t("foot.range", { start: tokstatsDayLabel(windowStart), end: tokstatsDayLabel(tokstatsDayKeyLocal(Date.now())) })
					: t("foot.rangeAll");

			return react.createElement("div", { className: "dsh-tokstats-page", role: "region", "aria-label": t("panel.title") },
				react.createElement("div", { className: "dsh-tokstats-pageHeader" },
					// 标题与口径**成组**放在左列，刷新按钮在右侧垂直居中：这样页头高度是
					// max(标题 24 + 口径 16, 按钮 32) + 12 = 52px。若把口径做成「独占整行」
					// 的 flex 项，按钮那 32px 会先把第一行撑高，页头变成 60px。
					react.createElement("div", { className: "dsh-tokstats-pageHeaderText" },
						react.createElement("div", { className: "dsh-tokstats-pageTitleRow" },
							react.createElement("span", { className: "dsh-tokstats-title" }, t("panel.title")),
							react.createElement("span", { className: "dsh-tokstats-badge" }, phase === "loading" ? t("state.pending") : "")),
						// 页头口径（SPEC §4.2）：静态说明，不挂任何状态；窄窗折行而不截断
						// ——被截一半的口径比没有口径更容易误导。
						react.createElement("span", { className: "dsh-tokstats-pageCaliber" }, t("header.caliber"))),
					react.createElement("button", {
						type: "button",
						className: "dsh-tokstats-refresh" + (phase === "loading" ? " dsh-tokstats-refreshBusy" : ""),
						title: t("action.refresh"),
						"aria-label": t("action.refresh"),
						disabled: phase === "loading",
						// 用户主动刷新：清掉「后台重拉」标记（TS-25）。手动刷新是
						// 「我要最新的」，此刻旧数据已无参考价值，该换成 loading 态。
						onClick: () => { backgroundRef.current = false; setNonce(nonce + 1); },
					}, react.createElement(TokstatsRefreshIcon, null))),
				react.createElement("div", { className: "dsh-tokstats-toolbar" },
					react.createElement("div", { className: "dsh-tokstats-switches" },
						TOKSTATS_RANGES.map((entry) => rangeButton(entry))),
					// 面包屑（单日模式的退出入口，D1 / AC-10）：日期 + 「全部区间」。
					// 放在工具条里而不是卡片里：它是「当前视图口径」的指示，与五档同级。
					//
					// 可见文字只有日期（`10/22`）；整句说明走 aria-label ——
					// 把「10/22 的单日用量，返回全部区间」整句摊在工具条上会挤掉档位按钮。
					singleDay !== null
						? react.createElement("div", { className: "dsh-tokstats-crumb", role: "status" },
							react.createElement("span", {
								className: "dsh-tokstats-crumbDay",
								"aria-label": t("crumb.aria", { day: tokstatsDayLabel(singleDay) }),
								title: t("crumb.aria", { day: tokstatsDayLabel(singleDay) }),
							}, tokstatsDayLabel(singleDay)),
							react.createElement("button", {
								type: "button",
								className: "dsh-tokstats-crumbExit",
								onClick: () => { backgroundRef.current = false; setSingleDay(null); },
							}, t("crumb.exit")))
						: null,
					workspaces.length > 0
						? react.createElement("select", {
							className: "dsh-tokstats-select",
							value: workspace,
							// 用户主动切工作区：同样清掉后台标记（TS-25），口径变了就
							// 不能留着旧工作区的数字。
							onChange: (event) => {
								backgroundRef.current = false;
								setWorkspace(event?.target?.value ?? "");
							}
						},
							react.createElement("option", { value: "" }, t("workspace.all")),
							workspaces.map((entry) => react.createElement("option", {
								key: entry.path, value: entry.path
							}, tCount(t, "workspace.item", entry.calls, { path: entry.path }))))
						: null),
				react.createElement("div", { className: "dsh-tokstats-body" }, body),
				react.createElement("div", { className: "dsh-tokstats-foot" },
					data !== null && Number.isFinite(data.generatedAt)
						? t("foot.generated", { time: tokstatsClock(data.generatedAt) })
						: "",
					// 状态徽标（TS-24 的可见面）：颜色 + 圆点 + 文字三重表达。
					// 后台校验中时它变成警告色并脉冲——「这一帧是缓存值、数字还会变」
					// 这件事之前只有一句灰字，读者要么忽略、要么以为面板坏了。
					react.createElement(TokstatsStatusChip, { state: statusState, t }),
					// 覆盖率披露（TS-21 / AC-2）：sessions 缺失（旧 host）时整句不渲染。
					// 计数走 .one/.other 成对键（硬规则 7），不是把数字拼进固定句子。
					coverageSessions !== null
						? react.createElement("span", {
							className: "dsh-tokstats-footCoverage",
							// tooltip 一句话说清「覆盖了多少、其中多少读不出来」。两个数都要，
							// 但计数键走 tCount（注入 count），会话总数走显式参数。
							title: coverageSkipped > 0
								? tCount(t, "tip.coverageSkipped", coverageSkipped, { sessions: coverageSessions })
								: tCount(t, "tip.coverage", coverageSessions, {}),
						},
							tCount(t, "foot.coverage", coverageSessions, {}),
							coverageSkipped > 0
								? react.createElement("span", { className: "dsh-tokstats-footSkipped" },
									tCount(t, "foot.skipped", coverageSkipped, {}))
								: null)
						: null,
					data !== null ? react.createElement("span", { className: "dsh-tokstats-footRange" }, rangeLabel) : null));
		}

		const tokstatsCss = [
			// 页面骨架：头部（标题 + 角标 + 刷新）/ 工具条（窗口档位 + 工作区）/ 可滚主体 / 页脚。
			//
			// ── 数据色（第五批）────────────────────────────────────────────────
			//
			// 面板里所有「表示量的色块」（柱、比例条、热力格、图例、选中档位）统一走
			// `--dsh-tokstats-accent`，值取宿主的**品牌蓝** `--dsw-alias-state-business-primary`
			// （暗色 deepseek-400 `#7aaaff`、亮色 deepseek-500 `#4176e6`，两套主题都由宿主定义）。
			//
			// 为什么不用 `--dsw-alias-brand-primary`：它在暗色主题里近白（neutral-bluish-50）、
			// 亮色里近黑（neutral-bluish-1000），**色相为零**——于是整块面板（柱、热力图、
			// 比例条、选中态）全是灰阶，看着像没上色。business-primary 是宿主自己的强调色，
			// 也是宿主 focus ring 的 fallback（`--dsw-focus-ring-color`），语义上就是
			// 「可交互 / 有数据」的那抹颜色，借来最不容易跟宿主撞车。
			//
			// 兜底链保留 brand-primary：旧宿主或缺该 token 时退回原来的观感，不变成无色
			// （var 里写 `, ` 才是兜底，写多个 var 会取第一个已定义的）。
			//
			// `--dsh-tokstats-on-accent` 是「落在蓝底上的文字」：取**卡片底色**（暗色下
			// 深字、亮色下白字），等于把底挖空，两套主题都自然可读；不要用
			// `label-primary-inverted`——它是「与 brand-primary 相反」的色，brand 换成蓝之后
			// 那个反色就跟着失效。
			//
			// ── 排印与间距标尺（视觉刷新 batch 1，SPEC §5.2–5.3）─────────────
			//
			// 字号只留 11 / 12 / 13 / 16 / 24 五档，且**字号与行高成对写死**
			//（16/24、13/20、12/18、11/16、24/30），不用 `1.5em` 这类相对行高：相对值
			// 在 12 与 24 两档上算出的行高不同，标签与主值会各自「呼吸」，层级反而糊。
			//
			// 层级自上而下：页面标题 16/24·600 → 卡题 13/20·600 → KPI 标签
			// 12/18·500 → 正文 12/18 → 副值 11/16。24/30·600 的 KPI 主值是面板里
			// 唯一超过 16px 的字，靠字号而不是靠颜色抢第一眼——这也是「不做彩色
			// KPI」在排印上的前提：主值够大，就不需要色块帮忙。
			//
			// 间距只用 4 / 8 / 12 / 16 / 20 / 24 / 32 的标尺。KPI 卡与内容卡同为
			// 12px 内边距 + 12px 间隙：卡片之间与卡片内部的留白相等时，四张 KPI
			// 才读起来是一组「格子」，而不是四个各自为政的方块。
			//
			// 页面根节点承接正文排版（12/18），并声明全局数字字形
			// `tabular-nums lining-nums`：等宽数字让同列位数对齐，lining 让数字
			// 与中文的基线一致（oldstyle 数字会上下错位）。子规则里若单独写
			// `font-variant-numeric` 会把继承值整个覆盖，因此需要覆盖的地方必须
			// 把两个词一起写全。
			".dsh-tokstats-page{--dsh-tokstats-accent:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));--dsh-tokstats-on-accent:var(--dsw-alias-bg-layer-1);--dsh-tokstats-cell:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,var(--dsw-alias-bg-layer-1));box-sizing:border-box;height:100%;color:var(--dsw-alias-label-secondary);flex-direction:column;display:flex;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums lining-nums;overflow:hidden}",
			// 页头：左列「标题 + 口径」，右侧刷新按钮垂直居中。高度 = max(24 + 16, 32)
			// + 12 = 52px；按钮是 32px（控件规格），所以纵向内边距只能给 6px。
			//
			// 不把口径写成「独占整行」的 flex 项：那样按钮的 32px 会先把第一行撑高，
			// 页头变 60px——同一句 11px 的附注要多花 8px 高度。
			".dsh-tokstats-pageHeader{box-sizing:border-box;align-items:center;gap:8px;min-height:44px;padding:6px 20px;display:flex;flex:none}",
			".dsh-tokstats-pageHeaderText{flex:1 1 auto;min-width:0;display:flex;flex-direction:column}",
			".dsh-tokstats-pageTitleRow{align-items:center;gap:8px;min-width:0;display:flex}",
			// 页头口径 11/16·tertiary（SPEC §4.2）：第三条信息层。允许换行
			// （`white-space:normal`）——窄窗里宁可折成两行，也不省略号截断：
			// 被截一半的口径比没有口径更容易误导。
			".dsh-tokstats-pageCaliber{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;white-space:normal}",
			// 页面标题 16/24·600（SPEC §5.2）：比卡题重一档、大一档，但仍远小于
			// 营销式大标题——嵌入式面板里 16px 已经足够成为「这一屏是什么」的锚点。
			// `nowrap` + 省略号：标题变长时挤掉刷新按钮是最难发现的布局回归。
			".dsh-tokstats-title{color:var(--dsw-alias-label-primary);font-size:16px;font-weight:600;line-height:24px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dsh-tokstats-badge{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}",
			".dsh-tokstats-badge:empty{display:none}",
			// 刷新按钮是**控件**，尺寸跟工具条的档位按钮对齐（32px）。图标仍是 14px，
			// 靠内边距撑开——图标放大只会让它看起来像个主按钮，而这里要的是「安静但
			// 够得着」。
			//
			// `::before` 把命中区外扩 6px（32 + 12 = 44，SPEC §5.4 的触屏下限）：
			// 用绝对定位的透明层而不是加大按钮本身，页头高度不会被顺带撑开。
			".dsh-tokstats-refresh{margin-left:auto;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:6px;width:32px;height:32px;padding:0;display:inline-flex;align-items:center;justify-content:center;flex:none;position:relative}",
			".dsh-tokstats-refresh::before{content:\"\";position:absolute;inset:-6px}",
			".dsh-tokstats-refresh:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			".dsh-tokstats-refresh:disabled{cursor:default;opacity:.5}",
			".dsh-tokstats-refreshBusy svg{animation:dsh-tokstats-spin 1s linear infinite}",
			"@keyframes dsh-tokstats-spin{to{transform:rotate(360deg)}}",
			// 工具条：档位开关 + 面包屑 + 工作区。控件统一 32px 高（SPEC §5.4）、
			// 纵向留白 12px 与卡片间距同值——工具条与下方 KPI 之间不该出现第三种间距。
			".dsh-tokstats-toolbar{align-items:center;gap:12px;padding:0 20px 12px;display:flex;flex:none;flex-wrap:wrap}",
			// 档位容器只做「一组」的视觉收拢：2px 轨道 + 2px 内边距 + 28px 按钮 = 32px。
			// 不描边——工具条自身没有边框，容器再描一圈会多出一条来路不明的水平线。
			".dsh-tokstats-switches{gap:2px;display:flex;background:var(--dsw-alias-bg-layer-1);border-radius:8px;padding:2px}",
			// 未选中：透明底 + 次文字色。这里刻意从 tertiary 提到 secondary——tertiary
			// 是坐标轴、图注、副值那一层，档位是**可点**的控件，用最弱一档会和图注混成
			// 一类，且「能点」这件事在视觉上没有任何证据。500 字重让它在不靠颜色的前提下
			// 仍比图注更实。
			".dsh-tokstats-switch{color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:6px;padding:5px 12px;font:inherit;font-size:12px;font-weight:500;line-height:18px;min-height:28px}",
			".dsh-tokstats-switch:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			// 选中态（AC-7）：**数据色实心 + 挖空文字**。此前用 brand-primary：
			// 它在暗色主题下近白、亮色下近黑，与容器底只差明度、没有色相，选中项看起来
			// 像「一个白色小方块」而不是「当前选中」。改用与图表同一抹蓝之后，工具条
			// 与数据区的颜色语言一致，蓝色本身也足够成为视觉锚点（明暗主题各自成立：
			// 暗色浅蓝配深字、亮色深蓝配白字，见 on-accent 的定义）。
			//
			// `:hover` 那条必须紧跟其后：`.dsh-tokstats-switch:hover` 是「一个类 +
			// 伪类」，特异性高于单个类选择器，不补这一条时鼠标停在选中项上会把
			// 数据色底覆盖回 hover 灰，选中态在悬停时消失。
			// 选中态 = **accent 派生软底 + accent 派生文字 + 1px accent 内描边**（SPEC §5.4）。
			//
			// 为什么不再是实心 accent：这块面板每个数字都跟着档位走，但「选中」需要的
			// 是**一眼认出**，不是一块最重的色——实心底色会和 KPI 主值、柱体抢同一档
			// 注意力，而工具条在阅读顺序上排在数据之后。软底仍由同一个
			// `--dsh-tokstats-accent` 派生（TS-32 的色彩契约不变），只是把「量」从
			// 100% 降到 18%：选中态从「一块色」变成「一层底」。
			//
			// 文字色为什么再混 30% 的 `label-primary`：纯 accent 压在 18% 的淡蓝底上，
			// 亮色主题只有约 3.2:1（12px 文字要求 4.5:1）。混入当前主题的主文字色后
			// 亮色约 5.6:1、暗色约 6.2:1，两套主题都过线，色相仍是 accent 的蓝；
			// `label-primary` 本身随主题翻转，所以同一条式子两边各自成立。
			//
			// 描边必须走 `inset` box-shadow 而不是 border：border 会把按钮撑高 2px，
			// 刚对齐的 32px 控件高度（28px 按钮 + 2×2 容器内边距）当场破掉。
			".dsh-tokstats-switchOn{background:color-mix(in srgb,var(--dsh-tokstats-accent) 18%,var(--dsw-alias-bg-layer-1));color:color-mix(in srgb,var(--dsh-tokstats-accent) 70%,var(--dsw-alias-label-primary));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsh-tokstats-accent) 45%,transparent)}",
			".dsh-tokstats-switchOn:hover{background:color-mix(in srgb,var(--dsh-tokstats-accent) 24%,var(--dsw-alias-bg-layer-1));color:color-mix(in srgb,var(--dsh-tokstats-accent) 70%,var(--dsw-alias-label-primary))}",
			// 工作区保持原生 `select`（SPEC §5.4 明确不改成自定义组合框：自定义控件要
			// 自己处理键盘、弹出层、焦点陷阱与长列表滚动，换来的只是「好看一点」）。
			//
			// 边框写 1px 而不是 0.5px：0.5px 在 1x 屏被四舍五入成 1px、在 2x 屏上变成
			// 发丝线，同一套 token 在不同 DPI 下长相不一致；SPEC §5.1 也写了「1px，不用
			// 0.5px 发丝线」。高度 6+6+18+2 = 32px，与档位按钮对齐。
			".dsh-tokstats-select{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-button-elevated-fill);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:6px 10px;font:inherit;font-size:12px;line-height:18px;min-height:32px;max-width:320px}",
			".dsh-tokstats-body{flex:1;min-height:0;padding:0 20px 16px;overflow-y:auto}",
			".dsh-tokstats-empty{color:var(--dsw-alias-label-tertiary);padding:32px 8px;text-align:center}",
			".dsh-tokstats-emptyText{margin-bottom:12px}",
			// 空态的下一步：与工具条控件同规格（12/18、28px 高、6px 圆角），
			// 不抢主色——它是个出口，不是主操作。
			".dsh-tokstats-emptyAction{color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:5px 12px;font:inherit;font-size:12px;line-height:18px;min-height:28px}",
			".dsh-tokstats-emptyAction:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			// ── 首屏骨架（对应样稿 LOADING）──────────────────────────────────
			//
			// 骨架块不用动画（无 shimmer）：静态灰块已经足够占位，脉冲只会让首屏多一个
			// 一直在动的图层；而且静态块天然满足「减少动效」偏好，不需要再写一条例外。
			// 灰块浓度取 label-primary 的 8% / 12%（两档）：`color-mix` 保证明暗主题下
			// 都是「比底色略深」，不会在亮色主题里变成浅灰、暗色主题里变成亮灰。
			".dsh-tokstats-skeleton{display:flex;flex-direction:column;gap:12px}",
			// 仅屏幕阅读器可见：「统计中…」仍要说出来，但视觉上由骨架承担占位。
			".dsh-tokstats-srOnly{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}",
			".dsh-tokstats-skCard{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:10px;padding:12px;min-width:0;min-height:100px;display:flex;flex-direction:column;gap:8px}",
			".dsh-tokstats-skBar{display:block;height:10px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}",
			".dsh-tokstats-skNumber{display:block;width:58%;height:24px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent)}",
			".dsh-tokstats-skChartCard{min-height:220px}",
			".dsh-tokstats-skBars{flex:1;align-items:flex-end;gap:8px;margin-top:4px;display:flex}",
			".dsh-tokstats-skBars i{flex:1;border-radius:3px 3px 0 0;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}",
			// KPI 行：四个指标卡，窄屏自动折成两列。**不设口径说明行**——四卡与
			// 下方图表同一个窗口，由工具条的档位开关表达（第五批把四卡从「固定当日」
			// 改成「跟随档位」之后，那行说明既占高度又成了重复信息）。
			//
			// 下限 160px：主值升到 24px 之后，「7,804,200」这种七位数字在 150px 卡
			// 里已经压到边框，副值更是必然省略。`auto-fit` 保留自动折列，但**折列
			// 门槛由卡片内容决定**，不像固定 `repeat(4,1fr)` 那样把数字挤扁。
			".dsh-tokstats-kpiGrid{gap:12px;margin:0 0 12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}",
			// KPI 卡：12px 内边距，与卡间距同值（SPEC §5.3）。三者（标签 / 主值 /
			// 副值）的纵向关系交给各自的 margin，不用 `gap`——标签到主值要 8px、
			// 主值到副值只需 4px，gap 只能取同一个值，取 8 会让副值离主值太远、
			// 读起来像另一个指标。
			".dsh-tokstats-kpi{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:10px;flex-direction:column;min-width:0;padding:12px;display:flex}",
			// KPI 标签 12/18·500，用 `label-secondary` 而**不是** tertiary：tertiary 是
			// 副值 / 坐标那一层，标签与副值同色时「这是哪个指标」和「这个指标怎么算」
			// 就分不出来了。500 的字重让它在不靠颜色的前提下仍比副值更实。
			".dsh-tokstats-kpiLabel{color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;overflow:hidden;font-size:12px;font-weight:500;line-height:18px;margin-bottom:8px}",
			// KPI 主值 24/30·600：面板里最大的字。`letter-spacing:-.02em` 是 24px 数字
			// 的收字距上限（再紧就粘连），`nowrap` + 省略号保证七位数字不会撑破卡片。
			".dsh-tokstats-kpiValue{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums lining-nums;letter-spacing:-.02em;font-size:24px;font-weight:600;line-height:30px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}",
			// 副值 11/16（最小可读层），与主值只隔 4px——它是主值的注解，不是独立信息。
			".dsh-tokstats-kpiHint{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums lining-nums;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;font-size:11px;line-height:16px;margin-top:4px}",
			// 卡片栅格：单列容器（时间图一行 + 下方自适应两列）。间距统一 12px
			//（SPEC §5.3），与卡片内边距同值，栏线才等距。
			".dsh-tokstats-grid{gap:12px;display:grid;grid-template-columns:1fr}",
			// 时间图并排（日柱图在左、热力图在右）：**1.45 : 1**，两卡等高（stretch），
			// 高度以较高的那张为准，短的那张把内容顶部对齐。
			//
			// 为什么不是 1:1（v0.8.0 曾是 1:1，理由是「让三行对齐成同一根栏线」）：
			// 两张图回答的问题不同——日柱图是**主图**（逐日走势，30 列时每列只有 9–13px，
			// 再窄就退化成一排竖线），热力图是**索引**（12×7 的定位用图，格子有 24px
			// 上限、整图封顶 310px，给再多宽度也用不上）。1:1 把宽度平均分给两者，
			// 结果是主图被压窄、副图留白——栏线对齐换来的是主图失真。样稿也是 1.45:1。
			//
			// 折成单列的门槛 820px：等宽分栏后每张卡只剩约 (视口 − 侧栏 − 48)/2，
			// 低于 820px 时热力图格子会压到 18px 以下、柱图横向刻度开始挤，那时并排
			// 已经不划算了。
			".dsh-tokstats-pairGrid{gap:12px;display:grid;grid-template-columns:1.45fr 1fr;align-items:stretch}",
			"@media (max-width:820px){.dsh-tokstats-pairGrid{grid-template-columns:1fr}}",
			// 自适应两列（TS-31）：**每张卡保持自己的高度**，列内自上而下紧挨着排。
			//
			// 刻意不用 `display:grid` + `align-items:stretch`：栅格的行高由该行最高的
			// 那张卡决定，矮卡被拉高后下半张是空的（实测「上下文长度分布 6 行 vs
			// 模型排行 16 行」时空出 400+px）。flex 列容器里卡片是普通块级项，高度
			// 由内容决定，空白只可能留在页尾。
			".dsh-tokstats-columns{gap:12px;display:flex;align-items:flex-start}",
			".dsh-tokstats-column{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px}",
			"@media (max-width:820px){.dsh-tokstats-columns{flex-direction:column;align-items:stretch}.dsh-tokstats-column{width:100%}}",
			// 下方两列（桶分布 / 周趋势 / 排行）仍按 `flex:1` 等宽：它们是**平级**的明细，
			// 没有「主图 / 索引」之分，等宽才对得上栏线。上方 `.pairGrid` 的 1.45:1
			// 是**唯一的例外**，理由见上——别把它当成通用规则抄到别处。
			//
			// （`.pairGrid` 先前在这里被重复声明了一次，值完全相同，只是历史遗留；
			// 已删掉重复项，避免「改一处没生效」的错觉。）
			// 内容卡：内边距 12px 与卡间距同值（SPEC §5.3）。圆角 10px、1px 宿主
			// 边框、无阴影——阴影留给浮层，卡片靠「边框 + 留白」分层。
			".dsh-tokstats-card{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:10px;flex-direction:column;min-width:0;padding:12px;display:flex}",
			// 卡头是**一行**：左标题、右结论，垂直居中对齐。曾经加过第二行「口径副标题」
			// （向样稿的 cardmeta 看齐），实际全是复述——标题已写明口径、卡内已有行标签，
			// 所以撤回。`align-items:center` 是单行头的正确取值：两端文字同一基线。
			".dsh-tokstats-cardHead{align-items:center;gap:8px;margin-bottom:8px;display:flex}",
			// 卡题 13/20·600：比 KPI 标签（12/18·500）大且重一档，于是「这是哪块数据」
			// 与「这是哪项指标」不会读成同一层。`min-width:0` 让右侧附加信息拿到
			// 省略空间而不是把标题挤出去。
			".dsh-tokstats-cardTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dsh-tokstats-cardExtra{color:var(--dsw-alias-label-tertiary);margin-left:auto;font-variant-numeric:tabular-nums lining-nums;font-size:11px;line-height:16px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none;max-width:60%}",
			// 行列表（promptopt 计数器用）：只有「标签 + 数值」两列，不需要比例条。
			".dsh-tokstats-row{align-items:center;gap:12px;padding:2px 0;display:flex}",
			".dsh-tokstats-rowLabel{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums lining-nums;min-width:0;text-overflow:ellipsis;white-space:nowrap;flex:none;max-width:42%;overflow:hidden}",
			".dsh-tokstats-rowValue{font-variant-numeric:tabular-nums lining-nums;color:var(--dsw-alias-label-primary);margin-left:auto;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}",
			// 比例条（桶分布 / 工作区排行 / 周趋势共用）：标签、轨道、值三列固定位置，
			// 轨道吃满中间——条长只有在同一起点、同一终点时才可比。
			//
			// 轨道 6 → 4px（SPEC §5.4）：6px 的轨道在明细卡里比正文还粗，读者会先看到
			// 一条色带再去找它对应哪个标签；4px 仍足以表达「差不多 / 差一截」，
			// 而且一张卡能少掉两行高度。填充与轨道同圆角（2px），圆角大于半高会
			// 让 4px 轨道两端变成药丸形，短条看起来像被切平了。
			".dsh-tokstats-meter{align-items:center;column-gap:12px;row-gap:0;padding:4px 0;display:grid;grid-template-columns:minmax(0,12.5em) minmax(40px,1fr) auto;grid-template-areas:'label track value' 'detail detail detail'}",
			".dsh-tokstats-meterLabel{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums lining-nums;grid-area:label;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}",
			".dsh-tokstats-meterTrack{background:var(--dsw-alias-bg-layer-2);border-radius:2px;grid-area:track;height:4px;overflow:hidden}",
			".dsh-tokstats-meterFill{background:var(--dsh-tokstats-accent);border-radius:2px;display:block;height:100%}",
			".dsh-tokstats-meterValue{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums lining-nums;grid-area:value;text-align:right;white-space:nowrap}",
			".dsh-tokstats-meterDetail{color:var(--dsw-alias-label-tertiary);grid-area:detail;font-variant-numeric:tabular-nums lining-nums;font-size:11px;line-height:16px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			// ── 热力图（TS-28）────────────────────────────────────────────────
			//
			// 12 列 × 7 行（列 = 自然周，行 = 周内第几天，周一在最上）。格子用
			// `aspect-ratio:1` 保持正方形，`grid-template-columns:repeat(12,1fr)`
			// 让窄窗下整图等比收缩而不溢出（SPEC §6 的风险项）。
			//
			// **`grid-auto-flow:column` 是布局正确性的关键**：DOM 顺序是「一周的
			// 七天」连排（week1 的周一…周日，再 week2…），而 CSS Grid 默认按行填
			// （row flow）。不指定 column 时前 12 个格子会横着占满第一行，于是
			// 「第一行」变成「十二个周一」——列不再是自然周，整张图的读法全错。
			// 配 `grid-template-rows:repeat(7,…)` 固定 7 行，周一才真正在最上。
			//
			// **格子有尺寸上限 30px、整图有宽度上限 393px**：纯 `1fr` 在整行卡片里
			// 会把每格拉到 ~95px，热力图变成七行巨大色块并把下面所有卡片挤出首屏
			// （实测全宽 1600×1000 下整屏只剩热力图）。`minmax(0,30px)` 是双向钳：
			// 宽屏封顶 30px，窄屏按可用宽度收缩（并排后半宽卡片里约 26px），
			// `aspect-ratio:1` 保证仍是正方形。
			//
			// 30px 是「并排」之后的取值：12 列 × 30px + 11 个 3px 间隙 = 393px，
			// 整图高度 7×30+18=228px。比原来的 34px 版矮一截，与日柱图同行时两卡
			// 高度不至于差太多；`margin:4px auto 0` 让封顶后的余量两侧均分，图居中
			// 而不挤在左（`justify-content:center` 只影响列轨道在容器内的分布）。
			// ── 坐标系（视觉刷新：热力图补坐标）────────────────────────────────
			//
			// 12×7 的纯色块矩阵读不出「哪一列是哪一周、哪一行是周几」——这不是风格问题，
			// 是读者无法定位。样稿的做法是左列星期标 + 上方周标，这里对齐。
			//
			// 两列 `auto auto`：右列宽度由格子网格撑开（12×24 + 11×2 = 310 上限），
			// 于是列标与格子**共享同一条轨道宽度**。分别写死宽度是错位的来源——
			// 一旦格子换成 22px（窄屏收缩），写死的列标立刻对不上。
			".dsh-tokstats-heatFrame{column-gap:6px;row-gap:0;justify-content:center;max-width:340px;margin:2px auto 0;display:grid;grid-template-columns:auto auto;grid-template-rows:auto auto}",
			".dsh-tokstats-heatCorner{grid-area:1/1}",
			// 周标：与格子同样的 12 条轨道 + 同样的 2px 间距（少一个参数就会逐列累积偏移）。
			".dsh-tokstats-heatWeeks{grid-area:1/2;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:10px;line-height:14px;display:grid;grid-template-columns:repeat(12,minmax(0,24px));gap:2px;justify-content:center}",
			".dsh-tokstats-heatWeekTick{white-space:nowrap;overflow:visible}",
			// 行标：7 行与格子同高同间距，文字在每条轨道里垂直居中。
			".dsh-tokstats-heatDows{grid-area:2/1;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px;display:grid;grid-template-rows:repeat(7,minmax(0,24px));gap:2px;align-items:center}",
			".dsh-tokstats-heatDow{display:flex;align-items:center;justify-content:flex-end;padding-right:2px}",
			".dsh-tokstats-heat{grid-area:2/2;display:grid;grid-template-columns:repeat(12,minmax(0,24px));grid-template-rows:repeat(7,minmax(0,24px));grid-auto-flow:column;justify-content:center;gap:2px;max-width:310px;margin:0}",
			// 格子默认是**背景色**（零日无填充）。`border:none;padding:0` 清掉 button
			// 的默认外观——它是按钮（自带焦点与 Enter/Space 激活），不是装饰 div。
			".dsh-tokstats-heatCell{box-sizing:border-box;aspect-ratio:1;border-radius:2px;background:var(--dsh-tokstats-cell);border:none;padding:0;cursor:pointer;display:block;width:100%;font:inherit}",
			".dsh-tokstats-heatCell:disabled{cursor:default}",
			// 五档色阶（SPEC D8）：**单一色相 + 五档明度**。为什么不用五个不同色相：
			// `warn` / `error` 会把「用得多」误读成「出错了」，而颜色深浅本就是「量」
			// 的自然表达；多色相还会让读者以为这些格子是不同类别。
			//
			// 实现用 `color-mix(accent N%, bg-layer-2)` 而不是「同色 + opacity」：
			// ① opacity 会把格子**连同背后的卡片底色**一起透出来，深色主题下第一档
			//    （20%）几乎是纯底色，与零日格（也是 layer-2）差不出肉眼可辨的一档；
			// ② 图例要跟格子对得上，用 opacity 时图例还得自己再叠一层，两边算出来
			//    不是同一个颜色。color-mix 直接把色阶算成实色，两处共用同一条规则
			//    （`.dsh-tokstats-ramp` + `data-level`），图例与格子必然一致。
			".dsh-tokstats-ramp[data-level=\"1\"]{background:color-mix(in srgb,var(--dsh-tokstats-accent) 26%,var(--dsh-tokstats-cell))}",
			".dsh-tokstats-ramp[data-level=\"2\"]{background:color-mix(in srgb,var(--dsh-tokstats-accent) 44%,var(--dsh-tokstats-cell))}",
			".dsh-tokstats-ramp[data-level=\"3\"]{background:color-mix(in srgb,var(--dsh-tokstats-accent) 62%,var(--dsh-tokstats-cell))}",
			".dsh-tokstats-ramp[data-level=\"4\"]{background:color-mix(in srgb,var(--dsh-tokstats-accent) 81%,var(--dsh-tokstats-cell))}",
			".dsh-tokstats-ramp[data-level=\"5\"]{background:var(--dsh-tokstats-accent)}",
			// 未来日期（今天之后还没到的天）：不渲染成零格，而是留空占位。
			// 未来日期：**透明占位**（不填充、不可点）。不画描边也不进图例——「今天之后
			// 还没到」不需要额外的图解，格子里没有量本身就是答案；给每种「空」都配一个
			// 图例项会把图例变成一份说明书。
			".dsh-tokstats-heatCellEmpty{background:transparent;cursor:default}",
			// 零日格：**无填充 + 1px 内框**（样稿的「零日：实线内框」）。只靠明度差时，
			// 零日与卡片底色在亮色主题里几乎同色，「这天是 0」和「这里没画」读不出区别。
			// 内框用 `inset` box-shadow 而非 border：border 会改变格子尺寸，12 列当场错位。
			//
			// 三个 `:not` 是精确性所在：未来格（`.heatCellEmpty`，未到）与折叠格
			// （`data-folded`，已归并）都**不加**内框——它们的「空」各有别的语义，
			// 长得跟零日一样就分不出来了；有量的格子（`data-level`）本来就靠填充表达。
			".dsh-tokstats-heatCell:not([data-level]):not([data-folded]):not(.dsh-tokstats-heatCellEmpty){box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent)}",
			// 折叠区格子（TS-28 / AC-9）：沿用 TS-22 的**斜纹语义**，但**不复用同一个
			// 类名**——热力图折叠格与柱图折叠列是不同图形元素，共用类名会让「改柱图
			// 的折叠样式」意外改到热力图（PLAN §3.2.4 / 交接须知）。
			//
			// 斜纹表达的是「这一格不代表某一天的独立用量」，不能用颜色深浅表达
			// （会被读成数据大小）。透明层叠加，数据色仍在。
			".dsh-tokstats-heatFolded{background:repeating-linear-gradient(135deg,var(--dsh-tokstats-accent) 0 3px,transparent 3px 6px),var(--dsw-alias-bg-layer-2);opacity:.7;outline:1px dashed var(--dsw-alias-border-l1);outline-offset:-1px}",
			// 键盘光标（AC-11）：`aria-selected` 那一格加一圈实线，读者才知道方向键
			// 当前停在哪。用 outline 而不是 border：不改变格子尺寸，12 列布局不跳动。
			// 颜色取 `label-primary`（**不是**数据色）：环要压在蓝格上，用同色蓝等于
			// 自己盖自己，深浅档里根本看不出光标在哪。
			".dsh-tokstats-heatCell[aria-selected=\"true\"]{outline:2px solid var(--dsw-alias-label-primary);outline-offset:1px}",
			// 图例：两端标「少」「多」，中间是五档色块（与格子同色阶，读者可对照）。
			//
			// `justify-content:center` 必须与网格一致：网格在整行卡片里是居中的
			// （`minmax(0,34px)` 封顶后余量两侧均分），图例若留在左缘就会与图错开
			// 一大截——实测全宽下两者相距约 390px，读起来像两个无关的元素。
			// 图例字号跟坐标同一档（11/16，SPEC §5.2 的「副值 / 坐标 / 页脚」）：
			// 10px 在两套主题里都偏小，中文「少 / 多」会糊成一团灰。
			".dsh-tokstats-heatLegend{align-items:center;justify-content:center;gap:4px;margin-top:6px;display:flex;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}",
			".dsh-tokstats-heatLegendSwatch{width:10px;height:10px;border-radius:2px;background:var(--dsh-tokstats-cell);display:inline-block}",
			".dsh-tokstats-heatLegendSpacer{margin-left:auto}",
			// 折叠区不可按日拆时的说明（TS-29）：单日模式点进折叠日不显示数字。
			".dsh-tokstats-heatNote{color:var(--dsw-alias-label-tertiary);margin-top:6px;font-size:11px;line-height:16px}",
			// 面包屑（单日模式的退出入口）：它是 `.toolbar` 的子项，**不自带水平内边距**
			// ——父容器已经给了 20px，这里再写一次会让面包屑比档位按钮多缩进 20px，
			// 看起来像「另一个区域的开始」。纵向也不留白：与档位按钮同高由按钮决定。
			".dsh-tokstats-crumb{align-items:center;gap:8px;padding:0;display:flex;flex:none}",
			".dsh-tokstats-crumbDay{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums lining-nums;font-size:12px;font-weight:600;line-height:18px}",
			// 「返回」是**可点**的控件，尺寸跟档位按钮对齐（12px / 28px 高），
			// 不用 11px：同一行里出现两种控件字号会让工具条读起来像两个工具栏。
			".dsh-tokstats-crumbExit{color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:none;border-radius:6px;padding:5px 12px;font:inherit;font-size:12px;line-height:18px;min-height:28px}",
			".dsh-tokstats-crumbExit:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			// 单日模式下五档置灰（裁决 / PLAN §3.3.1）：**置灰不隐藏**——隐藏会让
			// 工具条高度变化、面板内容整体跳动。
			".dsh-tokstats-switch:disabled{cursor:default;opacity:.4}",
			".dsh-tokstats-switch:disabled:hover{background:0 0;color:var(--dsw-alias-label-tertiary)}",
			//
			// 结构：`.chart` 是两行两列的 grid —— 第 1 行 = 纵轴刻度列 + 绘图区，
			// 第 2 行 = 横轴（日期刻度，只占绘图区那一列）。用 grid 而不是 flex：
			// 纵轴必须与绘图区**同高**（刻度的 bottom 百分比以绘图区为参照系），
			// 而横轴那一行不属于刻度列的参照范围；grid 的行定义天然表达这一点。
			// flex 版本里纵轴的高度只能写死，并与「绘图区高度」互相抄一个数字。
			//
			// `flex:1` + 第 1 行 `minmax(0,1fr)` 让绘图区吃满卡片的剩余高度：与
			// 热力图并排时两卡等高，日柱图天然偏矮，剩余高度交给柱体而不是留白。
			".dsh-tokstats-chart{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-rows:minmax(0,1fr) auto;column-gap:6px;flex:1;min-height:0;margin-top:2px}",
			".dsh-tokstats-chartMain{grid-area:1/2;min-width:0;min-height:0;display:flex}",
			// 绘图区：柱容器撑满高度，网格线绝对定位在底边之上。底边那条 1px 边框
			// 就是「0 刻度」，因此网格线只画 70.7%（峰值÷2）与 100%（峰值）两条就
			// 够读出量级。`min-height:96px` 是「没有被拉伸时」的高度（旧 host 没有
			// 热力图、只有日柱图独占整行的那种情况）。
			".dsh-tokstats-chartPlot{position:relative;flex:1;min-height:88px;border-bottom:1px solid var(--dsw-alias-border-l1);display:flex}",
			// 网格线：主题变量、不写死颜色（深色主题下 --border-l1 是白色低透明度）。
			// 中间那条对应「峰值÷2」在**平方根刻度**下的真实位置 sqrt(0.5)=70.7%，
			// 不是 50%——与纵轴刻度共用同一个位置值，改一处必须改另一处。
			".dsh-tokstats-gridLine{position:absolute;left:0;right:0;border-top:1px dashed var(--dsw-alias-border-l1);pointer-events:none}",
			".dsh-tokstats-gridLineTop{bottom:100%}",
			".dsh-tokstats-gridLineMid{bottom:70.7%}",
			// 纵轴刻度：定宽右对齐，三个 span 按 bottom 绝对定位在刻度列内。刻度列是
			// grid 第 1 行第 1 列，**高度由 grid 行决定、跟随绘图区**（height:auto），
			// 不再写死像素——写死时卡片一被拉伸，0 刻度就浮在柱体中部。
			".dsh-tokstats-axisY{grid-area:1/1;position:relative;width:40px;height:auto;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums lining-nums;font-size:11px;line-height:16px}",
			".dsh-tokstats-axisTick{position:absolute;right:0;text-align:right;white-space:nowrap;transform:translateY(50%)}",
			// 三个刻度与网格线共用同一组位置（100% / 70.7% / 0）：两者参照系相同
			// （都是绘图区那一段高度），百分比因此等价于像素。
			".dsh-tokstats-axisTickTop{bottom:100%}",
			".dsh-tokstats-axisTickMid{bottom:70.7%}",
			".dsh-tokstats-axisTickBase{bottom:0;transform:translateY(0)}",
			// ── 柱位 / 日期刻度的同轨层（「刻度与柱子对齐」的唯一实现点）──────
			//
			// 柱容器与横轴容器**共用** `.dsh-tokstats-track`，每个柱位与每个刻度槽
			// **共用** `.dsh-tokstats-trackItem`：同一套 flex 约束（`flex:1` +
			// `min-width` + `max-width` + 同一个 `gap`）作用于同一列数，第 i 个槽
			// 必然与第 i 根柱等宽同位。两条规则因此**不允许**各自复制一份尺寸——
			// 复制即漂移，而这正是「日期标签偏到柱子一侧」的成因。
			//
			// 少列时 `justify-content:center` 让整组居中而不是挤在左侧（`max-width`
			// 触顶后 flex 无法再把余量分给柱体）；刻度槽跟着一起居中，所以居中
			// 不再造成错位——此前轴用 `space-between` 钉在容器两端，柱组居中时
			// 两者相差半个容器宽。
			".dsh-tokstats-track{gap:2px;display:flex;justify-content:center}",
			// 列宽上限（TS-23 / AC-4）**分两级**，因为「柱子太宽」和「整组太窄」是两件事：
			//
			// ① 列（`trackItem`，柱位与刻度槽共用）上限 96px：它决定整组能铺多开。
			//    原来这里写 48px，结果 7 列时整组只有 348px，在 750px 的绘图区里
			//    居中成一坨、两侧各空 200px——读者看到的是「图没画满」。
			// ② 柱子（`barFill`）上限 40px：它决定单根柱看起来多粗。把上限从列挪到
			//    柱身上，列才能铺开、柱子仍是细的；两列之间的留白由「列宽 − 柱宽」
			//    自然产生，不必去动和刻度槽共用的 2px 列间距（改它会破坏同轨对齐）。
			//
			// 列上限仍要保留：只有 3 个活跃日时，纯 `flex:1` 会把每列拉到 250px，
			// 柱宽从此表达的是「窗口里没几天」而不是「数据有多大」。
			".dsh-tokstats-trackItem{box-sizing:border-box;flex:1;min-width:3px;max-width:96px}",
			// 柱容器是绘图区的 flex 子项：`flex:1` 吃满宽度，`align-self:stretch`
			// 吃到绘图区高度（不写 `height:100%`——绘图区高度由 grid 行决定，
			// 百分比在「仅 min-height 撑开」的场景下会退化成 auto）。
			".dsh-tokstats-bars{align-items:flex-end;flex:1;align-self:stretch}",
			".dsh-tokstats-bar{height:100%;display:flex;align-items:flex-end;position:relative}",
			// 柱体宽度上限 40px + 水平居中：列铺开之后，柱子不必跟着变粗。
			// `margin:0 auto` 在 flex 行里等价于两侧均分余量，柱心仍对准刻度槽中心。
			".dsh-tokstats-barFill{background:var(--dsh-tokstats-accent);border-radius:2px 2px 0 0;width:100%;max-width:40px;margin:0 auto;display:block;position:relative}",
			".dsh-tokstats-bar:hover .dsh-tokstats-barFill{filter:brightness(1.1)}",
			// 峰值柱顶标数值（TS-23）：标在**柱体内部顶端**，不改变柱高、也不越出
			// 绘图区。此前把它放在柱体上方（`bottom:100%`），而峰值柱恒为 100% 高
			// ——标签必然溢出绘图区，与卡片标题行（「峰值 … · N 次」）撞在一起。
			// 反色文字配品牌色柱体，明暗两套主题各自成立。
			//
			// 字号**刻意留在 10px、不跟正文升到 11**：它标在柱体内部，字符串宽度受柱宽
			// 约束（12 列时每列约 25px，「2.4K」在 11px 下就压到相邻柱上了）。这是
			// 「跟着柱子的尺寸走、而不是跟着文字层级走」的例外，备案在此以免下次
			// 排印统一时被顺手改大。
			".dsh-tokstats-barPeak{position:absolute;left:50%;top:2px;transform:translateX(-50%);z-index:2;color:var(--dsh-tokstats-on-accent);font-variant-numeric:tabular-nums lining-nums;font-size:10px;line-height:12px;white-space:nowrap;pointer-events:none}",
			// 折叠历史列（TS-22）：斜纹 + 次要色，与真实日区分。用 repeating-linear-gradient
			// 而不是换颜色，因为「柱高不代表当天」这件事不能用「颜色深浅」表达（会被读成
			// 数据大小）。纹理由透明层叠加，柱体本身的品牌色仍在，仍能看出量级。
			".dsh-tokstats-barEpoch .dsh-tokstats-barFill{background:repeating-linear-gradient(135deg,var(--dsh-tokstats-accent) 0 4px,transparent 4px 8px),var(--dsw-alias-bg-layer-2);opacity:.7;outline:1px dashed var(--dsw-alias-border-l1);outline-offset:-1px}",
			// 横轴（日期刻度）：第 2 行、绘图区那一列（`grid-area:2/2`）。**必须显式
			// 落位**：不写的话它自动排进第 2 行第 1 列（纵轴那列），`auto` 列宽会
			// 被 7 个刻度槽撑到 300 多像素，绘图区被整体推右、标签挤成一团。
			//
			// 容器与柱容器同轨（`.dsh-tokstats-track` + 上面的
			// `.dsh-tokstats-trackItem`），每列一个槽，只有首/中/末三个槽写字。
			// **不要再写 `justify-content`**——它在这里与轨道规则冲突，正是
			// 「标签钉在两端、柱组居中」的错位来源。
			".dsh-tokstats-axis{grid-area:2/2;color:var(--dsw-alias-label-tertiary);margin-top:6px;font-variant-numeric:tabular-nums lining-nums;font-size:11px;line-height:16px}",
			// 刻度槽：居中写在自己的列位上；首/末槽靠边对齐（居中会让首末标签
			// 各有一半溢出到图外，与纵轴/卡片边缘打架）。`white-space:nowrap`
			// 配 `overflow:visible` 让窄列的日期压在相邻空槽上而不是被裁掉。
			".dsh-tokstats-axisSlot{text-align:center;white-space:nowrap;overflow:visible}",
			".dsh-tokstats-axisSlotFirst{text-align:left}",
			".dsh-tokstats-axisSlotLast{text-align:right}",
			// 窄窗（≤900px）：三行纵轴标签在 40px 列里会互相挤压，隐藏中间那个，
			// 留首末两个仍能读出量级（au3-7f）。
			"@media (max-width:900px){.dsh-tokstats-axisTickMid{display:none}}",
			// 周趋势卡（第五批改造）：条列表复用 `.dsh-tokstats-meter`，这里只加
			// 「本周进行中」的小标——用数据色，和条/热力格同一抹蓝；置灰由
			// `.dsh-tokstats-dim` 负责，两者一起才说得清「这条为什么淡」。
			".dsh-tokstats-weekNow{color:var(--dsh-tokstats-accent);margin-left:6px;font-size:11px;line-height:16px;white-space:nowrap}",
			// promptopt 计数器：两行（三计数 + 字符增减）。窄栏里标签允许换行——
			// 这两行的标签较长（英文尤其），单行省略会截成「started / adopted / dis…」。
			".dsh-tokstats-miniGrid{flex-direction:column;display:flex}",
			".dsh-tokstats-miniGrid .dsh-tokstats-rowLabel{max-width:none;flex:1 1 auto;white-space:normal;overflow:visible}",
			// 置灰（本周进行中 / 未标注项）：透明度**加上**一档更弱的文字色。
			// SPEC §5.4 要求「单日 / 折叠 / 零值状态不能只靠透明度区分」——只压
			// opacity 时，亮色主题下文字糊成一片灰雾、深色主题下却几乎没变，
			// 同一条规则在两套主题里表达出两种强度。补一条色阶规则后，「弱」由
			// 颜色与透明度共同承担，两套主题至少各降一档。
			".dsh-tokstats-dim{opacity:.55}",
			".dsh-tokstats-dim .dsh-tokstats-meterValue,.dsh-tokstats-dim .dsh-tokstats-rowValue{color:var(--dsw-alias-label-secondary)}",
			// 页脚分隔线用 `border-l1`（SPEC §5.1：边框 / 分隔统一 l1）。原来写 l2，
			// 比卡片边框还重——页脚是「附注」，不该有一条比内容卡更实的横线。
			".dsh-tokstats-foot{color:var(--dsw-alias-label-tertiary);border-top:1px solid var(--dsw-alias-border-l1);gap:12px;padding:6px 20px;font-size:11px;line-height:16px;flex:none;min-height:16px;display:flex;flex-wrap:wrap}",
			// 覆盖率披露（TS-21）：允许收缩并省略，窄窗下不许把右侧区间挤掉。
			".dsh-tokstats-footCoverage{min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}",
			".dsh-tokstats-footSkipped{color:var(--dsw-alias-label-secondary)}",
			// 后台校验中（TS-24）：用次要色 + 不抢版面，明确是过渡态而不是终值。
			// ── 状态徽标（颜色 + 圆点 + 文字）────────────────────────────────
			//
			// 底色是状态色混 12%：与宿主自己徽标的写法一致（它用 10–12% 的
			// `color-mix(state-*-primary, transparent)`），所以面板里的绿/黄/红
			// 与宿主别处的绿/黄/红是同一支色，换主题不用改代码。
			// 圆角 999（SPEC §5.3 的状态 pill），高度由 11/16 行高 + 1px 内边距决定。
			".dsh-tokstats-status{align-items:center;gap:6px;border-radius:999px;padding:1px 8px;font-size:11px;line-height:16px;white-space:nowrap;display:inline-flex;flex:none}",
			// 圆点是颜色之外的第二重线索（SPEC §7：状态不能只靠颜色编码）。
			".dsh-tokstats-statusDot{width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;flex:none}",
			// 颜色全部带兜底：旧宿主缺某个 state token 时退回次要文字色，
			// 而不是渲染出一个「没有颜色」的徽标（硬规则 6）。
			// 文字色是「状态色混 55% 主题主文字色」，不是状态色本身：宿主的 success / warn /
			// error primary 是 green-500 / amber-500 / red-* 这类高亮色，直接当 11px 文字
			// 压在 12% 淡底上，亮色主题只有 2–3.5:1（要求 4.5:1）。混入 label-primary 后
			// 亮色约 5.3:1、暗色约 6–7:1，色相不变——宿主自己的徽标也是这么混的（68–72%）。
			// label-primary 随主题翻转，所以同一条式子在两套主题下各自成立。
			".dsh-tokstats-status-done{color:color-mix(in srgb,var(--dsw-alias-state-success-primary,var(--dsw-alias-label-secondary)) 55%,var(--dsw-alias-label-primary));background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}",
			".dsh-tokstats-status-verifying{color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-secondary)) 55%,var(--dsw-alias-label-primary));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}",
			".dsh-tokstats-status-failed{color:color-mix(in srgb,var(--dsw-alias-state-error-primary,var(--dsw-alias-label-secondary)) 55%,var(--dsw-alias-label-primary));background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}",
			// 校验中只让 6px 的圆点呼吸，**不让整块徽标闪**：底色跟着跳动看起来
			// 像错误提示，而这里表达的是「还在动」而不是「出问题了」。
			".dsh-tokstats-status-verifying .dsh-tokstats-statusDot{animation:dsh-tokstats-pulse 1.2s ease-in-out infinite}",
			"@keyframes dsh-tokstats-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.7)}}",
			".dsh-tokstats-footRange{margin-left:auto;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			// ── 响应式（SPEC §6）──────────────────────────────────────────────
			//
			// 三档断点，**只改密度、不改信息**：不隐藏 KPI、时间档、图表、页脚覆盖
			// 状态里的任何一项——窄窗下读者只会更需要这些信息。
			//
			// ≤820：KPI 固定两列。`auto-fit` 在这个宽度还能挤出四列 160px 的卡，
			// 但主值 24px 时每张卡只剩 ~170px，「未缓存 8.5M · 缓存读 57M」这类副值
			// 必然省略；两列之后每张卡回到 ~340px。时间图与下方卡片已由既有断点
			// 折成单列，而 DOM 里柱图排在热力图之前，所以单列时天然是「柱图先」。
			"@media (max-width:820px){.dsh-tokstats-kpiGrid{grid-template-columns:repeat(2,minmax(0,1fr))}}",
			// ≤620：面板水平内边距 20 → 12（SPEC §5.3 的窄屏值，四块骨架一起改，
			// 否则页头、工具条、卡片、页脚的左缘会各自错开）；时间档允许折两行；
			// 工作区独占一行——原生 select 在 620 以下只剩 ~200px，与五个档位挤在
			// 同一行会被压成看不出当前值的窄条。`box-sizing:border-box` 必须显式写：
			// select 默认是 content-box，`flex-basis:100%` 再加上内边距就横向溢出了。
			"@media (max-width:620px){.dsh-tokstats-pageHeader,.dsh-tokstats-toolbar,.dsh-tokstats-body,.dsh-tokstats-foot{padding-left:12px;padding-right:12px}.dsh-tokstats-switches{flex-wrap:wrap}.dsh-tokstats-select{box-sizing:border-box;flex:0 0 100%;max-width:none}}",
			// ≤420：KPI 仍两列（再折一列会让四张卡纵向占满首屏）。缩小的是卡内边距
			// 12 → 10 与主值 24 → 20——SPEC §6 唯一允许主动缩主值的一档，再小就
			// 读不出七位数字的位数差异了。
			"@media (max-width:420px){.dsh-tokstats-kpiGrid{gap:8px}.dsh-tokstats-kpi{padding:10px}.dsh-tokstats-kpiValue{font-size:20px;line-height:26px}}",
			// ── 焦点与动效（SPEC §7；此前漏项）────────────────────────────────
			//
			// 所有可操作控件必须**看得见焦点**。用 `:focus-visible` 而不是 `:focus`：
			// 后者在鼠标点击时也亮环，工具条上会出现一圈莫名其妙的光。
			//
			// 环走 `outline`（不占布局，12 列不会因聚焦被挤变形），2px + **2px 外偏移**：
			// 偏移是关键——热力格第 5 档本身就是 accent，环贴着格子边缘等于没有；
			// 外偏移让它落在卡片底色上，深色档也看得见。
			//
			// 颜色取宿主的 focus ring（`--dsw-focus-ring-color`，旧宿主没有时回落
			// accent）：焦点是宿主级约定，别的面板里是同一个环，读者不用重新学。
			".dsh-tokstats-page :focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsh-tokstats-accent));outline-offset:2px}",
			// 尊重系统的「减少动效」：刷新按钮的旋转是面板里唯一持续动画。这不是顺手，
			// 前庭功能障碍读者对持续旋转敏感；关掉后信息并不丢——按钮此刻已 disabled、
			// 页头角标写着「统计中…」。
			"@media (prefers-reduced-motion:reduce){.dsh-tokstats-refreshBusy svg{animation:none}.dsh-tokstats-status-verifying .dsh-tokstats-statusDot{animation:none}}"
		].join("\n");

		/**
		 * tokstats 词典（zh 为键集真源，en 必须逐键对应）。
		 *
		 * 术语：输入 in / 输出 out / 缓存读 cache read / 缓存写 cache write /
		 * 命中 cached / 工作区 workspace / 上下文长度分布 context length distribution /
		 * 统计中… Scanning…。桶区间与 K/M 是记号，不进词典。
		 */
		const LOCALE_NS_TOKSTATS = "dsh-tokstats.tokstats";

		const tokstatsZh = {
			"panel.title": "Token 用量统计",
			"panel.aria": "Token 用量统计",
			"state.pending": "统计中…",
			"range.today": "当日",
			"range.days7": "近 7 天",
			"range.month": "本月",
			"range.days30": "近 30 天",
			"range.all": "全部",
			"action.refresh": "重新统计",
			// 页头口径（SPEC §4.2）：读者要相信上面的数字，得先知道两件事——「输入」
			// 是计费口径（未缓存 + 缓存读）、命中率的分母是计费输入。写成一行用中点
			// 分隔，是因为它是一句附注，而不是两条并列的说明；11/16 的第三条信息层，
			// 不与 KPI 副值抢注意力。
			// 只留「计费输入」这一条口径：命中率的公式不写在这里——KPI 第四张卡的
			// 副值就是「命中 X / Y」，分子分母都在眼前，再写一行「= 缓存读 / 输入」
			// 是把同一件事说两遍（用户 2026-10-26 指出）。
			"header.caliber": "计费输入以数据源统计口径为准",
			// KPI 四卡与图表同一个窗口（TS-30），副值按档位选形态：多天给日均、
			// 单天给「占 84 天份额」（日均会等于主值，复述主值触发 TS-17）、
			// 「全部」档没有天数概念。
			"kpi.calls": "调用次数",
			"kpi.callsHintDays": "日均 {rate} 次",
			"kpi.callsHintAll": "全部历史",
			"kpi.billed": "输入",
			"kpi.billedHint": "未缓存 {uncached} · 缓存读 {cached}",
			"kpi.output": "输出",
			"kpi.outputHint": "占输入 {pct}%",
			"kpi.hit": "缓存命中率",
			"kpi.hitHint": "命中 {cached} / {billed}",
			"section.bucket": "上下文长度分布（按计费输入）",
			"section.daily": "每日调用量",
			// 卡头标注的**实际跨度**（当日档有 7 天下限，见 TS-33）。
			"extra.windowDays": "近 {days} 天",
			"extra.windowAll": "全部",
			"section.heat": "近 12 周用量",
			// 热力图图例两端（记号「少 ← 多」的方向由布局表达，文字只标两端语义）。
			"heat.less": "少",
			"heat.more": "多",
			// 行标：周一到周日（与格子 7 行同序，周一在最上）。七个键而不是一个
			// 顿号串：串起来之后渲染端要自己切，切错就是「周三显示成周二」。
			"heat.dow1": "一",
			"heat.dow2": "二",
			"heat.dow3": "三",
			"heat.dow4": "四",
			"heat.dow5": "五",
			"heat.dow6": "六",
			"heat.dow7": "日",
			// 每格的 aria-label / tooltip 三态（TS-28 / AC-8 / AC-9）。
			//
			// 三种态必须**文案互斥**：有量 / 无记录 / 已折叠。把折叠区写成「无记录」
			// 是谎报（那天有量，只是被 E1 归并进区间了），AC-9 有一条反向断言专门
			// 钉住「折叠格的文案里不得出现『无记录』」。
			"heat.cellAria.one": "{date}：{count} 次调用",
			"heat.cellAria.other": "{date}：{count} 次调用",
			"heat.cellTip.one": "{date}：{count} 次调用，输入 {input}，输出 {output}",
			"heat.cellTip.other": "{date}：{count} 次调用，输入 {input}，输出 {output}",
			"heat.empty": "{date}：无记录",
			// 折叠区：说明「这一格代表一段区间，不是某一天」，并给出区间端点。
			"heat.folded": "{date}：已折叠进 {start}–{end} 的区间归并，不可按日拆分",
			"heat.foldedAria": "{date}：已折叠，不可按日拆分",
			// 键盘提示：告诉读者这张图可以用方向键操作（AC-11）。
			"heat.keyHint": "方向键选日期，Enter 查看单日，Esc 返回区间",
			// 单日模式（TS-29 / 裁决 A）：面包屑 + 退出 + 折叠日的说明。
			"crumb.exit": "全部区间",
			"crumb.aria": "{day} 的单日用量，返回全部区间",
			// 单日模式下 KPI「调用次数」副值改「占 84 天份额」（SPEC D13）：
			// 分母取 heatDaily 合计，**不是** totals——单日下 totals 就是那一天，
			// 用它算份额恒得 100%（毫无信息，且复述主值会触发 TS-17）。
			"kpi.callsHintShare": "占 84 天 {pct}%",
			// 折叠日的单日视图：不显示任何数字（显示偏低数字是谎报）。
			"single.folded": "该日已折叠进区间归并，无法按日拆分",
			// 单日模式下「趋势（按周）」卡隐藏（裁决 A）：那一行周合计与 totals
			// 完全相同，是复述主值。日柱图同样隐藏（只剩一根孤柱）。
			// 刻度口径说明（TS-23）：挂在绘图区的 tooltip 上。`Math.sqrt` 不在界面上
			// 出现，读者按线性直觉会把「三根差不多高」读成「三天差不多量」。
			//
			// 不写具体比例（如「峰值÷2 在 70% 高」）：那是 sqrt(0.5) 的推导结果，
			// 写进词典等于把刻度算式抄成文案，改刻度就得记得来改句子。轴上的中间
			// 刻度本身已经标着「峰值÷2」且画在正确高度，那句话由图形承担。
			"tip.dailyScale": "柱高按调用次数的平方根绘制（非线性刻度）；精确数值见各柱悬停提示",
			"section.trend": "趋势（按周）",
			"section.workspace": "工作区排行",
			"section.route": "模型排行",
			"section.promptopt": "提示词整理使用情况",
			"extra.peakBucket": "峰值 {bucket}",
			"extra.peakDay.one": "峰值 {day} · {count} 次",
			"extra.peakDay.other": "峰值 {day} · {count} 次",
			"extra.weeks.one": "{count} 周",
			"extra.weeks.other": "{count} 周",
			"extra.workspaces.one": "{count} 个",
			"extra.workspaces.other": "{count} 个",
			"extra.routes.one": "{count} 个",
			"extra.routes.other": "{count} 个",
			"route.unattributed": "未标注",
			"cell.routeDetail": "输入 {input} · 输出 {output} · 命中 {hit}%",
			"extra.adoptRate": "采纳率 {rate}%",
			"daily.span": "{start}–{end}",
			"tip.day.one": "{span}：{count} 次调用，输入 {input}，输出 {output}",
			"tip.day.other": "{span}：{count} 次调用，输入 {input}，输出 {output}",
			"row.promptopt": "发起 / 采纳 / 放弃",
			"row.charsDelta": "采纳后字符增减",
			"tip.charsDelta": "采纳的整理结果相对原文的字符增减合计",
			"value.promptopt": "{started} / {adopted} / {dismissed}",
			"tip.promptopt": "提示词整理：发起 {started} 次，采纳 {adopted} 次，放弃 {dismissed} 次；采纳后字符增减 {delta}",
			"workspace.all": "全部工作区",
			"workspace.item.one": "{path}（{count} 次）",
			"workspace.item.other": "{path}（{count} 次）",
			"row.bucket.one": "{count} 次 · 输入 {input} · 输出 {output} · 命中 {hit}%",
			"row.bucket.other": "{count} 次 · 输入 {input} · 输出 {output} · 命中 {hit}%",
			// 周趋势卡（第五批改造）：条列表的副行与 tooltip。本周未过完时用
			// `tip.weekOpen`（整句写明「数字仍在增长」），不靠置灰让人猜。
			"cell.weekDetail": "输入 {input} · 输出 {output}",
			"week.inProgress": "进行中",
			"tip.week.one": "{span}：{count} 次调用，输入 {input}，输出 {output}",
			"tip.week.other": "{span}：{count} 次调用，输入 {input}，输出 {output}",
			"tip.weekOpen.one": "{span}：{count} 次调用，输入 {input}，输出 {output}。本周还没过完，数字仍在增长",
			"tip.weekOpen.other": "{span}：{count} 次调用，输入 {input}，输出 {output}。本周还没过完，数字仍在增长",
			"cell.calls.one": "{count} 次",
			"cell.calls.other": "{count} 次",
			"cell.bucketDetail": "输入 {input} · 输出 {output} · 命中 {hit}%",
			"cell.workspaceDetail": "输入 {input} · 输出 {output}",
			"tip.bucket.one": "计费输入 {bucket} 的请求：{count} 次，计费输入 {input}，输出 {output}，缓存命中 {hit}%",
			"tip.bucket.other": "计费输入 {bucket} 的请求：{count} 次，计费输入 {input}，输出 {output}，缓存命中 {hit}%",
			"row.workspace.one": "{count} 次 · 输入 {input} · 输出 {output}",
			"row.workspace.other": "{count} 次 · 输入 {input} · 输出 {output}",
			"tip.workspace.one": "{path}：{count} 次调用，输入 {input}，输出 {output}",
			"tip.workspace.other": "{path}：{count} 次调用，输入 {input}，输出 {output}",
			"tip.route.one": "{route}：{count} 次调用，输入 {input}，输出 {output}，缓存命中 {hit}%",
			"tip.route.other": "{route}：{count} 次调用，输入 {input}，输出 {output}，缓存命中 {hit}%",
			"empty.noService": "统计服务不可用，无法读取会话数据",
			"empty.noData": "暂无数据（还没有 usage 记录）",
			// 空态的下一步（样稿：空态必须给出明确行动）。这里做成「把档位切到全部」，
			// 是面板本来就有的能力——不是新增的异步动作。
			"empty.allTime": "查看全部时间",
			"foot.generated": "生成于 {time}",
			// 页脚状态徽标（颜色 + 圆点 + 文字）。三个词是**状态名**，不是句子：
			// 徽标空间只有几十像素，句子会被省略号截断，反而不如一个词清楚。
			"status.done": "校验完成",
			"status.verifying": "校验中",
			"status.failed": "加载失败",
			"foot.range": "{start} – {end}",
			"foot.rangeAll": "全部历史",
			// 单日模式：页脚只显示那一天（区间两端都是同一天，写成「X – Y」会误导）。
			"foot.rangeSingle": "{day} 单日",
			"foot.coverage.one": "已统计 {count} 个会话",
			"foot.coverage.other": "已统计 {count} 个会话",
			"foot.skipped.one": " · 跳过 {count} 个（日志不可读）",
			"foot.skipped.other": " · 跳过 {count} 个（日志不可读）",
			"tip.coverage.one": "本次统计覆盖 {count} 个会话的全部可读日志",
			"tip.coverage.other": "本次统计覆盖 {count} 个会话的全部可读日志",
			"tip.coverageSkipped.one": "本次统计覆盖 {sessions} 个会话；{count} 个会话日志不可读，其用量未计入",
			"tip.coverageSkipped.other": "本次统计覆盖 {sessions} 个会话；{count} 个会话日志不可读，其用量未计入",
			"tip.dayEpoch.one": "{span}：{count} 次调用，输入 {input}，输出 {output}。含折叠历史（区间末归并）· {epochCalls} 次",
			"tip.dayEpoch.other": "{span}：{count} 次调用，输入 {input}，输出 {output}。含折叠历史（区间末归并）· {epochCalls} 次",
		};

		const tokstatsEn = {
			"panel.title": "Token usage stats",
			"panel.aria": "Token usage stats",
			"state.pending": "Scanning…",
			"range.today": "Today",
			"range.days7": "Last 7 days",
			"range.month": "This month",
			"range.days30": "Last 30 days",
			"range.all": "All time",
			"action.refresh": "Rescan",
			// 英文语序独立（AGENTS 硬规则 7）：不照搬中文的定语前置，改成
			// 「Billed input + as counted by …」的后置修饰，读者不需要回读。
			"header.caliber": "Billed input as counted by the data source",
			"kpi.calls": "Calls",
			"kpi.callsHintDays": "{rate} per day",
			"kpi.callsHintAll": "All history",
			"kpi.billed": "Input",
			"kpi.billedHint": "{uncached} uncached · {cached} cache read",
			"kpi.output": "Output",
			"kpi.outputHint": "{pct}% of input",
			"kpi.hit": "Cache hit rate",
			"kpi.hitHint": "{cached} cached / {billed}",
			"section.bucket": "Context length distribution (by billed input)",
			"section.daily": "Daily calls",
			"extra.windowDays": "Last {days} days",
			"extra.windowAll": "All time",
			"section.heat": "Last 12 weeks",
			"heat.less": "Less",
			"heat.more": "More",
			// 行标：Mon…Sun。英文用三字母缩写——七个全称会把行标列撑宽，
			// 挤压格子宽度（12 列本来就只有 24px 上限）。
			"heat.dow1": "Mon",
			"heat.dow2": "Tue",
			"heat.dow3": "Wed",
			"heat.dow4": "Thu",
			"heat.dow5": "Fri",
			"heat.dow6": "Sat",
			"heat.dow7": "Sun",
			"heat.cellAria.one": "{date}: {count} call",
			"heat.cellAria.other": "{date}: {count} calls",
			"heat.cellTip.one": "{date}: {count} call · {input} in · {output} out",
			"heat.cellTip.other": "{date}: {count} calls · {input} in · {output} out",
			"heat.empty": "{date}: no record",
			"heat.folded": "{date}: folded into the {start}–{end} range merge, not splittable by day",
			"heat.foldedAria": "{date}: folded, not splittable by day",
			"heat.keyHint": "Arrow keys pick a date, Enter opens that day, Esc goes back",
			"crumb.exit": "All ranges",
			"crumb.aria": "{day} single-day usage; back to all ranges",
			"kpi.callsHintShare": "{pct}% of 84 days",
			"single.folded": "This day was folded into a range merge and cannot be split by day",
			"tip.dailyScale": "Bar height follows the square root of calls (non-linear scale); exact values are in each bar's tooltip",
			"section.trend": "Trend (weekly)",
			"section.workspace": "Workspaces",
			"section.route": "Models",
			"section.promptopt": "Prompt restructure usage",
			"extra.peakBucket": "Peak {bucket}",
			"extra.peakDay.one": "Peak {day} · {count} call",
			"extra.peakDay.other": "Peak {day} · {count} calls",
			"extra.weeks.one": "{count} week",
			"extra.weeks.other": "{count} weeks",
			"extra.workspaces.one": "{count} workspace",
			"extra.workspaces.other": "{count} workspaces",
			"extra.routes.one": "{count} route",
			"extra.routes.other": "{count} routes",
			"route.unattributed": "Unattributed",
			"cell.routeDetail": "{input} in · {output} out · {hit}% cached",
			"extra.adoptRate": "{rate}% adopted",
			"daily.span": "{start}–{end}",
			"tip.day.one": "{span}: {count} call · {input} in · {output} out",
			"tip.day.other": "{span}: {count} calls · {input} in · {output} out",
			"row.promptopt": "started / adopted / dismissed",
			"row.charsDelta": "Characters changed on adoption",
			"tip.charsDelta": "Total characters added or removed by adopted restructures",
			"value.promptopt": "{started} / {adopted} / {dismissed}",
			"tip.promptopt": "Prompt restructure: {started} started, {adopted} adopted, {dismissed} dismissed; characters changed on adoption {delta}",
			"workspace.all": "All workspaces",
			"workspace.item.one": "{path} ({count} call)",
			"workspace.item.other": "{path} ({count} calls)",
			"row.bucket.one": "{count} call · {input} in · {output} out · {hit}% cached",
			"row.bucket.other": "{count} calls · {input} in · {output} out · {hit}% cached",
			"cell.weekDetail": "{input} in · {output} out",
			"week.inProgress": "in progress",
			"tip.week.one": "{span}: {count} call · {input} in · {output} out",
			"tip.week.other": "{span}: {count} calls · {input} in · {output} out",
			"tip.weekOpen.one": "{span}: {count} call · {input} in · {output} out. This week isn't over yet — the number is still growing",
			"tip.weekOpen.other": "{span}: {count} calls · {input} in · {output} out. This week isn't over yet — the number is still growing",
			"cell.calls.one": "{count} call",
			"cell.calls.other": "{count} calls",
			"cell.bucketDetail": "{input} in · {output} out · {hit}% cached",
			"cell.workspaceDetail": "{input} in · {output} out",
			"tip.bucket.one": "Requests billed at {bucket} input: {count}, billed input {input}, output {output}, cache hit {hit}%",
			"tip.bucket.other": "Requests billed at {bucket} input: {count}, billed input {input}, output {output}, cache hit {hit}%",
			"row.workspace.one": "{count} call · {input} in · {output} out",
			"row.workspace.other": "{count} calls · {input} in · {output} out",
			"tip.workspace.one": "{path}: {count} call, {input} in, {output} out",
			"tip.workspace.other": "{path}: {count} calls, {input} in, {output} out",
			"tip.route.one": "{route}: {count} call, {input} in, {output} out, cache hit {hit}%",
			"tip.route.other": "{route}: {count} calls, {input} in, {output} out, cache hit {hit}%",
			"empty.noService": "Statistics service unavailable: session data cannot be read",
			"empty.noData": "No data yet (no usage recorded)",
			"empty.allTime": "View all time",
			"foot.generated": "Generated at {time}",
			"status.done": "Verified",
			"status.verifying": "Verifying",
			"status.failed": "Load failed",
			"foot.range": "{start} – {end}",
			"foot.rangeAll": "All history",
			"foot.rangeSingle": "{day} (single day)",
			"foot.coverage.one": "{count} session included",
			"foot.coverage.other": "{count} sessions included",
			"foot.skipped.one": " · {count} skipped (unreadable log)",
			"foot.skipped.other": " · {count} skipped (unreadable log)",
			"tip.coverage.one": "This scan covers every readable log of {count} session",
			"tip.coverage.other": "This scan covers every readable log of {count} sessions",
			"tip.coverageSkipped.one": "This scan covers {sessions} sessions; {count} session has an unreadable log, so its usage is not counted",
			"tip.coverageSkipped.other": "This scan covers {sessions} sessions; {count} sessions have unreadable logs, so their usage is not counted",
			"tip.dayEpoch.one": "{span}: {count} call · {input} in · {output} out. Includes folded history (merged at the window end) · {epochCalls} call",
			"tip.dayEpoch.other": "{span}: {count} calls · {input} in · {output} out. Includes folded history (merged at the window end) · {epochCalls} calls",
		};

		/** apply 时的 ctx：RPC 通道要惰性取（见 tokstatsConnection）。 */
		let tokstatsCtx = null;

		/**
		 * tokstats 注册体。
		 *
		 * 两处注册必须同 id（p0-b）：`sidebar.panellist` 的 `id` 与 `main` 的 `key`
		 * 是同一个寻址键——`ctx.layout.selectPanel(id)` 在 `main` 里找不到同名 key
		 * 会直接抛错，并保留当前面板。`label` 是函数形式（locale 切换时侧栏重取），
		 * `order` 升序排在官方 plugins(0) / schedules(10) 之后。
		 */
		function tokstatsApply(ctx) {
			tokstatsCtx = ctx;
			ctx.slots.inject("main", () => ctx.slots.register(
				{ name: "main", key: TOKSTATS_PANEL_ID, locale: LOCALE_NS_TOKSTATS },
				TokstatsPanel
			));
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register(
				{
					name: "sidebar.panellist",
					id: TOKSTATS_PANEL_ID,
					order: 30,
					label: () => ctx.locale.bind(LOCALE_NS_TOKSTATS)("panel.title"),
					locale: LOCALE_NS_TOKSTATS,
				},
				TokstatsIcon
			));
		}

		// ── plugin: promptopt ──────────────────────────────────────────────────────
		//
		// composer 草稿的 AI 重写：点按钮 → host 侧一次旁路模型调用 → 原文/优化文
		// 对照 → 采纳才写回草稿。host 半边（通道 + llm）见 lib/index.js；两侧是
		// 两个模块图，没有共享常量的地方，通道名各写一份。
		//
		// 两轴分离（SPEC §3.5）：界面文案走词典跟随宿主语言；优化产物跟随草稿
		// 语言（meta-prompt 约束③承载），与 UI 语言无关——英文界面照样出中文优化文。

		const PROMPTOPT_CHANNEL = "/dsh-plugins.promptopt";
		const PROMPTOPT_ENDPOINT = "optimize";
		/** 上报一次采纳 / 放弃（计数器在 host 侧，浏览器只发事件）。 */
		const PROMPTOPT_EVENT_ENDPOINT = "event";

		/** apply 时的 ctx：connection 服务要惰性取（见 promptoptConnection）。 */
		let promptoptCtx = null;

		/**
		 * 草稿含富内容判定（SPEC Q9）：occurrence / 图片 id / 命令 token。
		 * setDraft 是全量文本替换，模型重排会破坏 occurrence 坐标与图片归属，
		 * 而用户对此毫无感知——这类草稿直接禁用按钮而不是事后修补。
		 */
		function promptoptHasRichDraft(imageIds, occurrences, claim) {
			if (Array.isArray(imageIds) && imageIds.length > 0) return true;
			if (Array.isArray(occurrences) && occurrences.length > 0) return true;
			return claim !== undefined && claim !== null;
		}

		/** host 错误码 → 词典键后缀（host 侧每个 wire 码只有一个生产者，不会两义）。 */
		function promptoptErrorKey(code) {
			if (code === "bad-request") return "badDraft";
			if (code === "internal") return "timeout";
			return "llm";
		}

		/**
		 * 惰性取 connection 服务。
		 *
		 * 刻意不放进 inject：inject 是「齐备才加载」的硬依赖，connection 一旦
		 * 缺席会连带 tokprev / tokstats 一起不加载。用 ctx.get 惰性取则只有
		 * promptopt 降级成报错（硬规则 6）。
		 */
		function promptoptConnection() {
			const ctx = promptoptCtx;
			if (ctx === null || typeof ctx.get !== "function") return undefined;
			try {
				return ctx.get("connection");
			} catch {
				return undefined;
			}
		}

		/**
		 * 发起一次 optimize。走宿主官方 caller（自带 rpcId 关联、响应信封校验、
		 * signal 透传、__DSH_TRANSPORT__ 覆盖），不手搓 fetch。
		 * @returns RpcResult；connection 缺席时返回 undefined（调用方转成 error.llm）。
		 */
		async function promptoptOptimize(text, signal) {
			const rpc = promptoptConnection()?.rpc;
			if (rpc === undefined || rpc === null || typeof rpc.call !== "function") return undefined;
			return rpc.call(PROMPTOPT_CHANNEL, PROMPTOPT_ENDPOINT, { text }, signal);
		}

		function PromptoptIcon() {
			return react.createElement("svg", {
				width: 13, height: 13, viewBox: "0 0 16 16", fill: "none",
				"aria-hidden": "true", style: { display: "block" }
			},
				react.createElement("path", {
					d: "M8 1.8l1.5 3.4 3.7.4-2.7 2.5.7 3.6L8 9.8l-3.2 1.9.7-3.6L2.8 5.6l3.7-.4z",
					stroke: "currentColor", strokeWidth: "1.3", strokeLinejoin: "round", fill: "none"
				}));
		}

		/** 弹层：pending（转圈）/ ready（原文·重排文对照 + 采纳）/ error（按码查词典）。 */
		function PromptoptPopup({ snapshot, phase, result, onAdopt, onClose, anchor, panelRef, t }) {
			const ready = phase === "ready" && result !== null && result !== undefined;
			// F4：模型判定无需整理 → 采纳无意义，禁用按钮并说明原因。
			const noChange = ready && result.noChange === true;
			return react.createElement("div", {
				className: "dsh-promptopt-panel",
				ref: panelRef,
				style: { left: anchor.left, bottom: anchor.bottom }
			},
				react.createElement("div", { className: "dsh-promptopt-header" },
					react.createElement("span", { className: "dsh-promptopt-title" }, t("panel.title")),
					react.createElement("button", {
						type: "button",
						className: "dsh-promptopt-close",
						onClick: onClose,
						title: t("panel.close"),
						"aria-label": t("panel.close")
					}, "×")),
				phase === "pending"
					? react.createElement("div", { className: "dsh-promptopt-body" },
						react.createElement("span", { className: "dsh-promptopt-spinner" }),
						react.createElement("span", { className: "dsh-promptopt-pending" }, t("state.pending")))
					: null,
				ready
					? react.createElement("div", { className: "dsh-promptopt-body" },
						react.createElement("div", { className: "dsh-promptopt-label" }, t("panel.original")),
						react.createElement("div", { className: "dsh-promptopt-original" }, snapshot),
						react.createElement("div", { className: "dsh-promptopt-label" }, t("panel.structured")),
						react.createElement("div", { className: "dsh-promptopt-optimized" }, result.text),
						noChange
							? react.createElement("div", { className: "dsh-promptopt-nochange" }, t("state.noChange"))
							: null)
					: null,
				phase === "error" && result !== null && result !== undefined
					? react.createElement("div", { className: "dsh-promptopt-body" },
						react.createElement("div", { className: "dsh-promptopt-error" }, t("error." + promptoptErrorKey(result.code))))
					: null,
				ready
					? react.createElement("div", { className: "dsh-promptopt-actions" },
						react.createElement("button", {
							type: "button",
							className: "dsh-promptopt-adopt",
							disabled: noChange,
							title: noChange ? t("tip.needless") : t("action.adopt"),
							onClick: onAdopt
						}, t("action.adopt")),
						react.createElement("span", { className: "dsh-promptopt-foot" },
							t("foot.done", { seconds: ((result.durationMs ?? 0) / 1000).toFixed(1) })))
					: null);
		}

		/**
		 * dock 按钮 + 弹层的容器组件（session-scope，收 useInput 与 inputActions）。
		 * 关闭语义：关闭 / Esc / 点外 → abort 在飞请求（不变量 6）；采纳 → 无条件
		 * setDraft 后关弹层（不变量 5，快照胜出——等待期间的编辑被覆盖）。
		 */
		function PromptoptButton({ useInput, inputActions, t }) {
			const draft = useInput((s) => s.draft) ?? "";
			const imageIds = useInput((s) => s.imageIds);
			const occurrences = useInput((s) => s.occurrences);
			const claim = useInput((s) => s.claim);

			const [open, setOpen] = react.useState(false);
			const [phase, setPhase] = react.useState("idle");
			const [result, setResult] = react.useState(null);
			const [snapshot, setSnapshot] = react.useState("");
			const [anchor, setAnchor] = react.useState(undefined);
			// 在飞请求的控制器：关闭即 abort。初值可能是测试桩的 DOM ref 对象，
			// 故按「有 abort 方法」判定而不是非 null。
			const controllerRef = react.useRef(null);
			// 按钮挪进 composer 工具行后，弹层不能再用 absolute 挂在自己上方：
			// 工具行与 composer 卡片的祖先有 overflow:hidden，absolute 会被裁剪
			//（面板在 DOM 里存在但肉眼不可见——v0.3.0 tokstats 踩过同一个坑）。
			// 改 fixed + 按钮矩形锚定，与 tokstats 面板同款。
			const buttonRef = react.useRef(null);
			const panelRef = react.useRef(null);

			const rich = promptoptHasRichDraft(imageIds, occurrences, claim);
			const empty = draft.trim().length === 0;
			const disabled = empty || rich;
			// F4：模型判定原文已足够结构化时原样返回，此时采纳等于什么都不做，
			// 故禁用采纳按钮并给出提示。
			const noChange = result !== null && result !== undefined && result.noChange === true;

			/**
			 * 上报一次计数器事件（采纳 / 放弃）。
			 *
			 * 这是观测面而不是功能面：通道缺席、传输失败、宿主拒收都不影响交互——
			 * 计数丢一次远好于让用户点不动按钮。Promise 必须显式收尾：被遗弃的
			 * rejection 会冒成 unhandledRejection。
			 */
			function reportCounter(event, detail) {
				const rpc = promptoptConnection()?.rpc;
				if (rpc === undefined || rpc === null || typeof rpc.call !== "function") return;
				try {
					const pending = rpc.call(PROMPTOPT_CHANNEL, PROMPTOPT_EVENT_ENDPOINT, { event, ...(detail ?? {}) });
					if (pending !== undefined && pending !== null && typeof pending.catch === "function") pending.catch(() => {});
				} catch {
					/* 降级：计数失败静默 */
				}
			}

			/**
			 * 结果是否已经产出（放弃判定用）。
			 *
			 * 必须读 ref 而不是闭包里的 `result`：Esc/点外的监听器是 effect 注册的，
			 * 闭包捕获的是**注册那一轮**的 result（那时还是 null），直接用会让
			 * 「关掉已出结果的弹层」永远不计入放弃。
			 */
			const resultRef = react.useRef(null);

			/** 中止并收摊（关闭 / Esc / 点外共用）。已出结果时的关闭算「放弃」。 */
			function close() {
				const controller = controllerRef.current;
				if (controller !== null && controller !== undefined && typeof controller.abort === "function") controller.abort();
				controllerRef.current = null;
				// 只有「已拿到结果却没采纳」才算放弃：请求在飞时关闭是取消，不是放弃。
				if (resultRef.current !== null && resultRef.current !== undefined) reportCounter("dismissed");
				resultRef.current = null;
				setOpen(false);
				setPhase("idle");
				setResult(null);
			}

			/** 采纳：无条件写回优化文（快照胜出，没有二次确认）。 */
			function adopt() {
				const current = resultRef.current ?? result;
				if (current !== null && current !== undefined && typeof current.text === "string" && current.noChange !== true) {
					inputActions.setDraft(current.text);
					reportCounter("adopted", { before: snapshot.length, after: current.text.length });
				}
				resultRef.current = null;
				controllerRef.current = null;
				setOpen(false);
				setPhase("idle");
				setResult(null);
			}

			async function run() {
				const controller = new AbortController();
				controllerRef.current = controller;
				setSnapshot(draft);
				// 新一轮开始必须先把「上一轮的结果」清掉：否则请求在飞时关闭会被
				// close() 误判成「已出结果的放弃」。
				resultRef.current = null;
				setResult(null);
				setPhase("pending");
				setOpen(true);
				let response;
				try {
					response = await promptoptOptimize(draft, controller.signal);
				} catch {
					// 传输失败（通道未注册 / 网络 / 信封校验不过）统一降级，不白屏。
					response = undefined;
				}
				// 弹层已关：结果作废，也不该再覆盖任何状态。
				if (controller.signal.aborted) return;
				controllerRef.current = null;
				if (response === undefined || response === null) {
					setPhase("error");
					setResult({ code: "llm" });
					return;
				}
				if (response.ok === true) {
					resultRef.current = response.value;
					setPhase("ready");
					setResult(response.value);
					return;
				}
				const failure = { code: response.error?.code ?? "llm" };
				resultRef.current = failure;
				setPhase("error");
				setResult(failure);
			}

			// 弹层锚定：fixed 定位需要自己的坐标，按按钮矩形算，并钳制不越视口
			// 右缘（窄窗口时面板不能跑出去）。
			react.useLayoutEffect(() => {
				if (!open) return;
				const place = () => {
					const rect = buttonRef.current.getBoundingClientRect();
					// 420 = 面板宽；面板与按钮左缘对齐，越界则贴右缘留 12px。
					const left = Math.max(8, Math.min(rect.left, window.innerWidth - 420 - 12));
					setAnchor({ left, bottom: window.innerHeight - rect.top + 8 });
				};
				place();
				window.addEventListener("resize", place);
				return () => window.removeEventListener("resize", place);
			}, [open]);

			// Esc 与点外关闭。点外判定走事件目标的 closest 而不是 ref.contains：
			// 判定逻辑与渲染树解耦，也不用为了取引用多挂一个 ref。
			react.useEffect(() => {
				if (!open) return;
				const onKey = (event) => {
					if (event?.key === "Escape") close();
				};
				const onPointer = (event) => {
					const target = event?.target;
					if (target !== null && target !== undefined && typeof target.closest === "function") {
						if (target.closest(".dsh-promptopt-root") !== null) return;
					}
					close();
				};
				document.addEventListener("keydown", onKey);
				document.addEventListener("pointerdown", onPointer);
				return () => {
					document.removeEventListener("keydown", onKey);
					document.removeEventListener("pointerdown", onPointer);
				};
			}, [open]);

			return react.createElement("div", { className: "dsh-promptopt-root" },
				react.createElement("button", {
					type: "button",
					className: "dsh-promptopt-trigger",
					disabled: disabled,
					ref: buttonRef,
					onClick: () => { void run(); },
					title: rich ? t("disabled.chips") : empty ? t("disabled.empty") : t("button.aria"),
					"aria-label": t("button.aria")
				},
					// 纯图标：工具行里其他按钮（引用 / 计划 / 模型选择）都是图标位，
					// 带文字会占掉 92px 把这一行撑长。功能靠 title 与 aria-label 表达。
					react.createElement(PromptoptIcon, null)),
				open && anchor !== undefined
					? react.createElement(PromptoptPopup, {
						snapshot: snapshot, phase: phase, result: result, onAdopt: adopt, onClose: close,
						anchor: anchor, panelRef: panelRef, t: t
					})
					: null);
		}

		const promptoptCss = [
			// 垂直齐平：宿主工具行是 flex 时靠 align-self:center，inline 布局时靠
			// vertical-align:middle（两条都写，容器用哪种都居中，不必猜宿主实现）。
			// 水平间距只留 2px：宿主工具行自带 gap，多给会把按钮推离 model select。
			".dsh-promptopt-root{position:relative;display:inline-flex;align-items:center;align-self:center;vertical-align:middle;flex:none;margin:0 2px}",
			// 28x28 图标位，与工具行里宿主自己的按钮同规格（引用 / 计划等）。
			".dsh-promptopt-trigger{color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:8px;align-items:center;justify-content:center;padding:0;width:28px;height:28px;font:inherit;font-size:12px;display:inline-flex;flex:none}",
			".dsh-promptopt-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
			".dsh-promptopt-trigger:disabled{opacity:.45;cursor:not-allowed}",
			// position:fixed + JS 锚定（见 PromptoptButton 的 useLayoutEffect）：
			// 座位在 composer 工具行里，absolute 会被祖先 overflow:hidden 裁剪。
			".dsh-promptopt-panel{z-index:30;box-sizing:border-box;border:1px solid var(--dsw-alias-border-inverted);background:var(--dsw-specific-menu);width:420px;max-width:calc(100vw - 24px);max-height:60vh;box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-secondary);border-radius:12px;flex-direction:column;display:flex;position:fixed;left:0;bottom:0;overflow:hidden;font-size:12px;line-height:20px}",
			".dsh-promptopt-header{box-sizing:border-box;align-items:center;gap:8px;min-height:40px;padding:8px 12px;display:flex;flex:none}",
			".dsh-promptopt-title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}",
			".dsh-promptopt-close{color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:6px;width:24px;height:24px;padding:0;margin-left:auto;font:inherit;font-size:14px;display:inline-flex;align-items:center;justify-content:center}",
			".dsh-promptopt-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
			".dsh-promptopt-body{flex:1;min-height:0;padding:0 12px 12px;overflow-y:auto}",
			".dsh-promptopt-label{color:var(--dsw-alias-label-caption);text-transform:uppercase;letter-spacing:.04em;margin:8px 0 4px;font-size:11px;font-weight:500;line-height:16px}",
			".dsh-promptopt-original{color:var(--dsw-alias-label-tertiary);opacity:.75;white-space:pre-wrap;word-break:break-word;max-height:14vh;overflow-y:auto}",
			".dsh-promptopt-optimized{color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;max-height:26vh;overflow-y:auto}",
			".dsh-promptopt-error{color:var(--dsw-alias-label-secondary);padding:8px 0}",
			".dsh-promptopt-pending{color:var(--dsw-alias-label-tertiary)}",
			".dsh-promptopt-spinner{width:12px;height:12px;margin-right:6px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-tertiary);border-radius:50%;display:inline-block;animation:dsh-promptopt-spin .7s linear infinite;vertical-align:-1px}",
			"@keyframes dsh-promptopt-spin{to{transform:rotate(360deg)}}",
			".dsh-promptopt-actions{align-items:center;gap:10px;border-top:1px solid var(--dsw-alias-border-l2);padding:8px 12px;display:flex;flex:none}",
			".dsh-promptopt-adopt{color:var(--dsw-alias-label-primary);cursor:pointer;background:var(--dsw-alias-interactive-bg-hover);border:none;border-radius:7px;padding:4px 12px;font:inherit;font-size:12px;line-height:18px}",
			".dsh-promptopt-adopt:hover:not(:disabled){filter:brightness(1.08)}",
			".dsh-promptopt-adopt:disabled{opacity:.45;cursor:not-allowed}",
			".dsh-promptopt-nochange{color:var(--dsw-alias-label-tertiary);margin-top:8px;font-size:12px;line-height:18px}",
			".dsh-promptopt-foot{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}"
		].join("\n");

		const LOCALE_NS_PROMPTOPT = "dsh-tokstats.promptopt";

		// 术语（两轴分离里只管 UI 轴）：整理 restructure / 采纳 adopt / 草稿 draft /
		// 原文 original / 整理结果 structured / 引用或图片 reference or image。
		// 按钮是纯图标位，功能靠 button.aria（同时用作 title 与 aria-label）表达。
		const promptoptZh = {
			"button.aria": "把这段草稿整理成结构化提示词",
			"disabled.empty": "先输入草稿再整理",
			"disabled.chips": "草稿含引用或图片，暂不支持整理",
			"panel.title": "提示词整理",
			"panel.close": "关闭",
			"panel.original": "原文",
			"panel.structured": "整理结果",
			"state.pending": "整理中…",
			"state.noChange": "原文已足够清晰，无需整理",
			"tip.needless": "整理结果与原文一致，无需采纳",
			"action.adopt": "采纳",
			"foot.done": "耗时 {seconds}s",
			"error.llm": "模型调用失败，请稍后重试",
			"error.timeout": "整理超时（60s），请重试",
			"error.badDraft": "草稿为空或过长，无法整理"
		};

		const promptoptEn = {
			"button.aria": "Restructure this draft into a structured prompt",
			"disabled.empty": "Type a draft first",
			"disabled.chips": "Drafts with references or images cannot be restructured",
			"panel.title": "Prompt restructure",
			"panel.close": "Close",
			"panel.original": "Original",
			"panel.structured": "Restructured",
			"state.pending": "Restructuring…",
			"state.noChange": "The draft is already clear — nothing to restructure",
			"tip.needless": "The result matches the original, so there is nothing to adopt",
			"action.adopt": "Adopt",
			"foot.done": "Took {seconds}s",
			"error.llm": "The model call failed — please try again",
			"error.timeout": "Restructuring timed out (60s) — please try again",
			"error.badDraft": "The draft is empty or too long to restructure"
		};

		/**
		 * promptopt 注册体：conversation.input.right（list，session scope）——
		 * composer 卡片**内部**工具行的右端，在模型选择座位之后、发送按钮之前。
		 *
		 * 这是宿主契约给可点控件的位置（dock 是「环境读数带」，宿主注释明确写着
		 * 可点控件应放 tool row）。用户实际用起来也确认：按钮在输入框里、挨着
		 * 模型选择，才符合「发送前顺手点一下」的操作逻辑。
		 */
		function promptoptApply(ctx) {
			promptoptCtx = ctx;
			ctx.slots.inject("conversation.input.right", () => ctx.slots.register(
				{ name: "conversation.input.right", id: "promptopt-button", order: 30, locale: LOCALE_NS_PROMPTOPT },
				PromptoptButton
			));
		}

		// ── plugin registry ────────────────────────────────────────────────────────

	/** One entry per pack plugin: its styles, locale namespace and registration body. */
	const PLUGINS = {
		tokprev: { css: tokprevCss, apply: tokprevApply, ns: LOCALE_NS_TOKPREV, dicts: { zh: tokprevZh, en: tokprevEn } },
		tokstats: { css: tokstatsCss, apply: tokstatsApply, ns: LOCALE_NS_TOKSTATS, dicts: { zh: tokstatsZh, en: tokstatsEn } },
		promptopt: { css: promptoptCss, apply: promptoptApply, ns: LOCALE_NS_PROMPTOPT, dicts: { zh: promptoptZh, en: promptoptEn } }
	};

	const inject = ["slots", "locale"];
	/**
	 * Browser plugin body.
	 *
	 * Client-side cordis creates ONE entry per package (from the boot manifest)
	 * with no config, so we register ALL plugins' UI here unconditionally.
	 * Server-side dispatch by config.plugin is not needed for client-only UI
	 * packs — the client bundle is a singleton and components return null when
	 * their data isn't available.
	 */
	function apply(ctx) {
		for (const [id, plugin] of Object.entries(PLUGINS)) {
			const disposeStyles = ensurePluginStyles(id, plugin.css);
			ctx.effect(() => () => disposeStyles(), "dsh-tokstats/" + id + ": styles");
			if (plugin.ns !== undefined) {
				// A namespace has exactly one owner: re-registering the same
				// (ns, locale) throws. Losing the dictionaries degrades copy to
				// bare keys, which must not cost the plugin its slots.
				try {
					const disposeDicts = ctx.locale.register(plugin.ns, plugin.dicts);
					ctx.effect(() => disposeDicts, "dsh-tokstats/" + id + ": dictionaries");
				} catch (error) {
					console.error("[dsh-tokstats] plugin " + id + " failed to register dictionaries:", error);
				}
			}
			try {
				plugin.apply(ctx);
			} catch (error) {
				// One plugin's failure must not fail the whole pack fiber: cordis
				// would unload every sibling's slots and styles on throw.
				console.error("[dsh-tokstats] plugin " + id + " failed to register:", error);
			}
		}
	}

		return { inject, apply };
	}
});