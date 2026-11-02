// 方块建筑的“图纸”：坐标以地块中心为原点，x、z 在 -1..1（3×3 占地），y = 0 是地面上的第一层。
// 方块的 min 角在 (x, y, z)，所以 3×3 的建筑占 x ∈ [-1, 2)，场景放置时再整体平移 -0.5 让它居中。
// 会动的零件（风车叶片、旗子、光圈、哥布林）单独返回，场景每帧转动或晃动。

import type { Building } from "../core/types";
import type { Animal } from "../scene/teachers";
import { type BlockType, type Box, block } from "./mesher";

export interface Part {
	boxes: Box[];
	pivot: [number, number, number]; // 零件的旋转中心（相对地块）
	anim: "spin" | "wave" | "pulse" | "bob";
}

export interface Structure {
	boxes: Box[];
	parts: Part[];
	top: number; // 最高点（放提示气泡用）
}

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, type: BlockType): Box => ({
	min: [x0, y0, z0],
	max: [x1, y1, z1],
	type,
});

function fill(out: Box[], x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, type: BlockType): void {
	for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) out.push(block(x, y, z, type));
}

const top = (boxes: Box[]) => boxes.reduce((m, b) => Math.max(m, b.max[1]), 0);

// 1 星：地基、四角立柱和横梁，中间露出一点将来建筑的材料
function foundation(type: Building): Structure {
	const b: Box[] = [];
	fill(b, -1, 1, 0, 0, -1, 1, "cobble");
	for (const x of [-1, 1]) for (const z of [-1, 1]) b.push(box(x + 0.35, 1, z + 0.35, x + 0.65, 3, z + 0.65, "log"));
	b.push(box(-1, 2.7, -0.7, 2, 3, -0.4, "planks"), box(-1, 2.7, 1.4, 2, 3, 1.7, "planks"));
	const hint: Record<Building, BlockType> = { mill: "wall", library: "cream", watchtower: "stone", market: "wool_red", plaza: "water" };
	b.push(block(0, 1, 0, hint[type]));
	b.push(box(-0.9, 1, 1.2, 0.1, 1.35, 1.8, "planks"));
	return { boxes: b, parts: [], top: top(b) };
}

function pennant(s: Structure): void {
	const y = s.top;
	s.boxes.push(box(0.4, y, 0.4, 0.6, y + 1.3, 0.6, "log"));
	s.parts.push({ boxes: [box(0, -0.25, -0.05, 0.6, 0.15, 0.05, "gold")], pivot: [0.6, y + 1.05, 0.5], anim: "wave" });
	s.top = y + 1.3;
}

function mill(level: number): Structure {
	const roof: BlockType = level >= 3 ? "gold" : "roof_red";
	const b: Box[] = [];
	fill(b, -1, 1, 0, 2, -1, 1, "wall");
	b.push(block(0, 0, 1, "door"), block(-1, 1, 0, "window_wall"), block(1, 1, 0, "window_wall"));
	fill(b, -1, 1, 3, 3, -1, 1, roof);
	b.push(block(0, 4, 0, roof));
	// 叶片：十字，绕 Z 轴转，装在正面
	const blades: Box[] = [box(-0.2, -1.7, 0, 0.2, 1.7, 0.15, "wool_white"), box(-1.7, -0.2, 0, 1.7, 0.2, 0.15, "wool_white"), box(-0.25, -0.25, -0.05, 0.25, 0.25, 0.2, "log")];
	const s: Structure = { boxes: b, parts: [{ boxes: blades, pivot: [0.5, 2.6, 2.05], anim: "spin" }], top: 5 };
	if (level >= 3) {
		fill(b, -2, -2, 0, 0, -1, 1, "flower");
		pennant(s);
	}
	return s;
}

function library(level: number): Structure {
	const roof: BlockType = level >= 3 ? "gold" : "roof_blue";
	const b: Box[] = [];
	fill(b, -1, 1, 0, 2, -1, 0, "cream");
	b.push(block(-1, 0, 1, "pillar"), block(-1, 1, 1, "pillar"), block(1, 0, 1, "pillar"), block(1, 1, 1, "pillar"));
	b.push(block(0, 0, 1, "door"), block(0, 1, 1, "window_cream"), block(-1, 2, 1, "cream"), block(0, 2, 1, "cream"), block(1, 2, 1, "cream"));
	fill(b, -1, 1, 3, 3, -1, 1, roof);
	fill(b, -1, 1, 4, 4, 0, 0, roof);
	const s: Structure = { boxes: b, parts: [], top: 5 };
	if (level >= 3) pennant(s);
	return s;
}

