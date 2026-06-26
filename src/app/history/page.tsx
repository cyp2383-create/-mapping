"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, MessageCircle, Podcast, History, Database } from "lucide-react";
import Link from "next/link";

const openInTab = (html: string) => { const w = window.open("", "_blank"); if (w) { w.document.write(html); w.document.close(); } };

const openReportLazy = async (id: number) => {
  const w = window.open("", "_blank");
  if (w) { w.document.write('<p style="color:#888;text-align:center;padding:40px;font:14px sans-serif;background:#0d0d14">加载中...</p>'); w.document.close(); }
  const r = await fetch(`/api/data?position_id=${id}`);
  const d = await r.json();
  if (d.report_html?.length > 100 && w) { w.document.write(d.report_html); w.document.close(); }
};

const audioPlayers: Record<string, HTMLAudioElement> = {};

const openPodcastWithPlayer = (script: string, pid: number) => {
  const key = String(pid);
  if (audioPlayers[key]) {
    const a = audioPlayers[key];
    a.paused ? a.play() : a.pause();
    return;
  }
  const audioUrl = `/api/podcast-audio?position_id=${pid}`;
  const lines = script.replace(/【小研】/g, "\n【小研】").replace(/【小诺】/g, "\n【小诺】").replace(/</g, "&lt;");
  const h = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>*{margin:0;padding:0}body{background:#0d0d14;color:#d0d0d0;font:14px Inter,sans-serif;padding:24px 24px 140px;max-width:800px;margin:0 auto}h2{color:#f59e0b;margin-bottom:16px}pre{white-space:pre-wrap;line-height:2}.bar{position:fixed;bottom:0;left:0;right:0;background:rgba(0,0,0,.95);border-top:1px solid rgba(255,255,255,.06);padding:16px 24px;display:flex;gap:12px;justify-content:center;align-items:center}button{padding:10px 20px;border-radius:20px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.06);color:#d0d0d0;font-size:14px;cursor:pointer;font-family:inherit}button.p{background:#f59e0b;color:#0d0d14;border:none;font-weight:600}.s{font-size:12px;color:#888;margin-left:12px}</style></head><body><h2>🎙️ 人才地图播客 · Edge神经网络</h2><pre id="x"></pre><div class="bar"><button id="b" class="p" onclick="t()">▶️ 加载中...</button><button onclick="s()">⏹ 停止</button><span class="s" id="m">Edge神经网络语音生成中,请稍候...</span></div><script>var a=new Audio("'+audioUrl+'");a.preload="auto";document.getElementById("x").textContent='+JSON.stringify(lines)+';a.oncanplay=function(){document.getElementById("b").textContent="▶️ 播放";document.getElementById("b").disabled=false;document.getElementById("m").textContent="就绪 · Edge神经网络"};a.onplaying=function(){document.getElementById("b").textContent="⏸️ 暂停";document.getElementById("m").textContent="播放中..."};a.onpause=function(){document.getElementById("b").textContent="▶️ 继续";document.getElementById("m").textContent="已暂停"};a.onended=function(){document.getElementById("b").textContent="▶️ 重播";document.getElementById("m").textContent="完毕"};a.onerror=function(){document.getElementById("m").textContent="生成中...";setTimeout(function(){a.load()},5000)};function t(){a.paused?a.play():a.pause()}function s(){a.pause();a.currentTime=0;document.getElementById("b").textContent="▶️ 播放";document.getElementById("m").textContent="已停止"}<\/script></body></html>';
  const w = window.open("", "_blank");
  if (w) { w.document.write(h); w.document.close(); }
};

export default function HistoryPage() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/data?list=true").then(r => r.json()).then(d => setRecords(d.positions || [])).catch(() => {}).finally(() => setLoading(false));
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
                  <div><span className="text-sm font-semibold">{r.name || `报告 #${r.id}`}</span><span className="text-xs text-muted-foreground ml-3">{r.industry} · {r.role_direction} · {(r.created_at || "").substring(0, 10)}</span></div>
                  <div className="flex gap-2 flex-wrap">
                    <Button variant="outline" size="sm" className="text-xs" onClick={() => openReportLazy(r.id)}><FileText className="h-3 w-3 mr-1 text-amber-400" />市场报告</Button>
                    {r.chat_report ? <Button variant="outline" size="sm" className="text-xs" onClick={() => openInTab(r.chat_report)}><MessageCircle className="h-3 w-3 mr-1 text-emerald-400" />顾问画像</Button> : null}
                    <Link href={`/database?position_id=${r.id}`}><Button variant="outline" size="sm" className="text-xs"><Database className="h-3 w-3 mr-1 text-sky-400" />人才库</Button></Link>
                    {r.podcast_script ? <Button variant="outline" size="sm" className="text-xs" onClick={() => openPodcastWithPlayer(r.podcast_script, r.id)}><Podcast className="h-3 w-3 mr-1 text-violet-400" />播客</Button> : null}
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
