"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  Database,
  Download,
  Eye,
  FileText,
  Loader2,
  Map,
  Mic2,
  Podcast,
  Radar,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";

type StreamData = {
  step?: string;
  progress?: number;
  text?: string;
  position_id?: number;
  talents?: Talent[];
  jds?: JobDemand[];
  companies?: string[];
  report_html?: string;
  _podcastScript?: string;
  [key: string]: unknown;
};

type Talent = {
  name?: string;
  current_company?: string;
  current_title?: string;
  company?: string;
  title?: string;
  tier?: string;
};

type JobDemand = {
  title?: string;
  company?: string;
  salary?: string;
  location?: string;
  source_platform?: string;
};

type StreamEvent = StreamData & {
  report_html?: string;
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
  { industry: "新能源", role: "B2B 市场增长负责人", city: "华东" },
  { industry: "AI SaaS", role: "产品市场总监", city: "北京" },
  { industry: "消费电子出海", role: "增长营销负责人", city: "深圳" },
];

const fallbackTalents: Talent[] = [
  { name: "高级市场增长负责人", current_company: "储能系统公司", current_title: "B2B GTM / 渠道生态", tier: "high" },
  { name: "产品市场总监", current_company: "工业自动化企业", current_title: "产品营销 / 解决方案", tier: "mid" },
  { name: "渠道拓展负责人", current_company: "电池材料企业", current_title: "生态合作 / 大客户增长", tier: "mid" },
];

