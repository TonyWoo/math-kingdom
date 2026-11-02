# 数学王国

把小学数学知识图谱做成一个可以建造的 3D 王国。学新知识是开疆拓土，复习是守护家园。

- **方向是知识领域**：数与代数、图形与几何、统计与概率、综合与实践各占一个扇区。
- **离王城越远，年级越高**：一年级紧挨着王城，六年级在最外圈的高台上。
- **一个教材单元是一个村庄，一个知识点是一块地**：一共 284 块地，对齐人教版一到六年级。
- **先修没学会的地块在迷雾里**：学会前面的知识，迷雾才会散开。
- **建造分三步**：打地基（答对 2 道基础题）、盖房子（答对标准题）、升金顶（隔天答对挑战题）。
- **会忘记的就要复习**：到了复习时间，屋顶冒出问号；拖久了会长草，再久哥布林就会住进来。复习答对，下次复习的间隔会拉长（1、3、7、15、30 天）。星星永远不会被扣掉。
- **地基不稳时寻根**：同一步连续失败两次，会列出需要先巩固的先修知识点。
- **复习不总是同几道题**：优先出上次没出过的题；能安全换数字的题会变成“换了数字的新题”（按标准答案的算式重新算答案，讲解也跟着换），建造失败后重试也会换数字。
- **适合小朋友**：大号数字键盘，题目可以朗读，平板和手机都能用。
- **有音乐**：平时是轻快的背景音乐，打保卫战时换成战鼓，建成或守住村庄时有庆祝音乐；都是 CC0 作品（见 `public/audio/CREDITS.md`），第一次点按后开始播放，顶栏的喇叭按钮或设置里可以关。
- **手机上更省地方**：窄屏时顶栏只显示图标，不显示文字。
- **按年级看地图**：点年级按钮，地图只显示这一年级的台地、地块和村庄，地图等于缩到这一年级；再点一次或点「全部」恢复。巡视、先修链接跳到别的年级的地块时会自动恢复全部显示。
- **一打开就知道该学什么**：加载后镜头自动定位到「按依赖顺序最早的未学内容」（先修都学会了的第一块空地，没有空地时是最早的没建完的地块），「我在这里」小人也站到它旁边；切换年级时同样定位到该年级的前线，小人跟过去。

## 两种视角

- **地图视角**（默认）：从空中俯看整座岛，拖动平移、缩放，点地块看详情。
- **第一人称**（顶栏的「第一人称」按钮，或网址加 `?view=fp`）：整个王国变成方块世界，可以走进去。电脑上点一下画面锁定鼠标，WASD 移动、鼠标看、空格跳、Shift 跑，准星对着地块点击或按 E 打开详情，Esc 释放鼠标；手机上左半屏拖动走路、右半屏拖动转头，轻点地块打开详情。方块贴图都是代码生成的原创像素图。
  - **和动物老师对话答题**：在第一人称里打开一块地，这个领域的动物老师（数与代数是猫头鹰、图形与几何是狐狸、统计与概率是兔子、综合与实践是熊猫）会出现在你面前，用对话气泡打招呼、读题、讲解，会说出声音（全息面板右上角可以关掉）。答案在浮在空中的全息面板上选：点选项或数字键盘，键盘也能直接输入（手机和平板上全息面板贴在屏幕下方或右侧，按键更准、整块键盘都在屏幕里）。答对老师会跳起来，答错会歪着头给你讲。
  - **保卫战**：一个村庄所有地块都到 2 颗星后，村庄路牌上会插一面红旗。对着路牌点击（或按 E、手机轻点）就能开始保卫战：你站上守望台，红方举着写着数字的盾牌沿小路走来，答出题目，防御塔就打中盾牌上是这个答案的敌人（他会变成彩色纸屑跑回家）；答错了敌人会往前冲。三波：骑士；骑士和跑得快的狼；最后是要打两次的投石车，压轴的哥布林大王盾牌上是一道两步算式，要打三次。冲进广场 3 个就算没守住（大王算 2 个）。敌人走得很慢（一二年级最慢），连续答对会快一点、答错会慢下来，随时可以暂停。只出这个村庄学过的填数题；正确率到 80% 就算这个村庄复习了一次。守住的村庄变成城镇：插金旗、围上石墙，广场旁边多一件奖励装饰（喷泉、雕像、花坛等），地图视角里也能看到。没守住不扣星，会告诉你哪些地方再复习一下。

两种视角共用同一份进度，随时可以切换。在地图上点哪里（地块或空地），那里就出现一个「我在这里」的小人；切到第一人称时从小人站的地方出发，切回地图时小人站到你走到的地方。位置会保存下来。

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

推送到 `main` 后，GitHub Actions 自动测试、构建并发布到 GitHub Pages：<https://tonywoo.github.io/math-kingdom/>。每次推送都会跑测试和构建（`ci.yml`）。`npm run build` 生成的 `dist/` 是纯静态文件，也可以放到任何静态服务器上。

## 数据

