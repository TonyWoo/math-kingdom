// 王国规则：先修关系索引、地块状态、演示进度。不依赖 three.js 和 DOM，单元测试直接运行。
//
// 进度 progress[知识点 id]（见 TopicProgress），没有记录的知识点当作 0 星。地块状态：
//   locked  迷雾：还有 hard 先修没到 1 星
//   open    空地：可以开始建造
//   built   已建成，不用复习
//   due     该复习了（头顶问号）
//   weeds   过期 WEEDS_AFTER 以上：长草，停止生产
//   goblin  过期 GOBLIN_AFTER 以上：哥布林占领
// 星级永远不会因为没复习而减少，状态只影响画面。

import type { KingdomData, Topic } from "./types";

export const DAY = 86400_000;
export const WEEDS_AFTER = 2 * DAY;
export const GOBLIN_AFTER = 7 * DAY;
// 复习答对后下次复习的间隔（天），按累计复习成功的次数取
export const INTERVALS = [1, 3, 7, 15, 30];

export type Status = "locked" | "open" | "built" | "due" | "weeds" | "goblin";

export interface TopicProgress {
	stars: number; // 0..3
	due?: number; // 下次复习的时间（毫秒）
	reviews?: number; // 复习成功的次数
	lastStarDay?: string; // 上次得星的日期（YYYY-MM-DD，本地时间），金顶要隔天
	fails?: number; // 当前这一步连续失败的次数，成功后清零
}

export type Progress = Record<string, TopicProgress>;

export class Kingdom {
	readonly data: KingdomData;
	readonly topics = new Map<string, Topic>();
	readonly order: string[] = [];
	readonly prereq = new Map<string, string[]>(); // hard 先修
	readonly soft = new Map<string, string[]>(); // soft 先修
	readonly next = new Map<string, string[]>(); // hard 后续

	constructor(data: KingdomData) {
		this.data = data;
		for (const t of data.topics) {
			this.topics.set(t.id, t);
			this.order.push(t.id);
			this.prereq.set(t.id, []);
			this.soft.set(t.id, []);
			this.next.set(t.id, []);
		}
		for (const e of data.edges) {
			if (!this.topics.has(e.topic) || !this.topics.has(e.prereq)) {
				throw new Error(`edge with unknown topic: ${e.topic} <- ${e.prereq}`);
			}
			if (e.hard) {
				this.prereq.get(e.topic)!.push(e.prereq);
				this.next.get(e.prereq)!.push(e.topic);
			} else {
				this.soft.get(e.topic)!.push(e.prereq);
			}
		}
	}

	topic(id: string): Topic {
		const t = this.topics.get(id);
		if (!t) throw new Error(`unknown topic ${id}`);
		return t;
	}
}

export function stars(progress: Progress, id: string): number {
	return progress[id]?.stars ?? 0;
}

export function status(k: Kingdom, progress: Progress, id: string, now: number): Status {
	const p = progress[id];
	if (p && p.stars >= 1) {
		const late = p.due === undefined ? -1 : now - p.due;
		if (late >= GOBLIN_AFTER) return "goblin";
		if (late >= WEEDS_AFTER) return "weeds";
		if (late >= 0) return "due";
		return "built";
	}
	for (const pre of k.prereq.get(id)!) {
		if (stars(progress, pre) < 1) return "locked";
	}
	return "open";
}

export interface Summary {
	locked: number;
	open: number;
	built: number;
	due: number;
	weeds: number;
	goblin: number;
	stars: number;
	total: number;
}

export function summary(k: Kingdom, progress: Progress, now: number): Summary {
	const s: Summary = { locked: 0, open: 0, built: 0, due: 0, weeds: 0, goblin: 0, stars: 0, total: k.order.length };
	for (const id of k.order) {
		s[status(k, progress, id, now)]++;
		s.stars += stars(progress, id);
	}
	return s;
}

// 需要照看的地块（该复习、长草、被占领），过期最久的在前。
export function needsCare(k: Kingdom, progress: Progress, now: number): string[] {
	return k.order
		.filter((id) => {
			const st = status(k, progress, id, now);
			return st === "due" || st === "weeds" || st === "goblin";
		})
		.sort((a, b) => (progress[a].due ?? 0) - (progress[b].due ?? 0));
}

function hash(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
	}
	return h;
}

// 演示进度：一年级全部建成（一部分该复习、长草或被占领），二年级上册大部分建成，其余按先修规则显示空地或迷雾。
// 反复扫描到不再变化（教材顺序不一定是先修顺序）；只从叶子里留空地，保证不违反先修规则。
export function demoProgress(k: Kingdom, now: number): Progress {
	const progress: Progress = {};
	const wanted = (t: Topic) => t.grade === 1 || (t.grade === 2 && t.semester === "上");
	let changed = true;
	while (changed) {
		changed = false;
		for (const id of k.order) {
			if (!progress[id] && wanted(k.topic(id)) && status(k, progress, id, now) === "open") {
				progress[id] = { stars: 1 };
				changed = true;
			}
		}
	}
	for (const id of k.order) {
		if (progress[id] && k.topic(id).grade === 2 && hash(id) % 3 === 0) {
			if (k.next.get(id)!.every((n) => !progress[n])) delete progress[id];
		}
	}
	for (const id of k.order) {
		if (!progress[id]) continue;
		const t = k.topic(id);
		const h = hash(id);
		const s = t.grade === 1 ? 2 + (h % 2) : 1 + ((h >>> 4) % 2);
		let due = now + (1 + ((h >>> 8) % 10)) * DAY;
		if (t.grade === 1) {
			const r = (h >>> 12) % 10;
			if (r === 0) due = now - 9 * DAY;
			else if (r === 1) due = now - 3 * DAY;
			else if (r <= 3) due = now - 3600_000;
		}
		progress[id] = { stars: s, due, reviews: s - 1 };
	}
	return progress;
}
