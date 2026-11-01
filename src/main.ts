import "./style.css";
import raw from "./data/kingdom.json";
import { Kingdom } from "./core/kingdom";
import type { KingdomData } from "./core/types";
import { KingdomScene } from "./scene/kingdom-scene";
import { App } from "./ui/app";

const data = raw as KingdomData;
const k = new Kingdom(data);
const scene = new KingdomScene(document.getElementById("scene")!, data, k);
const app = new App(k, scene);

let last = performance.now();
function frame(now: number) {
	const dt = Math.min(0.05, (now - last) / 1000);
	last = now;
	scene.update(dt);
	app.tick();
	requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 调试用：在浏览器控制台里可以看 kingdom.scene.renderer.info
Object.assign(window, { kingdom: { scene, app, k } });
