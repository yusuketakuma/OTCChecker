"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Boxes, Camera, Package, Settings, Upload } from "lucide-react";

import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "ダッシュ", icon: BarChart3 },
  { href: "/products", label: "商品", icon: Boxes },
  { href: "/inventory", label: "在庫", icon: Package },
  { href: "/scan", label: "スキャン", icon: Camera, featured: true },
  { href: "/import", label: "取込", icon: Upload },
  { href: "/settings", label: "設定", icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-3xl px-3 pb-[calc(0.75rem+var(--safe-bottom))] sm:px-4 sm:pb-4">
      <div className="grid grid-cols-6 items-end rounded-[28px] border border-white/85 bg-[rgba(246,248,244,0.95)] px-1.5 py-2 shadow-2xl shadow-emerald-950/12 backdrop-blur sm:rounded-[32px] sm:px-2">
        {items.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Link
              aria-current={active ? "page" : undefined}
              key={item.href}
              href={item.href}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 rounded-3xl px-1 py-2 text-[10px] font-medium text-slate-500 transition sm:px-2 sm:text-[11px]",
                active && "bg-white text-[var(--color-text)] shadow-sm",
                item.featured &&
                  "mx-1 -mt-6 rounded-full bg-[var(--color-accent)] px-2 py-3 text-[var(--color-text)] shadow-lg shadow-amber-700/25 sm:-mt-8 sm:py-4",
              )}
            >
              <Icon className={cn("h-5 w-5", item.featured && "h-6 w-6")} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
