"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Link2,
  Loader2,
  MapPin,
  MessageSquareText,
  Mic2,
  Podcast,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";

type TierKey = "high" | "mid" | "low";

type TierStats = Partial<Record<TierKey, number>>;

type StreamData = {
  step?: string;
  progress?: number;
  text?: string;
  position_id?: number | string;
  talents?: Talent[];
  jds?: JobDemand[];
  companies?: string[];
  questions?: string[];
  tier_stats?: TierStats;
  industry?: string;
  role?: string;
  report_html?: string;
  podcast_script?: string | null;
  _podcastScript?: string;
  _loadedFromTurso?: boolean;
  _sourceName?: string;
  _hasReport?: boolean;
  [key: string]: unknown;
};

type Talent = {
  name?: string;
  current_company?: string;
  current_title?: string;
  company?: string;
  title?: string;
  source_platform?: string;
  source_url?: string;
  contact_type?: string;
  contact_value?: string;
  confidence?: number;
  education?: string;
  languages?: string;
  certifications?: string;
  influence_score?: number;
  location?: string;
  level?: string;
  tier?: string;
};

type JobDemand = {
  title?: string;
  company?: string;
  snippet?: string;
  salary?: string;
  location?: string;
  experience?: string;
  education_req?: string;
  tools?: string;
  source_platform?: string;
  source_url?: string;
};

type PositionSummary = {
  id?: number | string;
  name?: string;
  industry?: string;
  role_direction?: string;
  created_at?: string;
};

type LatestPayload = {
  position?: PositionSummary | null;
  detail?: StreamData | null;
};

type StreamEvent = StreamData & {
  script?: string;
};

type StepState = "idle" | "active" | "done";

let podcastLines: Array<{ host: string; text: string }> = [];
let podcastIdx = 0;
let podcastPlaying = false;

const stepLabels: Record<string, string> = {
  companies: "生成目标公司池",
  jds: "搜索市场招聘需求",
  talents: "搜索匹配候选人",
  enrich: "抽取候选人画像",
  report: "生成结果报告",
};

const promptExamples = [
  { industry: "互联网", role: "AI产品经理", city: "北京 / 上海 / 深圳" },
  { industry: "AI SaaS", role: "产品市场总监", city: "北京" },
  { industry: "新能源", role: "B2B 市场增长负责人", city: "华东" },
];

