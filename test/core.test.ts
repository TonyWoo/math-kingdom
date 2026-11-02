// 核心逻辑的单元测试：数据和布局、地块状态、判题、答题流程。
import { describe, expect, it } from "vitest";
import raw from "../src/data/kingdom.json";
import { judge, parseNumbers } from "../src/core/judge";
import {
	DAY,
	GOBLIN_AFTER,
	Kingdom,
	type Progress,
	WEEDS_AFTER,
	demoProgress,
	dependencyOrder,
	frontier,
	needsCare,
	stars,
	status,
	summary,
} from "../src/core/kingdom";
import { QuizSession, dayOf, planFor } from "../src/core/quiz";
import type { KingdomData, Question } from "../src/core/types";

const data = raw as KingdomData;
const k = new Kingdom(data);
const NOW = new Date(2026, 10, 2, 10, 0, 0).getTime();

// 用题目的标准答案作答
const right = (q: Question) => q.answer;
const wrong = (q: Question) => (q.kind === "choice" ? (q.answer === "A" ? "B" : "A") : "999999");

describe("data", () => {
	it("每个知识点都有 2 基础 + 1 标准 + 1 挑战题，选择题的答案在选项里", () => {
		expect(data.topics.length).toBe(284);
		for (const t of data.topics) {
			const qs = data.questions[t.id];
			expect(qs.filter((q) => q.difficulty === "basic").length).toBe(2);
			expect(qs.filter((q) => q.difficulty === "standard").length).toBe(1);
			expect(qs.filter((q) => q.difficulty === "challenge").length).toBe(1);
			for (const q of qs) {
				if (q.kind === "choice") expect(q.choices!.map((c) => c.key)).toContain(q.answer);
				else expect(parseNumbers(q.answer), q.id).not.toBeNull();
				// 标准答案自己必须判对
				expect(judge(q, q.answer), q.id).toBe(true);
			}
		}
	});

	it("先修不晚于后续", () => {
		for (const e of data.edges) {
			expect(k.topic(e.prereq).grade).toBeLessThanOrEqual(k.topic(e.topic).grade);
		}
	});

	it("地块在自己的年级圈和领域扇区里，两两不挤在一起", () => {
		for (const t of data.topics) {
			const ring = data.rings[t.grade - 1];
			const r = Math.hypot(t.x, t.y);
			expect(r).toBeGreaterThanOrEqual(ring.r1);
			expect(r).toBeLessThanOrEqual(ring.r2);
			const v = data.villages[t.village];
			expect(v.plots).toContain(t.id);
			const s = data.sectors.find((x) => x.domain === v.domain)!;
			let a = Math.atan2(t.y, t.x);
			while (a < s.a1) a += Math.PI * 2;
			while (a >= s.a1 + Math.PI * 2) a -= Math.PI * 2;
			expect(a).toBeLessThanOrEqual(s.a2 + 1e-3);
		}
		for (let i = 0; i < data.topics.length; i++) {
			for (let j = i + 1; j < data.topics.length; j++) {
				const a = data.topics[i];
				const b = data.topics[j];
				expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(80);
			}
		}
	});
});

describe("judge", () => {
	const num = (answer: string): Question => ({ id: "q", difficulty: "basic", kind: "numeric", prompt: "", answer });
	it("整数、小数、分数按数值比较", () => {
		expect(judge(num("12"), "12")).toBe(true);
		expect(judge(num("12"), " １２ ")).toBe(true);
		expect(judge(num("12"), "13")).toBe(false);
		expect(judge(num("0.5"), ".5")).toBe(true);
		expect(judge(num("1/2"), "2/4")).toBe(true);
		expect(judge(num("1/2"), "0.5")).toBe(true);
		expect(judge(num("3/4"), "4/3")).toBe(false);
		expect(judge(num("25"), "25%")).toBe(true);
		expect(judge(num("1/2"), "1/0")).toBe(false);
		expect(judge(num("7"), "")).toBe(false);
		expect(judge(num("7"), "七")).toBe(false);
	});
	it("多个数要按顺序", () => {
		expect(judge(num("2，3"), "2,3")).toBe(true);
		expect(judge(num("2，3"), "2 3")).toBe(true);
		expect(judge(num("2，3"), "3，2")).toBe(false);
		expect(judge(num("2，3"), "2")).toBe(false);
	});
	it("选择题比较字母", () => {
		const q: Question = { id: "q", difficulty: "basic", kind: "choice", prompt: "", answer: "B" };
		expect(judge(q, "b")).toBe(true);
		expect(judge(q, "A")).toBe(false);
	});
});

