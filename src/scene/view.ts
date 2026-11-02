// 界面（app.ts）操作 3D 画面用的接口。地图视角（KingdomScene）和第一人称方块世界（VoxelScene）都实现它，
// 切换视角时界面不用关心现在是哪一个。

import type { Battle, BattleEvent } from "../core/defense";
import type { Progress } from "../core/kingdom";
import type { Mood } from "./teachers";

// 对话模式（第一人称）：面板内容画在视角提供的全息面板里，老师用对话气泡说出台词
export interface Dialogue {
	host(): HTMLElement;
	say(text: string, mood: Mood): void;
}

// 保卫战（只有第一人称有）：开打时摆好战场，之后每帧按 Battle 的状态画骑士，事件触发特效
export interface BattleView {
	start(b: Battle): void;
	events(ev: BattleEvent[]): void;
	end(): void;
}

// 村庄路牌上的旗：none 还不能打，ready 可以保卫（红旗），defended 守住过（金旗）
export type VillageMark = "none" | "ready" | "defended";

export interface View {
	// 点到（或第一人称里对着点击）一块地；null 表示点在空地上。第一人称里点到村庄路牌时是 "village:序号"
	onPick: (id: string | null) => void;
	refresh(progress: Progress, now: number, changed?: string): void;
	select(id: string | null): void;
	celebrate(id: string): void;
	// 把镜头（或玩家）带到某块地、某个年级、王城；immediate 时不播放过渡
	focusPlot(id: string, immediate?: boolean): void;
	focusGrade(grade: number, immediate?: boolean): void;
	goHome(): void;
	// 面板挡住的像素（右侧或底部），画面中心相应挪开
	setInset(right: number, bottom: number): void;
	// 镜头或玩家离王城的距离（布局单位），用来高亮当前年级
	radius(): number;
	// 详情面板打开或关闭时调用（第一人称要释放或恢复鼠标）
	panelChanged(open: boolean): void;
	show(visible: boolean): void;
	update(dt: number): void;
	// 有的话，详情和答题改成和动物老师对话（只有第一人称有）
	dialogue?: Dialogue;
	battle?: BattleView;
	villages?(marks: VillageMark[]): void;
}
