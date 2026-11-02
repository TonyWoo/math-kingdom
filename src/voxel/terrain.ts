// 方块世界的地形数据（纯逻辑，不依赖 three.js）：把王国布局换算成方块网格，算出每一列的高度和地面种类、
// 每块地的位置、村庄广场和小路，以及哪些格子被建筑占住（走不过去）。
//
// 1 个方块 = 布局里的 BLOCK 个单位。高度：
//   海面 0，沙滩 1，王城广场和最内圈环路 BASE，年级 g 的台地 BASE + g，
//   年级 g 外侧的环路和 g 同高；放射大道和所在的台地或环路同高。
// 相邻的路面和台地最多差 1 格，所以玩家能从王城一路走到最外圈（test/voxel.test.ts 会检查）。

import { ringOf, type KingdomData, type Terrain } from "../core/types";

export const BLOCK = 20;
export const BASE = 2;
export const FOOTPRINT = 1; // 建筑占地：中心向外 1 格，即 3×3
const AVENUE = 34; // 放射大道的半宽（布局单位），和地图视角一致

export type Ground = Terrain | "road" | "castle" | "forest" | "sand";

export interface Column {
	h: number; // 顶面方块的 y（顶面在 h + 1）
	ground: Ground;
	path?: boolean; // 村庄小路，顶面画成土路
}

export interface PlotCell {
	id: string;
	x: number;
	z: number;
	h: number; // 地面高度（建筑从 h + 1 开始）
	grade: number;
}

export interface VillageCell {
	index: number;
	x: number;
	z: number;
	h: number;
}

export interface TerrainData {
	radius: number; // 岛的半径（方块）
	outer: number; // 最外圈台地的半径（方块）
	columns: Map<number, Column>;
	plots: Map<string, PlotCell>;
	villages: VillageCell[];
	key: (x: number, z: number) => number;
	column: (x: number, z: number) => Column | undefined;
	// 建筑占住的格子 → 知识点 id
	occupied: Map<number, string>;
}

const key = (x: number, z: number) => (x + 4096) * 8192 + (z + 4096);

function angleIn(a: number, a1: number, a2: number): number | null {
	let x = a;
	while (x < a1) x += Math.PI * 2;
	while (x >= a1 + Math.PI * 2) x -= Math.PI * 2;
	return x <= a2 ? Math.min(x - a1, a2 - x) : null;
}

export function buildTerrain(data: KingdomData): TerrainData {
	const rings = data.rings;
	const outerLayout = rings.at(-1)!.r2;
	const outer = Math.ceil(outerLayout / BLOCK);
	const radius = outer + 9;
	const castleR = data.castle.r;
	const columns = new Map<number, Column>();

	for (let x = -radius; x <= radius; x++) {
		for (let z = -radius; z <= radius; z++) {
			const rb = Math.hypot(x, z);
			if (rb > radius) continue;
			const r = rb * BLOCK;
			let col: Column;
			if (r < castleR) {
				col = { h: BASE, ground: "castle" };
			} else if (r > outerLayout + BLOCK * 1.5) {
				// 最外圈台地之外：一圈森林，再往外是沙滩
				col = rb > radius - 3 ? { h: 1, ground: "sand" } : { h: BASE + rings.length, ground: "forest" };
			} else {
				const a = Math.atan2(z, x);
				let sector = data.sectors[0];
				let edge = Infinity;
				for (const s of data.sectors) {
					const d = angleIn(a, s.a1, s.a2);
					if (d !== null) {
						sector = s;
						edge = d * r;
						break;
					}
				}
				const ring = rings.find((g) => r >= g.r1 && r <= g.r2);
				if (ring) {
					const h = BASE + ring.grade;
					col = edge < AVENUE ? { h, ground: "road" } : { h, ground: sector.terrain };
				} else {
					// 环路：和内侧的台地同高
					const inner = rings.filter((g) => g.r2 < r).length;
					col = { h: BASE + inner, ground: "road" };
				}
			}
			columns.set(key(x, z), col);
		}
	}

	const column = (x: number, z: number) => columns.get(key(x, z));

	// 地块：布局坐标换算成格子
	const plots = new Map<string, PlotCell>();
	const occupied = new Map<number, string>();
	for (const t of data.topics) {
		const x = Math.round(t.x / BLOCK);
		const z = Math.round(t.y / BLOCK);
		const h = BASE + t.grade;
		plots.set(t.id, { id: t.id, x, z, h, grade: t.grade });
		for (let dx = -FOOTPRINT; dx <= FOOTPRINT; dx++) {
			for (let dz = -FOOTPRINT; dz <= FOOTPRINT; dz++) {
				const c = column(x + dx, z + dz)!;
				// 地块下面统一成台地的高度和地面（有时会压到大道边上）
				c.h = h;
				if (c.ground === "road") c.ground = data.sectors.find((s) => s.domain === t.domain)!.terrain;
				occupied.set(key(x + dx, z + dz), t.id);
			}
		}
	}

	// 村庄广场（1 格）和通往每块地的小路
	const villages: VillageCell[] = data.villages.map((v, index) => {
		let x = Math.round(v.x / BLOCK);
		let z = Math.round(v.y / BLOCK);
		// 广场不能压在建筑上：往王城方向挪
		for (let i = 0; i < 6 && occupied.has(key(x, z)); i++) {
			const len = Math.hypot(x, z);
			x = Math.round(x - x / len);
			z = Math.round(z - z / len);
		}
		return { index, x, z, h: BASE + v.grade };
	});
	const mark = (x: number, z: number, h: number) => {
		const c = column(x, z);
		if (c && !occupied.has(key(x, z)) && c.h === h) c.path = true;
	};
	for (const v of villages) {
		mark(v.x, v.z, v.h);
		for (const id of data.villages[v.index].plots) {
			const p = plots.get(id)!;
			line(v.x, v.z, p.x, p.z, (x, z) => mark(x, z, v.h));
		}
	}

	return { radius, outer, columns, plots, villages, key, column, occupied };
}

