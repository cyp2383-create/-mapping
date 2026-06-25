"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eye, Download, FileText, MessageCircle, Podcast, History, Database as DbIcon, Play, Square } from "lucide-react";
import Link from "next/link";

const openPodcastWithPlayer = (script: string) => {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d0d14;color:#d0d0d0;font:14px Inter,-apple-system,sans-serif;padding:24px 24px 100px;line-height:2;white-space:pre-wrap;max-width:800px;margin:0 auto}
h2{color:#f59e0b;margin-bottom:16px}
.controls{position:fixed;bottom:0;left:0;right:0;background:rgba(0,0,0,.95);backdrop-filter:blur(16px);border-top:1px solid rgba(255,255,255,.06);padding:16px 24px;display:flex;gap:12px;justify-content:center;align-items:center}
button{padding:10px 20px;border-radius:20px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.06);color:#d0d0d0;font-size:14px;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:6px}
button:hover{background:rgba(255,255,255,.1)}
button.primary{background:#f59e0b;color:#0d0d14;border:none;font-weight:600}
button.primary:hover{filter:brightness(1.1)}
.status{font-size:12px;color:#888;text-align:center;margin-left:12px}
</style></head><body><h2>🎙️ 人才地图播客</h2>${script.replace(/【小研】/g,'\\n【小研】').replace(/【小诺】/g,'\\n【小诺】')}<div class="controls"><button id="btnPlay" class="primary" onclick="toggle()">▶️ 播放</button><button onclick="stopPodcast()">⏹ 停止</button><span class="status" id="status">就绪</span></div><script>
let playing=false,lines=[],idx=0;
const script=${JSON.stringify(script)};
script.split("\\n").forEach(l=>{const m=l.trim().match(/【(小研|小诺)】(.*)/);if(m)lines.push({host:m[1],text:m[2].trim()});});
function toggle(){if(playing){speechSynthesis.cancel();playing=false;document.getElementById("btnPlay").textContent="▶️ 播放";document.getElementById("btnPlay").classList.add("primary");return;}
playing=true;document.getElementById("btnPlay").textContent="⏸️ 暂停";document.getElementById("btnPlay").classList.remove("primary");idx=0;speak();}
function speak(){if(!playing||idx>=lines.length){playing=false;document.getElementById("btnPlay").textContent="▶️ 播放";document.getElementById("btnPlay").classList.add("primary");document.getElementById("status").textContent="播放完毕 ✓";return;}
const l=lines[idx];const u=new SpeechSynthesisUtterance(l.text);u.lang="zh-CN";u.rate=l.host==="小研"?1.0:1.08;u.pitch=l.host==="小研"?1.15:1.05;
const voices=speechSynthesis.getVoices();const zh=voices.filter(v=>v.lang.startsWith("zh"));
if(zh.length>=2)u.voice=l.host==="小研"?(zh.find(v=>v.name.includes("Xiaoxiao"))||zh[0]):(zh.find(v=>v.name.includes("Yunxi"))||zh[1]);
u.onend=()=>{idx++;document.getElementById("status").textContent=(idx+1)+"/"+lines.length;speak();};
u.onerror=()=>{idx++;speak();};
speechSynthesis.speak(u);document.getElementById("status").textContent=(idx+1)+"/"+lines.length;}
function stopPodcast(){speechSynthesis.cancel();playing=false;document.getElementById("btnPlay").textContent="▶️ 播放";document.getElementById("btnPlay").classList.add("primary");document.getElementById("status").textContent="已停止";}
<\/script></body></html>`;
  const w = window.open("", "_blank"); w?.document.write(html); w?.document.close();
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
                    <Link href={`/database?position_id=${r.id}`}><Button variant="outline" size="sm" className="text-xs"><DbIcon className="h-3 w-3 mr-1 text-sky-400" />人才库</Button></Link>
                    {r.podcast_script && (
                      <Button variant="outline" size="sm" className="text-xs" onClick={() => openPodcastWithPlayer(r.podcast_script)}>
                        <Podcast className="h-3 w-3 mr-1 text-violet-400" />播客
                      </Button>
                    )}
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
