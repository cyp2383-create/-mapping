"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Search, Eye, Download, RefreshCw, Podcast } from "lucide-react";

export default function HomePage() {
  const [industry, setIndustry] = useState("互联网");
  const [role, setRole] = useState("AI产品经理");
  const [city, setCity] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [data, setData] = useState<any>(null);

  const handleGenerate = async () => {
    setRunning(true); setProgress(5); setStatus("连接中...");
    try {
      const resp = await fetch("https://talent-miner.vercel.app/api/generate", {
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
            if (d.step === "data_ready") { setData(d); setProgress(65); setStatus("数据就绪"); }
            else if (d.step === "report_ready") { setData((p: any) => ({ ...p, report_html: d.report_html })); setProgress(100); setStatus("完成"); }
            else if (d.progress) { setProgress(d.progress); setStatus(d.text || ""); }
          } catch {}
        }
      }
    } catch { setStatus("生成失败"); }
    setRunning(false);
  };

  const hasReport = data?.report_html?.length > 100;

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
              <Button variant="outline" size="sm" className="text-primary border-primary/20"><Podcast className="h-3 w-3 mr-1" />播客</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {!data && <p className="text-center text-sm text-muted-foreground pt-4">输入行业和岗位，点击「生成人才地图」开始搜索</p>}
    </div>
  );
}
