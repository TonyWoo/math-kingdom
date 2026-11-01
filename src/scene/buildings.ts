// 低多边形建筑：全部用基本几何体拼，不依赖美术资源。几何体和材质共享，减少显存和切换。
// 星级：1 星是地基加脚手架，2 星是建好的房子，3 星换金色屋顶并插旗。
// 地块状态的装饰：空地的告示牌和光圈、该复习的问号、长草、哥布林。

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Building } from "../core/types";

const geo = {
	box: new THREE.BoxGeometry(1, 1, 1),
	cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
	cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
	cone8: new THREE.ConeGeometry(0.5, 1, 8),
	cone4: new THREE.ConeGeometry(0.5, 1, 4),
	prism: new THREE.CylinderGeometry(0.5, 0.5, 1, 3),
	sphere: new THREE.IcosahedronGeometry(0.5, 1),
	puff: new THREE.IcosahedronGeometry(0.5, 2),
};

const mats = new Map<number, THREE.MeshLambertMaterial>();
export function mat(color: number): THREE.MeshLambertMaterial {
	let m = mats.get(color);
	if (!m) {
		m = new THREE.MeshLambertMaterial({ color, flatShading: true });
		mats.set(color, m);
	}
	return m;
}

const C = {
	wood: 0xa8733f,
	darkWood: 0x7a5233,
	stone: 0xb9b3a6,
	wall: 0xf3ead8,
	cream: 0xf6e7c1,
	red: 0xd9534a,
	blue: 0x4a7fd8,
	green: 0x3f8a3a,
	gold: 0xf2c230,
	white: 0xffffff,
	water: 0x5cc4f0,
	goblin: 0x6cc24a,
};

// 一个方块/圆柱等：size 是 (宽, 高, 深)，position 是底面中心。
function part(
	g: THREE.Group,
	shape: keyof typeof geo,
	color: number,
	size: [number, number, number],
	pos: [number, number, number],
	rot?: [number, number, number],
): THREE.Mesh {
	const m = new THREE.Mesh(geo[shape], mat(color));
	m.scale.set(...size);
	m.position.set(pos[0], pos[1] + size[1] / 2, pos[2]);
	if (rot) m.rotation.set(...rot);
	m.castShadow = true;
	g.add(m);
	return m;
}

// 地基 + 脚手架（1 星）
function foundation(g: THREE.Group): void {
	part(g, "box", C.stone, [0.5, 0.08, 0.5], [0, 0, 0]);
	part(g, "box", C.wall, [0.42, 0.14, 0.42], [0, 0.08, 0]);
	for (const [x, z] of [
		[-0.22, -0.22],
		[0.22, -0.22],
		[-0.22, 0.22],
		[0.22, 0.22],
	]) {
		part(g, "box", C.wood, [0.035, 0.5, 0.035], [x, 0.08, z]);
	}
	part(g, "box", C.wood, [0.5, 0.03, 0.035], [0, 0.4, -0.22]);
	part(g, "box", C.wood, [0.5, 0.03, 0.035], [0, 0.4, 0.22]);
	part(g, "box", C.wood, [0.035, 0.03, 0.5], [-0.22, 0.28, 0]);
	// 一摞木板
	part(g, "box", C.darkWood, [0.18, 0.06, 0.08], [0.32, 0, 0.12]);
}

function mill(g: THREE.Group, roof: number): THREE.Object3D {
	part(g, "cyl8", C.wall, [0.38, 0.46, 0.38], [0, 0, 0]);
	part(g, "cone8", roof, [0.48, 0.26, 0.48], [0, 0.46, 0]);
	part(g, "box", C.darkWood, [0.1, 0.16, 0.02], [0, 0, 0.19]);
	// 风车叶片绕 z 轴转（动画由场景更新）
	const blades = new THREE.Group();
	blades.position.set(0, 0.42, 0.22);
	for (let i = 0; i < 4; i++) {
		const arm = new THREE.Group();
		arm.rotation.z = (i * Math.PI) / 2;
		const b = new THREE.Mesh(geo.box, mat(C.cream));
		b.scale.set(0.07, 0.34, 0.015);
		b.position.y = 0.19;
		arm.add(b);
		blades.add(arm);
	}
	blades.userData.spin = 1.2;
	g.add(blades);
	return blades;
}

function library(g: THREE.Group, roof: number): void {
	part(g, "box", C.stone, [0.56, 0.06, 0.42], [0, 0, 0]);
	part(g, "box", C.cream, [0.48, 0.3, 0.32], [0, 0.06, -0.02]);
	for (const x of [-0.18, -0.06, 0.06, 0.18]) {
		part(g, "cyl8", C.white, [0.05, 0.3, 0.05], [x, 0.06, 0.17]);
	}
	// 三棱柱屋顶，屋脊沿 x 方向
	part(g, "prism", roof, [0.36, 0.6, 0.3], [0, 0.32, 0.02], [0, 0, Math.PI / 2]);
	part(g, "box", C.blue, [0.12, 0.12, 0.01], [0, 0.2, 0.15]);
}

