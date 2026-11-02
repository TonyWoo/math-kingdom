// 第一人称玩家：走路、看、跳、碰撞。
//   电脑：点一下画面锁定鼠标；WASD / 方向键移动，Shift 跑，空格跳，鼠标看；点击或 E 和准星对着的地块互动，Esc 释放鼠标；滚轮放大缩小。
//   手机：左半屏按住拖动是摇杆，右半屏拖动是转头，轻点是和点到的东西互动；双指捏合放大缩小。
// 碰撞只看每一列地面的高度：比脚高不超过 STEP 的自动迈上去，更高的（台阶、建筑、树干）挡住。

import * as THREE from "three";

const SPEED = 4.3;
const RUN = 6.5;
const GRAVITY = 26;
const JUMP = 8;
const STEP = 1.05;
const RADIUS = 0.3;
const EYE = 1.62;

// (x, z) 这一列能站的顶面高度；走不过去时返回 Infinity
export type TopAt = (x: number, z: number) => number;

export class Player {
	readonly position = new THREE.Vector3(); // 脚底
	yaw = 0;
	pitch = -0.15;
	private vy = 0;
	private onGround = false;
	private keys = new Set<string>();
	private stick = { x: 0, y: 0 }; // 摇杆：x 右，y 前
	private topAt: TopAt;
	private el: HTMLElement;
	private joystick: HTMLElement;
	enabled = false;
	// 站在守望台上（保卫战）：固定高度，不受重力
	lockY: number | null = null;
	onInteract: (screen?: { x: number; y: number }) => void = () => {};
	onLockChange: (locked: boolean) => void = () => {};
	onPinch: (ratio: number) => void = () => {}; // 双指捏合缩放：ratio 是这一次移动里两指距离的变化倍数
	private pinchDist = 0;

	constructor(el: HTMLElement, topAt: TopAt) {
		this.el = el;
		this.topAt = topAt;
		this.joystick = document.createElement("div");
		this.joystick.className = "joystick";
		this.joystick.innerHTML = "<i></i>";
		this.joystick.hidden = true;
		el.parentElement!.appendChild(this.joystick);
		this.bind();
	}

	get locked(): boolean {
		return document.pointerLockElement === this.el;
	}

	lock(): void {
		if (!this.locked && matchMedia("(pointer: fine)").matches) {
			this.el.requestPointerLock?.()?.catch?.(() => {});
		}
	}

	unlock(): void {
		if (this.locked) document.exitPointerLock();
		this.keys.clear();
		this.stick = { x: 0, y: 0 };
	}

	// 站到 (x, z)，脸朝 (lookX, lookZ)
	teleport(x: number, z: number, lookX: number, lookZ: number): void {
		const top = this.topAt(Math.floor(x), Math.floor(z));
		this.position.set(x, Number.isFinite(top) ? top : 10, z);
		this.vy = 0;
		this.yaw = Math.atan2(-(lookX - x), -(lookZ - z));
		this.pitch = -0.12;
	}

