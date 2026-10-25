// tokstats client 半边测试：eval 真实 lib/client.js 产物，mock react + 伪
// ctx.slots/locale 浅渲染组件树断言。公共装配见 test/client-harness.mjs。
//
// v0.6.0 第一批起形态是**全局面板**（sidebar.panellist + root `main` keyed slot），
// 不再是侧栏脚按钮 + 弹层：panellist 的 id 与 main 的 key 必须一致（p0-b，否则
// ctx.layout.selectPanel 会抛错）。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	injectedStyleTags,
	nodesOf,
	textOf,
	rowNodesOf,
	renderDeep,
	renderWithEffects,
	setupClientBase,
	assertDictPair,
	makeRpcStub,
} from "./client-harness.mjs";
import { TOKSTATS_BUCKET_BOUNDS } from "../lib/index.js";

const NS = "dsh-tokstats.tokstats";
const PANEL_ID = "tokstats";
const CHANNEL = "/dsh-plugins.tokstats";
const TOKSTATS_LABELS = ["[0,8K)", "[8K,32K)", "[32K,128K)", "[128K,256K)", "[256K,512K)", "[512K,∞)"];

// ── 测试装配 ───────────────────────────────────────────────────────────────

/**
 * factory(react) → apply(伪 ctx) → 捕获 main / sidebar.panellist 两处注册。
 * connection 是可选的：不传即模拟「宿主无 connection 服务」，断言降级成空态。
 * 宿主形态是 `ctx.connection.rpc.call(...)`（rpc 在 connection 子对象上），
 * 故这里统一把桩包成 `{ rpc }`——直接传扁平桩会让「实现写错调用路径」测不出来。
 */
function setupClient(opts = {}) {
	const connection = opts.rpc === undefined ? opts.connection : { rpc: opts.rpc };
	const base = setupClientBase({ ...opts, connection });
	const main = base.registrations.find((r) => r.opts.name === "main");
	const list = base.registrations.find((r) => r.opts.name === "sidebar.panellist");
	return { ...base, main, list, t: base.t(NS) };
}

function panelPropsOf(rpc) {
	return { t: (key, params) => {
		const table = {
			"panel.title": "Token 用量统计",
			"state.pending": "统计中…",
			"range.days7": "近 7 天",
			"range.month": "本月",
			"range.days30": "近 30 天",
			"range.all": "全部",
			"action.refresh": "重新统计",
			"section.bucket": "上下文长度分布（按计费输入）",
			"section.daily": "每日调用量",
			"section.trend": "趋势（按周）",
			"section.workspace": "工作区排行",
			"section.route": "模型排行",
			"route.unattributed": "未标注",
			"workspace.all": "全部工作区",
			"empty.noService": "统计服务不可用，无法读取会话数据",
			"empty.noData": "暂无数据（还没有 usage 记录）",
			"foot.generated": "生成于 {time}",
			// 覆盖率披露（第二批）：走真实词典键名，模板内容与本文件断言的字面量一致。
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
			"tip.day.one": "{span}：{count} 次调用，输入 {input}，输出 {output}",
			"tip.day.other": "{span}：{count} 次调用，输入 {input}，输出 {output}",
		};
		const template = table[key] ?? key;
		if (params === undefined) return template;
		return template.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
	} };
}

/** 一份合法的 RPC 聚合返回值（host 侧 tokstatsAggregate 的形状）。 */
function makeSummary(overrides = {}) {
	// 6 桶（对齐市面计费档，TS-18）：桶 0 = [0,8K)、桶 3 = [128K,256K)。
	// 200000 落在桶 3；1000 + 3000 = 4000 落在桶 0。
	const buckets = [];
	for (let i = 0; i < 6; i += 1) buckets.push({ calls: 0, in: 0, cr: 0, cw: 0, out: 0 });
	buckets[0] = { calls: 2, in: 1000, cr: 3000, cw: 0, out: 200 };
	buckets[3] = { calls: 1, in: 200000, cr: 0, cw: 0, out: 50 };
	return {
		buckets,
		// 日序列是周趋势的真源（v0.7.0）：两格都落在 2026-10-19 那一周。
		daily: [
			{ day: "2026-10-19", calls: 2, in: 200000, cr: 0, cw: 0, out: 200 },
			{ day: "2026-10-20", calls: 1, in: 1000, cr: 3000, cw: 0, out: 50 },
		],
		weekly: [{ weekStart: "2026-10-19", calls: 3, in: 201000, cr: 3000, cw: 0, out: 250 }],
		workspaces: [
			{ path: "D:\\proj\\alpha", calls: 3, in: 201000, out: 250, cr: 3000, cw: 0 },
			{ path: "D:\\proj\\beta", calls: 1, in: 4096, out: 10, cr: 0, cw: 0 },
		],
		// 模型排行（第二批）：按 calls 降序，未标注（rt === ""）在最后。
		routes: [
			{ rt: "workbuddy/deepseek-v4.1-flash", calls: 2, in: 1000, cr: 3000, cw: 0, out: 200 },
			{ rt: "deepseek-official/deepseek-v4-flash-vision-exp", calls: 1, in: 200000, cr: 0, cw: 0, out: 50 },
			{ rt: "", calls: 1, in: 100, cr: 0, cw: 0, out: 5 },
		],
		totals: { calls: 3, in: 201000, cr: 3000, cw: 0, out: 250 },
		windowStart: "2026-07-23",
		generatedAt: 1787000000000,
		windowDays: 90,
		// 可审计性载荷（第一批在 host 侧上线，第二批开始被界面消费）。缺省造
		// 「三个会话都能读、无折叠历史」的常态；需要反例的用例显式 override。
		coverage: { sessions: 3, skipped: 0 },
		epoch: null,
		...overrides,
	};
}

/** 渲染面板并跑掉 effects（effect 里发起 RPC），最后深度展开函数组件。 */
async function renderPanel(react, main, props) {
	// 第一次渲染：收集 effect（effect 里发起 RPC）。
	main.comp(props);
	react.runEffects();
	// 等 RPC 兑现（setPhase / setData 落在 stateValues 上）。
	for (let i = 0; i < 3; i += 1) await new Promise((r) => setImmediate(r));
	react.reset();
	// 第二次渲染：反映 effect 写入的状态。深度展开 TokstatsSection / TokstatsRow。
	return renderDeep(react, main.comp(props));
}

// ── 模块 / 注册 ────────────────────────────────────────────────────────────

test("client 产物：导出 { inject: [slots, locale], apply }；tokstats 改成 panellist + main 两处注册", () => {
	const { exportsObj, registrations } = setupClient();
	// locale 是硬依赖（与官方 UI 包同构）：宿主无 locale 服务时整包不加载。
	assert.deepEqual(exportsObj.inject, ["slots", "locale"]);
	const names = registrations.map((r) => r.opts.name).sort();
	assert.ok(names.includes("main"), "应注册 root main slot");
	assert.ok(names.includes("sidebar.panellist"), "应注册侧栏列表项");
	assert.ok(!names.includes("sidebar.footer.action"), "footer 按钮已删除（P11：该 slot 被官方 cordis-panel 占用）");
});

test("AC-9 / p0-b：panellist 的 id 必须等于 main 的 key（否则 selectPanel 抛错）", () => {
	const { main, list } = setupClient();
	assert.ok(main, "main 注册应存在");
	assert.ok(list, "panellist 注册应存在");
	assert.equal(main.opts.key, PANEL_ID);
	assert.equal(list.opts.id, PANEL_ID);
	assert.equal(main.opts.key, list.opts.id, "两处寻址键必须一致");
});

test("注册形态：label 是函数（locale 切换时侧栏重取），order 排在官方面板之后", () => {
	const { list } = setupClient();
	assert.equal(typeof list.opts.label, "function", "label 必须是函数：sidebar 用 resolveSlotLabel 调用它");
	assert.equal(list.opts.label(), "Token 用量统计");
	assert.equal(typeof list.opts.order, "number");
	assert.ok(list.opts.order >= 10, "plugins=0 / schedules=10 之后，取 30");
	assert.equal(list.opts.locale, NS, "locale 声明是 t 席位的来源");
});

test("两处注册都声明 locale 命名空间（t 席位靠它注入）", () => {
	const { main, list } = setupClient();
	assert.equal(main.opts.locale, NS);
	assert.equal(list.opts.locale, NS);
});

test("词典：zh/en 键集逐键对应（I13）", () => {
	const { dicts } = setupClient();
	assertDictPair(assert, NS, dicts);
});

test("词典不含成本/模型维度键（Q6 删除）", () => {
	const { dicts } = setupClient();
	const keys = Object.keys(dicts[NS].zh);
	for (const banned of ["section.model", "value.model", "unit.noPrice", "unit.noPriceParen", "tip.cost", "tip.model", "tip.noPriceOnly", "tip.estimated", "foot.note", "tip.overview", "value.inOut"]) {
		assert.ok(!keys.includes(banned), `已删除的键 ${banned} 不应残留`);
	}
	assert.ok(keys.includes("section.bucket"), "桶分布分区标题保留");
	assert.ok(keys.includes("section.trend"), "新增趋势分区标题");
});

test("I1：client 产物无 prices 字面量（成本维度已整体删除）", () => {
	const { exportsObj } = setupClient();
	assert.ok(exportsObj !== undefined);
	// 直接读产物文本：词典与组件里都不该再出现 prices。
	const text = injectedStyleTags.map((t) => t.textContent).join("");
	assert.ok(!text.includes("prices"));
});

// ── 样式 ───────────────────────────────────────────────────────────────────

test("样式回归：全局面板是页面级容器，且不再有弹层的 position:fixed", () => {
	setupClient();
	const tag = injectedStyleTags.find((t) => t.dataset.pluginCss === "dsh-tokstats/tokstats");
	assert.ok(tag, "tokstats 样式 tag 应已注入");
	assert.match(tag.textContent, /\.dsh-tokstats-page\{/, "页面级容器规则应存在");
	assert.match(tag.textContent, /height:100%/, "全局面板撑满主区");
	assert.ok(!/position:fixed/.test(tag.textContent), "弹层定位（fixed + anchor）已随旧实现删除");
});

test("每插件样式 tag 独立（硬规则 4）", () => {
	// injectedStyleTags 是模块级累积数组：先清掉别的用例注入的，只看本次 apply。
	injectedStyleTags.length = 0;
	setupClient();
	const tags = injectedStyleTags.filter((t) => t.dataset.pluginCss !== undefined);
	assert.equal(tags.length, 3, "三个插件各一个 tag");
	const ids = new Set(tags.map((t) => t.dataset.pluginCss));
	assert.equal(ids.size, tags.length, "同一 id 不应重复注入");
	assert.ok(ids.has("dsh-tokstats/tokstats"));
});

// ── 数据通道 ───────────────────────────────────────────────────────────────

test("面板打开时发一次 RPC（channel / endpoint / 缺省窗口）", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	// 打开时并发拉两块：主报表 + promptopt 计数器（AC-13）。
	assert.equal(rpc.calls.length, 2, "打开即各拉一次");
	const summary = rpc.calls.find((c) => c.endpoint === "summary");
	const counters = rpc.calls.find((c) => c.endpoint === "promptopt");
	assert.ok(summary, "应拉主报表");
	assert.ok(counters, "应拉 promptopt 计数器");
	assert.equal(summary.channel, CHANNEL);
	assert.equal(summary.payload.windowDays, 7, "缺省档位是近 7 天");
	assert.equal(summary.payload.workspace, undefined, "未选工作区时不传该字段");
	assert.ok(tree !== null);
});

test("AC-9：桶分布 6 行全渲染，非零桶显示数值、零桶显示破折号", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const nodes = nodesOf(tree);
	// v0.7.0 起桶行是比例条（meter），标签与数值各占一列、明细另起一行。
	const labels = nodes.filter((n) => typeof n.props.className === "string" && n.props.className === "dsh-tokstats-meterLabel").map((n) => textOf(n));
	for (const bucket of TOKSTATS_LABELS) {
		assert.ok(labels.includes(bucket), `桶 ${bucket} 应有一行`);
	}
	const dimBuckets = nodes.filter((n) => typeof n.props.className === "string"
		&& /dsh-tokstats-dim/.test(n.props.className)
		&& TOKSTATS_LABELS.some((label) => textOf(n).startsWith(label)));
	assert.equal(dimBuckets.length, 4, "零桶行加 dim（4 个空桶）");
	assert.ok(textOf(tree).includes("—"), "零桶显示破折号");
});

test("桶标签与 host 侧边界逐项对齐（TS-18：改一边必须改另一边）", async () => {
	// client 的标签数组是纯记号、不进词典（AGENTS 规则 7），因此没有别的机制
	// 保证它与 host 的 TOKSTATS_BUCKET_BOUNDS 同步：两边各自写死，漏改一边的
	// 症状是「面板显示的区间与实际落桶不是同一个」——不报错，只是数字说谎。
	// 这条用例是唯一把它们钉在一起的地方。
	//
	// **期望值由 host 边界生成、实际值从渲染树取**，两个方向都不能偷懒：
	// - 期望值写成字面量时，改 host 边界（如把 1M 改成 2M）用例照样绿；
	// - 实际值取本文件的 TOKSTATS_LABELS 常量时，改 client 的标签用例照样绿。
	// 两次反向验证各抓到过其中一种假绿，故这里两头都掐死。
	const human = (n) => (n >= 1048576 ? String(n / 1048576) + "M" : String(n / 1024) + "K");
	const expected = [];
	for (let i = 0; i <= TOKSTATS_BUCKET_BOUNDS.length; i += 1) {
		const lo = i === 0 ? "0" : human(TOKSTATS_BUCKET_BOUNDS[i - 1]);
		const hi = i === TOKSTATS_BUCKET_BOUNDS.length ? "∞" : human(TOKSTATS_BUCKET_BOUNDS[i]);
		expected.push("[" + lo + "," + hi + ")");
	}

	// 实际渲染出来的标签（不是常量）：桶行标签是 meterLabel 节点的文本。
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const rendered = nodesOf(tree)
		.filter((n) => typeof n.props.className === "string" && n.props.className === "dsh-tokstats-meterLabel")
		.map((n) => textOf(n))
		.filter((label) => label.startsWith("["));
	assert.deepEqual(rendered, expected, "面板渲染出的桶区间必须逐项等于 host 边界（下界与上界都比）");
	// 测试文件里的常量也不能漂：其它用例（AC-9 / 桶行明细）靠它定位行。
	assert.deepEqual(TOKSTATS_LABELS, expected, "测试常量与 host 边界一致");
});

test("桶行：计数与四桶明细分两行（条形图长度不被长数值挤压）", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const meters = nodesOf(tree).filter((n) => typeof n.props.className === "string" && n.props.className === "dsh-tokstats-meter");
	const bigBucket = meters.find((n) => textOf(n).startsWith("[128K,256K)"));
	assert.ok(bigBucket, "非零桶行应存在");
	const value = nodesOf(bigBucket).find((n) => n.props.className === "dsh-tokstats-meterValue");
	const detail = nodesOf(bigBucket).find((n) => n.props.className === "dsh-tokstats-meterDetail");
	assert.equal(textOf(value), "1 次", "数值列只放计数");
	assert.match(textOf(detail), /输入 200K · 输出 50 · 命中 0%/, "四桶明细在第二行");
	// 比例条按调用次数占比：1/3 ≈ 33.3%
	const fill = nodesOf(bigBucket).find((n) => n.props.className === "dsh-tokstats-meterFill");
	assert.equal(fill.props.style.width, "33.3%");
});

