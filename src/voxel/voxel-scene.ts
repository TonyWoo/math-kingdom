// 第一人称方块世界：把同一个王国画成方块，玩家在里面走。实现 View 接口，和地图视角共用同一套界面和进度。
//   地形：按 32×32 分块生成网格（只画露在外面的面），一个材质（贴图集 + 顶点明暗），不用光照。
//   地块：每块地一组网格，按状态和星级用 structures.ts 的图纸搭；迷雾是半透明的云方块（一个 InstancedMesh）。
//   互动：准星对着（手机上是点到）地块时显示提示，点击或按 E 打开详情面板。

import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { CSS3DObject, CSS3DRenderer } from "three/addons/renderers/CSS3DRenderer.js";
import { type Kingdom, type Progress, type Status, stars as starsOf, status as statusOf } from "../core/kingdom";
import type { KingdomData } from "../core/types";
import { labelCard } from "../scene/label";
import { type Mood, TEACHERS } from "../scene/teachers";
import type { BattleView, Dialogue, View, VillageMark } from "../scene/view";
import { type Battle, type BattleEvent, current as battleTarget } from "../core/defense";
import { speak, stopSpeaking } from "../ui/speech";
import { type Atlas, createAtlas } from "./atlas";
import { type Box, MeshBuilder, block } from "./mesher";
import { type Part, type Structure, buildingStructure, castleStructure, goblinStructure, knightBoxes, openStructure, teacherBoxes, towerBoxes, treeBoxes, weedsStructure } from "./structures";
import { BASE, BLOCK, type Ground, type PlotCell, type TerrainData, attackPath, buildTerrain } from "./terrain";
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

	// ---- 对话模式：动物老师 + 浮在空中的全息面板（CSS3D，HTML 按钮直接点） ----
	private css3d = new CSS3DRenderer();
	private holo: CSS3DObject;
	private holoBody: HTMLElement;
	private holoName: HTMLElement;
	private teacher: THREE.Group | null = null;
	private teacherMeshes = new Map<string, THREE.BufferGeometry>();
	private speech: CSS2DObject;
	private mood: { mood: Mood; t: number } = { mood: "talk", t: 0 };
	private talking = false;
	private selectedId: string | null = null;
	private voice = true;
	// ---- 保卫战 ----
	private villageHits: THREE.Mesh[] = [];
	private villageFlags = new THREE.Group();
	private fight: {
		b: Battle;
		pts: THREE.Vector3[];
		lengths: number[];
		towers: THREE.Vector3[];
		group: THREE.Group;
		enemies: Map<number, { mesh: THREE.Group; label: CSS2DObject; gone: number }>;
		beams: { mesh: THREE.Mesh; age: number }[];
	} | null = null;
	private knightGeo: THREE.BufferGeometry | null = null;
	private hurt: HTMLElement;
	// 竖屏保卫战：全息面板贴在屏幕底部，老师的台词是面板上方的横幅（3D 里放不下，会挡住路线）
	private dock: HTMLElement;
	private docked = false;
	readonly battle: BattleView = {
		start: (b) => this.startBattle(b),
		events: (ev) => this.battleEvents(ev),
		end: () => this.endBattle(),
	};

	readonly dialogue: Dialogue = {
		host: () => this.holoBody,
		say: (text, mood) => this.say(text, mood),
	};
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
		this.css3d.domElement.className = "holo-layer";
		container.appendChild(this.css3d.domElement);
		const holo = document.createElement("div");
		holo.className = "holo";
		holo.innerHTML = '<div class="holo-bar"><span class="holo-name"></span><button class="holo-voice" title="老师说话的声音">🔊</button></div><div class="holo-body"></div>';
		this.holoBody = holo.querySelector(".holo-body")!;
		this.holoName = holo.querySelector(".holo-name")!;
		try {
			this.voice = localStorage.getItem("math-kingdom/voice") !== "off";
		} catch {
			// 读不到就用默认（开）
		}
		const voiceBtn = holo.querySelector<HTMLButtonElement>(".holo-voice")!;
		const showVoice = () => (voiceBtn.textContent = this.voice ? "🔊" : "🔇");
		showVoice();
		voiceBtn.onclick = () => {
			this.voice = !this.voice;
			showVoice();
			if (!this.voice) stopSpeaking();
			try {
				localStorage.setItem("math-kingdom/voice", this.voice ? "on" : "off");
			} catch {
				// 存不了就只在这次有效
			}
		};
		this.holo = new CSS3DObject(holo);
		const bubbleEl = document.createElement("div");
		bubbleEl.className = "label speech";
		this.speech = new CSS2DObject(bubbleEl);
		this.speech.center.set(0.5, 1);

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

		this.dock = document.createElement("div");
		this.dock.className = "holo-dock";
		this.dock.innerHTML = '<div class="dock-say"></div>';
		this.dock.hidden = true;
		container.appendChild(this.dock);
		this.hurt = document.createElement("div");
		this.hurt.className = "fp-hurt";
		container.appendChild(this.hurt);
		this.scene.add(this.villageFlags);

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
			// 路牌的拾取盒：对着点击是“保卫村庄”
			const hit = new THREE.Mesh(new THREE.BoxGeometry(1.6, 4, 1.6), new THREE.MeshBasicMaterial({ visible: false }));
			hit.position.set(v.x + 0.5, v.h + 2, v.z + 0.5);
			hit.userData.id = `village:${v.index}`;
			this.scene.add(hit);
			this.villageHits.push(hit);
		}
		this.scene.add(new THREE.Mesh(b.build(), this.material));
	}

	// 路牌顶上的旗：可以保卫的插红旗，守住过的插金旗
	villages(marks: VillageMark[]): void {
		for (const c of this.villageFlags.children) (c as THREE.Mesh).geometry.dispose();
		this.villageFlags.clear();
		const b = new MeshBuilder(this.atlas);
		marks.forEach((m, i) => {
			if (m === "none") return;
			const v = this.terrain.villages[i];
			const y = v.h + 2.4;
			b.box({ min: [v.x + 0.46, y, v.z + 0.46], max: [v.x + 0.54, y + 1.1, v.z + 0.54], type: "log" });
			b.box({ min: [v.x + 0.54, y + 0.6, v.z + 0.47], max: [v.x + 1.25, y + 1.05, v.z + 0.53], type: m === "ready" ? "wool_red" : "gold" });
		});
		if (!b.empty) this.villageFlags.add(new THREE.Mesh(b.build(), this.material));
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
		// 对话中跳到另一块地（点了先修）：老师跟着换地方
		const restart = this.teacher !== null && id !== this.selectedId;
		this.selectedId = id;
		if (restart) {
			this.endDialogue();
			if (id) this.startDialogue();
		}
		this.highlight.visible = !!id && !id.startsWith("village:");
		if (!id || id.startsWith("village:")) return;
		const v = this.plots.get(id)!;
		const top = v.group.children.length ? new THREE.Box3().setFromObject(v.group).max.y - (v.cell.h + 1) : 1;
		const h = Math.max(1, top + 0.2);
		this.highlight.scale.set(1, h, 1);
		this.highlight.position.set(v.cell.x + 0.5, v.cell.h + 1 + h / 2, v.cell.z + 0.5);
	}

	celebrate(id: string): void {
		const v = this.plots.get(id)!;
		this.burstAt(new THREE.Vector3(v.cell.x + 0.5, v.cell.h + 2, v.cell.z + 0.5), 0xffd23f, 70);
	}

	private burstAt(at: THREE.Vector3, color: number, n: number): void {
		const pos = new Float32Array(n * 3);
		const vel = new Float32Array(n * 3);
		for (let i = 0; i < n; i++) {
			pos.set([at.x, at.y, at.z], i * 3);
			const a = Math.random() * Math.PI * 2;
			vel.set([Math.cos(a) * (1 + Math.random() * 2), 4 + Math.random() * 4, Math.sin(a) * (1 + Math.random() * 2)], i * 3);
		}
		const g = new THREE.BufferGeometry();
		g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
		const points = new THREE.Points(g, new THREE.PointsMaterial({ color, size: 0.18, transparent: true }));
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
		if (open && !this.teacher && this.selectedId && this.visible) this.startDialogue();
		if (!open) this.endDialogue();
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
		if (!visible) {
			this.player.unlock();
			this.endDialogue();
		}
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
			[...this.villageHits, ...[...this.plots.values()].map((v) => v.hit)],
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
		this.css3d.setSize(w, h);
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

		this.animateTeacher(dt);
		this.animateBattle(dt);
		this.renderer.render(this.scene, this.camera);
		this.labels.render(this.scene, this.camera);
		if (this.teacher) this.css3d.render(this.scene, this.camera);
	}

	// 对话开始：老师站在玩家面前偏左的地上，全息面板浮在偏右（竖屏时在下方），都朝着玩家
	private startDialogue(): void {
		const t = TEACHERS[this.domainOf(this.selectedId!)];
		this.holoName.textContent = `${t.name}的全息面板`;
		const yaw = this.player.yaw;
		const battle = this.fight !== null;
		if (!battle) this.player.pitch = -0.06; // 保卫战时保持低头看路线
		this.player.update(0, this.camera);
		const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
		const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
		const eye = this.camera.position.clone();
		const portrait = this.camera.aspect < 1;

		let geo = this.teacherMeshes.get(t.animal);
		if (!geo) {
			const b = new MeshBuilder(this.atlas);
			b.boxes(teacherBoxes(t.animal));
			geo = b.build();
			this.teacherMeshes.set(t.animal, geo);
		}
		const group = new THREE.Group();
		const body = new THREE.Mesh(geo, this.material);
		group.add(body);
		// 老师站的地方：左前方的空地（不能在建筑、树、王城里面）；电脑上找不到就换到右边
		let spot = eye.clone().add(f.clone().multiplyScalar(portrait ? 3.4 : 3.1)).add(r.clone().multiplyScalar(portrait ? -0.3 : -1.05));
		let ground = this.player.position.y;
		if (!portrait) {
			search: for (const side of [-1, 1]) {
				for (const d of [3.1, 2.6, 3.6, 2.2]) {
					for (const lateral of [1.05, 0.8, 1.35]) {
						const p = eye.clone().add(f.clone().multiplyScalar(d)).add(r.clone().multiplyScalar(side * lateral));
						const top = this.topAt(Math.floor(p.x), Math.floor(p.z));
						if (Number.isFinite(top) && Math.abs(top - this.player.position.y) <= 1) {
							spot = p;
							ground = top;
							break search;
						}
					}
				}
			}
		} else {
			// 竖屏时面板占下半屏，老师站在一朵小云上浮在面板上方（保卫战时镜头低着头，老师放低一点）
			ground = eye.y - (battle ? 1.15 : 0.7);
			if (battle) spot = eye.clone().add(f.clone().multiplyScalar(3.6)).add(r.clone().multiplyScalar(-0.6));
		}
		if (portrait) {
			const b = new MeshBuilder(this.atlas);
			b.box({ min: [-0.5, -0.28, -0.4], max: [0.5, 0, 0.4], type: "cloud" });
			b.box({ min: [-0.3, -0.36, -0.25], max: [0.35, -0.2, 0.3], type: "cloud" });
			group.add(new THREE.Mesh(b.build(), this.material));
		}
		group.position.set(spot.x, ground, spot.z);
		group.rotation.y = yaw + (portrait ? 0.15 : 0.35);
		group.scale.setScalar(0.95);
		group.userData.baseY = ground;
		this.scene.add(group);
		this.teacher = group;
		this.speech.position.set(0, 1.55, 0);
		group.add(this.speech);

		// 全息面板：1 像素 = PX 格
		// 保卫战时面板小一点、往右下挪，把中间留给进攻路线
		const px = portrait ? (battle ? 0.0019 : 0.0024) : battle ? 0.0022 : 0.0027;
		const panelPos = portrait
			? eye.clone().add(f.clone().multiplyScalar(1.75)).add(new THREE.Vector3(0, battle ? -0.8 : -0.6, 0))
			: battle
				? eye.clone().add(f.clone().multiplyScalar(2.0)).add(r.clone().multiplyScalar(0.95)).add(new THREE.Vector3(0, -0.38, 0))
				: eye.clone().add(f.clone().multiplyScalar(2.0)).add(r.clone().multiplyScalar(0.6)).add(new THREE.Vector3(0, -0.1, 0));
		this.holo.position.copy(panelPos);
		// 面板正对着镜头：跟着朝向转，保卫战低头时也跟着前倾
		this.holo.rotation.set(battle ? this.player.pitch : 0, yaw + (portrait ? 0 : -0.28), 0, "YXZ");
		this.holo.scale.setScalar(px);
		this.holo.element.classList.toggle("portrait", portrait);
		this.docked = portrait && battle;
		if (this.docked) {
			group.visible = false;
			this.holo.element.style.transform = "";
			this.dock.appendChild(this.holo.element);
			this.dock.hidden = false;
		} else {
			this.scene.add(this.holo);
		}
		this.container.classList.add("in-dialogue");
		this.highlight.visible = false;
		this.mood = { mood: "talk", t: 0 };
	}

	// 选中的是地块还是村庄路牌（"village:序号"）
	private domainOf(id: string) {
		return id.startsWith("village:") ? this.data.villages[Number(id.slice(8))].domain : this.k.topic(id).domain;
	}

	private endDialogue(): void {
		if (!this.teacher) return;
		this.teacher.remove(this.speech);
		this.scene.remove(this.teacher);
		this.scene.remove(this.holo);
		if (this.docked) {
			this.holo.element.remove();
			this.dock.hidden = true;
			this.docked = false;
		}
		this.teacher = null;
		this.talking = false;
		stopSpeaking();
		this.container.classList.remove("in-dialogue");
		this.highlight.visible = !!this.selectedId && !this.selectedId.startsWith("village:");
	}

	private say(text: string, mood: Mood): void {
		const el = this.speech.element;
		el.innerHTML = "";
		const who = document.createElement("b");
		who.textContent = this.selectedId ? TEACHERS[this.domainOf(this.selectedId)].name : "";
		const line = document.createElement("span");
		line.textContent = text;
		el.append(who, line);
		if (this.docked) {
			const banner = this.dock.querySelector(".dock-say")!;
			banner.innerHTML = "";
			banner.append(who.cloneNode(true), line.cloneNode(true));
		}
		this.mood = { mood, t: 0 };
		this.talking = true;
		if (this.voice) speak(text);
	}

	// 老师的动作：说话时轻轻点头，答对跳一下，答错歪头，通关转一圈跳两下
	private animateTeacher(dt: number): void {
		const g = this.teacher;
		if (!g) return;
		const m = this.mood;
		m.t += dt;
		const body = g.children[0];
		const base = g.userData.baseY as number;
		body.rotation.set(0, 0, 0);
		body.position.set(0, 0, 0);
		if (m.mood === "happy" && m.t < 1) {
			body.position.y = Math.abs(Math.sin(m.t * Math.PI * 2)) * 0.35;
		} else if (m.mood === "cheer" && m.t < 1.6) {
			body.position.y = Math.abs(Math.sin(m.t * Math.PI * 2.5)) * 0.45;
			body.rotation.y = Math.min(1, m.t / 0.8) * Math.PI * 2;
		} else if (m.mood === "sad" && m.t < 2.5) {
			body.rotation.z = Math.sin(Math.min(1, m.t * 3) * Math.PI * 0.5) * 0.22;
		} else if (this.talking && m.t < 3) {
			body.rotation.x = Math.sin(m.t * 9) * 0.05;
		} else {
			body.position.y = Math.sin(this.clock * 2) * 0.02; // 站着轻轻呼吸
		}
		g.position.y = base;
	}

	// ---- 保卫战 ----

	// 摆战场：算进攻路线；玩家站到广场后面（背对进攻方向的那一侧），面朝来路；广场两边各一座防御塔
	private startBattle(b: Battle): void {
		this.endBattle();
		const cells = attackPath(this.terrain, b.village, this.data, this.solid) ?? attackPath(this.terrain, b.village, this.data);
		if (!cells) return;
		const pts = cells.map(([x, z]) => new THREE.Vector3(x + 0.5, this.terrain.column(x, z)!.h + 1, z + 0.5));
		const lengths = [0];
		for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + pts[i].distanceTo(pts[i - 1]));
		const plaza = pts.at(-1)!;
		const from = pts[Math.max(0, pts.length - 8)];
		const d = plaza.clone().sub(from).setY(0).normalize();
		const perp = new THREE.Vector3(-d.z, 0, d.x);
		// 站位：沿进攻方向往后退 3–6 格，找能站的格子
		let stand = plaza.clone();
		for (const back of [4, 3, 5, 6, 2]) {
			const p = plaza.clone().add(d.clone().multiplyScalar(back));
			if (Number.isFinite(this.topAt(Math.floor(p.x), Math.floor(p.z)))) {
				stand = p;
				break;
			}
		}
		const look = pts[Math.floor(pts.length * 0.4)];
		const sx = Math.floor(stand.x);
		const sz = Math.floor(stand.z);
		this.player.teleport(sx + 0.5, sz + 0.5, look.x, look.z);
		// 守望台：在玩家脚下搭 3 格高的木台，站上去越过房子看整条进攻路线
		const groundY = this.player.position.y;
		const deck = groundY + 3;
		this.player.lockY = deck;
		const eyeY = deck + 1.62;
		this.player.pitch = Math.atan2(look.y + 0.8 - eyeY, Math.hypot(look.x - sx - 0.5, look.z - sz - 0.5));
		this.player.update(0, this.camera);

		const group = new THREE.Group();
		const towers: THREE.Vector3[] = [];
		const b2 = new MeshBuilder(this.atlas);
		for (const [ox, oz] of [
			[-1, -1],
			[1, -1],
			[-1, 1],
			[1, 1],
		]) {
			b2.box({ min: [sx + 0.5 + ox * 1.1 - 0.12, groundY, sz + 0.5 + oz * 1.1 - 0.12], max: [sx + 0.5 + ox * 1.1 + 0.12, deck, sz + 0.5 + oz * 1.1 + 0.12], type: "log" });
		}
		b2.box({ min: [sx - 0.8, deck - 0.2, sz - 0.8], max: [sx + 1.8, deck, sz + 1.8], type: "planks" });
		for (const side of [-1.8, 1.8]) {
			const p = plaza.clone().add(perp.clone().multiplyScalar(side)).add(d.clone().multiplyScalar(0.8));
			const col = this.terrain.column(Math.floor(p.x), Math.floor(p.z));
			const y = col ? col.h + 1 : plaza.y;
			b2.boxes(towerBoxes(), [p.x, y, p.z]);
			towers.push(new THREE.Vector3(p.x, y + 3.1, p.z));
		}
		group.add(new THREE.Mesh(b2.build(), this.material));
		this.scene.add(group);
		if (!this.knightGeo) {
			const kb = new MeshBuilder(this.atlas);
			kb.boxes(knightBoxes());
			this.knightGeo = kb.build();
		}
		this.fight = { b, pts, lengths, towers, group, enemies: new Map(), beams: [] };
		// 镜头换了位置，老师和全息面板重新摆
		if (this.teacher) {
			this.endDialogue();
			this.startDialogue();
		}
		this.container.classList.add("in-battle");
	}

	private endBattle(): void {
		const f = this.fight;
		if (!f) return;
		// 从守望台下来，回到地面
		this.player.lockY = null;
		for (const e of f.enemies.values()) {
			e.mesh.remove(e.label);
			f.group.remove(e.mesh);
		}
		for (const beam of f.beams) f.group.remove(beam.mesh);
		this.scene.remove(f.group);
		this.fight = null;
		this.container.classList.remove("in-battle");
	}

	// 路上的位置：progress 0 在村口，1 在广场
	private along(progress: number): { pos: THREE.Vector3; dir: THREE.Vector3 } {
		const f = this.fight!;
		const total = f.lengths.at(-1)!;
		const s = Math.max(0, Math.min(1, progress)) * total;
		let i = 1;
		while (i < f.lengths.length - 1 && f.lengths[i] < s) i++;
		const a = f.pts[i - 1];
		const b = f.pts[i];
		const t = f.lengths[i] === f.lengths[i - 1] ? 0 : (s - f.lengths[i - 1]) / (f.lengths[i] - f.lengths[i - 1]);
		return { pos: a.clone().lerp(b, t), dir: b.clone().sub(a).normalize() };
	}

	private battleEvents(ev: BattleEvent[]): void {
		const f = this.fight;
		if (!f) return;
		for (const e of ev) {
			if (e.type === "zap") {
				const at = this.along(e.enemy.progress).pos.add(new THREE.Vector3(0, 0.8, 0));
				const tower = f.towers.reduce((best, t) => (t.distanceTo(at) < best.distanceTo(at) ? t : best));
				const len = tower.distanceTo(at);
				const beam = new THREE.Mesh(
					new THREE.CylinderGeometry(0.06, 0.06, len, 6),
					new THREE.MeshBasicMaterial({ color: 0x7ff6ff, transparent: true, opacity: 0.9 }),
				);
				beam.position.copy(tower).add(at).multiplyScalar(0.5);
				beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), at.clone().sub(tower).normalize());
				f.group.add(beam);
				f.beams.push({ mesh: beam, age: 0 });
				this.burstAt(at, 0xffd23f, 50);
				this.burstAt(at, 0xff7ad9, 30);
			} else if (e.type === "rush") {
				const entry = f.enemies.get(e.enemy.id);
				entry?.label.element.classList.add("rush");
				setTimeout(() => entry?.label.element.classList.remove("rush"), 700);
			} else if (e.type === "through") {
				this.hurt.classList.remove("on");
				void this.hurt.offsetWidth; // 重新触发动画
				this.hurt.classList.add("on");
			}
		}
	}

	private animateBattle(dt: number): void {
		const f = this.fight;
		if (!f) return;
		const target = battleTarget(f.b);
		for (const e of f.b.enemies) {
			let entry = f.enemies.get(e.id);
			if (e.state === "waiting") continue;
			if (!entry) {
				const mesh = new THREE.Group();
				mesh.add(new THREE.Mesh(this.knightGeo!, this.material));
				const el = document.createElement("div");
				el.className = "label card shield";
				const label = new CSS2DObject(el);
				label.center.set(0.5, 1);
				label.position.set(0, 1.45, 0);
				mesh.add(label);
				f.group.add(mesh);
				entry = { mesh, label, gone: 0 };
				f.enemies.set(e.id, entry);
			}
			const el = entry.label.element;
			if (el.textContent !== e.number) el.textContent = e.number;
			el.classList.toggle("target", target?.id === e.id);
			if (e.state === "walking") {
				const { pos, dir } = this.along(e.progress);
				entry.mesh.position.copy(pos);
				entry.mesh.position.y += Math.abs(Math.sin(this.clock * 6 + e.id)) * 0.06;
				entry.mesh.rotation.y = Math.atan2(dir.x, dir.z);
			} else if (entry.gone < 1) {
				// 被打中：变成星星后缩小、往回跑；冲进广场：缩小消失
				entry.gone = Math.min(1, entry.gone + dt / 1.2);
				if (e.state === "zapped") {
					const back = this.along(Math.max(0, e.progress - entry.gone * 0.3));
					entry.mesh.position.copy(back.pos);
					entry.mesh.rotation.y = Math.atan2(-back.dir.x, -back.dir.z);
				}
				const s = 1 - entry.gone;
				entry.mesh.scale.setScalar(Math.max(0.01, s));
				entry.label.visible = false;
				if (entry.gone >= 1) {
					entry.mesh.remove(entry.label);
					f.group.remove(entry.mesh);
				}
			}
		}
		f.beams = f.beams.filter((beam) => {
			beam.age += dt;
			(beam.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - beam.age * 2.5);
			if (beam.age > 0.4) {
				f.group.remove(beam.mesh);
				beam.mesh.geometry.dispose();
				return false;
			}
			return true;
		});
	}
}
