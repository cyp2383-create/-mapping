"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Search, Eye, Download, RefreshCw, Podcast, Pause, Square } from "lucide-react";

let podcastLines: any[] = [], podcastIdx = 0, podcastPlaying = false;

export default function HomePage() {
  const [industry, setIndustry] = useState("互联网");
  const [role, setRole] = useState("AI产品经理");
  const [city, setCity] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [data, setData] = useState<any>(null);

  const stepMap: Record<string, string> = { companies: "生成目标公司列表...", jds: "搜索招聘JD...", talents: "搜索候选人...", enrich: "AI深度提取中...", report: "生成报告中..." };

  const handleGenerate = async () => {
    setRunning(true); setProgress(3); setStatus("正在连接AI引擎...");
    try {
      const resp = await fetch("/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industry, role, city }),
      });
      const reader = resp.body?.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (reader) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.step === "data_ready") { setData(d); setProgress(65); setStatus("数据就绪 ✓"); }
            else if (d.step === "report_ready") { setData((p: any) => ({ ...p, report_html: d.report_html })); setProgress(100); setStatus("报告生成完成 ✓"); }
            else if (d.step === "report_progress") { setProgress(Math.min(95, d.progress || progress)); setStatus("生成报告: " + (d.text || "")); }
            else if (d.progress) { setProgress(d.progress); setStatus(stepMap[d.step] || d.text || ("处理中: " + d.step)); }
          } catch {}
        }
      }
    } catch { setStatus("生成失败"); }
    setRunning(false);
  };

  const hasReport = data?.report_html?.length > 100;
  const [podcasting, setPodcasting] = useState(false);
  const [podcastStatus, setPodcastStatus] = useState("");

  const togglePodcast = async () => {
    if (podcastPlaying) { speechSynthesis.cancel(); podcastPlaying = false; setPodcasting(false); return; }
    if (!hasReport) return;
    setPodcasting(true); setPodcastStatus("生成剧本...");
    try {
      if (!(data as any)._podcastScript) {
        const resp = await fetch("/api/podcast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ report_html: data.report_html }) });
        const reader = resp.body?.getReader(); const decoder = new TextDecoder(); let buf = "", script = "";
        while (reader) { const { value, done } = await reader.read(); if (done) break;
          buf += decoder.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() || "";
          for (const l of lines) { if (!l.startsWith("data: ")) continue; try { const d = JSON.parse(l.slice(6)); if (d.step === "done") script = d.script; else if (d.step === "progress") setPodcastStatus(d.text || ""); } catch {} }
        }
        (data as any)._podcastScript = script;
      }
      const script = (data as any)._podcastScript; if (!script) { setPodcasting(false); return; }
      podcastLines = []; script.split("\n").forEach((l: string) => { const m = l.trim().match(/【(小研|小诺)】(.*)/); if (m) podcastLines.push({ host: m[1], text: m[2].trim() }); });
      if (!podcastLines.length) { setPodcasting(false); return; }
      podcastIdx = 0; podcastPlaying = true; setPodcastStatus("播放中...");
      const speak = () => {
        if (!podcastPlaying || podcastIdx >= podcastLines.length) { podcastPlaying = false; setPodcasting(false); return; }
        const l = podcastLines[podcastIdx]; const u = new SpeechSynthesisUtterance(l.text);
        u.lang = "zh-CN"; u.rate = l.host === "小研" ? 1.0 : 1.08; u.pitch = l.host === "小研" ? 1.15 : 1.05;
        const voices = speechSynthesis.getVoices(); const zh = voices.filter(v => v.lang.startsWith("zh"));
        if (zh.length >= 2) { u.voice = l.host === "小研" ? (zh.find(v => v.name.includes("Xiaoxiao")) || zh[0]) : (zh.find(v => v.name.includes("Yunxi")) || zh[1]); }
        u.onend = () => { podcastIdx++; speak(); }; u.onerror = () => { podcastIdx++; speak(); };
        speechSynthesis.speak(u);
      }; speak();
    } catch { setPodcasting(false); }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      {/* Hero */}
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-foreground to-primary bg-clip-text text-transparent">
          AI 驱动的人才地图
        </h1>
        <p className="text-sm text-muted-foreground">输入行业和岗位，Agent 自动搜索市场数据并生成人才画像报告</p>
      </div>

      {/* Input Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-3 items-end flex-wrap">
            <div className="flex-1 min-w-[150px] space-y-1.5">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">行业</label>
              <Input value={industry} onChange={e => setIndustry(e.target.value)} placeholder="互联网" />
            </div>
            <div className="flex-1 min-w-[150px] space-y-1.5">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">岗位</label>
              <Input value={role} onChange={e => setRole(e.target.value)} placeholder="AI产品经理" />
            </div>
            <div className="w-[130px] space-y-1.5">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">城市</label>
              <Input value={city} onChange={e => setCity(e.target.value)} placeholder="可选" />
            </div>
            <Button onClick={handleGenerate} disabled={running} className="gap-2">
              <Search className="h-4 w-4" /> {running ? "生成中..." : "生成人才地图"}
            </Button>
          </div>
          {running && <Progress value={progress} className="mt-4 h-1.5" />}
        </CardContent>
      </Card>

      {/* Agent Dashboard */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Agent 运行看板</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center gap-0 justify-center">
            {[
              { n: 1, label: "需求配置", sub: (running || data) ? "✓ 已配置" : "等待输入", done: running || data },
              { n: 2, label: "Agent搜索", sub: data ? `采集 ${data.talents?.length || 0} 位候选人` : running ? "搜索中..." : "等待触发",
                active: running && !data, done: !!data },
              { n: 3, label: "AI分析", sub: hasReport ? "✓ 已完成" : data ? "数据就绪" : "等待数据", done: hasReport, wide: true,
                extra: <div className="flex gap-3 mt-1"><span className="text-[10px] text-muted-foreground">💬 猎头顾问</span><span className="text-[10px] text-muted-foreground">📊 人才报告</span></div> },
            ].map(s => (
              <div key={s.n} className="flex items-center gap-0">
                <div className={`flex flex-col items-center gap-1 px-5 py-3 rounded-xl border transition-all ${s.wide ? "flex-[2]" : "flex-1"} ${
                  s.done ? "border-emerald-500/20 bg-emerald-500/5" : s.active ? "border-primary/20 bg-primary/5" : "border-border bg-muted/20"
                }`}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    s.done ? "bg-emerald-500 text-white" : s.active ? "bg-primary text-black animate-pulse" : "bg-muted text-muted-foreground"
                  }`}>{s.n}</span>
                  <span className="text-xs font-semibold">{s.label}</span>
                  <span className="text-[10px] text-muted-foreground">{s.sub}</span>
                  {s.extra}
                </div>
                {s.n < 3 && <span className="text-muted-foreground/30 mx-1.5 text-base">→</span>}
              </div>
            ))}
          </div>
          {hasReport && (
            <div className="flex gap-2 mt-4 justify-end">
              <Button variant="outline" size="sm" onClick={() => { const w = window.open("", "_blank"); w?.document.write(data.report_html); w?.document.close(); }}>
                <Eye className="h-3 w-3 mr-1" />查看</Button>
              <Button variant="outline" size="sm" onClick={() => { const b = new Blob([data.report_html], { type: "text/html" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "人才地图报告.html"; a.click(); }}>
                <Download className="h-3 w-3 mr-1" />下载</Button>
              <Button variant="outline" size="sm"><RefreshCw className="h-3 w-3 mr-1" />重新生成</Button>
              <Button variant="outline" size="sm" className="text-primary border-primary/20" onClick={togglePodcast} disabled={podcasting}><Podcast className="h-3 w-3 mr-1" />{podcasting ? podcastStatus || "播客中..." : "播客"}</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {!data && <p className="text-center text-sm text-muted-foreground pt-4">输入行业和岗位，点击「生成人才地图」开始搜索</p>}
    </div>
  );
}
