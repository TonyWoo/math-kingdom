// 变式题：对整个题库生成很多变式，检查答案自洽、范围和技能要求。
import { describe, expect, it } from "vitest";
import raw from "../src/data/kingdom.json";
import { judge, parseNumbers } from "../src/core/judge";
import type { KingdomData, Question } from "../src/core/types";
import { canVary, makeVariant } from "../src/core/variant";

const data = raw as KingdomData;
const name = new Map(data.topics.map((t) => [t.id, t.name]));
const all = Object.entries(data.questions).flatMap(([id, qs]) => qs.map((q) => [id, q] as [string, Question]));

// 可重复的随机数
function seeded(seed: number): () => number {
	let s = seed >>> 0 || 1;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}

describe("variant", () => {
	it("覆盖大部分有算式的填数题", () => {
		const eligible = all.filter(([id, q]) => canVary(q, name.get(id)!));
		expect(eligible.length).toBeGreaterThan(150);
		expect(new Set(eligible.map(([id]) => id)).size).toBeGreaterThan(80);
	});

	it("选择题、没有算式的题、有隐藏推理的题不换", () => {
		for (const [id, q] of all) {
			if (q.kind === "choice" || !q.verify) expect(canVary(q, name.get(id)!)).toBe(false);
		}
		const ratio = all.find(([, q]) => q.prompt.includes("最简整数比"));
		if (ratio) expect(canVary(ratio[1], name.get(ratio[0])!)).toBe(false);
	});

	it("每道变式题：数换了、答案能判对、非负、整数题还是整数、不超过“以内”的范围", () => {
		const rng = seeded(42);
		let made = 0;
		for (const [id, q] of all) {
			const topic = name.get(id)!;
			if (!canVary(q, topic)) continue;
			for (let i = 0; i < 20; i++) {
				const v = makeVariant(q, topic, rng);
				if (!v) continue;
				made++;
				expect(v.prompt, q.id).not.toBe(q.prompt);
				expect(judge(v, v.answer), `${v.id} ${v.answer}`).toBe(true);
				const [value] = parseNumbers(v.answer)!;
				expect(value).toBeGreaterThanOrEqual(0);
				if (/^\d+$/.test(q.answer)) expect(Number.isInteger(value), v.id).toBe(true);
				const cap = `${topic} ${q.prompt}`.match(/(\d+)\s*以内/);
				if (cap) {
					expect(value, v.id).toBeLessThanOrEqual(Number(cap[1]));
					for (const n of v.prompt.match(/\d+(?:\.\d+)?/g) ?? []) expect(Number(n), v.id).toBeLessThanOrEqual(Number(cap[1]));
				}
				expect(v.explanation).toMatch(/^算式：.+＝ /);
				expect(v.variantOf).toBe(q.id);
			}
		}
		expect(made).toBeGreaterThan(2500);
	});

	it("进位加法换出来的题还要进位", () => {
		const rng = seeded(7);
		for (const [id, q] of all) {
			const topic = name.get(id)!;
			if (!/进位加法/.test(topic) || /不进位/.test(topic) || !canVary(q, topic) || !/^\d+\+\d+$/.test(q.verify!)) continue;
			for (let i = 0; i < 20; i++) {
				const v = makeVariant(q, topic, rng);
				if (!v) continue;
				const nums = v.explanation!.match(/\d+/g)!.map(Number);
				expect((nums[0] % 10) + (nums[1] % 10), v.id).toBeGreaterThanOrEqual(10);
			}
		}
	});

	it("不会出的错题：数有两个角色、大小关系被打破、分数和圆周率、巧合", () => {
		const make = (prompt: string, answer: string, verify: string, topic = "测试"): Question | null =>
			makeVariant({ id: "t", difficulty: "basic", kind: "numeric", prompt, answer, verify }, topic, seeded(3));
		// 8 在题里出现两次，算式里只有一次
		expect(make("8＋5 时，把 5 拆成 2 和 3，先算 8＋2。一共是多少？", "13", "8+5")).toBeNull();
		// 100 既是吨数又是百分数的 100
		expect(make("去年产量 80 吨，今年 100 吨。今年比去年增长百分之几？", "25", "(100-80)/80*100")).toBeNull();
		// 分数、圆周率
		expect(make("半径 2 厘米的圆，面积是多少平方厘米？圆周率按 314/100。", "12.56", "314/100*2*2")).toBeNull();
		// 答案 3 是数出来的，和题里的 3x 只是巧合
		expect(make("下面 5 个式子：①3x＝12　②7＋5＝12。其中是方程的有几个？", "3", "3")).toBeNull();
		// 大小关系：第几个不能超过总人数
		const rng = seeded(11);
		for (let i = 0; i < 50; i++) {
			const v = makeVariant({ id: "t", difficulty: "basic", kind: "numeric", prompt: "一队 5 个小朋友，从左数小明是第 3 个。他前面有几人？", answer: "2", verify: "3-1" }, "几和第几", rng);
			if (v) expect(Number(v.prompt.match(/第 (\d+) 个/)![1])).toBeLessThan(5);
		}
		// 不参与计算的 23 和别的数有关系
		expect(make("23 个皮球，每 5 个装一袋，装满后还剩 3 个。再拿来几个，就能再装满 1 袋？", "2", "5-3")).toBeNull();
		// 答案直接是题里的数
		expect(make("10 是由几个一组成的？", "10", "10")).toBeNull();
		// 1 不换
		for (let i = 0; i < 20; i++) {
			const v = makeVariant({ id: "t", difficulty: "basic", kind: "numeric", prompt: "老师先打电话通知 1 位同学，又来了 5 位。一共几位？", answer: "6", verify: "1+5" }, "测试", rng);
			if (v) expect(v.prompt).toContain("通知 1 位");
		}
		// “6～10各数”的范围
		for (let i = 0; i < 50; i++) {
			const v = makeVariant({ id: "t", difficulty: "basic", kind: "numeric", prompt: "7 的后面一个数是几？", answer: "8", verify: "7+1" }, "6～10各数的认识", rng);
			if (v) expect(Number(v.answer)).toBeGreaterThanOrEqual(6);
			if (v) expect(Number(v.answer)).toBeLessThanOrEqual(10);
		}
	});

	it("换数字的例子", () => {
		const q: Question = { id: "t", difficulty: "basic", kind: "numeric", prompt: "学校买来 120 本书，借出 75 本。还剩多少本？", answer: "45", verify: "120-75" };
		const v = makeVariant(q, "万以内的加法和减法", seeded(1))!;
		const [a, b] = v.prompt.match(/\d+/g)!.map(Number);
		expect(a % 10).toBe(0); // 整十还是整十
		expect(Number(v.answer)).toBe(a - b);
		expect(v.explanation).toBe(`算式：${a} － ${b} ＝ ${a - b}`);
	});
});

