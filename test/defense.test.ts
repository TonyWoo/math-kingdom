// 保卫战规则：开打条件、出场和行走、答对答错、盾牌数字不重复、胜负和复习结算。
import { describe, expect, it } from "vitest";
import raw from "../src/data/kingdom.json";
import { MAX_THROUGH, WAVES, accuracy, answer, canDefend, createBattle, current, settle, step, villageReady, walkSeconds } from "../src/core/defense";
import { DAY, Kingdom, type Progress } from "../src/core/kingdom";
import { parseNumbers } from "../src/core/judge";
import type { KingdomData } from "../src/core/types";

const data = raw as KingdomData;
const k = new Kingdom(data);
const NOW = new Date(2026, 10, 2, 10).getTime();

function seeded(seed: number): () => number {
	let s = seed >>> 0 || 1;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}

// 一个有填数题的村庄，所有地块 2 星
const village = data.villages.findIndex((v, i) => v.plots.length >= 3 && canDefend(k, Object.fromEntries(v.plots.map((id) => [id, { stars: 2, due: NOW + DAY }])), i));
const fullProgress = (): Progress => Object.fromEntries(data.villages[village].plots.map((id) => [id, { stars: 2, due: NOW + DAY }]));

describe("defense", () => {
	it("全部 2 星才能开打", () => {
		const v = data.villages[village];
		const p = fullProgress();
		expect(villageReady(k, p, village).ready).toBe(true);
		p[v.plots[0]].stars = 1;
		expect(villageReady(k, p, village)).toEqual({ ready: false, missing: [v.plots[0]] });
	});

	it("低年级走得最慢，后面的波次快一点", () => {
		expect(walkSeconds(1, 0)).toBeGreaterThan(walkSeconds(5, 0));
		expect(walkSeconds(2, 2)).toBeLessThan(walkSeconds(2, 0));
	});

	it("骑士按时出场、往前走；场上盾牌数字互不相同", () => {
		const b = createBattle(k, fullProgress(), village, seeded(1));
		expect(b.enemies.length).toBe(WAVES[0]);
		for (let t = 0; t < 40; t++) {
			step(b, 1);
			const nums = b.enemies.filter((e) => e.state === "walking").map((e) => parseNumbers(e.number)![0]);
			expect(new Set(nums).size).toBe(nums.length);
		}
		expect(b.enemies.some((e) => e.state === "walking" && e.progress > 0)).toBe(true);
		expect(current(b)).not.toBeNull();
	});

	it("答对打倒目标；答错目标往前冲并换一道题", () => {
		const b = createBattle(k, fullProgress(), village, seeded(2));
		step(b, 3);
		const t = current(b)!;
		const before = t.progress;
		const oldQuestion = t.question.prompt;
		const wrong = answer(b, "999999")!;
		expect(wrong.correct).toBe(false);
		expect(t.progress).toBeGreaterThan(before);
		expect(t.state).toBe("walking");
		expect(t.question.prompt === oldQuestion && t.number === wrong.question.answer).toBe(false);
		const target = current(b)!;
		const right = answer(b, target.number)!;
		expect(right.correct).toBe(true);
		expect(target.state).toBe("zapped");
	});

	it("全部答对就守住；没人答题就被冲破", () => {
		const win = createBattle(k, fullProgress(), village, seeded(3));
		for (let i = 0; i < 2000 && !win.finished; i++) {
			step(win, 0.5);
			const t = current(win);
			if (t) answer(win, t.number);
		}
		expect(win.finished).toBe(true);
		expect(win.won).toBe(true);
		expect(accuracy(win)).toBe(1);
		expect(win.correct).toBe(WAVES.reduce((a, b) => a + b, 0));

		const lose = createBattle(k, fullProgress(), village, seeded(4));
		for (let i = 0; i < 2000 && !lose.finished; i++) step(lose, 0.5);
		expect(lose.won).toBe(false);
		expect(lose.through).toBe(MAX_THROUGH);
	});

	it("正确率够了算一次复习（推迟复习时间，不改星级）；不够就不算", () => {
		const p = fullProgress();
		const b = createBattle(k, p, village, seeded(5));
		for (let i = 0; i < 2000 && !b.finished; i++) {
			step(b, 0.5);
			const t = current(b);
			if (t) answer(b, t.number);
		}
		const r = settle(b, p, NOW);
		expect(r.reviewed.length).toBe(data.villages[village].plots.length);
		for (const id of data.villages[village].plots) {
			expect(p[id].stars).toBe(2);
			expect(p[id].due!).toBeGreaterThan(NOW + DAY);
		}

		const p2 = fullProgress();
		const bad = createBattle(k, p2, village, seeded(6));
		for (let i = 0; i < 2000 && !bad.finished; i++) {
			step(bad, 0.5);
			if (current(bad)) answer(bad, "999999");
		}
		const r2 = settle(bad, p2, NOW);
		expect(r2.reviewed).toEqual([]);
		expect(r2.weak.length).toBeGreaterThan(0);
		expect(p2[data.villages[village].plots[0]].due).toBe(NOW + DAY);
	});
});
