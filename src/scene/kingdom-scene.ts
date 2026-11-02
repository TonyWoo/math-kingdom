// 3D 王国场景：地形、村庄小路、地块（底座颜色、建筑、迷雾、提示）、名字标签、选中高亮、相机飞行和庆祝动画。
// 只负责显示和拾取；状态由 core/kingdom.ts 计算，app.ts 把进度传进来（refresh）。

import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { type Kingdom, type Progress, type Status, stars as starsOf, status as statusOf } from "../core/kingdom";
import { ringOf, type KingdomData } from "../core/types";
import { rewardFor } from "../core/defense";
import { type Assets, type ModelName, instantiate } from "./assets";
import { labelCard } from "./label";
import type { Spot, View, VillageMark } from "./view";
import { createBubble, createBuilding, createGoblin, createOpenMarker, createWeeds, geo, mat } from "./buildings";
import { BASE_H, COLORS, SCALE, createWorld, terraceHeight } from "./world";

const GRADE_NAME = ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级"];

const PAD_COLOR: Record<Status, number> = {
	locked: 0xd3d8e0, // 浅灰，和上面的白雾融在一起
	open: 0xf6e3a6,
	built: 0x6db355,
	due: 0x6db355,
	weeds: 0x8f9a4a,
	goblin: 0x8f9a4a,
};

interface PlotView {
	id: string;
	index: number;
	pos: THREE.Vector3;
	group: THREE.Group;
	label: CSS2DObject;
	status?: Status;
	stars?: number;
	grow: number; // 建造动画进度 0..1，1 表示没有动画
}

interface Tween {
	t: number;
	duration: number;
	fromTarget: THREE.Vector3;
	toTarget: THREE.Vector3;
	fromOffset: THREE.Vector3;
	toOffset: THREE.Vector3;
}

interface Burst {
	points: THREE.Points;
	velocity: Float32Array;
	age: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

export class KingdomScene implements View {
	readonly renderer: THREE.WebGLRenderer;
	readonly camera: THREE.PerspectiveCamera;
	readonly controls: MapControls;
	onPick: (id: string | null) => void = () => {};
	onSpot: (spot: Spot) => void = () => {};
	private world!: THREE.Group;
	private marker = new THREE.Group(); // “我在这里”的小人
	private spot: Spot | null = null;

	private scene = new THREE.Scene();
	private labels: CSS2DRenderer;
	private data: KingdomData;
	private k: Kingdom;
	private plots = new Map<string, PlotView>();
	private pads: THREE.InstancedMesh;
	private fog: THREE.InstancedMesh;
	private fogBase: THREE.Matrix4[] = [];
	// 按年级筛选（null = 全部显示）：实例网格靠把不显示的那份矩阵缩成 0 来隐藏，所以要留底稿矩阵
	private gradeFilter: number | null = null;
	private padBase: THREE.Matrix4[] = [];
	private pathsMesh!: THREE.InstancedMesh;
	private pathsBase: THREE.Matrix4[] = [];
	private pathGrades: number[] = []; // 每段路属于哪个村庄的年级，和 paths 的实例一一对应
	private plazasMesh!: THREE.InstancedMesh;
	private plazasBase: THREE.Matrix4[] = [];
	private lastMarks: VillageMark[] = [];
	private villageLabels: CSS2DObject[] = [];
	private gradeLabels: CSS2DObject[] = [];
	private selection = new THREE.Group();
	private selectRing: THREE.Mesh;
	private tween: Tween | null = null;
	private bursts: Burst[] = [];
	private clock = 0;
	private raycaster = new THREE.Raycaster();
	private container: HTMLElement;

	private assets: Assets | null;
	private towns = new THREE.Group(); // 村庄的旗子、城镇城墙和奖励装饰

	constructor(container: HTMLElement, data: KingdomData, k: Kingdom, assets: Assets | null) {
		this.assets = assets;
		this.container = container;
		this.data = data;
		this.k = k;

		this.renderer = new THREE.WebGLRenderer({ antialias: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		container.appendChild(this.renderer.domElement);

		this.labels = new CSS2DRenderer();
		this.labels.domElement.className = "labels";
		container.appendChild(this.labels.domElement);

		this.scene.background = new THREE.Color(COLORS.sky);
		this.scene.fog = new THREE.Fog(COLORS.sky, 40, 110);
		this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8d7b5a, 1.7));
		const sun = new THREE.DirectionalLight(0xfff4e0, 1.8);
		sun.position.set(12, 25, 18);
		this.scene.add(sun);

		this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
		this.controls = new MapControls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.12;
		this.controls.screenSpacePanning = false;
		this.controls.minDistance = 2.5;
		this.controls.maxDistance = 70;
		this.controls.maxPolarAngle = 1.2;
		this.controls.zoomToCursor = true;

		this.world = createWorld(data, assets);
		this.scene.add(this.world);
		this.buildMarker();
		this.addPaths();
		this.pads = this.addPads();
		this.fog = this.addFog();
		this.addLabels();

		this.selectRing = new THREE.Mesh(
			new THREE.TorusGeometry(0.44, 0.04, 8, 40),
			new THREE.MeshBasicMaterial({ color: 0xff8a1f }),
		);
		this.selectRing.rotation.x = -Math.PI / 2;
		this.selectRing.visible = false;
		this.scene.add(this.selectRing, this.selection);

		this.setupPicking();
		this.resize();
		window.addEventListener("resize", () => this.resize());
	}

