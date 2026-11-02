# AGENTS.md

数学王国：把小学数学知识图谱（cn-math-taxonomy）做成可以建造的 3D 王国。Vite + TypeScript + three.js，纯静态网站，进度存在浏览器 localStorage。设计见 [docs/design.md](docs/design.md)。

## 结构

| 路径 | 内容 |
| --- | --- |
| `src/core/` | 纯逻辑，不依赖 three.js 和 DOM：`kingdom.ts`（先修索引、地块状态、演示进度）、`quiz.ts`（建造三步、复习、出题、更新进度）、`judge.ts`（判题）、`save.ts`（存档）、`types.ts` |
| `src/scene/` | three.js：`assets.ts`（加载 `public/art/` 的模型和精灵，静态网格合并、动画零件单独保留，共用一个 palette 材质）、`world.ts`（岛、台地、王城、森林）、`buildings.ts`（建筑和装饰：有资源用模型，没有就用基本几何体拼，静态零件用 `bake` 合并）、`kingdom-scene.ts`（地块、迷雾、标签、拾取、镜头、动画） |
| `src/scene/view.ts` | 两种视角共用的 `View` 接口；界面只通过它操作 3D 画面 |
| `src/voxel/` | 第一人称方块世界：`terrain.ts`（纯逻辑：布局换算成方块网格、高度、地块和小路，`test/voxel.test.ts` 测可走性）、`atlas.ts`（代码画的像素贴图集）、`mesher.ts`（方块拼网格、方块种类）、`structures.ts`（建筑、王城、树、哥布林的方块图纸）、`player.ts`（第一人称移动和碰撞，键鼠和触摸）、`voxel-scene.ts`（场景，实现 `View`） |
| `src/ui/app.ts` | HTML 界面：顶栏、年级按钮、详情面板、答题键盘、朗读、设置；持有进度，`setView` 切换视角 |
| `src/data/kingdom.json` | 生成文件（`npm run import`），不要手改 |
| `scripts/import-taxonomy.mjs` | 导入上游数据并计算地图布局 |
| `test/` | Vitest 单元测试，只测 `src/core/` 和数据 |
| `public/art/`、`public/icons/` | 运行时加载的美术资源（CC0）。`art/math-kingdom-art-v1/` 是原始交付包的说明、自检、预览和备用文件，不会被打包 |
| `docs/art-prompt.md`、`docs/art-reference/` | 给 AI 生成工具的美术资源提示词和参考截图；模型规格（尺寸、原点、朝向、共用 `palette` 材质、动画节点名）以它为准 |

## 命令

```bash
npm install
npm run dev                              # 开发服务器
npm test                                 # 单元测试
npm run build                            # tsc 类型检查 + 打包到 dist/
npm run import -- <cn-math-taxonomy clone>   # 重新生成数据和布局
```

## 规则

1. **`src/core/` 保持纯逻辑**：不 import three.js、不碰 DOM、不读 `Date.now()`（时间由调用方传入），这样能单元测试，以后服务端也能复用。
2. **`kingdom.json` 只通过导入脚本生成**。改布局就改脚本里的常量后重新生成，并检查已有地块的位置变化（玩家会记得自己的房子在哪里）。
3. **数据许可证是 CC BY-NC 4.0**，代码是 MIT。不要删掉 README、设置对话框和 LICENSE 里的署名和非商业说明。
4. **星级永远不扣**：没复习只改变画面（问号、长草、哥布林），不减星。
5. **性能**：目标是普通平板 60 帧。模型都用 `assets.material` 这一个材质；会动的零件（模型里的 `blades`、`flag`、`pennant`）在 `assets.ts` 里转成 `userData.spin / wave`。大量重复的东西（树、村庄广场、迷雾）用 `InstancedMesh`。程序化的后备建筑用 `part()` 加零件、最后 `bake()` 合并。
8. **换美术资源**：新模型必须符合 `docs/art-prompt.md` 的规格（原点在底面中心、正面 +Z、只用 `palette` 材质、动画节点名）。加了新模型要加进 `assets.ts` 的 `MODELS`，`test/art.test.ts` 会检查文件和基本规格。
6. **风格**：Tab 缩进，双引号；注释和界面文字用中文。
7. **用户可见的变化**同时更新 README 的中文和 English 部分。
9. **方块世界**：1 格 = 布局 20 个单位；每个年级比内圈高 1 格，环路和大道与内侧同高，保证一步最多上下 1 格（改地形后 `test/voxel.test.ts` 会检查每块地都走得到）。建筑占 3×3 格，图纸里 x、z 在 -1..1。贴图必须是原创的（`atlas.ts` 用代码画），不要放进任何现成游戏的贴图、角色或界面。

## 验证

- `npm test` 和 `npm run build` 都通过。
- 实际打开页面看：`npm run build && npx vite preview`，再用 Playwright 截图（无头 Chromium 需要 `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`，软件渲染帧率低，镜头动画要多等几秒）。至少检查：桌面 1280×800 和手机 390×844 两种尺寸；`?demo=1` 的全景；完整答一次题（答错一次看讲解，再全对看建成动画和迷雾散开）；控制台没有报错。
- 第一人称：`?view=fp&demo=1`，用 `kingdom.voxel.focusPlot(id)` 跳到地块、`kingdom.voxel.target()` 看准星对着什么；手机尺寸用触摸轻点地块，确认能打开面板并答题。无头浏览器里不能锁定鼠标，键鼠操作要在真机上试。
- 性能：在控制台看 `kingdom.scene.renderer.info.render.calls`。全部 284 块地建满 3 星时大约 560 次绘制调用（程序化后备建筑时约 830 次）。
