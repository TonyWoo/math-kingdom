// 界面：顶栏统计、年级按钮、地块详情面板、答题（选择题按钮 / 数字键盘）、朗读、设置、提示。
// 进度在这里持有，答完题更新进度、存档、刷新场景。
//
// 网址参数（方便演示和测试）：
//   ?demo=1          用演示进度（不覆盖已有存档，除非在设置里载入）
//   ?select=<id>     打开某个知识点的面板
//   ?focus=<年级>     镜头对准某个年级
//   ?days=<n>        把“现在”往后挪 n 天，看复习提醒

import { type Kingdom, type Progress, type Status, demoProgress, needsCare, stars, status, summary } from "../core/kingdom";
import { answerCount } from "../core/judge";
import { type Outcome, type Plan, QuizSession, planFor } from "../core/quiz";
import * as save from "../core/save";
import type { Question } from "../core/types";
import type { View } from "../scene/view";

const GRADE_NAME = ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级"];
const BUILDING_NAME = { mill: "磨坊", library: "图书馆", watchtower: "瞭望塔", market: "集市", plaza: "广场" };
const STATUS_TEXT: Record<Status, string> = {
	locked: "迷雾中：先修还没学会",
	open: "空地：可以开始建造",
	built: "已建成",
	due: "该复习了",
	weeds: "长草了，快来复习",
	goblin: "被哥布林占领了！复习赶走它",
};
const STAGE = {
	1: { name: "打地基", need: "答对 2 道基础题", icon: "foundation", done: "地基打好了！" },
	2: { name: "盖房子", need: "答对 1 道标准题", icon: "house", done: "房子盖好了！" },
	3: { name: "升金顶", need: "答对 1 道挑战题", icon: "crown", done: "金顶闪闪发光！" },
} as const;

// 界面图标（public/art/ui/，128×128）。cls 决定显示大小，见 style.css 的 .ic
const icon = (name: string, cls = "") =>
	`<img class="ic ${cls}" src="${import.meta.env.BASE_URL}art/ui/icon_${name}.png" alt="" draggable="false">`;

const esc = (s: string) =>
	s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface QuizState {
	session: QuizSession;
	input: string;
	answered: boolean; // 当前题已经提交，正在看反馈
	picked?: string; // 选择题选了哪个
	outcome?: Outcome;
}

export class App {
	private k: Kingdom;
	private scene: View;
	private progress: Progress;
	private demo: boolean;
	private selected: string | null = null;
	private quiz: QuizState | null = null;
	private dayOffset: number;
	private toastTimer = 0;

	constructor(k: Kingdom, scene: View) {
		this.k = k;
		this.scene = scene;
		const params = new URLSearchParams(location.search);
		this.dayOffset = Number(params.get("days") ?? 0) || 0;
		const saved = save.load();
		if (params.get("demo") === "1" && !saved) {
			this.progress = demoProgress(k, this.now());
			this.demo = true;
		} else {
			this.progress = saved?.progress ?? {};
			this.demo = saved?.demo ?? false;
		}

		this.attach(scene);
		this.setupChrome();
		this.render();

		const focus = Number(params.get("focus"));
		const select = params.get("select");
		if (select && k.topics.has(select)) {
			scene.focusPlot(select, true);
			this.open(select, false);
		} else if (focus >= 1 && focus <= 6) {
			scene.focusGrade(focus, true);
		} else {
			// 从“开拓前线”开始：教材顺序里第一块空地
			const frontier = k.order.find((id) => status(k, this.progress, id, this.now()) === "open") ?? k.order[0];
			scene.focusPlot(frontier, true);
			if (Object.keys(this.progress).length === 0) {
				this.toast(`欢迎来到数学王国！从王城旁边的「${k.topic(frontier).name}」开始建造吧。`, 6000);
			}
		}
	}

	// 接上一个视角：点选回调、当前进度
	private attach(view: View): void {
		view.onPick = (id) => (id ? this.open(id, false) : this.close());
		view.refresh(this.progress, this.now());
	}

	// 切换视角（地图 ↔ 第一人称）：新视角同步进度和选中的地块，并把镜头或玩家带到选中的地块
	setView(view: View): void {
		if (view === this.scene) return;
		this.scene.show(false);
		this.scene = view;
		this.attach(view);
		view.show(true);
		view.select(this.selected);
		if (this.selected) view.focusPlot(this.selected, true);
		view.panelChanged(!$("panel").hidden);
		this.updateInset();
	}

	get view(): View {
		return this.scene;
	}

