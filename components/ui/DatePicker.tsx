"use client";

import { useState, useMemo } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addMonths,
  subMonths,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isBefore,
  startOfDay,
} from "date-fns";
import BottomSheet from "./BottomSheet";

interface DatePickerProps {
  label?: string;
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  min?: string; // YYYY-MM-DD
  max?: string; // YYYY-MM-DD
  required?: boolean;
  placeholder?: string;
}

export default function DatePicker({
  label,
  value,
  onChange,
  min,
  max,
  required,
  placeholder = "Select date",
}: DatePickerProps) {
  const [open, setOpen] = useState(false);

  const selected = value ? new Date(value + "T00:00:00") : null;
  const minDate = min ? startOfDay(new Date(min + "T00:00:00")) : undefined;
  const maxDate = max ? startOfDay(new Date(max + "T00:00:00")) : undefined;

  const [viewMonth, setViewMonth] = useState(
    selected || new Date()
  );

  const handleOpen = () => {
    setViewMonth(selected || new Date());
    setOpen(true);
  };

  const handleSelect = (day: Date) => {
    onChange(format(day, "yyyy-MM-dd"));
    setOpen(false);
  };

  const days = useMemo(() => {
    const monthStart = startOfMonth(viewMonth);
    const monthEnd = endOfMonth(viewMonth);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    return eachDayOfInterval({ start: calStart, end: calEnd });
  }, [viewMonth]);

  const isDisabled = (day: Date) => {
    if (minDate && isBefore(day, minDate)) return true;
    if (maxDate && isBefore(maxDate, day)) return true;
    return false;
  };

  return (
    <>
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-sm font-medium text-text-primary">{label}</label>
        )}
        <button
          type="button"
          onClick={handleOpen}
          className="w-full h-12 rounded-[10px] bg-surface-dim border border-surface-dim text-sm text-left px-3 flex items-center gap-2.5 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-500 transition-all cursor-pointer"
        >
          <Calendar size={16} className="text-text-secondary shrink-0" />
          <span className={value ? "text-text-primary" : "text-text-secondary"}>
            {selected ? format(selected, "MMM dd, yyyy") : placeholder}
          </span>
        </button>
        {required && (
          <input
            type="text"
            value={value}
            required
            tabIndex={-1}
            className="sr-only"
            onChange={() => {}}
          />
        )}
      </div>

      <BottomSheet open={open} onClose={() => setOpen(false)} title={label || "Select Date"}>
        {/* Month Navigation */}
        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={() => setViewMonth((m) => subMonths(m, 1))}
            aria-label="Previous month"
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-dim transition-colors cursor-pointer"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="text-sm font-bold">
            {format(viewMonth, "MMMM yyyy")}
          </span>
          <button
            type="button"
            onClick={() => setViewMonth((m) => addMonths(m, 1))}
            aria-label="Next month"
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-dim transition-colors cursor-pointer"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 mb-1">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
            <div key={d} className="text-center text-xs font-medium text-text-secondary py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const disabled = isDisabled(day);
            const isSelected = selected && isSameDay(day, selected);
            const isCurrentMonth = isSameMonth(day, viewMonth);
            const isToday = isSameDay(day, new Date());

            return (
              <button
                key={day.toISOString()}
                type="button"
                disabled={disabled}
                onClick={() => handleSelect(day)}
                className={`
                  h-11 flex items-center justify-center rounded-full text-sm transition-all cursor-pointer
                  ${disabled ? "text-gray-300 cursor-not-allowed" : ""}
                  ${!isCurrentMonth && !disabled ? "text-gray-300" : ""}
                  ${isCurrentMonth && !disabled && !isSelected ? "text-text-primary hover:bg-primary-100" : ""}
                  ${isSelected ? "bg-primary-500 text-white font-bold" : ""}
                  ${isToday && !isSelected ? "font-bold ring-1 ring-primary-300" : ""}
                `}
              >
                {format(day, "d")}
              </button>
            );
          })}
        </div>

        {/* Quick actions */}
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={() => handleSelect(new Date())}
            disabled={minDate ? isBefore(new Date(), minDate) : false}
            className="flex-1 py-2.5 rounded-[10px] bg-surface-dim text-sm font-medium text-text-primary hover:bg-primary-100 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className="flex-1 py-2.5 rounded-[10px] bg-surface-dim text-sm font-medium text-text-secondary hover:bg-red-50 hover:text-danger transition-colors cursor-pointer"
          >
            Clear
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
