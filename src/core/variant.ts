// 变式题：把填数题里的数换掉，用题库自带的标准答案算式（verify）算出新答案，复习时就不会总是同几道题。
//
// 只有确定安全的题才换：
//   - verify 是纯四则运算（导入时已经筛过），而且算式里的每个数都在题干里出现过（允许一个隐含的 1，比如“后面一个数”）。
//     算式里有题干里没有的数（比如最简比的公因数、数出来的个数），说明有隐藏的推理，换了数字会出错题，所以不换。
//   - 要换的数在题干里出现几次，在算式里也要出现几次：不然这个数在题里还有别的角色（“8＋5，先算 8＋2”，
//     “今年 100 吨……百分之几”里的 100 既是吨数又是百分数的 100），只换一处就错了。
//   - 题干里有“最简、约分、因数、倍数、估算、近似”等字眼、有字母或圈码（方程、编号）、有分数线（分数、圆周率）的不换。
//   - 题干里的每个数都要出现在算式里（年份除外）：不参与计算的数往往和别的数有关系
//     （“23 个皮球，每 5 个一袋，还剩 3 个”，换了 5 而 23 不变就对不上了）。
//   - 1 不换（“1 位同学”“1 本”往往是“一个”的意思）；算式只是一个数（答案直接是题干里的数）的题不出变式。
//   - 原题用 verify 算出来必须正好等于标准答案。
// 换数字的规则：
//   - 和原数同一量级：整十、整百的数还换成整十、整百；小数保留同样的位数；一位数在 1–9 之间换。
//   - 知识点名或题干里有“N以内”“1到N”的，所有数、每一步的中间结果和答案都不超过 N；“6～10各数”这样的范围（乘除法口诀除外）也一样。
//   - 题干里所有数两两之间的大小关系不变（“5 个小朋友，小明第 3 个”不会换成第 9 个，重叠的人数不会比一组的人数多）。
//   - 后面跟着“时、点、月、日、分、秒”的数限制在合理范围；后面是“年”的四位数不换。
//   - 答案必须非负；原答案是整数的新答案也必须是整数，原答案是小数的新答案小数位不能更多；位数不能比原答案多一位以上。
// 讲解换成“算式：… = 答案”，保证和新数字一致。

import type { Question } from "./types";

// ---- 有理数（分数）运算，判断整除和小数位用 ----

interface Q {
	n: bigint;
	d: bigint;
}

const gcd = (a: bigint, b: bigint): bigint => {
	a = a < 0n ? -a : a;
	b = b < 0n ? -b : b;
	while (b) [a, b] = [b, a % b];
	return a;
};

function q(n: bigint, d = 1n): Q {
	if (d === 0n) throw new Error("division by zero");
	if (d < 0n) {
		n = -n;
		d = -d;
	}
	const g = gcd(n, d) || 1n;
	return { n: n / g, d: d / g };
}

function fromDecimal(s: string): Q {
	const [i, f = ""] = s.split(".");
	return q(BigInt(i + f), 10n ** BigInt(f.length));
}

const add = (a: Q, b: Q) => q(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Q, b: Q) => q(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d);
const div = (a: Q, b: Q) => q(a.n * b.d, a.d * b.n);

// 分母只含 2 和 5 时能写成有限小数，返回小数位数；否则 null
function decimals(x: Q): number | null {
	let d = x.d;
	let twos = 0;
	let fives = 0;
	while (d % 2n === 0n) {
		d /= 2n;
		twos++;
	}
	while (d % 5n === 0n) {
		d /= 5n;
		fives++;
	}
	return d === 1n ? Math.max(twos, fives) : null;
}

function format(x: Q): string {
	const places = decimals(x);
	if (places === null) return `${x.n}/${x.d}`;
	if (places === 0) return x.n.toString();
	const scaled = (x.n * 10n ** BigInt(places)) / x.d;
	const neg = scaled < 0n;
	const s = (neg ? -scaled : scaled).toString().padStart(places + 1, "0");
	return `${neg ? "-" : ""}${s.slice(0, -places)}.${s.slice(-places)}`;
}

// ---- 算式：只有数字、+ - * /、括号 ----

type Node = { num: string } | { op: string; a: Node; b: Node };

