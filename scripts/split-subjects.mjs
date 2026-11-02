// 把 cn-math-taxonomy 按学科拆成前端按需加载的数据文件：public/data/<学科>.json，
// 外加一份索引 public/data/subjects.json（学科切换菜单用）。
//
// 拆分原则：原库字段全量透传，一个不丢——知识点保留 diagnostic_question、standards 等
// 现在玩法还没用到的字段，题目保留 accept、verify 原文；游戏需要的别名（mastery、kind）
// 和算出来的布局（每块地的坐标、村庄、建筑）并排放在一起。玩法只决定“当前用哪些”，
// 以后扩初高中或新学科，改 scripts/subjects.json 的配置即可，格式不用动。
//
// 布局算法和 scripts/import-taxonomy.mjs 相同（领域分扇区、年级分圈层、教材单元成村庄），
// 只是领域、地形、年级范围改由学科配置决定。数学的输出同时写一份 src/data/kingdom.json，
// 保持测试和旧导入管线在同一份数据上。
//
// 用法：
//   npm run sync                      # 先同步原库到 ../cn-math-taxonomy
//   npm run split -- ../cn-math-taxonomy            # 拆全部学科
//   npm run split -- ../cn-math-taxonomy english    # 只拆一科
//
// Splits cn-math-taxonomy into per-subject data files under public/data/ for lazy
// loading. Original fields pass through untouched; layout is precomputed here.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 知识点类型 → 建筑（所有学科共用同一套类型词表）
const BUILDING = {
	procedural: "mill",
	conceptual: "library",
	reasoning: "watchtower",
	application: "market",
	modeling: "plaza",
};
// 学科配置没给地形时，按领域顺序轮着用这四种地貌
const TERRAIN_PALETTE = ["plain", "hill", "coast", "fair"];

const CASTLE_R = 300; // 王城半径（布局坐标，场景里乘 0.01）
const SPACING = 150; // 两块地之间的目标间距
const ROAD_GAP = 70; // 年级圈之间的环路宽度
const VILLAGE_GAP = 60; // 同一圈里相邻村庄之间的弧长
const MIN_SECTOR = 0.11; // 最小扇区占整圈的比例

function stableHash(s) {
	// FNV-1a，给每块地一个固定的小偏移
	let h = 2166136261;
	for (const b of Buffer.from(s, "utf8")) {
		h = Math.imul(h ^ b, 16777619) >>> 0;
	}
	return h;
}

const subjectOf = (t) => t.subject ?? "math";

function loadAll(repo) {
	const read = (name) => JSON.parse(readFileSync(join(repo, "data", name), "utf8"));
	let commit = "unknown";
	try {
		commit = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
	} catch {
		// 不是 git clone 时就不记提交号
	}
	return { topics: read("topics.json"), edges: read("dependencies.json"), questions: read("questions.json"), commit };
}

function check({ topics, edges, questions }, domains) {
	for (const t of topics) {
		if (!domains.includes(t.domain) || !BUILDING[t.type]) {
			throw new Error(`bad topic ${t.id}`);
		}
	}
	// 先修无环
	const prereq = new Map();
	for (const e of edges) {
		if (!prereq.has(e.topicId)) prereq.set(e.topicId, []);
		prereq.get(e.topicId).push(e.prerequisiteId);
	}
	const state = new Map();
	const visit = (id) => {
		if (state.get(id) === 1) throw new Error(`cycle at ${id}`);
		if (state.get(id) === 2) return;
		state.set(id, 1);
		for (const p of prereq.get(id) ?? []) visit(p);
		state.set(id, 2);
	};
	topics.forEach((t) => visit(t.id));
	const count = new Map();
	for (const q of questions) count.set(q.topicId, (count.get(q.topicId) ?? 0) + 1);
	const missing = topics.filter((t) => !count.has(t.id)).map((t) => t.id);
	if (missing.length) throw new Error(`topics without questions: ${missing}`);
}

