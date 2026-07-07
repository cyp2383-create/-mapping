"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Database, ExternalLink } from "lucide-react";

type TalentRow = {
  name?: string;
  current_company?: string;
  current_title?: string;
  tier?: string;
  source_platform?: string;
  source_url?: string;
  profile_url?: string;
  linkedin_url?: string;
  url?: string;
  link?: string;
  contact_type?: string;
  contact_value?: string;
  sources?: Array<{
    type?: string;
    platform?: string;
    title?: string;
    url?: string;
    source_url?: string;
    href?: string;
    link?: string;
  }>;
};

type JobRow = {
  title?: string;
  company?: string;
  salary?: string;
  location?: string;
  source_platform?: string;
  source_url?: string;
};

function DatabaseContent() {
  const searchParams = useSearchParams();
  const pid = searchParams.get("position_id");
  const [talents, setTalents] = useState<TalentRow[]>([]);
  const [jds, setJds] = useState<JobRow[]>([]);
  const [meta, setMeta] = useState({ name: "", industry: "", role: "" });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!pid) {
        setLoading(false);
        return;
      }
      try {
        const r = await fetch(`/api/data?position_id=${pid}`);
        const d = await r.json();
        setTalents(d.talents || []);
        setJds(d.jds || []);
        setMeta({ name: d.name || "", industry: d.industry || "", role: d.role || d.role_direction || "" });
      } catch {} finally { setLoading(false); }
    })();
  }, [pid]);

  const tierColor = (t?: string) => t === "high" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : t === "mid" ? "border-amber-500/30 bg-amber-500/10 text-amber-400" : "border-violet-500/30 bg-violet-500/10 text-violet-400";
  const tierLabel = (t?: string) => t === "high" ? "高" : t === "mid" ? "中" : "低";

  if (!pid) return (
    <div className="max-w-5xl mx-auto px-6 py-10"><Card><CardHeader><CardTitle className="text-sm flex items-center gap-2"><Database className="h-4 w-4 text-primary" />人才数据库</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground text-center py-8">请先搜索或从历史记录选择一个岗位查看数据</p></CardContent></Card></div>
  );

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Database className="h-4 w-4 text-primary" />人才数据库 · {meta.industry} · {meta.role}</CardTitle>

        </CardHeader>
        <CardContent>
          <Tabs defaultValue="talents">
            <TabsList className="mb-4"><TabsTrigger value="talents">候选人 ({talents.length})</TabsTrigger><TabsTrigger value="jds">招聘JD ({jds.length})</TabsTrigger></TabsList>
            <TabsContent value="talents">
              {loading ? <p className="text-sm text-muted-foreground text-center py-8">加载中...</p> :
                <div className="overflow-auto max-h-[500px]"><Table>
                  <TableHeader><TableRow><TableHead className="text-xs">姓名</TableHead><TableHead className="text-xs">公司</TableHead><TableHead className="text-xs">职位</TableHead><TableHead className="text-xs">档位</TableHead><TableHead className="text-xs">联系</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {talents.map((t, i) => {
                      const talentUrl = getTalentUrl(t);
                      return (
                        <TableRow key={i}>
                          <TableCell className="text-xs font-medium">
                            {talentUrl ? (
                              <a href={talentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                {t.name || "***"}
                                <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            ) : (t.name || "***")}
                          </TableCell>
                          <TableCell className="text-xs">{t.current_company || ""}</TableCell>
                          <TableCell className="text-xs max-w-[180px] truncate">{t.current_title || ""}</TableCell>
                          <TableCell><Badge variant="outline" className={`text-[10px] ${tierColor(t.tier)}`}>{tierLabel(t.tier)}</Badge></TableCell>
                          <TableCell className="text-xs">
                            {talentUrl ? (
                              <a href={talentUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                                {t.contact_type || t.source_platform || "链接"}
                                <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            ) : (t.contact_type || "—")}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!talents.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">暂无数据</TableCell></TableRow>}
                  </TableBody>
                </Table></div>}
            </TabsContent>
            <TabsContent value="jds">
              {loading ? <p className="text-sm text-muted-foreground text-center py-8">加载中...</p> :
                <div className="overflow-auto max-h-[500px]"><Table>
                  <TableHeader><TableRow><TableHead className="text-xs">职位</TableHead><TableHead className="text-xs">公司</TableHead><TableHead className="text-xs">薪资</TableHead><TableHead className="text-xs">地点</TableHead><TableHead className="text-xs">来源</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {jds.map((j, i) => (<TableRow key={i}><TableCell className="text-xs font-medium">{j.title || ""}</TableCell><TableCell className="text-xs">{j.company || ""}</TableCell><TableCell className="text-xs">{j.salary || "—"}</TableCell><TableCell className="text-xs">{j.location || "—"}</TableCell><TableCell className="text-xs">{j.source_url ? <a href={j.source_url} target="_blank" className="text-primary hover:underline"><Badge variant="outline" className="text-[10px] border-emerald-500/30 bg-emerald-500/10 text-emerald-400">{j.source_platform || "链接"}</Badge></a> : <Badge variant="outline" className="text-[10px]">{j.source_platform || "—"}</Badge>}</TableCell></TableRow>))}
                    {!jds.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">暂无数据</TableCell></TableRow>}
                  </TableBody>
                </Table></div>}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

export default function DatabasePage() {
  return <Suspense fallback={<div className="text-center py-10 text-muted-foreground text-sm">加载中...</div>}><DatabaseContent /></Suspense>;
}

function getTalentUrl(talent: TalentRow) {
  const direct = firstPublicProfileUrl(talent.source_url, talent.contact_value, talent.profile_url, talent.linkedin_url, talent.url, talent.link);
  if (direct) return direct;
  const personProfile = talent.sources?.find((source) => source.type === "person_profile" && firstPublicProfileUrl(source.url, source.source_url, source.href, source.link));
  const firstSource = talent.sources?.find((source) => firstPublicProfileUrl(source.url, source.source_url, source.href, source.link));
  return firstPublicProfileUrl(personProfile?.url, personProfile?.source_url, personProfile?.href, personProfile?.link, firstSource?.url, firstSource?.source_url, firstSource?.href, firstSource?.link);
}

function firstPublicProfileUrl(...values: Array<string | undefined>) {
  return values.find((value) => isPublicProfileUrl(value)) || "";
}

function isPublicProfileUrl(value?: string) {
  const url = String(value || "").trim();
  if (/^https?:\/\/([^/]+\.)?linkedin\.com\/in\/[^/?#]+/i.test(url)) return true;
  if (/^https?:\/\/([^/]+\.)?github\.com\/(?!orgs\/|features|enterprise|marketplace|topics|collections|events|settings|login|signup|explore|jobs|about|pricing|search)[^/?#]+\/?$/i.test(url)) return true;
  if (/^https?:\/\/([^/]+\.)?zhihu\.com\/people\/[^/?#]+/i.test(url)) return true;
  if (/^https?:\/\/(x\.com|([^/]+\.)?twitter\.com)\/(?!home|i\/|share|intent|search|notifications|messages)[^/?#]+\/?$/i.test(url)) return true;
  if (/^https?:\/\/([^/]+\.)?medium\.com\/(@[^/?#]+|[^/?#]+)\/?$/i.test(url)) return true;
  if (/^https?:\/\/([^/]+\.)?substack\.com\/?(?!p\/|archive|about)/i.test(url)) return true;
  return false;
}
