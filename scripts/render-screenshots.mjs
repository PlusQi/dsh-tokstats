// 生成 README / 市场页用的 tokstats 面板截图（维护脚本，不进包）。
//
// 为什么不用真宿主截图：
//   1. **数据隐私**：真宿主的截图里必然带着本机的模型名、工作区路径、会话标题；
//      这些不该进公开仓库。这里用固定的一套**示例数据**（模型名一律 `example/*`
//      或 `demo/*`，工作区一律 `D:\projects\*`），任何人跑出来的图都一样。
//   2. **可复现**：走 `test/client-harness.mjs` 捕获**真实的 client.js**，用真实的
//      组件树 + 真实 CSS 渲染，不手抄 DOM——手抄的 DOM 只能证明「我抄的那份能对齐」。
//   3. 顺带能核布局：日期刻度是否对齐柱位、两列自适应是否留空白，只有目检能发现。
//
// 用法（需要本机有 chromium；不带 --chrome 时按 Playwright 缓存目录找）：
//   node scripts/render-screenshots.mjs --lang zh
//   node scripts/render-screenshots.mjs --lang en
//   node scripts/render-screenshots.mjs --lang zh --range days7 --theme light --out /tmp/x.png
//
// 产物默认写 docs/assets/tokstats.png（zh）/ tokstats-en.png（en），README 直接引用。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	injectedStyleTags,
	makeRpcStub,
	renderDeep,
	setupClientBase,
} from "../test/client-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const NS = "dsh-tokstats.tokstats";

// ── 参数 ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
	const at = argv.indexOf("--" + name);
	return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback;
};
const has = (name) => argv.includes("--" + name);

const lang = argOf("lang", "zh"); // zh | en
const themeName = argOf("theme", "dark"); // dark | light
const range = argOf("range", "days30"); // today | days7 | month | days30 | all
const width = Number(argOf("width", 960));
const height = Number(argOf("height", 1160));
const dpr = Number(argOf("dpr", 1.6));
const out = resolve(root, argOf("out", lang === "en" ? "docs/assets/tokstats-en.png" : "docs/assets/tokstats.png"));
const chrome = argOf("chrome", process.env.CHROME_PATH ?? findChrome());

const RANGE_DAYS = { today: 1, days7: 7, month: -1, days30: 30, all: 0 };
const rangeDays = RANGE_DAYS[range] ?? 30;

// ── 示例数据（公开仓库里出现的就是这一份，与真机无关）────────────────────
const DAY = 86400000;
const dayOffset = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const CALLS_SEQ = [1800, 2430, 1560, 1240, 900, 640, 60];

/**
 * 示例调用量的**单日真源**：柱图、热力图、KPI 全部从它取。
 *
 * 必须是同一份。TS-28 写着「两张图对同一天给出同一视觉强度，可以互相印证」，
 * 而此前 `heatDaily` 与 `daily` 各用一套公式——最近 30 天里 30/30 天都对不上，
 * 于是 README 那张图里柱高与热力格深浅互相矛盾，当日档更是「柱是空的、KPI 却
 * 报 640 次」。示例数据也不该违反插件自己的不变量：读者看不出那是示例的错，
 * 只会以为插件算错了。
 *
 * 每 11 天断一天：热力图要能看出「活跃日成串、中间断档」，全是满格反而失真。
 * `offset` 是「距今天数」（0 = 今天），保证今天恒有量，当日档不会整屏空。
 */
const callsFor = (offset) => {
	if (offset % 11 === 3) return 0;
	return CALLS_SEQ[offset % 7] + (offset % 3) * 40;
};

/** 自然周起点（周一）：与 host 的 `tokstatsWeekStartOf` 同口径。 */
function weekStartOf(day) {
	const d = new Date(day + "T00:00:00Z");
	d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
	return d.toISOString().slice(0, 10);
}

