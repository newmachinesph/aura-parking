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
  isAfter,
  startOfDay,
} from "date-fns";
import BottomSheet from "./BottomSheet";
import Button from "./Button";

interface DateRangePickerProps {
  label?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  onChange: (start: string, end: string) => void;
  min?: string; // YYYY-MM-DD
  required?: boolean;
  placeholder?: string;
}

export default function DateRangePicker({
  label,
  startDate,
  endDate,
  onChange,
  min,
  placeholder = "Select dates",
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState<"start" | "end">("start");
  const [tempStart, setTempStart] = useState(startDate);
  const [tempEnd, setTempEnd] = useState(endDate);

  const minDate = min ? startOfDay(new Date(min + "T00:00:00")) : undefined;

  const toDate = (s: string) => (s ? new Date(s + "T00:00:00") : null);

  const [viewMonth, setViewMonth] = useState(
    toDate(startDate) || new Date()
  );

  const handleOpen = () => {
    setTempStart(startDate);
    setTempEnd(endDate);
    setPicking(startDate ? "end" : "start");
    setViewMonth(toDate(startDate) || new Date());
    setOpen(true);
  };

  const handleDayClick = (day: Date) => {
    const dateStr = format(day, "yyyy-MM-dd");

    if (picking === "start") {
      setTempStart(dateStr);
      if (tempEnd && dateStr > tempEnd) setTempEnd("");
      setPicking("end");
    } else {
      if (dateStr < tempStart) {
        // Clicked before start — reset start
        setTempStart(dateStr);
        setTempEnd("");
        setPicking("end");
      } else {
        setTempEnd(dateStr);
      }
    }
  };

  const handleConfirm = () => {
    if (tempStart && tempEnd) {
      onChange(tempStart, tempEnd);
      setOpen(false);
    }
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
    return false;
  };

  const tStart = toDate(tempStart);
  const tEnd = toDate(tempEnd);

  const displayValue =
    startDate && endDate
      ? `${format(toDate(startDate)!, "MM/dd")} — ${format(toDate(endDate)!, "MM/dd")}`
      : startDate
        ? `${format(toDate(startDate)!, "MM/dd")} — ...`
        : "";

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
          <span className={displayValue ? "text-text-primary" : "text-text-secondary"}>
            {displayValue || placeholder}
          </span>
        </button>
        {/* Date validation is handled in form submit handlers (not native HTML5) to avoid
           browser tooltip appearing at wrong position due to sr-only hidden input */}
      </div>

      <BottomSheet open={open} onClose={() => setOpen(false)} title={label || "Select Dates"}>
        {/* Picking indicator */}
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setPicking("start")}
            className={`flex-1 py-2 rounded-[10px] text-sm font-medium transition-all cursor-pointer ${
              picking === "start"
                ? "bg-primary-500 text-white"
                : "bg-surface-dim text-text-secondary"
            }`}
          >
            {tempStart ? format(toDate(tempStart)!, "MMM dd") : "Check-in"}
          </button>
          <div className="flex items-center text-text-secondary">→</div>
          <button
            type="button"
            onClick={() => { if (tempStart) setPicking("end"); }}
            className={`flex-1 py-2 rounded-[10px] text-sm font-medium transition-all cursor-pointer ${
              picking === "end"
                ? "bg-primary-500 text-white"
                : "bg-surface-dim text-text-secondary"
            }`}
          >
            {tempEnd ? format(toDate(tempEnd)!, "MMM dd") : "Check-out"}
          </button>
        </div>

        {/* Month Navigation */}
        <div className="flex items-center justify-between mb-3">
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
            const isCurrentMonth = isSameMonth(day, viewMonth);
            const isToday = isSameDay(day, new Date());
            const isStart = tStart && isSameDay(day, tStart);
            const isEnd = tEnd && isSameDay(day, tEnd);
            const inRange =
              tStart && tEnd && isAfter(day, tStart) && isBefore(day, tEnd);

            return (
              <button
                key={day.toISOString()}
                type="button"
                disabled={disabled}
                onClick={() => handleDayClick(day)}
                className={`
                  h-11 flex items-center justify-center text-sm transition-all cursor-pointer relative
                  ${disabled ? "text-gray-300 cursor-not-allowed" : ""}
                  ${!isCurrentMonth && !disabled ? "text-gray-300" : ""}
                  ${inRange ? "bg-primary-100 text-primary-700" : ""}
                  ${isStart || isEnd ? "bg-primary-500 text-white font-bold rounded-full z-10" : ""}
                  ${isStart && tEnd ? "rounded-l-full rounded-r-none" : ""}
                  ${isEnd && tStart ? "rounded-r-full rounded-l-none" : ""}
                  ${isStart && isEnd ? "rounded-full" : ""}
                  ${isStart && !tEnd ? "rounded-full" : ""}
                  ${!isStart && !isEnd && !inRange && isCurrentMonth && !disabled ? "text-text-primary hover:bg-primary-50 rounded-full" : ""}
                  ${isToday && !isStart && !isEnd ? "font-bold ring-1 ring-primary-300 rounded-full" : ""}
                `}
              >
                {format(day, "d")}
              </button>
            );
          })}
        </div>

        {/* Confirm */}
        <div className="mt-4">
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!tempStart || !tempEnd}
            className="w-full"
          >
            Confirm Dates
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}
