// 判题。题库的答案格式（小学 1136 题里）：
//   填数题：整数 753、小数 70、分数 61（"3/4"）、用中文逗号分隔的多个数 7（"2，3"，比如“商和余数”）
//   选择题：选项字母（"A"）
// 填数题按数值比较：0.5 和 1/2 相等，2/4 和 1/2 相等；多个数要个数相同、按顺序逐个相等。
// 输入里允许全角数字、中文逗号、顿号、空格分隔，末尾的 % 去掉（题干会写“只写数”）。

import type { Question } from "./types";

// 把一个数字串解析成数值；不是数（或分母为 0）时返回 null。
export function parseNumber(raw: string): number | null {
	const s = raw.trim();
	let m = /^(-?\d+)\/(\d+)$/.exec(s);
	if (m) {
		const d = Number(m[2]);
		return d === 0 ? null : Number(m[1]) / d;
	}
	m = /^-?(\d+(\.\d*)?|\.\d+)$/.exec(s);
	return m ? Number(s) : null;
}

// 全角转半角，统一分隔符。
export function normalize(input: string): string {
	return input
		.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
		.replace(/[．。]/g, ".")
		.replace(/[／]/g, "/")
		.replace(/[－—]/g, "-")
		.replace(/[%％]\s*$/, "")
		.trim();
}

// 拆成多个数；有一项不是数就返回 null。
export function parseNumbers(input: string): number[] | null {
	const parts = normalize(input)
		.split(/[,，、;；\s]+/)
		.filter((p) => p.length > 0);
	if (parts.length === 0) return null;
	const out: number[] = [];
	for (const p of parts) {
		const v = parseNumber(p);
		if (v === null) return null;
		out.push(v);
	}
	return out;
}

// 短答题的文本比对：全角转半角（normalize 已做）、英文字母不分大小写、
// 空白折叠、末尾标点不算；标准答案和 accept 里的任一写法对上都算对。
export function normalizeText(input: string): string {
	return normalize(input)
		.replace(/\s+/g, " ")
		.replace(/[。．.！!？?；;：:、，,\s]+$/u, "")
		.toLowerCase();
}

export function judgeText(q: Question, input: string): boolean {
	const got = normalizeText(input);
	if (!got) return false;
	return [q.answer, ...(q.accept ?? [])].some((a) => normalizeText(a) === got);
}

export function judge(q: Question, input: string): boolean {
	if (q.kind === "choice") {
		return normalize(input).toUpperCase() === q.answer.trim().toUpperCase();
	}
	if (q.kind !== "numeric") return judgeText(q, input);
	const want = parseNumbers(q.answer);
	const got = parseNumbers(input);
	if (!want || !got || want.length !== got.length) return false;
	return want.every((w, i) => Math.abs(w - got[i]) < 1e-9 * Math.max(1, Math.abs(w)));
}

// 答案需要几个数（多个数的题要提示“用逗号分开”）。
export function answerCount(q: Question): number {
	return q.kind === "numeric" ? (parseNumbers(q.answer)?.length ?? 1) : 1;
}
