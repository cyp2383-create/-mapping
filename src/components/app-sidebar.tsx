"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";

const navItems = [
  { href: "/", label: "需求配置", icon: "📋" },
  { href: "/chat", label: "猎头顾问", icon: "💬" },
  { href: "/database", label: "人才数据库", icon: "🗄" },
  { href: "/history", label: "历史报告", icon: "📜" },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile trigger */}
      <Sheet>
        <SheetTrigger>
          <Button variant="ghost" size="icon" className="fixed top-3 left-3 z-50 lg:hidden">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-60 p-4 bg-sidebar border-sidebar-border">
          <SidebarContent pathname={pathname} />
        </SheetContent>
      </Sheet>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-56 flex-col border-r border-sidebar-border bg-sidebar shrink-0">
        <div className="px-4 py-5 border-b border-sidebar-border">
          <h1 className="text-sm font-bold text-sidebar-accent-foreground tracking-tight">Talent Miner</h1>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                pathname === item.href
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
              )}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-sidebar-border">
          <p className="text-xs text-muted-foreground">Tavily · DeepSeek · AI</p>
        </div>
      </aside>
    </>
  );
}

function SidebarContent({ pathname }: { pathname: string }) {
  return (
    <>
      <h2 className="text-sm font-bold mb-4">Talent Miner</h2>
      <nav className="space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
              pathname === item.href
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