function layout(topics, edges, domains, terrain, grades) {
	const prereq = new Map();
	for (const e of edges) {
		if (e.strength !== "hard") continue;
		if (!prereq.has(e.topicId)) prereq.set(e.topicId, []);
		prereq.get(e.topicId).push(e.prerequisiteId);
	}

	// 村庄：同一 chapter（教材单元）的知识点；归属领域取多数
	const villages = [];
	const index = new Map();
	for (const t of topics) {
		let v = index.get(t.chapter);
		if (!v) {
			const parts = t.chapter.split(" ");
			v = {
				key: t.chapter,
				name: parts.slice(2).join(" ") || parts.at(-1),
				unit: parts.slice(0, 2).join(" "),
				grade: t.grade,
				semester: t.semester,
				topics: [],
				domains: {},
			};
			index.set(t.chapter, v);
			villages.push(v);
		}
		v.topics.push(t);
		v.domains[t.domain] = (v.domains[t.domain] ?? 0) + 1;
	}
	for (const v of villages) {
		v.domain = domains.reduce((best, d) => ((v.domains[d] ?? 0) > (v.domains[best] ?? 0) ? d : best), domains[0]);
	}

	// 扇区：方向 = 领域，按知识点数量分角度，第一个领域居中朝上
	const total = Object.fromEntries(domains.map((d) => [d, 0]));
	for (const v of villages) total[v.domain] += v.topics.length;
	const share = Object.fromEntries(domains.map((d) => [d, Math.max(MIN_SECTOR, total[d] / topics.length)]));
	const scale = domains.reduce((s, d) => s + share[d], 0);
	const sectors = [];
	let a = -Math.PI / 2 - (share[domains[0]] / scale) * Math.PI;
	for (const d of domains) {
		const span = (share[d] / scale) * Math.PI * 2;
		sectors.push({ domain: d, terrain: terrain[d], a1: a, a2: a + span });
		a += span;
	}

	// 年级圈：每圈宽度按最拥挤的扇区算，每块地大约 SPACING² 的面积；只给有数据的年级建圈
	const rings = [];
	let r1 = CASTLE_R + ROAD_GAP;
	for (const g of grades) {
		let need = 0;
		for (const s of sectors) {
			const vs = villages.filter((v) => v.grade === g && v.domain === s.domain);
			const n = vs.reduce((c, v) => c + v.topics.length, 0);
			if (!n) continue;
			const span = s.a2 - s.a1;
			const free = Math.max(span - ((vs.length + 1) * VILLAGE_GAP) / (r1 + SPACING), span * 0.3);
			const area = n * SPACING * SPACING * 1.15;
			const r2 = Math.sqrt(r1 * r1 + (2 * area) / free);
			need = Math.max(need, r2 - r1, SPACING * 1.2);
		}
		rings.push({ grade: g, r1, r2: r1 + need });
		r1 += need + ROAD_GAP;
	}
	const ringOf = new Map(rings.map((r) => [r.grade, r]));

	const plots = new Map();
	const outVillages = [];
	for (const g of grades) {
		const ring = ringOf.get(g);
		for (const s of sectors) {
			const vs = villages.filter((v) => v.grade === g && v.domain === s.domain);
			if (!vs.length) continue;
			const n = vs.reduce((c, v) => c + v.topics.length, 0);
			const rm = (ring.r1 + ring.r2) / 2;
			const gap = VILLAGE_GAP / rm;
			const free = s.a2 - s.a1 - gap * (vs.length + 1);
			// 先按教材顺序得到默认角度，再按“hard 先修的平均角度”重新排序（重心法），让同一条知识链沿半径往外延伸
			const key = new Map();
			let x = s.a1 + gap;
			for (const v of vs) {
				const span = (free * v.topics.length) / n;
				const angles = v.topics
					.flatMap((t) => prereq.get(t.id) ?? [])
					.filter((p) => plots.has(p) && plots.get(p).a >= s.a1 && plots.get(p).a <= s.a2)
					.map((p) => plots.get(p).a);
				key.set(v.key, angles.length ? angles.reduce((p, q) => p + q, 0) / angles.length : x + span / 2);
				x += span + gap;
			}
			vs.sort((p, q) => key.get(p.key) - key.get(q.key));
			x = s.a1 + gap;
			for (const v of vs) {
				const span = (free * v.topics.length) / n;
				placeVillage(v, x, x + span, ring, plots);
				outVillages.push(v);
				x += span + gap;
			}
		}
	}
	return { sectors, rings, villages: outVillages, plots };
}

// 在扇形格子 [a1, a2] × [r1, r2] 里排成接近正方形的网格：按教材顺序从里往外、再沿圆弧排
function placeVillage(v, a1, a2, ring, plots) {
	const ts = v.topics;
	const n = ts.length;
	const pad = 0.12 * (ring.r2 - ring.r1);
	const r1 = ring.r1 + pad;
	const r2 = ring.r2 - pad;
	const rm = (r1 + r2) / 2;
	const arc = (a2 - a1) * rm;
	const width = r2 - r1;
	let best = null;
	for (let rows = 1; rows <= n; rows++) {
		const cols = Math.ceil(n / rows);
		const cell = Math.min(width / rows, arc / cols);
		if (!best || cell > best.cell + 1e-6) best = { cell, rows, cols };
	}
	const { rows, cols } = best;
	v.plots = [];
	ts.forEach((t, i) => {
		const col = Math.floor(i / rows);
		let row = i % rows;
		if (col === cols - 1) row += (rows - (n - col * rows)) / 2;
		const h = stableHash(t.id);
		const jr = ((h & 0xff) / 255 - 0.5) * 0.25;
		const ja = (((h >>> 8) & 0xff) / 255 - 0.5) * 0.25;
		const r = r1 + ((row + 0.5 + jr) / rows) * width;
		const a = a1 + ((col + 0.5 + ja) / cols) * (a2 - a1);
		plots.set(t.id, { x: r * Math.cos(a), y: r * Math.sin(a), a, building: BUILDING[t.type] });
		v.plots.push(t.id);
	});
	const am = (a1 + a2) / 2;
	v.x = rm * Math.cos(am);
	v.y = rm * Math.sin(am);
	v.a1 = a1;
	v.a2 = a2;
}

