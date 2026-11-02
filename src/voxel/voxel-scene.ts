// 第一人称方块世界：把同一个王国画成方块，玩家在里面走。实现 View 接口，和地图视角共用同一套界面和进度。
//   地形：按 32×32 分块生成网格（只画露在外面的面），一个材质（贴图集 + 顶点明暗），不用光照。
//   地块：每块地一组网格，按状态和星级用 structures.ts 的图纸搭；迷雾是半透明的云方块（一个 InstancedMesh）。
//   互动：准星对着（手机上是点到）地块时显示提示，点击或按 E 打开详情面板。

import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { type Kingdom, type Progress, type Status, stars as starsOf, status as statusOf } from "../core/kingdom";
import type { KingdomData } from "../core/types";
import { labelCard } from "../scene/label";
import type { View } from "../scene/view";
import { type Atlas, createAtlas } from "./atlas";
import { type Box, MeshBuilder, block } from "./mesher";
import { type Part, type Structure, buildingStructure, castleStructure, goblinStructure, openStructure, treeBoxes, weedsStructure } from "./structures";
import { BASE, BLOCK, type Ground, type PlotCell, type TerrainData, buildTerrain } from "./terrain";
import { Player } from "./player";

const CHUNK = 32;
const SKY = 0x9fd4ff;

const GROUND: Record<Ground, { top: Box["type"]; side: Box["type"]; fill: Box["type"] }> = {
	plain: { top: "grass", side: "grass", fill: "dirt" },
	hill: { top: "grass", side: "grass", fill: "dirt" },
	coast: { top: "grass", side: "grass", fill: "dirt" },
	fair: { top: "grass", side: "grass", fill: "dirt" },
	forest: { top: "grass", side: "grass", fill: "dirt" },
	road: { top: "path", side: "path", fill: "dirt" },
	castle: { top: "castle_floor", side: "cobble", fill: "cobble" },
	sand: { top: "sand", side: "sand", fill: "sand" },
};

// 不同领域的地面贴图（顶面、侧面最上一层）
const GROUND_TILES: Partial<Record<Ground, [Parameters<Atlas["uv"]>[0], Parameters<Atlas["uv"]>[0]]>> = {
	plain: ["grass_top", "grass_side"],
	forest: ["grass_top", "grass_side"],
	hill: ["hill_top", "hill_side"],
	coast: ["coast_top", "coast_side"],
	fair: ["fair_top", "fair_side"],
	road: ["path", "dirt"],
	castle: ["castle_top", "cobble"],
	sand: ["sand", "sand"],
};

interface PlotView {
	cell: PlotCell;
	index: number;
	group: THREE.Group;
	hit: THREE.Mesh; // 看不见的拾取盒子
	label: CSS2DObject;
	status?: Status;
	stars?: number;
	grow: number;
}

function hash(x: number, z: number): number {
	let h = (x * 374761393 + z * 668265263) | 0;
	h = (h ^ (h >>> 13)) * 1274126177;
	return (h ^ (h >>> 16)) >>> 0;
}

