// 朗读：浏览器自带的语音合成，读中文；分数线读成“分之”。没有语音合成时什么也不做。

export function speak(text: string): void {
	if (!("speechSynthesis" in window)) return;
	const u = new SpeechSynthesisUtterance(text.replace(/(\d+)\/(\d+)/g, "$2分之$1").replace(/\//g, "分之"));
	u.lang = "zh-CN";
	u.rate = 0.95;
	u.pitch = 1.15;
	const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith("zh"));
	if (voice) u.voice = voice;
	speechSynthesis.cancel();
	speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
	if ("speechSynthesis" in window) speechSynthesis.cancel();
}
