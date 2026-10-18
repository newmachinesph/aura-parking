import { clsx } from "clsx";

const styles = {
  success: "bg-success text-white",
  "success-subtle": "bg-emerald-100 text-emerald-700",
  warning: "bg-warning text-white",
  danger: "bg-danger text-white",
  info: "bg-info text-white",
  neutral: "bg-gray-400 text-white",
} as const;

interface BadgeProps {
  variant?: keyof typeof styles;
  className?: string;
  children: React.ReactNode;
}

export default function Badge({ variant = "neutral", className, children }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 px-3 py-0.5 rounded-[12px] text-xs font-semibold",
        styles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
