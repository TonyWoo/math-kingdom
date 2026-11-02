// 3D 画面里的名字标签做成悬浮小卡片：限定宽度、长名字自动折成多行，有底色和指向建筑的小尖角。
// 地图视角和第一人称共用；样式在 style.css 的 .card。

export type CardKind = "plot" | "village";

// pointer：小尖角朝哪边——"down" 卡片在建筑上方，"up" 卡片在建筑下方
export function labelCard(kind: CardKind, title: string, sub?: string, pointer: "up" | "down" = "down"): HTMLElement {
	const el = document.createElement("div");
	el.className = `label card ${kind} ${pointer}`;
	const t = document.createElement("span");
	t.className = "title";
	t.textContent = title;
	el.appendChild(t);
	if (sub) {
		const s = document.createElement("span");
		s.className = "sub";
		s.textContent = sub;
		el.appendChild(s);
	}
	return el;
}
