"use client";

import { ChevronDown, Loader2 } from "lucide-react";

interface ShowMoreButtonProps {
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
  loadedCount?: number;
}

export default function ShowMoreButton({
  hasMore,
  isLoading,
  onLoadMore,
  loadedCount,
}: ShowMoreButtonProps) {
  if (!hasMore) return null;

  return (
    <div className="flex flex-col items-center gap-1.5 pt-2 pb-1">
      {loadedCount !== undefined && (
        <p className="text-xs text-text-secondary">
          Showing {loadedCount} items
        </p>
      )}
      <button
        type="button"
        onClick={onLoadMore}
        disabled={isLoading}
        className="inline-flex items-center justify-center gap-1.5 rounded-[10px] px-4 min-h-10 text-sm font-medium bg-transparent text-text-primary hover:bg-surface-dim transition-all duration-200 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
      >
        {isLoading ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <>
            <ChevronDown size={16} />
            Show More
          </>
        )}
      </button>
    </div>
  );
}