// Bresenham 直线
function line(x0: number, z0: number, x1: number, z1: number, f: (x: number, z: number) => void): void {
	const dx = Math.abs(x1 - x0);
	const dz = -Math.abs(z1 - z0);
	const sx = x0 < x1 ? 1 : -1;
	const sz = z0 < z1 ? 1 : -1;
	let err = dx + dz;
	for (;;) {
		f(x0, z0);
		if (x0 === x1 && z0 === z1) break;
		const e2 = 2 * err;
		if (e2 >= dz) {
			err += dz;
			x0 += sx;
		}
		if (e2 <= dx) {
			err += dx;
			z0 += sz;
		}
	}
}

// 玩家能不能站在 (x, z) 这一格：在岛上，而且不是建筑
export function walkable(t: TerrainData, x: number, z: number): boolean {
	return t.columns.has(t.key(x, z)) && !t.occupied.has(t.key(x, z));
}

// 保卫战的进攻路线：从村庄外侧的环路（远离王城的一边）走到村庄广场的最短路，每一步最多上下 1 格，
// 不穿过建筑。blocked 是额外走不过去的格子（王城、树干）。找不到时返回 null。
export function attackPath(t: TerrainData, village: number, data: KingdomData, blocked?: Set<number>): [number, number][] | null {
	const v = t.villages[village];
	const layout = data.villages[village];
	const ring = ringOf(data, layout.grade);
	const a = Math.atan2(layout.y, layout.x);
	const r = (ring.r2 + 35) / BLOCK;
	const start: [number, number] = [Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))];
	const ok = (x: number, z: number) => walkable(t, x, z) && !blocked?.has(t.key(x, z));
	if (!ok(...start)) return null;
	const prev = new Map<number, number>();
	const goal = t.key(v.x, v.z);
	const queue: [number, number][] = [start];
	prev.set(t.key(...start), -1);
	while (queue.length) {
		const [x, z] = queue.shift()!;
		const k = t.key(x, z);
		if (k === goal) break;
		const h = t.column(x, z)!.h;
		for (const [dx, dz] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		]) {
			const nx = x + dx;
			const nz = z + dz;
			const nk = t.key(nx, nz);
			if (prev.has(nk) || !ok(nx, nz) || Math.abs(t.column(nx, nz)!.h - h) > 1) continue;
			// 不要走太远（只在村庄附近找路）
			if (Math.hypot(nx - v.x, nz - v.z) > 40) continue;
			prev.set(nk, k);
			queue.push([nx, nz]);
		}
	}
	if (!prev.has(goal)) return null;
	const path: [number, number][] = [];
	for (let k = goal; k !== -1; k = prev.get(k)!) {
		path.push([Math.floor(k / 8192) - 4096, (k % 8192) - 4096]);
	}
	return path.reverse();
}
