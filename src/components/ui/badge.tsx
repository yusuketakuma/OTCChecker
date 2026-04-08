import { cn } from "@/lib/utils";

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "danger" | "warning" | "info" | "success";
  className?: string;
}) {
  const toneClass = {
    neutral: "bg-slate-100 text-slate-700",
    danger: "bg-rose-100 text-rose-700",
    warning: "bg-amber-100 text-amber-700",
    info: "bg-sky-100 text-sky-700",
    success: "bg-emerald-100 text-emerald-700",
  }[tone];

  return (
    <span className={cn("inline-flex rounded-full px-3 py-1 text-xs font-medium", toneClass, className)}>
      {children}
    </span>
  );
}
