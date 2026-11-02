import "./style.css";
import { Kingdom } from "./core/kingdom";
import * as save from "./core/save";
import type { KingdomData } from "./core/types";
import { loadAssets } from "./scene/assets";
import { useAssets } from "./scene/buildings";
import { KingdomScene } from "./scene/kingdom-scene";
import { setTeacherDomains } from "./scene/teachers";
import type { View } from "./scene/view";
import { App } from "./ui/app";

// 学科索引和每科的数据都在 data/ 下（构建前由 scripts/split-subjects.mjs 生成），
// 按需加载：进哪科只下哪科的数据文件，切换学科就是带着 ?subject= 重新进页面。
interface SubjectInfo {
	id: string;
	name: string;
	kingdom: string;
}

const base = import.meta.env.BASE_URL;
const params = new URLSearchParams(location.search);

async function loadSubject(): Promise<{ subjects: SubjectInfo[]; info: SubjectInfo; data: KingdomData }> {
	const index = (await (await fetch(`${base}data/subjects.json`)).json()) as { subjects: SubjectInfo[] };
	const wanted = params.get("subject");
	const info = index.subjects.find((s) => s.id === wanted) ?? index.subjects.find((s) => s.id === "math") ?? index.subjects[0];
	const data = (await (await fetch(`${base}data/${info.id}.json`)).json()) as KingdomData;
	return { subjects: index.subjects, info, data };
}

const loaded = await loadSubject().catch(() => null);
if (!loaded) {
	document.getElementById("loading")!.textContent = "数据加载失败，请检查网络后刷新页面。";
	throw new Error("subject data failed to load");
}
const { subjects, info, data } = loaded;

document.title = info.kingdom;
document.getElementById("kingdom-name")!.textContent = info.kingdom;
save.useSubject(info.id);
setTeacherDomains(data.sectors.map((s) => s.domain));

// 顶栏的学科切换：换学科等于换一份数据和一份存档，整页重进最干净
const subjectSelect = document.getElementById("subject") as HTMLSelectElement;
for (const s of subjects) {
	const opt = document.createElement("option");
	opt.value = s.id;
	opt.textContent = s.name;
	subjectSelect.appendChild(opt);
}
subjectSelect.value = info.id;
subjectSelect.onchange = () => {
	params.set("subject", subjectSelect.value);
	location.search = params.toString();
};

const k = new Kingdom(data);
const assets = await loadAssets(import.meta.env.BASE_URL);
useAssets(assets);
const scene = new KingdomScene(document.getElementById("scene")!, data, k, assets);
const app = new App(k, scene);
document.getElementById("loading")?.remove();

// 第一人称方块世界：第一次切换时才生成（生成地形要一点时间），之后两个视角来回切换
let voxel: View | null = null;
const fpButton = document.getElementById("fp")!;
const fpLabel = fpButton.querySelector(".lbl")!;
async function toggleFirstPerson(): Promise<void> {
	const toFp = app.view === scene;
	if (toFp && !voxel) {
		fpButton.setAttribute("disabled", "");
		fpLabel.textContent = "生成中……";
		await new Promise((r) => setTimeout(r, 30)); // 让按钮文字先显示出来
		const { VoxelScene } = await import("./voxel/voxel-scene");
		const container = document.getElementById("voxel")!;
		container.style.display = "none";
		voxel = new VoxelScene(container, data, k);
		fpButton.removeAttribute("disabled");
	}
	app.setView(toFp ? voxel! : scene);
	document.body.classList.toggle("fp-mode", toFp);
	fpLabel.textContent = toFp ? "地图视角" : "第一人称";
}
fpButton.onclick = () => void toggleFirstPerson();
if (new URLSearchParams(location.search).get("view") === "fp") void toggleFirstPerson();

let last = performance.now();
function frame(now: number) {
	const dt = Math.min(0.05, (now - last) / 1000);
	last = now;
	app.view.update(dt);
	app.tick(dt);
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 调试用：在浏览器控制台里可以看 kingdom.scene.renderer.info
Object.assign(window, { kingdom: { scene, app, k, get voxel() { return voxel; } } });