	// 地块在场景里的位置（台地顶面）
	plotPosition(id: string): THREE.Vector3 {
		const t = this.k.topic(id);
		return new THREE.Vector3(t.x * SCALE, terraceHeight(t.grade), t.y * SCALE);
	}

	// 年级圈在数与代数扇区正中的位置
	gradePosition(grade: number): THREE.Vector3 {
		const ring = ringOf(this.data, grade);
		const s = this.data.sectors[0];
		const a = (s.a1 + s.a2) / 2;
		const r = ((ring.r1 + ring.r2) / 2) * SCALE;
		return new THREE.Vector3(r * Math.cos(a), terraceHeight(grade), r * Math.sin(a));
	}

	private addPaths(): void {
		const S = SCALE;
		const dummy = new THREE.Object3D();
		const segs: [THREE.Vector3, THREE.Vector3, number][] = [];
		for (const v of this.data.villages) {
			const h = terraceHeight(v.grade) + 0.012;
			const center = new THREE.Vector3(v.x * S, h, v.y * S);
			// 村口：沿半径往里接到环路上（是一段坡道）
			const ring = ringOf(this.data, v.grade);
			const a = Math.atan2(v.y, v.x);
			const rr = ring.r1 * S - 0.3;
			segs.push([new THREE.Vector3(rr * Math.cos(a), BASE_H + 0.01, rr * Math.sin(a)), center, 0.16]);
			this.pathGrades.push(v.grade);
			for (const id of v.plots) {
				const p = this.plotPosition(id);
				p.y = h;
				segs.push([center, p, 0.08]);
				this.pathGrades.push(v.grade);
			}
		}
		const paths = new THREE.InstancedMesh(geo.box, mat(0xeed59a), segs.length);
		segs.forEach(([a, b, w], i) => {
			dummy.position.copy(a).add(b).multiplyScalar(0.5);
			dummy.lookAt(b);
			dummy.scale.set(w, 0.02, a.distanceTo(b));
			dummy.updateMatrix();
			paths.setMatrixAt(i, dummy.matrix);
			this.pathsBase.push(dummy.matrix.clone());
		});
		this.pathsMesh = paths;
		this.scene.add(paths);

		// 村庄中心的小广场：有模型就用模型（路牌朝着王城），没有就用一块圆石板
		const plazaModel = this.assets?.models.get("village_plaza")?.geometry;
		const plazas = plazaModel
			? new THREE.InstancedMesh(plazaModel, this.assets!.material, this.data.villages.length)
			: new THREE.InstancedMesh(geo.cyl8, mat(0xe2c58a), this.data.villages.length);
		this.data.villages.forEach((v, i) => {
			if (plazaModel) {
				dummy.position.set(v.x * S, terraceHeight(v.grade) + 0.004, v.y * S);
				dummy.rotation.set(0, Math.atan2(-v.x, -v.y), 0);
				dummy.scale.set(1, 1, 1);
			} else {
				dummy.position.set(v.x * S, terraceHeight(v.grade) + 0.02, v.y * S);
				dummy.rotation.set(0, 0, 0);
				dummy.scale.set(0.42, 0.04, 0.42);
			}
			dummy.updateMatrix();
			plazas.setMatrixAt(i, dummy.matrix);
			this.plazasBase.push(dummy.matrix.clone());
		});
		this.plazasMesh = plazas;
		this.scene.add(plazas);
	}

	private addPads(): THREE.InstancedMesh {
		const pads = new THREE.InstancedMesh(geo.cyl8, new THREE.MeshLambertMaterial({ flatShading: true }), this.k.order.length);
		const dummy = new THREE.Object3D();
		this.k.order.forEach((id, index) => {
			const pos = this.plotPosition(id);
			dummy.position.set(pos.x, pos.y + 0.03, pos.z);
			dummy.scale.set(0.72, 0.06, 0.72);
			dummy.updateMatrix();
			pads.setMatrixAt(index, dummy.matrix);
			this.padBase.push(dummy.matrix.clone());
			pads.setColorAt(index, new THREE.Color(PAD_COLOR.locked));
			const group = new THREE.Group();
			group.position.set(pos.x, pos.y + 0.06, pos.z);
			group.userData.id = id;
			this.scene.add(group);
			// 名字卡片挂在地块下方，小尖角朝上指着它
			const label = new CSS2DObject(labelCard("plot", this.k.topic(id).name, undefined, "up"));
			label.position.set(pos.x, pos.y - 0.05, pos.z + 0.45);
			label.center.set(0.5, 0);
			this.scene.add(label);
			this.plots.set(id, { id, index, pos, group, label, grow: 1 });
		});
		this.scene.add(pads);
		return pads;
	}