function watchtower(g: THREE.Group, roof: number): void {
	part(g, "cyl6", C.stone, [0.26, 0.62, 0.26], [0, 0, 0]);
	part(g, "box", C.wood, [0.36, 0.06, 0.36], [0, 0.62, 0]);
	for (const [x, z] of [
		[-0.15, -0.15],
		[0.15, -0.15],
		[-0.15, 0.15],
		[0.15, 0.15],
	]) {
		part(g, "box", C.wood, [0.03, 0.14, 0.03], [x, 0.68, z]);
	}
	part(g, "cone4", roof, [0.46, 0.24, 0.46], [0, 0.82, 0], [0, Math.PI / 4, 0]);
	part(g, "box", C.darkWood, [0.08, 0.14, 0.01], [0, 0, 0.13]);
}

function market(g: THREE.Group, roof: number): void {
	for (const [x, z, color] of [
		[-0.13, 0.02, roof],
		[0.15, -0.08, C.blue],
	] as const) {
		part(g, "box", C.wood, [0.22, 0.16, 0.18], [x, 0, z]);
		// 条纹遮阳篷：两色交替的斜板
		for (let i = 0; i < 3; i++) {
			part(
				g,
				"box",
				i % 2 ? C.white : color,
				[0.08, 0.02, 0.24],
				[x - 0.08 + i * 0.08, 0.26, z + 0.02],
				[0.35, 0, 0],
			);
		}
		for (const dx of [-0.1, 0.1]) part(g, "box", C.darkWood, [0.02, 0.26, 0.02], [x + dx, 0, z + 0.1]);
	}
	part(g, "cyl8", C.darkWood, [0.1, 0.12, 0.1], [0.05, 0, 0.2]);
	part(g, "sphere", 0xf28c28, [0.06, 0.06, 0.06], [0.05, 0.12, 0.2]);
}

function plaza(g: THREE.Group, roof: number): THREE.Object3D {
	part(g, "cyl8", C.stone, [0.6, 0.05, 0.6], [0, 0, 0]);
	part(g, "cyl8", C.white, [0.3, 0.1, 0.3], [0, 0.05, 0]);
	part(g, "cyl8", C.water, [0.24, 0.02, 0.24], [0, 0.14, 0]);
	part(g, "cyl8", C.white, [0.06, 0.18, 0.06], [0, 0.15, 0]);
	part(g, "box", C.darkWood, [0.025, 0.6, 0.025], [0.24, 0.05, -0.18]);
	const flag = part(g, "box", roof, [0.18, 0.1, 0.01], [0.33, 0.52, -0.18]);
	flag.userData.wave = true;
	return flag;
}

const BUILDERS: Record<Building, (g: THREE.Group, roof: number) => THREE.Object3D | void> = {
	mill,
	library,
	watchtower,
	market,
	plaza,
};

const ROOF: Record<Building, number> = {
	mill: C.red,
	library: C.blue,
	watchtower: C.red,
	market: C.red,
	plaza: C.blue,
};

// 金顶的小旗
function pennant(g: THREE.Group): void {
	const box = new THREE.Box3().setFromObject(g);
	const top = box.max.y;
	part(g, "box", C.darkWood, [0.015, 0.22, 0.015], [0, top - 0.02, 0]);
	const f = part(g, "box", C.gold, [0.12, 0.07, 0.01], [0.06, top + 0.12, 0]);
	f.userData.wave = true;
}

// 把一组零件里不会动的部分合并成一个网格（颜色写进顶点），一栋建筑只剩一两次绘制调用。
// 带动画标记（spin、wave、pulse、bob）的零件和它们的子节点保持独立。
const bakedMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const animated = (o: THREE.Object3D) => o.userData.spin || o.userData.wave || o.userData.pulse || o.userData.bob;

export function bake(g: THREE.Group): THREE.Group {
	g.updateMatrixWorld(true);
	const inverse = g.matrixWorld.clone().invert();
	const parts: THREE.BufferGeometry[] = [];
	const remove: THREE.Object3D[] = [];
	const color = new THREE.Color();
	for (const child of g.children) {
		if (animated(child) || !(child instanceof THREE.Mesh) || !(child.material instanceof THREE.MeshLambertMaterial)) continue;
		const geometry = (child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone()) as THREE.BufferGeometry;
		for (const name of Object.keys(geometry.attributes)) {
			if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
		}
		geometry.applyMatrix4(inverse.clone().multiply(child.matrixWorld));
		color.copy(child.material.color);
		const n = geometry.getAttribute("position").count;
		const colors = new Float32Array(n * 3);
		for (let i = 0; i < n; i++) colors.set([color.r, color.g, color.b], i * 3);
		geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
		parts.push(geometry);
		remove.push(child);
	}
	if (parts.length > 1) {
		for (const o of remove) g.remove(o);
		const merged = new THREE.Mesh(mergeGeometries(parts), bakedMaterial);
		merged.castShadow = true;
		g.add(merged);
	}
	return g;
}

