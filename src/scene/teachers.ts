// 第一人称里和孩子对话出题的动物老师：每个领域一位（原创的方块动物，戴学士帽）。
// 纯数据，界面（台词）和方块世界（模型）共用。
//
// 老师不按学科写死：主入口按当前学科的领域顺序（数据文件里的扇区顺序）调用
// setTeacherDomains 分配，四位老师轮着来。数学的领域顺序正好对应原来的分工，
// 所以数学王国里每位老师教的领域和之前一模一样；领域多的学科，后面的领域
// 会再轮到前面的老师（一位老师教两个领域）。

import type { Domain } from "../core/types";

export type Animal = "owl" | "fox" | "rabbit" | "panda";

export interface Teacher {
	animal: Animal;
	name: string;
	// 打招呼时的口头禅
	hello: string;
}

// 老师名单，顺序就是数学四个领域的原分工顺序
const ROSTER: Teacher[] = [
	{ animal: "owl", name: "猫头鹰老师", hello: "咕咕！" },
	{ animal: "fox", name: "狐狸老师", hello: "嘿嘿，" },
	{ animal: "rabbit", name: "兔子老师", hello: "蹦蹦！" },
	{ animal: "panda", name: "熊猫老师", hello: "嗨呀，" },
];

let byDomain = new Map<Domain, Teacher>();

export function setTeacherDomains(domains: Domain[]): void {
	byDomain = new Map(domains.map((d, i) => [d, ROSTER[i % ROSTER.length]]));
}

export function teacherOf(domain: Domain): Teacher {
	return byDomain.get(domain) ?? ROSTER[0];
}

// 老师的表情：说话、答对开心、答错难过、通关欢呼
export type Mood = "talk" | "happy" | "sad" | "cheer";