	// 迷雾：每块没解锁的地上三团半透明的白雾（一个 InstancedMesh，解锁的那几团缩成 0）
	private addFog(): THREE.InstancedMesh {
		// 平滑着色加一点自发光，看起来是软软的云团而不是石头
		const material = new THREE.MeshLambertMaterial({
			color: 0xffffff,
			emissive: 0xaab4c6,
			transparent: true,
			opacity: 0.9,
			depthWrite: false,
		});
		// 有云朵模型就用它（本身就是扁的），否则用圆球压扁
		const cloud = this.assets?.models.get("cloud")?.geometry;
		const fog = new THREE.InstancedMesh(cloud ?? geo.puff, material, this.k.order.length * 3);
		const dummy = new THREE.Object3D();
		this.k.order.forEach((id, index) => {
			const pos = this.plotPosition(id);
			for (let j = 0; j < 3; j++) {
				const a = index * 2.4 + j * 2.1;
				dummy.position.set(pos.x + Math.cos(a) * 0.24, pos.y + 0.16 + j * 0.05, pos.z + Math.sin(a) * 0.24);
				const s = 0.55 + ((index + j * 3) % 4) * 0.08;
				if (cloud) dummy.scale.set(s * 1.25, s * 1.25, s * 1.25);
				else dummy.scale.set(s, s * 0.55, s);
				dummy.rotation.set(0, a, 0);
				dummy.updateMatrix();
				this.fogBase.push(dummy.matrix.clone());
				fog.setMatrixAt(index * 3 + j, dummy.matrix);
			}
		});
		fog.renderOrder = 5;
		this.scene.add(fog);
		return fog;
	}

	private addLabels(): void {
		this.data.villages.forEach((v) => {
			const label = new CSS2DObject(labelCard("village", v.name, v.unit));
			label.center.set(0.5, 1);
			// 名牌放在村庄外侧（远离王城的一边）
			const ring = ringOf(this.data, v.grade);
			const a = Math.atan2(v.y, v.x);
			const r = (ring.r2 + 25) * SCALE;
			label.position.set(r * Math.cos(a), terraceHeight(v.grade) + 0.1, r * Math.sin(a));
			this.scene.add(label);
			this.villageLabels.push(label);
		});
		// 年级标签：写在最接近“正南”（朝向初始镜头）的放射大道上
		let avenue = 0;
		let best = Infinity;
		for (const s of this.data.sectors) {
			const d = Math.abs(Math.sin(s.a1) - 1) + Math.abs(Math.cos(s.a1));
			if (d < best) {
				best = d;
				avenue = s.a1;
			}
		}
		this.data.rings.forEach((ring) => {
			const el = document.createElement("div");
			el.className = "label grade";
			el.textContent = GRADE_NAME[ring.grade - 1] ?? `${ring.grade}年级`;
			const label = new CSS2DObject(el);
			const r = ((ring.r1 + ring.r2) / 2) * SCALE;
			label.position.set(r * Math.cos(avenue), BASE_H + 0.1, r * Math.sin(avenue));
			this.scene.add(label);
			this.gradeLabels.push(label);
		});
		const el = document.createElement("div");
		el.className = "label castle";
		el.textContent = "王城";
		const castle = new CSS2DObject(el);
		castle.position.set(0, this.assets ? 4.2 : 3.6, 0);
		this.scene.add(castle);
	}

	// 按进度更新所有地块；changed 里的地块播放建造动画。
	refresh(progress: Progress, now: number, changed?: string): void {
		const color = new THREE.Color();
		const zero = new THREE.Matrix4().makeScale(0, 0, 0);
		for (const view of this.plots.values()) {
			const st = statusOf(this.k, progress, view.id, now);
			const s = starsOf(progress, view.id);
			if (st !== view.status || s !== view.stars) {
				const grew = view.stars !== undefined && s > view.stars;
				view.status = st;
				view.stars = s;
				this.rebuild(view);
				if (grew || view.id === changed) view.grow = 0;
				this.pads.setColorAt(view.index, color.setHex(PAD_COLOR[st]));
				const filteredOut = this.gradeFilter !== null && this.k.topic(view.id).grade !== this.gradeFilter;
				for (let j = 0; j < 3; j++) {
					this.fog.setMatrixAt(view.index * 3 + j, st === "locked" && !filteredOut ? this.fogBase[view.index * 3 + j] : zero);
				}
				view.label.element.classList.toggle("locked", st === "locked");
			}
		}
		this.pads.instanceColor!.needsUpdate = true;
		this.fog.instanceMatrix.needsUpdate = true;
	}