	now(): number {
		return Date.now() + this.dayOffset * 86400_000;
	}

	private persist(): void {
		save.store({ progress: this.progress, demo: this.demo });
	}

	private setupChrome(): void {
		const grades = $("grades");
		GRADE_NAME.forEach((name, i) => {
			const b = document.createElement("button");
			b.className = "btn";
			b.textContent = name;
			b.onclick = () => this.scene.focusGrade(i + 1);
			grades.appendChild(b);
		});
		$("home").onclick = () => this.scene.goHome();
		$("view").onclick = () => {
			const s = this.scene as View & { toggleTopDown?: () => boolean };
			if (!s.toggleTopDown) return;
			$("view").textContent = s.toggleTopDown() ? "斜视" : "俯视";
		};
		$("patrol").onclick = () => {
			const list = needsCare(this.k, this.progress, this.now());
			if (list.length === 0) {
				this.toast("王国一切安好，没有需要照看的地方");
				return;
			}
			this.open(list[0], true);
		};
		const dialog = $<HTMLDialogElement>("settings");
		$("settings-btn").onclick = () => {
			const s = summary(this.k, this.progress, this.now());
			$("save-state").textContent = this.demo
				? "现在是演示进度。"
				: `已经建成 ${s.total - s.locked - s.open} 块地，共 ${s.stars} 颗星。`;
			dialog.showModal();
		};
		$("demo").onclick = () => {
			this.progress = demoProgress(this.k, this.now());
			this.demo = true;
			this.afterReset();
			dialog.close();
			this.toast("已载入演示进度");
		};
		$("reset").onclick = () => {
			if (!confirm("确定清空所有进度吗？")) return;
			this.progress = {};
			this.demo = false;
			save.clear();
			this.afterReset();
			dialog.close();
			this.toast("进度已清空，从头开始建造吧");
		};
		window.addEventListener("keydown", (e) => this.onKey(e));
		window.addEventListener("resize", () => this.updateInset());
	}

	private afterReset(): void {
		this.quiz = null;
		this.persist();
		this.scene.refresh(this.progress, this.now());
		this.close();
		this.render();
	}

	// 顶栏统计、巡视数字、当前年级
	private render(): void {
		const s = summary(this.k, this.progress, this.now());
		const built = s.built + s.due + s.weeds + s.goblin;
		$("stats").innerHTML =
			`<span>${icon("house")}建成 <b>${built}</b> / ${s.total}</span>` +
			`<span>${icon("star")}<b>${s.stars}</b></span>` +
			`<span>${icon("foundation")}可建造 <b>${s.open}</b></span>` +
			(this.demo ? `<span class="muted">演示进度</span>` : "");
		const care = s.due + s.weeds + s.goblin;
		$("patrol").innerHTML = `${icon("patrol")}今日巡视${care ? `<span class="badge">${care}</span>` : ""}`;
	}

	// 当前镜头对着哪个年级（每帧调用）
	tick(): void {
		const r = this.scene.radius();
		const rings = this.k.data.rings;
		const buttons = $("grades").children;
		for (let i = 0; i < rings.length; i++) {
			const ring = rings[i];
			buttons[i].classList.toggle("active", r >= ring.r1 - 70 && r <= ring.r2);
		}
	}

	open(id: string, fly: boolean): void {
		if (this.quiz && this.quiz.session.id !== id && !this.quiz.outcome) {
			this.toast("先把这次答题做完吧");
			return;
		}
		this.quiz = null;
		this.selected = id;
		this.scene.select(id);
		if (fly) this.scene.focusPlot(id);
		this.renderPanel();
	}

	close(): void {
		if (this.quiz && !this.quiz.outcome) return;
		this.quiz = null;
		this.selected = null;
		this.scene.select(null);
		$("panel").hidden = true;
		this.scene.panelChanged(false);
		this.updateInset();
	}

	// 面板打开时让 3D 画面的中心避开它
	private updateInset(): void {
		const panel = $("panel");
		if (panel.hidden) {
			this.scene.setInset(0, 0);
		} else if (window.innerWidth > 760) {
			this.scene.setInset(panel.offsetWidth + 12, 0);
		} else {
			this.scene.setInset(0, panel.offsetHeight);
		}
	}

	private renderPanel(): void {
		const panel = $("panel");
		panel.hidden = false;
		if (this.quiz) {
			panel.innerHTML = this.quiz.outcome ? this.resultHtml() : this.quizHtml();
		} else {
			panel.innerHTML = this.topicHtml();
		}
		this.bindPanel();
		this.scene.panelChanged(true);
		this.updateInset();
	}

