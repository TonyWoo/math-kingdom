// 保卫战（第一人称小游戏）的规则：纯逻辑，不依赖画面，时间由调用方推进。
//
// 一个村庄的所有地块都到 2 星后可以开打（孩子主动开始）。红方骑士沿小路走向村庄广场，
// 每个骑士举着一块写着数字的盾牌；全息面板出一道题，答案就是“目标骑士”（离广场最近的那个）盾牌上的数。
// 答对：防御塔把它打成纸屑，它跑回家。答错：它往前冲一段，换一道新题（盾牌上的数也跟着换）。
// 三波骑士，越往后越快；冲进广场的满 MAX_THROUGH 个就算没守住。
// 题目只用这个村庄里学过的填数题（能换数字就用变式题），同时在场上的盾牌数字互不相同。
// 正确率达到 REVIEW_ACCURACY，村庄里所有学过的知识点都算复习了一次（星级照样不扣）。

import { DAY, INTERVALS, type Kingdom, type Progress, stars } from "./kingdom";
import { judge, parseNumbers } from "./judge";
import type { Difficulty, Question } from "./types";
import { makeVariant } from "./variant";

export const MAX_THROUGH = 3;
export const REVIEW_ACCURACY = 0.8;
export const WAVES = [3, 4, 5]; // 每一波的骑士数
const RUSH = 0.15; // 答错时目标往前冲的距离（占整条路的比例）

// 走完整条路要几秒（实时但慢）：低年级最慢；后面的波次快一点
export function walkSeconds(grade: number, wave: number): number {
	const base = grade <= 2 ? 80 : grade <= 4 ? 60 : 48;
	return base / (1 + wave * 0.12);
}

// 两个骑士出场的间隔（秒）
function spawnGap(grade: number, wave: number): number {
	return (grade <= 2 ? 14 : grade <= 4 ? 11 : 9) - wave;
}

export interface Enemy {
	id: number;
	wave: number;
	question: Question;
	topic: string;
	number: string; // 盾牌上的数（题目的答案）
	progress: number; // 0 在村口，1 到广场
	state: "waiting" | "walking" | "zapped" | "through";
	spawnAt: number; // 出场时间（秒）
}

export interface Battle {
	village: number;
	grade: number;
	time: number;
	wave: number; // 当前波次（0 开始）
	enemies: Enemy[];
	target: number | null; // 现在要答的那道题属于哪个骑士
	through: number;
	asked: number;
	correct: number;
	perTopic: Record<string, { asked: number; correct: number }>;
	finished: boolean;
	won: boolean;
	rng: () => number;
	k: Kingdom;
	pool: { topic: string; question: Question }[];
	nextId: number;
}

export type BattleEvent =
	| { type: "spawn"; enemy: Enemy }
	| { type: "zap"; enemy: Enemy }
	| { type: "rush"; enemy: Enemy }
	| { type: "through"; enemy: Enemy }
	| { type: "wave"; wave: number }
	| { type: "target"; enemy: Enemy | null }
	| { type: "end"; won: boolean };

const ALLOWED: Record<number, Difficulty[]> = {
	2: ["basic", "standard"],
	3: ["basic", "standard", "challenge"],
};

// 村庄能不能开打：每块地都至少 2 星；返回还差的地块
export function villageReady(k: Kingdom, progress: Progress, village: number): { ready: boolean; missing: string[] } {
	const missing = k.data.villages[village].plots.filter((id) => stars(progress, id) < 2);
	return { ready: missing.length === 0, missing };
}

// 题库：村庄里每块地按星级能出的填数题
function questionPool(k: Kingdom, progress: Progress, village: number): { topic: string; question: Question }[] {
	const pool: { topic: string; question: Question }[] = [];
	for (const id of k.data.villages[village].plots) {
		const allowed = ALLOWED[Math.min(3, Math.max(2, stars(progress, id)))];
		for (const q of k.data.questions[id]) {
			if (q.kind === "numeric" && allowed.includes(q.difficulty) && parseNumbers(q.answer)?.length === 1) {
				pool.push({ topic: id, question: q });
			}
		}
	}
	return pool;
}

export function canDefend(k: Kingdom, progress: Progress, village: number): boolean {
	return villageReady(k, progress, village).ready && questionPool(k, progress, village).length > 0;
}

const value = (s: string) => parseNumbers(s)![0];

// 给骑士挑一道题：答案和场上其他盾牌上的数都不一样；能换数字就换
function assign(b: Battle, enemy: Enemy): void {
	// 还没出场的骑士没有盾牌数字（number 为空），不算
	const taken = new Set(b.enemies.filter((e) => e !== enemy && e.state === "walking" && e.number).map((e) => value(e.number)));
	for (let attempt = 0; attempt < 30; attempt++) {
		const pick = b.pool[Math.floor(b.rng() * b.pool.length)];
		const q = makeVariant(pick.question, b.k.topic(pick.topic).name, b.rng) ?? pick.question;
		if (taken.has(value(q.answer)) || q.answer === enemy.number) continue;
		enemy.question = q;
		enemy.topic = pick.topic;
		enemy.number = q.answer;
		return;
	}
	// 实在挑不出不重复的（题库很小），就用最后一道，至少换一题
	const pick = b.pool[Math.floor(b.rng() * b.pool.length)];
	enemy.question = pick.question;
	enemy.topic = pick.topic;
	enemy.number = pick.question.answer;
}

