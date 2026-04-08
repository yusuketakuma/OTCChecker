import * as React from "react";

import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-[var(--color-text)] outline-none ring-0 placeholder:text-slate-400 focus:border-[var(--color-brand)]",
        className,
      )}
      {...props}
    />
  );
}