function watchtower(level: number): Structure {
	const roof: BlockType = level >= 3 ? "gold" : "roof_red";
	const b: Box[] = [];
	fill(b, -1, 1, 0, 0, -1, 1, "cobble");
	fill(b, 0, 0, 1, 3, 0, 0, "stone");
	b.push(block(0, 1, 1, "door"));
	fill(b, -1, 1, 4, 4, -1, 1, "planks");
	for (const x of [-1, 1]) for (const z of [-1, 1]) b.push(box(x + 0.4, 5, z + 0.4, x + 0.6, 5.6, z + 0.6, "log"));
	fill(b, -1, 1, 6, 6, -1, 1, roof);
	b.push(block(0, 7, 0, roof));
	const s: Structure = { boxes: b, parts: [], top: 8 };
	if (level >= 3) pennant(s);
	return s;
}

function market(level: number): Structure {
	const [a, c]: BlockType[] = level >= 3 ? ["gold", "wool_yellow"] : ["wool_red", "wool_white"];
	const b: Box[] = [];
	fill(b, -1, 1, 0, 0, -1, -1, "planks");
	b.push(block(-1, 0, 1, "planks"), block(1, 0, 1, "planks"));
	b.push(box(-0.8, 1, -0.8, -0.2, 1.4, -0.2, "wool_orange"), box(0.2, 1, -0.8, 0.8, 1.4, -0.2, "leaves"), box(1.2, 1, -0.8, 1.8, 1.4, -0.2, "wool_yellow"));
	for (const x of [-1, 1]) for (const z of [-1, 1]) b.push(box(x + 0.4, 1, z + 0.4, x + 0.6, 2, z + 0.6, "log"));
	for (let x = -1; x <= 1; x++) b.push(box(x, 2, -1, x + 1, 2.4, 2, x === 0 ? c : a));
	const s: Structure = { boxes: b, parts: [], top: 2.4 };
	if (level >= 3) pennant(s);
	return s;
}

function plaza(level: number): Structure {
	const b: Box[] = [];
	b.push(box(-1, 0, -1, 2, 0.5, 2, "cobble"));
	b.push(box(-0.3, 0.5, -0.3, 1.3, 1, 1.3, "stone"), box(-0.1, 0.9, -0.1, 1.1, 1.05, 1.1, "water"));
	b.push(box(0.3, 1, 0.3, 0.7, 1.8, 0.7, "pillar"));
	b.push(box(1.4, 0.5, -0.6, 1.6, 3.6, -0.4, "log"));
	const flag: BlockType = level >= 3 ? "gold" : "wool_blue";
	const s: Structure = {
		boxes: b,
		parts: [{ boxes: [box(0, -0.35, -0.05, 0.9, 0.25, 0.05, flag)], pivot: [1.6, 3.25, -0.5], anim: "wave" }],
		top: 3.6,
	};
	if (level >= 3) {
		b.push(box(-0.9, 0.5, 1.2, -0.3, 0.9, 1.8, "flower"), box(1.3, 0.5, 1.2, 1.9, 0.9, 1.8, "flower"));
	}
	return s;
}

const BUILD: Record<Building, (level: number) => Structure> = { mill, library, watchtower, market, plaza };

export function buildingStructure(type: Building, stars: number): Structure {
	if (stars <= 1) return foundation(type);
	return BUILD[type](stars);
}

// 空地：告示牌，地上一圈会呼吸的光框
export function openStructure(): Structure {
	const b: Box[] = [box(0.4, 0, 0.4, 0.6, 1.3, 0.6, "log"), box(-0.1, 0.8, 0.45, 1.1, 1.4, 0.6, "planks")];
	const t = 0.12;
	const ring: Box[] = [
		box(-1.5, 0, -1.5, 1.5, 0.08, -1.5 + t, "glow"),
		box(-1.5, 0, 1.5 - t, 1.5, 0.08, 1.5, "glow"),
		box(-1.5, 0, -1.5, -1.5 + t, 0.08, 1.5, "glow"),
		box(1.5 - t, 0, -1.5, 1.5, 0.08, 1.5, "glow"),
	];
	return { boxes: b, parts: [{ boxes: ring, pivot: [0.5, 0.02, 0.5], anim: "pulse" }], top: 1.4 };
}

