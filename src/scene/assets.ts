// 美术资源（public/art/，规格见 docs/art-prompt.md）：启动时加载全部要用的 .glb 和精灵图。
// 所有模型共用一张调色板贴图和同一个材质；每个模型里不会动的网格合并成一个几何体，
// 会动的零件（blades、flag、pennant、arm）单独保留几何体和枢轴位置，由场景每帧转动。
// 加载失败时返回 null，场景退回 buildings.ts 里用代码拼的建筑。

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const MODELS = [
	"mill_1", "mill_2", "mill_3",
	"library_1", "library_2", "library_3",
	"watchtower_1", "watchtower_2", "watchtower_3",
	"market_1", "market_2", "market_3",
	"plaza_1", "plaza_2", "plaza_3",
	"castle", "tree_pine", "tree_round", "tree_blossom", "village_plaza", "signpost",
	"weeds", "goblin", "cloud", "bush", "rock_1", "rock_2",
	// 保卫战守住后的城镇奖励装饰
	"deco_fountain", "deco_statue", "deco_flowerbed", "deco_bench", "deco_lamp", "deco_well",
] as const;

export type ModelName = (typeof MODELS)[number];

// 动画节点 → 场景里的动画标记（kingdom-scene.ts 的 animatePlots 按这些标记转动）
const ANIMATED: Record<string, Record<string, number | boolean>> = {
	blades: { spin: 1.2 }, // 绕 Z
	flag: { wave: true }, // 绕 Y
	pennant: { wave: true }, // 绕 Y
	arm: {}, // 投石车的臂，保卫战再用
};

export interface ModelPart {
	name: string;
	geometry: THREE.BufferGeometry;
	pivot: THREE.Vector3;
}

export interface Model {
	geometry: THREE.BufferGeometry | null; // 不会动的部分，合并后的
	parts: ModelPart[];
}

export interface Assets {
	material: THREE.MeshLambertMaterial;
	models: Map<ModelName, Model>;
	bubbleReview: THREE.Texture;
	bubbleAlert: THREE.Texture;
	star: THREE.Texture;
}

// 合并前统一属性：都转成非索引的，只保留位置、法线、UV
function normalize(g: THREE.BufferGeometry): THREE.BufferGeometry {
	const out = g.index ? g.toNonIndexed() : g.clone();
	for (const name of Object.keys(out.attributes)) {
		if (name !== "position" && name !== "normal" && name !== "uv") out.deleteAttribute(name);
	}
	if (!out.getAttribute("normal")) out.computeVertexNormals();
	return out;
}

function animatedName(o: THREE.Object3D): string | null {
	for (let p: THREE.Object3D | null = o; p; p = p.parent) {
		if (p.name in ANIMATED) return p.name;
	}
	return null;
}

function toModel(root: THREE.Object3D): Model {
	root.updateMatrixWorld(true);
	const statics: THREE.BufferGeometry[] = [];
	const parts: ModelPart[] = [];
	root.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		const name = animatedName(o);
		if (name) {
			// 零件的几何体保持在自己的局部坐标里，枢轴是它在模型里的位置
			const pivot = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
			const g = normalize(o.geometry);
			g.applyMatrix4(new THREE.Matrix4().extractRotation(o.matrixWorld));
			parts.push({ name, geometry: g, pivot });
		} else {
			const g = normalize(o.geometry);
			g.applyMatrix4(o.matrixWorld);
			statics.push(g);
		}
	});
	return { geometry: statics.length ? mergeGeometries(statics) : null, parts };
}

export async function loadAssets(base: string): Promise<Assets | null> {
	try {
		const textures = new THREE.TextureLoader();
		const palette = await textures.loadAsync(`${base}art/textures/palette.png`);
		// 调色板是离散色块：最近邻采样、不要 mipmap（否则色块边缘会混色），glTF 的 UV 约定 flipY = false
		palette.flipY = false;
		palette.colorSpace = THREE.SRGBColorSpace;
		palette.magFilter = THREE.NearestFilter;
		palette.minFilter = THREE.NearestFilter;
		palette.generateMipmaps = false;
		const material = new THREE.MeshLambertMaterial({ map: palette, flatShading: true });

		const loader = new GLTFLoader();
		const models = new Map<ModelName, Model>();
		await Promise.all(
			MODELS.map(async (name) => {
				const gltf = await loader.loadAsync(`${base}art/models/${name}.glb`);
				models.set(name, toModel(gltf.scene));
				// 模型自带的材质和贴图不用了
				gltf.scene.traverse((o) => {
					if (o instanceof THREE.Mesh) {
						o.geometry.dispose();
						(o.material as THREE.Material).dispose();
					}
				});
			}),
		);

		const sprite = async (file: string) => {
			const t = await textures.loadAsync(`${base}art/sprites/${file}`);
			t.colorSpace = THREE.SRGBColorSpace;
			return t;
		};
		const [bubbleReview, bubbleAlert, star] = await Promise.all([
			sprite("bubble_review.png"),
			sprite("bubble_alert.png"),
			sprite("particle_star.png"),
		]);
		return { material, models, bubbleReview, bubbleAlert, star };
	} catch (err) {
		console.warn("美术资源加载失败，改用程序化建筑", err);
		return null;
	}
}

// 用一个模型建一组网格：不会动的部分一个网格，每个会动的零件一个网格（带动画标记）。
export function instantiate(assets: Assets, name: ModelName): THREE.Group {
	const m = assets.models.get(name)!;
	const g = new THREE.Group();
	if (m.geometry) g.add(new THREE.Mesh(m.geometry, assets.material));
	for (const p of m.parts) {
		const mesh = new THREE.Mesh(p.geometry, assets.material);
		mesh.position.copy(p.pivot);
		Object.assign(mesh.userData, ANIMATED[p.name]);
		g.add(mesh);
	}
	return g;
}
