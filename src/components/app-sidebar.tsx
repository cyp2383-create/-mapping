"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock3, Database, Menu, Radar, Search } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "市场地图", desc: "需求定位与生成", icon: Radar },
  { href: "/database", label: "人才数据", desc: "候选人与 JD", icon: Database },
  { href: "/history", label: "历史记录", desc: "搜索 case 与报告", icon: Clock3 },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <>
      <Sheet>
        <SheetTrigger className="fixed left-3 top-3 z-50 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-white backdrop-blur transition hover:bg-white/10 lg:hidden">
          <Menu className="h-5 w-5" />
        </SheetTrigger>
        <SheetContent side="left" className="w-72 border-white/10 bg-slate-950/95 p-4 text-white backdrop-blur-2xl">
          <SidebarContent pathname={pathname} />
        </SheetContent>
      </Sheet>

      <aside className="hidden w-72 shrink-0 flex-col border-r border-white/10 bg-slate-950/80 backdrop-blur-2xl lg:flex">
        <SidebarContent pathname={pathname} />
      </aside>
    </>
  );
}

function SidebarContent({ pathname }: { pathname: string }) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/10 px-2 pb-5 pt-2">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-lg bg-cyan-300 font-black text-slate-950 shadow-lg shadow-cyan-950/40">N</span>
          <div>
            <div className="text-sm font-black tracking-tight text-white">NebulaTalent</div>
            <p className="text-xs text-slate-400">市场人才地图Agent</p>
          </div>
        </Link>
      </div>

      <nav className="flex-1 space-y-2 px-2 py-5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 rounded-lg border px-3 py-3 transition",
                active
                  ? "border-cyan-300/25 bg-cyan-300/10 text-white shadow-lg shadow-cyan-950/20"
                  : "border-transparent text-slate-400 hover:border-white/10 hover:bg-white/[0.04] hover:text-white",
              )}
            >
              <span className={cn("grid h-9 w-9 place-items-center rounded-lg", active ? "bg-cyan-300 text-slate-950" : "bg-white/[0.06] text-slate-300 group-hover:text-cyan-100")}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{item.label}</span>
                <span className="block truncate text-xs text-slate-500">{item.desc}</span>
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="mx-2 mb-3 rounded-lg border border-white/10 bg-white/[0.04] p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <Search className="h-4 w-4 text-cyan-200" />
          数据源状态
        </div>
        <div className="space-y-2 text-xs text-slate-400">
          <div className="flex justify-between"><span>旧 API 代理</span><span className="text-emerald-300">Online</span></div>
          <div className="flex justify-between"><span>DeepSeek</span><span className="text-cyan-200">Ready</span></div>
          <div className="flex justify-between"><span>Tavily</span><span className="text-cyan-200">Ready</span></div>
        </div>
      </div>
    </div>
  );
}
