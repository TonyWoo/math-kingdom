// 同步上游知识库 cn-math-taxonomy 到本地：已有克隆就拉最新，没有就克隆一份。
// 用法：
//   npm run sync                  # 同步到 ../cn-math-taxonomy
//   npm run sync -- <目录>        # 同步到指定目录
// 同步完接着跑 npm run split -- <目录>，把数据按学科拆给前端。
//
// Syncs the upstream cn-math-taxonomy repo (clone or pull), then split-subjects.mjs
// turns it into per-subject data files for the game.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const UPSTREAM = "https://github.com/xiaoyang111222/cn-math-taxonomy";
const dir = process.argv[2] ?? "../cn-math-taxonomy";

function git(args) {
	execFileSync("git", args, { stdio: "inherit" });
}

if (existsSync(join(dir, ".git"))) {
	console.log(`拉取最新：${dir}`);
	git(["-C", dir, "pull", "--ff-only"]);
} else if (existsSync(dir)) {
	console.error(`${dir} 已存在但不是 git 仓库，无法同步；换个目录或先移走它。`);
	process.exit(1);
} else {
	console.log(`克隆 ${UPSTREAM} 到 ${dir}`);
	git(["clone", "--depth", "1", UPSTREAM, dir]);
}

let commit = "unknown";
try {
	commit = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
} catch {
	// 拿不到提交号不影响同步结果
}

const topics = JSON.parse(readFileSync(join(dir, "data", "topics.json"), "utf8"));
const counts = {};
for (const t of topics) {
	const s = t.subject ?? "math";
	counts[s] = (counts[s] ?? 0) + 1;
}
console.log(`已同步 @ ${commit}`);
console.log(`知识点共 ${topics.length} 个：` + Object.entries(counts).map(([s, n]) => `${s} ${n}`).join("、"));
console.log(`接着拆分：npm run split -- ${dir}`);
