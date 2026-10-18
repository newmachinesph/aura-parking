import { clsx } from "clsx";

/* ------------------------------------------------------------------ */
/*  Base skeleton                                                      */
/* ------------------------------------------------------------------ */

interface SkeletonProps {
  className?: string;
  variant?: "text" | "circular" | "rectangular";
  lines?: number;
}

export default function Skeleton({
  className,
  variant = "rectangular",
  lines = 1,
}: SkeletonProps) {
  if (variant === "text" && lines > 1) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className={clsx(
              "bg-gray-200 rounded h-4 motion-safe:animate-pulse",
              i === lines - 1 ? "w-3/4" : "w-full",
              className
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "bg-gray-200 motion-safe:animate-pulse",
        variant === "circular" ? "rounded-full" : "rounded-[10px]",
        variant === "text" && "h-4 w-full rounded",
        className
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Composite: GuestCard skeleton                                      */
/* ------------------------------------------------------------------ */

export function GuestCardSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3 rounded-[10px] bg-surface-container border-l-[3px] border-l-gray-200">
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-40" />
      </div>
      <Skeleton className="h-6 w-16 rounded-full" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Composite: VehicleCard skeleton                                    */
/* ------------------------------------------------------------------ */

export function VehicleCardSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3 rounded-[10px] bg-surface-container border-l-[3px] border-l-gray-200">
      <Skeleton variant="circular" className="w-10 h-10" />
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-32" />
      </div>
      <Skeleton className="h-6 w-16 rounded-full" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Composite: StatsCard skeleton                                      */
/* ------------------------------------------------------------------ */

export function StatsCardSkeleton() {
  return (
    <div className="bg-surface-dim rounded-[10px] border border-gray-200 border-l-4 border-l-gray-300 p-4">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton variant="circular" className="w-5 h-5" />
      </div>
      <div className="mt-3">
        <Skeleton className="h-8 w-10" />
      </div>
    </div>
  );
}
