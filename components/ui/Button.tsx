"use client";

import { clsx } from "clsx";
import { Loader2 } from "lucide-react";

const variants = {
  primary: "bg-primary-500 text-white hover:bg-primary-600 active:bg-primary-700",
  secondary: "bg-surface-dim text-text-primary hover:bg-gray-200",
  ghost: "bg-transparent text-text-primary hover:bg-surface-dim",
  danger: "bg-danger text-white hover:bg-red-600",
  outline: "border border-primary-500 text-primary-500 hover:bg-primary-50",
} as const;

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  loading?: boolean;
}

export default function Button({
  variant = "primary",
  loading,
  children,
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-[10px] px-4 min-h-12 font-medium transition-all duration-200 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none cursor-pointer",
        variants[variant],
        className
      )}
      disabled={loading || disabled}
      {...props}
    >
      {loading ? <Loader2 size={18} className="animate-spin" /> : children}
    </button>
  );
}
