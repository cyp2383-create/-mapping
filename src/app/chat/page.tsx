"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Clock3, FileCheck2, FileText, Loader2, MessageSquareText, Plus, Send, Sparkles, Trash2, UserRound } from "lucide-react";
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
  chat_report?: unknown;
};
type CaseConversation = {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  summary: string;
  messages: Message[];
  reportHtml?: string;
  reportAt?: string;
};
type AdvisorCaseArchive = {
  version: 1;
  position_id?: string | number;
  industry?: string;
  role?: string;
  activeRecordId?: string;
  updatedAt: string;
  records: CaseConversation[];
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
  const [caseArchive, setCaseArchive] = useState<AdvisorCaseArchive | null>(null);
  const [activeRecordId, setActiveRecordId] = useState("");
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
    if (!caseArchive || !activeRecordId) return;
    // Mirror the visible conversation into the persisted case archive.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCaseArchive((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        activeRecordId,
        updatedAt: new Date().toISOString(),
        records: prev.records.map((record) =>
          record.id === activeRecordId
            ? {
                ...record,
                updatedAt: new Date().toISOString(),
                summary: summarizeMessages(messages),
                messages,
                reportHtml: reportHtml || record.reportHtml,
                reportAt: reportHtml ? record.reportAt || new Date().toISOString() : record.reportAt,
              }
            : record,
        ),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRecordId, messages, reportHtml]);

  useEffect(() => {
    if (!caseArchive?.position_id) return;
    try {
      localStorage.setItem(getCaseArchiveKey(caseArchive.position_id), JSON.stringify(caseArchive));
    } catch {}

    const timer = window.setTimeout(() => {
      fetch("/api/save-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position_id: caseArchive.position_id, chat_report: caseArchive }),
      }).catch(() => {});
    }, 500);

    return () => window.clearTimeout(timer);
  }, [caseArchive]);

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
          chat_report: detail.chat_report,
        };

        if (cancelled) return;
        setMarketContext(nextContext);
        setSuggestions(buildSuggestions(nextContext));

        const scopedKey = `${CHAT_KEY}:${positionId}`;
        const savedMessages = localStorage.getItem(scopedKey);
        const archive = loadCaseArchive(positionId, nextContext, detail.chat_report, savedMessages);
        const activeId = archive.activeRecordId || archive.records[0]?.id || "";
        const active = archive.records.find((record) => record.id === activeId) || archive.records[0];

        setCaseArchive(archive);
        setActiveRecordId(active?.id || "");
        setMessages(active?.messages?.length ? active.messages : buildDefaultMessages(nextContext));
        setReportHtml(active?.reportHtml || localStorage.getItem(`talent_miner_chat_report:${positionId}`) || "");
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

  const selectRecord = (recordId: string) => {
    const record = caseArchive?.records.find((item) => item.id === recordId);
    if (!record) return;
    setActiveRecordId(record.id);
    setMessages(record.messages?.length ? record.messages : buildDefaultMessages(marketContext));
    setReportHtml(record.reportHtml || "");
    setOfferReport(false);
    setUnderstanding("");
  };

  const createRecord = () => {
    if (!marketContext) return;
    const record = createConversationRecord(marketContext);
    setCaseArchive((prev) => {
      const archive =
        prev ||
        createCaseArchive(marketContext.position_id || "default", marketContext, undefined, JSON.stringify(buildDefaultMessages(marketContext)));
      return {
        ...archive,
        activeRecordId: record.id,
        updatedAt: new Date().toISOString(),
        records: [record, ...archive.records],
      };
    });
    setActiveRecordId(record.id);
    setMessages(record.messages);
    setReportHtml("");
    setOfferReport(false);
    setUnderstanding("");
  };

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
        setCaseArchive((prev) =>
          prev
            ? {
                ...prev,
                updatedAt: new Date().toISOString(),
                records: prev.records.map((record) =>
                  record.id === activeRecordId
                    ? { ...record, reportHtml: report, reportAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
                    : record,
                ),
              }
            : prev,
        );
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
    if (caseArchive?.position_id) localStorage.removeItem(getCaseArchiveKey(caseArchive.position_id));
    if (marketContext) {
      const nextArchive = createCaseArchive(
        marketContext.position_id || "default",
        marketContext,
        undefined,
        JSON.stringify(buildDefaultMessages(marketContext)),
      );
      setCaseArchive(nextArchive);
      setActiveRecordId(nextArchive.activeRecordId || nextArchive.records[0]?.id || "");
      setMessages(nextArchive.records[0]?.messages || buildDefaultMessages(marketContext));
    } else {
      setMessages(buildDefaultMessages(marketContext));
    }
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

      <section className="mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-7xl gap-6 xl:grid-cols-[300px_minmax(0,1fr)_340px]">
        <aside className="flex min-h-0 flex-col rounded-lg border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Case History</p>
              <h2 className="mt-1 text-lg font-bold text-white">历史对话</h2>
            </div>
            <Button variant="outline" size="sm" onClick={createRecord} disabled={!marketContext || loading} className="gap-1 border-white/10 px-2">
              <Plus className="h-3.5 w-3.5" />
              新建
            </Button>
          </div>
          <div className="mb-3 rounded-lg border border-cyan-300/15 bg-cyan-300/8 p-3 text-xs leading-5 text-cyan-50/80">
            每个行业-岗位是一个 case；每条记录保存时间、对话摘要和报告产出。
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {caseArchive?.records.length ? (
              caseArchive.records.map((record) => (
                <button
                  key={record.id}
                  onClick={() => selectRecord(record.id)}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    record.id === activeRecordId ? "border-cyan-300/40 bg-cyan-300/10" : "border-white/10 bg-black/15 hover:border-cyan-300/25"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                      <Clock3 className="h-3 w-3" />
                      {formatTime(record.updatedAt)}
                    </span>
                    {record.reportHtml ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-300/10 px-2 py-0.5 text-[11px] text-emerald-100">
                        <FileCheck2 className="h-3 w-3" />
                        报告
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-400">
                        <MessageSquareText className="h-3 w-3" />
                        对话
                      </span>
                    )}
                  </div>
                  <strong className="block truncate text-sm text-white">{record.title}</strong>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{record.summary || "尚未开始新的追问"}</p>
                </button>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-white/10 p-4 text-sm text-slate-500">暂无历史对话</div>
            )}
          </div>
        </aside>

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

function getCaseArchiveKey(positionId: string | number) {
  return `${CHAT_KEY}:case:${positionId}`;
}

function loadCaseArchive(positionId: string | number, context: MarketContext, chatReport?: unknown, savedMessages?: string | null): AdvisorCaseArchive {
  const fromLocal = parseCaseArchive(readLocalStorage(getCaseArchiveKey(positionId)), positionId, context);
  if (fromLocal) return fromLocal;

  const fromReport = parseCaseArchive(chatReport, positionId, context);
  if (fromReport) return fromReport;

  if (typeof chatReport === "string" && chatReport.trim()) {
    const record = createConversationRecord(context, {
      reportHtml: chatReport,
      summary: "已生成顾问报告",
      reportAt: new Date().toISOString(),
    });
    return createCaseArchive(positionId, context, [record], record.id);
  }

  const parsedMessages = parseMessages(savedMessages);
  if (parsedMessages.length) {
    const record = createConversationRecord(context, {
      messages: parsedMessages,
      summary: summarizeMessages(parsedMessages),
    });
    return createCaseArchive(positionId, context, [record], record.id);
  }

  const record = createConversationRecord(context);
  return createCaseArchive(positionId, context, [record], record.id);
}

function createCaseArchive(
  positionId: string | number,
  context: MarketContext | null,
  recordsOrChatReport?: CaseConversation[] | unknown,
  savedMessagesOrActiveId?: string | null,
): AdvisorCaseArchive {
  const records = Array.isArray(recordsOrChatReport)
    ? recordsOrChatReport
    : parseMessages(savedMessagesOrActiveId).length
      ? [
          createConversationRecord(context, {
            messages: parseMessages(savedMessagesOrActiveId),
            summary: summarizeMessages(parseMessages(savedMessagesOrActiveId)),
          }),
        ]
      : [createConversationRecord(context)];

  return normalizeCaseArchive(
    {
      version: 1,
      position_id: positionId,
      industry: context?.industry,
      role: context?.role,
      activeRecordId: Array.isArray(recordsOrChatReport) ? savedMessagesOrActiveId || records[0]?.id : records[0]?.id,
      updatedAt: new Date().toISOString(),
      records,
    },
    positionId,
    context,
  );
}

function createConversationRecord(
  context: MarketContext | null,
  overrides: Partial<CaseConversation> & { messages?: Message[] } = {},
): CaseConversation {
  const now = new Date().toISOString();
  const messages = overrides.messages?.length ? overrides.messages : buildDefaultMessages(context);
  return {
    id: overrides.id || `case_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || overrides.reportAt || now,
    title: overrides.title || buildRecordTitle(context, messages),
    summary: overrides.summary || summarizeMessages(messages),
    messages,
    reportHtml: overrides.reportHtml,
    reportAt: overrides.reportAt,
  };
}

function parseCaseArchive(value: unknown, positionId: string | number, context: MarketContext | null): AdvisorCaseArchive | null {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Partial<AdvisorCaseArchive>;
  if (!Array.isArray(candidate.records)) return null;
  return normalizeCaseArchive(candidate, positionId, context);
}

function normalizeCaseArchive(value: Partial<AdvisorCaseArchive>, positionId: string | number, context: MarketContext | null): AdvisorCaseArchive {
  const records = (value.records || [])
    .map((record) => normalizeRecord(record, context))
    .filter((record): record is CaseConversation => Boolean(record))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  if (!records.length) records.push(createConversationRecord(context));

  const activeRecordId = records.some((record) => record.id === value.activeRecordId) ? value.activeRecordId : records[0].id;
  return {
    version: 1,
    position_id: value.position_id || positionId,
    industry: value.industry || context?.industry,
    role: value.role || context?.role,
    activeRecordId,
    updatedAt: value.updatedAt || records[0].updatedAt || new Date().toISOString(),
    records,
  };
}

function normalizeRecord(value: unknown, context: MarketContext | null): CaseConversation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<CaseConversation>;
  const messages = parseMessages(record.messages);
  return createConversationRecord(context, {
    ...record,
    messages: messages.length ? messages : buildDefaultMessages(context),
    summary: record.summary || summarizeMessages(messages),
  });
}

function parseMessages(value: unknown): Message[] {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item) => item && typeof item === "object" && (item.role === "user" || item.role === "bot"))
    .map((item) => ({
      role: item.role,
      content: typeof item.content === "string" ? item.content : "",
      recs: Array.isArray(item.recs) ? item.recs : undefined,
    }));
}

function parseJson(value?: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readLocalStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function buildRecordTitle(context: MarketContext | null, messages: Message[]) {
  const firstUser = messages.find((message) => message.role === "user")?.content;
  if (firstUser) return stripHtml(firstUser).slice(0, 28);
  if (context?.industry && context?.role) return `${context.industry} · ${context.role}`;
  return "新对话";
}

function summarizeMessages(messages: Message[]) {
  const userMessages = messages.filter((message) => message.role === "user").map((message) => stripHtml(message.content));
  const lastUser = userMessages.at(-1);
  if (lastUser) return lastUser.slice(0, 54);
  const bot = messages.find((message) => message.role === "bot")?.content;
  return bot ? stripHtml(bot).slice(0, 54) : "尚未开始新的追问";
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, "");
}