test("AC-9：趋势分区渲染周行（四列表：周起点 / 次数 / 输入 / 输出）", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const text = textOf(tree);
	assert.ok(text.includes("趋势（按周）"), "趋势分区标题");
	assert.ok(text.includes("10/19"), "周起点按 M/D 显示");
	// 周行的「输入」是 in+cr+cw = 204K，不是未缓存的 201K（TS-17）。
	// 断言必须落在周行节点上：整树 includes 会被 KPI 的 hint「未缓存 201K」误命中，
	// 那样即使周行退回未缓存口径也照样绿（正是本次要防的回归）。
	const weekRow = rowNodesOf(tree).find((n) => textOf(n).startsWith("10/19"));
	assert.ok(weekRow !== undefined, "周行应存在");
	const cells = nodesOf(weekRow)
		.filter((n) => n.props.className === "dsh-tokstats-cellNum")
		.map((n) => textOf(n));
	assert.deepEqual(cells, ["3", "204K", "250"], "次数 / 输入（计费口径）/ 输出");
});

test("AC-9：工作区切换器出现且含「全部工作区」与各项", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const select = nodesOf(tree).find((n) => n.type === "select");
	assert.ok(select, "工作区切换器应渲染");
	const options = nodesOf(select).filter((n) => n.type === "option").map((n) => n.props.value);
	assert.deepEqual(options, ["", "D:\\proj\\alpha", "D:\\proj\\beta"]);
	assert.ok(textOf(select).includes("全部工作区"));
});

	test("时间档位：四个按钮按「近 7 天 / 本月 / 近 30 天 / 全部」排列，缺省选中近 7 天", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const buttons = nodesOf(tree).filter((n) => n.type === "button"
		&& typeof n.props.className === "string" && n.props.className.includes("dsh-tokstats-switch"));
	assert.equal(buttons.length, 4, "四个时间档位");
	assert.deepEqual(buttons.map((b) => textOf(b)), ["近 7 天", "本月", "近 30 天", "全部"]);
	// 按钮 key 必须是档位 id，不能是折算后的天数：每月 7 号「本月」与「近 7 天」
	// 的 windowDays 都是 7，用天数当 key 会让两个按钮 key 撞车（React 重复 key 警告
	// + 高亮错配）。断言写成 id 白名单而不是「四者不同」——后者在每月 22 号这类
	// 「折算值恰好不撞车」的日子对回归仍有假绿，必须直接钉死寻址形态。
	const keys = buttons.map((b) => b.props.key);
	assert.deepEqual(keys, ["days7", "month", "days30", "all"], "档位按 id 寻址（与词典键 range.<id> 同源）");
	const on = buttons.filter((b) => b.props.className.includes("dsh-tokstats-switchOn"));
	assert.equal(on.length, 1, "同时只能有一个档位高亮");
	assert.equal(textOf(on[0]), "近 7 天", "缺省选中近 7 天");
});

test("切换窗口：每个档位各发一次请求（近 7 天 / 本月 / 近 30 天 / 全部=0）", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const props = { t };
	let tree = main.comp(props);
	react.runEffects();
	await new Promise((r) => setImmediate(r));
	// 首轮：主报表 + 计数器各一次（缺省近 7 天）
	const first = rpc.calls.filter((c) => c.endpoint === "summary");
	assert.equal(first.length, 1);
	assert.equal(first[0].payload.windowDays, 7, "缺省发 7 天");

	// 「本月」折算成「今天是几号」，全部档发 0；两者与已有请求的 windowDays 相同时
	// （例如今天是 7 号 / 30 号）effect 不会重跑——这是按值去重的正常结果，断言
	// 因此按时长变化与否分支，否则用例会在每月 7 号 / 30 号随机失败。
	const monthDays = new Date().getDate();
	const sequence = [
		{ label: "全部", expect: 0 },
		{ label: "近 30 天", expect: 30 },
		{ label: "本月", expect: monthDays },
	];
	let previous = 7;
	for (const step of sequence) {
		react.reset();
		const buttons = nodesOf(tree).filter((n) => n.type === "button"
			&& typeof n.props.className === "string" && n.props.className.includes("dsh-tokstats-switch"));
		const before = rpc.calls.filter((c) => c.endpoint === "summary").length;
		buttons.find((b) => textOf(b) === step.label).props.onClick();
		react.reset();
		tree = main.comp(props);
		react.runEffects();
		await new Promise((r) => setImmediate(r));
		const summaries = rpc.calls.filter((c) => c.endpoint === "summary");
		if (step.expect === previous) {
			assert.equal(summaries.length, before, `「${step.label}」窗口与当前相同时不重复请求`);
		} else {
			assert.equal(summaries.length, before + 1, `「${step.label}」切档发一次`);
			assert.equal(summaries[summaries.length - 1].payload.windowDays, step.expect, `「${step.label}」档的 windowDays`);
		}
		previous = step.expect;
	}
});

test("降级：connection 缺席时显示空态文案，不抛错（I8）", async () => {
	const { react, main, t } = setupClient({ connection: undefined });
	assert.doesNotThrow(() => main.comp({ t }));
	const tree = await renderPanel(react, main, { t });
	assert.ok(textOf(tree).includes("统计服务不可用"), "无 connection 时显示服务不可用");
});

test("降级：RPC 返回 ok:false 时显示空态，不抛错", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: false, error: { code: "model-unavailable", message: "x", details: {} } }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	assert.ok(textOf(tree).includes("统计服务不可用"));
});

test("降级：传输抛异常时显示空态，不抛错", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => { throw new Error("network down"); });
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	assert.ok(textOf(tree).includes("统计服务不可用"));
});

test("空数据：buckets 全零时显示「暂无数据」", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary({
		buckets: Array.from({ length: 6 }, () => ({ calls: 0, in: 0, cr: 0, cw: 0, out: 0 })),
		daily: [],
		weekly: [],
		workspaces: [],
		totals: { calls: 0, in: 0, cr: 0, cw: 0, out: 0 },
	}) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	assert.ok(textOf(tree).includes("暂无数据"));
});

// ── v0.7.0 统计面板：KPI / 每日柱 / 工作区排行 / 刷新 ────────────────────────

test("KPI 四卡：调用次数 / 输入 / 输出 / 缓存命中率，数值来自 totals", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const kpis = nodesOf(tree).filter((n) => typeof n.props.className === "string" && n.props.className === "dsh-tokstats-kpi");
	assert.equal(kpis.length, 4, "四张指标卡");
	const values = kpis.map((n) => textOf(n));
	// totals: calls 3 / in 201000 / cr 3000 / cw 0 / out 250 → 输入 204K，命中率 1%
	assert.ok(values[0].includes("3"), "调用次数");
	assert.ok(values[1].includes("204K"), "输入 = in + cr + cw");
	assert.ok(values[2].includes("250"), "输出合计");
	assert.ok(values[3].includes("1%"), "命中率 = cr / (in+cr+cw)");
	// 面板不再有两个「输入」：卡名是「输入」，hint 拆未缓存 / 缓存读（TS-17）。
	assert.ok(values[1].startsWith("输入204K"), `卡名应为「输入」，实际 ${values[1]}`);
	assert.ok(!values[1].includes("计费输入"), "不再用「计费输入」这个名字");
	assert.match(values[1], /未缓存 201K · 缓存读 3\.0K/, "hint 拆出未缓存与缓存读");
});

test("面板所有「输入」显示值统一为 in+cr+cw（KPI / 周行 / 日柱 tooltip / 工作区 / 模型排行）", async () => {
	// 这条是 TS-17 的聚合断言：夹具四桶非零且互不相等，任何一处退回「只显示未缓存
	// 输入」都会落到不同的数字上（201K vs 204K、1.0K vs 4.0K），因此能真正区分口径。
	// 只断言某一处不够：本次缺陷正是「同一面板 8 处里 6 处漏了 cr/cw」。
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });

	// 1) KPI 卡值 = totals 的 billed
	const kpis = nodesOf(tree).filter((n) => typeof n.props.className === "string" && n.props.className === "dsh-tokstats-kpi");
	assert.match(textOf(kpis[1]), /^输入204K/, "KPI 值 = billed(totals) = 204K");

	// 2) 周行 = weekly 的 billed（201000 + 3000）
	const weekRow = rowNodesOf(tree).find((n) => textOf(n).startsWith("10/19"));
	const weekCells = nodesOf(weekRow)
		.filter((n) => n.props.className === "dsh-tokstats-cellNum").map((n) => textOf(n));
	assert.deepEqual(weekCells, ["3", "204K", "250"], "周行「输入」= billed(weekly)");

	// 3) 日柱 tooltip = daily 各日的 billed（列聚合必须带 cr/cw）
	const barTitles = nodesOf(tree)
		.filter((n) => typeof n.props.className === "string" && /(?:^|\s)dsh-tokstats-bar(?:\s|$)/.test(n.props.className))
		.map((n) => String(n.props.title ?? ""))
		.filter((title) => title.length > 0);
	assert.equal(barTitles.length, 2, "两天有数据 → 两根柱各有 tooltip");
	assert.ok(barTitles[0].includes("输入 200K"), `10/19 的输入 = billed = 200K，实际 ${barTitles[0]}`);
	assert.ok(barTitles[1].includes("输入 4.0K"), `10/20 的输入 = 1000+3000 = 4.0K，实际 ${barTitles[1]}`);
	// 若列聚合漏了 cr（缺陷形态），10/20 会显示「输入 1.0K」——这一条专门钉住它。
	assert.ok(!barTitles.some((title) => title.includes("输入 1.0K")), "日柱不得退回未缓存口径");

	// 4) 工作区排行 detail 与 tooltip 同口径
	const meters = nodesOf(tree).filter((n) => typeof n.props.className === "string"
		&& /(?:^|\s)dsh-tokstats-meter(?:\s|$)/.test(n.props.className));
	const meterByLabel = (label) => meters.find((n) => {
		const el = nodesOf(n).find((c) => c.props.className === "dsh-tokstats-meterLabel");
		return el !== undefined && textOf(el) === label;
	});
	const detailOf = (meter) => textOf(nodesOf(meter).find((c) => c.props.className === "dsh-tokstats-meterDetail"));
	const alpha = meterByLabel("…\\proj\\alpha");
	const beta = meterByLabel("…\\proj\\beta");
	assert.match(detailOf(alpha), /^输入 204K · 输出 250/, "工作区 alpha = billed 204K");
	assert.match(detailOf(beta), /^输入 4\.1K · 输出 10/, "工作区 beta = 4096 + 0 = 4.1K");
	assert.ok(String(alpha.props.title).includes("输入 204K"), "工作区 tooltip 与 detail 同口径");
	assert.ok(String(beta.props.title).includes("输入 4.1K"), "工作区 tooltip 与 detail 同口径");

	// 5) 模型排行 detail 与 tooltip 同口径
	const workbuddy = meterByLabel("workbuddy/deepseek-v4.1-flash");
	const official = meterByLabel("deepseek-official/deepseek-v4-flash-vision-exp");
	assert.match(detailOf(workbuddy), /^输入 4\.0K · 输出 200 · 命中 75%/, "workbuddy = 1000 + 3000 = 4.0K");
	assert.match(detailOf(official), /^输入 200K · 输出 50 · 命中 0%/, "official = 200000 + 0 = 200K");
	assert.ok(String(workbuddy.props.title).includes("输入 4.0K"), "模型排行 tooltip 与 detail 同口径");
	assert.ok(String(official.props.title).includes("输入 200K"), "模型排行 tooltip 与 detail 同口径");

	// 6) 反向：整棵树里不得出现未缓存口径被当成「输入」的旧值
	const text = textOf(tree);
	assert.ok(!/输入 201K/.test(text), "不得出现未缓存口径的「输入 201K」（缺陷形态）");
	assert.ok(!/输入 1\.0K/.test(text), "不得出现未缓存口径的「输入 1.0K」（缺陷形态）");
});

test("KPI：窗口天数参与日均换算（1 天窗口 → 3/1 = 3.0）", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary({ windowDays: 1 }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const kpis = nodesOf(tree).filter((n) => typeof n.props.className === "string" && n.props.className === "dsh-tokstats-kpi");
	assert.ok(textOf(kpis[0]).includes("3.0"), "1 天窗口下日均 = 3.0");
});

test("每日柱状图：按窗口跨度压缩成至多 60 列，柱高按峰值归一", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const bars = nodesOf(tree).filter((n) => typeof n.props.className === "string" && /(?:^|\s)dsh-tokstats-bar(?:\s|$)/.test(n.props.className));
	assert.ok(bars.length > 0, "应有柱位");
	assert.ok(bars.length <= 60, `列数应 ≤ 60，实际 ${bars.length}`);
	assert.ok(textOf(tree).includes("每日调用量"), "每日分区标题");
	const fills = nodesOf(tree).filter((n) => typeof n.props.className === "string" && n.props.className === "dsh-tokstats-barFill");
	const heights = fills.map((n) => Number.parseFloat(n.props.style.height));
	assert.ok(heights.includes(100), "峰值列应为 100%");
	assert.ok(heights.every((h) => h > 0 && h <= 100), "柱高在 (0,100] 内");
});

test("每日柱：零调用列不画柱（只有柱位，不画 2px 假数据）", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const bars = nodesOf(tree).filter((n) => typeof n.props.className === "string" && /(?:^|\s)dsh-tokstats-bar(?:\s|$)/.test(n.props.className));
	const fills = nodesOf(tree).filter((n) => typeof n.props.className === "string" && n.props.className === "dsh-tokstats-barFill");
	// fixture 只有 10/19、10/20 两天有数据，但图表从首个数据日画到今天（含零日）
	assert.ok(bars.length >= fills.length, "柱位不少于填充柱");
	assert.equal(fills.length, 2, "只有两天有数据 → 只有两根柱");
});

test("每日柱：起点不早于首个数据日（避免整段空窗口）", async () => {
	const rpc = makeRpcStub();
	// 数据只有 10/19–10/20 两天，windowStart 却是 90 天前：图表应从 10/19 画起。
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const axis = nodesOf(tree).find((n) => typeof n.props.className === "string" && n.props.className === "dsh-tokstats-axis");
	const axisText = textOf(axis);
	assert.ok(axisText.startsWith("10/19"), `左轴应为首个数据日 10/19，实际 ${axisText}`);
});

test("每日柱：无 daily 字段时整卡不渲染（兼容旧 host 返回值）", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary({ daily: undefined }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	assert.ok(!textOf(tree).includes("每日调用量"), "无日序列时不显示空图");
	assert.ok(textOf(tree).includes("趋势（按周）"), "其余卡片照常");
});

test("工作区排行：按调用次数排序并显示占比条", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const text = textOf(tree);
	assert.ok(text.includes("工作区排行"), "工作区卡片标题");
	const meters = nodesOf(tree).filter((n) => typeof n.props.className === "string" && n.props.className === "dsh-tokstats-meter");
	const workspaceMeters = meters.filter((n) => textOf(n).includes("proj"));
	assert.equal(workspaceMeters.length, 2, "两个工作区各一行");
	// alpha 3 次 / beta 1 次 → 占比 75% / 25%
	const fills = nodesOf(workspaceMeters[0]).filter((n) => n.props.className === "dsh-tokstats-meterFill");
	assert.equal(fills[0].props.style.width, "75.0%");
});