function parse(expr: string): Node {
	const tokens = expr.match(/\d+(?:\.\d+)?|[-+*/()]/g) ?? [];
	let i = 0;
	const peek = () => tokens[i];
	const primary = (): Node => {
		const t = tokens[i++];
		if (t === "(") {
			const e = sum();
			if (tokens[i++] !== ")") throw new Error("missing )");
			return e;
		}
		if (t === "-") return { op: "-", a: { num: "0" }, b: primary() };
		if (t === undefined || !/^\d/.test(t)) throw new Error(`unexpected ${t}`);
		return { num: t };
	};
	const product = (): Node => {
		let a = primary();
		while (peek() === "*" || peek() === "/") {
			const op = tokens[i++];
			a = { op, a, b: primary() };
		}
		return a;
	};
	const sum = (): Node => {
		let a = product();
		while (peek() === "+" || peek() === "-") {
			const op = tokens[i++];
			a = { op, a, b: product() };
		}
		return a;
	};
	const e = sum();
	if (i !== tokens.length) throw new Error("trailing tokens");
	return e;
}

function evaluate(n: Node, values: Map<string, string>): Q {
	if ("num" in n) return fromDecimal(values.get(n.num) ?? n.num);
	const a = evaluate(n.a, values);
	const b = evaluate(n.b, values);
	return n.op === "+" ? add(a, b) : n.op === "-" ? sub(a, b) : n.op === "*" ? mul(a, b) : div(a, b);
}

const SYMBOL: Record<string, string> = { "+": "＋", "-": "－", "*": "×", "/": "÷" };
const PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };

// 写成给小朋友看的算式：× ÷，只在需要的地方加括号
function pretty(n: Node, values: Map<string, string>, parent = 0, right = false): string {
	if ("num" in n) return values.get(n.num) ?? n.num;
	const p = PREC[n.op];
	const s = `${pretty(n.a, values, p)} ${SYMBOL[n.op]} ${pretty(n.b, values, p, true)}`;
	return p < parent || (right && p === parent && (n.op === "-" || n.op === "/" || parent === 2)) ? `(${s})` : s;
}

function literals(n: Node, out: string[] = []): string[] {
	if ("num" in n) out.push(n.num);
	else {
		literals(n.a, out);
		literals(n.b, out);
	}
	return out;
}

// ---- 能不能换、怎么换 ----

const RISKY = /最简|约分|公因数|公倍数|化简|质数|合数|因数|倍数|奇数|偶数|估|近似|四舍五入|大约|规律|[a-zA-Z①-⑳/／]/;
const NUMBER = /\d+(?:\.\d+)?/g;

interface Plan {
	tree: Node;
	vars: string[]; // 题干和算式里共有的数（按字符串），会被换掉
	fixed: Set<string>; // 不换的数（年份等）
	limits: Map<string, [number, number]>; // 单位决定的范围
	cap: number; // “N以内”的上限
	floor: number; // “6～10各数”这类范围的下限
	numbers: string[]; // 题干里所有的数（去重），用来检查大小关系
	answer: Q;
}

const plans = new Map<string, Plan | null>();

// 题干里每个数后面紧跟的字（跳过空格）
function unitAfter(prompt: string, index: number, length: number): string {
	return prompt.slice(index + length).trimStart().charAt(0);
}

function planFor(question: Question, topicName: string): Plan | null {
	const key = `${question.id}\u0000${question.prompt}`;
	const cached = plans.get(key);
	if (cached !== undefined) return cached;
	let plan: Plan | null = null;
	try {
		plan = makePlan(question, topicName);
	} catch {
		plan = null;
	}
	plans.set(key, plan);
	return plan;
}

