"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, Download, FileText, MessageCircle, Podcast, History } from "lucide-react";

const CHAT_REPORT_KEY = "talent_miner_chat_report";

export default function HistoryPage() {
  const [positions, setPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/data?list=true")
      .then(r => r.json()).then(d => { setPositions(d.positions || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const openReport = async (id: number) => {
    const resp = await fetch(`/api/data?position_id=${id}`);
    const data = await resp.json();
    if (data.report_html?.length > 100) {
      const w = window.open("", "_blank"); w?.document.write(data.report_html); w?.document.close();
    }
  };

  const openChatReport = () => {
    const saved = localStorage.getItem(CHAT_REPORT_KEY);
    if (saved) { const w = window.open("", "_blank"); w?.document.write(saved); w?.document.close(); }
  };

  const openPodcast = () => {
    const saved = localStorage.getItem("talent_miner_podcast");
    if (saved) { const w = window.open("", "_blank"); w?.document.write(`<html><body style="background:#0d0d14;color:#d0d0d0;font-family:Inter,sans-serif;padding:24px;white-space:pre-wrap;line-height:2">${saved}</body></html>`); w?.document.close(); }
  };

  const downloadReport = async (id: number) => {
    const resp = await fetch(`/api/data?position_id=${id}`);
    const data = await resp.json();
    if (data.report_html?.length > 100) {
      const b = new Blob([data.report_html], { type: "text/html" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(b);
      a.download = `人才地图报告_${id}.html`; a.click();
    }
  };

  const hasChatReport = typeof window !== "undefined" && !!localStorage.getItem(CHAT_REPORT_KEY);
  const hasPodcast = typeof window !== "undefined" && !!localStorage.getItem("talent_miner_podcast");

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><History className="h-4 w-4 text-primary" />历史记录</CardTitle></CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground text-center py-8">加载中...</p> :
            !positions.length && !hasChatReport && !hasPodcast ? <p className="text-sm text-muted-foreground text-center py-8">暂无历史记录</p> :
            <div className="space-y-2">
              {/* Market Reports from Turso */}
              {positions.map((p) => (
                <div key={`pos-${p.id}`} className="flex items-center justify-between py-3 px-3 rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <FileText className="h-4 w-4 text-amber-400 shrink-0" />
                    <div>
                      <span className="text-sm font-medium">{p.name || `报告 #${p.id}`}</span>
                      <span className="text-xs text-muted-foreground ml-3">{p.industry} · {p.role_direction} · {p.created_at?.substring(0, 10)}</span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="text-xs" onClick={() => openReport(p.id)}><Eye className="h-3 w-3 mr-1" />查看</Button>
                    <Button variant="ghost" size="sm" className="text-xs" onClick={() => downloadReport(p.id)}><Download className="h-3 w-3 mr-1" />下载</Button>
                  </div>
                </div>
              ))}
              {/* Chat Report from localStorage */}
              {hasChatReport && (
                <div className="flex items-center justify-between py-3 px-3 rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <MessageCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                    <div>
                      <span className="text-sm font-medium">猎头顾问 · 人才画像</span>
                      <span className="text-xs text-muted-foreground ml-3">AI 对话生成</span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="text-xs" onClick={openChatReport}><Eye className="h-3 w-3 mr-1" />查看</Button>
                  </div>
                </div>
              )}
              {/* Podcast from localStorage */}
              {hasPodcast && (
                <div className="flex items-center justify-between py-3 px-3 rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <Podcast className="h-4 w-4 text-violet-400 shrink-0" />
                    <div>
                      <span className="text-sm font-medium">人才地图播客</span>
                      <span className="text-xs text-muted-foreground ml-3">双人访谈音频</span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="text-xs" onClick={openPodcast}><Eye className="h-3 w-3 mr-1" />查看</Button>
                  </div>
                </div>
              )}
            </div>
          }
        </CardContent>
      </Card>
    </div>
  );
}
