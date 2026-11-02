import "./style.css";
import raw from "./data/kingdom.json";
import { Kingdom } from "./core/kingdom";
import type { KingdomData } from "./core/types";
import { loadAssets } from "./scene/assets";
import { useAssets } from "./scene/buildings";
import { KingdomScene } from "./scene/kingdom-scene";
import type { View } from "./scene/view";
import { App } from "./ui/app";

const data = raw as KingdomData;
const k = new Kingdom(data);
const assets = await loadAssets(import.meta.env.BASE_URL);
useAssets(assets);
const scene = new KingdomScene(document.getElementById("scene")!, data, k, assets);
const app = new App(k, scene);
document.getElementById("loading")?.remove();

// 第一人称方块世界：第一次切换时才生成（生成地形要一点时间），之后两个视角来回切换
let voxel: View | null = null;
const fpButton = document.getElementById("fp")!;
async function toggleFirstPerson(): Promise<void> {
	const toFp = app.view === scene;
	if (toFp && !voxel) {
		fpButton.setAttribute("disabled", "");
		fpButton.textContent = "生成中……";
		await new Promise((r) => setTimeout(r, 30)); // 让按钮文字先显示出来
		const { VoxelScene } = await import("./voxel/voxel-scene");
		const container = document.getElementById("voxel")!;
		container.style.display = "none";
		voxel = new VoxelScene(container, data, k);
		fpButton.removeAttribute("disabled");
	}
	app.setView(toFp ? voxel! : scene);
	document.body.classList.toggle("fp-mode", toFp);
	fpButton.textContent = toFp ? "地图视角" : "第一人称";
}
fpButton.onclick = () => void toggleFirstPerson();
if (new URLSearchParams(location.search).get("view") === "fp") void toggleFirstPerson();

let last = performance.now();
function frame(now: number) {
	const dt = Math.min(0.05, (now - last) / 1000);
	last = now;
	app.view.update(dt);
	app.tick();
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 调试用：在浏览器控制台里可以看 kingdom.scene.renderer.info
Object.assign(window, { kingdom: { scene, app, k, get voxel() { return voxel; } } });
