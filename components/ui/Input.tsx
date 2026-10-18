"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Eye, EyeOff } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  icon?: LucideIcon;
  error?: string;
  success?: string;
}

export default function Input({
  label,
  icon: Icon,
  error,
  success,
  className,
  type,
  ...props
}: InputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";
  const resolvedType = isPassword && showPassword ? "text" : type;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-sm font-medium text-text-primary">{label}</label>
      )}
      <div className="relative">
        {Icon && (
          <Icon
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
          />
        )}
        <input
          type={resolvedType}
          className={clsx(
            "w-full h-12 rounded-[10px] bg-surface-dim border border-surface-dim text-sm placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-500 transition-all",
            Icon ? "pl-10" : "pl-4",
            isPassword ? "pr-11" : "pr-4",
            error && "border-danger focus:ring-red-200",
            className
          )}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary cursor-pointer p-1"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {success && !error && <p className="text-xs text-success">{success}</p>}
    </div>
  );
}
