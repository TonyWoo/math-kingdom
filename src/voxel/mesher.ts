// 把方块拼成网格：每个面一个四边形，贴图取自贴图集，颜色按朝向打一点明暗（顶面最亮、底面最暗），
// 不用光照，看起来就是方块世界的样子。两个实心方块贴在一起的面不画。

import * as THREE from "three";
import type { Atlas, Tile } from "./atlas";

export interface BlockDef {
	top: Tile;
	side: Tile;
	bottom: Tile;
	front?: Tile; // +Z 那一面（门、窗）
}

const same = (t: Tile): BlockDef => ({ top: t, side: t, bottom: t });

export const BLOCKS = {
	grass: { top: "grass_top", side: "grass_side", bottom: "dirt" },
	dirt: same("dirt"),
	stone: same("stone"),
	cobble: same("cobble"),
	path: { top: "path", side: "dirt", bottom: "dirt" },
	sand: same("sand"),
	planks: same("planks"),
	log: { top: "log_top", side: "log_side", bottom: "log_top" },
	leaves: same("leaves"),
	pink_leaves: same("pink_leaves"),
	wall: same("wall"),
	cream: same("cream"),
	brick: same("brick"),
	roof_red: same("roof_red"),
	roof_blue: same("roof_blue"),
	gold: same("gold"),
	water: same("water"),
	cloud: same("cloud"),
	wool_red: same("wool_red"),
	wool_white: same("wool_white"),
	wool_blue: same("wool_blue"),
	wool_orange: same("wool_orange"),
	wool_yellow: same("wool_yellow"),
	pillar: same("pillar"),
	glow: same("glow"),
	goblin: same("goblin"),
	dark: same("dark"),
	weeds: same("weeds"),
	door: { top: "planks", side: "planks", bottom: "planks", front: "door" },
	window_wall: { top: "wall", side: "window", bottom: "wall" },
	window_cream: { top: "cream", side: "window", bottom: "cream" },
	castle_floor: { top: "castle_top", side: "cobble", bottom: "cobble" },
	flower: { top: "flower", side: "grass_side", bottom: "dirt" },
} satisfies Record<string, BlockDef>;

export type BlockType = keyof typeof BLOCKS;

// 一个方块或长方体：[x0, y0, z0, x1, y1, z1]；整格方块 x1 = x0 + 1
export interface Box {
	min: [number, number, number];
	max: [number, number, number];
	type: BlockType;
}

export const block = (x: number, y: number, z: number, type: BlockType): Box => ({
	min: [x, y, z],
	max: [x + 1, y + 1, z + 1],
	type,
});

// 六个面：法线、四个角（按逆时针，从外面看）、明暗
const FACES = [
	{ dir: [1, 0, 0], shade: 0.78, corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
	{ dir: [-1, 0, 0], shade: 0.72, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
	{ dir: [0, 1, 0], shade: 1.0, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
	{ dir: [0, -1, 0], shade: 0.55, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
	{ dir: [0, 0, 1], shade: 0.9, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
	{ dir: [0, 0, -1], shade: 0.66, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
] as const;

export type FaceIndex = 0 | 1 | 2 | 3 | 4 | 5;
export const FACE = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 } as const;

export class MeshBuilder {
	private pos: number[] = [];
	private uv: number[] = [];
	private col: number[] = [];
	private idx: number[] = [];
	private atlas: Atlas;

	constructor(atlas: Atlas) {
		this.atlas = atlas;
	}

	get empty(): boolean {
		return this.idx.length === 0;
	}

	// 长方体 [min, max] 的一个面，贴整格贴图（小零件也用整格，像素会被放大或缩小）
	face(min: readonly number[], max: readonly number[], f: FaceIndex, tile: Tile, light = 1): void {
		const face = FACES[f];
		const base = this.pos.length / 3;
		for (const c of face.corners) {
			this.pos.push(c[0] ? max[0] : min[0], c[1] ? max[1] : min[1], c[2] ? max[2] : min[2]);
		}
		const [u0, v0, u1, v1] = this.atlas.uv(tile);
		this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
		const s = face.shade * light;
		for (let i = 0; i < 4; i++) this.col.push(s, s, s);
		this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
	}

	box(b: Box, skip?: (f: FaceIndex) => boolean): void {
		const def: BlockDef = BLOCKS[b.type];
		for (let f = 0 as FaceIndex; f < 6; f = (f + 1) as FaceIndex) {
			if (skip?.(f)) continue;
			const tile = f === FACE.py ? def.top : f === FACE.ny ? def.bottom : f === FACE.pz && def.front ? def.front : def.side;
			this.face(b.min, b.max, f, tile);
		}
	}

	// 一组方块：整格方块之间互相挡住的面不画
	boxes(list: Box[], offset: [number, number, number] = [0, 0, 0]): void {
		const solid = new Set<string>();
		const isCell = (b: Box) =>
			b.max[0] - b.min[0] === 1 && b.max[1] - b.min[1] === 1 && b.max[2] - b.min[2] === 1 && Number.isInteger(b.min[0]) && Number.isInteger(b.min[1]) && Number.isInteger(b.min[2]);
		for (const b of list) if (isCell(b) && b.type !== "leaves" && b.type !== "pink_leaves") solid.add(b.min.join(","));
		for (const b of list) {
			const moved: Box = {
				type: b.type,
				min: [b.min[0] + offset[0], b.min[1] + offset[1], b.min[2] + offset[2]],
				max: [b.max[0] + offset[0], b.max[1] + offset[1], b.max[2] + offset[2]],
			};
			if (!isCell(b)) {
				this.box(moved);
				continue;
			}
			this.box(moved, (f) => {
				const d = FACES[f].dir;
				return solid.has(`${b.min[0] + d[0]},${b.min[1] + d[1]},${b.min[2] + d[2]}`);
			});
		}
	}

	build(): THREE.BufferGeometry {
		const g = new THREE.BufferGeometry();
		g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
		g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
		g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
		g.setIndex(this.idx);
		g.computeBoundingSphere();
		g.computeBoundingBox();
		return g;
	}
}