// 长草：建筑四角外面几丛
export function weedsStructure(): Structure {
	const b: Box[] = [];
	for (const [x, z] of [
		[-1.9, -1.9],
		[2.3, -1.6],
		[-1.7, 2.2],
		[2.2, 2.3],
		[0.4, 2.5],
	]) {
		b.push(box(x, 0, z, x + 0.3, 0.7, z + 0.3, "weeds"), box(x + 0.25, 0, z + 0.1, x + 0.5, 0.5, z + 0.35, "weeds"));
	}
	return { boxes: b, parts: [], top: 0.7 };
}

// 哥布林：方块小人，绿脸尖耳朵，站在地块右前方，上下晃
export function goblinStructure(): Structure {
	const g: Box[] = [
		box(-0.25, 0, -0.1, -0.05, 0.4, 0.1, "dark"),
		box(0.05, 0, -0.1, 0.25, 0.4, 0.1, "dark"),
		box(-0.3, 0.4, -0.15, 0.3, 0.9, 0.15, "wool_orange"),
		box(-0.25, 0.9, -0.25, 0.25, 1.4, 0.25, "goblin"),
		box(-0.45, 1.1, -0.05, -0.25, 1.3, 0.05, "goblin"),
		box(0.25, 1.1, -0.05, 0.45, 1.3, 0.05, "goblin"),
		box(-0.15, 1.15, 0.25, -0.05, 1.25, 0.27, "wool_yellow"),
		box(0.05, 1.15, 0.25, 0.15, 1.25, 0.27, "wool_yellow"),
		box(0.35, 0.3, 0.05, 0.45, 1.3, 0.15, "log"),
	];
	return { boxes: [], parts: [{ boxes: g, pivot: [2.4, 0, 2.4], anim: "bob" }], top: 1.4 };
}

// 树：树干 + 一团叶子；pink 是花树
export function treeBoxes(x: number, y: number, z: number, height: number, pink: boolean): Box[] {
	const b: Box[] = [];
	for (let i = 0; i < height; i++) b.push(block(x, y + i, z, "log"));
	const leaf: BlockType = pink ? "pink_leaves" : "leaves";
	for (let dx = -1; dx <= 1; dx++) {
		for (let dz = -1; dz <= 1; dz++) {
			for (let dy = height - 2; dy <= height; dy++) {
				if (dx === 0 && dz === 0 && dy < height) continue;
				if (Math.abs(dx) + Math.abs(dz) === 2 && dy === height) continue;
				b.push(block(x + dx, y + dy, z + dz, leaf));
			}
		}
	}
	b.push(block(x, y + height + 1, z, leaf));
	return b;
}

// 王城：中间 9×9 的主堡（白墙、窗户、蓝色尖顶、正门朝 +Z），四角各一座塔，塔顶金块。
// 返回方块和占住的格子（玩家走不过去）。
export function castleStructure(y: number): { boxes: Box[]; solid: [number, number][] } {
	const b: Box[] = [];
	const solid: [number, number][] = [];
	const R = 4;
	for (let x = -R; x <= R; x++) {
		for (let z = -R; z <= R; z++) {
			solid.push([x, z]);
			const edge = Math.abs(x) === R || Math.abs(z) === R;
			for (let h = 0; h < 6; h++) {
				if (!edge && h < 5) continue;
				let t: BlockType = "wall";
				if (edge && h % 3 === 1 && (x + z) % 2 === 0) t = "window_wall";
				if (h === 5) t = "castle_floor";
				b.push(block(x, y + h, z, t));
			}
		}
	}
	b.push(block(0, y, R, "door"), block(0, y + 1, R, "door"));
	// 尖顶：一层层往里收
	for (let i = 0; i < 4; i++) fill(b, -3 + i, 3 - i, y + 6 + i, y + 6 + i, -3 + i, 3 - i, "roof_blue");
	b.push(block(0, y + 10, 0, "gold"));
	for (const [tx, tz] of [
		[-6, -6],
		[6, -6],
		[-6, 6],
		[6, 6],
	]) {
		for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) solid.push([tx + dx, tz + dz]);
		fill(b, tx - 1, tx + 1, y, y + 7, tz - 1, tz + 1, "cobble");
		fill(b, tx - 1, tx + 1, y + 8, y + 8, tz - 1, tz + 1, "roof_blue");
		b.push(block(tx, y + 9, tz, "roof_blue"), block(tx, y + 10, tz, "gold"));
	}
	return { boxes: b, solid };
}

