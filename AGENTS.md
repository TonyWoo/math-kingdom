# AGENTS.md

数学王国：把小学数学知识图谱（cn-math-taxonomy）做成可以建造的 3D 王国。Vite + TypeScript + three.js，纯静态网站，进度存在浏览器 localStorage。设计见 [docs/design.md](docs/design.md)。

## 结构

| 路径 | 内容 |
| --- | --- |
| `src/core/` | 纯逻辑，不依赖 three.js 和 DOM：`kingdom.ts`（先修索引、地块状态、演示进度）、`quiz.ts`（建造三步、复习、出题、更新进度）、`judge.ts`（判题）、`save.ts`（存档）、`types.ts` |
| `src/scene/` | three.js：`world.ts`（岛、台地、王城、森林）、`buildings.ts`（低多边形建筑和装饰，静态零件用 `bake` 合并）、`kingdom-scene.ts`（地块、迷雾、标签、拾取、镜头、动画） |
| `src/ui/app.ts` | HTML 界面：顶栏、年级按钮、详情面板、答题键盘、朗读、设置；持有进度 |
| `src/data/kingdom.json` | 生成文件（`npm run import`），不要手改 |
| `scripts/import-taxonomy.mjs` | 导入上游数据并计算地图布局 |
| `test/` | Vitest 单元测试，只测 `src/core/` 和数据 |
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
5. **性能**：目标是普通平板 60 帧。新建筑零件用 `part()` 加到组里，最后 `bake()` 合并；会动的零件加 `userData.spin / wave / pulse / bob`，不会被合并。大量重复的东西用 `InstancedMesh`。
6. **风格**：Tab 缩进，双引号；注释和界面文字用中文。
7. **用户可见的变化**同时更新 README 的中文和 English 部分。

## 验证

- `npm test` 和 `npm run build` 都通过。
- 实际打开页面看：`npm run build && npx vite preview`，再用 Playwright 截图（无头 Chromium 需要 `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`，软件渲染帧率低，镜头动画要多等几秒）。至少检查：桌面 1280×800 和手机 390×844 两种尺寸；`?demo=1` 的全景；完整答一次题（答错一次看讲解，再全对看建成动画和迷雾散开）；控制台没有报错。
- 性能：在控制台看 `kingdom.scene.renderer.info.render.calls`。全部 284 块地建满 3 星时大约 830 次绘制调用。
