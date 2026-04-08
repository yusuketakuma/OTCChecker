import * as React from "react";

import { cn } from "@/lib/utils";

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-28 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-[var(--color-text)] outline-none placeholder:text-slate-400 focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[color:var(--color-brand-soft)]/80 sm:text-sm",
        className,
      )}
      {...props}
    />
  );
}
