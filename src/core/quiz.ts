// 答题流程：一块地现在该做什么（建造哪一步、复习、练习），出哪几道题，答完怎么改进度。
//
// 每个知识点有 4 道题：2 道基础、1 道标准、1 道挑战。建造分三步，每步一次答题：
//   打地基（→ 1 星）：2 道基础题全对
//   盖房子（→ 2 星）：标准题答对
//   金顶  （→ 3 星）：挑战题答对，而且和上一颗星不在同一天（隔天还会，才算真的掌握）
// 复习：从已经解锁难度的题里抽 2 道，全对就把下次复习往后推（INTERVALS），答错不扣星，只是还要再复习。
// 同一步连续失败 2 次，提示先巩固没学牢的 hard 先修（寻根）。

import { DAY, INTERVALS, type Kingdom, type Progress, status, stars } from "./kingdom";
import { judge } from "./judge";
import type { Difficulty, Question } from "./types";

export type Plan =
	| { kind: "locked"; missing: string[] }
	| { kind: "build"; stage: 1 | 2 | 3 }
	| { kind: "wait"; stage: 3 }
	| { kind: "review" }
	| { kind: "practice" };

// 本地日期，YYYY-MM-DD
export function dayOf(now: number): string {
	const d = new Date(now);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function planFor(k: Kingdom, progress: Progress, id: string, now: number): Plan {
	const st = status(k, progress, id, now);
	if (st === "locked") {
		return { kind: "locked", missing: k.prereq.get(id)!.filter((p) => stars(progress, p) < 1) };
	}
	if (st === "due" || st === "weeds" || st === "goblin") return { kind: "review" };
	const s = stars(progress, id);
	if (s === 0) return { kind: "build", stage: 1 };
	if (s === 1) return { kind: "build", stage: 2 };
	if (s === 2) {
		return progress[id]?.lastStarDay === dayOf(now) ? { kind: "wait", stage: 3 } : { kind: "build", stage: 3 };
	}
	return { kind: "practice" };
}

const ALLOWED: Record<number, Difficulty[]> = {
	1: ["basic"],
	2: ["basic", "standard"],
	3: ["basic", "standard", "challenge"],
};

function shuffle<T>(list: T[], rng: () => number): T[] {
	const out = list.slice();
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

// 这次答题要出的题。
export function questionsFor(k: Kingdom, progress: Progress, id: string, plan: Plan, rng = Math.random): Question[] {
	const all = k.data.questions[id];
	const of = (d: Difficulty) => all.filter((q) => q.difficulty === d);
	switch (plan.kind) {
		case "build":
			if (plan.stage === 1) return shuffle(of("basic"), rng);
			return of(plan.stage === 2 ? "standard" : "challenge").slice(0, 1);
		case "review":
		case "practice": {
			const allowed = ALLOWED[Math.max(1, stars(progress, id))];
			return shuffle(
				all.filter((q) => allowed.includes(q.difficulty)),
				rng,
			).slice(0, 2);
		}
		default:
			return [];
	}
}

export interface Outcome {
	success: boolean;
	starsBefore: number;
	starsAfter: number;
	// 连续失败 2 次时，建议先巩固的先修（星少的在前）
	roots: string[];
}

// 一次答题会话：按顺序答完所有题，全对才算成功。答错会显示讲解，但不提前结束。
export class QuizSession {
	readonly id: string;
	readonly plan: Plan;
	readonly questions: Question[];
	readonly results: boolean[] = [];

	constructor(k: Kingdom, progress: Progress, id: string, plan: Plan, rng = Math.random) {
		this.id = id;
		this.plan = plan;
		this.questions = questionsFor(k, progress, id, plan, rng);
	}

	get index(): number {
		return this.results.length;
	}

	get current(): Question | undefined {
		return this.questions[this.index];
	}

	get finished(): boolean {
		return this.index >= this.questions.length;
	}

	answer(input: string): boolean {
		const q = this.current;
		if (!q) throw new Error("session finished");
		const ok = judge(q, input);
		this.results.push(ok);
		return ok;
	}

	// 答完之后更新进度（直接修改 progress），返回结果。
	finish(k: Kingdom, progress: Progress, now: number): Outcome {
		if (!this.finished) throw new Error("session not finished");
		const success = this.results.every((r) => r);
		const before = stars(progress, this.id);
		const p = (progress[this.id] ??= { stars: 0 });
		let roots: string[] = [];
		if (this.plan.kind === "build") {
			if (success) {
				p.stars = this.plan.stage;
				p.lastStarDay = dayOf(now);
				p.fails = 0;
				p.due = now + INTERVALS[Math.min(p.reviews ?? 0, INTERVALS.length - 1)] * DAY;
			} else {
				p.fails = (p.fails ?? 0) + 1;
				if (p.fails >= 2) {
					roots = k.prereq
						.get(this.id)!
						.slice()
						.sort((a, b) => stars(progress, a) - stars(progress, b));
				}
			}
		} else if (this.plan.kind === "review") {
			if (success) {
				p.reviews = (p.reviews ?? 0) + 1;
				p.due = now + INTERVALS[Math.min(p.reviews, INTERVALS.length - 1)] * DAY;
				p.fails = 0;
			} else {
				p.fails = (p.fails ?? 0) + 1;
			}
		}
		if (p.stars === 0 && !p.fails) delete progress[this.id];
		return { success, starsBefore: before, starsAfter: stars(progress, this.id), roots };
	}
}
