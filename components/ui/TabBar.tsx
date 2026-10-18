"use client";

import { useRef, useCallback } from "react";
import { clsx } from "clsx";
import type { LucideIcon } from "lucide-react";

interface Tab {
  key: string;
  label: string;
  count?: number;
  icon?: LucideIcon;
}

interface TabBarProps {
  tabs: Tab[];
  active: string;
  onChange: (key: string) => void;
}

export default function TabBar({ tabs, active, onChange }: TabBarProps) {
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const swiped = useRef(false);

  const activeIndex = tabs.findIndex((t) => t.key === active);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    swiped.current = false;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (swiped.current) return;
      const dx = e.changedTouches[0].clientX - touchStartX.current;
      const dy = e.changedTouches[0].clientY - touchStartY.current;

      // Only trigger if horizontal swipe is dominant and > 50px
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        swiped.current = true;
        if (dx < 0 && activeIndex < tabs.length - 1) {
          onChange(tabs[activeIndex + 1].key);
        } else if (dx > 0 && activeIndex > 0) {
          onChange(tabs[activeIndex - 1].key);
        }
      }
    },
    [activeIndex, tabs, onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let nextIndex = activeIndex;
      if (e.key === "ArrowRight") {
        nextIndex = activeIndex < tabs.length - 1 ? activeIndex + 1 : 0;
      } else if (e.key === "ArrowLeft") {
        nextIndex = activeIndex > 0 ? activeIndex - 1 : tabs.length - 1;
      } else if (e.key === "Home") {
        nextIndex = 0;
      } else if (e.key === "End") {
        nextIndex = tabs.length - 1;
      } else {
        return;
      }
      e.preventDefault();
      onChange(tabs[nextIndex].key);
      // Focus the newly active tab button
      const container = e.currentTarget;
      const buttons = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      buttons[nextIndex]?.focus();
    },
    [activeIndex, tabs, onChange]
  );

  return (
    <div
      role="tablist"
      className="flex gap-2.5 my-1 overflow-x-auto no-scrollbar p-3 -mx-1"
      style={{ WebkitOverflowScrolling: "touch" }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        const Icon = tab.icon;
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.key)}
            className={clsx(
              "flex items-center justify-center gap-[5px] border-none px-[15px] py-1.5 rounded-full text-sm whitespace-nowrap transition-all duration-200 cursor-pointer",
              isActive
                ? "bg-primary-500 text-surface-dim scale-105 shadow-[0_0_2px_rgba(0,0,0,0.75)]"
                : "bg-transparent shadow-[0_0_1px_rgba(0,0,0,0.5)]"
            )}
          >
            {Icon && <Icon size={15} />}
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={clsx(
                  "text-[10px] px-1.5 py-0.5 rounded-full font-bold",
                  isActive
                    ? "bg-white/20 text-white"
                    : "bg-gray-200 text-text-secondary"
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