/** 按自然周归并 daily：与 host 的 `tokstatsWeeklyOf` 同口径（周趋势卡的数据源）。 */
function weeklyOf(daily) {
	const byWeek = new Map();
	for (const row of daily) {
		const key = weekStartOf(row.day);
		const week = byWeek.get(key) ?? { weekStart: key, calls: 0, in: 0, cr: 0, cw: 0, out: 0 };
		week.calls += row.calls;
		week.in += row.in;
		week.cr += row.cr;
		week.out += row.out;
		byWeek.set(key, week);
	}
	return [...byWeek.values()].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
}

/** 84 天的固定序列（热力图与「当日档」柱图都从它切）——与 `daily` 同一真源。 */
const heatDaily = [];
for (let i = 83; i >= 0; i -= 1) {
	const calls = callsFor(i);
	heatDaily.push({ day: dayOffset(-i), calls, in: calls * 300, cr: 0, cw: 0, out: calls * 60 });
}

/** 窗口天数 → 一份自洽的汇总（daily / totals / weekly / windowStart 同源）。 */
function summaryFor(windowDays) {
	const days = windowDays > 0 ? windowDays : 60;
	const daily = [];
	for (let i = days - 1; i >= 0; i -= 1) {
		const calls = callsFor(i);
		const billed = calls * 1823;
		daily.push({
			day: dayOffset(-i),
			calls,
			in: Math.round(billed * 0.13),
			cr: Math.round(billed * 0.87),
			cw: 0,
			out: Math.round(calls * 1800),
		});
	}
	const totals = daily.reduce((sum, row) => ({
		calls: sum.calls + row.calls,
		in: sum.in + row.in,
		cr: sum.cr + row.cr,
		cw: 0,
		out: sum.out + row.out,
	}), { calls: 0, in: 0, cr: 0, cw: 0, out: 0 });
	const buckets = Array.from({ length: 6 }, () => ({ calls: 0, in: 0, cr: 0, cw: 0, out: 0 }));
	buckets[0] = { calls: 1240, in: 2e8, cr: 9e8, cw: 0, out: 3e5 };
	buckets[1] = { calls: 2980, in: 6e8, cr: 4e9, cw: 0, out: 9e5 };
	buckets[2] = { calls: 4120, in: 3e9, cr: 1.2e10, cw: 0, out: 2e6 };
	buckets[3] = { calls: 480, in: 9e8, cr: 2e9, cw: 0, out: 1e5 };
	buckets[4] = { calls: 24, in: 8e7, cr: 2e8, cw: 0, out: 4000 };
	return {
		buckets,
		daily,
		weekly: weeklyOf(daily),
		workspaces: [
			{ path: "D:\\projects\\web-app", calls: 5200, in: 2e9, out: 9e5, cr: 1e10, cw: 0 },
			{ path: "D:\\projects\\docs-site", calls: 2200, in: 8e8, out: 4e5, cr: 3e9, cw: 0 },
		],
		// 模型排行 6 条：市场卡片要一张全图装下整块面板，行数直接决定面板高度——
		// 双列贪心随行数重排，10 条时整图 1536×1856（比例 0.83，卡片里糊）；
		// 6 条重排后 1536×1677（比例 0.92），八块内容仍在一张图里。长排行场景
		// 由测试夹具覆盖，不靠效果图。
		routes: [
			{ rt: "example/chat-pro", calls: 4034, in: 8.2e8, out: 4.1e6, cr: 5e9, cw: 0 },
			{ rt: "example/chat-lite", calls: 2595, in: 5.9e8, out: 2.3e6, cr: 3e9, cw: 0 },
			{ rt: "demo/reasoner-xl", calls: 755, in: 1.3e8, out: 7e5, cr: 6e8, cw: 0 },
			{ rt: "demo/reasoner-mini", calls: 611, in: 1e8, out: 8.2e5, cr: 4e8, cw: 0 },
			{ rt: "demo/coder-pro", calls: 525, in: 6.3e7, out: 4.7e5, cr: 2e8, cw: 0 },
			{ rt: "", calls: 41, in: 1.6e6, out: 1.3e4, cr: 3e6, cw: 0 },
		],
		totals,
		windowStart: dayOffset(-(days - 1)),
		generatedAt: Date.now(),
		windowDays,
		coverage: { sessions: 128, skipped: 0 },
		epoch: null,
		heatDaily,
	};
}