	private starsHtml(n: number): string {
		return `<span class="stars">${[1, 2, 3].map((i) => icon(i <= n ? "star" : "star_empty", "star")).join("")}</span>`;
	}

	private topicHtml(): string {
		const id = this.selected!;
		const t = this.k.topic(id);
		const v = this.k.data.villages[t.village];
		const st = status(this.k, this.progress, id, this.now());
		const plan = planFor(this.k, this.progress, id, this.now());
		const prereqs = this.k.prereq.get(id)!;
		const soft = this.k.soft.get(id)!;
		const item = (p: string, hard: boolean) => {
			const ok = stars(this.progress, p) >= 1;
			return `<button class="prereq" data-go="${p}"><span class="tag ${ok ? "" : "no"}">${ok ? "已学" : "未学"}</span>${esc(this.k.topic(p).name)}${hard ? "" : ' <span class="muted">（有帮助）</span>'}</button>`;
		};
		return `
			<button class="close" data-act="close" aria-label="关闭">×</button>
			<h2>${esc(t.name)}</h2>
			<div class="chips">
				<span class="chip">${esc(v.unit)}</span>
				<span class="chip">${esc(t.domain)}</span>
				<span class="chip">${BUILDING_NAME[t.building]}</span>
			</div>
			<div class="state"><span>${STATUS_TEXT[st]}</span>${this.starsHtml(stars(this.progress, id))}</div>
			<p>${esc(t.description)}</p>
			<h3>掌握目标</h3>
			<ul>${t.mastery.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
			<h3>先修知识点</h3>
			${prereqs.length + soft.length === 0 ? '<p class="muted">这是起点，没有先修。</p>' : ""}
			${prereqs.map((p) => item(p, true)).join("")}${soft.map((p) => item(p, false)).join("")}
			<div class="action">${this.actionHtml(plan)}</div>`;
	}

	private actionHtml(plan: Plan): string {
		switch (plan.kind) {
			case "locked":
				return `<button class="btn" disabled>${icon("lock")}还在迷雾中</button>
					<p class="hint muted">先学会：${plan.missing.map((p) => esc(this.k.topic(p).name)).join("、")}</p>`;
			case "build": {
				const s = STAGE[plan.stage];
				return `<button class="btn primary" data-act="start">${icon(s.icon)}开始建造：${s.name}</button>
					<p class="hint muted">${s.need}</p>`;
			}
			case "wait":
				return `<button class="btn ghost" data-act="practice">${icon("pencil")}再练习一下</button>
					<p class="hint muted">金顶要明天再来：隔天还会，才算真的掌握。</p>`;
			case "review":
				return `<button class="btn warm" data-act="start">${icon("broom")}复习：答对 2 道题</button>
					<p class="hint muted">答错不会扣星，只是还要再复习。</p>`;
			case "practice":
				return `<button class="btn ghost" data-act="practice">${icon("pencil")}再练习一下</button>
					<p class="hint muted">这块地已经建满三颗星啦！</p>`;
		}
	}

	private bindPanel(): void {
		const panel = $("panel");
		panel.querySelectorAll<HTMLElement>("[data-go]").forEach((el) => {
			el.onclick = () => this.open(el.dataset.go!, true);
		});
		panel.querySelectorAll<HTMLElement>("[data-act]").forEach((el) => {
			el.onclick = () => this.act(el.dataset.act!, el.dataset.arg);
		});
	}

	private act(action: string, arg?: string): void {
		switch (action) {
			case "close":
				this.close();
				break;
			case "start":
				this.startQuiz(planFor(this.k, this.progress, this.selected!, this.now()));
				break;
			case "practice":
				this.startQuiz({ kind: "practice" });
				break;
			case "key":
				this.key(arg!);
				break;
			case "choose":
				this.submit(arg!);
				break;
			case "next":
				this.next();
				break;
			case "speak":
				this.speak();
				break;
			case "back":
				this.quiz = null;
				this.renderPanel();
				break;
		}
	}

	private startQuiz(plan: Plan): void {
		const session = new QuizSession(this.k, this.progress, this.selected!, plan);
		if (session.questions.length === 0) return;
		this.quiz = { session, input: "", answered: false };
		this.renderPanel();
	}

	private stepTitle(): string {
		const plan = this.quiz!.session.plan;
		if (plan.kind === "build") return `${icon(STAGE[plan.stage].icon, "sm")}${STAGE[plan.stage].name}`;
		if (plan.kind === "review") return `${icon("broom", "sm")}复习`;
		return `${icon("pencil", "sm")}练习`;
	}

