"use client";

import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Trash2, FileText, Sparkles } from "lucide-react";

const CHAT_KEY = "talent_miner_chat_v2";

type Message = { role: "user" | "bot"; content: string; recs?: { name: string; reason: string }[] };

export default function ChatPage() {
  const defaultMsg: Message[] = [{ role: "bot", content: '👋 你好，我是你的<b>猎头翻译官</b>。<br><br>我手上有搜索到的市场数据。先聊聊你的业务情况——<br><br><span class="text-primary">你在做什么方向？想招一个什么样的人？</span>' }];
  const [messages, setMessages] = useState<Message[]>(() => { try { const s = localStorage.getItem(CHAT_KEY); return s ? JSON.parse(s) : defaultMsg; } catch { return defaultMsg; } });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [offerReport, setOfferReport] = useState(false);
  const [understanding, setUnderstanding] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>(["这些大厂在做什么？", "从哪家公司挖人？", "这个岗位需要什么能力？"]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { try { localStorage.setItem(CHAT_KEY, JSON.stringify(messages)); } catch {} }, [messages]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const buildHistory = () => messages.map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.content.replace(/<[^>]*>/g, "").substring(0, 200) }));

  const send = async (q: string) => {
    if (!q.trim() || loading) return;
    setInput(""); setLoading(true);
    setMessages(prev => [...prev, { role: "user", content: q }]);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, context: { history: buildHistory(), talents: [], jds: [] } }),
      });
      const reader = resp.body?.getReader(); const decoder = new TextDecoder(); let buf = "", msg = "", recs: any[] = [], sugs: string[] = [], offer = false, und = "";
      while (reader) { const { value, done } = await reader.read(); if (done) break;
        buf += decoder.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try { const d = JSON.parse(line.slice(6));
            if (d.step === "done") { msg = d.message || d.answer || ""; recs = d.recommendations || []; sugs = d.suggestions || []; offer = d.offer_report || false; und = d.understanding || ""; }
            else if (d.step === "error") { msg = d.text || "服务暂不可用"; }
          } catch {}
        }
      }
      if (msg) { setMessages(prev => [...prev, { role: "bot", content: msg, recs }]); setOfferReport(offer); setUnderstanding(und); if (sugs.length) setSuggestions(sugs); }
      else { setMessages(prev => [...prev, { role: "bot", content: "抱歉，追问服务无响应" }]); }
    } catch { setMessages(prev => [...prev, { role: "bot", content: "服务暂不可用，请重试" }]); }
    setLoading(false);
  };

  const generateReport = async () => {
    setOfferReport(false); setLoading(true);
    setMessages(prev => [...prev, { role: "user", content: "生成人才画像报告" }]);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "生成人才画像报告", context: { history: buildHistory(), talents: [], jds: [] }, action: "generate" }),
      });
      const reader = resp.body?.getReader(); const decoder = new TextDecoder(); let buf = "", report = "";
      while (reader) { const { value, done } = await reader.read(); if (done) break;
        buf += decoder.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try { const d = JSON.parse(line.slice(6));
            if (d.step === "report") report = d.answer;
            else if (d.step === "warning") { setMessages(prev => [...prev, { role: "bot", content: d.message || "信息不足，再聊几轮吧" }]); setLoading(false); return; }
          } catch {}
        }
      }
      if (report) {
        setMessages(prev => [...prev, { role: "bot", content: '<div class="text-center p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5"><p class="text-emerald-400 font-semibold text-sm">✓ 人才画像已生成</p><div class="flex gap-2 justify-center mt-2"><button class="px-3 py-1 rounded-lg border border-border text-xs hover:bg-muted" onclick="window.open().document.write("' + encodeURIComponent(report) + '")">查看</button><button class="px-3 py-1 rounded-lg border border-border text-xs hover:bg-muted" onclick="this.download()">下载</button></div></div>' }]);
        // Store for download
        (window as any).__chatReport = report; try { localStorage.setItem("talent_miner_chat_report", report); } catch {}
      }
    } catch { setMessages(prev => [...prev, { role: "bot", content: "报告生成失败" }]); }
    setLoading(false);
  };

  const clearChat = () => {
    if (!confirm("确定要清空所有对话记录吗？此操作不可撤销。")) return;
    localStorage.removeItem(CHAT_KEY); setMessages([{ role: "bot", content: '👋 你好，我是你的<b>猎头翻译官</b>。<br><br>我手上有搜索到的市场数据。先聊聊你的业务情况——<br><br><span class="text-primary">你在做什么方向？想招一个什么样的人？</span>' }]);
    setOfferReport(false);
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 h-full flex flex-col">
      <Card className="flex-1 flex flex-col">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />猎头翻译官</CardTitle>
          <Button variant="ghost" size="sm" onClick={clearChat} className="text-xs text-muted-foreground"><Trash2 className="h-3 w-3 mr-1" />清空对话</Button>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col gap-3 min-h-0">
          <ScrollArea className="flex-1 pr-2"><div ref={scrollRef as any} className="h-full">
            <div className="space-y-3 pb-2">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] px-4 py-2.5 rounded-xl text-sm leading-relaxed ${
                    m.role === "user" ? "bg-primary text-black font-medium" : "bg-muted border border-border"
                  }`} dangerouslySetInnerHTML={{ __html: m.content }} />
                </div>
              ))}
            </div>
          </div></ScrollArea>
          {/* Report offer */}
          {offerReport && (
            <div className="text-center py-2">
              <Button onClick={generateReport} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"><FileText className="h-4 w-4" />生成人才画像报告</Button>
              {understanding && <p className="text-xs text-muted-foreground mt-1.5">{understanding}</p>}
            </div>
          )}
          {/* Suggestions */}
          <div className="flex gap-1.5 flex-wrap">
            {suggestions.map((s, i) => (
              <Button key={i} variant="outline" size="sm" className="text-xs h-7" onClick={() => send(s)}>{s}</Button>
            ))}
          </div>
          {/* Input */}
          <div className="flex gap-2">
            <Input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send(input)}
              placeholder="描述你的业务场景..." disabled={loading} className="flex-1" />
            <Button onClick={() => send(input)} disabled={loading} size="sm"><Send className="h-4 w-4" /></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