describe("quiz with variants", () => {
	it("复习：能换数字的题出变式题，连续两次复习优先出不同的原题", async () => {
		const { Kingdom } = await import("../src/core/kingdom");
		const { QuizSession, planFor } = await import("../src/core/quiz");
		const k = new Kingdom(data);
		const now = new Date(2026, 10, 2, 10).getTime();
		// 找一个 4 道题里有能换数字的知识点
		const id = k.order.find((t) => data.questions[t].filter((q) => canVary(q, k.topic(t).name)).length >= 2)!;
		const progress = { [id]: { stars: 3, due: now - 1 } };
		const rng = seeded(5);
		const play = () => {
			const s = new QuizSession(k, progress, id, planFor(k, progress, id, now), rng);
			while (!s.finished) s.answer(s.current!.answer);
			s.finish(k, progress, now);
			progress[id].due = now - 1; // 再到期一次
			return s.questions;
		};
		const first = play();
		const second = play();
		const base = (qs: Question[]) => qs.map((q) => q.variantOf ?? q.id).sort();
		expect(base(first)).not.toEqual(base(second));
		expect([...first, ...second].some((q) => q.variantOf)).toBe(true);
	});

	it("第一次建造用原题，失败后重试换数字", async () => {
		const { Kingdom } = await import("../src/core/kingdom");
		const { QuizSession, planFor } = await import("../src/core/quiz");
		const k = new Kingdom(data);
		const now = new Date(2026, 10, 2, 10).getTime();
		const id = k.order.find((t) => !k.prereq.get(t)!.length && data.questions[t].filter((q) => q.difficulty === "basic" && canVary(q, k.topic(t).name)).length > 0)!;
		const progress = {};
		const first = new QuizSession(k, progress, id, planFor(k, progress, id, now), seeded(2));
		expect(first.questions.every((q) => !q.variantOf)).toBe(true);
		while (!first.finished) first.answer("999999");
		first.finish(k, progress, now);
		const retry = new QuizSession(k, progress, id, planFor(k, progress, id, now), seeded(2));
		expect(retry.questions.some((q) => q.variantOf)).toBe(true);
	});
});

describe("variant cap", () => {
	it("“10以内”的中间结果也不超过 10", () => {
		const rng = seeded(9);
		for (let i = 0; i < 200; i++) {
			const v = makeVariant({ id: "c", difficulty: "basic", kind: "numeric", prompt: "有 5 支笔，又买来 3 支，送出 2 支。还剩几支？", answer: "6", verify: "5+3-2" }, "10以内加减混合", rng);
			if (!v) continue;
			const [a, b] = v.prompt.match(/\d+/g)!.map(Number);
			expect(a + b).toBeLessThanOrEqual(10);
		}
	});
});