// ---- 动物老师（第一人称对话用）：原点在脚底中心，正面朝 +Z，高约 1.1 格，戴一顶学士帽 ----

function cap(b: Box[], y: number, w: number): void {
	b.push(box(-w / 2, y, -w / 2, w / 2, y + 0.08, w / 2, "dark"));
	b.push(box(-0.16, y - 0.12, -0.16, 0.16, y, 0.16, "dark"));
	b.push(box(w / 2 - 0.05, y - 0.25, -0.03, w / 2, y + 0.04, 0.03, "gold"));
}

function eyes(b: Box[], y: number, z: number, gap: number, size = 0.16): void {
	b.push(box(-gap - size / 2, y, z, -gap + size / 2, y + size, z + 0.02, "eye"));
	b.push(box(gap - size / 2, y, z, gap + size / 2, y + size, z + 0.02, "eye"));
}

const ANIMALS: Record<Animal, () => Box[]> = {
	// 猫头鹰：圆滚滚的棕色身体、米色肚子、大眼睛、小黄嘴、耳羽
	owl: () => {
		const b: Box[] = [
			box(-0.12, 0, -0.05, -0.02, 0.08, 0.12, "beak"),
			box(0.02, 0, -0.05, 0.12, 0.08, 0.12, "beak"),
			box(-0.32, 0.08, -0.26, 0.32, 0.72, 0.26, "fur_brown"),
			box(-0.22, 0.14, 0.26, 0.22, 0.6, 0.29, "fur_cream"),
			box(-0.36, 0.2, -0.18, -0.32, 0.6, 0.18, "fur_brown"),
			box(0.32, 0.2, -0.18, 0.36, 0.6, 0.18, "fur_brown"),
			box(-0.3, 0.72, -0.24, 0.3, 1.08, 0.24, "fur_brown"),
			box(-0.26, 0.76, 0.24, 0.26, 1.02, 0.26, "fur_cream"),
			box(-0.05, 0.78, 0.26, 0.05, 0.86, 0.33, "beak"),
			box(-0.3, 1.08, -0.08, -0.18, 1.2, 0.04, "fur_brown"),
			box(0.18, 1.08, -0.08, 0.3, 1.2, 0.04, "fur_brown"),
		];
		eyes(b, 0.86, 0.26, 0.12, 0.17);
		cap(b, 1.1, 0.5);
		return b;
	},
	// 狐狸：橙色身体、白色胸口和尾巴尖、尖耳朵、尖嘴
	fox: () => {
		const b: Box[] = [
			box(-0.2, 0, -0.08, -0.06, 0.3, 0.08, "fur_black"),
			box(0.06, 0, -0.08, 0.2, 0.3, 0.08, "fur_black"),
			box(-0.25, 0.3, -0.18, 0.25, 0.72, 0.18, "fur_orange"),
			box(-0.15, 0.34, 0.18, 0.15, 0.66, 0.2, "fur_white"),
			box(-0.12, 0.35, -0.5, 0.12, 0.55, -0.18, "fur_orange"),
			box(-0.1, 0.37, -0.62, 0.1, 0.53, -0.5, "fur_white"),
			box(-0.27, 0.72, -0.22, 0.27, 1.05, 0.2, "fur_orange"),
			box(-0.12, 0.74, 0.2, 0.12, 0.88, 0.36, "fur_white"),
			box(-0.04, 0.84, 0.36, 0.04, 0.9, 0.39, "fur_black"),
			box(-0.27, 1.05, -0.06, -0.13, 1.25, 0.06, "fur_orange"),
			box(0.13, 1.05, -0.06, 0.27, 1.25, 0.06, "fur_orange"),
			box(-0.24, 1.15, -0.03, -0.16, 1.24, 0.07, "fur_black"),
			box(0.16, 1.15, -0.03, 0.24, 1.24, 0.07, "fur_black"),
		];
		eyes(b, 0.9, 0.2, 0.13, 0.12);
		cap(b, 1.05, 0.46);
		return b;
	},
	// 兔子：白色身体、长耳朵（粉色内侧）、粉鼻子、圆尾巴
	rabbit: () => {
		const b: Box[] = [
			box(-0.2, 0, -0.05, -0.04, 0.12, 0.2, "fur_white"),
			box(0.04, 0, -0.05, 0.2, 0.12, 0.2, "fur_white"),
			box(-0.24, 0.12, -0.2, 0.24, 0.62, 0.2, "fur_white"),
			box(-0.1, 0.3, -0.3, 0.1, 0.5, -0.2, "fur_white"),
			box(-0.24, 0.62, -0.2, 0.24, 0.98, 0.2, "fur_white"),
			box(-0.04, 0.72, 0.2, 0.04, 0.78, 0.22, "fur_pink"),
			box(-0.2, 0.98, -0.05, -0.08, 1.45, 0.05, "fur_white"),
			box(0.08, 0.98, -0.05, 0.2, 1.45, 0.05, "fur_white"),
			box(-0.17, 1.02, 0.05, -0.11, 1.4, 0.06, "fur_pink"),
			box(0.11, 1.02, 0.05, 0.17, 1.4, 0.06, "fur_pink"),
			box(-0.2, 0.68, 0.2, -0.12, 0.72, 0.21, "fur_pink"),
			box(0.12, 0.68, 0.2, 0.2, 0.72, 0.21, "fur_pink"),
		];
		eyes(b, 0.78, 0.2, 0.1, 0.12);
		cap(b, 0.98, 0.44);
		return b;
	},
	// 熊猫：白色身体、黑色四肢和耳朵、黑眼圈
	panda: () => {
		const b: Box[] = [
			box(-0.26, 0, -0.12, -0.08, 0.28, 0.12, "fur_black"),
			box(0.08, 0, -0.12, 0.26, 0.28, 0.12, "fur_black"),
			box(-0.3, 0.28, -0.22, 0.3, 0.72, 0.22, "fur_white"),
			box(-0.3, 0.5, -0.22, 0.3, 0.64, 0.23, "fur_black"),
			box(-0.4, 0.36, -0.1, -0.3, 0.66, 0.1, "fur_black"),
			box(0.3, 0.36, -0.1, 0.4, 0.66, 0.1, "fur_black"),
			box(-0.3, 0.72, -0.24, 0.3, 1.12, 0.24, "fur_white"),
			box(-0.3, 1.1, -0.06, -0.16, 1.22, 0.06, "fur_black"),
			box(0.16, 1.1, -0.06, 0.3, 1.22, 0.06, "fur_black"),
			box(-0.22, 0.86, 0.24, -0.04, 1.0, 0.25, "fur_black"),
			box(0.04, 0.86, 0.24, 0.22, 1.0, 0.25, "fur_black"),
			box(-0.04, 0.8, 0.24, 0.04, 0.85, 0.27, "fur_black"),
		];
		eyes(b, 0.89, 0.25, 0.12, 0.09);
		cap(b, 1.12, 0.5);
		return b;
	},
};