// 按星级建一栋建筑；0 星返回空。
export function createBuilding(type: Building, stars: number): THREE.Group {
	const g = new THREE.Group();
	if (stars <= 0) return g;
	if (stars === 1) {
		foundation(g);
		return bake(g);
	}
	BUILDERS[type](g, stars >= 3 ? C.gold : ROOF[type]);
	if (stars >= 3) pennant(g);
	return bake(g);
}

// 空地：木告示牌和一圈会呼吸的金色光环
export function createOpenMarker(): THREE.Group {
	const g = new THREE.Group();
	part(g, "box", C.darkWood, [0.04, 0.3, 0.04], [0, 0, 0]);
	part(g, "box", C.wood, [0.26, 0.14, 0.03], [0, 0.22, 0]);
	const ring = new THREE.Mesh(
		new THREE.TorusGeometry(0.3, 0.025, 6, 32),
		new THREE.MeshBasicMaterial({ color: 0xffc83a }),
	);
	ring.rotation.x = -Math.PI / 2;
	ring.position.y = 0.02;
	ring.userData.pulse = true;
	g.add(ring);
	return bake(g);
}

// 长草：周围几簇深绿色小锥
export function createWeeds(): THREE.Group {
	const g = new THREE.Group();
	const spots = [
		[-0.3, 0.15],
		[0.3, 0.2],
		[-0.18, -0.3],
		[0.28, -0.22],
		[0.05, 0.34],
	];
	for (const [x, z] of spots) {
		for (let i = 0; i < 3; i++) {
			const h = 0.12 + i * 0.03;
			part(g, "cone4", 0x2f6e2a, [0.05, h, 0.05], [x + (i - 1) * 0.04, 0, z + (i % 2) * 0.03], [0, i, 0.2 * (i - 1)]);
		}
	}
	return bake(g);
}

// 哥布林：绿色小人，尖耳朵，会上下晃
export function createGoblin(): THREE.Group {
	const g = new THREE.Group();
	part(g, "cyl8", 0x6b4a2b, [0.13, 0.12, 0.1], [0, 0, 0]);
	part(g, "sphere", C.goblin, [0.14, 0.14, 0.14], [0, 0.12, 0]);
	part(g, "cone4", C.goblin, [0.04, 0.12, 0.04], [-0.09, 0.2, 0], [0, 0, 1.1]);
	part(g, "cone4", C.goblin, [0.04, 0.12, 0.04], [0.09, 0.2, 0], [0, 0, -1.1]);
	part(g, "sphere", 0xffef5a, [0.03, 0.03, 0.03], [-0.03, 0.18, 0.06]);
	part(g, "sphere", 0xffef5a, [0.03, 0.03, 0.03], [0.03, 0.18, 0.06]);
	part(g, "box", C.darkWood, [0.02, 0.22, 0.02], [0.1, 0.02, 0.04]);
	bake(g);
	g.userData.bob = true;
	return g;
}

// 头顶的提示气泡（? 或 !），用画布贴图的精灵，永远朝向镜头
const bubbleTextures = new Map<string, THREE.Texture>();
export function createBubble(symbol: "?" | "!"): THREE.Sprite {
	let tex = bubbleTextures.get(symbol);
	if (!tex) {
		const c = document.createElement("canvas");
		c.width = c.height = 128;
		const ctx = c.getContext("2d")!;
		ctx.fillStyle = symbol === "?" ? "#ffffff" : "#e5483a";
		ctx.strokeStyle = symbol === "?" ? "#3a3a3a" : "#ffffff";
		ctx.lineWidth = 8;
		ctx.beginPath();
		ctx.arc(64, 58, 48, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(52, 100);
		ctx.lineTo(64, 124);
		ctx.lineTo(76, 100);
		ctx.fill();
		ctx.fillStyle = symbol === "?" ? "#333333" : "#ffffff";
		ctx.font = "bold 70px sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(symbol, 64, 62);
		tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		bubbleTextures.set(symbol, tex);
	}
	const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
	s.scale.set(0.32, 0.32, 1);
	s.renderOrder = 10;
	s.userData.bob = true;
	return s;
}

export { geo };