const round = (x) => Math.round(x * 10) / 10;
const round3 = (x) => Math.round(x * 1000) / 1000;

function buildSubject(id, cfg, all, commit) {
	const topics = all.topics.filter((t) => subjectOf(t) === id && t.grade >= 1 && t.grade <= cfg.maxGrade);
	const ids = new Set(topics.map((t) => t.id));
	const edges = all.edges.filter((e) => ids.has(e.topicId) && ids.has(e.prerequisiteId));
	const questions = all.questions.filter((q) => ids.has(q.topicId));

	// 领域顺序：配置写了就用配置的，没写按数据里第一次出现的顺序；地形同理
	const domains = cfg.domains ?? [...new Set(topics.map((t) => t.domain))];
	const terrain = Object.fromEntries(domains.map((d, i) => [d, cfg.terrain?.[d] ?? TERRAIN_PALETTE[i % TERRAIN_PALETTE.length]]));
	const grades = [...new Set(topics.map((t) => t.grade))].sort((x, y) => x - y);

	check({ topics, edges, questions }, domains);
	const { sectors, rings, villages, plots } = layout(topics, edges, domains, terrain, grades);
	const villageOf = new Map();
	villages.forEach((v, i) => v.plots.forEach((tid) => villageOf.set(tid, i)));

	const byTopic = new Map();
	for (const q of questions) {
		if (!byTopic.has(q.topicId)) byTopic.set(q.topicId, []);
		// 原字段全量透传（type、verify、accept 等都在），再补玩法用的别名 kind 和字符串答案
		byTopic.get(q.topicId).push({ ...q, kind: q.type, answer: String(q.answer) });
	}

	const data = {
		subject: { id, name: cfg.name, kingdom: cfg.kingdom },
		source: {
			repo: "https://github.com/xiaoyang111222/cn-math-taxonomy",
			commit,
			license: "CC BY-NC 4.0",
			note: "知识点、先修关系和题目由 AI 生成，未经教师审核。",
		},
		castle: { r: CASTLE_R },
		sectors: sectors.map((s) => ({ ...s, a1: round3(s.a1), a2: round3(s.a2) })),
		rings: rings.map((r) => ({ grade: r.grade, r1: round(r.r1), r2: round(r.r2) })),
		villages: villages.map((v) => ({
			name: v.name,
			unit: v.unit,
			grade: v.grade,
			semester: v.semester,
			domain: v.domain,
			x: round(v.x),
			y: round(v.y),
			a1: round3(v.a1),
			a2: round3(v.a2),
			plots: v.plots,
		})),
		topics: topics.map((t) => {
			const p = plots.get(t.id);
			// 原字段全量透传，再补 mastery 别名和算出来的位置、村庄、建筑
			return { ...t, mastery: t.mastery_criteria ?? [], x: round(p.x), y: round(p.y), village: villageOf.get(t.id), building: p.building };
		}),
		edges: edges.map((e) => ({ topic: e.topicId, prereq: e.prerequisiteId, hard: e.strength === "hard", strength: e.strength })),
		questions: Object.fromEntries(topics.map((t) => [t.id, byTopic.get(t.id)])),
	};
	return { data, topics: topics.length, questions: questions.length, villages: villages.length, grades };
}

function main() {
	const repo = process.argv[2];
	if (!repo) {
		console.error("usage: npm run split -- <cn-math-taxonomy dir> [subject]");
		process.exit(2);
	}
	const root = join(dirname(fileURLToPath(import.meta.url)), "..");
	const config = JSON.parse(readFileSync(join(root, "scripts", "subjects.json"), "utf8"));
	const only = process.argv[3];
	const all = loadAll(repo);

	mkdirSync(join(root, "public", "data"), { recursive: true });
	const index = [];
	for (const [id, cfg] of Object.entries(config)) {
		if (only && only !== id) continue;
		const r = buildSubject(id, cfg, all, all.commit);
		writeFileSync(join(root, "public", "data", `${id}.json`), JSON.stringify(r.data) + "\n");
		// 数学同时写一份到 src/data/kingdom.json：测试和旧管线继续用同一份数据
		if (id === "math") writeFileSync(join(root, "src", "data", "kingdom.json"), JSON.stringify(r.data) + "\n");
		index.push({ id, name: cfg.name, kingdom: cfg.kingdom, topics: r.topics, questions: r.questions, grades: r.grades });
		console.log(`${id}（${cfg.name}）：topics ${r.topics}  questions ${r.questions}  villages ${r.villages}  grades ${r.grades.join("-")}`);
	}
	if (!only) {
		writeFileSync(join(root, "public", "data", "subjects.json"), JSON.stringify({ subjects: index }, null, "\t") + "\n");
		console.log(`索引 public/data/subjects.json：${index.length} 个学科`);
	}
}

main();