export function teacherBoxes(animal: Animal): Box[] {
	return ANIMALS[animal]();
}

// ---- 保卫战：红方骑士和防御塔（原创方块造型，原点在脚底中心，正面 +Z） ----

// 红方骑士：银色头盔、红色上衣、木盾（盾牌上的数字由场景用卡片显示）
export function knightBoxes(): Box[] {
	return [
		box(-0.18, 0, -0.08, -0.04, 0.35, 0.08, "dark"),
		box(0.04, 0, -0.08, 0.18, 0.35, 0.08, "dark"),
		box(-0.22, 0.35, -0.14, 0.22, 0.78, 0.14, "wool_red"),
		box(-0.24, 0.7, -0.16, 0.24, 0.78, 0.16, "gold"),
		box(-0.32, 0.4, -0.06, -0.22, 0.72, 0.06, "wool_red"),
		box(0.22, 0.4, -0.06, 0.32, 0.72, 0.06, "wool_red"),
		box(-0.18, 0.78, -0.18, 0.18, 1.12, 0.18, "stone"),
		box(-0.12, 0.88, 0.18, 0.12, 0.96, 0.19, "dark"),
		box(-0.03, 1.12, -0.03, 0.03, 1.3, 0.12, "wool_red"),
		// 盾牌在左手，朝前
		box(-0.46, 0.32, 0.08, -0.12, 0.8, 0.14, "planks"),
		box(-0.42, 0.36, 0.14, -0.16, 0.76, 0.16, "wool_white"),
		// 木剑在右手
		box(0.28, 0.45, 0.05, 0.34, 1.05, 0.11, "planks"),
	];
}

