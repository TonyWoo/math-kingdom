// 把 cn-math-taxonomy（https://github.com/xiaoyang111222/cn-math-taxonomy）的小学数学部分导入成 src/data/kingdom.json：
// 知识点、先修边、题目，以及预先算好的王国布局（每个知识点一块地）。布局在这里算好并提交，上游数据更新时已有地块不会乱跳。
// 用法：
//   git clone --depth 1 https://github.com/xiaoyang111222/cn-math-taxonomy ../cn-math-taxonomy
//   npm run import -- ../cn-math-taxonomy
//
// Imports the primary-school math part of cn-math-taxonomy (CC BY-NC 4.0) and precomputes the kingdom layout.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DOMAINS = ["数与代数", "图形与几何", "统计与概率", "综合与实践"];
const TERRAIN = { 数与代数: "plain", 图形与几何: "hill", 统计与概率: "coast", 综合与实践: "fair" };
// 知识点类型 → 建筑
const BUILDING = {
	procedural: "mill",
	conceptual: "library",
	reasoning: "watchtower",
	application: "market",
	modeling: "plaza",
};

const CASTLE_R = 300; // 王城半径（布局坐标，场景里乘 0.01）
const SPACING = 150; // 两块地之间的目标间距
const ROAD_GAP = 70; // 年级圈之间的环路宽度
const VILLAGE_GAP = 60; // 同一圈里相邻村庄之间的弧长
const MIN_SECTOR = 0.11; // 最小扇区占整圈的比例（统计与概率只有 10 个点）

function stableHash(s) {
	// FNV-1a，给每块地一个固定的小偏移
	let h = 2166136261;
	for (const b of Buffer.from(s, "utf8")) {
		h = Math.imul(h ^ b, 16777619) >>> 0;
	}
	return h;
}

function load(repo) {
	const read = (name) => JSON.parse(readFileSync(join(repo, "data", name), "utf8"));
	const topics = read("topics.json").filter((t) => t.id.startsWith("cnm_p"));
	const ids = new Set(topics.map((t) => t.id));
	const edges = read("dependencies.json").filter((e) => ids.has(e.topicId) && ids.has(e.prerequisiteId));
	const questions = read("questions.json").filter((q) => ids.has(q.topicId));
	let commit = "unknown";
	try {
		commit = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
	} catch {
		// 不是 git clone 时就不记提交号
	}
	return { topics, edges, questions, commit };
}

function check({ topics, edges, questions }) {
	for (const t of topics) {
		if (!DOMAINS.includes(t.domain) || !BUILDING[t.type] || !(t.grade >= 1 && t.grade <= 6)) {
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

function layout(topics, edges) {
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
		v.domain = DOMAINS.reduce((best, d) => ((v.domains[d] ?? 0) > (v.domains[best] ?? 0) ? d : best), DOMAINS[0]);
	}

	// 扇区：方向 = 领域，按知识点数量分角度，数与代数居中朝上
	const total = Object.fromEntries(DOMAINS.map((d) => [d, 0]));
	for (const v of villages) total[v.domain] += v.topics.length;
	const share = Object.fromEntries(DOMAINS.map((d) => [d, Math.max(MIN_SECTOR, total[d] / topics.length)]));
	const scale = DOMAINS.reduce((s, d) => s + share[d], 0);
	const sectors = [];
	let a = -Math.PI / 2 - (share[DOMAINS[0]] / scale) * Math.PI;
	for (const d of DOMAINS) {
		const span = (share[d] / scale) * Math.PI * 2;
		sectors.push({ domain: d, terrain: TERRAIN[d], a1: a, a2: a + span });
		a += span;
	}

	// 年级圈：每圈宽度按最拥挤的扇区算，每块地大约 SPACING² 的面积
	const rings = [];
	let r1 = CASTLE_R + ROAD_GAP;
	for (let g = 1; g <= 6; g++) {
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

	const plots = new Map();
	const outVillages = [];
	for (let g = 1; g <= 6; g++) {
		const ring = rings[g - 1];
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

function main() {
	const repo = process.argv[2];
	if (!repo) {
		console.error("usage: npm run import -- <cn-math-taxonomy clone>");
		process.exit(2);
	}
	const root = join(dirname(fileURLToPath(import.meta.url)), "..");
	const src = load(repo);
	check(src);
	const { sectors, rings, villages, plots } = layout(src.topics, src.edges);
	const villageOf = new Map();
	villages.forEach((v, i) => v.plots.forEach((id) => villageOf.set(id, i)));

	const byTopic = new Map();
	for (const q of src.questions) {
		if (!byTopic.has(q.topicId)) byTopic.set(q.topicId, []);
		const out = {
			id: q.id,
			difficulty: q.difficulty,
			kind: q.type,
			prompt: q.prompt,
			answer: String(q.answer),
		};
		if (q.choices) out.choices = q.choices.map((c) => ({ key: c.key, text: c.text }));
		if (q.explanation) out.explanation = q.explanation;
		byTopic.get(q.topicId).push(out);
	}

	const data = {
		source: {
			repo: "https://github.com/xiaoyang111222/cn-math-taxonomy",
			commit: src.commit,
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
		topics: src.topics.map((t) => {
			const p = plots.get(t.id);
			return {
				id: t.id,
				name: t.name,
				domain: t.domain,
				type: t.type,
				grade: t.grade,
				semester: t.semester,
				chapter: t.chapter,
				description: t.description,
				mastery: t.mastery_criteria ?? [],
				x: round(p.x),
				y: round(p.y),
				village: villageOf.get(t.id),
				building: p.building,
			};
		}),
		edges: src.edges.map((e) => ({ topic: e.topicId, prereq: e.prerequisiteId, hard: e.strength === "hard" })),
		questions: Object.fromEntries(src.topics.map((t) => [t.id, byTopic.get(t.id)])),
	};
	writeFileSync(join(root, "src", "data", "kingdom.json"), JSON.stringify(data) + "\n");

	const pts = [...plots.values()];
	let near = Infinity;
	for (let i = 0; i < pts.length; i++) {
		for (let j = i + 1; j < pts.length; j++) {
			near = Math.min(near, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
		}
	}
	console.log(
		`topics ${src.topics.length}  edges ${src.edges.length}  questions ${src.questions.length}  ` +
			`villages ${villages.length}  outer radius ${Math.round(rings.at(-1).r2)}  closest plots ${Math.round(near)}`,
	);
}

main();