	private rebuild(view: PlotView): void {
		view.group.clear();
		const t = this.k.topic(view.id);
		const st = view.status!;
		if (st === "open") {
			view.group.add(createOpenMarker());
			return;
		}
		if (st === "locked") return;
		const b = createBuilding(t.building, view.stars!);
		b.userData.building = true;
		view.group.add(b);
		if (st === "weeds" || st === "goblin") view.group.add(createWeeds());
		if (st === "goblin") {
			const goblin = createGoblin();
			goblin.position.set(0.26, 0, 0.26);
			view.group.add(goblin);
		}
		if (st === "due" || st === "goblin") {
			// 气泡浮在建筑顶上（瞭望塔比别的高）
			const top = new THREE.Box3().setFromObject(b).max.y;
			const bubble = createBubble(st === "due" ? "?" : "!");
			bubble.userData.baseY = top + 0.28;
			bubble.position.set(0.2, bubble.userData.baseY, 0);
			view.group.add(bubble);
		}
	}

	// 选中一块地：橙色圆圈，hard 先修用橙色弧线连起来，soft 先修淡黄，后续蓝色。
	select(id: string | null): void {
		for (const child of this.selection.children) {
			(child as THREE.Mesh).geometry.dispose();
		}
		this.selection.clear();
		this.selectRing.visible = !!id;
		if (!id || id.startsWith("village:")) {
			this.selectRing.visible = false; // 村庄没有地块选中圈
			return;
		}
		const p = this.plots.get(id)!.pos;
		this.selectRing.position.set(p.x, p.y + 0.08, p.z);
		const arc = (from: THREE.Vector3, to: THREE.Vector3, color: number, radius: number) => {
			const mid = from.clone().add(to).multiplyScalar(0.5);
			mid.y += 0.6 + from.distanceTo(to) * 0.18;
			const curve = new THREE.QuadraticBezierCurve3(from.clone().setY(from.y + 0.15), mid, to.clone().setY(to.y + 0.15));
			const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, radius, 5), new THREE.MeshBasicMaterial({ color }));
			this.selection.add(tube);
		};
		for (const n of this.k.next.get(id)!) arc(p, this.plots.get(n)!.pos, 0x4a8ae0, 0.03);
		for (const n of this.k.soft.get(id)!) arc(this.plots.get(n)!.pos, p, 0xf6d36a, 0.022);
		for (const n of this.k.prereq.get(id)!) arc(this.plots.get(n)!.pos, p, 0xff8a1f, 0.04);
	}

	// 竖屏（手机）水平视野窄，同样的距离看到的东西少，镜头要拉远一些
	private fit(distance: number): number {
		return this.camera.aspect < 1 ? distance / Math.sqrt(this.camera.aspect) : distance;
	}

	// 镜头飞到 target，distance 是镜头到目标的距离（不给就保持现在的）；topDown 时从正上方往下看。
	flyTo(target: THREE.Vector3, distance?: number, topDown?: boolean): void {
		const offset = this.camera.position.clone().sub(this.controls.target);
		const toOffset = offset.clone();
		if (topDown) toOffset.set(0, 1, 0.02);
		toOffset.setLength(distance === undefined ? offset.length() : this.fit(distance));
		this.tween = {
			t: 0,
			duration: 0.9,
			fromTarget: this.controls.target.clone(),
			toTarget: target.clone(),
			fromOffset: offset,
			toOffset,
		};
	}

	// 斜俯视（默认）和正俯视之间切换
	toggleTopDown(): boolean {
		const offset = this.camera.position.clone().sub(this.controls.target);
		const top = offset.y / offset.length() < 0.97;
		const d = offset.length();
		const toOffset = top ? new THREE.Vector3(0, d, d * 0.02) : new THREE.Vector3(0, d * 0.78, d * 0.62);
		this.tween = {
			t: 0,
			duration: 0.6,
			fromTarget: this.controls.target.clone(),
			toTarget: this.controls.target.clone(),
			fromOffset: offset,
			toOffset,
		};
		return top;
	}

	// 直接设置镜头（启动时）
	lookAt(target: THREE.Vector3, distance: number): void {
		distance = this.fit(distance);
		this.controls.target.copy(target);
		this.camera.position.copy(target).add(new THREE.Vector3(0, distance * 0.78, distance * 0.62));
		this.controls.update();
	}

	// 建成或升级时的庆祝：金色粒子向上炸开
	celebrate(id: string): void {
		const p = this.plots.get(id)!.pos;
		const n = 80;
		const positions = new Float32Array(n * 3);
		const velocity = new Float32Array(n * 3);
		for (let i = 0; i < n; i++) {
			positions.set([p.x, p.y + 0.4, p.z], i * 3);
			const a = Math.random() * Math.PI * 2;
			const s = 0.6 + Math.random() * 1.4;
			velocity.set([Math.cos(a) * s * 0.6, 2 + Math.random() * 2.5, Math.sin(a) * s * 0.6], i * 3);
		}
		const g = new THREE.BufferGeometry();
		g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		const points = new THREE.Points(
			g,
			this.assets
				? new THREE.PointsMaterial({ map: this.assets.star, size: 0.16, transparent: true, depthWrite: false, alphaTest: 0.05 })
				: new THREE.PointsMaterial({ color: 0xffd040, size: 0.09, transparent: true, depthWrite: false }),
		);
		this.scene.add(points);
		this.bursts.push({ points, velocity, age: 0 });
	}

	private setupPicking(): void {
		const el = this.renderer.domElement;
		let down: { x: number; y: number } | null = null;
		el.addEventListener("pointerdown", (e) => {
			down = { x: e.clientX, y: e.clientY };
		});
		el.addEventListener("pointerup", (e) => {
			if (!down) return;
			const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
			down = null;
			if (moved > 6) return;
			const id = this.pick(e.clientX, e.clientY);
			// 点到哪里，小人就站到哪里：点到地块时站在地块靠王城一侧、面朝它；点到空地就站在那里
			const spot = id
				? id.startsWith("village:")
					? this.spotNearVillage(Number(id.slice(8)))
					: this.spotNear(id)
				: this.groundSpot(e.clientX, e.clientY);
			if (spot) {
				this.setSpot(spot);
				this.onSpot(spot);
			}
			this.onPick(id);
		});
	}

	// 屏幕坐标下的地块：先找射线打中的底座或建筑，没有就找射线落点附近最近的地块。
	pick(clientX: number, clientY: number): string | null {
		const rect = this.renderer.domElement.getBoundingClientRect();
		const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
		this.raycaster.setFromCamera(ndc, this.camera);
		const groups = [...this.plots.values()].filter((v) => v.group.visible).map((v) => v.group);
		const hits = this.raycaster.intersectObjects([this.pads, this.plazasMesh, this.towns, ...groups], true);
		for (const h of hits) {
			if (h.object === this.pads && h.instanceId !== undefined) return this.k.order[h.instanceId];
			// 村庄广场：只有插了旗（可以保卫或已守住）的村庄能点开，就是保卫战在地图上的入口
			if (h.object === this.plazasMesh && h.instanceId !== undefined) {
				const m = this.lastMarks[h.instanceId];
				if (m === "ready" || m === "defended") return `village:${h.instanceId}`;
				continue;
			}
			let o: THREE.Object3D | null = h.object;
			while (o && o.userData.id === undefined && o.userData.village === undefined) o = o.parent;
			if (o?.userData.village !== undefined) return `village:${o.userData.village as number}`;
			if (o) return o.userData.id as string;
		}
		// 打在地面上：取 0.5 以内最近的地块
		const ground = this.raycaster.ray.origin.clone();
		const dir = this.raycaster.ray.direction;
		let best: string | null = null;
		let bestD = 0.5;
		for (const v of this.plots.values()) {
			if (!v.group.visible) continue; // 被筛选隐藏的地块点不到
			const t = (v.pos.y - ground.y) / dir.y;
			if (t <= 0) continue;
			const x = ground.x + dir.x * t;
			const z = ground.z + dir.z * t;
			const d = Math.hypot(x - v.pos.x, z - v.pos.z);
			if (d < bestD) {
				best = v.id;
				bestD = d;
			}
		}
		return best;
	}

	// 面板挡住的部分（像素）：右侧面板给 right，底部抽屉给 bottom。画面中心相应往左或往上挪，选中的地块不会被盖住。
	private inset = { right: 0, bottom: 0 };

	setInset(right: number, bottom: number): void {
		this.inset = { right, bottom };
		this.applyViewOffset();
	}

	private applyViewOffset(): void {
		const w = this.container.clientWidth;
		const h = this.container.clientHeight;
		if (this.inset.right || this.inset.bottom) {
			this.camera.setViewOffset(w, h, this.inset.right / 2, this.inset.bottom / 2, w, h);
		} else {
			this.camera.clearViewOffset();
		}
		this.camera.updateProjectionMatrix();
	}

	resize(): void {
		const w = this.container.clientWidth;
		const h = this.container.clientHeight;
		this.renderer.setSize(w, h);
		this.labels.setSize(w, h);
		this.camera.aspect = w / h;
		this.applyViewOffset();
	}

	// 可以保卫的村庄插红旗；守住的变成城镇：金旗、沿村庄扇形边界的一圈矮墙（内侧中间留门）、广场旁的奖励装饰
	villages(marks: VillageMark[]): void {
		this.lastMarks = marks;
		if (!this.towns.parent) this.scene.add(this.towns);
		this.towns.traverse((o) => {
			if (o instanceof THREE.Mesh && o.userData.own) o.geometry.dispose();
		});
		this.towns.clear();
		const stones: THREE.Matrix4[] = [];
		const dummy = new THREE.Object3D();
		marks.forEach((m, i) => {
			if (m === "none") return;
			const v = this.data.villages[i];
			if (this.gradeFilter !== null && v.grade !== this.gradeFilter) return; // 筛选时别的年级的村庄不画旗和城墙
			const h = terraceHeight(v.grade);
			const cx = v.x * SCALE;
			const cz = v.y * SCALE;
			// 旗杆和旗子，插在村庄广场边上
			const pole = new THREE.Mesh(geo.cyl8, mat(0x7a5233));
			pole.scale.set(0.035, 0.9, 0.035);
			pole.position.set(cx + 0.18, h + 0.45, cz);
			pole.userData.village = i; // 点旗杆/旗子就是点这个村庄（保卫战入口）
			const flag = new THREE.Mesh(geo.box, mat(m === "ready" ? 0xe0463a : 0xf2c230));
			flag.scale.set(0.3, 0.18, 0.02);
			flag.position.set(cx + 0.34, h + 0.8, cz);
			flag.userData.wave = true;
			flag.userData.village = i;
			this.towns.add(pole, flag);
			if (m !== "defended") return;
			// 城墙：沿扇形边界放一排小石块
			const ring = ringOf(this.data, v.grade);
			const pad = 8;
			const r1 = (ring.r1 + pad) * SCALE;
			const r2 = (ring.r2 - pad) * SCALE;
			const amid = (v.a1 + v.a2) / 2;
			const put = (r: number, a: number, along: number) => {
				dummy.position.set(r * Math.cos(a), h + 0.07, r * Math.sin(a));
				dummy.rotation.set(0, -along, 0);
				dummy.scale.set(0.16, 0.14, 0.08);
				dummy.updateMatrix();
				stones.push(dummy.matrix.clone());
			};
			const arc = (r: number, gate: boolean) => {
				const n = Math.max(3, Math.ceil(((v.a2 - v.a1) * r) / 0.14));
				for (let j = 0; j <= n; j++) {
					const a = v.a1 + ((v.a2 - v.a1) * j) / n;
					if (gate && Math.abs(a - amid) * r < 0.22) continue;
					put(r, a, a + Math.PI / 2);
				}
			};
			arc(r2, false);
			arc(r1, true);
			for (const a of [v.a1, v.a2]) {
				const n = Math.ceil((r2 - r1) / 0.14);
				for (let j = 1; j < n; j++) put(r1 + ((r2 - r1) * j) / n, a, a);
			}
			// 奖励装饰
			const reward = `deco_${rewardFor(i).id}` as ModelName;
			const deco = this.assets?.models.has(reward) ? instantiate(this.assets, reward) : new THREE.Mesh(geo.cyl8, mat(0xf2c230));
			if (deco instanceof THREE.Mesh) deco.scale.set(0.25, 0.3, 0.25);
			else deco.scale.setScalar(1.1);
			deco.position.set(cx - 0.32, h + (deco instanceof THREE.Mesh ? 0.15 : 0), cz + 0.05);
			this.towns.add(deco);
		});
		if (stones.length) {
			const walls = new THREE.InstancedMesh(geo.box, mat(0xb9b3a6), stones.length);
			stones.forEach((m, j) => walls.setMatrixAt(j, m));
			walls.userData.own = true;
			this.towns.add(walls);
		}
	}

	// ---- “我在这里”的小人 ----

	// 方块风格的小朋友：蓝衣服、黄帽子，脚下一圈会呼吸的光环，头上一张“我”字卡片
	private buildMarker(): void {
		const g = this.marker;
		const add = (geom: THREE.BufferGeometry, color: number, sx: number, sy: number, sz: number, y: number, x = 0, z = 0) => {
			const m = new THREE.Mesh(geom, mat(color));
			m.scale.set(sx, sy, sz);
			m.position.set(x, y, z);
			g.add(m);
		};
		add(geo.box, 0x2f3a5a, 0.05, 0.1, 0.05, 0.05, -0.035);
		add(geo.box, 0x2f3a5a, 0.05, 0.1, 0.05, 0.05, 0.035);
		add(geo.box, 0x3d7be0, 0.13, 0.13, 0.08, 0.165);
		add(geo.box, 0xf3c9a0, 0.11, 0.11, 0.11, 0.285);
		add(geo.box, 0xf2c230, 0.13, 0.04, 0.13, 0.355);
		add(geo.box, 0x222222, 0.02, 0.02, 0.01, 0.295, -0.025, 0.056);
		add(geo.box, 0x222222, 0.02, 0.02, 0.01, 0.295, 0.025, 0.056);
		const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 6, 28), new THREE.MeshBasicMaterial({ color: 0x5ff3ff }));
		ring.rotation.x = -Math.PI / 2;
		ring.position.y = 0.01;
		ring.userData.ring = true;
		g.add(ring);
		const label = new CSS2DObject(labelCard("plot", "我在这里"));
		label.element.classList.add("me");
		label.center.set(0.5, 1);
		label.position.set(0, 0.48, 0);
		g.add(label);
		g.scale.setScalar(1.6); // 比建筑小，但一眼能看到
		g.visible = false;
		this.scene.add(g);
	}

	// 布局坐标 → 场景里那一点的地面高度（往下打一条射线到地形上）
	private groundAt(x: number, z: number): number {
		this.raycaster.set(new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0));
		// 跳过森林（InstancedMesh）和王城，只要地面
		const hit = this.raycaster.intersectObject(this.world, true).find((h) => h.object.visible && !(h.object instanceof THREE.InstancedMesh));
		return hit ? hit.point.y : terraceHeight(1);
	}

	// 村庄中心靠王城一侧，面朝广场
	private spotNearVillage(index: number): Spot {
		const v = this.data.villages[index];
		const len = Math.hypot(v.x, v.y) || 1;
		return { x: v.x - (v.x / len) * 60, y: v.y - (v.y / len) * 60, lookX: v.x, lookY: v.y };
	}

	// 地块靠王城一侧 0.6 个单位，面朝地块
	private spotNear(id: string): Spot {
		const t = this.k.topic(id);
		const len = Math.hypot(t.x, t.y) || 1;
		return { x: t.x - (t.x / len) * 60, y: t.y - (t.y / len) * 60, lookX: t.x, lookY: t.y };
	}

	// 点在空地上：射线打到地形的那一点；面朝最近的地块（离得太远就面朝外）
	private groundSpot(clientX: number, clientY: number): Spot | null {
		const rect = this.renderer.domElement.getBoundingClientRect();
		const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
		this.raycaster.setFromCamera(ndc, this.camera);
		const hit = this.raycaster.intersectObject(this.world, true)[0];
		if (!hit) return null;
		const x = hit.point.x / SCALE;
		const y = hit.point.z / SCALE;
		if (Math.hypot(x, y) > this.data.rings.at(-1)!.r2 + 150) return null; // 点到海上了
		let best = null as null | { x: number; y: number; d: number };
		for (const t of this.data.topics) {
			const d = Math.hypot(t.x - x, t.y - y);
			if (!best || d < best.d) best = { x: t.x, y: t.y, d };
		}
		if (best && best.d < 300) return { x, y, lookX: best.x, lookY: best.y };
		const len = Math.hypot(x, y) || 1;
		return { x, y, lookX: x + (x / len) * 100, lookY: y + (y / len) * 100 };
	}

	getSpot(): Spot | null {
		return this.spot;
	}

	setSpot(spot: Spot, focus = false): void {
		this.spot = spot;
		const x = spot.x * SCALE;
		const z = spot.y * SCALE;
		this.marker.position.set(x, this.groundAt(x, z), z);
		this.marker.rotation.y = Math.atan2(spot.lookX - spot.x, spot.lookY - spot.y);
		this.marker.visible = true;
		if (focus) this.lookAt(this.marker.position.clone(), 7);
	}

	// ---- View 接口：界面通过这些方法操作地图视角 ----

	focusPlot(id: string, immediate = false): void {
		if (immediate) this.lookAt(this.plotPosition(id), 8);
		else this.flyTo(this.plotPosition(id), 7);
	}

	focusGrade(grade: number, immediate = false): void {
		// 距离按圈的大小来：外圈大，要站得远一点才看得全
		const ring = ringOf(this.data, grade);
		const dist = Math.min(38, Math.max(12, ring.r2 * SCALE * 1.5));
		if (immediate) this.lookAt(this.gradePosition(grade), dist);
		else this.flyTo(this.gradePosition(grade), dist);
	}

	// 只显示一个年级：台地、地块、迷雾、道路、村庄都只留这一圈，地图等于缩到这一年级。null 恢复全部。
	setGradeFilter(grade: number | null): void {
		this.gradeFilter = grade;
		const zero = new THREE.Matrix4().makeScale(0, 0, 0);
		const show = (g: number) => grade === null || g === grade;
		this.world.traverse((o) => {
			if (o.userData.grade !== undefined) o.visible = show(o.userData.grade as number);
		});
		for (const view of this.plots.values()) {
			const on = show(this.k.topic(view.id).grade);
			view.group.visible = on;
			this.pads.setMatrixAt(view.index, on ? this.padBase[view.index] : zero);
			for (let j = 0; j < 3; j++) {
				this.fog.setMatrixAt(view.index * 3 + j, on && view.status === "locked" ? this.fogBase[view.index * 3 + j] : zero);
			}
		}
		this.pads.instanceMatrix.needsUpdate = true;
		this.fog.instanceMatrix.needsUpdate = true;
		this.pathGrades.forEach((g, i) => this.pathsMesh.setMatrixAt(i, show(g) ? this.pathsBase[i] : zero));
		this.pathsMesh.instanceMatrix.needsUpdate = true;
		this.data.villages.forEach((v, i) => this.plazasMesh.setMatrixAt(i, show(v.grade) ? this.plazasBase[i] : zero));
		this.plazasMesh.instanceMatrix.needsUpdate = true;
		if (this.lastMarks.length) this.villages(this.lastMarks);
		// 镜头由界面层决定（定位到这个年级最早的未学内容），这里只管显隐
	}

	goHome(): void {
		this.flyTo(new THREE.Vector3(0, 1, 0), 34);
	}

	radius(): number {
		const t = this.controls.target;
		return Math.hypot(t.x, t.z) / SCALE;
	}

	panelChanged(): void {}

	show(visible: boolean): void {
		this.container.style.display = visible ? "" : "none";
		if (visible) this.resize();
	}

	// 镜头离目标的距离（决定显示哪些标签）
	get distance(): number {
		return this.camera.position.distanceTo(this.controls.target);
	}

	update(dt: number): void {
		this.clock += dt;
		if (this.tween) {
			const tw = this.tween;
			tw.t = Math.min(1, tw.t + dt / tw.duration);
			const e = easeInOut(tw.t);
			this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
			const off = tw.fromOffset.clone().lerp(tw.toOffset, e);
			off.setLength(THREE.MathUtils.lerp(tw.fromOffset.length(), tw.toOffset.length(), e));
			this.camera.position.copy(this.controls.target).add(off);
			if (tw.t >= 1) this.tween = null;
		}
		this.controls.update();
		this.animatePlots(dt);
		this.animateBursts(dt);
		this.updateLabels();
		const pulse = 1 + 0.08 * Math.sin(this.clock * 5);
		this.selectRing.scale.set(pulse, pulse, pulse);
		if (this.marker.visible) {
			const ring = this.marker.children.find((c) => c.userData.ring)!;
			const s = 1 + 0.15 * Math.sin(this.clock * 4);
			ring.scale.set(s, s, s);
			this.marker.children[3].position.y = 0.285 + Math.abs(Math.sin(this.clock * 3)) * 0.015;
		}
		this.fog.position.y = Math.sin(this.clock * 0.8) * 0.03;
		this.renderer.render(this.scene, this.camera);
		this.labels.render(this.scene, this.camera);
	}

	private animatePlots(dt: number): void {
		const near = this.controls.target;
		for (const v of this.plots.values()) {
			if (v.grow < 1) {
				v.grow = Math.min(1, v.grow + dt / 0.8);
				const s = Math.max(0.05, easeOutBack(v.grow));
				v.group.scale.set(s, s, s);
			}
			// 只给镜头附近的地块做小动画
			if (Math.abs(v.pos.x - near.x) > 14 || Math.abs(v.pos.z - near.z) > 14) continue;
			v.group.traverse((o) => {
				if (o.userData.spin) o.rotation.z += dt * o.userData.spin;
				if (o.userData.pulse) {
					const s = 1 + 0.12 * Math.sin(this.clock * 4);
					o.scale.set(s, s, s);
				}
				if (o.userData.bob) o.position.y = (o.userData.baseY ?? 0) + Math.abs(Math.sin(this.clock * 3 + v.index)) * 0.06;
				if (o.userData.wave) o.rotation.y = Math.sin(this.clock * 4 + v.index) * 0.3;
			});
		}
	}

	private animateBursts(dt: number): void {
		this.bursts = this.bursts.filter((b) => {
			b.age += dt;
			const pos = b.points.geometry.getAttribute("position") as THREE.BufferAttribute;
			for (let i = 0; i < pos.count; i++) {
				b.velocity[i * 3 + 1] -= 4.5 * dt;
				pos.setXYZ(
					i,
					pos.getX(i) + b.velocity[i * 3] * dt,
					pos.getY(i) + b.velocity[i * 3 + 1] * dt,
					pos.getZ(i) + b.velocity[i * 3 + 2] * dt,
				);
			}
			pos.needsUpdate = true;
			(b.points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - b.age / 1.6);
			if (b.age >= 1.6) {
				this.scene.remove(b.points);
				b.points.geometry.dispose();
				return false;
			}
			return true;
		});
	}

	// 远处不显示地块名字，太远不显示村庄名，太近不显示年级
	private updateLabels(): void {
		const d = this.distance;
		const target = this.controls.target;
		const showPlots = d < 12;
		const range = d * 0.9 + 2;
		const f = this.gradeFilter;
		for (const v of this.plots.values()) {
			v.label.visible =
				showPlots &&
				Math.abs(v.pos.x - target.x) < range &&
				Math.abs(v.pos.z - target.z) < range &&
				(f === null || this.k.topic(v.id).grade === f);
		}
		this.villageLabels.forEach((l, i) => {
			l.visible = d < 34 && (f === null || this.data.villages[i].grade === f);
		});
		this.gradeLabels.forEach((l, i) => {
			l.visible = d > 6 && (f === null || this.data.rings[i].grade === f);
		});
	}
}
