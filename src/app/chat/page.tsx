"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, FileText, Loader2, Send, Sparkles, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const CHAT_KEY = "talent_miner_chat_v3";

type Recommendation = { name: string; reason: string };
type Message = { role: "user" | "bot"; content: string; recs?: Recommendation[] };
type Talent = {
  name?: string;
  current_company?: string;
  current_title?: string;
  location?: string;
  level?: string;
  tier?: string;
  source_platform?: string;
  source_url?: string;
};
type JobDemand = {
  title?: string;
  company?: string;
  snippet?: string;
  salary?: string;
  experience?: string;
  source_platform?: string;
  source_url?: string;
};
type MarketContext = {
  position_id?: string | number;
  industry?: string;
  role?: string;
  talents: Talent[];
  jds: JobDemand[];
  companies: string[];
  questions: string[];
  tier_stats?: Record<string, number>;
  report_html?: string;
};

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
  const [messages, setMessages] = useState<Message[]>(defaultMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingContext, setLoadingContext] = useState(true);
  const [offerReport, setOfferReport] = useState(false);
  const [understanding, setUnderstanding] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>(defaultSuggestions);
  const [reportHtml, setReportHtml] = useState("");
  const [marketContext, setMarketContext] = useState<MarketContext | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const contextKey = useMemo(() => {
    const id = marketContext?.position_id;
    if (id) return `${CHAT_KEY}:${id}`;
    return `${CHAT_KEY}:default`;
  }, [marketContext?.position_id]);

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
      localStorage.setItem(contextKey, JSON.stringify(messages));
    } catch {}
  }, [contextKey, messages]);

  useEffect(() => {
    let cancelled = false;

    async function loadMarketContext() {
      setLoadingContext(true);
      try {
        const params = new URLSearchParams(window.location.search);
        let positionId = params.get("position_id") || localStorage.getItem("current_position_id") || "";

        if (!positionId) {
          const latestResp = await fetch("/api/data?latest=true", { cache: "no-store" });
          const latest = await latestResp.json();
          positionId = latest?.position?.id ? String(latest.position.id) : "";
        }

        if (!positionId) throw new Error("No position id");

        const detailResp = await fetch(`/api/data?position_id=${positionId}`, { cache: "no-store" });
        if (!detailResp.ok) throw new Error("Context request failed");
        const detail = await detailResp.json();

        const nextContext: MarketContext = {
          position_id: positionId,
          industry: detail.industry,
          role: detail.role,
          talents: detail.talents || [],
          jds: detail.jds || [],
          companies: detail.companies || [],
          questions: detail.questions || [],
          tier_stats: detail.tier_stats,
          report_html: detail.report_html || "",
        };

        if (cancelled) return;
        setMarketContext(nextContext);
        setReportHtml(localStorage.getItem(`talent_miner_chat_report:${positionId}`) || "");
        setSuggestions(buildSuggestions(nextContext));

        const scopedKey = `${CHAT_KEY}:${positionId}`;
        const saved = localStorage.getItem(scopedKey);
        setMessages(saved ? JSON.parse(saved) : buildDefaultMessages(nextContext));
      } catch {
        if (cancelled) return;
        setMarketContext(null);
        setMessages(defaultMessages);
        setSuggestions(defaultSuggestions);
      } finally {
        if (!cancelled) setLoadingContext(false);
      }
    }

    loadMarketContext();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const append = (message: Message) => setMessages((prev) => [...prev, message]);

  const buildChatContext = () => {
    const userScenario = compactHistory
      .filter((item) => item.role === "user")
      .map((item) => item.content)
      .join("\n")
      .slice(-1800);
    const reportSummary = stripHtml(marketContext?.report_html || "").slice(0, 1800);
    const contextFrame = {
      role: "assistant",
      content: [
        `当前顾问只服务这一张市场地图：${marketContext?.industry || "未知行业"} · ${marketContext?.role || "未知岗位"}`,
        `搜索数据：${marketContext?.talents.length || 0} 位候选人，${marketContext?.jds.length || 0} 条市场/JD 信号，${marketContext?.companies.length || 0} 家公司。`,
        `公司池：${(marketContext?.companies || []).slice(0, 8).join(" / ") || "暂无"}`,
        `智能追问：${(marketContext?.questions || []).slice(0, 4).join(" / ") || "暂无"}`,
        reportSummary ? `市场地图报告摘要：${reportSummary}` : "",
        userScenario ? `用户已补充的具体业务场景：${userScenario}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };

    return {
      history: [contextFrame, ...compactHistory].slice(-21),
      position_id: marketContext?.position_id,
      industry: marketContext?.industry,
      role: marketContext?.role,
      talents: marketContext?.talents || [],
      jds: marketContext?.jds || [],
      companies: marketContext?.companies || [],
      tier_stats: marketContext?.tier_stats,
      questions: marketContext?.questions || [],
      report_html: marketContext?.report_html || "",
      report_summary: reportSummary,
      business_scenario: userScenario,
    };
  };

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
        body: JSON.stringify({ question: q, context: buildChatContext() }),
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
      setSuggestions(mergeSuggestions(nextSuggestions, buildSuggestions(marketContext)));
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
          context: buildChatContext(),
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
        const pid = Number(marketContext?.position_id || localStorage.getItem("current_position_id") || "0");
        localStorage.setItem(`talent_miner_chat_report:${pid || "default"}`, report);
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
    const scopedKey = `talent_miner_chat_report:${marketContext?.position_id || "default"}`;
    const html = reportHtml || localStorage.getItem(scopedKey) || "";
    if (!html) return;
    const win = window.open("", "_blank");
    win?.document.write(html);
    win?.document.close();
  };

  const clearChat = () => {
    if (!confirm("确定清空所有对话记录吗？")) return;
    localStorage.removeItem(contextKey);
    setMessages(buildDefaultMessages(marketContext));
    setOfferReport(false);
    setUnderstanding("");
    setSuggestions(buildSuggestions(marketContext));
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
                {marketContext?.industry && marketContext?.role ? `${marketContext.industry} · ${marketContext.role} 顾问` : "市场人才地图顾问"}
              </h1>
              <p className="mt-2 text-sm text-slate-400">
                {loadingContext ? "正在载入当前市场地图上下文..." : "围绕当前行业-岗位、搜索数据、报告和你的业务场景连续追问。"}
              </p>
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

            {(reportHtml || (typeof window !== "undefined" && localStorage.getItem(`talent_miner_chat_report:${marketContext?.position_id || "default"}`))) && (
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
            <h2 className="mt-1 text-xl font-bold text-white">当前服务对象</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <p>
                <span className="text-slate-500">行业：</span>
                <span className="text-white">{marketContext?.industry || "未载入"}</span>
              </p>
              <p>
                <span className="text-slate-500">岗位：</span>
                <span className="text-white">{marketContext?.role || "未载入"}</span>
              </p>
              <p>
                <span className="text-slate-500">上下文：</span>
                {marketContext ? `${marketContext.talents.length} 位候选人 / ${marketContext.jds.length} 条市场信号 / ${marketContext.companies.length} 家公司` : "等待市场地图数据"}
              </p>
              <div className="rounded-lg border border-cyan-300/15 bg-cyan-300/8 p-3 text-xs leading-6 text-cyan-50/80">
                顾问会统一使用市场地图报告、搜索数据、当前对话里的业务场景和下方追问问题，不会脱离这个行业-岗位单独回答。
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Unified Follow-ups</p>
            <div className="mt-4 grid gap-3">
              {suggestions.slice(0, 4).map((item) => (
                <button key={item} onClick={() => send(item)} disabled={loading} className="rounded-lg border border-white/10 bg-black/15 p-3 text-left text-sm text-slate-300 transition hover:border-cyan-300/40 hover:text-white disabled:opacity-50">
                  {item}
                </button>
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

function buildDefaultMessages(context: MarketContext | null): Message[] {
  if (!context?.industry || !context?.role) return defaultMessages;
  return [
    {
      role: "bot",
      content: `你好，我是服务于 <span style="color:#67e8f9;font-weight:700">${context.industry} · ${context.role}</span> 这张市场地图的 AI 顾问。我会基于当前报告、${context.talents.length} 位候选人、${context.jds.length} 条市场信号，以及你补充的业务场景来追问和建议。`,
    },
  ];
}

function buildSuggestions(context: MarketContext | null): string[] {
  if (!context) return defaultSuggestions;
  const industry = context.industry || "当前行业";
  const role = context.role || "当前岗位";
  const company = context.companies?.[0] || "头部公司";
  const apiQuestions = context.questions?.filter(Boolean) || [];
  const generated = [
    `结合我的具体业务场景，重新定义 ${industry} ${role} 的人才画像`,
    `从 ${company} 这类公司挖人，应该优先看哪些经历？`,
    `当前 ${context.jds.length} 条市场信号说明 ${role} 最关键的能力是什么？`,
    `基于这张市场地图，帮我设计下一轮候选人搜索策略`,
  ];
  return [...apiQuestions, ...generated].slice(0, 4);
}

function mergeSuggestions(primary: string[], fallback: string[]) {
  const merged = [...primary, ...fallback].map((item) => item.trim()).filter(Boolean);
  return Array.from(new Set(merged)).slice(0, 4);
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, "");
}