function makePlan(question: Question, topicName: string): Plan | null {
	if (question.kind !== "numeric" || !question.verify) return null;
	// 数据全量透传后 verify 可能是文字核验式；只有纯四则运算算式才换数字（和旧导入的筛选一致）
	if (!/^[\d\s.+\-*/()]+$/.test(question.verify)) return null;
	if (RISKY.test(question.prompt) || RISKY.test(topicName.replace(/[a-zA-Z]/g, ""))) return null;
	const tree = parse(question.verify);
	const inPrompt = new Set(question.prompt.match(NUMBER) ?? []);
	const lits = literals(tree);
	if (!lits.every((l) => inPrompt.has(l) || l === "1")) return null;
	const answer = evaluate(tree, new Map());
	const expected = question.answer.includes("/")
		? (() => {
				const [a, b] = question.answer.split("/");
				return q(BigInt(a), BigInt(b));
			})()
		: /^\d+(\.\d+)?$/.test(question.answer)
			? fromDecimal(question.answer)
			: null;
	if (!expected || expected.n !== answer.n || expected.d !== answer.d) return null;

	const fixed = new Set<string>();
	const limits = new Map<string, [number, number]>();
	for (const m of question.prompt.matchAll(NUMBER)) {
		const unit = unitAfter(question.prompt, m.index!, m[0].length);
		if (unit === "年" && m[0].length === 4) fixed.add(m[0]);
		else if (unit === "时" || unit === "点") limits.set(m[0], [1, 12]);
		else if (unit === "月") limits.set(m[0], [1, 12]);
		else if (unit === "日" || unit === "号") limits.set(m[0], [1, 28]);
		else if (unit === "分" || unit === "秒") limits.set(m[0], [1, 59]);
	}
	if ("num" in tree) return null;
	if ([...inPrompt].some((n) => !lits.includes(n) && !fixed.has(n))) return null;
	const vars = [...new Set(lits.filter((l) => inPrompt.has(l) && !fixed.has(l) && l !== "0" && l !== "1"))];
	if (vars.length === 0) return null;
	const count = (list: string[], x: string) => list.filter((y) => y === x).length;
	const promptNumbers = question.prompt.match(NUMBER) ?? [];
	if (vars.some((v) => count(promptNumbers, v) !== count(lits, v))) return null;
	const range = `${topicName} ${question.prompt}`.match(/(\d+)\s*以内|1\s*到\s*(\d+)/);
	let cap = range ? Number(range[1] ?? range[2]) : /万以内/.test(topicName) ? 10000 : Infinity;
	let floor = 0;
	const span = topicName.match(/(\d+)\s*[～~]\s*(\d+)/);
	if (span && !/乘|除|口诀/.test(topicName)) {
		floor = Number(span[1]);
		cap = Math.min(cap, Number(span[2]));
	}
	return { tree, vars, fixed, limits, cap, floor, numbers: [...inPrompt], answer };
}

// 和原数同一量级的新数
function vary(original: string, rng: () => number, limit?: [number, number], cap = Infinity): string {
	const pick = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
	if (original.includes(".")) {
		const places = original.split(".")[1].length;
		const scaled = Math.round(Number(original) * 10 ** places);
		const lo = Math.max(1, Math.floor(scaled * 0.5));
		const hi = Math.min(Math.ceil(scaled * 1.6), Math.floor(cap * 10 ** places));
		let v = pick(lo, Math.max(lo, hi));
		if (v % 10 === 0) v += 1; // 末位不为 0，保持“几位小数”的样子
		return (v / 10 ** places).toFixed(places);
	}
	const n = Number(original);
	let lo: number;
	let hi: number;
	let step = 1;
	if (limit) {
		[lo, hi] = limit;
	} else if (n < 10) {
		lo = 1;
		hi = 9;
	} else {
		// 末尾的 0 保留：整十换整十，整百换整百
		let zeros = 0;
		while (n % 10 ** (zeros + 1) === 0 && zeros < 3) zeros++;
		step = 10 ** zeros;
		const digits = original.length;
		lo = Math.max(10 ** (digits - 1), Math.floor((n * 0.5) / step) * step);
		hi = Math.min(10 ** digits - 1, Math.ceil((n * 1.6) / step) * step);
	}
	hi = Math.min(hi, cap);
	if (hi < lo) return original;
	const v = pick(Math.ceil(lo / step), Math.floor(hi / step)) * step;
	return String(v);
}

// “N以内”：每一步的中间结果也不超过 N、不小于 0（“10以内加减混合”不能先加到 11 再减）
function withinCap(tree: Node, values: Map<string, string>, cap: number): boolean {
	if ("num" in tree) return true;
	const v = evaluate(tree, values);
	const n = Number(v.n) / Number(v.d);
	return n <= cap && n >= 0 && withinCap(tree.a, values, cap) && withinCap(tree.b, values, cap);
}

