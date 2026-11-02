// 方块世界的地形：地块不重叠，从王城出发每块地都走得到（每一步最多上下 1 格）。
import { describe, expect, it } from "vitest";
import raw from "../src/data/kingdom.json";
import type { KingdomData } from "../src/core/types";
import { BASE, FOOTPRINT, attackPath, buildTerrain, walkable } from "../src/voxel/terrain";

const data = raw as KingdomData;
const t = buildTerrain(data);

describe("voxel terrain", () => {
	it("每块地都在台地上，建筑之间至少隔 1 格", () => {
		expect(t.plots.size).toBe(284);
		const list = [...t.plots.values()];
		for (const p of list) {
			expect(p.h).toBe(BASE + p.grade);
			expect(t.column(p.x, p.z)!.h).toBe(p.h);
		}
		for (let i = 0; i < list.length; i++) {
			for (let j = i + 1; j < list.length; j++) {
				const gap = Math.max(Math.abs(list[i].x - list[j].x), Math.abs(list[i].z - list[j].z));
				expect(gap, `${list[i].id} ${list[j].id}`).toBeGreaterThan(FOOTPRINT * 2 + 1);
			}
		}
	});

	it("村庄广场不压在建筑上", () => {
		for (const v of t.villages) expect(t.occupied.has(t.key(v.x, v.z))).toBe(false);
	});

	it("从王城走得到每一块地的旁边，每一步最多上下 1 格", () => {
		const seen = new Set<number>([t.key(0, 0)]);
		const queue: [number, number][] = [[0, 0]];
		while (queue.length) {
			const [x, z] = queue.pop()!;
			const h = t.column(x, z)!.h;
			for (const [dx, dz] of [
				[1, 0],
				[-1, 0],
				[0, 1],
				[0, -1],
			]) {
				const nx = x + dx;
				const nz = z + dz;
				const k = t.key(nx, nz);
				if (seen.has(k) || !walkable(t, nx, nz)) continue;
				if (Math.abs(t.column(nx, nz)!.h - h) > 1) continue;
				seen.add(k);
				queue.push([nx, nz]);
			}
		}
		for (const p of t.plots.values()) {
			const r = FOOTPRINT + 1;
			let reach = false;
			for (let d = -r; d <= r && !reach; d++) {
				reach =
					seen.has(t.key(p.x + d, p.z - r)) ||
					seen.has(t.key(p.x + d, p.z + r)) ||
					seen.has(t.key(p.x - r, p.z + d)) ||
					seen.has(t.key(p.x + r, p.z + d));
			}
			expect(reach, p.id).toBe(true);
		}
	});

	it("每个村庄都有从外侧环路到广场的进攻路线（保卫战用）", () => {
		data.villages.forEach((_, i) => {
			const path = attackPath(t, i, data);
			expect(path, data.villages[i].name).not.toBeNull();
			expect(path!.length).toBeGreaterThan(2);
			for (let j = 1; j < path!.length; j++) {
				const [x0, z0] = path![j - 1];
				const [x1, z1] = path![j];
				expect(Math.abs(x1 - x0) + Math.abs(z1 - z0)).toBe(1);
				expect(Math.abs(t.column(x1, z1)!.h - t.column(x0, z0)!.h)).toBeLessThanOrEqual(1);
			}
		});
	});
});
