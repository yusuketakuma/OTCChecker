import * as React from "react";

import { cn } from "@/lib/utils";

export function FormLabel({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "text-xs font-semibold uppercase tracking-[0.16em] text-slate-500",
        className,
      )}
      {...props}
    />
  );
}