知识点、先修关系和题目来自 [cn-math-taxonomy](https://github.com/xiaoyang111222/cn-math-taxonomy)。同一套程序现在能装多个学科（顶栏切换，进度按学科分开存），已接入小学五科：数学 284 个知识点 / 1136 道题、语文 493 / 1972、英语 275 / 1100、科学 222 / 888、道德与法治 159 / 636（每个知识点 4 道题）。前端按学科加载：每科一份 `public/data/<学科>.json`，另有一份索引 `public/data/subjects.json`；进哪科只下哪科。拆分时原库字段全量透传（连现在玩法还没用到的诊断题、课标条目都带着），以后扩初高中或加学科，改 `scripts/subjects.json` 的配置重新拆分即可。保卫战靠填数题出题，没有填数题的村庄不开保卫战。**这些内容由 AI 生成，原作者说明尚未经过教师审核。**

更新数据：

```bash
npm run sync                              # 同步原库到 ../cn-math-taxonomy（克隆或拉最新）
npm run split -- ../cn-math-taxonomy      # 按学科拆分到 public/data/，并刷新 src/data/kingdom.json（含地图布局）
npm test
```

## 美术

3D 模型、贴图、精灵、图标和 App 图标都在 `public/art/` 和 `public/icons/`，按 [docs/art-prompt.md](docs/art-prompt.md) 的规格由 AI 生成。原始交付包里的说明、自检记录、预览总表和 256 像素图标存档在 [art/math-kingdom-art-v1/](art/math-kingdom-art-v1/)。美术资源加载失败时，游戏会自动退回用代码拼出来的建筑。

## 许可证

- 代码：MIT，见 [LICENSE](LICENSE)。
- 美术资源（`public/art/`、`public/icons/`、`art/`）：CC0 1.0，见 [art/math-kingdom-art-v1/LICENSE.txt](art/math-kingdom-art-v1/LICENSE.txt)。
- 音乐（`public/audio/`）：CC0 1.0，出处见 [public/audio/CREDITS.md](public/audio/CREDITS.md)。
- 数据文件（`public/data/*.json`、`src/data/kingdom.json`）：来自 cn-math-taxonomy，按 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/deed.zh-hans) 许可（署名、非商业使用）。**包含这份数据的网站不能用于商业用途**；要商用请联系原作者另外授权。

设计说明见 [docs/design.md](docs/design.md)。

---

## English

**Math Kingdom** turns the Chinese primary-school math curriculum into a 3D kingdom you build by answering questions.
Directions are curriculum domains, distance from the castle is the grade, each textbook unit is a village and each of
the 284 knowledge points is a plot. Plots stay in fog until their prerequisites are learned; each plot is built in three
steps (foundation, house, golden roof on a later day); buildings ask for review on a spaced schedule and grow weeds or
get a goblin when neglected. Stars are never taken away. Reviews rotate through a plot's questions and, where it is safe,
swap in new numbers (the answer is recomputed from the question bank's own arithmetic formula). Besides the overhead map there is a first-person mode
(`?view=fp` or the 第一人称 button) where the kingdom becomes a walkable block world with original, code-generated pixel
textures: WASD and mouse on desktop, a touch joystick on phones. Tapping the map places a "you are here" figure, and first
person starts from it (walking around moves it back on the map). In first person a plot's questions come as a
conversation with an animal teacher (owl, fox, rabbit or panda by domain) who speaks the lines aloud, and answers are
picked on a holographic panel floating in the air (docked to the bottom or side of the screen on phones and tablets). Once every plot of a village has two stars, its sign gets a red flag
and you can start a defense: knights, fast wolves, two-hit catapults and a Goblin King with a two-step expression on
its shield walk toward the plaza, and each correct answer lets a tower zap the enemy whose shield shows it (three slow
waves that adapt to how well you answer, pause any time). Scoring 80% counts as a review of the whole village; a
defended village becomes a walled town with a reward decoration, visible on the map too. Built with Vite, TypeScript and three.js; progress is stored in
the browser. Music is included — a cheerful background loop, war drums during a defense and a fanfare when a plot is
built or a village defended, all CC0 (see `public/audio/CREDITS.md`), starting after the first tap and switchable from
the speaker button in the top bar or in Settings. On narrow screens the top bar shows icons only, without text labels.
The grade buttons filter the map to a single grade — only that ring's terraces, plots and villages stay visible; tap the
grade again or the "全部" (All) button to restore the full map. On load, and whenever the grade filter changes, the camera
moves to the learning frontier: the earliest not-yet-learned plot in dependency order (prerequisites first) within the
current scope.

```bash
npm install && npm run dev
```

Code is MIT. The 3D models, textures and icons in `public/art/` and `public/icons/` are CC0 (AI-generated to the spec
in `docs/art-prompt.md`; the game falls back to procedural buildings if they fail to load). The music in
`public/audio/` is CC0 too (credits in `public/audio/CREDITS.md`). The knowledge graphs and questions in
`public/data/*.json` and `src/data/kingdom.json` come from
[cn-math-taxonomy](https://github.com/xiaoyang111222/cn-math-taxonomy) under **CC BY-NC 4.0** (non-commercial); its
author notes they are AI-generated and not yet reviewed by teachers. One program now serves several primary-school
subjects (math, Chinese, English, science and morality): `npm run sync` pulls the upstream repo and
`npm run split` turns it into one data file per subject, which the game loads on demand; progress is saved per subject.
