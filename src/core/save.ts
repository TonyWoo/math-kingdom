// 存档：进度存在浏览器本地（localStorage）。隐私模式、禁用存储时读写会抛异常，这时只在本次打开期间有效。

import type { Progress } from "./kingdom";

const KEY = "math-kingdom/v1";

export interface SaveData {
	progress: Progress;
	demo?: boolean; // 是演示进度（设置里可以清空）
	defense?: Record<string, { won: boolean; best: number }>; // 保卫战记录，键是村庄序号
	spot?: { x: number; y: number; lookX: number; lookY: number }; // “我在这里”的位置（布局坐标）
}

export function load(): SaveData | null {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return null;
		const data = JSON.parse(raw) as SaveData;
		return data && typeof data.progress === "object" ? data : null;
	} catch {
		return null;
	}
}

export function store(data: SaveData): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(data));
	} catch {
		// 存不了就算了，本次打开期间仍然有效
	}
}

export function clear(): void {
	try {
		localStorage.removeItem(KEY);
	} catch {
		// 同上
	}
}
