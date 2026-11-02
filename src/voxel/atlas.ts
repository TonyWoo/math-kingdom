// 方块贴图：启动时用代码画 16×16 的像素图，拼成一张 8×8 格的贴图集（128×128），最近邻采样。
// 全部是原创图案（噪点、砖缝、木纹等），不使用任何现成游戏的贴图。

import * as THREE from "three";

export const TILES = [
	"grass_top", "grass_side", "dirt", "stone", "cobble", "path", "sand", "planks",
	"log_side", "log_top", "leaves", "wall", "cream", "brick", "roof_red", "roof_blue",
	"gold", "water", "cloud", "wool_red", "wool_white", "wool_blue", "wool_orange", "pillar",
	"hill_top", "hill_side", "coast_top", "coast_side", "fair_top", "fair_side", "glow", "goblin",
	"dark", "door", "window", "castle_top", "flower", "pink_leaves", "wool_yellow", "weeds",
] as const;

export type Tile = (typeof TILES)[number];

const SIZE = 16;
const GRID = 8;

// 确定性的伪随机（同一个贴图每次画出来一样）
function rng(seed: number): () => number {
	let s = seed >>> 0 || 1;
	return () => {
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		return ((s >>> 0) % 1000) / 1000;
	};
}

type Px = (x: number, y: number, r: () => number) => [number, number, number];

const hex = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const shade = (c: number, k: number): [number, number, number] => hex(c).map((v) => Math.max(0, Math.min(255, Math.round(v * k)))) as [number, number, number];
const noise = (c: number, amt = 0.12): Px => (_x, _y, r) => shade(c, 1 - amt + r() * amt * 2);

// 顶部几行是草（或花草），下面是泥土
const sideOf = (top: number, dirt = 0x8a5a36): Px => (x, y, r) => {
	const depth = 3 + ((x * 7) % 3 === 0 ? 1 : 0);
	return y < depth ? shade(top, 0.88 + r() * 0.2) : shade(dirt, 0.85 + r() * 0.25);
};

const bricks = (c: number, mortar: number, h = 4, w = 8): Px => (x, y, r) => {
	const row = Math.floor(y / h);
	const off = row % 2 ? w / 2 : 0;
	if (y % h === h - 1 || (x + off) % w === 0) return hex(mortar);
	return shade(c, 0.9 + r() * 0.18);
};

const tiles = (c: number, dark: number): Px => (x, y, r) => {
	const row = Math.floor(y / 4);
	if (y % 4 === 3) return hex(dark);
	if ((x + row * 2) % 8 === 0) return hex(dark);
	return shade(c, 0.92 + r() * 0.14 - (y % 4) * 0.03);
};

