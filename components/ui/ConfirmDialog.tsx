"use client";

import BottomSheet from "./BottomSheet";
import Button from "./Button";
import { AlertTriangle, Info } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "primary";
  loading?: boolean;
}

const iconBg: Record<string, string> = {
  danger: "bg-red-100",
  warning: "bg-amber-100",
  primary: "bg-primary-100",
};

const iconColor: Record<string, string> = {
  danger: "text-danger",
  warning: "text-warning",
  primary: "text-primary-500",
};

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  loading = false,
}: ConfirmDialogProps) {
  const Icon = variant === "primary" ? Info : AlertTriangle;

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <div className="flex flex-col items-center gap-4 py-2">
        <div
          className={`w-14 h-14 rounded-full flex items-center justify-center ${iconBg[variant]}`}
        >
          <Icon size={28} className={iconColor[variant]} />
        </div>
        <p className="text-sm text-text-secondary text-center leading-relaxed">
          {description}
        </p>
        <div className="flex gap-3 w-full mt-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={onClose}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant === "primary" ? "primary" : "danger"}
            className="flex-1"
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