export function createBattle(k: Kingdom, progress: Progress, village: number, rng: () => number = Math.random): Battle {
	const pool = questionPool(k, progress, village);
	if (pool.length === 0) throw new Error("no numeric questions in this village");
	const b: Battle = {
		village,
		grade: k.data.villages[village].grade,
		time: 0,
		wave: 0,
		enemies: [],
		target: null,
		through: 0,
		asked: 0,
		correct: 0,
		perTopic: {},
		finished: false,
		won: false,
		rng,
		k,
		pool,
		nextId: 1,
	};
	scheduleWave(b, 0, 2);
	return b;
}

function scheduleWave(b: Battle, wave: number, delay: number): void {
	for (let i = 0; i < WAVES[wave]; i++) {
		const e: Enemy = {
			id: b.nextId++,
			wave,
			question: b.pool[0].question,
			topic: b.pool[0].topic,
			number: "",
			progress: 0,
			state: "waiting",
			spawnAt: b.time + delay + i * spawnGap(b.grade, wave),
		};
		b.enemies.push(e);
	}
}

// 目标：走在最前面的骑士
function pickTarget(b: Battle): Enemy | null {
	let best: Enemy | null = null;
	for (const e of b.enemies) if (e.state === "walking" && (!best || e.progress > best.progress)) best = e;
	return best;
}

export function current(b: Battle): Enemy | null {
	return b.enemies.find((e) => e.id === b.target) ?? null;
}

function retarget(b: Battle, events: BattleEvent[]): void {
	const t = current(b);
	if (t && t.state === "walking") return; // 正在答的题不中途换
	const next = pickTarget(b);
	const id = next?.id ?? null;
	if (id === b.target) return;
	b.target = id;
	events.push({ type: "target", enemy: next });
}

// 推进 dt 秒，返回这段时间发生的事
export function step(b: Battle, dt: number): BattleEvent[] {
	const events: BattleEvent[] = [];
	if (b.finished) return events;
	b.time += dt;
	for (const e of b.enemies) {
		if (e.state === "waiting" && b.time >= e.spawnAt) {
			e.state = "walking";
			assign(b, e);
			events.push({ type: "spawn", enemy: e });
		}
		if (e.state === "walking") {
			e.progress += dt / walkSeconds(b.grade, e.wave);
			if (e.progress >= 1) {
				e.progress = 1;
				e.state = "through";
				b.through++;
				events.push({ type: "through", enemy: e });
				if (b.target === e.id) b.target = null;
			}
		}
	}
	if (b.through >= MAX_THROUGH) return finish(b, false, events);
	const waveDone = b.enemies.every((e) => e.wave !== b.wave || e.state === "zapped" || e.state === "through");
	if (waveDone) {
		if (b.wave + 1 >= WAVES.length) return finish(b, true, events);
		b.wave++;
		scheduleWave(b, b.wave, 4);
		events.push({ type: "wave", wave: b.wave });
	}
	retarget(b, events);
	return events;
}

function finish(b: Battle, won: boolean, events: BattleEvent[]): BattleEvent[] {
	b.finished = true;
	b.won = won;
	b.target = null;
	events.push({ type: "end", won });
	return events;
}

// 回答当前目标的题
export function answer(b: Battle, input: string): { correct: boolean; enemy: Enemy; question: Question; events: BattleEvent[] } | null {
	const e = current(b);
	if (!e || b.finished) return null;
	const question = e.question;
	const ok = judge(question, input);
	b.asked++;
	const t = (b.perTopic[e.topic] ??= { asked: 0, correct: 0 });
	t.asked++;
	const events: BattleEvent[] = [];
	if (ok) {
		b.correct++;
		t.correct++;
		e.state = "zapped";
		b.target = null;
		events.push({ type: "zap", enemy: e });
	} else {
		e.progress = Math.min(0.97, e.progress + RUSH);
		assign(b, e);
		events.push({ type: "rush", enemy: e });
	}
	retarget(b, events);
	return { correct: ok, enemy: e, question, events };
}

export function accuracy(b: Battle): number {
	return b.asked ? b.correct / b.asked : 0;
}

export interface BattleResult {
	won: boolean;
	accuracy: number;
	reviewed: string[]; // 算作复习了的知识点
	weak: string[]; // 答错过的知识点
}

// 战斗结束后：正确率够了就把村庄里学过的知识点都算复习一次（推迟下次复习时间），不扣星
export function settle(b: Battle, progress: Progress, now: number): BattleResult {
	const acc = accuracy(b);
	const reviewed: string[] = [];
	if (acc >= REVIEW_ACCURACY && b.asked > 0) {
		for (const id of b.k.data.villages[b.village].plots) {
			const p = progress[id];
			if (!p || p.stars < 1) continue;
			p.reviews = (p.reviews ?? 0) + 1;
			p.due = now + INTERVALS[Math.min(p.reviews, INTERVALS.length - 1)] * DAY;
			reviewed.push(id);
		}
	}
	const weak = Object.entries(b.perTopic)
		.filter(([, s]) => s.correct < s.asked)
		.map(([id]) => id);
	return { won: b.won, accuracy: acc, reviewed, weak };
}
