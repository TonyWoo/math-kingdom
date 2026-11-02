# 数学王国

把小学数学知识图谱做成一个可以建造的 3D 王国。学新知识是开疆拓土，复习是守护家园。

- **方向是知识领域**：数与代数、图形与几何、统计与概率、综合与实践各占一个扇区。
- **离王城越远，年级越高**：一年级紧挨着王城，六年级在最外圈的高台上。
- **一个教材单元是一个村庄，一个知识点是一块地**：一共 284 块地，对齐人教版一到六年级。
- **先修没学会的地块在迷雾里**：学会前面的知识，迷雾才会散开。
- **建造分三步**：打地基（答对 2 道基础题）、盖房子（答对标准题）、升金顶（隔天答对挑战题）。
- **会忘记的就要复习**：到了复习时间，屋顶冒出问号；拖久了会长草，再久哥布林就会住进来。复习答对，下次复习的间隔会拉长（1、3、7、15、30 天）。星星永远不会被扣掉。
- **地基不稳时寻根**：同一步连续失败两次，会列出需要先巩固的先修知识点。
- **适合小朋友**：大号数字键盘，题目可以朗读，平板和手机都能用。

## 两种视角

- **地图视角**（默认）：从空中俯看整座岛，拖动平移、缩放，点地块看详情。
- **第一人称**（顶栏的「第一人称」按钮，或网址加 `?view=fp`）：整个王国变成方块世界，可以走进去。电脑上点一下画面锁定鼠标，WASD 移动、鼠标看、空格跳、Shift 跑，准星对着地块点击或按 E 打开详情，Esc 释放鼠标；手机上左半屏拖动走路、右半屏拖动转头，轻点地块打开详情。方块贴图都是代码生成的原创像素图。

两种视角共用同一份进度，随时可以切换。

## 快速开始

需要 Node.js 20 以上。

```bash
npm install
npm run dev        # 开发服务器，浏览器打开显示的地址
npm test           # 单元测试
npm run build      # 打包到 dist/，是纯静态网站
```

网址参数：`?demo=1` 用演示进度（没有存档时），`?select=cnm_p042` 打开某个知识点，`?focus=2` 镜头对准二年级，`?days=3` 把“现在”往后挪 3 天看复习提醒。

操作：拖动平移，滚轮或双指缩放，右键或双指旋转，点地块看详情。键盘 1–6 跳到年级，答题时可以直接打数字、回车提交。

## 部署

`npm run build` 生成的 `dist/` 是纯静态文件，放到任何静态服务器上就能用（仓库是私有的，GitHub Pages 用不了）。每次推送 GitHub Actions 都会跑测试和构建。

## 数据

知识点、先修关系和题目来自 [cn-math-taxonomy](https://github.com/xiaoyang111222/cn-math-taxonomy)，只取了小学数学部分：284 个知识点、459 条先修边、1136 道题（每个知识点 2 道基础题、1 道标准题、1 道挑战题）。**这些内容由 AI 生成，原作者说明尚未经过教师审核。**

更新数据：

```bash
git clone --depth 1 https://github.com/xiaoyang111222/cn-math-taxonomy ../cn-math-taxonomy
npm run import -- ../cn-math-taxonomy     # 重新生成 src/data/kingdom.json（含地图布局）
npm test
```

## 美术

3D 模型、贴图、精灵、图标和 App 图标都在 `public/art/` 和 `public/icons/`，按 [docs/art-prompt.md](docs/art-prompt.md) 的规格由 AI 生成。原始交付包里的说明、自检记录、预览总表和 256 像素图标存档在 [art/math-kingdom-art-v1/](art/math-kingdom-art-v1/)。美术资源加载失败时，游戏会自动退回用代码拼出来的建筑。

## 许可证

- 代码：MIT，见 [LICENSE](LICENSE)。
- 美术资源（`public/art/`、`public/icons/`、`art/`）：CC0 1.0，见 [art/math-kingdom-art-v1/LICENSE.txt](art/math-kingdom-art-v1/LICENSE.txt)。
- `src/data/kingdom.json`：来自 cn-math-taxonomy，按 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/deed.zh-hans) 许可（署名、非商业使用）。**包含这份数据的网站不能用于商业用途**；要商用请联系原作者另外授权。

设计说明见 [docs/design.md](docs/design.md)。

---

## English

**Math Kingdom** turns the Chinese primary-school math curriculum into a 3D kingdom you build by answering questions.
Directions are curriculum domains, distance from the castle is the grade, each textbook unit is a village and each of
the 284 knowledge points is a plot. Plots stay in fog until their prerequisites are learned; each plot is built in three
steps (foundation, house, golden roof on a later day); buildings ask for review on a spaced schedule and grow weeds or
get a goblin when neglected. Stars are never taken away. Besides the overhead map there is a first-person mode
(`?view=fp` or the 第一人称 button) where the kingdom becomes a walkable block world with original, code-generated pixel
textures: WASD and mouse on desktop, a touch joystick on phones. Built with Vite, TypeScript and three.js; progress is stored in
the browser.

```bash
npm install && npm run dev
```

Code is MIT. The 3D models, textures and icons in `public/art/` and `public/icons/` are CC0 (AI-generated to the spec
in `docs/art-prompt.md`; the game falls back to procedural buildings if they fail to load). The knowledge graph and questions in `src/data/kingdom.json` come from
[cn-math-taxonomy](https://github.com/xiaoyang111222/cn-math-taxonomy) under **CC BY-NC 4.0** (non-commercial); its
author notes they are AI-generated and not yet reviewed by teachers.