// 防御塔：石头塔身、蓝色尖顶，塔顶一颗发光的水晶（光线从这里射出）
export function towerBoxes(): Box[] {
	return [
		box(-0.45, 0, -0.45, 0.45, 0.3, 0.45, "cobble"),
		box(-0.32, 0.3, -0.32, 0.32, 2.2, 0.32, "stone"),
		box(-0.4, 2.2, -0.4, 0.4, 2.35, 0.4, "planks"),
		box(-0.36, 2.35, -0.36, 0.36, 2.65, 0.36, "roof_blue"),
		box(-0.2, 2.65, -0.2, 0.2, 2.85, 0.2, "roof_blue"),
		box(-0.1, 2.95, -0.1, 0.1, 3.25, 0.1, "glow"),
	];
}

// 红方的狼：灰色身体、红围巾，脸朝 +Z
export function wolfBoxes(): Box[] {
	return [
		box(-0.16, 0, -0.32, -0.06, 0.25, -0.22, "fur_black"),
		box(0.06, 0, -0.32, 0.16, 0.25, -0.22, "fur_black"),
		box(-0.16, 0, 0.18, -0.06, 0.25, 0.28, "fur_black"),
		box(0.06, 0, 0.18, 0.16, 0.25, 0.28, "fur_black"),
		box(-0.18, 0.25, -0.38, 0.18, 0.55, 0.32, "stone"),
		box(-0.08, 0.38, -0.62, 0.08, 0.5, -0.38, "stone"),
		box(-0.19, 0.48, 0.24, 0.19, 0.58, 0.34, "wool_red"),
		box(-0.15, 0.45, 0.3, 0.15, 0.75, 0.56, "stone"),
		box(-0.08, 0.47, 0.56, 0.08, 0.6, 0.7, "fur_white"),
		box(-0.03, 0.56, 0.7, 0.03, 0.6, 0.72, "fur_black"),
		box(-0.15, 0.75, 0.34, -0.06, 0.88, 0.42, "stone"),
		box(0.06, 0.75, 0.34, 0.15, 0.88, 0.42, "stone"),
		box(-0.12, 0.62, 0.56, -0.05, 0.69, 0.57, "eye"),
		box(0.05, 0.62, 0.56, 0.12, 0.69, 0.57, "eye"),
	];
}

// 红方投石车：木架子、四个轮子、投掷臂（静态摆个姿势就好）、一块石头
export function catapultBoxes(): Box[] {
	return [
		box(-0.45, 0, -0.5, -0.3, 0.3, -0.25, "dark"),
		box(0.3, 0, -0.5, 0.45, 0.3, -0.25, "dark"),
		box(-0.45, 0, 0.25, -0.3, 0.3, 0.5, "dark"),
		box(0.3, 0, 0.25, 0.45, 0.3, 0.5, "dark"),
		box(-0.32, 0.18, -0.55, 0.32, 0.32, 0.55, "planks"),
		box(-0.06, 0.32, -0.1, 0.06, 0.85, 0.02, "log"),
		box(-0.05, 0.75, -0.55, 0.05, 0.85, 0.35, "log"),
		box(-0.14, 0.82, -0.66, 0.14, 0.96, -0.42, "planks"),
		box(-0.1, 0.92, -0.62, 0.1, 1.08, -0.46, "stone"),
		box(-0.32, 0.32, 0.4, 0.32, 0.6, 0.55, "wool_red"),
	];
}

