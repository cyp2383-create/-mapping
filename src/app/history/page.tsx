"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, History, Database } from "lucide-react";
import Link from "next/link";

type HistoryRecord = {
  id: number;
  name?: string;
  industry?: string;
  role_direction?: string;
  created_at?: string;
};

const openReportLazy = async (id: number) => {
  const w = window.open("", "_blank");
  if (w) { w.document.write('<p style="color:#888;text-align:center;padding:40px;font:14px sans-serif;background:#0d0d14">加载中...</p>'); w.document.close(); }
  const r = await fetch(`/api/data?position_id=${id}`);
  const d = await r.json();
  if (d.report_html?.length > 100 && w) { w.document.write(d.report_html); w.document.close(); }
};

export default function HistoryPage() {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
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
                    <Link href={`/database?position_id=${r.id}`}><Button variant="outline" size="sm" className="text-xs"><Database className="h-3 w-3 mr-1 text-sky-400" />人才库</Button></Link>
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
