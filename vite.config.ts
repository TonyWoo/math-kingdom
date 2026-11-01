import { defineConfig } from "vitest/config";

// base 用相对路径，部署到 GitHub Pages 的子路径（/math-kingdom/）或任何静态服务器都能用
export default defineConfig({
	base: "./",
	build: {
		chunkSizeWarningLimit: 1200,
	},
	test: {
		include: ["test/**/*.test.ts"],
	},
});
