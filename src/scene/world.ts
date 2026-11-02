// 王国地形：海面上一座圆形岛屿。王城是中间的小山；每个年级是一圈台地，越往外越高（“往边疆开拓”是往上爬）；
// 四个领域是不同的地形颜色。台地之间、扇区之间留出缝隙，露出下面的沙土色岛面，就是环路和放射大道。
// 布局坐标 (x, y) → 场景 (x * SCALE, 高度, y * SCALE)。

import * as THREE from "three";
import type { KingdomData, Terrain } from "../core/types";
import type { Assets, ModelName } from "./assets";

export const SCALE = 0.01;
export const BASE_H = 0.3; // 岛面（道路）的高度
const AVENUE = 34; // 放射大道的半宽（布局坐标）

// 年级台地顶面的高度
export function terraceHeight(grade: number): number {
	return BASE_H + 0.16 + grade * 0.12;
}

export const CASTLE_H = 1.0;

const TERRAIN_COLOR: Record<Terrain, [number, number]> = {
	plain: [0x8fd65f, 0x7fc552],
	hill: [0xcdb98c, 0xbfa97a],
	coast: [0x8fd6c8, 0x7cc6b8],
	fair: [0xf2c3d4, 0xe6b0c4],
};

export const COLORS = {
	road: 0xe8c983,
	cliff: 0x9a7b55,
	sea: 0x4fa3d9,
	castle: 0xc7c2d6,
	sky: 0xbfe3ff,
};

// 环形扇区的形状（在 XY 平面里，y 取反，挤出后绕 X 轴转 -90° 就落到 XZ 平面、厚度朝上）
function annularSector(r1: number, r2: number, a1: number, a2: number): THREE.Shape {
	const steps = Math.max(6, Math.ceil(((a2 - a1) * r2) / 0.4));
	const shape = new THREE.Shape();
	for (let i = 0; i <= steps; i++) {
		const a = a1 + ((a2 - a1) * i) / steps;
		const p = [r2 * Math.cos(a), -r2 * Math.sin(a)] as const;
		if (i === 0) shape.moveTo(p[0], p[1]);
		else shape.lineTo(p[0], p[1]);
	}
	for (let i = steps; i >= 0; i--) {
		const a = a1 + ((a2 - a1) * i) / steps;
		shape.lineTo(r1 * Math.cos(a), -r1 * Math.sin(a));
	}
	return shape;
}

function slab(shape: THREE.Shape, bottom: number, top: number, color: number): THREE.Mesh {
	const geo = new THREE.ExtrudeGeometry(shape, { depth: top - bottom, bevelEnabled: false, curveSegments: 4 });
	geo.rotateX(-Math.PI / 2);
	geo.translate(0, bottom, 0);
	const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }));
	mesh.receiveShadow = true;
	return mesh;
}

export function createWorld(data: KingdomData, assets: Assets | null = null): THREE.Group {
	const group = new THREE.Group();
	const outer = data.rings.at(-1)!.r2 * SCALE;

	// 海面
	const sea = new THREE.Mesh(
		new THREE.CircleGeometry(outer * 4, 64),
		new THREE.MeshLambertMaterial({ color: COLORS.sea }),
	);
	sea.rotation.x = -Math.PI / 2;
	sea.position.y = -0.05;
	group.add(sea);

	// 岛的底座：侧面是土崖，顶面是道路色
	const islandR = outer + 1.2;
	const cliff = new THREE.Mesh(
		new THREE.CylinderGeometry(islandR, islandR + 0.6, BASE_H + 0.3, 72, 1, true),
		new THREE.MeshLambertMaterial({ color: COLORS.cliff, flatShading: true }),
	);
	cliff.position.y = (BASE_H - 0.3) / 2;
	group.add(cliff);
	const top = new THREE.Mesh(new THREE.CircleGeometry(islandR, 72), new THREE.MeshLambertMaterial({ color: COLORS.road }));
	top.rotation.x = -Math.PI / 2;
	top.position.y = BASE_H;
	top.receiveShadow = true;
	group.add(top);

	// 年级台地：每个扇区一块，扇区边上让出放射大道
	for (const ring of data.rings) {
		const r1 = ring.r1 * SCALE;
		const r2 = ring.r2 * SCALE;
		const h = terraceHeight(ring.grade);
		for (const s of data.sectors) {
			const pad = AVENUE / ((ring.r1 + ring.r2) / 2);
			const color = TERRAIN_COLOR[s.terrain][ring.grade % 2];
			const mesh = slab(annularSector(r1, r2, s.a1 + pad, s.a2 - pad), BASE_H, h, color);
			mesh.userData.grade = ring.grade; // 按年级筛选时靠它显隐台地
			group.add(mesh);
		}
	}

	// 岛的外缘：一圈森林
	if (assets) {
		group.add(createForest(assets, outer));
		group.add(createCastleModel(assets));
		return group;
	}
	const trunk = new THREE.MeshLambertMaterial({ color: 0x7a5233, flatShading: true });
	const leaf = new THREE.MeshLambertMaterial({ color: 0x3f8a3a, flatShading: true });
	const trunkGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.3, 5);
	const leafGeo = new THREE.ConeGeometry(0.32, 0.8, 6);
	const count = Math.floor(outer * 6);
	const trunks = new THREE.InstancedMesh(trunkGeo, trunk, count);
	const leaves = new THREE.InstancedMesh(leafGeo, leaf, count);
	const m = new THREE.Matrix4();
	for (let i = 0; i < count; i++) {
		const a = (i / count) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.02;
		const r = outer + 0.45 + ((i * 7) % 5) * 0.12;
		const sc = 0.8 + ((i * 13) % 7) * 0.08;
		const x = r * Math.cos(a);
		const z = r * Math.sin(a);
		m.makeScale(sc, sc, sc).setPosition(x, BASE_H + 0.15 * sc, z);
		trunks.setMatrixAt(i, m);
		m.makeScale(sc, sc, sc).setPosition(x, BASE_H + 0.65 * sc, z);
		leaves.setMatrixAt(i, m);
	}
	group.add(trunks, leaves);

	group.add(createCastle());
	return group;
}