describe("status", () => {
	it("空进度：没有 hard 先修的是空地，其余在迷雾里", () => {
		for (const id of k.order) {
			expect(status(k, {}, id, NOW)).toBe(k.prereq.get(id)!.length === 0 ? "open" : "locked");
		}
		expect(status(k, {}, "cnm_p001", NOW)).toBe("open");
		expect(status(k, { cnm_p001: { stars: 1 } }, "cnm_p002", NOW)).toBe("open");
	});
	it("过期依次是问号、长草、哥布林，星级不变", () => {
		const p: Progress = { cnm_p001: { stars: 3, due: NOW } };
		expect(status(k, p, "cnm_p001", NOW - 1)).toBe("built");
		expect(status(k, p, "cnm_p001", NOW)).toBe("due");
		expect(status(k, p, "cnm_p001", NOW + WEEDS_AFTER)).toBe("weeds");
		expect(status(k, p, "cnm_p001", NOW + GOBLIN_AFTER)).toBe("goblin");
		expect(stars(p, "cnm_p001")).toBe(3);
	});
	it("演示进度遵守先修规则，三种提醒都有", () => {
		const p = demoProgress(k, NOW);
		for (const id of Object.keys(p)) {
			for (const pre of k.prereq.get(id)!) expect(stars(p, pre)).toBeGreaterThanOrEqual(1);
		}
		const s = summary(k, p, NOW);
		expect(s.due).toBeGreaterThan(0);
		expect(s.weeds).toBeGreaterThan(0);
		expect(s.goblin).toBeGreaterThan(0);
		expect(s.locked + s.open + s.built + s.due + s.weeds + s.goblin).toBe(s.total);
		expect(needsCare(k, p, NOW).length).toBe(s.due + s.weeds + s.goblin);
	});
});

describe("quiz", () => {
	const play = (progress: Progress, id: string, now: number, answer: (q: Question) => string) => {
		const plan = planFor(k, progress, id, now);
		const s = new QuizSession(k, progress, id, plan, () => 0.3);
		while (!s.finished) s.answer(answer(s.current!));
		return { plan, outcome: s.finish(k, progress, now), session: s };
	};

	it("三步建造：地基 2 道基础题、房子 1 道标准题、金顶要隔天", () => {
		const p: Progress = {};
		let r = play(p, "cnm_p001", NOW, right);
		expect(r.plan).toEqual({ kind: "build", stage: 1 });
		expect(r.session.questions.map((q) => q.difficulty)).toEqual(["basic", "basic"]);
		expect(r.outcome).toMatchObject({ success: true, starsBefore: 0, starsAfter: 1 });
		expect(status(k, p, "cnm_p002", NOW)).toBe("open");

		r = play(p, "cnm_p001", NOW, right);
		expect(r.plan).toEqual({ kind: "build", stage: 2 });
		expect(r.session.questions.map((q) => q.difficulty)).toEqual(["standard"]);
		expect(r.outcome.starsAfter).toBe(2);

		expect(planFor(k, p, "cnm_p001", NOW)).toEqual({ kind: "wait", stage: 3 });
		// 第二天：先到了复习时间（得星后 1 天），复习之后才能升金顶
		const tomorrow = NOW + DAY;
		expect(dayOf(tomorrow)).not.toBe(dayOf(NOW));
		expect(planFor(k, p, "cnm_p001", tomorrow)).toEqual({ kind: "review" });
		r = play(p, "cnm_p001", tomorrow, right);
		expect(r.outcome).toMatchObject({ success: true, starsAfter: 2 });
		expect(p.cnm_p001.due).toBe(tomorrow + 3 * DAY);
		r = play(p, "cnm_p001", tomorrow, right);
		expect(r.plan).toEqual({ kind: "build", stage: 3 });
		expect(r.outcome.starsAfter).toBe(3);
		expect(planFor(k, p, "cnm_p001", tomorrow).kind).toBe("practice");
	});

	it("答错不扣星；同一步连续失败 2 次提示先巩固先修", () => {
		const p: Progress = { cnm_p001: { stars: 1, due: NOW + DAY } };
		const id = "cnm_p002";
		let r = play(p, id, NOW, wrong);
		expect(r.outcome).toMatchObject({ success: false, starsAfter: 0, roots: [] });
		r = play(p, id, NOW, wrong);
		expect(r.outcome.roots).toEqual(k.prereq.get(id));
		r = play(p, id, NOW, right);
		expect(r.outcome.success).toBe(true);
		expect(p[id].fails).toBe(0);
	});

	it("复习答错：星级不变，仍然要复习", () => {
		const p: Progress = { cnm_p001: { stars: 2, due: NOW - 1 } };
		const r = play(p, "cnm_p001", NOW, wrong);
		expect(r.plan.kind).toBe("review");
		expect(r.outcome.success).toBe(false);
		expect(stars(p, "cnm_p001")).toBe(2);
		expect(status(k, p, "cnm_p001", NOW)).toBe("due");
	});

	it("迷雾里的地块不能答题，并列出缺的先修", () => {
		const plan = planFor(k, {}, "cnm_p002", NOW);
		expect(plan).toEqual({ kind: "locked", missing: ["cnm_p001"] });
	});
});