// 哥布林大王：大个子哥布林，戴金王冠，披红斗篷，拿一根金权杖
export function goblinKingBoxes(): Box[] {
	return [
		box(-0.32, 0, -0.16, -0.08, 0.6, 0.16, "dark"),
		box(0.08, 0, -0.16, 0.32, 0.6, 0.16, "dark"),
		box(-0.44, 0.6, -0.26, 0.44, 1.35, 0.26, "wool_orange"),
		box(-0.48, 0.6, -0.34, 0.48, 1.4, -0.26, "wool_red"),
		box(-0.6, 0.8, -0.1, -0.44, 1.3, 0.1, "goblin"),
		box(0.44, 0.8, -0.1, 0.6, 1.3, 0.1, "goblin"),
		box(-0.38, 1.35, -0.36, 0.38, 2.05, 0.36, "goblin"),
		box(-0.7, 1.65, -0.06, -0.38, 1.85, 0.06, "goblin"),
		box(0.38, 1.65, -0.06, 0.7, 1.85, 0.06, "goblin"),
		box(-0.24, 1.66, 0.36, -0.08, 1.8, 0.38, "wool_yellow"),
		box(0.08, 1.66, 0.36, 0.24, 1.8, 0.38, "wool_yellow"),
		box(-0.14, 1.45, 0.36, 0.14, 1.52, 0.38, "dark"),
		box(-0.4, 2.05, -0.38, 0.4, 2.2, 0.38, "gold"),
		box(-0.4, 2.2, -0.08, -0.26, 2.42, 0.06, "gold"),
		box(-0.07, 2.2, -0.08, 0.07, 2.48, 0.06, "gold"),
		box(0.26, 2.2, -0.08, 0.4, 2.42, 0.06, "gold"),
		box(0.62, 0.4, 0.04, 0.72, 1.9, 0.14, "gold"),
		box(0.58, 1.9, 0, 0.76, 2.08, 0.18, "glow"),
	];
}

// 守住村庄的奖励装饰（方块版），原点在底面中心
export function decoBoxes(kind: "fountain" | "statue" | "flowerbed" | "bench" | "lamp" | "well"): Box[] {
	switch (kind) {
		case "fountain":
			return [
				box(-0.9, 0, -0.9, 0.9, 0.4, 0.9, "cobble"),
				box(-0.7, 0.3, -0.7, 0.7, 0.42, 0.7, "water"),
				box(-0.15, 0.4, -0.15, 0.15, 1.2, 0.15, "pillar"),
				box(-0.35, 1.2, -0.35, 0.35, 1.3, 0.35, "pillar"),
				box(-0.25, 1.28, -0.25, 0.25, 1.34, 0.25, "water"),
			];
		case "statue":
			return [
				box(-0.5, 0, -0.5, 0.5, 0.5, 0.5, "cobble"),
				box(-0.12, 0.5, -0.12, 0.12, 1.3, 0.12, "stone"),
				box(-0.12, 1.3, -0.12, 0.12, 2.0, 0.12, "gold"),
				box(-0.45, 1.55, -0.1, 0.45, 1.75, 0.1, "gold"),
				box(-0.28, 1.15, -0.1, -0.1, 1.45, 0.1, "gold"),
				box(0.1, 1.15, -0.1, 0.28, 1.45, 0.1, "gold"),
			];
		case "flowerbed":
			return [
				box(-0.9, 0, -0.5, 0.9, 0.3, 0.5, "planks"),
				box(-0.8, 0.2, -0.4, 0.8, 0.35, 0.4, "flower"),
				box(-0.6, 0.35, -0.2, -0.4, 0.6, 0, "wool_red"),
				box(-0.1, 0.35, 0, 0.1, 0.65, 0.2, "wool_yellow"),
				box(0.4, 0.35, -0.2, 0.6, 0.6, 0, "fur_pink"),
			];
		case "bench":
			return [
				box(-0.8, 0, -0.25, -0.65, 0.45, 0.25, "log"),
				box(0.65, 0, -0.25, 0.8, 0.45, 0.25, "log"),
				box(-0.85, 0.45, -0.3, 0.85, 0.55, 0.3, "planks"),
				box(-0.85, 0.55, -0.32, 0.85, 1.0, -0.22, "planks"),
			];
		case "lamp":
			return [
				box(-0.25, 0, -0.25, 0.25, 0.2, 0.25, "cobble"),
				box(-0.08, 0.2, -0.08, 0.08, 2.0, 0.08, "dark"),
				box(-0.22, 2.0, -0.22, 0.22, 2.4, 0.22, "glow"),
				box(-0.26, 2.4, -0.26, 0.26, 2.5, 0.26, "dark"),
			];
		case "well":
			return [
				box(-0.6, 0, -0.6, 0.6, 0.6, 0.6, "cobble"),
				box(-0.42, 0.45, -0.42, 0.42, 0.62, 0.42, "water"),
				box(-0.6, 0.6, -0.08, -0.48, 1.6, 0.08, "log"),
				box(0.48, 0.6, -0.08, 0.6, 1.6, 0.08, "log"),
				box(-0.75, 1.6, -0.45, 0.75, 1.75, 0.45, "roof_red"),
				box(-0.5, 1.75, -0.3, 0.5, 1.9, 0.3, "roof_red"),
			];
	}
}
