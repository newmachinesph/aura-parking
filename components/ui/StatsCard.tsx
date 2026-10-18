import { clsx } from "clsx";
import type { LucideIcon } from "lucide-react";

const accentColors = {
  success: "border-l-success",
  warning: "border-l-warning",
  danger: "border-l-danger",
  info: "border-l-info",
  primary: "border-l-primary-500",
} as const;

interface StatsCardProps {
  title: string;
  subtitle?: string;
  value: number | string;
  accent?: keyof typeof accentColors;
  icon?: LucideIcon;
  action?: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}

export default function StatsCard({
  title,
  subtitle,
  value,
  accent = "primary",
  icon: Icon,
  action,
  onClick,
  active,
}: StatsCardProps) {
  return (
    <div
      className={clsx(
        "bg-surface-dim rounded-[10px] border border-l-4 p-4",
        active ? "border-primary-500 ring-2 ring-primary-200" : "border-primary-500",
        onClick && "cursor-pointer hover:bg-primary-50/50 transition-colors",
        accentColors[accent]
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-medium text-text-primary text-sm">{title}</h3>
          {subtitle && (
            <p className="text-xs text-text-secondary mt-0.5">{subtitle}</p>
          )}
        </div>
        {Icon && <Icon size={20} className="text-text-secondary" />}
      </div>
      <div className="flex items-end justify-between mt-3">
        <span className="text-3xl font-bold text-text-primary">{value}</span>
        {action}
      </div>
    </div>
  );
}
