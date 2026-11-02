// 保卫战（第一人称小游戏）的规则：纯逻辑，不依赖画面，时间由调用方推进。
//
// 一个村庄的所有地块都到 2 星后可以开打（孩子主动开始）。红方沿小路走向村庄广场，每个敌人举着一块盾牌，
// 盾牌上写着一个数；全息面板出一道题，答案就是“目标”（走在最前面的敌人）盾牌上的数。
// 答对：防御塔打中它（要打几次看敌人种类）。答错：它往前冲一段，换一道新题。
//   骑士：普通速度，1 次；狼：跑得快，用基础题，1 次；投石车：走得慢，用标准、挑战题，2 次；
//   哥布林大王（最后一波压轴）：盾牌上是一道两步算式，要打 3 次，冲进广场算 2 个。
// 三波，越往后越快；冲进广场满 MAX_THROUGH 个就算没守住。
// 自适应：连续答对 3 题以上敌人加快一点，答错就放慢（pace 在 0.6–1.35 之间）。
// 题目只用这个村庄里学过的填数题（能换数字就用变式题），同时在场上的盾牌数字互不相同。
// 正确率达到 REVIEW_ACCURACY，村庄里所有学过的知识点都算复习了一次（星级照样不扣）。

import { DAY, INTERVALS, type Kingdom, type Progress, stars } from "./kingdom";
import { judge, parseNumbers } from "./judge";
import type { Difficulty, Question } from "./types";
import { makeVariant } from "./variant";

export const MAX_THROUGH = 3;
export const REVIEW_ACCURACY = 0.8;

export type EnemyKind = "knight" | "wolf" | "catapult" | "boss";

export const WAVES: EnemyKind[][] = [
	["knight", "knight", "knight"],
	["knight", "wolf", "knight", "wolf"],
	["wolf", "knight", "catapult", "knight", "boss"],
];

export const KIND: Record<EnemyKind, { hp: number; slow: number; through: number; name: string }> = {
	knight: { hp: 1, slow: 1, through: 1, name: "骑士" },
	wolf: { hp: 1, slow: 0.6, through: 1, name: "狼" },
	catapult: { hp: 2, slow: 1.5, through: 1, name: "投石车" },
	boss: { hp: 3, slow: 1.3, through: 2, name: "哥布林大王" },
};

const RUSH = 0.15; // 答错时目标往前冲的距离（占整条路的比例）
const KNOCK = 0.08; // 投石车、大王被打中但没倒时往后退

// 普通骑士走完整条路要几秒（实时但慢）：低年级最慢；后面的波次快一点
export function walkSeconds(grade: number, wave: number): number {
	const base = grade <= 2 ? 80 : grade <= 4 ? 60 : 48;
	return base / (1 + wave * 0.12);
}

// 两个敌人出场的间隔（秒）
function spawnGap(grade: number, wave: number): number {
	return (grade <= 2 ? 14 : grade <= 4 ? 11 : 9) - wave;
}