describe("frontier（按依赖顺序找接下来该学什么）", () => {
	// 教材顺序故意和依赖顺序拧着：b、c 都要先学 a，d 要先学 b
	const topic = (id: string, grade: number) => ({
		id,
		name: id,
		domain: "数与代数",
		type: "conceptual",
		grade,
		semester: "上" as const,
		chapter: "",
		description: "",
		mastery: [],
		x: 0,
		y: 0,
		village: 0,
		building: "mill" as const,
	});
	const small = new Kingdom({
		source: { repo: "", commit: "", license: "", note: "" },
		castle: { r: 0 },
		sectors: [],
		rings: [],
		villages: [],
		topics: [topic("b", 2), topic("c", 1), topic("a", 1), topic("d", 2)],
		edges: [
			{ topic: "b", prereq: "a", hard: true },
			{ topic: "c", prereq: "a", hard: true },
			{ topic: "d", prereq: "b", hard: true },
		],
		questions: {},
	});

	it("依赖顺序里先修永远在前面", () => {
		expect(dependencyOrder(small)).toEqual(["a", "b", "c", "d"]);
		const pos = new Map(dependencyOrder(k).map((id, i) => [id, i] as const));
		for (const e of data.edges) if (e.hard) expect(pos.get(e.prereq)!).toBeLessThan(pos.get(e.topic)!);
	});

	it("空进度从依赖链的头开始", () => {
		expect(frontier(small, {}, NOW)).toBe("a");
		expect(frontier(small, { a: { stars: 1 } }, NOW)).toBe("b");
	});

	it("按年级找：这一年级的先修在别的年级没学时，没有可学的就返回 null", () => {
		expect(frontier(small, {}, NOW, 2)).toBeNull();
		expect(frontier(small, { a: { stars: 1 } }, NOW, 2)).toBe("b");
		expect(frontier(small, { a: { stars: 1 } }, NOW, 1)).toBe("c");
	});

	it("没有空地时找最早的没建完的；全建完返回 null", () => {
		const p: Progress = { a: { stars: 3 }, b: { stars: 1 }, c: { stars: 2 }, d: { stars: 1 } };
		expect(frontier(small, p, NOW)).toBe("b");
		const done: Progress = { a: { stars: 3 }, b: { stars: 3 }, c: { stars: 3 }, d: { stars: 3 } };
		expect(frontier(small, done, NOW)).toBeNull();
	});

	it("真实数据：空进度的第一站是没先修的一年级知识点", () => {
		const f = frontier(k, {}, NOW);
		expect(f).not.toBeNull();
		expect(k.topic(f!).grade).toBe(1);
		expect(k.prereq.get(f!)).toEqual([]);
		expect(status(k, {}, f!, NOW)).toBe("open");
	});
});