// ── 渲染真实组件树 ────────────────────────────────────────────────────────
const rpc = makeRpcStub();
rpc.respond((call) => (call.endpoint === "promptopt"
	? { ok: true, value: { started: 12, adopted: 7, dismissed: 3, charsDelta: 1840 } }
	: { ok: true, value: summaryFor(call.payload?.windowDays ?? 1) }));

const base = setupClientBase({
	connection: { rpc },
	locale: lang,
	// TokstatsPanel 的第一个 useState 就是档位：给初值即可截「切到某档」的画面。
	initialStates: [range],
});
const main = base.registrations.find((r) => r.opts.name === "main");
const t = base.t(NS);
main.comp({ t });
base.react.runEffects();
for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
base.react.reset();
const tree = renderDeep(base.react, main.comp({ t }));
const css = injectedStyleTags.find((tag) => tag.dataset.pluginCss === "dsh-tokstats/tokstats").textContent;

// ── 序列化成 HTML ─────────────────────────────────────────────────────────
const esc = (value) => String(value)
	.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const styleText = (style) => Object.entries(style ?? {})
	.map(([k, v]) => k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()) + ":" + v).join(";");
const ATTRS = ["title", "role", "aria-label", "aria-selected", "data-level", "data-cursor"];

function render(node) {
	if (node === null || node === undefined || node === false || node === true) return "";
	if (typeof node === "string" || typeof node === "number") return esc(node);
	if (Array.isArray(node)) return node.map(render).join("");
	if (node.type === Symbol.for("react.fragment")) return (node.children ?? []).map(render).join("");
	const props = node.props ?? {};
	const tag = typeof node.type === "string" ? node.type : "div";
	const attrs = [];
	if (props.className) attrs.push('class="' + esc(props.className) + '"');
	if (props.style) attrs.push('style="' + esc(styleText(props.style)) + '"');
	for (const name of ATTRS) {
		if (props[name] !== undefined && props[name] !== null) attrs.push(name + '="' + esc(props[name]) + '"');
	}
	if (props.disabled) attrs.push("disabled");
	if (tag === "option" && props.value !== undefined) attrs.push('value="' + esc(props.value) + '"');
	return "<" + tag + (attrs.length ? " " + attrs.join(" ") : "") + ">"
		+ (node.children ?? []).map(render).join("") + "</" + tag + ">";
}