	private quizHtml(): string {
		const q = this.quiz!;
		const s = q.session;
		const question = s.questions[q.answered ? s.index - 1 : s.index];
		const dots = s.questions
			.map((_, i) => {
				if (i < s.results.length) return `<span class="${s.results[i] ? "ok" : "bad"}"></span>`;
				return `<span class="${i === s.index ? "now" : ""}"></span>`;
			})
			.join("");
		const t = this.k.topic(s.id);
		let body = `
			<button class="close" data-act="back" aria-label="返回">×</button>
			<div class="quiz">
				<div class="step">${esc(t.name)} · ${this.stepTitle()} · 第 ${Math.min(s.index + (q.answered ? 0 : 1), s.questions.length)} / ${s.questions.length} 题${
					question.variantOf ? ' <span class="chip new">换了数字的新题</span>' : ""
				}</div>
				<div class="dots">${dots}</div>
				<div class="prompt"><span class="text">${esc(question.prompt)}</span>${
					"speechSynthesis" in window ? `<button class="speak" data-act="speak" title="读题">${icon("speaker")}</button>` : ""
				}</div>`;
		if (question.kind === "choice") {
			body += `<div class="choices">${question.choices!
				.map((c) => {
					let cls = "";
					if (q.answered && c.key === question.answer) cls = "right";
					else if (q.answered && c.key === q.picked) cls = "wrong";
					return `<button class="btn ${cls}" data-act="choose" data-arg="${esc(c.key)}" ${q.answered ? "disabled" : ""}><b>${esc(c.key)}</b>${esc(c.text)}</button>`;
				})
				.join("")}</div>`;
		} else {
			const ok = q.answered ? s.results.at(-1) : undefined;
			const hint =
				answerCount(question) > 1
					? "用逗号把几个数隔开"
					: question.answer.includes("/")
						? "分数用 / 输入，比如 3/4"
						: "输入答案";
			body += `<div class="entry ${ok === true ? "right" : ok === false ? "wrong" : ""}">${
				q.input ? esc(q.input) : `<span class="placeholder">${hint}</span>`
			}</div>`;
			if (!q.answered) body += this.keypadHtml();
		}
		if (q.answered) body += this.feedbackHtml(question, s.results.at(-1)!);
		return body + "</div>";
	}

	private keypadHtml(): string {
		const keys = ["7", "8", "9", "⌫", "4", "5", "6", "/", "1", "2", "3", "，", "0", ".", "清空", "确定"];
		return `<div class="keypad">${keys
			.map((k) => {
				const cls = k === "确定" ? "ok" : /[0-9]/.test(k) ? "" : "fn";
				return `<button class="btn ${cls}" data-act="key" data-arg="${k}">${k}</button>`;
			})
			.join("")}</div>`;
	}

	private feedbackHtml(q: Question, ok: boolean): string {
		const s = this.quiz!.session;
		const last = s.finished;
		const answer = q.kind === "choice" ? `${q.answer}. ${q.choices!.find((c) => c.key === q.answer)?.text ?? ""}` : q.answer;
		return `<div class="feedback ${ok ? "right" : "wrong"}">
				<div class="title">${ok ? `${icon("correct")}答对了！` : `${icon("wrong")}正确答案是 ${esc(answer)}`}</div>
				${q.explanation ? `<div>${esc(q.explanation)}</div>` : ""}
			</div>
			<div class="action"><button class="btn primary" data-act="next">${last ? "看结果" : "下一题"}</button></div>`;
	}

