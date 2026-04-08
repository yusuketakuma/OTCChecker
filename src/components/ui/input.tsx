import * as React from "react";

import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-[var(--color-text)] outline-none ring-0 placeholder:text-slate-400 focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[color:var(--color-brand-soft)]/80 sm:text-sm",
          className,
        )}
        {...props}
      />
    );
  },
);
