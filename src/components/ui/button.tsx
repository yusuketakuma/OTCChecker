import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-full text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-[var(--color-brand)] px-4 py-3 text-white shadow-lg shadow-emerald-900/15",
        secondary: "bg-white/80 px-4 py-3 text-[var(--color-text)] ring-1 ring-slate-200",
        ghost: "px-3 py-2 text-[var(--color-text)]",
        danger: "bg-[var(--color-danger)] px-4 py-3 text-white",
      },
      size: {
        md: "h-11",
        lg: "h-14 px-6 text-base",
        icon: "h-12 w-12",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      type={type}
      {...props}
    />
  );
}
