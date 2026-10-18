import { Inbox } from "lucide-react";

interface EmptyStateProps {
  title?: string;
  description?: string;
}

export default function EmptyState({
  title = "Nothing here yet",
  description = "No records to display",
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-3 text-center border border-dashed border-border rounded-[10px] mx-2">
      <div className="w-16 h-16 rounded-full bg-surface-dim flex items-center justify-center">
        <Inbox size={28} className="text-text-secondary" />
      </div>
      <h3 className="font-bold text-text-primary">{title}</h3>
      <p className="text-sm text-text-secondary max-w-xs">{description}</p>
    </div>
  );
}
