// 美术资源：代码要加载的每个文件都在 public/art/ 里，并且符合 docs/art-prompt.md 的基本规格。
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODELS } from "../src/scene/assets";

const ART = "public/art/";

// 只读 GLB 的 JSON 块
function gltfJson(file: string) {
	const b = readFileSync(file);
	expect(b.readUInt32LE(0)).toBe(0x46546c67); // "glTF"
	const len = b.readUInt32LE(12);
	return JSON.parse(b.subarray(20, 20 + len).toString("utf8"));
}

describe("art", () => {
	it("每个模型都在，只用一个 palette 材质，引用共享的调色板贴图，底面在 y = 0", () => {
		for (const name of MODELS) {
			const file = `${ART}models/${name}.glb`;
			expect(existsSync(file), file).toBe(true);
			const j = gltfJson(file);
			expect(j.materials.map((m: { name: string }) => m.name)).toEqual(["palette"]);
			expect(j.images.map((i: { uri: string }) => i.uri)).toEqual(["../textures/palette.png"]);
			let minY = Infinity;
			for (const n of j.nodes) {
				expect(n.rotation ?? n.scale ?? n.matrix, `${name} node transform`).toBeUndefined();
				if (n.mesh === undefined) continue;
				for (const p of j.meshes[n.mesh].primitives) {
					minY = Math.min(minY, j.accessors[p.attributes.POSITION].min[1] + (n.translation?.[1] ?? 0));
				}
			}
			expect(Math.abs(minY), name).toBeLessThan(1e-3);
		}
	});

	it("会动的零件有正确的节点名", () => {
		const names = (m: string) => gltfJson(`${ART}models/${m}.glb`).nodes.map((n: { name?: string }) => n.name);
		for (const lv of [2, 3]) expect(names(`mill_${lv}`)).toContain("blades");
		for (const lv of [2, 3]) expect(names(`plaza_${lv}`)).toContain("flag");
		for (const b of ["mill", "library", "watchtower", "market", "plaza"]) expect(names(`${b}_3`)).toContain("pennant");
	});

	it("贴图、精灵和界面图标都在", () => {
		const files = [
			"textures/palette.png",
			"sprites/bubble_review.png",
			"sprites/bubble_alert.png",
			"sprites/particle_star.png",
		];
		const icons = [
			"star", "star_empty", "foundation", "house", "crown", "broom", "pencil", "lock",
			"speaker", "patrol", "castle", "settings", "correct", "wrong",
		];
		for (const f of [...files, ...icons.map((i) => `ui/icon_${i}.png`)]) {
			expect(existsSync(ART + f), f).toBe(true);
		}
		for (const f of ["favicon-64.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"]) {
			expect(existsSync(`public/icons/${f}`), f).toBe(true);
		}
	});
});