test("刷新按钮：点击后重跑一次 RPC（窗口/工作区不变也生效）", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const props = { t };
	let tree = main.comp(props);
	react.runEffects();
	await new Promise((r) => setImmediate(r));
	assert.equal(rpc.calls.filter((c) => c.endpoint === "summary").length, 1);

	react.reset();
	const refresh = nodesOf(tree).find((n) => typeof n.props.className === "string" && n.props.className.includes("dsh-tokstats-refresh"));
	assert.ok(refresh, "刷新按钮应渲染");
	assert.equal(refresh.props["aria-label"], "重新统计");
	refresh.props.onClick();
	react.reset();
	tree = main.comp(props);
	react.runEffects();
	await new Promise((r) => setImmediate(r));
	assert.equal(rpc.calls.filter((c) => c.endpoint === "summary").length, 2, "刷新再发一次");
});

test("页脚：右侧显示统计区间（窗口下界 – 今天）", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const range = nodesOf(tree).find((n) => typeof n.props.className === "string" && n.props.className === "dsh-tokstats-footRange");
	assert.ok(range, "页脚区间应渲染");
	assert.match(textOf(range), /7\/23 – \d{1,2}\/\d{1,2}/, "窗口下界 2026-07-23 → 7/23");
});

test("页脚：windowStart 为空（全部档）时显示「全部历史」", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary({ windowStart: "" }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const range = nodesOf(tree).find((n) => typeof n.props.className === "string" && n.props.className === "dsh-tokstats-footRange");
	assert.equal(textOf(range), "全部历史");
});

test("页脚：显示生成时刻（固定 24 小时制）", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const foot = nodesOf(tree).find((n) => typeof n.props.className === "string" && n.props.className === "dsh-tokstats-foot");
	assert.ok(foot, "页脚应渲染");
	assert.match(textOf(foot), /生成于 \d{2}:\d{2}:\d{2}/, "固定 24 小时制 HH:MM:SS");
});

test("不渲染成本列（Q6 已删成本维度；模型排行是另一回事）", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const text = textOf(tree);
	// 「按模型」这一条已随第二批删除：新卡的标题就是「模型排行」，两者必然冲突
	// （tka8-7f 的裁决）。成本维度仍由下面三条 + guard 的 prices 拦截守住。
	assert.ok(!text.includes("¥"), "无金额");
	assert.ok(!text.includes("未配价"), "无未配价标注");
	assert.ok(!text.includes("成本"), "无成本列");
});





// ── 模型排行卡（第二批 tka8-6/7） ───────────────────────────────────────────

test("AC-13 / tka8-7a：排行卡渲染 rt 作为标签、占比条与次数", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const text = textOf(tree);
	assert.ok(text.includes("模型排行"), "卡片标题");
	assert.ok(text.includes("3 个"), "右上角显示路由数（extra.routes）");
	// 标签是 host 拼好的整串，client 不拆（I1′）
	assert.ok(text.includes("workbuddy/deepseek-v4.1-flash"), "rt 整串作为标签");
	// 词边界正则（与既有柱状图用例同写法）：精确相等会漏掉带 `dsh-tokstats-dim`
	// 的未标注行，纯 includes 又会命中 meterLabel / meterTrack 这些子元素。
	const METER = /(?:^|\s)dsh-tokstats-meter(?:\s|$)/;
	const meters = nodesOf(tree).filter((n) => typeof n.props.className === "string" && METER.test(n.props.className));
	const routeMeters = meters.filter((n) => {
		const text = textOf(n);
		return text.includes("workbuddy/") || text.includes("deepseek-official/deepseek-v4-flash-vision-exp") || text.includes("未标注");
	});
	assert.equal(routeMeters.length, 3, "三条路由各一行（含未标注）");
	// 2 / 4 = 50%
	const fills = nodesOf(routeMeters[0]).filter((n) => n.props.className === "dsh-tokstats-meterFill");
	assert.equal(fills[0].props.style.width, "50.0%", "占比 = calls / 各行次数之和");
});

test("AC-13 / tka8-7b：未标注行渲染 route.unattributed 文案并带 dim", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const dimMeters = nodesOf(tree).filter((n) => typeof n.props.className === "string"
		&& n.props.className.includes("dsh-tokstats-meter")
		&& n.props.className.includes("dsh-tokstats-dim"));
	const labelled = dimMeters.map((n) => textOf(n));
	const unattributed = labelled.find((text) => text.includes("未标注"));
	assert.ok(unattributed !== undefined, "未标注行必须用词典文案（不是裸空串）");
	assert.ok(!labelled.some((text) => text.startsWith(" 次")), "不得渲染成空标签");
});

test("AC-13：长 rt 标签整串保留在 DOM（截断交给 CSS ellipsis + tooltip）", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const long = "deepseek-official/deepseek-v4-flash-vision-exp";
	const meter = nodesOf(tree).find((n) => typeof n.props.className === "string"
		&& n.props.className.includes("dsh-tokstats-meter")
		&& textOf(n).includes(long));
	assert.ok(meter !== undefined, "42 字符的 rt 必须原样渲染（Q14：不拆字符串）");
	assert.ok(String(meter.props.title ?? "").includes(long), "完整 rt 进 tooltip");
});

test("旧 host 兼容：无 routes 字段时整卡不渲染、不抛错（I10 / 硬规则 6）", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary({ routes: undefined }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	assert.ok(!textOf(tree).includes("模型排行"), "无 routes 时不渲染空卡");
	assert.ok(textOf(tree).includes("工作区排行"), "其余卡片照常");
});

test("旧 host 兼容：routes 为空数组时同样整卡不渲染", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary({ routes: [] }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	assert.ok(!textOf(tree).includes("模型排行"));
});

test("AC-13 / tka8-6e：词典 7 个新键 zh/en 成对且值里不出现 provider / model 两词", () => {
	// 值里不能出现这两个词：guard 的 DIMENSION_USE 会扫 client 产物，标题取
	// 「模型排行 / Models」正是为了不与 `provider:` / `model:` 形态撞车（R6）。
	const { dicts } = setupClient();
	const pair = dicts[NS];
	assert.ok(pair !== undefined, `${NS} 词典应已注册`);
	const zh = pair.zh;
	const en = pair.en;
	const added = [
		"section.route",
		"extra.routes.one", "extra.routes.other",
		"route.unattributed",
		"cell.routeDetail",
		"tip.route.one", "tip.route.other",
	];
	for (const key of added) {
		assert.ok(Object.prototype.hasOwnProperty.call(zh, key), `zh 缺键 ${key}`);
		assert.ok(Object.prototype.hasOwnProperty.call(en, key), `en 缺键 ${key}`);
		assert.ok(!/\bprovider\b/i.test(zh[key]), `zh ${key} 不得出现 provider`);
		assert.ok(!/\bmodel\b/i.test(zh[key]), `zh ${key} 不得出现 model`);
		assert.ok(!/\bprovider\b/i.test(en[key]), `en ${key} 不得出现 provider`);
		assert.ok(!/\bmodel\b/i.test(en[key]), `en ${key} 不得出现 model`);
	}
	assert.equal(zh["section.route"], "模型排行");
	assert.equal(en["section.route"], "Models");
	assert.equal(zh["route.unattributed"], "未标注");
	assert.equal(en["route.unattributed"], "Unattributed");
});


// ── promptopt 计数器区块（AC-13） ──────────────────────────────────────────

test("AC-13：计数器可用时渲染使用情况区块", async () => {
	const rpc = makeRpcStub();
	rpc.respond((call) => call.endpoint === "promptopt"
		? { ok: true, value: { started: 3, adopted: 2, dismissed: 1, charsDelta: -12 } }
		: { ok: true, value: makeSummary() });
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const text = textOf(tree);
	assert.ok(text.includes("提示词整理使用情况"), "应渲染计数器分区");
	assert.ok(text.includes("3 / 2 / 1"), "发起 / 采纳 / 放弃三个数");
	const row = nodesOf(tree).find((n) => typeof n.props.className === "string" && n.props.className.includes("dsh-tokstats-row") && String(n.props.title ?? "").includes("字符增减"));
	assert.ok(row, "行 tooltip 应带字符增减量");
	assert.match(row.props.title, /-12/);
});

test("AC-13：计数器不可用（null）时整块不渲染，不显示假零", async () => {
	const rpc = makeRpcStub();
	rpc.respond((call) => call.endpoint === "promptopt"
		? { ok: false, error: { code: "model-unavailable", message: "x", details: {} } }
		: { ok: true, value: makeSummary() });
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	assert.ok(!textOf(tree).includes("提示词整理使用情况"), "计数器不可用时隐藏该分区");
});

test("AC-13：正增量带 + 号，零增量不带", async () => {
	const rpc = makeRpcStub();
	rpc.respond((call) => call.endpoint === "promptopt"
		? { ok: true, value: { started: 1, adopted: 1, dismissed: 0, charsDelta: 40 } }
		: { ok: true, value: makeSummary() });
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const row = nodesOf(tree).find((n) => typeof n.props.className === "string" && n.props.className.includes("dsh-tokstats-row") && String(n.props.title ?? "").includes("字符增减"));
	assert.match(row.props.title, /\+40/);
});

// ── 第二条：覆盖率披露与 epoch 打标（第二批；TS-21 / TS-22） ────────────────
//
// 这两组的失败模式都是「界面撒谎」：少报跳过数会让读者以为数据完整；该打标的
// 列不打标会让一个合成的历史尖峰看起来像真实的一天。两者都只能靠断言抓。

/** 页脚节点（含覆盖率披露与区间）。 */
function footOf(tree) {
	return nodesOf(tree).find((n) => typeof n.props.className === "string" && n.props.className === "dsh-tokstats-foot");
}

/** 覆盖率披露节点（缺失时返回 undefined，供「不渲染」断言用）。 */
function coverageNodeOf(tree) {
	return nodesOf(tree).find((n) => typeof n.props.className === "string" && n.props.className === "dsh-tokstats-footCoverage");
}

test("TS-21 / AC-2：页脚渲染「已统计 N 个会话」", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary({ coverage: { sessions: 42, skipped: 0 } }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const coverage = coverageNodeOf(tree);
	assert.ok(coverage, "覆盖率披露节点应渲染");
	assert.equal(textOf(coverage), "已统计 42 个会话");
	// 页脚仍保留生成时刻与区间（新句子不得把它们挤掉）。
	const foot = footOf(tree);
	assert.match(textOf(foot), /生成于 \d{2}:\d{2}:\d{2}/);
	assert.ok(textOf(foot).includes("7/23"), "统计区间仍在页脚");
});

test("TS-21 / AC-2：skipped > 0 才出现「跳过」，并带原因 tooltip", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary({ coverage: { sessions: 5, skipped: 2 } }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const coverage = coverageNodeOf(tree);
	assert.ok(coverage, "覆盖率披露节点应渲染");
	const text = textOf(coverage);
	assert.ok(text.includes("已统计 5 个会话"), `应含会话数，实际 ${text}`);
	assert.ok(text.includes("跳过 2 个"), `应含跳过数，实际 ${text}`);
	assert.ok(text.includes("日志不可读"), "应写明原因");
	assert.match(String(coverage.props.title), /5 个会话/);
	assert.match(String(coverage.props.title), /2 个会话日志不可读/);
	// 占位符必须被替换（踩过：模板写 {sessions} 而 tCount 注入的是 count，
	// 结果 tooltip 直接显示「本次统计覆盖 {sessions} 个会话」）。
	assert.ok(!/\{\w+\}/.test(String(coverage.props.title)), `tooltip 不得残留未替换占位符，实际 ${coverage.props.title}`);
});

test("TS-21 / AC-2：skipped === 0 时不显示「跳过」（不显示假零）", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary({ coverage: { sessions: 3, skipped: 0 } }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const text = textOf(tree);
	assert.ok(!text.includes("跳过"), "零跳过时不得出现「跳过 0 个」这类假零");
	assert.ok(!text.includes(" 0 个"), "不得出现任何「0 个」形式");
	// tooltip 也不该提跳过。
	const coverage = coverageNodeOf(tree);
	assert.ok(!String(coverage.props.title).includes("跳过"));
});

