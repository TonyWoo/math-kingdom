// 界面：顶栏统计、年级按钮、地块详情面板、答题（选择题按钮 / 数字键盘）、朗读、设置、提示。
// 进度在这里持有，答完题更新进度、存档、刷新场景。
//
// 网址参数（方便演示和测试）：
//   ?demo=1          用演示进度（不覆盖已有存档，除非在设置里载入）
//   ?select=<id>     打开某个知识点的面板
//   ?focus=<年级>     镜头对准某个年级
//   ?days=<n>        把“现在”往后挪 n 天，看复习提醒

import { type Kingdom, type Progress, type Status, demoProgress, frontier, gradeFrontier, needsCare, stars, status, summary } from "../core/kingdom";
import { answerCount } from "../core/judge";
import { type Outcome, type Plan, QuizSession, planFor } from "../core/quiz";
import * as save from "../core/save";
import { type Battle, type BattleResult, KIND, MAX_THROUGH, WAVES, rewardFor, answer as battleAnswer, canDefend, createBattle, current as battleTarget, settle, step as battleStep, villageReady } from "../core/defense";
import type { Question } from "../core/types";
import { type Mood, teacherOf } from "../scene/teachers";
import type { Spot, View } from "../scene/view";
import { speak as say, stopSpeaking } from "./speech";
import { music } from "./music";

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
	private gradeFilter: number | null = null; // 地图只显示这个年级，null = 全部
	private dayOffset: number;
	private spot: Spot | null = null; // “我在这里”：地图上的小人、第一人称的出发点
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
			this.defense = saved?.defense ?? {};
			this.spot = saved?.spot ?? null;
		}

		this.attach(scene);
		this.setupChrome();
		this.render();

		const focus = Number(params.get("focus"));
		const select = params.get("select");
		if (select && k.topics.has(select)) {
			scene.focusPlot(select, true);
			this.open(select, false);
			this.moveSpot(this.spotNear(select));
		} else if (focus >= 1 && focus <= 6 && k.data.rings.some((r) => r.grade === focus)) {
			scene.focusGrade(focus, true);
			if (this.spot) scene.setSpot?.(this.spot); // 小人还在原来的地方，镜头听网址的
		} else {
			// 从“开拓前线”开始：按依赖顺序（先修在前）最早的未学内容，镜头和小人都定位到它附近
			const start = frontier(k, this.progress, this.now()) ?? k.order[0];
			scene.focusPlot(start, true);
			this.moveSpot(this.spotNear(start));
			if (Object.keys(this.progress).length === 0) {
				this.toast(`欢迎来到数学王国！从王城旁边的「${k.topic(start).name}」开始建造吧。`, 6000);
			}
		}
	}

	// 接上一个视角：点选回调、当前进度
	private attach(view: View): void {
		view.onPick = (id) => {
			if (!id) this.close();
			else if (id.startsWith("village:")) this.openVillage(Number(id.slice(8)));
			else this.open(id, false);
		};
		view.onSpot = (spot) => {
			this.spot = spot;
			this.persist();
		};
		view.refresh(this.progress, this.now());
		this.markVillages();
		view.setGradeFilter?.(this.gradeFilter);
	}

	// 地块靠王城一侧，面朝它（和地图视角点地块时一样）
	private spotNear(id: string): Spot {
		const t = this.k.topic(id);
		const len = Math.hypot(t.x, t.y) || 1;
		return { x: t.x - (t.x / len) * 60, y: t.y - (t.y / len) * 60, lookX: t.x, lookY: t.y };
	}

	private moveSpot(spot: Spot): void {
		this.spot = spot;
		this.scene.setSpot?.(spot);
		this.persist();
	}

	// ---- 保卫战（第一人称） ----
	private village: number | null = null; // 打开的村庄路牌
	private defense: Record<string, { won: boolean; best: number }> = {};
	private fight: {
		b: Battle;
		paused: boolean;
		input: string;
		note: string; // 老师要说的一句（打中、冲过来、新一波……）
		mood: Mood;
		result?: BattleResult;
		reward?: string; // 第一次守住时得到的装饰
	} | null = null;

	// 村庄路牌上的旗：可以保卫的红旗，守住过的金旗
	private markVillages(): void {
		this.scene.villages?.(
			this.k.data.villages.map((_, i) => (this.defense[i]?.won ? "defended" : canDefend(this.k, this.progress, i) ? "ready" : "none")),
		);
	}

	private openVillage(index: number): void {
		if (this.quiz && !this.quiz.outcome) {
			this.toast("先把这次答题做完吧");
			return;
		}
		this.quiz = null;
		this.selected = null;
		this.village = index;
		this.scene.select(`village:${index}`);
		this.renderPanel();
	}

	private startBattle(): void {
		if (this.village === null) return;
		if (!canDefend(this.k, this.progress, this.village)) return;
		const b = createBattle(this.k, this.progress, this.village);
		this.fight = { b, paused: false, input: "", note: "开始", mood: "talk" };
		this.scene.battle?.start(b);
		music.battle();
		this.renderPanel();
	}

	private stopBattle(): void {
		if (!this.fight) return;
		this.scene.battle?.end();
		this.fight = null;
		music.home();
	}

	// 每帧推进战斗；有变化才重画面板
	private stepBattle(dt: number): void {
		const f = this.fight;
		if (!f || f.paused || f.result || !this.scene.battle) return;
		const ev = battleStep(f.b, dt);
		if (!ev.length) return;
		this.scene.battle.events(ev);
		for (const e of ev) {
			if (e.type === "through") {
				const who = KIND[e.enemy.kind].name;
				const left = Math.max(0, MAX_THROUGH - f.b.through);
				f.note = e.enemy.kind === "boss" ? `哥布林大王冲进广场了！一下子少了 2 颗心，还剩 ${left} 颗。` : `糟糕，${who}冲进广场了！还能再挡住 ${left} 个。`;
				f.mood = "sad";
			}
			if (e.type === "wave") {
				f.note = e.wave === 1 ? "第 2 波来了！小心，狼跑得很快！" : "最后一波！投石车要打两次，哥布林大王压轴，它的盾牌上是一道算式！";
				f.mood = "talk";
			}
			if (e.type === "spawn" && e.enemy.kind === "boss") {
				f.note = "哥布林大王来啦！要打中它三次，每次算出它盾牌上的算式。";
				f.mood = "talk";
			}
		}
		if (f.b.finished) this.finishBattle();
		else this.renderPanel();
	}

	private finishBattle(): void {
		const f = this.fight!;
		const now = this.now();
		f.result = settle(f.b, this.progress, now);
		music.home();
		if (f.result.won) music.celebrate();
		const key = String(f.b.village);
		const prev = this.defense[key];
		this.defense[key] = { won: (prev?.won ?? false) || f.result.won, best: Math.max(prev?.best ?? 0, f.result.accuracy) };
		if (f.result.won && !prev?.won) f.reward = rewardFor(f.b.village).name;
		this.persist();
		this.scene.refresh(this.progress, now);
		this.markVillages();
		this.render();
		this.renderPanel();
	}

	private battleKey(k: string): void {
		const f = this.fight;
		if (!f || f.result || f.paused || !battleTarget(f.b)) return;
		if (k === "确定") {
			if (!f.input.trim()) return;
			const res = battleAnswer(f.b, f.input);
			f.input = "";
			if (res) {
				this.scene.battle?.events(res.events);
				const q = res.question;
				const e = res.enemy;
				const slowed = res.events.some((x) => x.type === "pace" && !x.faster);
				const faster = res.events.some((x) => x.type === "pace" && x.faster);
				if (res.correct && e.state === "walking") {
					f.note = e.kind === "boss" ? `打中哥布林大王了！还要再打 ${e.hp} 次！` : `打中投石车了！再来 ${e.hp} 次就能打倒它！`;
					f.mood = "happy";
				} else if (res.correct) {
					f.note = e.kind === "boss" ? "哥布林大王被打倒啦！" : ["打中啦！", "漂亮，打中了！", "太准了！", "又打倒一个！"][f.b.correct % 4];
					if (faster) f.note += "你答得又快又准，红方也加快速度了！";
					f.mood = e.kind === "boss" ? "cheer" : "happy";
				} else {
					f.note = `哎呀，它冲过来了！刚才的答案是 ${q.answer}。${q.explanation ?? ""}`;
					if (slowed && f.b.misses >= 2) f.note += "别着急，我让红方走慢一点。";
					f.mood = "sad";
				}
				if (f.b.finished) return this.finishBattle();
			}
		} else if (k === "⌫") f.input = f.input.slice(0, -1);
		else if (k === "清空") f.input = "";
		else if (f.input.length < 12) f.input += k;
		this.renderPanel();
	}

	private villageHtml(): string {
		const i = this.village!;
		const v = this.k.data.villages[i];
		const leave = `<button class="btn ghost" data-act="close">下次再来</button>`;
		const f = this.fight;
		if (f?.result) {
			const r = f.result;
			const weak = r.weak.length
				? `<h3>这些地方再复习一下</h3>${r.weak.map((id) => `<button class="prereq" data-go="${id}"><span class="tag no">复习</span>${esc(this.k.topic(id).name)}</button>`).join("")}`
				: "";
			return `
				<div class="result">
					<div class="big">${icon(r.won ? "crown" : "wrong", "xl")}</div>
					<h2>${r.won ? "守住啦！" : "这次没守住"}</h2>
					<p>正确率 ${Math.round(r.accuracy * 100)}%${r.reviewed.length ? `，算作复习了 ${r.reviewed.length} 个知识点` : ""}。</p>
					${f.reward ? `<p class="reward">村庄升级成城镇，围上了城墙！奖励：<b>${esc(f.reward)}</b>（放在广场旁边）</p>` : ""}
				</div>
				${weak}
				<div class="action"><button class="btn primary" data-act="bstart">再打一次</button><button class="btn ghost" data-act="close">离开</button></div>`;
		}
		if (f) {
			const b = f.b;
			const hearts = Array.from({ length: MAX_THROUGH }, (_, j) => `<span class="${j < MAX_THROUGH - b.through ? "on" : ""}">♥</span>`).join("");
			const head = `<div class="battle-head"><span>保卫「${esc(v.name)}」</span><span>第 ${b.wave + 1} / ${WAVES.length} 波</span><span class="hearts">${hearts}</span>
				<button class="btn ghost pause" data-act="bpause">${f.paused ? "继续" : "暂停"}</button></div>`;
			if (f.paused) return `${head}<p class="wait">暂停中……点“继续”接着打。</p>`;
			const t = battleTarget(b);
			if (!t) return `${head}<p class="wait">等待红方骑士……</p>`;
			return `${head}
				<div class="prompt"><span class="text">${esc(t.question.prompt)}</span>${
					"speechSynthesis" in window ? `<button class="speak" data-act="speak" title="读题">${icon("speaker")}</button>` : ""
				}</div>
				<p class="hint">${
					t.kind === "boss" ? "算出哥布林大王盾牌上的算式" : `答案就是走在最前面的${KIND[t.kind].name}盾牌上的数${t.hp > 1 ? `（还要打 ${t.hp} 次）` : ""}`
				}</p>
				<div class="entry">${f.input ? esc(f.input) : '<span class="placeholder">输入答案</span>'}</div>
				${this.keypadHtml()}`;
		}
		const ready = villageReady(this.k, this.progress, i);
		const chips = `<div class="chips"><span class="chip">${esc(v.unit)}</span><span class="chip">${v.plots.length} 块地</span>${
			this.defense[i]?.won ? `<span class="chip">城镇 · 最好 ${Math.round(this.defense[i].best * 100)}%</span><span class="chip">${esc(rewardFor(i).name)}</span>` : ""
		}</div>`;
		if (!ready.ready) {
			return `<button class="close" data-act="close" aria-label="离开">×</button><h2>${esc(v.name)}</h2>${chips}
				<h3>还没到 2 颗星的地</h3>${ready.missing.map((id) => `<button class="prereq" data-go="${id}"><span class="tag no">${stars(this.progress, id)} 星</span>${esc(this.k.topic(id).name)}</button>`).join("")}
				<div class="action">${leave}</div>`;
		}
		// 保卫战靠填数题出题（盾牌上是数字）；没有填数题的村庄（比如纯选择题的学科）不开打
		if (!canDefend(this.k, this.progress, i)) {
			return `<button class="close" data-act="close" aria-label="离开">×</button><h2>${esc(v.name)}</h2>${chips}
				<p class="hint">这个村庄全是星星了。保卫战要用填数题出题，这个村庄没有合适的题，就先安安稳稳住着吧。</p>
				<div class="action">${leave}</div>`;
		}
		return `<button class="close" data-act="close" aria-label="离开">×</button><h2>${esc(v.name)}</h2>${chips}
			<div class="action"><button class="btn warm" data-act="bstart">${icon("castle")}开始保卫战</button><p class="hint">三波红方：骑士、狼、投石车，最后是哥布林大王。冲进广场 ${MAX_THROUGH} 个就算没守住</p>${leave}</div>`;
	}

	private villageLine(): [string, Mood] {
		const i = this.village!;
		const v = this.k.data.villages[i];
		const teacher = teacherOf(v.domain);
		const name = `「${v.name}」`;
		const f = this.fight;
		if (f?.result) {
			const r = f.result;
			return r.won
				? [`我们守住${name}啦！正确率 ${Math.round(r.accuracy * 100)}%，你真是了不起的守护者！${f.reward ? `村庄变成城镇了，还得到了一座${f.reward}！` : ""}`, "cheer"]
				: ["这次没守住……没关系，看看哪几题错了，复习一下再来挑战！", "sad"];
		}
		if (f) {
			if (f.paused) return ["先休息一下，准备好了就点继续。", "talk"];
			const t = battleTarget(f.b);
			const intro = f.note === "开始" ? "红方要来抢旗子了！每个敌人的盾牌上都有一个数，算出答案，防御塔就会打中它。" : f.note;
			const ask = t ? (t.kind === "boss" ? t.question.prompt : `最前面的${KIND[t.kind].name}：${t.question.prompt}`) : "";
			return [`${intro}${ask ? (intro ? " " : "") + ask : ""}`, f.mood];
		}
		const ready = villageReady(this.k, this.progress, i);
		if (!ready.ready) {
			return [`${name}还有 ${ready.missing.length} 块地不到 2 颗星。房子都盖好了，才能保卫村庄哦。`, "talk"];
		}
		if (this.defense[i]?.won) return [`${teacher.hello}${name}已经是城镇啦，你看那座${rewardFor(i).name}！要不要再来一场练习战？`, "happy"];
		return [`${teacher.hello}${name}的房子都盖好啦！红方骑士要来抢旗子，我们一起保卫村庄吧！`, "talk"];
	}

	// 切换视角（地图 ↔ 第一人称）：新视角同步进度和选中的地块，并把镜头或玩家带到选中的地块
	setView(view: View): void {
		if (view === this.scene) return;
		if (this.village !== null) this.close(); // 保卫战只在第一人称里
		// 从哪里来就站到哪里：地图上的小人 → 第一人称的出发点；第一人称走到的地方 → 地图上的小人
		const spot = this.scene.getSpot?.() ?? this.spot;
		if (spot) {
			this.spot = spot;
			this.persist();
		}
		this.scene.show(false);
		this.scene = view;
		this.attach(view);
		view.show(true);
		view.select(this.selected);
		if (spot && view.setSpot) view.setSpot(spot, true);
		else if (this.selected) view.focusPlot(this.selected, true);
		this.lastLine = "";
		if (this.selected) {
			this.renderPanel();
		} else {
			$("panel").hidden = true;
			view.panelChanged(false);
		}
		this.updateInset();
	}

	get view(): View {
		return this.scene;
	}

	now(): number {
		return Date.now() + this.dayOffset * 86400_000;
	}

	private persist(): void {
		save.store({ progress: this.progress, demo: this.demo, defense: this.defense, spot: this.spot ?? undefined });
	}

	private setupChrome(): void {
		const grades = $("grades");
		const all = document.createElement("button");
		all.className = "btn";
		all.textContent = "全部";
		all.onclick = () => this.setGradeFilter(null);
		grades.appendChild(all);
		// 年级按钮按数据里实际有的年级圈建：英语从三年级起，就只有三到六年级的按钮。
		// 点年级 = 地图只显示这一年级（再点一次或点「全部」恢复）
		for (const ring of this.k.data.rings) {
			const b = document.createElement("button");
			b.className = "btn";
			b.textContent = GRADE_NAME[ring.grade - 1] ?? `${ring.grade}年级`;
			b.onclick = () => this.setGradeFilter(this.gradeFilter === ring.grade ? null : ring.grade);
			grades.appendChild(b);
		}
		$("home").onclick = () => this.scene.goHome();
		$("view").onclick = () => {
			const s = this.scene as View & { toggleTopDown?: () => boolean };
			if (!s.toggleTopDown) return;
			$("view").querySelector(".lbl")!.textContent = s.toggleTopDown() ? "斜视" : "俯视";
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
			this.defense = {};
			save.clear();
			this.afterReset();
			dialog.close();
			this.toast("进度已清空，从头开始建造吧");
		};
		const musicBtn = $<HTMLButtonElement>("music-toggle");
		const muteBtn = $<HTMLButtonElement>("mute");
		const paintMusic = () => {
			musicBtn.textContent = music.enabled ? "音乐：开" : "音乐：关";
			muteBtn.querySelector("img")!.src = `${import.meta.env.BASE_URL}art/ui/icon_${music.enabled ? "speaker" : "mute"}.png`;
			muteBtn.title = music.enabled ? "静音" : "打开音乐";
		};
		paintMusic();
		const toggleMusic = () => {
			music.setEnabled(!music.enabled);
			paintMusic();
		};
		musicBtn.onclick = toggleMusic;
		muteBtn.onclick = toggleMusic;
		window.addEventListener("keydown", (e) => this.onKey(e));
		window.addEventListener("resize", () => this.updateInset());
	}

	private afterReset(): void {
		this.quiz = null;
		this.persist();
		this.scene.refresh(this.progress, this.now());
		this.markVillages();
		this.close();
		this.render();
	}

	// 顶栏统计、巡视数字、当前年级
	private render(): void {
		const s = summary(this.k, this.progress, this.now());
		const built = s.built + s.due + s.weeds + s.goblin;
		$("stats").innerHTML =
			`<span>${icon("house")}<span class="lbl">建成 </span><b>${built}</b> / ${s.total}</span>` +
			`<span>${icon("star")}<b>${s.stars}</b></span>` +
			`<span>${icon("foundation")}<span class="lbl">可建造 </span><b>${s.open}</b></span>` +
			(this.demo ? `<span class="muted">演示进度</span>` : "");
		const care = s.due + s.weeds + s.goblin;
		$("patrol").innerHTML = `${icon("patrol")}<span class="lbl">今日巡视</span>${care ? `<span class="badge">${care}</span>` : ""}`;
	}

	// 地图按年级筛选：只显示这一年级的内容，镜头也飞过去；null 恢复全部
	private setGradeFilter(grade: number | null): void {
		if (this.quiz && !this.quiz.outcome) {
			this.toast("先把这次答题做完吧");
			return;
		}
		this.gradeFilter = grade;
		this.close();
		this.scene.setGradeFilter?.(grade);
		// 定位到这个范围里按依赖顺序最早的未学内容，小人也跟过去；都学完了就看整圈（或全部时回全景）
		const start = grade === null ? frontier(this.k, this.progress, this.now()) : gradeFrontier(this.k, this.progress, this.now(), grade);
		if (start) {
			this.scene.focusPlot(start);
			if (!this.scene.dialogue) this.moveSpot(this.spotNear(start));
		} else if (grade === null) this.scene.goHome();
		else this.scene.focusGrade(grade);
	}

	// 当前镜头对着哪个年级（每帧调用）；筛选状态下高亮的是被筛的年级和「全部」
	tick(dt = 0): void {
		this.stepBattle(dt);
		const buttons = $("grades").children;
		buttons[0].classList.toggle("active", this.gradeFilter === null);
		const r = this.scene.radius();
		const rings = this.k.data.rings;
		for (let i = 0; i < rings.length; i++) {
			const ring = rings[i];
			const on = this.gradeFilter !== null ? this.gradeFilter === ring.grade : r >= ring.r1 - 70 && r <= ring.r2;
			buttons[i + 1].classList.toggle("active", on);
		}
	}

	open(id: string, fly: boolean): void {
		if (this.quiz && this.quiz.session.id !== id && !this.quiz.outcome) {
			this.toast("先把这次答题做完吧");
			return;
		}
		// 筛选时从巡视/先修链接跳到别的年级的地块，先恢复全部显示，不然跳过去是块空地
		if (this.gradeFilter !== null && this.k.topic(id).grade !== this.gradeFilter) this.setGradeFilter(null);
		this.quiz = null;
		this.stopBattle();
		this.village = null;
		this.selected = id;
		this.scene.select(id);
		if (fly) {
			this.scene.focusPlot(id);
			// 巡视、先修链接跳过去时，地图上的小人也跟过去（第一人称里 focusPlot 自己找站的地方）
			if (!this.scene.dialogue) this.moveSpot(this.spotNear(id));
		}
		this.renderPanel();
	}

	close(): void {
		if (this.quiz && !this.quiz.outcome) return;
		this.stopBattle();
		this.village = null;
		this.quiz = null;
		this.selected = null;
		this.lastLine = "";
		this.scene.select(null);
		$("panel").hidden = true;
		if (this.scene.dialogue) stopSpeaking();
		this.scene.panelChanged(false);
		this.updateInset();
	}

	// 面板打开时让 3D 画面的中心避开它
	private updateInset(): void {
		const panel = $("panel");
		if (panel.hidden || this.scene.dialogue) {
			this.scene.setInset(0, 0);
		} else if (window.innerWidth > 760) {
			this.scene.setInset(panel.offsetWidth + 12, 0);
		} else {
			this.scene.setInset(0, panel.offsetHeight);
		}
	}

	// 对话模式（第一人称）：面板内容画在老师旁边的全息面板上，台词变了才让老师说
	private lastLine = "";

	private renderDialogue(): boolean {
		const dlg = this.scene.dialogue;
		if (!dlg || (!this.selected && this.village === null)) return false;
		$("panel").hidden = true;
		this.scene.panelChanged(true);
		const host = dlg.host();
		host.innerHTML =
			this.village !== null ? this.villageHtml() : this.quiz ? (this.quiz.outcome ? this.resultHtml() : this.quizHtml()) : this.holoTopicHtml();
		this.bindPanel(host);
		const [line, mood] = this.village !== null ? this.villageLine() : this.teacherLine();
		if (line !== this.lastLine) {
			this.lastLine = line;
			dlg.say(line, mood);
		}
		this.updateInset();
		return true;
	}

	// 全息面板上的知识点卡：名称、星星、状态和要做的事；说明由老师说出来
	private holoTopicHtml(): string {
		const id = this.selected!;
		const t = this.k.topic(id);
		const v = this.k.data.villages[t.village];
		const st = status(this.k, this.progress, id, this.now());
		const plan = planFor(this.k, this.progress, id, this.now());
		const leave = `<button class="btn ghost" data-act="close">下次再来</button>`;
		let actions = "";
		if (plan.kind === "locked") {
			actions = plan.missing
				.map((p) => `<button class="prereq" data-go="${p}"><span class="tag no">去学</span>${esc(this.k.topic(p).name)}</button>`)
				.join("");
		} else if (plan.kind === "build") {
			const s = STAGE[plan.stage];
			actions = `<button class="btn primary" data-act="start">${icon(s.icon)}开始：${s.name}</button><p class="hint">${s.need}</p>`;
		} else if (plan.kind === "review") {
			actions = `<button class="btn warm" data-act="start">${icon("broom")}开始复习</button><p class="hint">答对 2 道题，答错不扣星</p>`;
		} else {
			actions = `<button class="btn primary" data-act="practice">${icon("pencil")}练一练</button>`;
		}
		return `
			<button class="close" data-act="close" aria-label="离开">×</button>
			<h2>${esc(t.name)}</h2>
			<div class="chips"><span class="chip">${esc(v.unit)}</span><span class="chip">${BUILDING_NAME[t.building]}</span></div>
			<div class="state"><span>${STATUS_TEXT[st]}</span>${this.starsHtml(stars(this.progress, id))}</div>
			<div class="action">${actions}${leave}</div>`;
	}

	// 老师现在要说的话和表情
	private teacherLine(): [string, Mood] {
		const id = this.selected!;
		const t = this.k.topic(id);
		const teacher = teacherOf(t.domain);
		const name = `「${t.name}」`;
		const q = this.quiz;
		if (!q) {
			const plan = planFor(this.k, this.progress, id, this.now());
			const st = status(this.k, this.progress, id, this.now());
			const hi = `${teacher.hello}我是${teacher.name}。`;
			switch (plan.kind) {
				case "locked":
					return [`这里还被迷雾挡着呢。先去学会「${plan.missing.map((p) => this.k.topic(p).name).join("」「")}」，迷雾就会散开啦。`, "sad"];
				case "build":
					if (plan.stage === 1) {
						return [`${hi}这里是${name}：${t.description}想在这里盖一座${BUILDING_NAME[t.building]}吗？先答对 2 道基础题，打好地基吧！`, "talk"];
					}
					return plan.stage === 2
						? [`${hi}${name}的地基已经打好啦。再答对 1 道标准题，房子就能盖起来！`, "talk"]
						: [`${hi}${name}的房子真漂亮！答对 1 道挑战题，就能升金顶哦。`, "talk"];
				case "wait":
					return [`${name}今天已经升过级啦。隔一天还会，才算真的学会，明天再来升金顶吧！`, "talk"];
				case "review":
					if (st === "goblin") return [`不好啦！哥布林占领了${name}！快答对 2 道题把它赶走！`, "sad"];
					if (st === "weeds") return [`哎呀，这里长草了……我们一起复习${name}，把草拔掉吧！`, "sad"];
					return [`${hi}好久不见！${name}该复习啦，答对 2 道题，房子会更结实。`, "talk"];
				case "practice":
					return [`${hi}${name}已经是三颗星的金顶啦！要不要再练一练？`, "happy"];
			}
		}
		const s = q.session;
		if (q.outcome) {
			const o = q.outcome;
			if (!o.success) {
				const roots = o.roots.length ? `地基好像不太稳，先去巩固「${o.roots.map((p) => this.k.topic(p).name).join("」「")}」吧。` : "看看讲解，再试一次吧！";
				return [`没关系，${roots}`, "sad"];
			}
			if (s.plan.kind === "build") return [`${STAGE[s.plan.stage].done}${name}得到了第 ${o.starsAfter} 颗星，你真了不起！`, "cheer"];
			if (s.plan.kind === "review") return [`打扫干净啦！${name}又闪闪发光了。`, "cheer"];
			return ["全部答对，太棒了！", "cheer"];
		}
		const question = s.questions[q.answered ? s.index - 1 : s.index];
		if (q.answered) {
			const ok = s.results.at(-1);
			if (ok) return [["答对啦！你真棒！", "完全正确！", "太厉害了！", "对啦，就是这样！"][s.index % 4], "happy"];
			const answer = question.kind === "choice" ? `${question.answer}，${question.choices!.find((c) => c.key === question.answer)?.text ?? ""}` : question.answer;
			return [`差一点点！正确答案是 ${answer}。${question.explanation ?? ""}`, "sad"];
		}
		const opts = question.choices ? `是 ${question.choices.map((c) => `${c.key}，${c.text}`).join("；还是 ")}？` : "";
		const fresh = question.variantOf ? "这道题我换了几个数字。" : "";
		return [`第 ${s.index + 1} 题。${fresh}${question.prompt}${opts}`, "talk"];
	}

	private renderPanel(): void {
		if (this.renderDialogue()) return;
		const panel = $("panel");
		panel.hidden = false;
		if (this.quiz) {
			panel.innerHTML = this.quiz.outcome ? this.resultHtml() : this.quizHtml();
		} else {
			panel.innerHTML = this.topicHtml();
		}
		this.bindPanel();
		// 短答题的输入框：面板一出来就聚焦，省一次点按
		const ti = panel.querySelector<HTMLInputElement>("#text-answer");
		if (ti && this.quiz && !this.quiz.answered) ti.focus();
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

	private bindPanel(panel: HTMLElement = $("panel")): void {
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
			case "tsubmit": {
				const input = $<HTMLInputElement>("text-answer");
				if (input?.value.trim()) this.submit(input.value);
				break;
			}
			case "next":
				this.next();
				break;
			case "bstart":
				this.startBattle();
				break;
			case "bpause":
				if (this.fight) {
					this.fight.paused = !this.fight.paused;
					this.renderPanel();
				}
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
		} else if (question.kind === "numeric") {
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
		} else {
			// 短答题：直接打字输入（拼写、写词语这类），判题走 judge 的文本比对
			const ok = q.answered ? s.results.at(-1) : undefined;
			body += `<div class="text-answer ${ok === true ? "right" : ok === false ? "wrong" : ""}"><input id="text-answer" type="text" placeholder="把答案写在这里" autocomplete="off" ${q.answered ? "disabled" : ""} value="${esc(q.answered ? (q.picked ?? "") : q.input)}" />${
				q.answered ? "" : '<button class="btn primary" data-act="tsubmit">确定</button>'
			}</div>`;
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
			<div class="action">${again}<button class="btn ghost" data-act="back" style="margin-top:10px">返回</button>${
				this.scene.dialogue ? '<button class="btn ghost" data-act="close">离开</button>' : ""
			}</div>`;
	}

	private key(k: string): void {
		if (this.fight) return this.battleKey(k);
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
		this.markVillages();
		if (q.outcome.success && q.session.plan.kind !== "practice") {
			this.scene.celebrate(q.session.id);
			music.celebrate();
		}
		const unlocked = this.k.order.filter((id) => before.get(id) === "locked" && status(this.k, this.progress, id, now) === "open");
		if (unlocked.length) {
			this.toast(`迷雾散开了！解锁了新地块：${unlocked.map((id) => this.k.topic(id).name).join("、")}`, 5000);
		}
		this.render();
		this.renderPanel();
	}

	private speak(): void {
		const t = this.fight && battleTarget(this.fight.b);
		if (t) return say(t.question.prompt);
		const q = this.quiz;
		if (!q) return;
		const s = q.session;
		const question = s.questions[q.answered ? s.index - 1 : s.index];
		let text = question.prompt;
		if (question.choices) text += "。" + question.choices.map((c) => `${c.key}，${c.text}`).join("。");
		say(text);
	}

	private onKey(e: KeyboardEvent): void {
		if ($<HTMLDialogElement>("settings").open) return;
		const q = this.quiz;
		const f = this.fight;
		if (f && !f.result) {
			if (/^[0-9./]$/.test(e.key)) this.battleKey(e.key);
			else if (e.key === "," || e.key === "，") this.battleKey("，");
			else if (e.key === "Backspace") this.battleKey("⌫");
			else if (e.key === "Enter") this.battleKey("确定");
			else if (e.key === "Escape" || e.key === "p") {
				f.paused = !f.paused;
				this.renderPanel();
			}
			e.preventDefault();
			return;
		}
		if (q && !q.outcome) {
			// 焦点在短答输入框里时，打字归输入框自己管，只有回车是提交
			if (e.target instanceof HTMLInputElement && !q.answered) {
				if (e.key === "Enter") {
					const v = e.target.value;
					if (v.trim()) this.submit(v);
					e.preventDefault();
				}
				return;
			}
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
		if (!q && /^[1-6]$/.test(e.key) && this.k.data.rings.some((r) => r.grade === Number(e.key))) this.scene.focusGrade(Number(e.key));
	}

	toast(msg: string, ms = 3000): void {
		const el = $("toast");
		el.textContent = msg;
		el.hidden = false;
		clearTimeout(this.toastTimer);
		this.toastTimer = window.setTimeout(() => (el.hidden = true), ms);
	}
}