// 题干里所有数两两之间的大小关系和原题一样
function sameOrder(numbers: string[], values: Map<string, string>): boolean {
	const now = (x: string) => Number(values.get(x) ?? x);
	for (let i = 0; i < numbers.length; i++) {
		for (let j = i + 1; j < numbers.length; j++) {
			const before = Math.sign(Number(numbers[i]) - Number(numbers[j]));
			if (Math.sign(now(numbers[i]) - now(numbers[j])) !== before) return false;
		}
	}
	return true;
}

// 一步算式（两个数）要保持知识点练的那个技能：
//   “进位加法 / 退位减法”要进位、退位，“不进位 / 不退位”要不进位、不退位；
//   “2～6的乘法口诀”这类，乘数（或除法的除数、商）至少有一个在这个范围里。
function keepsSkill(tree: Node, values: Map<string, string>, topicName: string): boolean {
	if ("num" in tree || !("num" in tree.a) || !("num" in tree.b)) return true;
	const a = Number(values.get(tree.a.num) ?? tree.a.num);
	const b = Number(values.get(tree.b.num) ?? tree.b.num);
	if (!Number.isInteger(a) || !Number.isInteger(b)) return true;
	const carry = tree.op === "+" ? (a % 10) + (b % 10) >= 10 : tree.op === "-" ? a % 10 < b % 10 : null;
	if (carry !== null) {
		if (/不进位|不退位/.test(topicName)) return !carry;
		if (/进位|退位/.test(topicName)) return carry;
	}
	const table = topicName.match(/(\d)\s*[～~]\s*(\d)/);
	if (table && (tree.op === "*" || tree.op === "/")) {
		const lo = Number(table[1]);
		const hi = Number(table[2]);
		const inRange = (x: number) => x >= lo && x <= hi;
		return tree.op === "*" ? inRange(a) || inRange(b) : inRange(b) || inRange(a / b);
	}
	return true;
}

// 生成一道变式题；这道题不适合换数字，或者试了几次都没换出合格的，返回 null
export function makeVariant(question: Question, topicName: string, rng: () => number = Math.random): Question | null {
	const plan = planFor(question, topicName);
	if (!plan) return null;
	const origPlaces = decimals(plan.answer) ?? 0;
	const origDigits = format(plan.answer).replace(/\D/g, "").length;
	for (let attempt = 0; attempt < 40; attempt++) {
		const values = new Map<string, string>();
		for (const v of plan.vars) values.set(v, vary(v, rng, plan.limits.get(v), plan.cap));
		const used = [...values.values()];
		if (plan.vars.every((v) => values.get(v) === v)) continue; // 一个都没变
		if (new Set(used).size !== used.length) continue; // 原来不同的数换成了同一个
		let answer: Q;
		try {
			answer = evaluate(plan.tree, values);
		} catch {
			continue;
		}
		if (answer.n < 0n) continue;
		const places = decimals(answer);
		if (places === null || places > origPlaces) continue;
		if (origPlaces === 0 && answer.d !== 1n) continue;
		const text = format(answer);
		if (text.replace(/\D/g, "").length > origDigits + 1) continue;
		if (Number(text) > plan.cap || used.some((u) => Number(u) > plan.cap || Number(u) < plan.floor)) continue;
		if (!sameOrder(plan.numbers, values)) continue;
		if (Number.isFinite(plan.cap) && !withinCap(plan.tree, values, plan.cap)) continue;
		if (!keepsSkill(plan.tree, values, topicName)) continue;
		// 题干里的数逐个替换（按整个数匹配，不会把 120 里的 12 换掉）
		const prompt = question.prompt.replace(NUMBER, (m) => values.get(m) ?? m);
		return {
			id: `${question.id}~${used.join("_")}`,
			difficulty: question.difficulty,
			kind: "numeric",
			prompt,
			answer: question.answer.includes("/") && answer.d !== 1n ? `${answer.n}/${answer.d}` : text,
			explanation: `算式：${pretty(plan.tree, values)} ＝ ${text}`,
			variantOf: question.id,
		};
	}
	return null;
}

// 这道题能不能出变式（测试和统计用）
export function canVary(question: Question, topicName: string): boolean {
	return planFor(question, topicName) !== null;
}