test("TS-21：旧 host 无 coverage 字段时整句不渲染、不抛错（硬规则 6）", async () => {
	const rpc = makeRpcStub();
	// 模拟旧 host：把 coverage 整个删掉（不是设 null）。
	const summary = makeSummary();
	delete summary.coverage;
	rpc.respond(() => ({ ok: true, value: summary }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	assert.equal(coverageNodeOf(tree), undefined, "无 coverage 时不得渲染该句");
	assert.ok(!textOf(tree).includes("已统计"), "无 coverage 时不得出现「已统计」");
	// 其余照常。
	assert.ok(textOf(tree).includes("每日调用量"));
	assert.ok(textOf(footOf(tree)).includes("7/23"));
});

test("TS-21：coverage 为空对象 / sessions 非数字时同样不渲染（降级不抛错）", async () => {
	for (const coverage of [{}, { sessions: "many", skipped: 1 }, null]) {
		const rpc = makeRpcStub();
		rpc.respond(() => ({ ok: true, value: makeSummary({ coverage }) }));
		const { react, main, t } = setupClient({ rpc });
		const tree = await renderPanel(react, main, { t });
		assert.equal(coverageNodeOf(tree), undefined, `coverage=${JSON.stringify(coverage)} 时不得渲染该句`);
	}
});

/** 「校验中」节点（缺失时 undefined，供反向断言用）。 */
function verifyingNodeOf(tree) {
	return nodesOf(tree).find((n) => typeof n.props.className === "string" && n.props.className === "dsh-tokstats-footVerifying");
}

test("TS-24：verifying 为 true 时页脚显示「校验中」", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary({ verifying: true }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const node = verifyingNodeOf(tree);
	assert.ok(node, "verifying=true 时必须有「校验中」提示");
	assert.equal(textOf(node), "校验中…");
	// 过渡态提示不得挤掉页脚原有信息。
	assert.match(textOf(footOf(tree)), /生成于 \d{2}:\d{2}:\d{2}/);
});

test("TS-24：verifying 时不得把待校验会话谎报成「日志不可读」", async () => {
	// 首帧实测踩到：冷启动时 68 个会话只是「还没读出来」，页脚却写
	// 「跳过 68 个（日志不可读）」——那是对用户谎报故障。待校验 ≠ 读不出来。
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary({ verifying: true, coverage: { sessions: 70, skipped: 68 } }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const coverage = coverageNodeOf(tree);
	assert.ok(coverage, "覆盖率句仍要渲染");
	const text = textOf(coverage);
	assert.ok(!text.includes("跳过"), `校验中不得出现「跳过」，实际 ${text}`);
	assert.ok(!text.includes("日志不可读"), "校验中不得出现「日志不可读」");
	assert.ok(text.includes("已统计 70 个会话"), "会话数照常披露");
	// 收敛后（verifying 消失）同样的 skipped 才该显示为跳过。
	const rpc2 = makeRpcStub();
	rpc2.respond(() => ({ ok: true, value: makeSummary({ coverage: { sessions: 70, skipped: 2 } }) }));
	const second = setupClient({ rpc: rpc2 });
	const tree2 = await renderPanel(second.react, second.main, { t: second.t });
	assert.ok(textOf(coverageNodeOf(tree2)).includes("跳过 2 个"), "收敛后 skipped 才作为跳过披露");
});

test("TS-24：verifying 缺席（旧 host / 已收敛）时不显示「校验中」，也不重拉", async () => {
	for (const value of [undefined, false]) {
		const rpc = makeRpcStub();
		const summary = makeSummary();
		if (value !== undefined) summary.verifying = value;
		rpc.respond(() => ({ ok: true, value: summary }));
		const { react, main, t } = setupClient({ rpc });
		const tree = await renderPanel(react, main, { t });
		assert.equal(verifyingNodeOf(tree), undefined, `verifying=${String(value)} 时不得显示提示`);
		// 不得重拉：一轮 effect 只应发一次 summary 请求。
		const summaryCalls = rpc.calls.filter((c) => c.endpoint === "summary");
		assert.equal(summaryCalls.length, 1, `verifying=${String(value)} 时不得自动重拉`);
	}
});

test("TS-24：verifying 为 true 时自动重拉一次，收敛后停止", async () => {
	// 用真实计时器（面板的重拉间隔是 1500ms，这里把全局 setTimeout 换成同步
	// 立即触发，避免用例真的等 1.5s——重拉的**逻辑**才是被测对象）。
	const realSetTimeout = globalThis.setTimeout;
	const pendingTimers = [];
	globalThis.setTimeout = (fn) => {
		pendingTimers.push(fn);
		return 1;
	};
	try {
		const rpc = makeRpcStub();
		let round = 0;
		rpc.respond(() => {
			round += 1;
			// 第 1 轮：后台校验中；第 2 轮：已收敛。
			return { ok: true, value: makeSummary({ verifying: round === 1 }) };
		});
		const { react, main, t } = setupClient({ rpc });
		await renderPanel(react, main, { t });
		const summaryAfterFirst = rpc.calls.filter((c) => c.endpoint === "summary").length;
		assert.equal(summaryAfterFirst, 1, "首轮一次请求");
		assert.equal(pendingTimers.length, 1, "verifying=true 必须安排一次重拉");

		// 触发重拉：等价于组件因 nonce 变化重跑 effect。
		pendingTimers[0]();
		react.runEffects();
		for (let i = 0; i < 3; i += 1) await new Promise((r) => setImmediate(r));
		const summaryAfterSecond = rpc.calls.filter((c) => c.endpoint === "summary").length;
		assert.equal(summaryAfterSecond, 2, "重拉必须真的再请求一次");
		// 第二轮已收敛（verifying=false）→ 不得再安排重拉。
		assert.equal(pendingTimers.length, 1, "收敛后不得再排重拉（否则会无限轮询）");
	} finally {
		globalThis.setTimeout = realSetTimeout;
	}
});

// ── TS-25：后台自动重拉不得把面板内容换成「统计中…」（闪屏）────────────────
//
// 用户实测反馈：首屏已经很快，但后台校验期间面板**反复整块闪烁**——每轮重拉都
// 把 KPI / 桶分布 / 趋势整块卸载换成一行「统计中…」，再挂回来。1.5 s 一轮、
// 连续 3–4 轮时用户根本来不及看清任何一帧数据，观感是「一直在刷但什么都没看到」。
//
// 根因：重拉与「用户主动操作」共用同一条 loading 路径——`setPhase("loading")`
// 无条件执行，而渲染侧 `phase === "loading"` 时只渲染「统计中…」。
//
// 修法：后台自动重拉**不**再把 phase 打回 loading，已有内容继续留在屏上；
// 「数字仍在变准」由页脚的「校验中…」如实披露（TS-24 已有）。

/** 「统计中…」空态节点（出现即说明内容被卸载了）。 */
function pendingNodeOf(tree) {
	return nodesOf(tree).find((n) => typeof n.props.className === "string" && n.props.className === "dsh-tokstats-empty" && (textOf(n) || "").includes("统计中"));
}

/** KPI 卡的数值节点（存在即说明内容仍在屏上）。 */
function kpiValueNodeOf(tree) {
	return nodesOf(tree).find((n) => typeof n.props.className === "string" && n.props.className === "dsh-tokstats-kpiValue");
}

/** 档位按钮（按 type 过滤——只按类名 includes 会连父容器一起命中）。 */
function rangeButtonsOf(tree) {
	return nodesOf(tree).filter((n) => n.type === "button"
		&& typeof n.props.className === "string" && n.props.className.includes("dsh-tokstats-switch"));
}

test("TS-25：后台自动重拉期间旧内容保留在屏上，不换成「统计中…」", async () => {
	const realSetTimeout = globalThis.setTimeout;
	const pendingTimers = [];
	globalThis.setTimeout = (fn) => { pendingTimers.push(fn); return 1; };
	try {
		const rpc = makeRpcStub();
		let round = 0;
		rpc.respond(() => {
			round += 1;
			// 前两轮都在校验中（会继续排重拉），第三轮收敛。
			return { ok: true, value: makeSummary({ verifying: round <= 2 }) };
		});
		const { react, main, t } = setupClient({ rpc });
		// 首帧：走 renderPanel（它内部已 renderDeep 并反映 effect 写入的状态）。
		const first = await renderPanel(react, main, { t });
		assert.ok(kpiValueNodeOf(first) !== undefined, "首帧就该有 KPI 数值");
		assert.equal(pendingNodeOf(first), undefined, "首帧不得是「统计中…」空态");

		// 触发第一轮后台重拉：effect 重跑，此刻内容必须**仍在屏上**。
		pendingTimers[0]();
		react.runEffects();
		// 重拉在飞（RPC 尚未兑现）时渲染——这是闪烁最容易观察到的时刻。
		react.reset();
		const during = renderDeep(react, main.comp({ t }));
		assert.equal(pendingNodeOf(during), undefined, "后台重拉期间不得出现「统计中…」空态");
		assert.ok(kpiValueNodeOf(during) !== undefined, "后台重拉期间旧内容必须保留在屏上");

		// 等 RPC 兑现：数值更新，但同样不得退回空态。
		for (let i = 0; i < 3; i += 1) await new Promise((r) => setImmediate(r));
		react.reset();
		const after = renderDeep(react, main.comp({ t }));
		assert.equal(pendingNodeOf(after), undefined, "重拉完成后不得退回「统计中…」");
		assert.ok(kpiValueNodeOf(after) !== undefined, "重拉完成后内容仍在");
	} finally {
		globalThis.setTimeout = realSetTimeout;
	}
});

test("TS-25：用户主动切档位时清掉后台标记，旧内容按窗口口径换成 loading 态", async () => {
	// 反向断言：后台重拉的「保留旧内容」不得泄漏到用户主动操作上。
	// 切档位后旧窗口的数字对新窗口无意义，必须走 loading 态。
	//
	// **必须先让后台标记变成 true**（走一轮自动重拉）再点档位：只测「首帧直接
	// 点档位」是假绿——那时标记本来就是 false，清不清它都一样，测试抓不到
	// 「用户操作没有清标记」这个真实回归。
	const realSetTimeout = globalThis.setTimeout;
	const pendingTimers = [];
	globalThis.setTimeout = (fn) => { pendingTimers.push(fn); return 1; };
	try {
		const rpc = makeRpcStub();
		let round = 0;
		rpc.respond(() => {
			round += 1;
			return { ok: true, value: makeSummary({ verifying: round <= 2 }) };
		});
		const { react, main, t } = setupClient({ rpc });
		let tree = await renderPanel(react, main, { t });
		// 走一轮后台重拉 → backgroundRef 置为 true。
		pendingTimers[0]();
		react.runEffects();
		for (let i = 0; i < 3; i += 1) await new Promise((r) => setImmediate(r));
		react.reset();
		tree = renderDeep(react, main.comp({ t }));
		assert.equal(pendingNodeOf(tree), undefined, "后台重拉期间不该有空态（前提校验）");

		const buttons = rangeButtonsOf(tree);
		assert.equal(buttons.length, 4, "四个时间档位");
		// 点「本月」——口径变了，属于用户主动操作。
		react.reset();
		buttons[1].props.onClick();
		// 点击后 effect 重跑：这是「用户主动操作」，内容应被换成 loading 态。
		react.runEffects();
		react.reset();
		const after = renderDeep(react, main.comp({ t }));
		assert.ok(pendingNodeOf(after) !== undefined, "用户主动切档位后应回到「统计中…」态");
	} finally {
		globalThis.setTimeout = realSetTimeout;
	}
});

test("TS-25：后台重拉采用更长退避（3s），且不因退避变化而多排重拉", async () => {
	// 退避从 1500 提到 3000 是为了把「连续 3–4 轮闪烁」压到「1–2 轮」。
	// 这里钉住：首帧排的定时器间隔是 1500（首轮快），而**重拉之后**排的
	// 定时器间隔是 3000（后续慢）——即退避只在后台轮次之间生效。
	const realSetTimeout = globalThis.setTimeout;
	const scheduled = [];
	globalThis.setTimeout = (fn, delay) => { scheduled.push({ fn, delay }); return scheduled.length; };
	try {
		const rpc = makeRpcStub();
		let round = 0;
		rpc.respond(() => {
			round += 1;
			return { ok: true, value: makeSummary({ verifying: round <= 3 }) };
		});
		const { react, main, t } = setupClient({ rpc });
		await renderPanel(react, main, { t });
		assert.equal(scheduled.length, 1, "首帧排一个重拉定时器");
		assert.equal(scheduled[0].delay, 1500, "首轮重拉间隔 1500ms");

		// 触发第一轮后台重拉 → 它自己再排一个定时器，间隔应是 3000。
		scheduled[0].fn();
		react.runEffects();
		for (let i = 0; i < 3; i += 1) await new Promise((r) => setImmediate(r));
		assert.equal(scheduled.length, 2, "后台重拉后再排一个定时器");
		assert.equal(scheduled[1].delay, 3000, "后台轮次之间退避到 3000ms");
	} finally {
		globalThis.setTimeout = realSetTimeout;
	}
});

/** 日柱节点（含折叠标记类名与 tooltip）。 */
function barNodesOf(tree) {
	return nodesOf(tree).filter((n) => typeof n.props.className === "string" && /(?:^|\s)dsh-tokstats-bar(?:\s|$)/.test(n.props.className));
}

test("TS-22 / AC-3：epoch 非空 → 代表日那一列带折叠标记类名", async () => {
	const rpc = makeRpcStub();
	// daily 是 10/19、10/20；epoch.end = 10/21 → 代表日 = 10/20（end - 1）。
	rpc.respond(() => ({ ok: true, value: makeSummary({ epoch: { end: "2026-10-21", calls: 7 } }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const bars = barNodesOf(tree);
	const marked = bars.filter((n) => n.props.className.includes("dsh-tokstats-barEpoch"));
	assert.equal(marked.length, 1, `恰好一列带折叠标记，实际 ${marked.length}`);
	// 标记的是 10/20 那列（其 tooltip 的 span 是 10/20）。
	assert.ok(String(marked[0].props.title).includes("2026-10-20"), `应为 10/20 那列，实际 ${marked[0].props.title}`);
	assert.ok(String(marked[0].props.title).includes("含折叠历史"), "tooltip 应写明含折叠历史");
	assert.match(String(marked[0].props.title), /区间末归并/);
	assert.match(String(marked[0].props.title), /7 次/, "tooltip 应带折叠历史的调用数");
	// 其余列不带标记、tooltip 不提折叠。
	for (const bar of bars) {
		if (bar === marked[0]) continue;
		assert.ok(!bar.props.className.includes("dsh-tokstats-barEpoch"));
		assert.ok(!String(bar.props.title).includes("折叠"), "普通列不得出现折叠字样");
	}
});

test("TS-22 / AC-3：epoch 为 null 时不出现任何折叠标记（反向断言）", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary({ epoch: null }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const bars = barNodesOf(tree);
	assert.ok(bars.length > 0, "应有柱位");
	for (const bar of bars) {
		assert.ok(!bar.props.className.includes("dsh-tokstats-barEpoch"), "无 epoch 时不得出现标记类名");
		assert.ok(!String(bar.props.title).includes("折叠"), "无 epoch 时 tooltip 不得提折叠");
	}
});

test("TS-22：代表日落在合并列区间内时也要标（不只比对列首日）", async () => {
	// 造一个 90 天窗口 + 稀疏数据：列会被合并（span > 1），代表日落在列中段。
	// 只比对 startDay 的实现会在这种列上漏标——而它恰恰是「全部/长窗口」档最常见
	// 的形态（那时列必然合并）。
	const rpc = makeRpcStub();
	const daily = [
		{ day: "2026-07-01", calls: 1, in: 100, cr: 0, cw: 0, out: 1 },
		{ day: "2026-10-20", calls: 1, in: 100, cr: 0, cw: 0, out: 1 },
	];
	rpc.respond(() => ({ ok: true, value: makeSummary({ daily, windowStart: "2026-07-01", epoch: { end: "2026-08-15", calls: 3 } }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const marked = barNodesOf(tree).filter((n) => n.props.className.includes("dsh-tokstats-barEpoch"));
	assert.equal(marked.length, 1, `合并列也必须被标记，实际 ${marked.length}`);
	// 该列的区间应覆盖 2026-08-14（= end - 1）。
	assert.ok(String(marked[0].props.title).includes("8/14"), `tooltip 应含代表日 8/14，实际 ${marked[0].props.title}`);
});

test("TS-21 / TS-22：词典新增键 zh/en 成对、无 provider / model 两词", () => {
	const { dicts } = setupClient();
	assertDictPair(assert, NS, dicts);
	const zh = dicts[NS].zh;
	const en = dicts[NS].en;
	const added = [
		"foot.coverage.one", "foot.coverage.other",
		"foot.skipped.one", "foot.skipped.other",
		"tip.coverage.one", "tip.coverage.other",
		"tip.coverageSkipped.one", "tip.coverageSkipped.other",
		"tip.dayEpoch.one", "tip.dayEpoch.other",
	];
	for (const key of added) {
		assert.ok(Object.prototype.hasOwnProperty.call(zh, key), `zh 缺键 ${key}`);
		assert.ok(Object.prototype.hasOwnProperty.call(en, key), `en 缺键 ${key}`);
		assert.ok(!/\bprovider\b/i.test(zh[key]), `zh ${key} 不得出现 provider`);
		assert.ok(!/\bmodel\b/i.test(zh[key]), `zh ${key} 不得出现 model`);
		assert.ok(!/\bprovider\b/i.test(en[key]), `en ${key} 不得出现 provider`);
		assert.ok(!/\bmodel\b/i.test(en[key]), `en ${key} 不得出现 model`);
	}
	// 计数句是整句模板（带 {count} 占位符），不是「已统计」+ 数字拼接。
	assert.ok(zh["foot.coverage.one"].includes("{count}"), "计数句必须是整句模板");
	assert.ok(en["foot.coverage.one"].includes("{count}"));
	assert.ok(zh["tip.dayEpoch.other"].includes("{epochCalls}"), "折叠 tooltip 必须是整句模板");
	assert.ok(en["tip.dayEpoch.other"].includes("{epochCalls}"));
});

test("样式：折叠列用斜纹/次要底色，不写死颜色（TS-22）", () => {
	injectedStyleTags.length = 0;
	setupClient();
	const tag = injectedStyleTags.find((t) => t.dataset.pluginCss === "dsh-tokstats/tokstats");
	assert.ok(tag, "tokstats 样式 tag 应已注入");
	assert.match(tag.textContent, /\.dsh-tokstats-barEpoch/, "折叠列样式规则应存在");
	const rule = tag.textContent.match(/\.dsh-tokstats-barEpoch[^{]*\{([^}]*)\}/);
	assert.ok(rule !== null, "应能取出折叠列规则");
	assert.match(rule[1], /var\(--dsw-alias-/, "颜色必须走主题变量，不写死");
	assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(rule[1]), "不得出现写死的十六进制颜色");
	// 页脚必须允许换行，否则窄窗下覆盖率句会把统计区间挤掉（AC-2 / au2-4d）。
	const footRule = tag.textContent.match(/\.dsh-tokstats-foot\{([^}]*)\}/);
	assert.ok(footRule !== null);
	assert.match(footRule[1], /flex-wrap:wrap/, "页脚需 flex-wrap 防窄窗挤压");
});

// ── 第三条：日柱可读性与 KPI 副值语义（第三批；TS-23 / TS-17） ─────────────
//
// 这一组的失败模式是「图能看但读错」：没有刻度时读者只能看出形状、把平方根
// 刻度当线性读；柱宽没有上限时少列被拉成色块，柱宽从此表达「窗口里有几天」
// 而不是「量有多大」；KPI 副值若复述同一数字，四张卡只剩三份信息。

/** 日柱绘图区节点（含网格线与刻度口径说明）。 */
function plotOf(tree) {
	return nodesOf(tree).find((n) => typeof n.props.className === "string"
		&& /(?:^|\s)dsh-tokstats-chartPlot(?:\s|$)/.test(n.props.className));
}

/** 纵轴刻度节点（按出现顺序：峰值 / 峰值÷2 / 0）。 */
function axisTicksOf(tree) {
	return nodesOf(tree).filter((n) => typeof n.props.className === "string"
		&& /(?:^|\s)dsh-tokstats-axisTick(?:\s|$)/.test(n.props.className));
}

test("TS-23 / AC-4：日柱左轴 3 个刻度值，且最大刻度 = 峰值、中间刻度 = 峰值÷2", async () => {
	// 夹具峰值 = 2 次（10/19 两条）→ 刻度应为 "2" / "1" / "0"，全部走 fmtTok。
	// 断言按**顺序取值**而不是「包含某数字」：后者在刻度算错量级时仍会绿
	// （例如把 peak/2 写成 peak 的平方根近似值也含 "2"）。
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const ticks = axisTicksOf(tree);
	assert.equal(ticks.length, 3, `应恰有 3 个刻度，实际 ${ticks.length}`);
	assert.deepEqual(ticks.map((n) => textOf(n)), ["2", "1", "0"], "刻度值 = 峰值 / 峰值÷2 / 0");
	// 刻度必须按**平方根刻度**定位：峰值÷2 的真实高度是 sqrt(0.5)≈70.7%，
	// 不是 50%。把「2 / 1 / 0」等距摆开会让读者按线性读，与柱高对不上。
	const topRule = injectedStyleTags.find((t) => t.dataset.pluginCss === "dsh-tokstats/tokstats").textContent
		.match(/\.dsh-tokstats-axisTickTop\{([^}]*)\}/);
	const midRule = injectedStyleTags.find((t) => t.dataset.pluginCss === "dsh-tokstats/tokstats").textContent
		.match(/\.dsh-tokstats-axisTickMid\{([^}]*)\}/);
	assert.ok(topRule !== null && midRule !== null, "刻度定位规则应存在");
	assert.match(topRule[1], /bottom:100%/, "峰值刻度顶到绘图区顶部");
	assert.match(midRule[1], /bottom:70\.7%/, "峰值÷2 刻度在 sqrt(0.5)=70.7% 处");
});

test("TS-23 / AC-4：刻度值为 K/M 记号时走 fmtTok（大数不显示原始数字）", async () => {
	// 峰值 1286 次 → fmtTok → "1.3K"。这条钉住「刻度必须格式化」：
	// 直接把 1286 写进 44px 宽的轴列会溢出并被裁掉。
	const rpc = makeRpcStub();
	const daily = [
		{ day: "2026-10-19", calls: 1286, in: 100, cr: 0, cw: 0, out: 1 },
		{ day: "2026-10-20", calls: 12, in: 100, cr: 0, cw: 0, out: 1 },
	];
	rpc.respond(() => ({ ok: true, value: makeSummary({ daily }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const ticks = axisTicksOf(tree).map((n) => textOf(n));
	assert.equal(ticks[0], "1.3K", `峰值刻度应格式化为 1.3K，实际 ${ticks[0]}`);
	assert.equal(ticks[1], "643", `峰值÷2 刻度应为 643，实际 ${ticks[1]}`);
	assert.equal(ticks[2], "0");
});

test("TS-23：绘图区至少有 2 条水平网格线，且用主题变量（不写死颜色）", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const lines = nodesOf(tree).filter((n) => typeof n.props.className === "string"
		&& /(?:^|\s)dsh-tokstats-gridLine(?:\s|$)/.test(n.props.className));
	assert.ok(lines.length >= 2, `至少 2 条网格线，实际 ${lines.length}`);
	const plot = plotOf(tree);
	assert.ok(plot !== undefined, "绘图区节点应存在");
	assert.equal(lines.every((n) => nodesOf(plot).includes(n)), true, "网格线必须在绘图区内部（绝对定位的参照系）");

	injectedStyleTags.length = 0;
	setupClient();
	const css = injectedStyleTags.find((tag) => tag.dataset.pluginCss === "dsh-tokstats/tokstats").textContent;
	const lineRule = css.match(/\.dsh-tokstats-gridLine\{([^}]*)\}/);
	assert.ok(lineRule !== null, "网格线样式规则应存在");
	assert.match(lineRule[1], /var\(--dsw-alias-border-l1\)/, "网格线用 --dsw-alias-border-l1，不写死颜色");
	assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(lineRule[1]), "网格线规则不得出现写死的十六进制颜色");
});

test("TS-23 / AC-4：柱容器有列宽上限（3 列与 60 列都不溢出）、列少时居中", async () => {
	injectedStyleTags.length = 0;
	setupClient();
	const css = injectedStyleTags.find((tag) => tag.dataset.pluginCss === "dsh-tokstats/tokstats").textContent;
	const barRule = css.match(/\.dsh-tokstats-bar\{([^}]*)\}/);
	assert.ok(barRule !== null, "柱样式规则应存在");
	assert.match(barRule[1], /max-width:48px/, "柱宽上限 48px（AC-4）");
	const barsRule = css.match(/\.dsh-tokstats-bars\{([^}]*)\}/);
	assert.ok(barsRule !== null, "柱容器规则应存在");
	// 已知副作用：flex:1 + max-width 会让少列时整组挤在左侧。容器必须显式
	// 决定余量落在哪里，否则「柱宽有上限」反而让图看起来像没画满。
	assert.match(barsRule[1], /justify-content:center/, "少列时整组居中，不挤在左侧");

	// 3 列与 60 列两种输入的 DOM 都不得溢出：柱位数量与柱宽上限是两件事，
	// 这里断言「列多时不会被上限压成固定宽度」（上限只对 flex 有效，min-width
	// 3px 保证 60 列仍能排下：60 × (3+2) = 300px < 800px 主区）。
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const three = await renderPanel(react, main, { t });
	assert.equal(barNodesOf(three).length, 1 + 1, "夹具只有 2 个数据日 → 2 列");

	const manyDaily = [];
	for (let i = 0; i < 60; i += 1) {
		const d = new Date(Date.UTC(2026, 6, 23) + i * 86400000).toISOString().slice(0, 10);
		manyDaily.push({ day: d, calls: i + 1, in: 100, cr: 0, cw: 0, out: 1 });
	}
	const rpc60 = makeRpcStub();
	rpc60.respond(() => ({ ok: true, value: makeSummary({ daily: manyDaily, windowStart: "2026-07-23" }) }));
	const setup60 = setupClient({ rpc: rpc60 });
	const sixty = await renderPanel(setup60.react, setup60.main, { t: setup60.t });
	const columns = barNodesOf(sixty).length;
	assert.equal(columns, 60, `60 天窗口应逐日 60 列，实际 ${columns}`);
});

test("TS-23：sqrt 刻度可被识别（绘图区 tooltip 有口径说明，且不是裸 Math.sqrt 文案）", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const plot = plotOf(tree);
	const title = String(plot.props.title ?? "");
	// `Math.sqrt` 未声明时读者会按线性误读：「三根差不多高」被读成「三天差不多量」。
	// 说明必须落在界面上（title 是鼠标可达的最短路径），且不能是纯英文术语。
	assert.ok(title.length > 0, "绘图区必须有刻度口径说明");
	assert.ok(/平方根|平方根刻度/.test(title), `说明须点明平方根刻度，实际 ${title}`);
});

test("TS-23：峰值柱顶部标数值，其余柱只留 tooltip", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const labels = nodesOf(tree).filter((n) => typeof n.props.className === "string"
		&& /(?:^|\s)dsh-tokstats-barPeak(?:\s|$)/.test(n.props.className));
	assert.equal(labels.length, 1, `恰好一个峰值标签，实际 ${labels.length}`);
	assert.equal(textOf(labels[0]), "2", "峰值标签是峰值那天的调用数（fmtTok）");
	// 峰值标签必须落在峰值那一列的柱体内部，否则它标的是别的柱。
	// 单日列的 tooltip span 是原始日键 `2026-10-19`（合并列才是 `M/D–M/D`）。
	const peakBar = barNodesOf(tree).find((n) => nodesOf(n).includes(labels[0]));
	assert.ok(peakBar !== undefined, "峰值标签应在某根柱内");
	assert.equal(String(peakBar.props.title).includes("2026-10-19"), true,
		`峰值柱是 10/19，实际 ${peakBar.props.title}`);
	// 其余柱不得出现数值标签。
	const otherLabels = barNodesOf(tree)
		.filter((n) => n !== peakBar)
		.flatMap((n) => nodesOf(n))
		.filter((n) => typeof n.props.className === "string" && n.props.className.includes("dsh-tokstats-barPeak"));
	assert.equal(otherLabels.length, 0, "非峰值柱不标数值");
});

test("TS-17 / AC-5：KPI 四卡副值两两不等，且每张是对主值的拆分（不复述他卡）", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary() }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const hints = nodesOf(tree)
		.filter((n) => typeof n.props.className === "string" && n.props.className === "dsh-tokstats-kpiHint")
		.map((n) => textOf(n));
	assert.equal(hints.length, 4, "四张卡各有副值");
	assert.equal(new Set(hints).size, 4, `四卡副值两两不等，实际 ${JSON.stringify(hints)}`);

	// 「缓存命中率」副值给的是这个百分比的分子 / 分母（命中 tokens / 计费输入），
	// 而不是复述「缓存读」这个已经在「输入」卡拆分里出现过的数字。
	// 夹具：cr = 3000 / billed = 204000 → 1%。
	assert.match(hints[3], /^命中 3\.0K \/ 204K$/, `命中率副值应为分子/分母，实际 ${hints[3]}`);
	// 「输出」副值 = 输出占输入的比例（250 / 204000 ≈ 0.12%），与「缓存写」无关。
	assert.match(hints[2], /^占输入 0\.12%$/, `输出副值应为占输入比例，实际 ${hints[2]}`);
	// 两个旧形态必须消失：它们正是「复述他卡数字」的两种写法。
	for (const hint of hints) {
		assert.ok(!/缓存写/.test(hint), `副值不得出现「缓存写」（与输出无关），实际 ${hint}`);
	}
	assert.ok(!/^缓存读 /.test(hints[3]), `命中率副值不得复述「缓存读」，实际 ${hints[3]}`);
});

test("TS-17：输出副值在计费输入为 0 时给破折号，不编一个 0%", async () => {
	// 分母为 0 时「占输入的比例」在数学上无定义。写 0% 会让读者以为「输出为 0」，
	// 而实际上整窗没有输入（或数据缺失）——两种情况的含义完全不同。
	const rpc = makeRpcStub();
	rpc.respond(() => ({
		ok: true,
		value: makeSummary({
			buckets: Array.from({ length: 6 }, () => ({ calls: 0, in: 0, cr: 0, cw: 0, out: 0 })),
			daily: [],
			weekly: [],
			workspaces: [],
			routes: [],
			totals: { calls: 3, in: 0, cr: 0, cw: 0, out: 250 },
		})
	}));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const hints = nodesOf(tree)
		.filter((n) => typeof n.props.className === "string" && n.props.className === "dsh-tokstats-kpiHint")
		.map((n) => textOf(n));
	assert.equal(hints[2], "\u2014", `输入为 0 时输出副值应为破折号，实际 ${hints[2]}`);
});

test("AC-6：2:1 行用 stretch 对齐（不再用 start 留出空洞）", () => {
	injectedStyleTags.length = 0;
	setupClient();
	const css = injectedStyleTags.find((tag) => tag.dataset.pluginCss === "dsh-tokstats/tokstats").textContent;
	const rule = css.match(/\.dsh-tokstats-rowGrid\{([^}]*)\}/);
	assert.ok(rule !== null, "2:1 行规则应存在");
	assert.match(rule[1], /align-items:stretch/, "同行卡片等高（AC-6）");
	assert.ok(!/align-items:start/.test(rule[1]), "不得退回 start（会留出空洞）");
});

test("AC-7：选中态用品牌色 + 反色文字（不是与容器底只差几级的 bg-layer-2）", () => {
	injectedStyleTags.length = 0;
	setupClient();
	const css = injectedStyleTags.find((tag) => tag.dataset.pluginCss === "dsh-tokstats/tokstats").textContent;
	const rule = css.match(/\.dsh-tokstats-switchOn\{([^}]*)\}/);
	assert.ok(rule !== null, "选中态规则应存在");
	assert.match(rule[1], /background:var\(--dsw-alias-brand-primary\)/, "选中态用品牌色底（AC-7）");
	assert.match(rule[1], /color:var\(--dsw-alias-label-primary-inverted\)/, "配反色文字保证可读");
	assert.ok(!/bg-layer-2/.test(rule[1]), "不得退回 bg-layer-2（实测只差 9 级灰度）");
	// hover 规则必须紧跟：`.switch:hover` 的特异性高于 `.switchOn` 这个单类，
	// 不补 `.switchOn:hover` 时鼠标停在选中项上会把品牌色底覆盖回灰。
	const hoverRule = css.match(/\.dsh-tokstats-switchOn:hover\{([^}]*)\}/);
	assert.ok(hoverRule !== null, "选中态 hover 规则应存在（否则悬停时选中态消失）");
	assert.match(hoverRule[1], /background:var\(--dsw-alias-brand-primary\)/);
});