// 用模型种森林：三种树轮流，偶尔夹着灌木和石头，每种一个 InstancedMesh
function createForest(assets: Assets, outer: number): THREE.Group {
	const g = new THREE.Group();
	const kinds: ModelName[] = ["tree_pine", "tree_round", "tree_pine", "tree_blossom", "tree_pine", "bush", "tree_round", "rock_1"];
	const count = Math.floor(outer * 7);
	const spots = new Map<ModelName, THREE.Matrix4[]>();
	const q = new THREE.Quaternion();
	const up = new THREE.Vector3(0, 1, 0);
	for (let i = 0; i < count; i++) {
		const kind = kinds[(i * 5 + (i >> 2)) % kinds.length];
		const a = (i / count) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.02;
		const r = outer + 0.45 + ((i * 7) % 5) * 0.13;
		const sc = 0.9 + ((i * 13) % 7) * 0.08;
		q.setFromAxisAngle(up, i * 2.3);
		const m = new THREE.Matrix4().compose(new THREE.Vector3(r * Math.cos(a), BASE_H, r * Math.sin(a)), q, new THREE.Vector3(sc, sc, sc));
		if (!spots.has(kind)) spots.set(kind, []);
		spots.get(kind)!.push(m);
	}
	for (const [kind, list] of spots) {
		const geometry = assets.models.get(kind)!.geometry!;
		const mesh = new THREE.InstancedMesh(geometry, assets.material, list.length);
		list.forEach((m, i) => mesh.setMatrixAt(i, m));
		g.add(mesh);
	}
	return g;
}

// 王城模型，正门朝 +Z（朝着默认镜头）
function createCastleModel(assets: Assets): THREE.Group {
	const g = new THREE.Group();
	const castle = assets.models.get("castle")!;
	if (castle.geometry) g.add(new THREE.Mesh(castle.geometry, assets.material));
	for (const p of castle.parts) {
		const mesh = new THREE.Mesh(p.geometry, assets.material);
		mesh.position.copy(p.pivot);
		g.add(mesh);
	}
	g.position.y = BASE_H - 0.02;
	g.scale.setScalar(1.1);
	return g;
}

// 王城：圆形石台上的城堡，蓝色尖顶。
function createCastle(): THREE.Group {
	const g = new THREE.Group();
	const r = 2.2;
	const stone = new THREE.MeshLambertMaterial({ color: COLORS.castle, flatShading: true });
	const wall = new THREE.MeshLambertMaterial({ color: 0xece6f2, flatShading: true });
	const roof = new THREE.MeshLambertMaterial({ color: 0x3a6fd8, flatShading: true });
	const hill = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.3, r + 0.7, CASTLE_H, 24), stone);
	hill.position.y = CASTLE_H / 2;
	g.add(hill);
	const keep = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.4), wall);
	keep.position.y = CASTLE_H + 0.55;
	g.add(keep);
	const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.9, 4), roof);
	keepRoof.position.y = CASTLE_H + 1.55;
	keepRoof.rotation.y = Math.PI / 4;
	g.add(keepRoof);
	for (let i = 0; i < 4; i++) {
		const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
		const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 1.5, 8), wall);
		tower.position.set(Math.cos(a) * 1.25, CASTLE_H + 0.75, Math.sin(a) * 1.25);
		g.add(tower);
		const cap = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.7, 8), roof);
		cap.position.set(tower.position.x, CASTLE_H + 1.85, tower.position.z);
		g.add(cap);
	}
	const flagPole = new THREE.Mesh(
		new THREE.CylinderGeometry(0.02, 0.02, 0.7, 4),
		new THREE.MeshLambertMaterial({ color: 0x555555 }),
	);
	flagPole.position.y = CASTLE_H + 2.3;
	g.add(flagPole);
	const flag = new THREE.Mesh(
		new THREE.BoxGeometry(0.4, 0.24, 0.02),
		new THREE.MeshLambertMaterial({ color: 0xf0b020 }),
	);
	flag.position.set(0.2, CASTLE_H + 2.52, 0);
	g.add(flag);
	g.traverse((o) => {
		if (o instanceof THREE.Mesh) o.castShadow = true;
	});
	return g;
}