const DRAW: Record<Tile, Px> = {
	grass_top: noise(0x6fbf45, 0.15),
	grass_side: sideOf(0x6fbf45),
	dirt: noise(0x8a5a36, 0.15),
	stone: noise(0x9a9a9a, 0.12),
	cobble: (x, y, r) => {
		const cell = ((Math.floor(x / 5) * 3 + Math.floor((y + (Math.floor(x / 5) % 2) * 2) / 4)) * 37) % 5;
		const edge = x % 5 === 0 || (y + (Math.floor(x / 5) % 2) * 2) % 4 === 0;
		return edge ? hex(0x5e5e5e) : shade(0x8e8e8e, 0.85 + cell * 0.06 + r() * 0.08);
	},
	path: (_x, _y, r) => (r() < 0.12 ? shade(0x9c8a64, 0.9) : shade(0xc8a96b, 0.92 + r() * 0.12)),
	sand: noise(0xe9d59a, 0.08),
	planks: (x, y, r) => (y % 4 === 3 || (y % 8 < 4 ? x === 5 : x === 12) ? hex(0x7a5530) : shade(0xb88a52, 0.92 + r() * 0.12)),
	log_side: (x, _y, r) => shade(0x6b4a2b, x % 4 === 0 ? 0.75 : 0.95 + r() * 0.1),
	log_top: (x, y) => {
		const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
		return d > 6.5 ? hex(0x6b4a2b) : shade(0xc49a62, Math.floor(d) % 2 ? 0.88 : 1);
	},
	leaves: (_x, _y, r) => (r() < 0.2 ? shade(0x2f6e2a, 0.8) : shade(0x3f8f37, 0.85 + r() * 0.25)),
	wall: bricks(0xf3ead8, 0xd8ccb2, 4, 8),
	cream: noise(0xf6e7c1, 0.06),
	brick: bricks(0xb4523e, 0xd9c7b0, 4, 8),
	roof_red: tiles(0xd9534a, 0x8e2f2a),
	roof_blue: tiles(0x4a7fd8, 0x2a4f94),
	gold: (x, y, r) => (x + y < 6 || (x === y && x < 10) ? hex(0xfff3a0) : shade(0xf2c230, 0.9 + r() * 0.12)),
	water: (x, y, r) => ((x + y * 2) % 7 === 0 ? hex(0x8fdcff) : shade(0x3b9ee0, 0.92 + r() * 0.1)),
	cloud: noise(0xffffff, 0.04),
	wool_red: noise(0xd9534a, 0.06),
	wool_white: noise(0xf4f4f4, 0.05),
	wool_blue: noise(0x4a7fd8, 0.06),
	wool_orange: noise(0xf28c28, 0.08),
	pillar: (x, _y, r) => shade(0xfaf6ee, x % 5 === 0 ? 0.82 : 0.96 + r() * 0.04),
	hill_top: (_x, _y, r) => (r() < 0.25 ? shade(0x9fae5c, 0.95) : shade(0xd2bd86, 0.9 + r() * 0.15)),
	hill_side: sideOf(0xb8b070, 0xa89070),
	coast_top: noise(0x6cc9a8, 0.12),
	coast_side: sideOf(0x6cc9a8, 0xc9b98a),
	fair_top: (_x, _y, r) => {
		const v = r();
		if (v < 0.08) return hex(0xfff2f6);
		if (v < 0.16) return hex(0xf25c8a);
		return shade(0x8fcf63, 0.88 + r() * 0.2);
	},
	fair_side: sideOf(0x8fcf63),
	glow: (x, y) => (x === 0 || y === 0 || x === 15 || y === 15 ? hex(0xffb020) : hex(0xffe066)),
	goblin: noise(0x6cc24a, 0.1),
	dark: noise(0x2a2a2a, 0.1),
	door: (x, y, r) => (x === 0 || x === 15 || y === 0 ? hex(0x4a3220) : x === 12 && y === 8 ? hex(0xf2c230) : shade(0x8a5a30, 0.92 + r() * 0.1)),
	window: (x, y) => (x === 0 || y === 0 || x === 15 || y === 15 || x === 7 || x === 8 || y === 7 || y === 8 ? hex(0x7a5530) : y < 7 && x < 7 ? hex(0xd8f2ff) : hex(0x9fd6f0)),
	castle_top: (x, y, r) => ((x % 8 === 0 || y % 8 === 0) ? hex(0x9a96a8) : shade(0xc7c2d6, 0.92 + r() * 0.1)),
	flower: (x, y, r) => {
		const d = Math.hypot(x - 7.5, y - 7.5);
		if (d < 2) return hex(0xffd23f);
		if (d < 5) return hex(0xf25c8a);
		return shade(0x6fbf45, 0.9 + r() * 0.15);
	},
	pink_leaves: (_x, _y, r) => (r() < 0.2 ? shade(0xe08aac, 0.85) : shade(0xf6b3cc, 0.9 + r() * 0.15)),
	wool_yellow: noise(0xf2d23a, 0.06),
	weeds: (_x, _y, r) => (r() < 0.3 ? shade(0x24561f, 0.9) : shade(0x3a7a2a, 0.85 + r() * 0.2)),
};

export interface Atlas {
	texture: THREE.Texture;
	// 一格贴图的 UV 范围 [u0, v0, u1, v1]（v 向上）
	uv: (tile: Tile) => [number, number, number, number];
}

export function createAtlas(): Atlas {
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = SIZE * GRID;
	const ctx = canvas.getContext("2d")!;
	const img = ctx.createImageData(canvas.width, canvas.height);
	TILES.forEach((name, i) => {
		const tx = (i % GRID) * SIZE;
		const ty = Math.floor(i / GRID) * SIZE;
		const r = rng(i * 7919 + 17);
		for (let y = 0; y < SIZE; y++) {
			for (let x = 0; x < SIZE; x++) {
				const [cr, cg, cb] = DRAW[name](x, y, r);
				const o = ((ty + y) * canvas.width + tx + x) * 4;
				img.data[o] = cr;
				img.data[o + 1] = cg;
				img.data[o + 2] = cb;
				img.data[o + 3] = 255;
			}
		}
	});
	ctx.putImageData(img, 0, 0);
	const texture = new THREE.CanvasTexture(canvas);
	texture.magFilter = THREE.NearestFilter;
	texture.minFilter = THREE.NearestFilter;
	texture.generateMipmaps = false;
	texture.colorSpace = THREE.SRGBColorSpace;
	const index = new Map<Tile, number>(TILES.map((t, i) => [t, i]));
	// 往里收半个像素，避免采样到相邻的格子
	const eps = 0.5 / canvas.width;
	return {
		texture,
		uv: (tile) => {
			const i = index.get(tile)!;
			const u0 = (i % GRID) / GRID;
			const v1 = 1 - Math.floor(i / GRID) / GRID;
			return [u0 + eps, v1 - 1 / GRID + eps, u0 + 1 / GRID - eps, v1 - eps];
		},
	};
}