test("TS-17 / TS-23：词典新增键 zh/en 成对、无 provider / model 两词", () => {
	const { dicts } = setupClient();
	assertDictPair(assert, NS, dicts);
	const zh = dicts[NS].zh;
	const en = dicts[NS].en;
	const added = ["kpi.outputHint", "kpi.hitHint", "tip.dailyScale"];
	for (const key of added) {
		assert.ok(Object.prototype.hasOwnProperty.call(zh, key), `zh 缺键 ${key}`);
		assert.ok(Object.prototype.hasOwnProperty.call(en, key), `en 缺键 ${key}`);
		assert.ok(!/\bprovider\b/i.test(zh[key]), `zh ${key} 不得出现 provider`);
		assert.ok(!/\bmodel\b/i.test(zh[key]), `zh ${key} 不得出现 model`);
		assert.ok(!/\bprovider\b/i.test(en[key]), `en ${key} 不得出现 provider`);
		assert.ok(!/\bmodel\b/i.test(en[key]), `en ${key} 不得出现 model`);
	}
	// 整句模板：占位符成对出现，不是把数字拼进固定句子。
	assert.ok(zh["kpi.outputHint"].includes("{pct}") && en["kpi.outputHint"].includes("{pct}"));
	assert.ok(zh["kpi.hitHint"].includes("{cached}") && zh["kpi.hitHint"].includes("{billed}"));
	assert.ok(en["kpi.hitHint"].includes("{cached}") && en["kpi.hitHint"].includes("{billed}"));
	// K/M 是记号，不进词典（AGENTS 硬规则 7）：模板里不得出现 K/M/千分位数字。
	for (const key of added) {
		assert.ok(!/\d/.test(zh[key]), `zh ${key} 不得含数字记号（K/M 与刻度值不进词典）`);
	}
});

