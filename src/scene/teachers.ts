// 第一人称里和孩子对话出题的动物老师：每个领域一位（原创的方块动物，戴学士帽）。
// 纯数据，界面（台词）和方块世界（模型）共用。

import type { Domain } from "../core/types";

export type Animal = "owl" | "fox" | "rabbit" | "panda";

export interface Teacher {
	animal: Animal;
	name: string;
	// 打招呼时的口头禅
	hello: string;
}

export const TEACHERS: Record<Domain, Teacher> = {
	数与代数: { animal: "owl", name: "猫头鹰老师", hello: "咕咕！" },
	图形与几何: { animal: "fox", name: "狐狸老师", hello: "嘿嘿，" },
	统计与概率: { animal: "rabbit", name: "兔子老师", hello: "蹦蹦！" },
	综合与实践: { animal: "panda", name: "熊猫老师", hello: "嗨呀，" },
};

// 老师的表情：说话、答对开心、答错难过、通关欢呼
export type Mood = "talk" | "happy" | "sad" | "cheer";