	private bind(): void {
		const el = this.el;
		el.addEventListener("click", (e) => {
			if (!this.enabled) return;
			if (this.locked) this.onInteract();
			else if (e.pointerType !== "touch") this.lock();
		});
		document.addEventListener("pointerlockchange", () => this.onLockChange(this.locked));
		document.addEventListener("mousemove", (e) => {
			if (!this.enabled || !this.locked) return;
			this.turn(e.movementX * 0.0024, e.movementY * 0.0024);
		});
		window.addEventListener("keydown", (e) => {
			if (!this.enabled || (e.target as HTMLElement)?.closest?.("dialog, .panel")) return;
			this.keys.add(e.code);
			if (e.code === "KeyE" && this.locked) this.onInteract();
			if (e.code === "Space" && this.locked) e.preventDefault();
		});
		window.addEventListener("keyup", (e) => this.keys.delete(e.code));
		window.addEventListener("blur", () => this.keys.clear());

		// 触摸：每根手指记住它是摇杆还是转头；两根手指同时在就改成捏合缩放
		const touches = new Map<number, { kind: "move" | "look" | "pinch"; x0: number; y0: number; x: number; y: number; t: number }>();
		el.addEventListener("touchstart", (e) => {
			if (!this.enabled) return;
			e.preventDefault();
			for (const t of Array.from(e.changedTouches)) {
				const kind = t.clientX < window.innerWidth / 2 ? "move" : "look";
				touches.set(t.identifier, { kind, x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY, t: performance.now() });
				if (kind === "move") {
					this.joystick.hidden = false;
					this.joystick.style.left = `${t.clientX}px`;
					this.joystick.style.top = `${t.clientY}px`;
				}
			}
			if (touches.size === 2) {
				for (const s of touches.values()) s.kind = "pinch";
				this.stick = { x: 0, y: 0 };
				this.joystick.hidden = true;
				const [a, b] = [...touches.values()];
				this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
			}
		}, { passive: false });
		el.addEventListener("touchmove", (e) => {
			if (!this.enabled) return;
			e.preventDefault();
			for (const t of Array.from(e.changedTouches)) {
				const s = touches.get(t.identifier);
				if (!s) continue;
				if (s.kind === "pinch") {
					s.x = t.clientX;
					s.y = t.clientY;
					if (touches.size === 2 && this.pinchDist > 0) {
						const [a, b] = [...touches.values()];
						const d = Math.hypot(a.x - b.x, a.y - b.y);
						if (d > 0) {
							this.onPinch(d / this.pinchDist);
							this.pinchDist = d;
						}
					}
				} else if (s.kind === "look") {
					this.turn((t.clientX - s.x) * 0.006, (t.clientY - s.y) * 0.006);
				} else {
					const dx = t.clientX - s.x0;
					const dy = t.clientY - s.y0;
					const len = Math.min(1, Math.hypot(dx, dy) / 60);
					const a = Math.atan2(dy, dx);
					this.stick = { x: Math.cos(a) * len, y: -Math.sin(a) * len };
					(this.joystick.firstElementChild as HTMLElement).style.transform = `translate(${Math.cos(a) * len * 36}px, ${Math.sin(a) * len * 36}px)`;
				}
				s.x = t.clientX;
				s.y = t.clientY;
			}
		}, { passive: false });
		const end = (e: TouchEvent) => {
			for (const t of Array.from(e.changedTouches)) {
				const s = touches.get(t.identifier);
				touches.delete(t.identifier);
				if (!s) continue;
				if (s.kind === "move") {
					this.stick = { x: 0, y: 0 };
					this.joystick.hidden = true;
				}
				if (s.kind === "pinch") {
					this.pinchDist = 0;
					continue; // 捏合的手指抬起来不算点按
				}
				// 轻点（没怎么动、时间短）当作互动；左半屏的轻点也算
				if (Math.hypot(t.clientX - s.x0, t.clientY - s.y0) < 10 && performance.now() - s.t < 350) {
					this.onInteract({ x: t.clientX, y: t.clientY });
				}
			}
		};
		el.addEventListener("touchend", end);
		el.addEventListener("touchcancel", end);
	}

	private turn(dx: number, dy: number): void {
		this.yaw -= dx;
		this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy));
	}

	// 一个点的四周（玩家半径内）各列里最高的顶面
	private highest(x: number, z: number): number {
		let top = -Infinity;
		for (const ox of [-RADIUS, RADIUS]) {
			for (const oz of [-RADIUS, RADIUS]) {
				top = Math.max(top, this.topAt(Math.floor(x + ox), Math.floor(z + oz)));
			}
		}
		return top;
	}

	update(dt: number, camera: THREE.PerspectiveCamera): void {
		if (this.enabled) {
			let mx = this.stick.x;
			let my = this.stick.y;
			if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) my += 1;
			if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) my -= 1;
			if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) mx -= 1;
			if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) mx += 1;
			const len = Math.hypot(mx, my);
			if (len > 1) {
				mx /= len;
				my /= len;
			}
			const speed = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? RUN : SPEED;
			const sin = Math.sin(this.yaw);
			const cos = Math.cos(this.yaw);
			const vx = (-sin * my + cos * mx) * speed * dt;
			const vz = (-cos * my - sin * mx) * speed * dt;
			// 分轴移动：一个方向被挡住时还能沿另一个方向贴着走
			for (const [ax, d] of [
				["x", vx],
				["z", vz],
			] as const) {
				if (d === 0) continue;
				const nx = ax === "x" ? this.position.x + d : this.position.x;
				const nz = ax === "z" ? this.position.z + d : this.position.z;
				const top = this.highest(nx, nz);
				if (top - this.position.y <= (this.onGround ? STEP : 0.2)) {
					this.position.x = nx;
					this.position.z = nz;
					if (this.onGround && top > this.position.y) this.position.y = top; // 迈上台阶
				}
			}
			if (this.keys.has("Space") && this.onGround) {
				this.vy = JUMP;
				this.onGround = false;
			}
		}
		if (this.lockY !== null) {
			this.position.y = this.lockY;
			this.vy = 0;
			this.onGround = true;
			camera.position.set(this.position.x, this.position.y + EYE, this.position.z);
			camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
			return;
		}
		this.vy -= GRAVITY * dt;
		this.position.y += this.vy * dt;
		const floor = this.highest(this.position.x, this.position.z);
		if (this.position.y <= floor) {
			this.position.y = Number.isFinite(floor) ? floor : this.position.y;
			this.vy = 0;
			this.onGround = true;
		} else {
			this.onGround = false;
		}
		camera.position.set(this.position.x, this.position.y + EYE, this.position.z);
		camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
	}
}