export class VoxelScene implements View {
	onPick: (id: string | null) => void = () => {};
	readonly renderer: THREE.WebGLRenderer;
	readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 260);
	readonly player: Player;

	private scene = new THREE.Scene();
	private labels = new CSS2DRenderer();
	private container: HTMLElement;
	private k: Kingdom;
	private data: KingdomData;
	private atlas: Atlas;
	private material: THREE.MeshBasicMaterial;
	private terrain: TerrainData;
	private solid = new Set<number>(); // 王城和树干占住的格子（地块的在 terrain.occupied）
	private plots = new Map<string, PlotView>();
	private clouds: THREE.InstancedMesh;
	private cloudBase: THREE.Matrix4[] = [];
	private highlight: THREE.LineSegments;
	private villageLabels: CSS2DObject[] = [];
	private hint: HTMLElement;
	private help: HTMLElement;
	private hover: string | null = null;
	private raycaster = new THREE.Raycaster();
	private bursts: { points: THREE.Points; v: Float32Array; age: number }[] = [];
	private clock = 0;
	private visible = false;
	private panelOpen = false;
	private inset = { right: 0, bottom: 0 };

	constructor(container: HTMLElement, data: KingdomData, k: Kingdom) {
		this.container = container;
		this.data = data;
		this.k = k;
		this.renderer = new THREE.WebGLRenderer({ antialias: false });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		container.appendChild(this.renderer.domElement);
		this.labels.domElement.className = "labels";
		container.appendChild(this.labels.domElement);

		this.scene.background = new THREE.Color(SKY);
		this.scene.fog = new THREE.Fog(SKY, 40, 120);
		this.atlas = createAtlas();
		this.material = new THREE.MeshBasicMaterial({ map: this.atlas.texture, vertexColors: true });
		this.terrain = buildTerrain(data);

		this.addTerrain();
		this.addCastle();
		this.addForest();
		this.addSea();
		this.addVillages();
		this.addPlots();
		this.clouds = this.addClouds();

		this.highlight = new THREE.LineSegments(
			new THREE.EdgesGeometry(new THREE.BoxGeometry(3.2, 1, 3.2)),
			new THREE.LineBasicMaterial({ color: 0xffffff }),
		);
		this.highlight.visible = false;
		this.scene.add(this.highlight);

		this.hint = document.createElement("div");
		this.hint.className = "fp-hint";
		this.hint.hidden = true;
		container.appendChild(this.hint);
		const cross = document.createElement("div");
		cross.className = "crosshair";
		container.appendChild(cross);
		this.help = document.createElement("div");
		this.help.className = "fp-help";
		this.help.innerHTML = matchMedia("(pointer: fine)").matches
			? "<b>点击画面开始</b><span>WASD 移动 · 鼠标看 · 空格跳 · Shift 跑</span><span>准星对着地块，点击或按 E 查看 · Esc 释放鼠标</span>"
			: "<b>左手拖动走路，右手拖动看</b><span>点一下地块查看</span>";
		container.appendChild(this.help);

		this.player = new Player(this.renderer.domElement, (x, z) => this.topAt(x, z));
		this.player.onInteract = (screen) => this.interact(screen);
		this.player.onLockChange = (locked) => {
			this.help.hidden = locked || !matchMedia("(pointer: fine)").matches || this.panelOpen;
		};
		this.goHome();
		this.resize();
		window.addEventListener("resize", () => this.resize());
	}

	// 一列能站的高度（顶面）；岛外、建筑、树干、王城返回 Infinity
	private topAt(x: number, z: number): number {
		const key = this.terrain.key(x, z);
		const col = this.terrain.columns.get(key);
		if (!col || this.terrain.occupied.has(key) || this.solid.has(key)) return Infinity;
		return col.h + 1;
	}

	private addTerrain(): void {
		const t = this.terrain;
		const r = t.radius;
		const heightAt = (x: number, z: number) => t.columns.get(t.key(x, z))?.h ?? -1;
		for (let cx = -r; cx <= r; cx += CHUNK) {
			for (let cz = -r; cz <= r; cz += CHUNK) {
				const b = new MeshBuilder(this.atlas);
				for (let x = cx; x < cx + CHUNK && x <= r; x++) {
					for (let z = cz; z < cz + CHUNK && z <= r; z++) {
						const col = t.columns.get(t.key(x, z));
						if (!col) continue;
						const [topTile, sideTile] = col.path ? (["path", "dirt"] as const) : GROUND_TILES[col.ground]!;
						const fill = GROUND[col.ground].fill;
						const h = col.h;
						b.face([x, h, z], [x + 1, h + 1, z + 1], 2, topTile);
						// 侧面：比邻居高的部分露出来，最上一层用带草边的贴图
						const sides: [number, number, 0 | 1 | 4 | 5][] = [
							[1, 0, 0],
							[-1, 0, 1],
							[0, 1, 4],
							[0, -1, 5],
						];
						for (const [dx, dz, f] of sides) {
							const nh = heightAt(x + dx, z + dz);
							for (let y = Math.max(nh + 1, 0); y <= h; y++) {
								const tile = y === h ? sideTile : fill === "dirt" ? "dirt" : fill === "sand" ? "sand" : "cobble";
								b.face([x, y, z], [x + 1, y + 1, z + 1], f, tile, y === h ? 1 : 0.9);
							}
						}
					}
				}
				if (!b.empty) this.scene.add(new THREE.Mesh(b.build(), this.material));
			}
		}
	}

	private addCastle(): void {
		const { boxes, solid } = castleStructure(BASE + 1);
		for (const [x, z] of solid) this.solid.add(this.terrain.key(x, z));
		const b = new MeshBuilder(this.atlas);
		b.boxes(boxes);
		this.scene.add(new THREE.Mesh(b.build(), this.material));
		const el = document.createElement("div");
		el.className = "label castle";
		el.textContent = "王城";
		const label = new CSS2DObject(el);
		label.position.set(0.5, BASE + 13, 0.5);
		this.scene.add(label);
	}

	private addForest(): void {
		const t = this.terrain;
		const boxes: Box[] = [];
		for (const [k, col] of t.columns) {
			if (col.ground !== "forest") continue;
			const x = Math.floor(k / 8192) - 4096;
			const z = (k % 8192) - 4096;
			const h = hash(x, z);
			if (h % 23 !== 0) continue;
			// 树之间留空，树干挡路
			const near = [...this.solid].some((s) => Math.abs(Math.floor(s / 8192) - 4096 - x) < 3 && Math.abs((s % 8192) - 4096 - z) < 3);
			if (near) continue;
			this.solid.add(k);
			boxes.push(...treeBoxes(x, col.h + 1, z, 4 + (h % 3), h % 5 === 0));
		}
		const b = new MeshBuilder(this.atlas);
		b.boxes(boxes);
		this.scene.add(new THREE.Mesh(b.build(), this.material));
	}

	private addSea(): void {
		const sea = new THREE.Mesh(
			new THREE.CircleGeometry(this.terrain.radius * 3, 48),
			new THREE.MeshBasicMaterial({ color: 0x3b9ee0, transparent: true, opacity: 0.85 }),
		);
		sea.rotation.x = -Math.PI / 2;
		sea.position.y = 1.7;
		this.scene.add(sea);
	}

	private addVillages(): void {
		const b = new MeshBuilder(this.atlas);
		for (const v of this.terrain.villages) {
			// 广场中间一块木路牌
			b.boxes([
				{ min: [v.x + 0.45, v.h + 1, v.z + 0.45], max: [v.x + 0.55, v.h + 2.4, v.z + 0.55], type: "log" },
				{ min: [v.x - 0.1, v.h + 1.8, v.z + 0.4], max: [v.x + 1.1, v.h + 2.4, v.z + 0.6], type: "planks" },
			]);
			const village = this.data.villages[v.index];
			const label = new CSS2DObject(labelCard("village", village.name, village.unit));
			label.center.set(0.5, 1); // 卡片底边（小尖角）对着路牌顶上
			label.position.set(v.x + 0.5, v.h + 2.7, v.z + 0.5);
			this.scene.add(label);
			this.villageLabels.push(label);
		}
		this.scene.add(new THREE.Mesh(b.build(), this.material));
	}

	private addPlots(): void {
		// 拾取盒比建筑大一圈，并且伸到地下 1 格：点在地块边上的地面（射线先扎进地面）也能选中
		const hitGeo = new THREE.BoxGeometry(3.6, 6, 3.6);
		const hitMat = new THREE.MeshBasicMaterial({ visible: false });
		this.k.order.forEach((id, index) => {
			const cell = this.terrain.plots.get(id)!;
			const group = new THREE.Group();
			group.position.set(cell.x, cell.h + 1, cell.z);
			this.scene.add(group);
			const hit = new THREE.Mesh(hitGeo, hitMat);
			hit.position.set(cell.x + 0.5, cell.h + 3, cell.z + 0.5); // y 从 h 到 h + 6
			hit.userData.id = id;
			this.scene.add(hit);
			const label = new CSS2DObject(labelCard("plot", this.k.topic(id).name));
			label.center.set(0.5, 1); // 卡片底边对着建筑顶上
			this.scene.add(label);
			this.plots.set(id, { cell, index, group, hit, label, grow: 1 });
		});
	}

	// 迷雾：每块没解锁的地上三块半透明的云
	private addClouds(): THREE.InstancedMesh {
		const b = new MeshBuilder(this.atlas);
		b.box(block(-0.5, -0.5, -0.5, "cloud"));
		const material = new THREE.MeshBasicMaterial({ map: this.atlas.texture, vertexColors: true, transparent: true, opacity: 0.88, depthWrite: false });
		const mesh = new THREE.InstancedMesh(b.build(), material, this.k.order.length * 3);
		const m = new THREE.Matrix4();
		this.k.order.forEach((id, i) => {
			const c = this.terrain.plots.get(id)!;
			const spots = [
				[0.1, 1.0, 0.2, 2.2],
				[1.0, 1.6, 0.9, 1.6],
				[-0.2, 1.5, 1.2, 1.4],
			];
			spots.forEach(([dx, dy, dz, s], j) => {
				m.makeScale(s, s * 0.8, s).setPosition(c.x + 0.5 + dx - 0.4, c.h + 1 + dy, c.z + 0.5 + dz - 0.5);
				this.cloudBase.push(m.clone());
				mesh.setMatrixAt(i * 3 + j, m);
			});
		});
		mesh.renderOrder = 5;
		this.scene.add(mesh);
		return mesh;
	}

	refresh(progress: Progress, now: number, changed?: string): void {
		const zero = new THREE.Matrix4().makeScale(0, 0, 0);
		for (const [id, v] of this.plots) {
			const st = statusOf(this.k, progress, id, now);
			const s = starsOf(progress, id);
			if (st === v.status && s === v.stars) continue;
			const grew = v.stars !== undefined && s > v.stars;
			v.status = st;
			v.stars = s;
			this.rebuild(v);
			if (grew || id === changed) v.grow = 0;
			for (let j = 0; j < 3; j++) this.clouds.setMatrixAt(v.index * 3 + j, st === "locked" ? this.cloudBase[v.index * 3 + j] : zero);
			v.label.element.classList.toggle("locked", st === "locked");
		}
		this.clouds.instanceMatrix.needsUpdate = true;
	}

	private addStructure(group: THREE.Group, s: Structure): void {
		if (s.boxes.length) {
			const b = new MeshBuilder(this.atlas);
			b.boxes(s.boxes);
			group.add(new THREE.Mesh(b.build(), this.material));
		}
		for (const p of s.parts) group.add(this.partMesh(p));
	}

	private partMesh(p: Part): THREE.Object3D {
		const b = new MeshBuilder(this.atlas);
		b.boxes(p.boxes);
		const mesh = new THREE.Mesh(b.build(), this.material);
		mesh.position.set(...p.pivot);
		mesh.userData.anim = p.anim;
		mesh.userData.baseY = p.pivot[1];
		return mesh;
	}

	private rebuild(v: PlotView): void {
		for (const child of v.group.children) (child as THREE.Mesh).geometry?.dispose();
		v.group.clear();
		const st = v.status!;
		let top = 0;
		if (st === "open") {
			const s = openStructure();
			this.addStructure(v.group, s);
			top = s.top;
		} else if (st !== "locked") {
			const s = buildingStructure(this.k.topic(v.cell.id).building, v.stars!);
			this.addStructure(v.group, s);
			top = s.top;
			if (st === "weeds" || st === "goblin") this.addStructure(v.group, weedsStructure());
			if (st === "goblin") this.addStructure(v.group, goblinStructure());
			if (st === "due" || st === "goblin") {
				const bubble = this.bubble(st === "due" ? "?" : "!");
				bubble.position.set(0.5, top + 0.9, 0.5);
				bubble.userData.anim = "bob";
				bubble.userData.baseY = top + 0.9;
				v.group.add(bubble);
			}
		}
		// 卡片像招牌一样挂在门上方（最高 3.4 格），站在建筑前面也能看到；矮的建筑就挂在屋顶上
		v.label.position.set(v.cell.x + 0.5, v.cell.h + 1 + Math.min(Math.max(top, 1.5) + 0.3, 3.4), v.cell.z + 0.5);
	}

	// 像素风的提示气泡（? 该复习，! 被占领）
	private bubbleTextures = new Map<string, THREE.Texture>();
	private bubble(symbol: "?" | "!"): THREE.Sprite {
		let tex = this.bubbleTextures.get(symbol);
		if (!tex) {
			const c = document.createElement("canvas");
			c.width = c.height = 16;
			const ctx = c.getContext("2d")!;
			ctx.fillStyle = symbol === "?" ? "#ffffff" : "#e5483a";
			ctx.fillRect(2, 1, 12, 11);
			ctx.fillRect(1, 2, 14, 9);
			ctx.fillRect(6, 12, 4, 2);
			ctx.fillRect(7, 14, 2, 1);
			ctx.fillStyle = symbol === "?" ? "#333333" : "#ffffff";
			if (symbol === "?") {
				ctx.fillRect(6, 3, 4, 1);
				ctx.fillRect(9, 4, 2, 2);
				ctx.fillRect(7, 6, 2, 2);
				ctx.fillRect(7, 9, 2, 1);
			} else {
				ctx.fillRect(7, 3, 2, 5);
				ctx.fillRect(7, 9, 2, 1);
			}
			tex = new THREE.CanvasTexture(c);
			tex.magFilter = THREE.NearestFilter;
			tex.minFilter = THREE.NearestFilter;
			tex.colorSpace = THREE.SRGBColorSpace;
			this.bubbleTextures.set(symbol, tex);
		}
		const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
		s.scale.set(1, 1, 1);
		return s;
	}

	select(id: string | null): void {
		this.highlight.visible = !!id;
		if (!id) return;
		const v = this.plots.get(id)!;
		const top = v.group.children.length ? new THREE.Box3().setFromObject(v.group).max.y - (v.cell.h + 1) : 1;
		const h = Math.max(1, top + 0.2);
		this.highlight.scale.set(1, h, 1);
		this.highlight.position.set(v.cell.x + 0.5, v.cell.h + 1 + h / 2, v.cell.z + 0.5);
	}

	celebrate(id: string): void {
		const v = this.plots.get(id)!;
		const n = 70;
		const pos = new Float32Array(n * 3);
		const vel = new Float32Array(n * 3);
		for (let i = 0; i < n; i++) {
			pos.set([v.cell.x + 0.5, v.cell.h + 2, v.cell.z + 0.5], i * 3);
			const a = Math.random() * Math.PI * 2;
			vel.set([Math.cos(a) * (1 + Math.random() * 2), 4 + Math.random() * 4, Math.sin(a) * (1 + Math.random() * 2)], i * 3);
		}
		const g = new THREE.BufferGeometry();
		g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
		const points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffd23f, size: 0.18, transparent: true }));
		this.scene.add(points);
		this.bursts.push({ points, v: vel, age: 0 });
	}

	// 找一个看得见这块地的站立点：先试靠王城的方向，再往两边转；距离 6 格左右，
	// 能站人、和地块高度差不超过 1，中间没有别的建筑或树挡住视线。都不行就退回最近的能站的格子。
	focusPlot(id: string): void {
		const c = this.terrain.plots.get(id)!;
		const cx = c.x + 0.5;
		const cz = c.z + 0.5;
		const base = Math.atan2(-c.z, -c.x); // 指向王城
		const blocked = (x: number, z: number) => {
			const k = this.terrain.key(x, z);
			const other = this.terrain.occupied.get(k);
			return (other !== undefined && other !== id) || this.solid.has(k);
		};
		let fallback: [number, number] | null = null;
		for (const turn of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.3, -2.3, Math.PI]) {
			for (const d of [6, 5, 7, 4, 8]) {
				const x = Math.floor(cx + Math.cos(base + turn) * d);
				const z = Math.floor(cz + Math.sin(base + turn) * d);
				const top = this.topAt(x, z);
				if (!Number.isFinite(top)) continue;
				fallback ??= [x, z];
				if (Math.abs(top - (c.h + 1)) > 1) continue;
				let clear = true;
				const sx = x + 0.5;
				const sz = z + 0.5;
				const steps = Math.ceil(Math.hypot(cx - sx, cz - sz) * 2);
				for (let i = 1; i < steps && clear; i++) {
					const px = Math.floor(sx + ((cx - sx) * i) / steps);
					const pz = Math.floor(sz + ((cz - sz) * i) / steps);
					clear = !blocked(px, pz);
				}
				if (clear) return this.standAt(x, z, cx, cz, c.h + 2.5);
			}
		}
		if (fallback) this.standAt(fallback[0], fallback[1], cx, cz, c.h + 2.5);
	}

	// 站到 (x, z) 格，看向 (lx, ly, lz)
	private standAt(x: number, z: number, lx: number, lz: number, ly: number): void {
		this.player.teleport(x + 0.5, z + 0.5, lx, lz);
		const eye = this.player.position.y + 1.62;
		this.player.pitch = Math.atan2(ly - eye, Math.hypot(lx - x - 0.5, lz - z - 0.5));
	}

	// 年级圈里数与代数扇区正中的环路上，面朝外
	focusGrade(grade: number): void {
		const ring = this.data.rings[grade - 1];
		const s = this.data.sectors[0];
		const a = (s.a1 + s.a2) / 2;
		const r = (ring.r1 - 35) / BLOCK;
		const x = Math.round(r * Math.cos(a));
		const z = Math.round(r * Math.sin(a));
		this.player.teleport(x + 0.5, z + 0.5, x * 2, z * 2);
	}

	// 王城正门外的广场边上，面朝王城
	goHome(): void {
		this.player.teleport(0.5, 13.5, 0.5, 0);
		this.player.pitch = 0.12;
	}

	setInset(right: number, bottom: number): void {
		this.inset = { right, bottom };
		this.resize();
	}

	radius(): number {
		return Math.hypot(this.player.position.x, this.player.position.z) * BLOCK;
	}

	panelChanged(open: boolean): void {
		this.panelOpen = open;
		// 面板打开时玩家不动（键盘留给答题），鼠标释放出来点按钮
		this.player.enabled = this.visible && !open;
		if (open) this.player.unlock();
		this.help.hidden = open || this.player.locked || !matchMedia("(pointer: fine)").matches;
	}

	show(visible: boolean): void {
		this.visible = visible;
		this.player.enabled = visible && !this.panelOpen;
		this.container.style.display = visible ? "" : "none";
		if (!visible) this.player.unlock();
		else this.resize();
	}

	// 准星（或手机上点到的位置）对着的地块，8 格以内
	private target(screen?: { x: number; y: number }): string | null {
		const ndc = new THREE.Vector2(0, 0);
		if (screen) {
			const r = this.renderer.domElement.getBoundingClientRect();
			ndc.set(((screen.x - r.left) / r.width) * 2 - 1, -((screen.y - r.top) / r.height) * 2 + 1);
		}
		this.raycaster.setFromCamera(ndc, this.camera);
		this.raycaster.far = screen ? 30 : 9;
		const hits = this.raycaster.intersectObjects(
			[...this.plots.values()].map((v) => v.hit),
			false,
		);
		return hits.length ? (hits[0].object.userData.id as string) : null;
	}

	private interact(screen?: { x: number; y: number }): void {
		if (this.panelOpen && !screen) return;
		const id = this.target(screen);
		if (id) this.onPick(id);
	}

	private resize(): void {
		const w = this.container.clientWidth || window.innerWidth;
		const h = this.container.clientHeight || window.innerHeight;
		this.renderer.setSize(w, h);
		this.labels.setSize(w, h);
		this.camera.aspect = w / h;
		if (this.inset.right || this.inset.bottom) this.camera.setViewOffset(w, h, this.inset.right / 2, this.inset.bottom / 2, w, h);
		else this.camera.clearViewOffset();
		this.camera.updateProjectionMatrix();
	}

	update(dt: number): void {
		if (!this.visible) return;
		this.clock += dt;
		this.player.update(dt, this.camera);

		// 准星提示
		const hover = matchMedia("(pointer: fine)").matches && this.player.locked ? this.target() : null;
		if (hover !== this.hover) {
			this.hover = hover;
			this.hint.hidden = !hover;
			if (hover) this.hint.textContent = `点击或按 E：${this.k.topic(hover).name}`;
		}

		const p = this.player.position;
		for (const v of this.plots.values()) {
			const dx = v.cell.x - p.x;
			const dz = v.cell.z - p.z;
			const d2 = dx * dx + dz * dz;
			v.label.visible = d2 < 16 * 16;
			if (d2 > 40 * 40) continue;
			if (v.grow < 1) {
				v.grow = Math.min(1, v.grow + dt / 0.8);
				const s = Math.max(0.05, 1 + 2.2 * Math.pow(v.grow - 1, 3) + 1.2 * Math.pow(v.grow - 1, 2));
				v.group.scale.set(s, s, s);
			}
			for (const o of v.group.children) {
				const a = o.userData.anim;
				if (a === "spin") o.rotation.z += dt * 1.5;
				else if (a === "wave") o.rotation.y = Math.sin(this.clock * 4 + v.index) * 0.35;
				else if (a === "pulse") {
					const s = 1 + 0.06 * Math.sin(this.clock * 5);
					o.scale.set(s, 1, s);
				} else if (a === "bob") o.position.y = o.userData.baseY + Math.abs(Math.sin(this.clock * 3 + v.index)) * 0.15;
			}
		}
		for (const l of this.villageLabels) {
			const d = Math.hypot(l.position.x - p.x, l.position.z - p.z);
			l.visible = d < 40;
		}
		this.clouds.position.y = Math.sin(this.clock * 0.8) * 0.08;

		this.bursts = this.bursts.filter((b) => {
			b.age += dt;
			const pos = b.points.geometry.getAttribute("position") as THREE.BufferAttribute;
			for (let i = 0; i < pos.count; i++) {
				b.v[i * 3 + 1] -= 12 * dt;
				pos.setXYZ(i, pos.getX(i) + b.v[i * 3] * dt, pos.getY(i) + b.v[i * 3 + 1] * dt, pos.getZ(i) + b.v[i * 3 + 2] * dt);
			}
			pos.needsUpdate = true;
			if (b.age > 1.5) {
				this.scene.remove(b.points);
				b.points.geometry.dispose();
				return false;
			}
			return true;
		});

		this.renderer.render(this.scene, this.camera);
		this.labels.render(this.scene, this.camera);
	}
}
