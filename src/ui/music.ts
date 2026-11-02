// 音乐：背景、保卫战、庆祝三段，文件在 public/audio/（全部 CC0，出处见 public/audio/CREDITS.md）。
// 浏览器禁止页面自动出声，所以第一次点按或按键之后才开始放背景音乐。
// 开关记在 localStorage 的 mk-music，设置对话框里切换。

const KEY = "mk-music";

class Music {
	private bgm = this.make("bgm.mp3", true, 0.32);
	private battleA = this.make("battle.mp3", true, 0.42);
	private fanfareA = this.make("fanfare.mp3", false, 0.55);
	private loop: HTMLAudioElement | null = null; // 正在循环的那一段
	private unlocked = false;
	enabled = localStorage.getItem(KEY) !== "off";

	constructor() {
		const unlock = () => {
			this.unlocked = true;
			if (!this.enabled) return;
			if (this.loop) void this.loop.play().catch(() => {});
			else this.playLoop(this.bgm);
		};
		window.addEventListener("pointerdown", unlock, { once: true });
		window.addEventListener("keydown", unlock, { once: true });
	}

	private make(file: string, loop: boolean, volume: number): HTMLAudioElement {
		const a = new Audio(import.meta.env.BASE_URL + "audio/" + file);
		a.loop = loop;
		a.volume = volume;
		a.preload = "auto";
		return a;
	}

	private playLoop(a: HTMLAudioElement): void {
		if (this.loop === a) return;
		this.loop?.pause();
		this.loop = a;
		if (this.unlocked && this.enabled) void a.play().catch(() => {});
	}

	// 回到平时：背景音乐
	home(): void {
		this.playLoop(this.bgm);
	}

	// 保卫战开始：战鼓
	battle(): void {
		this.playLoop(this.battleA);
	}

	// 建成或守住村庄：放一遍庆祝音乐，不打断循环音乐
	celebrate(): void {
		if (!this.unlocked || !this.enabled) return;
		this.fanfareA.currentTime = 0;
		void this.fanfareA.play().catch(() => {});
	}

	setEnabled(on: boolean): void {
		this.enabled = on;
		localStorage.setItem(KEY, on ? "on" : "off");
		if (!on) {
			this.loop?.pause();
			this.fanfareA.pause();
		} else if (this.unlocked) {
			if (this.loop) void this.loop.play().catch(() => {});
			else this.playLoop(this.bgm);
		}
	}
}

export const music = new Music();
