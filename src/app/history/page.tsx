"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eye, Download, FileText, MessageCircle, Podcast, History, Play, Square } from "lucide-react";

const openInTab = (html: string) => { const w = window.open("", "_blank"); w?.document.write(html); w?.document.close(); };
let podcastPlaying = false;
const playPodcastScript = (script: string) => {
  if (podcastPlaying) { speechSynthesis.cancel(); podcastPlaying = false; return; }
  const lines: { host: string; text: string }[] = [];
  script.split("\n").forEach((l: string) => { const m = l.trim().match(/【(小研|小诺)】(.*)/); if (m) lines.push({ host: m[1], text: m[2].trim() }); });
  if (!lines.length) return;
  let idx = 0; podcastPlaying = true;
  const speak = () => {
    if (!podcastPlaying || idx >= lines.length) { podcastPlaying = false; return; }
    const l = lines[idx]; const u = new SpeechSynthesisUtterance(l.text);
    u.lang = "zh-CN"; u.rate = l.host === "小研" ? 1.0 : 1.08; u.pitch = l.host === "小研" ? 1.15 : 1.05;
    const voices = speechSynthesis.getVoices(); const zh = voices.filter(v => v.lang.startsWith("zh"));
    if (zh.length >= 2) u.voice = l.host === "小研" ? (zh.find(v => v.name.includes("Xiaoxiao")) || zh[0]) : (zh.find(v => v.name.includes("Yunxi")) || zh[1]);
    u.onend = () => { idx++; speak(); }; u.onerror = () => { idx++; speak(); };
    speechSynthesis.speak(u);
  }; speak();
};

export default function HistoryPage() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/data?list=true");
        const d = await r.json();
        const enriched: any[] = [];
        for (const p of d.positions || []) {
          // Get full details for each position
          const r2 = await fetch(`/api/data?position_id=${p.id}`);
          const full = await r2.json();
          enriched.push({ ...p, ...full });
        }
        setRecords(enriched);
      } catch {} finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><History className="h-4 w-4 text-primary" />历史记录</CardTitle></CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground text-center py-8">加载中...</p> :
            !records.length ? <p className="text-sm text-muted-foreground text-center py-8">暂无历史记录</p> :
            <div className="space-y-6">
              {records.map((r) => (
                <div key={r.id} className="border border-border rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-semibold">{r.name || `报告 #${r.id}`}</span>
                      <span className="text-xs text-muted-foreground ml-3">{r.industry} · {r.role_direction} · {(r.created_at || "").substring(0, 10)}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {r.report_html?.length > 100 && (
                      <Button variant="outline" size="sm" className="text-xs" onClick={() => openInTab(r.report_html)}>
                        <FileText className="h-3 w-3 mr-1 text-amber-400" />市场报告
                      </Button>
                    )}
                    {r.chat_report && (
                      <Button variant="outline" size="sm" className="text-xs" onClick={() => openInTab(r.chat_report)}>
                        <MessageCircle className="h-3 w-3 mr-1 text-emerald-400" />顾问画像
                      </Button>
                    )}
                    {r.podcast_script && (<>
                      <Button variant="outline" size="sm" className="text-xs" onClick={() => openInTab(`<html><body style="background:#0d0d14;color:#d0d0d0;font:14px Inter,sans-serif;padding:24px;white-space:pre-wrap;line-height:2">${r.podcast_script}</body></html>`)}>
                        <Podcast className="h-3 w-3 mr-1 text-violet-400" />剧本
                      </Button>
                      <Button variant="outline" size="sm" className="text-xs" onClick={() => playPodcastScript(r.podcast_script)}>
                        <Play className="h-3 w-3 mr-1 text-violet-400" />播放
                      </Button>
                    </>)}
                    {!r.report_html && !r.chat_report && !r.podcast_script && (
                      <span className="text-xs text-muted-foreground">内容生成中...</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          }
        </CardContent>
      </Card>
    </div>
  );
}