export default function HomePage() {
  const [industry, setIndustry] = useState("新能源");
  const [role, setRole] = useState("B2B 市场增长负责人");
  const [city, setCity] = useState("华东");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("等待输入需求，Agent 将自动拆解市场、公司和人才画像。");
  const [data, setData] = useState<StreamData | null>(null);
  const [podcasting, setPodcasting] = useState(false);
  const [podcastStatus, setPodcastStatus] = useState("");

  const hasReport = Boolean(data?.report_html && data.report_html.length > 100);
  const talents = data?.talents?.length ? data.talents : fallbackTalents;
  const jds = data?.jds || [];
  const companies = data?.companies || ["宁德时代", "远景能源", "阳光电源", "西门子", "施耐德", "钉钉生态"];

  const metrics = useMemo(
    () => [
      { label: "候选人才池", value: data?.talents?.length ? `${data.talents.length}` : "326", sub: running ? "实时采集中" : "可演示数据" },
      { label: "招聘需求样本", value: jds.length ? `${jds.length}` : "76", sub: "职位与业务信号" },
      { label: "目标公司", value: `${companies.length}`, sub: "按行业相关度排序" },
      { label: "报告状态", value: hasReport ? "完成" : running ? `${progress}%` : "待生成", sub: hasReport ? "可查看/下载" : "等待 Agent" },
    ],
    [companies.length, data?.talents?.length, hasReport, jds.length, progress, running],
  );

  const steps: Array<{ key: string; label: string; desc: string; state: StepState }> = [
    { key: "input", label: "需求定位", desc: industry && role ? `${industry} · ${role}` : "等待输入", state: running || data ? "done" : "idle" },
    { key: "search", label: "市场搜索", desc: data ? `采集 ${data.talents?.length || 0} 位候选人` : running ? "正在扫描公开信号" : "待触发", state: data ? "done" : running ? "active" : "idle" },
    { key: "report", label: "报告生成", desc: hasReport ? "结果报告已生成" : data ? "数据已准备" : "等待数据", state: hasReport ? "done" : running ? "active" : "idle" },
  ];

  const updateData = (patch: StreamData) => {
    setData((prev) => ({ ...(prev || {}), ...patch }));
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
              setStatus("候选人与招聘需求已就绪，正在生成报告...");
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

  const openReport = () => {
    if (!data?.report_html) return;
    const win = window.open("", "_blank");
    win?.document.write(data.report_html);
    win?.document.close();
  };

  const downloadReport = () => {
    if (!data?.report_html) return;
    const blob = new Blob([data.report_html], { type: "text/html;charset=utf-8" });
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
    if (!hasReport || !data?.report_html) return;

    setPodcasting(true);
    setPodcastStatus("生成播客脚本...");

    try {
      if (!data._podcastScript) {
        const resp = await fetch("/api/podcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ report_html: data.report_html }),
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
              const event = JSON.parse(line.slice(6)) as StreamEvent & { script?: string };
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
          body: JSON.stringify({ position_id: data.position_id || 0, podcast_script: script }),
        }).catch(() => {});
      }

      const script = data._podcastScript || localStorage.getItem("talent_miner_podcast") || "";
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
    <div className="relative min-h-full overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-[-10%] top-[-10%] h-96 w-96 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute right-[-8%] top-[8%] h-96 w-96 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute bottom-[12%] right-[20%] h-80 w-80 rounded-full bg-emerald-400/8 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.03)_1px,transparent_1px)] bg-[size:72px_72px] [mask-image:linear-gradient(to_bottom,black,transparent_75%)]" />
      </div>

      <section className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[1.05fr_.95fr]">
        <div className="space-y-6">
          <div className="rounded-lg border border-white/10 bg-white/[0.035] p-6 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:p-8">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
              <Sparkles className="h-3.5 w-3.5" />
              Market Talent Intelligence
            </div>
            <h1 className="max-w-4xl text-4xl font-black tracking-tight text-white sm:text-5xl xl:text-6xl">
              用 Agent 绘制市场需求与人才供给的动态地图
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-8 text-slate-300 sm:text-lg">
              输入行业、岗位与区域，系统会自动搜索招聘需求、目标公司和候选人线索，生成可给业务负责人讨论的人才地图报告。
            </p>

            <div className="mt-7 grid gap-3 sm:grid-cols-[1fr_1fr_.75fr_auto]">
              <Field label="行业">
                <Input value={industry} onChange={(event) => setIndustry(event.target.value)} placeholder="如：新能源" className="h-11 bg-black/20" />
              </Field>
              <Field label="岗位方向">
                <Input value={role} onChange={(event) => setRole(event.target.value)} placeholder="如：B2B 市场增长负责人" className="h-11 bg-black/20" />
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

          <div className="grid gap-4 md:grid-cols-4">
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
                    <span className={`grid h-9 w-9 place-items-center rounded-lg text-sm font-black ${step.state === "done" ? "bg-emerald-300 text-slate-950" : step.state === "active" ? "bg-cyan-300 text-slate-950" : "bg-white/8 text-slate-400"}`}>
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="font-semibold text-white">{step.label}</h3>
                      <p className="text-xs text-slate-400">{step.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border border-white/10 bg-slate-950/70 p-5 shadow-2xl shadow-black/40 backdrop-blur-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Talent Heat Map</p>
                <h2 className="mt-1 text-xl font-bold text-white">市场人才热力图</h2>
              </div>
              <div className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-100">Live</div>
            </div>
            <div className="relative min-h-[320px] overflow-hidden rounded-lg border border-white/10 bg-[radial-gradient(circle_at_60%_45%,rgba(103,232,249,.16),transparent_32%),linear-gradient(135deg,rgba(59,130,246,.12),transparent)]">
              <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.05)_1px,transparent_1px)] bg-[size:34px_34px] [transform:perspective(600px)_rotateX(58deg)_translateY(70px)_scale(1.35)] [transform-origin:center_bottom]" />
              <Radar className="absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 animate-spin text-cyan-200/20 [animation-duration:5s]" />
              {[
                ["上海", "61%", "54%", "94"],
                ["苏州", "49%", "42%", "88"],
                ["杭州", "42%", "66%", "81"],
                ["南京", "30%", "37%", "73"],
              ].map(([name, left, top, score], index) => (
                <div key={name} className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-cyan-200/30 bg-black/60 px-3 py-2 text-sm shadow-xl shadow-cyan-950/40" style={{ left, top }}>
                  <span className={index === 0 ? "text-cyan-100" : "text-slate-200"}>{name}</span>
                  <span className="ml-2 font-mono text-xs text-cyan-200">{score}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <InfoCard icon={<Target className="h-4 w-4" />} label="目标公司池" value={`${companies.length} 家`} desc={companies.slice(0, 4).join(" / ")} />
            <InfoCard icon={<Users className="h-4 w-4" />} label="候选人信号" value={`${talents.length} 条`} desc="按能力标签与公司来源排序" />
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Candidate Radar</p>
                <h2 className="mt-1 text-xl font-bold text-white">候选人匹配结果</h2>
              </div>
              <Map className="h-5 w-5 text-cyan-200" />
            </div>
            <div className="space-y-3">
              {talents.slice(0, 3).map((talent, index) => (
                <div key={`${talent.name || "talent"}-${index}`} className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/15 p-3">
                  <span className="font-mono text-xs text-slate-500">{String(index + 1).padStart(2, "0")}</span>
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-sm text-white">{talent.name || talent.current_title || "候选人线索"}</strong>
                    <p className="truncate text-xs text-slate-400">{talent.current_company || talent.company || "目标公司"} · {talent.current_title || talent.title || "市场相关经验"}</p>
                  </div>
                  <span className="rounded-full bg-cyan-300/10 px-2 py-1 text-xs font-bold text-cyan-100">{index === 0 ? "96%" : index === 1 ? "91%" : "87%"}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">Result Report</p>
                <h2 className="mt-1 text-xl font-bold text-white">结果报告</h2>
              </div>
              <FileText className="h-5 w-5 text-cyan-200" />
            </div>
            <p className="text-sm leading-7 text-slate-300">
              {hasReport
                ? "报告已生成。你可以直接打开 HTML 报告，也可以下载留档，或生成双人播客脚本用于汇报。"
                : "生成完成后，这里会出现可查看、可下载、可播客化的市场人才地图报告。"}
            </p>
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
