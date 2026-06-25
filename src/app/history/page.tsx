"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { History, Eye } from "lucide-react";

export default function HistoryPage() {
  const [positions, setPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/data?list=true")
      .then(r => r.json()).then(d => { setPositions(d.positions || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const loadPosition = async (id: number) => {
    const resp = await fetch(`/api/data?position_id=${id}`);
    const data = await resp.json();
    if (data.report_html?.length > 100) {
      const w = window.open("", "_blank"); w?.document.write(data.report_html); w?.document.close();
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><History className="h-4 w-4 text-primary" />历史报告</CardTitle></CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground text-center py-8">加载中...</p> :
            !positions.length ? <p className="text-sm text-muted-foreground text-center py-8">暂无历史报告</p> :
            <div className="space-y-1">
              {positions.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-3 px-3 rounded-lg hover:bg-muted/50 transition-colors">
                  <div>
                    <span className="text-sm font-medium">{p.name || `报告 #${p.id}`}</span>
                    <span className="text-xs text-muted-foreground ml-3">{p.industry} · {p.role_direction} · {p.created_at?.substring(0, 10)}</span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => loadPosition(p.id)} className="text-xs"><Eye className="h-3 w-3 mr-1" />查看</Button>
                </div>
              ))}
            </div>
          }
        </CardContent>
      </Card>
    </div>
  );
}