const tierCopy: Record<TierKey, { label: string; tone: string; bar: string }> = {
  high: { label: "高匹配", tone: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100", bar: "bg-emerald-300" },
  mid: { label: "可培养", tone: "border-cyan-300/30 bg-cyan-300/10 text-cyan-100", bar: "bg-cyan-300" },
  low: { label: "弱相关", tone: "border-amber-300/30 bg-amber-300/10 text-amber-100", bar: "bg-amber-300" },
};

export type { LatestPayload, StreamData };

export default function HomeClient({ initialPayload }: { initialPayload?: LatestPayload | null }) {
  const initialPosition = initialPayload?.position || null;
  const initialDetail = initialPayload?.detail || null;

  const [industry, setIndustry] = useState(initialDetail?.industry || initialPosition?.industry || "互联网");
  const [role, setRole] = useState(initialDetail?.role || initialPosition?.role_direction || "AI产品经理");
  const [city, setCity] = useState("北京 / 上海 / 深圳");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(initialDetail?._hasReport || initialDetail?.report_html ? 100 : 0);
  const [status, setStatus] = useState(
    initialDetail && initialPosition?.id
      ? `已载入 Turso 样本：${cleanText(initialPosition.name, "最近一次采集")}，页面展示真实 API 字段。`
      : "暂时无法读取 Turso 样本。输入需求后仍可直接运行 Agent。",
  );
  const [data, setData] = useState<StreamData | null>(
    initialDetail && initialPosition?.id
      ? { ...initialDetail, position_id: initialPosition.id, _loadedFromTurso: true, _sourceName: initialPosition.name }
      : null,
  );
  const [podcasting, setPodcasting] = useState(false);
  const [podcastStatus, setPodcastStatus] = useState("");

  const hasReport = Boolean(data?._hasReport || (data?.report_html && data.report_html.length > 100));
  const talents = useMemo(() => data?.talents || [], [data?.talents]);
  const jds = useMemo(() => data?.jds || [], [data?.jds]);
  const companies = useMemo(() => {
    const fromApi = data?.companies?.filter(Boolean) || [];
    if (fromApi.length) return fromApi;
    return unique(talents.map((talent) => talent.current_company || talent.company).filter(Boolean) as string[]);
  }, [data?.companies, talents]);

  const tierStats = useMemo(() => {
    const derived: Record<TierKey, number> = { high: 0, mid: 0, low: 0 };
    talents.forEach((talent) => {
      const tier = normalizeTier(talent.tier);
      derived[tier] += 1;
    });

    const apiStats = data?.tier_stats;
    const apiTotal = (apiStats?.high || 0) + (apiStats?.mid || 0) + (apiStats?.low || 0);
    return apiTotal > 0 ? { high: apiStats?.high || 0, mid: apiStats?.mid || 0, low: apiStats?.low || 0 } : derived;
  }, [data?.tier_stats, talents]);

  const hasEvidence = talents.length > 0 || jds.length > 0 || companies.length > 0;
  const tierTotal = Math.max(1, tierStats.high + tierStats.mid + tierStats.low);
  const topLocations = useMemo(() => countTop(talents.map((talent) => talent.location).filter(Boolean) as string[], 4), [talents]);
  const sourceBreakdown = useMemo(
    () => countTop([...talents.map((talent) => talent.source_platform), ...jds.map((jd) => jd.source_platform)].filter(Boolean) as string[], 4),
    [jds, talents],
  );

  const metrics = useMemo(
    () => [
      { label: "候选人线索", value: hasEvidence ? `${talents.length}` : "--", sub: "Turso talents 字段" },
      { label: "招聘/市场信号", value: hasEvidence ? `${jds.length}` : "--", sub: "Tavily/WebSearch 返回样本" },
      { label: "公司覆盖", value: hasEvidence ? `${companies.length}` : "--", sub: "从候选人与 JD 归并" },
      { label: "报告状态", value: hasReport ? "完成" : running ? `${progress}%` : "待生成", sub: hasReport ? "可查看 / 下载 / 播客" : "等待 Agent 产出" },
    ],
    [companies.length, hasEvidence, hasReport, jds.length, progress, running, talents.length],
  );

  const steps: Array<{ key: string; label: string; desc: string; state: StepState }> = [
    {
      key: "input",
      label: "需求定位",
      desc: industry && role ? `${industry} · ${role}` : "等待输入",
      state: running || data ? "done" : "idle",
    },
    {
      key: "search",
      label: "公开信号采集",
      desc: data ? `${talents.length} 位候选人 / ${jds.length} 条市场信号` : running ? "正在扫描 Tavily 与公开来源" : "待触发",
      state: data ? "done" : running ? "active" : "idle",
    },
    {
      key: "report",
      label: "报告与问答",
      desc: hasReport ? "报告已生成，可继续追问" : data ? "证据数据已准备" : "等待数据",
      state: hasReport ? "done" : running ? "active" : "idle",
    },
  ];

  const updateData = (patch: StreamData) => {
    setData((prev) => ({ ...(prev || {}), ...patch, _loadedFromTurso: false }));
  };

  const handleGenerate = async () => {
    setRunning(true);
    setProgress(3);
    setData(null);
    setStatus("正在连接 Agent 引擎...");

    try {
      const resp = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industry, role, city }),
      });

      if (!resp.ok) throw new Error(`Generate failed: ${resp.status}`);

      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (reader) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as StreamEvent;

            if (event.step === "data_ready") {
              updateData(event);
              if (event.position_id) {
                localStorage.setItem("current_position_id", String(event.position_id));
              }
              setProgress(65);
              setStatus(`真实证据已入库：${event.talents?.length || 0} 位候选人，${event.jds?.length || 0} 条招聘/市场信号。`);
            } else if (event.step === "report_ready") {
              updateData({ report_html: event.report_html });
              setProgress(100);
              setStatus("人才地图报告已生成，可以查看、下载或生成播客。");
            } else if (event.step === "report_progress") {
              setProgress(Math.min(95, event.progress || progress));
              setStatus(`生成报告：${event.text || "正在组织分析内容"}`);
            } else if (event.progress) {
              setProgress(event.progress);
              const stepKey = event.step || "processing";
              setStatus(stepLabels[stepKey] || event.text || `处理中：${stepKey}`);
            }
          } catch {
            // Streaming APIs may occasionally send keep-alive chunks.
          }
        }
      }
    } catch {
      setStatus("生成失败：请检查旧 API 服务或稍后重试。");
    } finally {
      setRunning(false);
    }
  };

  const ensureReportHtml = async () => {
    if (data?.report_html && data.report_html.length > 100) return data.report_html;
    if (!data?.position_id) return "";

    const resp = await fetch(`/api/data?position_id=${data.position_id}`, { cache: "no-store" });
    if (!resp.ok) return "";
    const detail = (await resp.json()) as StreamData;
    if (detail.report_html && detail.report_html.length > 100) {
      updateData({ report_html: detail.report_html, _hasReport: true });
      return detail.report_html;
    }
    return "";
  };

  const openReport = async () => {
    const reportHtml = await ensureReportHtml();
    if (!reportHtml) return;
    const win = window.open("", "_blank");
    win?.document.write(reportHtml);
    win?.document.close();
  };

  const downloadReport = async () => {
    const reportHtml = await ensureReportHtml();
    if (!reportHtml) return;
    const blob = new Blob([reportHtml], { type: "text/html;charset=utf-8" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${industry}-${role}-人才地图报告.html`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };

  const togglePodcast = async () => {
    if (podcastPlaying) {
      speechSynthesis.cancel();
      podcastPlaying = false;
      setPodcasting(false);
      setPodcastStatus("");
      return;
    }
    const currentData = data;
    if (!hasReport || !currentData) return;

    setPodcasting(true);
    setPodcastStatus("生成播客脚本...");

    try {
      const reportHtml = await ensureReportHtml();
      if (!reportHtml) {
        setPodcasting(false);
        setPodcastStatus("报告为空");
        return;
      }

      if (!currentData._podcastScript) {
        const resp = await fetch("/api/podcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ report_html: reportHtml }),
        });
        const reader = resp.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let script = "";

        while (reader) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6)) as StreamEvent;
              if (event.step === "done") script = event.script || "";
              if (event.step === "progress") setPodcastStatus(event.text || "生成中...");
            } catch {}
          }
        }
        updateData({ _podcastScript: script });
        localStorage.setItem("talent_miner_podcast", script);
        fetch("/api/save-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position_id: currentData.position_id || 0, podcast_script: script }),
        }).catch(() => {});
      }

      const script = currentData._podcastScript || localStorage.getItem("talent_miner_podcast") || "";
      podcastLines = [];
      script.split("\n").forEach((line: string) => {
        const match = line.trim().match(/【(小研|小诺)】(.*)/);
        if (match) podcastLines.push({ host: match[1], text: match[2].trim() });
      });

      if (!podcastLines.length) {
        setPodcasting(false);
        setPodcastStatus("脚本为空");
        return;
      }

      podcastIdx = 0;
      podcastPlaying = true;
      setPodcastStatus("播放中...");

      const speak = () => {
        if (!podcastPlaying || podcastIdx >= podcastLines.length) {
          podcastPlaying = false;
          setPodcasting(false);
          setPodcastStatus("播放完成");
          return;
        }

        const line = podcastLines[podcastIdx];
        const utterance = new SpeechSynthesisUtterance(line.text);
        utterance.lang = "zh-CN";
        utterance.rate = line.host === "小研" ? 1 : 1.08;
        utterance.pitch = line.host === "小研" ? 1.15 : 1.05;
        const voices = speechSynthesis.getVoices().filter((voice) => voice.lang.startsWith("zh"));
        if (voices.length >= 2) {
          utterance.voice =
            line.host === "小研"
              ? voices.find((voice) => voice.name.includes("Xiaoxiao")) || voices[0]
              : voices.find((voice) => voice.name.includes("Yunxi") || voice.name.includes("Yunjian")) || voices[1];
        }
        utterance.onend = () => {
          podcastIdx += 1;
          speak();
        };
        utterance.onerror = () => {
          podcastIdx += 1;
          speak();
        };
        speechSynthesis.speak(utterance);
      };

      speak();
    } catch {
      setPodcasting(false);
      setPodcastStatus("播客生成失败");
    }
  };

  return (
    <div className="relative min-h-full overflow-hidden bg-[linear-gradient(135deg,rgba(15,23,42,.96),rgba(2,6,23,.98)_48%,rgba(20,36,32,.96))] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 -z-0 bg-[linear-gradient(rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.03)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:linear-gradient(to_bottom,black,transparent_82%)]" />

      <section className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(420px,.92fr)]">
        <div className="flex flex-col gap-6">
          <div className="rounded-lg border border-white/10 bg-white/[0.035] p-6 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:p-8">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
              <Sparkles className="h-3.5 w-3.5" />
              Market Talent Intelligence
            </div>
            <h1 className="whitespace-nowrap text-[2rem] font-black leading-none tracking-tight text-white sm:text-5xl xl:text-[3.35rem]">
              AI 市场人才地图
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-8 text-slate-300 sm:text-lg">
              用 Agent 把招聘需求、目标公司、候选人线索和报告问答串成一张可核验的人才情报工作台。
            </p>

            <div className="mt-7 grid gap-3 sm:grid-cols-[1fr_1fr_.75fr_auto]">
              <Field label="行业">
                <Input value={industry} onChange={(event) => setIndustry(event.target.value)} placeholder="如：互联网" className="h-11 bg-black/20" />
              </Field>
              <Field label="岗位方向">
                <Input value={role} onChange={(event) => setRole(event.target.value)} placeholder="如：AI产品经理" className="h-11 bg-black/20" />
              </Field>
              <Field label="区域">
                <Input value={city} onChange={(event) => setCity(event.target.value)} placeholder="可选" className="h-11 bg-black/20" />
              </Field>
              <Button onClick={handleGenerate} disabled={running} className="mt-5 h-11 gap-2 bg-cyan-300 text-slate-950 hover:bg-cyan-200">
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {running ? "生成中" : "生成地图"}
              </Button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {promptExamples.map((item) => (
                <button
                  key={`${item.industry}-${item.role}`}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 transition hover:border-cyan-300/40 hover:text-white"
                  onClick={() => {
                    setIndustry(item.industry);
                    setRole(item.role);
                    setCity(item.city);
                  }}
                >
                  {item.industry} · {item.role}
                </button>
              ))}
            </div>

            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between gap-4 text-sm text-slate-300">
                <span>{status}</span>
                <span className="font-mono text-cyan-200">{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-lg border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl">
                <p className="text-xs text-slate-400">{metric.label}</p>
                <strong className="mt-2 block text-2xl font-black text-white">{metric.value}</strong>
                <span className="mt-2 block text-xs text-cyan-200">{metric.sub}</span>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Agent Pipeline</p>
                <h2 className="mt-1 text-xl font-bold text-white">运行链路</h2>
              </div>
              {data?.position_id && (
                <Link href={`/database?position_id=${data.position_id}`} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 hover:border-cyan-300/40">
                  <Database className="h-4 w-4" />
                  查看数据源
                </Link>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {steps.map((step, index) => (
                <div key={step.key} className={`rounded-lg border p-4 ${step.state === "done" ? "border-emerald-300/25 bg-emerald-300/8" : step.state === "active" ? "border-cyan-300/30 bg-cyan-300/8" : "border-white/10 bg-black/10"}`}>
                  <div className="flex items-center gap-3">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-black ${step.state === "done" ? "bg-emerald-300 text-slate-950" : step.state === "active" ? "bg-cyan-300 text-slate-950" : "bg-white/8 text-slate-400"}`}>
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-white">{step.label}</h3>
                      <p className="truncate text-xs text-slate-400">{step.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Candidate Evidence</p>
                <h2 className="mt-1 text-xl font-bold text-white">候选人线索</h2>
              </div>
              <Users className="h-5 w-5 text-cyan-200" />
            </div>
            {talents.length ? (
              <div className="overflow-x-auto">
                <div className="min-w-[620px] space-y-2">
                  {talents.slice(0, 6).map((talent, index) => {
                    const tier = normalizeTier(talent.tier);
                    return (
                      <div key={`${talent.name || "talent"}-${index}`} className="grid grid-cols-[42px_minmax(180px,1fr)_minmax(180px,1.2fr)_110px_80px] items-center gap-3 rounded-lg border border-white/10 bg-black/15 px-3 py-3">
                        <span className="font-mono text-xs text-slate-500">{String(index + 1).padStart(2, "0")}</span>
                        <div className="min-w-0">
                          <strong className="block truncate text-sm text-white">{cleanText(talent.name, "候选人线索")}</strong>
                          <p className="truncate text-xs text-slate-400">{cleanText(talent.location, "地点未标注")}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm text-slate-200">{cleanText(talent.current_company || talent.company, "公司未标注")}</p>
                          <p className="truncate text-xs text-slate-500">{cleanText(talent.current_title || talent.title, "职位未标注")}</p>
                        </div>
                        <span className={`w-fit rounded-full border px-2 py-1 text-xs font-bold ${tierCopy[tier].tone}`}>{tierCopy[tier].label}</span>
                        {talent.source_url ? (
                          <a href={talent.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-100 hover:text-cyan-50">
                            来源
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-xs text-slate-500">无链接</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <EmptyState text="还没有候选人数据。生成后这里会展示 Turso talents 数组中的真实线索。" />
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex min-h-[520px] flex-col rounded-lg border border-white/10 bg-slate-950/70 p-5 shadow-2xl shadow-black/40 backdrop-blur-2xl">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Evidence Board</p>
                <h2 className="mt-1 text-xl font-bold text-white">Turso 数据证据台</h2>
              </div>
              <div className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs text-emerald-100">
                {data?._loadedFromTurso ? "DB Snapshot" : running ? "Live Run" : "Real Fields"}
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-200" />
                  <div>
                    <p className="text-sm font-semibold text-white">不再使用模拟热力图</p>
                    <p className="mt-1 text-sm leading-6 text-slate-400">
                      当前面板只展示 API 实际返回的候选人、JD/网页信号、公司、分层、来源链接和报告状态。
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">人才分层</p>
                  <span className="font-mono text-xs text-slate-400">{tierTotal === 1 && talents.length === 0 ? "0" : tierTotal} total</span>
                </div>
                <div className="space-y-3">
                  {(["high", "mid", "low"] as TierKey[]).map((tier) => (
                    <div key={tier}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-slate-300">{tierCopy[tier].label}</span>
                        <span className="font-mono text-slate-400">{tierStats[tier]}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/8">
                        <div className={`h-full rounded-full ${tierCopy[tier].bar}`} style={{ width: `${Math.round((tierStats[tier] / tierTotal) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <EvidenceGroup icon={<Building2 className="h-4 w-4" />} title="公司覆盖">
                {companies.length ? companies.slice(0, 8).map((company) => <Chip key={company}>{cleanText(company)}</Chip>) : <span className="text-sm text-slate-500">等待公司数据</span>}
              </EvidenceGroup>

              <EvidenceGroup icon={<MapPin className="h-4 w-4" />} title="地点线索">
                {topLocations.length ? topLocations.map((item) => <Chip key={item.name}>{cleanText(item.name)} · {item.count}</Chip>) : <span className="text-sm text-slate-500">API 未返回稳定区域分布</span>}
              </EvidenceGroup>

              <EvidenceGroup icon={<Link2 className="h-4 w-4" />} title="来源类型">
                {sourceBreakdown.length ? sourceBreakdown.map((item) => <Chip key={item.name}>{cleanText(item.name)} · {item.count}</Chip>) : <span className="text-sm text-slate-500">等待来源链接</span>}
              </EvidenceGroup>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <InfoCard icon={<Target className="h-4 w-4" />} label="目标公司池" value={companies.length ? `${companies.length} 家` : "--"} desc={companies.length ? companies.slice(0, 4).map((item) => cleanText(item)).join(" / ") : "等待真实公司字段"} />
            <InfoCard icon={<BarChart3 className="h-4 w-4" />} label="证据规模" value={hasEvidence ? `${talents.length + jds.length} 条` : "--"} desc="候选人线索 + 招聘/市场信号" />
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">JD Signals</p>
                <h2 className="mt-1 text-xl font-bold text-white">招聘与市场信号</h2>
              </div>
              <BriefcaseBusiness className="h-5 w-5 text-cyan-200" />
            </div>
            {jds.length ? (
              <div className="space-y-3">
                {jds.slice(0, 4).map((jd, index) => (
                  <div key={`${jd.title || "jd"}-${index}`} className="rounded-lg border border-white/10 bg-black/15 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{cleanText(jd.title, "招聘/市场信号")}</p>
                        <p className="mt-1 text-xs text-slate-500">{cleanText(jd.company, "公司未标注")} · {cleanText(jd.source_platform, "来源未标注")}</p>
                      </div>
                      {jd.source_url && (
                        <a href={jd.source_url} target="_blank" rel="noreferrer" className="shrink-0 text-cyan-100 hover:text-cyan-50">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                    <p className="mt-3 overflow-hidden text-xs leading-5 text-slate-400 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                      {excerpt(jd.snippet || jd.salary || jd.experience || jd.tools, "暂无摘要")}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="还没有 JD/网页信号。生成后这里会展示 jds 数组中的标题、公司、来源和摘要。" />
            )}
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Result Report</p>
                <h2 className="mt-1 text-xl font-bold text-white">结果报告</h2>
              </div>
              <FileText className="h-5 w-5 text-cyan-200" />
            </div>
            <p className="text-sm leading-7 text-slate-300">
              {hasReport
                ? "报告已生成。你可以直接打开 HTML 报告、下载留档，或生成双人播客脚本用于汇报。"
                : "生成完成后，这里会出现可查看、可下载、可播客化的市场人才地图报告。"}
            </p>
            {data?.questions?.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {data.questions.slice(0, 3).map((question) => (
                  <span key={question} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/15 px-3 py-1.5 text-xs text-slate-300">
                    <MessageSquareText className="h-3 w-3 text-cyan-200" />
                    {question}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={openReport} disabled={!hasReport} className="gap-2 border-white/10">
                <Eye className="h-3.5 w-3.5" />
                查看
              </Button>
              <Button variant="outline" size="sm" onClick={downloadReport} disabled={!hasReport} className="gap-2 border-white/10">
                <Download className="h-3.5 w-3.5" />
                下载
              </Button>
              <Button variant="outline" size="sm" onClick={handleGenerate} disabled={running} className="gap-2 border-white/10">
                <RefreshCw className="h-3.5 w-3.5" />
                重新生成
              </Button>
              <Button variant="outline" size="sm" onClick={togglePodcast} disabled={!hasReport || podcasting} className="gap-2 border-cyan-300/20 text-cyan-100">
                {podcasting ? <Mic2 className="h-3.5 w-3.5 animate-pulse" /> : <Podcast className="h-3.5 w-3.5" />}
                {podcasting ? podcastStatus || "播客中" : "播客"}
              </Button>
            </div>
            <Link href="/chat" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-cyan-100 hover:text-cyan-50">
              和猎头顾问继续讨论
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function InfoCard({ icon, label, value, desc }: { icon: React.ReactNode; label: string; value: string; desc: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl">
      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
        {icon}
      </div>
      <p className="text-xs text-slate-400">{label}</p>
      <strong className="mt-1 block text-2xl font-black text-white">{value}</strong>
      <span className="mt-2 block text-xs leading-5 text-slate-400">{desc}</span>
    </div>
  );
}

function EvidenceGroup({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
        <span className="text-cyan-200">{icon}</span>
        {title}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-slate-300">{children}</span>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-white/10 bg-black/10 p-4 text-sm leading-6 text-slate-500">{text}</div>;
}

function normalizeTier(tier?: string): TierKey {
  if (tier === "high" || tier === "mid" || tier === "low") return tier;
  return "low";
}

function cleanText(value?: string | number | null, fallback = "未标注") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;

  try {
    const decoded = raw.includes("%") ? decodeURIComponent(raw) : raw;
    if (decoded && !decoded.includes("�")) return decoded;
  } catch {}

  if ((raw.match(/%/g) || []).length >= 2) return fallback;
  return raw;
}

function excerpt(value?: string | number | null, fallback = "暂无摘要") {
  const text = cleanText(value, fallback).replace(/\s+/g, " ");
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function countTop(values: string[], limit: number) {
  const counter = new Map<string, number>();
  values.forEach((value) => {
    const key = cleanText(value);
    if (key !== "未标注") counter.set(key, (counter.get(key) || 0) + 1);
  });
  return Array.from(counter.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
