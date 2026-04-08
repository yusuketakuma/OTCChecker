"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Camera, Package, Settings, Upload } from "lucide-react";

import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "ダッシュ", icon: BarChart3 },
  { href: "/inventory", label: "在庫", icon: Package },
  { href: "/scan", label: "スキャン", icon: Camera, featured: true },
  { href: "/import", label: "取込", icon: Upload },
  { href: "/settings", label: "設定", icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-3xl px-4 pb-4">
      <div className="grid grid-cols-5 items-end rounded-[32px] border border-white/70 bg-[rgba(14,35,32,0.86)] px-2 py-2 shadow-2xl shadow-emerald-950/20 backdrop-blur">
        {items.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-1 rounded-3xl px-2 py-2 text-[11px] font-medium text-white/70 transition",
                active && "text-white",
                item.featured &&
                  "mx-1 -mt-8 rounded-full bg-[var(--color-accent)] py-4 text-[var(--color-text)] shadow-lg shadow-amber-700/30",
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