	private resultHtml(): string {
		const q = this.quiz!;
		const o = q.outcome!;
		const plan = q.session.plan;
		const t = this.k.topic(q.session.id);
		let big = "star";
		let title = "";
		let text = "";
		if (o.success) {
			if (plan.kind === "build") {
				big = STAGE[plan.stage].icon;
				title = STAGE[plan.stage].done;
				text = `「${esc(t.name)}」得到了第 ${o.starsAfter} 颗星。`;
				if (plan.stage === 2) text += "明天再来，答对挑战题就能升金顶。";
			} else if (plan.kind === "review") {
				big = "broom";
				title = "打扫干净了！";
				const days = Math.round(((this.progress[q.session.id].due ?? this.now()) - this.now()) / 86400_000);
				text = `下次复习：${days} 天后。`;
			} else {
				title = "全部答对！";
			}
		} else {
			big = "wrong";
			title = "差一点！";
			text = plan.kind === "practice" ? "练习不影响进度。" : "没关系，看看讲解再试一次。";
		}
		const roots = o.roots.length
			? `<h3>地基不稳？先巩固这些</h3>${o.roots
					.map((p) => `<button class="prereq" data-go="${p}"><span class="tag ${stars(this.progress, p) >= 2 ? "" : "no"}">${stars(this.progress, p)} 星</span>${esc(this.k.topic(p).name)}</button>`)
					.join("")}`
			: "";
		const again = !o.success && plan.kind !== "practice" ? '<button class="btn primary" data-act="start">再试一次</button>' : "";
		return `
			<div class="result">
				<div class="big">${icon(big, "xl")}</div>
				<h2>${title}</h2>
				<p>${text}</p>
				${o.success && plan.kind !== "practice" ? this.starsHtml(o.starsAfter) : ""}
			</div>
			${roots}
			<div class="action">${again}<button class="btn ghost" data-act="back" style="margin-top:10px">返回</button></div>`;
	}

	private key(k: string): void {
		const q = this.quiz;
		if (!q || q.answered || q.outcome) return;
		if (k === "确定") {
			if (q.input.trim()) this.submit(q.input);
			return;
		}
		if (k === "⌫") q.input = q.input.slice(0, -1);
		else if (k === "清空") q.input = "";
		else if (q.input.length < 16) q.input += k;
		this.renderPanel();
	}

	private submit(input: string): void {
		const q = this.quiz!;
		if (q.answered) return;
		q.picked = input;
		if (q.session.current!.kind === "numeric") q.input = input;
		q.session.answer(input);
		q.answered = true;
		this.renderPanel();
	}

	private next(): void {
		const q = this.quiz!;
		if (!q.session.finished) {
			q.input = "";
			q.picked = undefined;
			q.answered = false;
			this.renderPanel();
			return;
		}
		const now = this.now();
		const before = new Map(this.k.order.map((id) => [id, status(this.k, this.progress, id, now)]));
		q.outcome = q.session.finish(this.k, this.progress, now);
		if (q.session.plan.kind !== "practice") {
			this.persist();
		}
		this.scene.refresh(this.progress, now, q.outcome.starsAfter > q.outcome.starsBefore ? q.session.id : undefined);
		if (q.outcome.success && q.session.plan.kind !== "practice") this.scene.celebrate(q.session.id);
		const unlocked = this.k.order.filter((id) => before.get(id) === "locked" && status(this.k, this.progress, id, now) === "open");
		if (unlocked.length) {
			this.toast(`迷雾散开了！解锁了新地块：${unlocked.map((id) => this.k.topic(id).name).join("、")}`, 5000);
		}
		this.render();
		this.renderPanel();
	}

	private speak(): void {
		const q = this.quiz;
		if (!q || !("speechSynthesis" in window)) return;
		const s = q.session;
		const question = s.questions[q.answered ? s.index - 1 : s.index];
		let text = question.prompt;
		if (question.choices) text += "。" + question.choices.map((c) => `${c.key}，${c.text}`).join("。");
		const u = new SpeechSynthesisUtterance(text.replace(/\//g, "分之"));
		u.lang = "zh-CN";
		u.rate = 0.9;
		const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith("zh"));
		if (voice) u.voice = voice;
		speechSynthesis.cancel();
		speechSynthesis.speak(u);
	}

	private onKey(e: KeyboardEvent): void {
		if ($<HTMLDialogElement>("settings").open) return;
		const q = this.quiz;
		if (q && !q.outcome) {
			const question = q.session.current;
			if (q.answered) {
				if (e.key === "Enter" || e.key === " ") this.next();
				return;
			}
			if (!question) return;
			if (question.kind === "choice") {
				const c = question.choices!.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
				if (c) this.submit(c.key);
			} else if (/^[0-9./]$/.test(e.key)) this.key(e.key);
			else if (e.key === "," || e.key === "，" || e.key === " ") this.key("，");
			else if (e.key === "Backspace") this.key("⌫");
			else if (e.key === "Enter") this.key("确定");
			e.preventDefault();
			return;
		}
		if (e.key === "Escape") this.close();
		if (!q && /^[1-6]$/.test(e.key)) this.scene.focusGrade(Number(e.key));
	}

	toast(msg: string, ms = 3000): void {
		const el = $("toast");
		el.textContent = msg;
		el.hidden = false;
		clearTimeout(this.toastTimer);
		this.toastTimer = window.setTimeout(() => (el.hidden = true), ms);
	}
}
