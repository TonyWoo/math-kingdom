// 数据类型：每科一份数据文件的结构（scripts/split-subjects.mjs 按学科生成，
// public/data/<学科>.json；数学另有一份 src/data/kingdom.json 供测试用）。
// 领域和知识点类型是数据里的字符串，不写死某个学科的词表，这样一套程序能装所有学科。
// 布局坐标：王城在原点，x 向右、y 向下（场景里 y 对应 three.js 的 z），角度是弧度。

export type Domain = string;
export type TopicType = string;
export type Building = "mill" | "library" | "watchtower" | "market" | "plaza";
export type Terrain = "plain" | "hill" | "coast" | "fair";
export type Difficulty = "basic" | "standard" | "challenge";

export interface Topic {
	id: string;
	name: string;
	domain: Domain;
	type: TopicType;
	grade: number;
	semester: "上" | "下";
	chapter: string;
	description: string;
	mastery: string[];
	x: number;
	y: number;
	village: number;
	building: Building;
}

export interface Question {
	id: string;
	difficulty: Difficulty;
	kind: "numeric" | "choice" | "short" | "self";
	prompt: string;
	answer: string;
	choices?: { key: string; text: string; figure?: string }[]; // figure 是原库给选项配的图（SVG），先透传，界面暂未渲染
	accept?: string[]; // 短答题的其他可接受答案（原库字段）
	explanation?: string;
	verify?: string; // 原库的核验式：填数题是四则运算算式（变式题靠它换数字），其他题型可能是文字，变式题会自己筛
	variantOf?: string; // 变式题：原题的 id
}

export interface Edge {
	topic: string;
	prereq: string;
	hard: boolean;
}

export interface Sector {
	domain: Domain;
	terrain: Terrain;
	a1: number;
	a2: number;
}

export interface Ring {
	grade: number;
	r1: number;
	r2: number;
}

export interface Village {
	name: string;
	unit: string;
	grade: number;
	semester: string;
	domain: Domain;
	x: number;
	y: number;
	a1: number;
	a2: number;
	plots: string[];
}

export interface KingdomData {
	subject?: { id: string; name: string; kingdom: string }; // 拆分脚本写入的学科信息；旧 kingdom.json 没有这一段
	source: { repo: string; commit: string; license: string; note: string };
	castle: { r: number };
	sectors: Sector[];
	rings: Ring[];
	villages: Village[];
	topics: Topic[];
	edges: Edge[];
	questions: Record<string, Question[]>;
}

// 年级圈按年级值查：不是每个学科都从一年级开始（英语从三年级），不能拿年级当下标
export function ringOf(data: KingdomData, grade: number): Ring {
	return data.rings.find((r) => r.grade === grade)!;
}
