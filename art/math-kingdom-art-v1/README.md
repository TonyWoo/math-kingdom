# 数学王国 · 美术资源 v1

37 个 GLB、7 张 PNG 贴图及调色板 JSON、5 张精灵、15 种图标各 128/256 两档、6 张 App/Logo 图片、1 张宣传图。

## 使用

以 HTTP 服务整个资源目录；保留 `models/` 与 `textures/` 的相对路径。GLB 内引用 `../textures/palette.png`，有意不嵌入重复贴图。所有模型 Y 向上、正面 +Z，底面中心为原点。模型网格只保留位置平移；旋转和缩放已烘焙。

```js
const gltf = await loader.loadAsync('/art/models/mill_3.glb');
scene.add(gltf.scene);
const blades = gltf.scene.getObjectByName('blades');
const pennant = gltf.scene.getObjectByName('pennant');
// 每帧：
blades.rotation.z += deltaSeconds * 1.2;
pennant.rotation.y = Math.sin(elapsedSeconds * 2) * 0.15;
```

动画节点：`blades` 绕 Z，`flag` / `pennant` 绕 Y，投石车 `arm` 绕 X。未添加自动播放的 glTF AnimationClip，动画由程序控制。避免让投石臂贯穿车架，建议在约 -0.45～0.6 弧度内使用。

每个文件只有一个同名 `palette` 材质。批量加载后可将所有网格的材质替换为同一个已加载的 palette 实例以减少运行时重复资源；保留其贴图与 flat normals。调色板最近邻采样，纹理 `flipY=false`，颜色空间为 sRGB。UV 是 glTF 的左上起点约定；使用 palette.json 的 uvCenter 即可。

`app/icon-maskable-512.png` 已增加安全边距。`logo_title.png` 用字库排出准确的「数学王国」；不分发字体文件。透明图像均为 RGBA。

## 验证资料

`preview/validation.json` 为 Khronos glTF Validator 结果；`browser_validation.json` 为 Chromium + three.js 实际 WebGL/PNG 加载记录；`technical_checks.json` 为二进制重读后的面数、尺寸、原点和材质检查。预览总表有意按交付规范标注文件名，游戏图片本身不带文字，logo_title 与 ? / ! 状态符号除外。

总表的单格缩放按各模型包围盒自适应；实际比例以 manifest 的 bbox 为准。宣传图使用实际模型排布，示意六圈台地和 284 个建筑点，并非游戏 UI 截图。