export interface Enemy {
	id: number;
	kind: EnemyKind;
	wave: number;
	hp: number;
	question: Question;
	topic: string; // 题目来自哪个知识点；大王的算式是 ""
	number: string; // 题目的答案
	shield: string; // 盾牌上写的：一般就是答案，大王是算式
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
	target: number | null; // 现在要答的那道题属于哪个敌人
	through: number;
	asked: number;
	correct: number;
	streak: number; // 连续答对
	misses: number; // 连续答错
	pace: number; // 自适应速度倍率
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
	| { type: "hit"; enemy: Enemy } // 打中了但还没倒（投石车、大王）
	| { type: "rush"; enemy: Enemy }
	| { type: "through"; enemy: Enemy }
	| { type: "wave"; wave: number }
	| { type: "target"; enemy: Enemy | null }
	| { type: "pace"; faster: boolean }
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

// 哥布林大王的两步算式，按年级出：一年级 20 以内加减，二年级乘加，三四年级乘减，五六年级括号乘法
export function bossQuestion(grade: number, rng: () => number): Question {
	const r = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
	let text: string;
	let answer: number;
	let how: string;
	if (grade <= 1) {
		const a = r(3, 9);
		const b = r(2, 9);
		const c = r(1, a + b - 1);
		text = `${a} ＋ ${b} － ${c}`;
		answer = a + b - c;
		how = `先算 ${a} ＋ ${b} ＝ ${a + b}，再算 ${a + b} － ${c} ＝ ${answer}`;
	} else if (grade === 2) {
		const a = r(2, 9);
		const b = r(2, 9);
		const c = r(1, 20);
		text = `${a} × ${b} ＋ ${c}`;
		answer = a * b + c;
		how = `先算乘法 ${a} × ${b} ＝ ${a * b}，再算 ${a * b} ＋ ${c} ＝ ${answer}`;
	} else if (grade <= 4) {
		const a = r(2, 9);
		const b = r(11, 30);
		const c = r(1, a * b - 1);
		text = `${a} × ${b} － ${c}`;
		answer = a * b - c;
		how = `先算乘法 ${a} × ${b} ＝ ${a * b}，再算 ${a * b} － ${c} ＝ ${answer}`;
	} else {
		const a = r(12, 60);
		const b = r(11, 40);
		const c = r(2, 9);
		text = `(${a} ＋ ${b}) × ${c}`;
		answer = (a + b) * c;
		how = `先算括号里 ${a} ＋ ${b} ＝ ${a + b}，再算 ${a + b} × ${c} ＝ ${answer}`;
	}
	return {
		id: `boss-${text}`,
		difficulty: "challenge",
		kind: "numeric",
		prompt: `哥布林大王的盾牌上写着 ${text}，等于多少？`,
		answer: String(answer),
		explanation: how,
	};
}

// 给敌人挑一道题：答案和场上其他盾牌上的数都不一样；能换数字就换
function assign(b: Battle, enemy: Enemy): void {
	// 还没出场的没有盾牌数字（number 为空），不算
	const taken = new Set(b.enemies.filter((e) => e !== enemy && e.state === "walking" && e.number).map((e) => value(e.number)));
	if (enemy.kind === "boss") {
		for (let attempt = 0; attempt < 30; attempt++) {
			const q = bossQuestion(b.grade, b.rng);
			if (taken.has(value(q.answer)) || q.answer === enemy.number) continue;
			enemy.question = q;
			enemy.topic = "";
			enemy.number = q.answer;
			enemy.shield = q.id.slice(5);
			return;
		}
	}
	// 狼用基础题；投石车用标准、挑战题（没有就用全部）
	const want: Difficulty[] | null = enemy.kind === "wolf" ? ["basic"] : enemy.kind === "catapult" ? ["standard", "challenge"] : null;
	const fitting = want ? b.pool.filter((p) => want.includes(p.question.difficulty)) : b.pool;
	const pool = fitting.length ? fitting : b.pool;
	for (let attempt = 0; attempt < 30; attempt++) {
		const pick = pool[Math.floor(b.rng() * pool.length)];
		const q = makeVariant(pick.question, b.k.topic(pick.topic).name, b.rng) ?? pick.question;
		if (taken.has(value(q.answer)) || q.answer === enemy.number) continue;
		enemy.question = q;
		enemy.topic = pick.topic;
		enemy.number = q.answer;
		enemy.shield = q.answer;
		return;
	}
	// 实在挑不出不重复的（题库很小），就随便用一道，至少换一题
	const pick = pool[Math.floor(b.rng() * pool.length)];
	enemy.question = pick.question;
	enemy.topic = pick.topic;
	enemy.number = pick.question.answer;
	enemy.shield = pick.question.answer;
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
		streak: 0,
		misses: 0,
		pace: 1,
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
	WAVES[wave].forEach((kind, i) => {
		b.enemies.push({
			id: b.nextId++,
			kind,
			wave,
			hp: KIND[kind].hp,
			question: b.pool[0].question,
			topic: b.pool[0].topic,
			number: "",
			shield: "",
			progress: 0,
			state: "waiting",
			// 大王压轴：比前面的晚一点出场
			spawnAt: b.time + delay + i * spawnGap(b.grade, wave) + (kind === "boss" ? spawnGap(b.grade, wave) : 0),
		});
	});
}

// 目标：走在最前面的敌人
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
			e.progress += (dt * b.pace) / (walkSeconds(b.grade, e.wave) * KIND[e.kind].slow);
			if (e.progress >= 1) {
				e.progress = 1;
				e.state = "through";
				b.through += KIND[e.kind].through;
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
	if (e.topic) {
		const t = (b.perTopic[e.topic] ??= { asked: 0, correct: 0 });
		t.asked++;
		if (ok) t.correct++;
	}
	const events: BattleEvent[] = [];
	if (ok) {
		b.correct++;
		b.streak++;
		b.misses = 0;
		if (b.streak >= 3 && b.pace < 1.35) {
			b.pace = Math.min(1.35, b.pace + 0.08);
			events.push({ type: "pace", faster: true });
		}
		e.hp--;
		if (e.hp <= 0) {
			e.state = "zapped";
			b.target = null;
			events.push({ type: "zap", enemy: e });
		} else {
			e.progress = Math.max(0, e.progress - KNOCK);
			assign(b, e);
			events.push({ type: "hit", enemy: e });
		}
	} else {
		b.streak = 0;
		b.misses++;
		if (b.pace > 0.6) {
			b.pace = Math.max(0.6, b.pace - 0.15);
			events.push({ type: "pace", faster: false });
		}
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

// 守住村庄的奖励装饰（按村庄序号轮流）
export const REWARDS = [
	{ id: "fountain", name: "喷泉" },
	{ id: "statue", name: "星星雕像" },
	{ id: "flowerbed", name: "花坛" },
	{ id: "bench", name: "长椅" },
	{ id: "lamp", name: "路灯" },
	{ id: "well", name: "水井" },
] as const;

export type RewardId = (typeof REWARDS)[number]["id"];

export function rewardFor(village: number): (typeof REWARDS)[number] {
	return REWARDS[village % REWARDS.length];
}