// ── 第四批：热力图（TS-28；AC-6…AC-9 / AC-11 / AC-12）──────────────────────
//
// 这一组的失败模式是「图能看但读错」或「静默谎报」：
// - 网格方向搞反（12 个周一横排一行）时，图依然漂亮，只是「列 = 自然周」不成立；
// - 色阶写成线性时，低量日全挤进最浅档，五档退化成三档；
// - 折叠区被渲染成「无记录」是**谎报**——那天有量，只是被 E1 归并进区间了；
// - 未来日期渲染成零格会让读者以为「今天之后都没用量」。

/** 日键 → 面板上显示的 M/D 标签（与 client 的 tokstatsDayLabel 同口径）。 */
function tokstatsLabel(day) {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
	if (m === null) return day;
	return String(Number(m[2])) + "/" + String(Number(m[3]));
}

/** 一个日键相对**真实今天**的偏移（热力图窗口跟真实 today 走，写死日期会漂移）。 */
function dayOffset(offsetDays, fromMs = Date.now()) {
	const d = new Date(fromMs);
	d.setHours(12, 0, 0, 0);
	d.setDate(d.getDate() + offsetDays);
	const pad = (v) => String(v).padStart(2, "0");
	return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

/** 热力图网格容器节点（`role="grid"`）。 */
function heatGridOf(tree) {
	return nodesOf(tree).find((n) => typeof n.props.className === "string"
		&& /(?:^|\s)dsh-tokstats-heat(?:\s|$)/.test(n.props.className));
}

/** 网格里的格子节点（不含未来日期的空占位）。 */
function heatCellsOf(tree) {
	const grid = heatGridOf(tree);
	if (grid === undefined) return [];
	return (grid.children ?? []).filter((n) => n !== null && typeof n === "object"
		&& typeof n.props?.className === "string" && n.props.className.includes("dsh-tokstats-heatCell"));
}

/** 只取「真实日期格」（排除 heatCellEmpty 占位）。 */
function heatRealCellsOf(tree) {
	return heatCellsOf(tree).filter((n) => !n.props.className.includes("dsh-tokstats-heatCellEmpty"));
}

/** 造一份 84 天 heatDaily：`entries` 是 `{ offset, calls }`（offset 相对今天）。 */
function makeHeatDaily(entries) {
	return entries.map(({ offset, calls }) => ({
		day: dayOffset(offset), calls, in: 1000, cr: 0, cw: 0, out: 10,
	}));
}

test("AC-6：热力图渲染 12 列 × 7 行，周一在最上（第一行第一格是周一）", async () => {
	const rpc = makeRpcStub();
	// 造满 84 天、每天 1 次：这样没有任何未来空格干扰行列计数。
	const heatDaily = [];
	for (let i = 83; i >= 0; i -= 1) heatDaily.push({ day: dayOffset(-i), calls: 1, in: 10, cr: 0, cw: 0, out: 1 });
	rpc.respond(() => ({ ok: true, value: makeSummary({ heatDaily, generatedAt: Date.now() }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const grid = heatGridOf(tree);
	assert.ok(grid, "热力图网格容器应存在（role=grid）");
	assert.equal(grid.props.role, "grid", "整图 role=grid（TS-28 可访问性）");
	const cells = heatRealCellsOf(tree);
	// 84 格 = 12 列 × 7 行。**格子数必须恰为 84**：多一格说明窗口没锁死 84 天，
	// 少一格说明末列被错误裁掉（今天所在的周还没过完，但过去的格子都在）。
	assert.equal(cells.length, 84, `应恰有 84 个日期格，实际 ${cells.length}`);
	// 第一格必须是**周一**：DOM 顺序按「一周七天连排」，配合 grid-auto-flow:column
	// 才是「列 = 自然周」。若第一格是别的星期几，说明列的起点没按自然周对齐。
	const firstDay = cells[0].props.title;
	assert.ok(firstDay !== undefined, "第一格应有 tooltip（含日期）");
	// 从日期反推星期几：用 Date 的 UTC 解析（与 client 的日键算术同口径）。
	const firstDateKey = /^(\d+)\/(\d+)：/.exec(String(firstDay));
	assert.ok(firstDateKey !== null, `第一格 tooltip 应形如「M/D：…」，实际 ${firstDay}`);
	// 更强也更稳的判据：DOM 里第 i 格与第 i+7 格相差 7 天（同列上下相邻 = 同一周内）。
	// 这条同时钉住「列 = 自然周」与「行 = 周内第几天」两件事。
	const days = cells.map((n) => String(n.props.title).replace(/：.*$/, ""));
	const parsed = days.map((label) => {
		const m = /^(\d+)\/(\d+)$/.exec(label);
		return m === null ? null : { month: Number(m[1]), day: Number(m[2]) };
	});
	assert.ok(parsed.every((p) => p !== null), "每格 tooltip 都应带 M/D 日期");
	// 第 0 格与第 1 格必须是**相邻两天**（同一周内往下走）。
	const stepOne = (a, b) => {
		if (a === null || b === null) return false;
		// 跨月时只比较「日」的连续性会误判，故用 Date 构造（年份取当前年）。
		const y = new Date().getFullYear();
		const msA = Date.UTC(y, a.month - 1, a.day);
		const msB = Date.UTC(y, b.month - 1, b.day);
		return Math.round((msB - msA) / 86400000) === 1;
	};
	assert.ok(stepOne(parsed[0], parsed[1]), `第 0/1 格应相邻一天（行内往下走），实际 ${days[0]} → ${days[1]}`);
	// 第 6 格（第一列最后一行 = 周日）与第 7 格（第二列第一行 = 下一周周一）也相邻一天。
	assert.ok(stepOne(parsed[6], parsed[7]), `第 6/7 格应相邻一天（跨列到下一周），实际 ${days[6]} → ${days[7]}`);
	// 第一格是周一：用 Date 算 getUTCDay，0 = 周日、1 = 周一。
	const firstParsed = parsed[0];
	const firstMs = Date.UTC(new Date().getFullYear(), firstParsed.month - 1, firstParsed.day);
	assert.equal(new Date(firstMs).getUTCDay(), 1, `第一格必须是周一，实际 ${days[0]}（UTC day=${new Date(firstMs).getUTCDay()}）`);
});

test("AC-6：末列未过完的周渲染成空占位，不是零格", async () => {
	const rpc = makeRpcStub();
	// 只造到今天：今天之后的天必须留空（渲染成零格会被读成「那天没用量」）。
	const heatDaily = [];
	for (let i = 83; i >= 0; i -= 1) heatDaily.push({ day: dayOffset(-i), calls: 1, in: 10, cr: 0, cw: 0, out: 1 });
	rpc.respond(() => ({ ok: true, value: makeSummary({ heatDaily, generatedAt: Date.now() }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const all = heatCellsOf(tree);
	const placeholders = all.filter((n) => n.props.className.includes("dsh-tokstats-heatCellEmpty"));
	// 今天可能是周日（末列刚好满）——那时占位为 0 也是正确行为。
	// 判据是「占位数 = 6 − 今天在周内的位置」，不能写死一个数字。
	const todayDow = (new Date().getDay() + 6) % 7; // 0 = 周一
	assert.equal(placeholders.length, 6 - todayDow,
		`末列应留 ${6 - todayDow} 个空占位（今天周内位置 ${todayDow}），实际 ${placeholders.length}`);
	// 占位必须是不可交互的（不是可点的零日格）。
	for (const node of placeholders) {
		assert.equal(node.props["aria-hidden"], "true", "未来日期占位应对辅助技术隐藏");
		assert.equal(node.props.disabled, undefined, "占位不是按钮，不该有 disabled 属性");
	}
	// 占位总数 + 真实格 = 84（网格尺寸恒定）。
	assert.equal(all.length, 84, "占位与真实格合计恒为 84");
});

test("AC-7：色阶按 sqrt(calls/peak) 分五档（按值断言，不按「包含某档」）", async () => {
	// SPEC AC-7 的原始判据：peak=2430 时 calls=34 落最低档（sqrt(34/2430)≈0.118
	// → 20% 档）；calls=2430 落 100% 档。
	// **必须按值断言**：写成「至少有一个 level=1」在色阶算错时仍会绿。
	const rpc = makeRpcStub();
	const heatDaily = makeHeatDaily([
		{ offset: -1, calls: 2430 },  // 峰值 → 5
		{ offset: -2, calls: 34 },    // sqrt(34/2430)=0.118 → 1
		{ offset: -3, calls: 132 },   // sqrt(132/2430)=0.233 → 2
		{ offset: -4, calls: 1082 },  // sqrt(1082/2430)=0.667 → 4
		{ offset: -5, calls: 228 },   // sqrt(228/2430)=0.306 → 2
	]);
	rpc.respond(() => ({ ok: true, value: makeSummary({ heatDaily, generatedAt: Date.now() }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const cells = heatRealCellsOf(tree);
	const levelOf = (offset) => {
		const day = dayOffset(offset);
		const label = tokstatsLabel(day);
		const cell = cells.find((n) => String(n.props.title).startsWith(label + "："));
		return cell?.props["data-level"];
	};
	// 逐值断言（含边界档位）：这四档把 0.2/0.4/0.6/0.8 四条边界中的三条覆盖了。
	assert.equal(levelOf(-1), "5", "峰值落 100% 档");
	assert.equal(levelOf(-2), "1", "sqrt(34/2430)≈0.118 落 20% 档（最低档）");
	assert.equal(levelOf(-3), "2", "sqrt(132/2430)≈0.233 落 40% 档");
	assert.equal(levelOf(-5), "2", "sqrt(228/2430)≈0.306 落 40% 档");
	assert.equal(levelOf(-4), "4", "sqrt(1082/2430)≈0.667 落 80% 档");
});

test("AC-8：零日不渲染填充（无 data-level），tooltip 写「无记录」", async () => {
	const rpc = makeRpcStub();
	// 只有两天有量，其余 82 天零调用（本机真实形态：84 天里 73 天为零）。
	const heatDaily = makeHeatDaily([{ offset: -1, calls: 5 }, { offset: -2, calls: 3 }]);
	rpc.respond(() => ({ ok: true, value: makeSummary({ heatDaily, generatedAt: Date.now() }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const cells = heatRealCellsOf(tree);
	const zeroCells = cells.filter((n) => String(n.props.title).includes("无记录"));
	assert.ok(zeroCells.length > 70, `零日应有 70+ 个，实际 ${zeroCells.length}`);
	for (const cell of zeroCells) {
		// 零日**不设 data-level**（CSS 落到默认背景色）：画最浅实心格会让
		// 「没用量」与「用量很少」视觉上几乎无差（SPEC D9）。
		assert.equal(cell.props["data-level"], undefined, `零日不得设 data-level，实际 ${cell.props.title}`);
		// 零日不可点（点进去只有全零面板，是噪音，SPEC D10）。
		assert.equal(cell.props.disabled, true, "零日不可点");
	}
	// 有量的格子必须有 data-level（1–5），否则它会被当成零日。
	const liveCells = cells.filter((n) => !String(n.props.title).includes("无记录"));
	assert.equal(liveCells.length, 2, `应有 2 个有量格，实际 ${liveCells.length}`);
	for (const cell of liveCells) {
		assert.match(String(cell.props["data-level"]), /^[1-5]$/, "有量格必须有 1–5 档");
		assert.equal(cell.props.disabled, false, "有量且未折叠的格子可点（SPEC D10）");
	}
});

test("AC-9：折叠区格子渲染为「不可按日拆」，且**不含「无记录」文案**（防谎报）", async () => {
	// 这条是本变更最重要的反向断言（TASKS hm2-3c）：折叠区的天在 heatDaily 里
	// **不出现**（裁决 D），若 client 只按「数组里没有」判成零，就会把那些天渲染成
	// 「无记录」——而那天其实有量，只是被 E1 归并进区间了。那是谎报。
	const rpc = makeRpcStub();
	const heatDaily = makeHeatDaily([{ offset: -60, calls: 5 }, { offset: -61, calls: 3 }]);
	// epoch 覆盖 [-40, -20)：这 20 天在 heatDaily 里没有逐日明细。
	const epoch = { start: dayOffset(-40), end: dayOffset(-20), calls: 999 };
	rpc.respond(() => ({ ok: true, value: makeSummary({ heatDaily, epoch, generatedAt: Date.now() }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const cells = heatRealCellsOf(tree);
	const folded = cells.filter((n) => n.props.className.includes("dsh-tokstats-heatFolded"));
	assert.equal(folded.length, 20, `[start, end) 半开区间应恰好 20 格，实际 ${folded.length}`);
	for (const cell of folded) {
		// ① 专用类名（**不复用** .dsh-tokstats-barEpoch：两者是不同图形元素）。
		assert.ok(!cell.props.className.includes("dsh-tokstats-barEpoch"), "热力图折叠格不得复用柱图的类名");
		// ② tooltip 写明「已折叠」与区间端点。
		assert.match(String(cell.props.title), /已折叠/, "折叠格 tooltip 应写明已折叠");
		assert.match(String(cell.props.title), /不可按日拆分/, "折叠格 tooltip 应说明不可按日拆");
		// ③ **不得出现「无记录」**——这是谎报的直接形态。
		assert.ok(!String(cell.props.title).includes("无记录"), `折叠格不得写成「无记录」，实际 ${cell.props.title}`);
		assert.ok(!String(cell.props["aria-label"]).includes("无记录"), "aria 也不得写「无记录」");
		// ④ 折叠格不可点（点进去会显示偏低的数，SPEC D10）。
		assert.equal(cell.props.disabled, true, "折叠格不可点");
		// ⑤ 折叠格不参与色阶（它的 calls 是派生值，上色会被读成「那天真用了这么多」）。
		assert.equal(cell.props["data-level"], undefined, "折叠格不得设 data-level");
		assert.equal(cell.props["data-folded"], "1", "折叠格带 data-folded 标记");
	}
	// 反向：非折叠格的 tooltip 里不得出现「折叠」字样（否则标记会溢出到全图）。
	for (const cell of cells) {
		if (folded.includes(cell)) continue;
		assert.ok(!String(cell.props.title).includes("已折叠"), `非折叠格不得提折叠，实际 ${cell.props.title}`);
	}
});

test("AC-9：epoch 为 null 时不出现任何折叠格（反向断言）", async () => {
	const rpc = makeRpcStub();
	const heatDaily = makeHeatDaily([{ offset: -1, calls: 5 }, { offset: -2, calls: 3 }]);
	rpc.respond(() => ({ ok: true, value: makeSummary({ heatDaily, epoch: null, generatedAt: Date.now() }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const cells = heatRealCellsOf(tree);
	assert.equal(cells.filter((n) => n.props.className.includes("heatFolded")).length, 0, "无 epoch 时不得有折叠格");
	for (const cell of cells) {
		assert.ok(!String(cell.props.title).includes("已折叠"), "无 epoch 时 tooltip 不得提折叠");
	}
});

test("TS-28：旧 host 无 heatDaily 时热力图整块不渲染、不抛错（硬规则 6）", async () => {
	const rpc = makeRpcStub();
	// 旧 host 的返回值：没有 heatDaily 字段。
	const legacy = makeSummary();
	delete legacy.heatDaily;
	rpc.respond(() => ({ ok: true, value: legacy }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	assert.equal(heatGridOf(tree), undefined, "无 heatDaily 时不得渲染热力图（不得用 daily 顶上）");
	// 面板其余部分照常（不能因为热力图缺席就整块空态）。
	assert.ok(nodesOf(tree).some((n) => typeof n.props.className === "string"
		&& n.props.className === "dsh-tokstats-kpiHint"), "其余卡片应照常渲染");
	// 也不得因此落进「暂无数据」。
	assert.ok(!textOf(tree).includes("暂无数据"), "有 daily/weekly 时不该显示暂无数据");
});

test("TS-28：heatDaily 为空数组时同样不渲染热力图卡", async () => {
	const rpc = makeRpcStub();
	rpc.respond(() => ({ ok: true, value: makeSummary({ heatDaily: [], generatedAt: Date.now() }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	assert.equal(heatGridOf(tree), undefined, "空 heatDaily 不渲染热力图");
});

test("AC-11：键盘导航——←/→ 跨日、↑/↓ 跨周、Enter/Space 选中、Esc 退出", async () => {
	// SPEC 裁决 B 的键位。断言走 aria-selected / data-cursor 的**变化**，
	// 不试图断言真实 DOM 焦点（浅渲染没有 DOM）。
	const rpc = makeRpcStub();
	const heatDaily = [];
	for (let i = 83; i >= 0; i -= 1) heatDaily.push({ day: dayOffset(-i), calls: 1, in: 10, cr: 0, cw: 0, out: 1 });
	rpc.respond(() => ({ ok: true, value: makeSummary({ heatDaily, generatedAt: Date.now() }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const grid = heatGridOf(tree);
	assert.ok(grid, "热力图应存在");
	assert.equal(typeof grid.props.onKeyDown, "function", "网格应挂 onKeyDown（键盘可达）");
	// 先给一格焦点（组件用 onFocus 记 cursorDay）。
	const cells = heatRealCellsOf(tree);
	const startCell = cells[20];
	assert.equal(typeof startCell.props.onFocus, "function", "格子应有 onFocus（记键盘光标）");
	startCell.props.onFocus();
	/** 重新渲染并取光标格（返回 { cell, index }，index 是它在网格 DOM 里的位置）。 */
	const cursorAfter = (props) => {
		react.reset();
		const t2 = props();
		const all = heatCellsOf(t2);
		const idx = all.findIndex((n) => n.props["data-cursor"] === "1");
		return { tree: t2, grid: heatGridOf(t2), cell: idx < 0 ? undefined : all[idx], index: idx, all };
	};
	// 基准：焦点格的索引。
	const base = cursorAfter(() => main.comp({ t }));
	assert.ok(base.cell, "焦点后应有光标格");
	const baseIndex = base.index;
	// ArrowRight：光标前进**一格**（跨日）。
	base.grid.props.onKeyDown({ key: "ArrowRight", preventDefault: () => {} });
	const right = cursorAfter(() => main.comp({ t }));
	assert.equal(right.index, baseIndex + 1, "ArrowRight 应前进一格（跨日）");
	// ArrowDown：光标前进**七格**（跨周，SPEC 裁决 B 的 ↑/↓ 跨周）。
	right.grid.props.onKeyDown({ key: "ArrowDown", preventDefault: () => {} });
	const down = cursorAfter(() => main.comp({ t }));
	assert.equal(down.index, right.index + 7, "ArrowDown 应前进七格（跨周）");
	// ArrowUp：退回七格。
	down.grid.props.onKeyDown({ key: "ArrowUp", preventDefault: () => {} });
	const up = cursorAfter(() => main.comp({ t }));
	assert.equal(up.index, down.index - 7, "ArrowUp 应后退七格（跨周）");
	// ArrowLeft：退一格。
	up.grid.props.onKeyDown({ key: "ArrowLeft", preventDefault: () => {} });
	const left = cursorAfter(() => main.comp({ t }));
	assert.equal(left.index, up.index - 1, "ArrowLeft 应后退一格（跨日）");
	// 方向键必须 preventDefault（否则页面会跟着滚动）。
	let prevented = 0;
	left.grid.props.onKeyDown({ key: "ArrowRight", preventDefault: () => { prevented += 1; } });
	assert.equal(prevented, 1, "方向键应 preventDefault（避免页面滚动）");
	// Enter 选中 → 进单日模式：四档置灰 + 面包屑出现。
	const cur = cursorAfter(() => main.comp({ t }));
	cur.grid.props.onKeyDown({ key: "Enter", preventDefault: () => {} });
	react.reset();
	react.runEffects();
	for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
	react.reset();
	const single = renderDeep(react, main.comp({ t }));
	const switches = nodesOf(single).filter((n) => typeof n.props.className === "string"
		&& /(?:^|\s)dsh-tokstats-switch(?:\s|$)/.test(n.props.className));
	assert.ok(switches.length > 0, "应有四档按钮");
	assert.ok(switches.every((n) => n.props.disabled === true), "单日模式下四档全部置灰");
	// Esc 退出：四档恢复可用。
	const grid4 = heatGridOf(single);
	grid4.props.onKeyDown({ key: "Escape", preventDefault: () => {} });
	react.reset();
	react.runEffects();
	for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
	react.reset();
	const back = renderDeep(react, main.comp({ t }));
	const switchesBack = nodesOf(back).filter((n) => typeof n.props.className === "string"
		&& /(?:^|\s)dsh-tokstats-switch(?:\s|$)/.test(n.props.className));
	assert.ok(switchesBack.every((n) => n.props.disabled !== true), "Esc 退出后四档恢复可用");
});

test("AC-12：热力图词典键 zh/en 成对、整句模板、无残留占位符", () => {
	const { dicts } = setupClient();
	assertDictPair(assert, NS, dicts);
	const zh = dicts[NS].zh;
	const en = dicts[NS].en;
	const added = [
		"section.heat", "heat.less", "heat.more",
		"heat.cellAria.one", "heat.cellAria.other",
		"heat.cellTip.one", "heat.cellTip.other",
		"heat.empty", "heat.folded", "heat.foldedAria", "heat.keyHint",
		"crumb.exit", "crumb.aria", "kpi.callsHintShare", "single.folded",
	];
	for (const key of added) {
		assert.ok(Object.prototype.hasOwnProperty.call(zh, key), `zh 缺键 ${key}`);
		assert.ok(Object.prototype.hasOwnProperty.call(en, key), `en 缺键 ${key}`);
		assert.ok(!/\bprovider\b/i.test(zh[key]), `zh ${key} 不得出现 provider`);
		assert.ok(!/\bmodel\b/i.test(zh[key]), `zh ${key} 不得出现 model`);
	}
	// 整句模板：占位符必须是**渲染时真的会注入**的那些名字。
	// `tCount` 只注入 `{count}`，模板里写别的名字会原样显示花括号（本仓库踩过）。
	assert.ok(zh["heat.cellTip.other"].includes("{count}"), "计数句必须带 {count}");
	assert.ok(zh["heat.cellTip.other"].includes("{input}") && zh["heat.cellTip.other"].includes("{output}"));
	assert.ok(zh["heat.folded"].includes("{start}") && zh["heat.folded"].includes("{end}"), "折叠句带区间端点");
	assert.ok(zh["kpi.callsHintShare"].includes("{pct}"), "份额副值是整句模板");
	assert.ok(en["kpi.callsHintShare"].includes("{pct}"));
	// 三种态的文案必须**互斥**（AC-8 / AC-9 的语义基础）。
	assert.ok(!zh["heat.empty"].includes("折叠"), "「无记录」文案不得提折叠");
	assert.ok(!zh["heat.folded"].includes("无记录"), "「已折叠」文案不得提无记录");
});

test("样式：热力图折叠格用斜纹 + 主题变量，且不复用柱图折叠类名（TS-28）", () => {
	injectedStyleTags.length = 0;
	setupClient();
	const tag = injectedStyleTags.find((t) => t.dataset.pluginCss === "dsh-tokstats/tokstats");
	assert.ok(tag, "tokstats 样式 tag 应已注入");
	// 折叠样式规则存在，且用斜纹 + 主题变量（不写死颜色）。
	assert.match(tag.textContent, /\.dsh-tokstats-heatFolded/, "热力图折叠格样式应存在");
	const rule = tag.textContent.match(/\.dsh-tokstats-heatFolded\{([^}]*)\}/);
	assert.ok(rule !== null, "应能取出热力图折叠格规则");
	assert.match(rule[1], /repeating-linear-gradient/, "折叠态沿用 TS-22 的斜纹语义");
	assert.match(rule[1], /var\(--dsw-alias-/, "颜色必须走主题变量");
	assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(rule[1]), "不得写死十六进制颜色");
	// **类名必须与柱图的折叠类名分开**：共用会让「改柱图的折叠样式」意外改到热力图。
	assert.ok(!/\.dsh-tokstats-heatFolded[^{]*\{[^}]*\.dsh-tokstats-barEpoch/.test(tag.textContent),
		"热力图折叠样式不得引用柱图折叠类名");
	// 五档色阶必须全是品牌色 + 透明度，不得出现五个不同主题色（SPEC D8）。
	const levels = [1, 2, 3, 4, 5].map((lv) => {
		const marker = '.dsh-tokstats-heatCell[data-level="' + lv + '"]{';
		const at = tag.textContent.indexOf(marker);
		if (at < 0) return null;
		const from = at + marker.length;
		const to = tag.textContent.indexOf("}", from);
		return to < 0 ? null : tag.textContent.slice(from, to);
	});
	assert.ok(levels.every((v) => v !== null), "五档色阶规则都应存在");
	for (const body of levels) {
		assert.match(body, /background:var\(--dsw-alias-brand-primary\)/, "五档都必须用同一个品牌色");
		assert.match(body, /opacity:/, "档位靠透明度区分");
		assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(body), "不得写死十六进制颜色");
	}
	// 网格必须按列填（grid-auto-flow:column）+ 固定 7 行：否则 12 个格子会横排
	// 成一行，列不再是自然周。
	const gridRule = tag.textContent.match(/\.dsh-tokstats-heat\{([^}]*)\}/);
	assert.ok(gridRule !== null, "网格规则应存在");
	assert.match(gridRule[1], /grid-auto-flow:column/, "必须按列填充（DOM 顺序是一周七天连排）");
	assert.match(gridRule[1], /grid-template-rows:repeat\(7,/, "固定 7 行（周一在最上）");
	assert.match(gridRule[1], /grid-template-columns:repeat\(12,/, "12 列 = 12 周");
	// **格子必须有尺寸上限**：纯 `1fr` 在整行卡片里会把每格拉到 ~95px，热力图
	// 变成七行巨大色块并把下面所有卡片挤出首屏（实测全宽 1600×1000 只剩热力图）。
	// `minmax(0,Npx)` 是双向钳：宽屏封顶、窄屏按可用宽度收缩。
	assert.match(gridRule[1], /minmax\(0,\d+px\)/, "格子必须有尺寸上限（minmax 双向钳）");
	assert.ok(!/repeat\(12,1fr\)/.test(gridRule[1]), "不得退回纯 1fr（会把格子拉成巨大色块）");
	// 封顶后的余量要两侧均分，否则图会挤在左侧。
	assert.match(gridRule[1], /justify-content:center/, "封顶后图应居中（余量两侧均分）");
});

// ── 第五批：单日模式（TS-29；AC-10）────────────────────────────────────────
//
// 单日模式改的是**既有卡片的渲染条件**，而不只是新增一块（PLAN §1）。这一组的
// 失败模式是「数字看起来对、但其实在复述」：
// - 副值沿用「日均」时，`days = 1` 让副值等于主值，四卡只剩三份信息（TS-17）；
// - 周趋势卡在单日下只剩一行，而那一行的周合计与 totals 完全相同（裁决 A）；
// - 点进折叠日时 totals 是 0，照常渲染会让读者看到「这一天一次都没用过」——谎报。

/**
 * 单日模式的测试装配：一份 84 天 heatDaily + 一个指定的「目标日」。
 *
 * RPC 桩按请求里有没有 `day` 分别回两种形状：区间模式（多天）与单日模式
 * （一天），这样「面板整体重算成那一天的数」这件事是被真实驱动的。
 */
function makeSingleDayFixture({ targetOffset = -3, targetCalls = 2430, otherCalls = 100 } = {}) {
	const target = dayOffset(targetOffset);
	const heatDaily = [];
	for (let i = 83; i >= 0; i -= 1) {
		heatDaily.push({
			day: dayOffset(-i),
			calls: i === -targetOffset ? targetCalls : otherCalls,
			in: 1000, cr: 0, cw: 0, out: 10,
		});
	}
	const heatTotal = heatDaily.reduce((sum, row) => sum + row.calls, 0);
	const rpc = makeRpcStub();
	rpc.respond((call) => {
		const single = typeof call.payload?.day === "string";
		const day = single ? call.payload.day : target;
		return {
			ok: true,
			value: makeSummary({
				buckets: Array.from({ length: 6 }, (_, i) => (i === 2
					? { calls: 5, in: 500, cr: 0, cw: 0, out: 0 }
					: { calls: 0, in: 0, cr: 0, cw: 0, out: 0 })),
				daily: single
					? [{ day, calls: targetCalls, in: 1000, cr: 0, cw: 0, out: 10 }]
					: [{ day: target, calls: targetCalls, in: 1000, cr: 0, cw: 0, out: 10 },
						{ day: dayOffset(-2), calls: otherCalls, in: 1000, cr: 0, cw: 0, out: 10 }],
				weekly: [{ weekStart: dayOffset(-6), calls: targetCalls + otherCalls, in: 2000, cr: 0, cw: 0, out: 20 }],
				workspaces: [{ path: "D:\\proj\\alpha", calls: targetCalls, in: 1000, out: 10, cr: 0, cw: 0 }],
				routes: [{ rt: "x/y", calls: targetCalls, in: 1000, cr: 0, cw: 0, out: 10 }],
				totals: { calls: targetCalls, in: 1000, cr: 0, cw: 0, out: 10 },
				windowStart: single ? day : dayOffset(-6),
				generatedAt: Date.now(),
				windowDays: single ? 1 : 7,
				coverage: { sessions: 1, skipped: 0 },
				epoch: null,
				heatDaily,
				...(single ? { day, dayFolded: false } : {}),
			}),
		};
	});
	return { rpc, target, targetCalls, heatTotal };
}

/** 在渲染树上找目标日那一格并点它（进单日模式）。 */
function clickDayCell(tree, day) {
	const label = tokstatsLabel(day);
	const cell = heatRealCellsOf(tree).find((n) => String(n.props.title).startsWith(label + "："));
	assert.ok(cell, `应找到 ${day} 那一格（${label}）`);
	cell.props.onClick();
}

/** 渲染 → 点格 → 再渲染，返回单日模式的树。 */
async function enterSingleDay(react, main, t, day) {
	const before = await renderPanelClean(react, main, { t });
	clickDayCell(before, day);
	return renderPanelClean(react, main, { t });
}

/**
 * `renderPanel` 的干净版：渲染前后都对齐 hook 序号与 effect 列表。
 *
 * 为什么需要（两个桩语义问题，不是实现的问题）：
 * 1. **hook 序号**：`renderPanel` 末尾的 `renderDeep(main.comp(props))` 会继续推进
 *    `_idx` 而不重置，下一次 `renderPanel` 开头的 `main.comp` 就从那个陈旧序号起算，
 *    `useState` / `useRef` 的槽位整体错位（`singleDay` 会读到别的槽的值）。
 * 2. **effect 累积**：浅渲染的 `_effects` 是累积的，上一次深渲染留下的 effect 会在
 *    下一次 `runEffects` 里先跑——那时闭包捕获的还是**旧**的 `singleDay`，于是
 *    请求里看不到 `day`，测的变成「点之前发了什么」。
 *
 * 真实 React 每次渲染都会重跑 effect 并按依赖清理，桩没有这层语义，故显式对齐。
 */
async function renderPanelClean(react, main, props) {
	react.reset();
	react._effects.length = 0;
	const tree = await renderPanel(react, main, props);
	react._effects.length = 0;
	return tree;
}

test("AC-10：单日模式下四档按钮全部置灰（置灰不隐藏）", async () => {
	const fixture = makeSingleDayFixture();
	const { react, main, t } = setupClient({ rpc: fixture.rpc });
	const tree = await enterSingleDay(react, main, t, fixture.target);
	const switches = nodesOf(tree).filter((n) => typeof n.props.className === "string"
		&& /(?:^|\s)dsh-tokstats-switch(?:\s|$)/.test(n.props.className));
	assert.equal(switches.length, 4, "四档按钮应仍在（置灰不隐藏，避免工具条高度变化）");
	assert.ok(switches.every((n) => n.props.disabled === true), "单日模式下四档全部置灰");
	// 区间模式下它们必须是可用的（否则这条断言在「永远 disabled」的实现下也会绿）。
	const fresh = setupClient({ rpc: makeSingleDayFixture().rpc });
	const rangeOnly = await renderPanelClean(fresh.react, fresh.main, { t: fresh.t });
	const rangeSwitches = nodesOf(rangeOnly).filter((n) => typeof n.props.className === "string"
		&& /(?:^|\s)dsh-tokstats-switch(?:\s|$)/.test(n.props.className));
	assert.ok(rangeSwitches.every((n) => n.props.disabled !== true), "区间模式下四档必须可用");
});
test("AC-10：单日下日柱图隐藏、周趋势卡隐藏（裁决 A）", async () => {
	const fixture = makeSingleDayFixture();
	const { react, main, t } = setupClient({ rpc: fixture.rpc });
	const rangeTree = await renderPanel(react, main, { t });
	// 对照：区间模式下两张卡都在（否则下面的「隐藏」可能是它们从来没渲染过）。
	assert.ok(nodesOf(rangeTree).some((n) => String(n.props.className ?? "").includes("dsh-tokstats-chartPlot")),
		"区间模式应有日柱绘图区");
	assert.ok(nodesOf(rangeTree).some((n) => String(n.props.className ?? "").includes("dsh-tokstats-table")),
		"区间模式应有周趋势表");
	clickDayCell(rangeTree, fixture.target);
	const single = await renderPanel(react, main, { t });
	assert.ok(!nodesOf(single).some((n) => String(n.props.className ?? "").includes("dsh-tokstats-chartPlot")),
		"单日下日柱图必须隐藏（只剩一根孤柱，热力图已覆盖该职责）");
	assert.ok(!nodesOf(single).some((n) => String(n.props.className ?? "").includes("dsh-tokstats-table")),
		"单日下周趋势卡必须隐藏（那一行周合计与 totals 完全相同，是复述主值）");
	// 桶分布 / 模型排行 / 工作区排行仍要在（正常重算成那一天）。
	assert.ok(nodesOf(single).some((n) => String(n.props.className ?? "").includes("dsh-tokstats-meter")),
		"桶分布与排行卡应照常渲染");
});

test("AC-10：单日下 KPI 副值改「占 84 天份额」，四卡副值两两不等（不复述主值）", async () => {
	const fixture = makeSingleDayFixture();
	const { react, main, t } = setupClient({ rpc: fixture.rpc });
	const tree = await enterSingleDay(react, main, t, fixture.target);
	const hints = nodesOf(tree)
		.filter((n) => typeof n.props.className === "string" && n.props.className === "dsh-tokstats-kpiHint")
		.map((n) => textOf(n));
	assert.equal(hints.length, 4, "四张卡各有副值");
	// TS-17 的核心判据：四卡副值两两不等。`days = 1` 时「日均」等于主值本身，
	// 那会让「调用次数」卡的副值与主值重复——本变更改的就是这一点。
	assert.equal(new Set(hints).size, 4, `四卡副值必须两两不等，实际 ${JSON.stringify(hints)}`);
	// 「调用次数」副值必须是份额，且**不是**「日均」。
	assert.match(hints[0], /^占 84 天 \d+%$/, `调用次数副值应为份额，实际 ${hints[0]}`);
	assert.ok(!/日均/.test(hints[0]), `单日下不得出现「日均」（复述主值），实际 ${hints[0]}`);
	// 份额的分母必须是 heatDaily 的合计（不是 totals）：
	// totals = 2430，heatTotal = 2430 + 83×100 = 10730 → 22.6% → 四舍五入到 23%。
	assert.equal(hints[0], "占 84 天 23%", `份额应为 2430/10730≈23%，实际 ${hints[0]}`);
	// 反例守卫：若误用 totals 当分母会恒得 100%，这里显式排除那个形态。
	assert.ok(!/100%/.test(hints[0]), "份额不得是 100%（那说明分母取了 totals）");
});

test("AC-10：单日模式请求带 day，且仍带 windowDays（host 按裁决 C 覆盖）", async () => {
	const fixture = makeSingleDayFixture();
	const { react, main, t } = setupClient({ rpc: fixture.rpc });
	await enterSingleDay(react, main, t, fixture.target);
	const summaries = fixture.rpc.calls.filter((call) => call.endpoint === "summary");
	const last = summaries[summaries.length - 1];
	assert.equal(last.payload.day, fixture.target, "单日模式的请求必须带 day");
	assert.equal(typeof last.payload.windowDays, "number", "仍要带 windowDays（client 不知道 host 的优先级规则）");
});
test("AC-10：面包屑出现，点「全部区间」退出单日模式", async () => {
	const fixture = makeSingleDayFixture();
	const { react, main, t } = setupClient({ rpc: fixture.rpc });
	const single = await enterSingleDay(react, main, t, fixture.target);
	const crumb = nodesOf(single).find((n) => String(n.props.className ?? "").includes("dsh-tokstats-crumb"));
	assert.ok(crumb, "单日模式应出现面包屑（退出入口）");
	// 面包屑可见文字是日期；整句说明走 aria-label（不占工具条宽度）。
	assert.ok(textOf(crumb).includes(tokstatsLabel(fixture.target)), "面包屑应显示选中日期");
	assert.ok(textOf(crumb).includes("全部区间"), "面包屑应带「全部区间」退出按钮");
	const exit = nodesOf(crumb).find((n) => String(n.props.className ?? "").includes("dsh-tokstats-crumbExit"));
	assert.ok(exit, "退出按钮应存在");
	exit.props.onClick();
	const back = await renderPanel(react, main, { t });
	assert.ok(!nodesOf(back).some((n) => String(n.props.className ?? "").includes("dsh-tokstats-crumb")),
		"退出后面包屑消失");
	const switches = nodesOf(back).filter((n) => typeof n.props.className === "string"
		&& /(?:^|\s)dsh-tokstats-switch(?:\s|$)/.test(n.props.className));
	assert.ok(switches.every((n) => n.props.disabled !== true), "退出后四档恢复可用");
});

test("AC-10：点已选中的格退出单日模式（第二个出口）", async () => {
	const fixture = makeSingleDayFixture();
	const { react, main, t } = setupClient({ rpc: fixture.rpc });
	const single = await enterSingleDay(react, main, t, fixture.target);
	// 再点同一格：应退出（PLAN §3.3.1 的出口之一）。
	clickDayCell(single, fixture.target);
	const back = await renderPanel(react, main, { t });
	assert.ok(!nodesOf(back).some((n) => String(n.props.className ?? "").includes("dsh-tokstats-crumb")),
		"再点同一格应退出单日模式");
});

test("TS-29：点进折叠日**不显示任何数字**，只显示折叠说明（防谎报）", async () => {
	// 这是单日模式最危险的形态：折叠日的明细在读取期被 E1 排除，host 返回的
	// totals 是 0。若照常渲染 KPI 四卡与排行，读者看到「这一天一次都没用过」——
	// 而真相是「有量、但被归并进区间、按日拆不出来」。
	const rpc = makeRpcStub();
	const heatDaily = [];
	for (let i = 83; i >= 0; i -= 1) heatDaily.push({ day: dayOffset(-i), calls: 10, in: 100, cr: 0, cw: 0, out: 1 });
	const foldedDay = dayOffset(-30);
	rpc.respond(() => ({
		ok: true,
		value: makeSummary({
			buckets: Array.from({ length: 6 }, () => ({ calls: 0, in: 0, cr: 0, cw: 0, out: 0 })),
			daily: [], weekly: [], workspaces: [], routes: [],
			// 折叠日：totals 全零（明细被 E1 排除）。
			totals: { calls: 0, in: 0, cr: 0, cw: 0, out: 0 },
			windowStart: foldedDay, generatedAt: Date.now(), windowDays: 1,
			coverage: { sessions: 1, skipped: 0 },
			epoch: { start: dayOffset(-40), end: dayOffset(-20), calls: 999 },
			heatDaily,
			day: foldedDay, dayFolded: true,
		}),
	}));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	// ① 必须出现折叠说明。
	assert.ok(textOf(tree).includes("已折叠"), "折叠日应显示「已折叠」说明");
	// ② **不得出现任何 KPI 数字**（显示偏低数字是谎报）。
	const kpiValues = nodesOf(tree).filter((n) => typeof n.props.className === "string"
		&& n.props.className === "dsh-tokstats-kpiValue");
	assert.equal(kpiValues.length, 0, `折叠日不得渲染 KPI 数字，实际 ${kpiValues.length} 个`);
	// ③ 也不得落进「暂无数据」空态（那句「还没有 usage 记录」同样是谎报）。
	assert.ok(!textOf(tree).includes("暂无数据"), "折叠日不得显示「暂无数据」");
	// ④ 热力图本身仍要渲染（它承担说明折叠区的职责）。
	assert.ok(heatGridOf(tree), "折叠日仍要渲染热力图");
});

test("TS-29：折叠格不可点（渲染时即判定，不需要先请求）", async () => {
	const rpc = makeRpcStub();
	const heatDaily = [];
	for (let i = 83; i >= 0; i -= 1) heatDaily.push({ day: dayOffset(-i), calls: 10, in: 100, cr: 0, cw: 0, out: 1 });
	const foldedDay = dayOffset(-30);
	rpc.respond(() => ({
		ok: true,
		value: makeSummary({
			daily: [{ day: dayOffset(-1), calls: 10, in: 100, cr: 0, cw: 0, out: 1 }],
			weekly: [{ weekStart: dayOffset(-1), calls: 10, in: 100, cr: 0, cw: 0, out: 1 }],
			totals: { calls: 10, in: 100, cr: 0, cw: 0, out: 1 },
			windowStart: dayOffset(-6), generatedAt: Date.now(), windowDays: 7,
			epoch: { start: dayOffset(-40), end: dayOffset(-20), calls: 999 },
			heatDaily,
		}),
	}));
	const { react, main, t } = setupClient({ rpc });
	const rangeTree = await renderPanelClean(react, main, { t });
	const label = tokstatsLabel(foldedDay);
	const foldedCell = heatRealCellsOf(rangeTree).find((n) => String(n.props.title).startsWith(label + "："));
	assert.ok(foldedCell, "应找到折叠格");
	// 折叠格**渲染时就不可点**（用 epoch.start/end 判定，不需要先请求，PLAN §3.3.4）。
	assert.equal(foldedCell.props.disabled, true, "折叠格不可点（点进去会显示偏低的数）");
	// 而且它压根没有 onClick（不是「有 handler 但被 disabled 挡住」——那在键盘或
	// 程序化触发下仍可能进单日模式）。这是更强的判据。
	assert.equal(foldedCell.props.onClick, undefined, "折叠格不得挂 onClick");
	// 请求里不得出现 day（没进单日模式）。
	const summaries = rpc.calls.filter((call) => call.endpoint === "summary");
	assert.ok(summaries.every((call) => call.payload.day === undefined), "折叠格点击不得触发单日请求");
});

test("TS-29：折叠格不可点、零日不可点，两者 tooltip 各写明原因（AC-10 / SPEC D10）", async () => {
	const rpc = makeRpcStub();
	const heatDaily = makeHeatDaily([{ offset: -1, calls: 5 }]);
	const epoch = { start: dayOffset(-40), end: dayOffset(-20), calls: 99 };
	rpc.respond(() => ({ ok: true, value: makeSummary({ heatDaily, epoch, generatedAt: Date.now() }) }));
	const { react, main, t } = setupClient({ rpc });
	const tree = await renderPanel(react, main, { t });
	const cells = heatRealCellsOf(tree);
	// 零日：tooltip 写「无记录」。
	const zero = cells.find((n) => String(n.props.title).includes("无记录"));
	assert.ok(zero, "应有零日格");
	assert.equal(zero.props.disabled, true, "零日不可点");
	assert.match(String(zero.props.title), /无记录/, "零日 tooltip 写明「无记录」（不可选原因）");
	// 折叠格：tooltip 写「已折叠…不可按日拆分」。
	const folded = cells.find((n) => n.props.className.includes("heatFolded"));
	assert.ok(folded, "应有折叠格");
	assert.equal(folded.props.disabled, true, "折叠格不可点");
	assert.match(String(folded.props.title), /已折叠/, "折叠格 tooltip 写明「已折叠」（不可选原因）");
	assert.ok(!String(folded.props.title).includes("无记录"), "折叠格不得写「无记录」");
});

test("TS-29：单日模式页脚只显示那一天，不是「窗口下界 – 今天」", async () => {
	// 目检时发现的真实不一致：单日模式下 `windowStart` 等于所选日，而页脚右端仍取
	// 「今天」，于是写着「10/20 – 10/25」而面板里全是 10/20 的数——读者会以为
	// 面板算错了区间。区间两端在单日模式下是同一天，必须换文案。
	const fixture = makeSingleDayFixture();
	const { react, main, t } = setupClient({ rpc: fixture.rpc });
	const single = await enterSingleDay(react, main, t, fixture.target);
	const foot = nodesOf(single).find((n) => typeof n.props.className === "string"
		&& /(?:^|\s)dsh-tokstats-footRange(?:\s|$)/.test(n.props.className));
	assert.ok(foot, "页脚区间节点应存在");
	const text = textOf(foot);
	const label = tokstatsLabel(fixture.target);
	assert.ok(text.includes(label), `页脚应显示所选日 ${label}，实际 ${text}`);
	assert.ok(text.includes("单日"), `页脚应标明「单日」，实际 ${text}`);
	// 不得出现区间形态（– 连接两个不同日期）。
	assert.ok(!/–/.test(text), `单日页脚不得写成区间，实际 ${text}`);
});

test("TS-29：单日模式下工作区过滤器与 day 叠加（两个过滤器同时生效）", async () => {
	// SPEC D14：选了工作区，热力图也只画那个工作区的天；单日 + 工作区叠加。
	// 这里钉住「两个字段同时出现在请求里」——host 本来就同时支持。
	const fixture = makeSingleDayFixture();
	const { react, main, t } = setupClient({ rpc: fixture.rpc });
	const rangeTree = await renderPanelClean(react, main, { t });
	// 切到一个工作区。
	const select = nodesOf(rangeTree).find((n) => typeof n.props.className === "string"
		&& n.props.className === "dsh-tokstats-select");
	assert.ok(select, "工作区选择器应存在");
	select.props.onChange({ target: { value: "D:\\proj\\alpha" } });
	const withWs = await renderPanelClean(react, main, { t });
	clickDayCell(withWs, fixture.target);
	await renderPanelClean(react, main, { t });
	const summaries = fixture.rpc.calls.filter((call) => call.endpoint === "summary");
	const last = summaries[summaries.length - 1];
	assert.equal(last.payload.day, fixture.target, "单日模式仍带 day");
	assert.equal(last.payload.workspace, "D:\\proj\\alpha", "工作区过滤器仍生效（两个过滤器叠加）");
});