// 宿主主题 token：取自 app.asar 的 `body` 与 `body[data-ds-dark-theme]` 两个主题块。
const THEME_DARK = `
  --dsw-alias-bg-base:#151517; --dsw-alias-bg-layer-1:#232324; --dsw-alias-bg-layer-2:#2c2c2e;
  --dsw-alias-bg-layer-3:#353638; --dsw-alias-border-l1:#ffffff0f; --dsw-alias-border-l2:#ffffff1f;
  --dsw-alias-border-l3:#ffffff29; --dsw-alias-label-primary:#f9fafb; --dsw-alias-label-secondary:#cfd3d6;
  --dsw-alias-label-tertiary:#adb2b8; --dsw-alias-label-primary-inverted:#353638; --dsw-alias-brand-primary:#f9fafb;
  --dsw-alias-state-business-primary:#7aaaff; --dsw-alias-interactive-bg-hover:#ffffff14;
  --dsw-alias-state-success-primary:#22c55e; --dsw-alias-state-warn-primary:#f59e0b;
  --dsw-alias-state-error-primary:#f25a5a;
  --dsw-alias-button-elevated-fill:#43454a;
`;
const THEME_LIGHT = `
  --dsw-alias-bg-base:#ffffff; --dsw-alias-bg-layer-1:#ffffff; --dsw-alias-bg-layer-2:#ffffff;
  --dsw-alias-bg-layer-3:#ffffff; --dsw-alias-border-l1:#0000000a; --dsw-alias-border-l2:#0000001a;
  --dsw-alias-border-l3:#00000029; --dsw-alias-label-primary:#0f1115; --dsw-alias-label-secondary:#61666b;
  --dsw-alias-label-tertiary:#81858c; --dsw-alias-label-primary-inverted:#ffffff; --dsw-alias-brand-primary:#0f1115;
  --dsw-alias-state-business-primary:#4176e6; --dsw-alias-interactive-bg-hover:#2631480f;
  --dsw-alias-state-success-primary:#22c55e; --dsw-alias-state-warn-primary:#f59e0b;
  --dsw-alias-state-error-primary:#ec1313;
  --dsw-alias-button-elevated-fill:#ffffff;
`;
const page = "<!doctype html><html lang=\"" + lang + "\"><head><meta charset=\"utf-8\"><style>"
	+ "body{" + THEME_LIGHT + "}" + "body[data-ds-dark-theme]{" + THEME_DARK + "}"
	+ "html,body{margin:0;font-family:\"Microsoft YaHei\",system-ui,sans-serif}"
	+ "body{background:var(--dsw-alias-bg-base)}"
	+ "#app{width:" + width + "px;background:var(--dsw-alias-bg-base);overflow:hidden}"
	+ "</style><style>" + css + "</style></head><body"
	+ (themeName === "dark" ? " data-ds-dark-theme" : "") + "><div id=\"app\">"
	+ render(tree) + "</div><script>var a=document.getElementById(\"app\");"
	+ "a.setAttribute(\"data-shot-h\",Math.ceil(a.getBoundingClientRect().height))</script></body></html>";

const tmpHtml = join(tmpdir(), "tokstats-shot-" + process.pid + ".html");
writeFileSync(tmpHtml, page, "utf8");
mkdirSync(dirname(out), { recursive: true });

// 两遍截图：第一遍 --dump-dom 读页面自己量的内容高度（#app 自适应后的
// getBoundingClientRect），第二遍按该高度设窗口——固定视口会在内容变矮时
// 于底部留一圈底色（减夹具行数后空白曾达 200px）。量不到就回退固定高度。
const probe = spawnSync(chrome, [
	"--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-sandbox",
	"--window-size=" + String(width) + "," + String(height),
	"--virtual-time-budget=3000",
	"--dump-dom",
	"file:///" + tmpHtml.replace(/\\/g, "/"),
], { encoding: "utf8" });
const measured = /data-shot-h="(\d+)"/.exec(probe.stdout || "");
const shotHeight = measured ? Math.max(1, Number(measured[1])) : height;

const shot = spawnSync(chrome, [
	"--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-sandbox",
	"--force-device-scale-factor=" + String(dpr),
	// 窗口尺寸与面板一致：多出来的几十像素会在图里留一圈底色边。
	"--window-size=" + String(width) + "," + String(shotHeight),
	"--screenshot=" + out,
	"file:///" + tmpHtml.replace(/\\/g, "/"),
], { encoding: "utf8" });
if (!existsSync(out) || (shot.status !== 0 && shot.status !== null)) {
	console.error(shot.stderr || shot.stdout || "chromium 截图失败");
	process.exit(1);
}
console.log("wrote", out, "(" + width + "x" + shotHeight + " @" + dpr + "x, " + lang + ", " + range + ", " + themeName + ")");

/** 按 Playwright 的默认缓存目录找 chromium（找不到就让调用方用 --chrome 指定）。 */
function findChrome() {
	const cache = join(homedir(), "AppData", "Local", "ms-playwright");
	if (existsSync(cache)) {
		const dirs = readdirSync(cache).filter((name) => name.startsWith("chromium-")).sort().reverse();
		for (const dir of dirs) {
			const exe = join(cache, dir, "chrome-win64", "chrome.exe");
			if (existsSync(exe)) return exe;
		}
	}
	return "chrome";
}
