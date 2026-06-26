"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, FileText, Loader2, Send, Sparkles, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const CHAT_KEY = "talent_miner_chat_v3";

type Recommendation = { name: string; reason: string };
type Message = { role: "user" | "bot"; content: string; recs?: Recommendation[] };

const defaultMessages: Message[] = [
  {
    role: "bot",
    content:
      "你好，我是你的市场人才地图顾问。你可以告诉我目标行业、岗位方向、区域和业务阶段，我会帮你拆解市场需求、候选人来源和招聘优先级。",
  },
];

const defaultSuggestions = [
  "新能源 B2B 市场负责人应该从哪些公司找？",
  "AI SaaS 产品市场总监需要什么能力组合？",
  "消费电子出海增长负责人如何判断候选人质量？",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === "undefined") return defaultMessages;
    try {
      const saved = localStorage.getItem(CHAT_KEY);
      return saved ? JSON.parse(saved) : defaultMessages;
    } catch {
      return defaultMessages;
    }
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [offerReport, setOfferReport] = useState(false);
  const [understanding, setUnderstanding] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>(defaultSuggestions);
  const [reportHtml, setReportHtml] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const compactHistory = useMemo(
    () =>
      messages.map((message) => ({
        role: message.role === "user" ? "user" : "assistant",
        content: stripHtml(message.content).slice(0, 260),
      })),
    [messages],
  );

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(messages));
    } catch {}
  }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const append = (message: Message) => setMessages((prev) => [...prev, message]);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || loading) return;

    setInput("");
    setLoading(true);
    setOfferReport(false);
    append({ role: "user", content: q });

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, context: { history: compactHistory, talents: [], jds: [] } }),
      });

      if (!resp.ok) throw new Error(`Chat failed: ${resp.status}`);

      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      let recs: Recommendation[] = [];
      let nextSuggestions: string[] = [];
      let offer = false;
      let understood = "";

      while (reader) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.step === "done") {
              answer = event.message || event.answer || "";
              recs = event.recommendations || [];
              nextSuggestions = event.suggestions || [];
              offer = Boolean(event.offer_report);
              understood = event.understanding || "";
            }
            if (event.step === "error") {
              answer = event.text || "服务暂时不可用，请稍后重试。";
            }
          } catch {}
        }
      }

      append({
        role: "bot",
        content: answer || "我没有收到有效响应。你可以换一种描述方式，或者先生成一份人才地图数据。",
        recs,
      });
      setOfferReport(offer);
      setUnderstanding(understood);
      if (nextSuggestions.length) setSuggestions(nextSuggestions);
    } catch {
      append({ role: "bot", content: "服务暂时不可用。请确认旧 API 服务可访问后再试。" });
    } finally {
      setLoading(false);
    }
  };

  const generateReport = async () => {
    setOfferReport(false);
    setLoading(true);
    append({ role: "user", content: "生成人才画像报告" });

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: "生成人才画像报告",
          context: { history: compactHistory, talents: [], jds: [] },
          action: "generate",
        }),
      });

      if (!resp.ok) throw new Error(`Report failed: ${resp.status}`);

      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let report = "";

      while (reader) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.step === "report") report = event.answer;
            if (event.step === "warning") {
              append({ role: "bot", content: event.message || "当前信息还不够完整，我们可以再聊几轮后生成报告。" });
              setLoading(false);
              return;
            }
          } catch {}
        }
      }

      if (report) {
        setReportHtml(report);
        localStorage.setItem("talent_miner_chat_report", report);
        const pid = Number(localStorage.getItem("current_position_id") || "0");
        fetch("/api/save-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position_id: pid, chat_report: report }),
        }).catch(() => {});
        append({ role: "bot", content: "人才画像报告已生成。你可以在下方打开预览，或继续让我补充搜索策略。" });
      } else {
        append({ role: "bot", content: "报告没有生成成功。建议先补充行业、岗位、区域和目标公司范围。" });
      }
    } catch {
      append({ role: "bot", content: "报告生成失败，请稍后重试。" });
    } finally {
      setLoading(false);
    }
  };

  const openReport = () => {
    const html = reportHtml || localStorage.getItem("talent_miner_chat_report") || "";
    if (!html) return;
    const win = window.open("", "_blank");
    win?.document.write(html);
    win?.document.close();
  };

  const clearChat = () => {
    if (!confirm("确定清空所有对话记录吗？")) return;
    localStorage.removeItem(CHAT_KEY);
    setMessages(defaultMessages);
    setOfferReport(false);
    setUnderstanding("");
    setSuggestions(defaultSuggestions);
    setReportHtml("");
  };

  return (
    <div className="relative flex min-h-full flex-col overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-[-8%] top-[-8%] h-96 w-96 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute bottom-[-12%] right-[12%] h-96 w-96 rounded-full bg-emerald-400/8 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.03)_1px,transparent_1px)] bg-[size:72px_72px] [mask-image:linear-gradient(to_bottom,black,transparent_80%)]" />
      </div>

      <section className="mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-7xl gap-6 xl:grid-cols-[1fr_360px]">
        <div className="flex min-h-0 flex-col rounded-lg border border-white/10 bg-white/[0.035] shadow-2xl shadow-black/30 backdrop-blur-2xl">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">AI Copilot</p>
              <h1 className="mt-1 flex items-center gap-2 text-2xl font-black text-white">
                <Sparkles className="h-5 w-5 text-cyan-200" />
                市场人才地图顾问
              </h1>
            </div>
            <Button variant="outline" size="sm" onClick={clearChat} className="gap-2 border-white/10 text-slate-300">
              <Trash2 className="h-3.5 w-3.5" />
              清空对话
            </Button>
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="space-y-4">
              {messages.map((message, index) => (
                <ChatBubble key={`${message.role}-${index}`} message={message} />
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="flex max-w-[86%] items-center gap-3 rounded-lg border border-cyan-300/20 bg-cyan-300/8 px-4 py-3 text-sm text-cyan-100">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Agent 正在分析市场信号...
                  </div>
                </div>
              )}
            </div>
          </div>

          <footer className="border-t border-white/10 p-5">
            {offerReport && (
              <div className="mb-4 rounded-lg border border-emerald-300/20 bg-emerald-300/8 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-emerald-100">信息已经足够，可以生成一份人才画像报告。</p>
                    {understanding && <p className="mt-1 text-xs text-emerald-100/70">{understanding}</p>}
                  </div>
                  <Button onClick={generateReport} disabled={loading} className="gap-2 bg-emerald-300 text-slate-950 hover:bg-emerald-200">
                    <FileText className="h-4 w-4" />
                    生成报告
                  </Button>
                </div>
              </div>
            )}

            {(reportHtml || (typeof window !== "undefined" && localStorage.getItem("talent_miner_chat_report"))) && (
              <div className="mb-4 flex items-center justify-between rounded-lg border border-cyan-300/20 bg-cyan-300/8 p-3 text-sm text-cyan-100">
                <span>已有一份对话生成的人才画像报告。</span>
                <Button variant="outline" size="sm" onClick={openReport} className="border-cyan-300/20">
                  打开报告
                </Button>
              </div>
            )}

            <div className="mb-3 flex flex-wrap gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => send(suggestion)}
                  disabled={loading}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 transition hover:border-cyan-300/40 hover:text-white disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send(input);
                  }
                }}
                placeholder="描述你的市场、岗位、候选人画像或招聘难题..."
                disabled={loading}
                className="min-h-20 resize-none border-white/10 bg-black/25"
              />
              <Button onClick={() => send(input)} disabled={loading || !input.trim()} className="h-20 gap-2 bg-cyan-300 text-slate-950 hover:bg-cyan-200">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                发送
              </Button>
            </div>
          </footer>
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Context</p>
            <h2 className="mt-1 text-xl font-bold text-white">顾问能做什么</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <p>1. 把一句招聘需求拆成行业、岗位能力、目标公司和候选人来源。</p>
              <p>2. 基于已有搜索结果继续追问，补齐候选人画像与招聘优先级。</p>
              <p>3. 在信息足够时生成可汇报的人才画像报告。</p>
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Signal</p>
            <div className="mt-4 grid gap-3">
              {["公司来源", "能力标签", "招聘动机", "触达优先级"].map((item, index) => (
                <div key={item} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/15 p-3">
                  <span className="text-sm text-slate-300">{item}</span>
                  <span className="font-mono text-xs text-cyan-200">{[92, 86, 78, 84][index]}%</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}

function ChatBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`flex max-w-[86%] gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${isUser ? "bg-blue-300 text-slate-950" : "bg-cyan-300 text-slate-950"}`}>
          {isUser ? <UserRound className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </div>
        <div className={`rounded-lg border px-4 py-3 text-sm leading-7 ${isUser ? "border-blue-300/20 bg-blue-300/10 text-blue-50" : "border-white/10 bg-black/20 text-slate-200"}`}>
          <div dangerouslySetInnerHTML={{ __html: message.content }} />
          {message.recs?.length ? (
            <div className="mt-3 space-y-2">
              {message.recs.map((rec) => (
                <div key={`${rec.name}-${rec.reason}`} className="rounded-lg border border-cyan-300/15 bg-cyan-300/8 p-3">
                  <strong className="block text-cyan-100">{rec.name}</strong>
                  <p className="mt-1 text-xs text-slate-300">{rec.reason}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, "");
}
