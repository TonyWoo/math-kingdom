// 数据类型：src/data/kingdom.json 的结构（scripts/import-taxonomy.mjs 生成）。
// 布局坐标：王城在原点，x 向右、y 向下（场景里 y 对应 three.js 的 z），角度是弧度。

export type Domain = "数与代数" | "图形与几何" | "统计与概率" | "综合与实践";
export type TopicType = "procedural" | "conceptual" | "reasoning" | "application" | "modeling";
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
	kind: "numeric" | "choice";
	prompt: string;
	answer: string;
	choices?: { key: string; text: string }[];
	explanation?: string;
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
	source: { repo: string; commit: string; license: string; note: string };
	castle: { r: number };
	sectors: Sector[];
	rings: Ring[];
	villages: Village[];
	topics: Topic[];
	edges: Edge[];
	questions: Record<string, Question[]>;
}
