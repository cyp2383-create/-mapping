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

const openPodcastWithPlayer = (script: string) => {
  const safe = script.replace(/`/g, "\\`").replace(/\\/g, "\\\\");
  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0d0d14;color:#d0d0d0;font:14px Inter,sans-serif;padding:24px 24px 100px;line-height:2;white-space:pre-wrap;max-width:800px;margin:0 auto}h2{color:#f59e0b;margin-bottom:16px}.ctrls{position:fixed;bottom:0;left:0;right:0;background:rgba(0,0,0,.95);backdrop-filter:blur(16px);border-top:1px solid rgba(255,255,255,.06);padding:16px 24px;display:flex;gap:12px;justify-content:center;align-items:center}button{padding:10px 20px;border-radius:20px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.06);color:#d0d0d0;font-size:14px;cursor:pointer;font-family:inherit}button:hover{background:rgba(255,255,255,.1)}button.prim{background:#f59e0b;color:#0d0d14;border:none;font-weight:600}.status{font-size:12px;color:#888;margin-left:12px}</style></head><body><h2>🎙️ 人才地图播客</h2><pre id="text"></pre><div class="ctrls"><button id="btn" class="prim" onclick="toggle()">▶️ 播放</button><button onclick="stop()">⏹ 停止</button><span class="status" id="st">就绪</span></div><script>let playing=false,lines=[],idx=0;document.getElementById("text").textContent='+JSON.stringify(safe)+'.replace(/【小研】/g,"\\n【小研】").replace(/【小诺】/g,"\\n【小诺】");var script='+JSON.stringify(safe)+';script.split("\\n").forEach(function(l){var m=l.trim().match(/【(小研|小诺)】(.*)/);if(m)lines.push({host:m[1],text:m[2].trim()})});function toggle(){if(playing){speechSynthesis.cancel();playing=false;document.getElementById("btn").textContent="▶️ 播放";document.getElementById("btn").classList.add("prim");return}playing=true;document.getElementById("btn").textContent="⏸️ 暂停";document.getElementById("btn").classList.remove("prim");idx=0;speak()}function speak(){if(!playing||idx>=lines.length){playing=false;document.getElementById("btn").textContent="▶️ 播放";document.getElementById("btn").classList.add("prim");document.getElementById("st").textContent="完毕";return}var l=lines[idx];var u=new SpeechSynthesisUtterance(l.text);u.lang="zh-CN";u.rate=l.host==="小研"?1:1.08;u.pitch=l.host==="小研"?1.15:1.05;var voices=speechSynthesis.getVoices();var zh=voices.filter(function(v){return v.lang.startsWith("zh")});if(zh.length>=2){u.voice=l.host==="小研"?(zh.find(function(v){return v.name.includes("Xiaoxiao")})||zh[0]):(zh.find(function(v){return v.name.includes("Yunxi")||v.name.includes("Yunjian")})||zh[1])}u.onend=function(){idx++;document.getElementById("st").textContent=(idx+1)+"/"+lines.length;speak()};u.onerror=function(){idx++;speak()};speechSynthesis.speak(u);document.getElementById("st").textContent=(idx+1)+"/"+lines.length}function stop(){speechSynthesis.cancel();playing=false;document.getElementById("btn").textContent="▶️ 播放";document.getElementById("btn").classList.add("prim");document.getElementById("st").textContent="已停止"}<\/script></body></html>';
  const w = window.open("", "_blank"); if (w) { w.document.write(html); w.document.close(); }
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
                    {r.podcast_script ? <Button variant="outline" size="sm" className="text-xs" onClick={() => openPodcastWithPlayer(r.podcast_script)}><Podcast className="h-3 w-3 mr-1 text-violet-400" />播客</Button> : null}
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
