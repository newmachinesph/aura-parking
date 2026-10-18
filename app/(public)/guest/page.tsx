"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Mail, User, Car, Building, ArrowLeft, ArrowRight,
  CheckCircle, Download, Clock, ShieldCheck, AtSign, Calendar,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import DateRangePicker from "@/components/ui/DateRangePicker";
import Badge from "@/components/ui/Badge";
import { apiFetch, ApiError } from "@/lib/api";
import { format } from "date-fns";

type Step = "verify" | "details" | "success";

interface VerifiedResident {
  residentName: string;
  residentEmail: string;
  unitNumber: string;
}

export default function GuestFormPage() {
  const [step, setStep] = useState<Step>("verify");
  const [searchMode, setSearchMode] = useState<"email" | "unit">("email");
  const [search, setSearch] = useState("");
  const [residentName, setResidentName] = useState("");
  const [form, setForm] = useState({ name: "", email: "", plate: "", vehicle: "", startDate: "", endDate: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState<VerifiedResident | null>(null);
  const [confirmationId, setConfirmationId] = useState<string | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);

  const update = (key: string, value: string) => { setForm((f) => ({ ...f, [key]: value })); setError(null); };

  const handleSaveReference = useCallback(async () => {
    if (!receiptRef.current) return;
    const { toPng } = await import("html-to-image");
    const dataUrl = await toPng(receiptRef.current, { backgroundColor: "#ffffff", pixelRatio: 2 });
    const link = document.createElement("a");
    link.download = `parking-ref-${confirmationId || "guest"}.png`;
    link.href = dataUrl;
    link.click();
  }, [confirmationId]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedSearch = search.trim();
    if (!trimmedSearch) {
      setError(searchMode === "email" ? "Please enter a resident email" : "Please enter a unit number");
      return;
    }
    if (searchMode === "unit" && !/^\d{4}$/.test(trimmedSearch)) {
      setError("Unit number must be exactly 4 digits (e.g. 1101)");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, string> = { residentInfo: trimmedSearch };
      if (searchMode === "unit" && residentName.trim()) body.residentName = residentName.trim();
      const data = await apiFetch<VerifiedResident>("/api/verify-resident", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setVerified(data);
      setStep("details");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Resident not found");
    } finally {
      setLoading(false);
    }
  };

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verified) return;
    const trimmedName = form.name.trim();
    const trimmedPlate = form.plate.trim();
    const trimmedVehicle = form.vehicle.trim();
    if (!trimmedName) { setError("Guest name is required"); return; }
    if (!trimmedPlate) { setError("Vehicle plate is required"); return; }
    if (!/^[A-Za-z0-9]{2,8}$/.test(trimmedPlate.replace(/[\s-]/g, ""))) {
      setError("Please enter a valid US license plate (2-8 letters/numbers)");
      return;
    }
    if (!trimmedVehicle) { setError("Vehicle make is required"); return; }
    if (!form.startDate || !form.endDate) {
      setError("Please select the stay duration");
      return;
    }
    if (form.startDate < today) {
      setError("Start date cannot be in the past");
      return;
    }
    if (form.endDate < form.startDate) {
      setError("End date must be on or after start date");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ id: number; status: string }>("/api/guest-stays", {
        method: "POST",
        body: JSON.stringify({
          unitNumber: verified.unitNumber,
          residentEmail: verified.residentEmail,
          guest: { fullName: trimmedName, email: form.email.trim() },
          vehicle: { plate: trimmedPlate, desc: trimmedVehicle },
          stay: { startDate: form.startDate, endDate: form.endDate },
        }),
      });
      setConfirmationId(data.id.toString(36).toUpperCase());
      setStep("success");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to submit request");
    } finally {
      setLoading(false);
    }
  };

  /* ─── Success ─── */
  if (step === "success") {
    const rows = [
      { icon: User, label: "Guest", value: form.name },
      { icon: AtSign, label: "Email", value: form.email },
      { icon: Building, label: "Host", value: `${verified?.residentName || "Resident"} — Unit ${verified?.unitNumber || ""}` },
      { icon: Car, label: "Vehicle", value: `${form.plate} — ${form.vehicle}` },
      { icon: Calendar, label: "Stay", value: `${format(new Date(form.startDate), "MM/dd")}–${format(new Date(form.endDate), "MM/dd")}` },
    ];

    return (
      <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-md text-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle size={32} className="text-success" />
          </div>
          <h1 className="text-xl font-black">Request Submitted</h1>
          <p className="text-sm text-text-secondary">
            Your parking request has been sent to the resident&apos;s portal for review and approval.
          </p>

          {/* Reference code */}
          <div className="bg-primary-50 border border-primary-200 rounded-[10px] px-4 py-3 w-full">
            <p className="text-[11px] text-primary-500 uppercase tracking-wider font-medium">Reference Code</p>
            <p className="text-2xl font-black text-primary-700 tracking-widest mt-0.5">AP-{confirmationId}</p>
          </div>

          {/* Details card */}
          <div ref={receiptRef} className="w-full bg-amber-50/60 border border-amber-200/50 rounded-[10px] p-4 flex flex-col gap-2.5 text-left">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-text-secondary">
                <ShieldCheck size={14} />
                <span>Reference</span>
              </div>
              <span className="font-bold tracking-wider">AP-{confirmationId}</span>
            </div>
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-text-secondary">
                  <row.icon size={14} />
                  <span>{row.label}</span>
                </div>
                <span className="font-medium text-right">{row.value}</span>
              </div>
            ))}
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-text-secondary">
                <Clock size={14} />
                <span>Status</span>
              </div>
              <Badge variant="warning">Pending</Badge>
            </div>
          </div>

          <Button onClick={handleSaveReference} className="w-full gap-2">
            <Download size={16} /> Save Reference
          </Button>

          <div className="bg-surface-dim rounded-[10px] p-3 w-full">
            <p className="text-xs text-text-secondary text-center">
              We&apos;ll send you updates via email with the status of your request.
            </p>
          </div>

          <Link href="/" className="w-full">
            <Button variant="outline" className="w-full">Done</Button>
          </Link>
        </div>
      </div>
    );
  }

  /* ─── Form ─── */
  return (
    <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-md">
      <Link href="/" className="inline-flex text-text-secondary hover:text-primary-500 transition-colors mb-4">
        <ArrowLeft size={22} />
      </Link>

      <div className="flex flex-col items-center gap-2 mb-6">
        <Image src="/assets/img/aura-apache-primary-logo.webp" alt="Aura Apache" width={150} height={40} className="h-8 w-auto" />
        <h1 className="text-xl font-black">Guest Parking</h1>
        <p className="text-sm text-text-secondary">
          {step === "verify" ? "Find your host resident" : "Enter your stay details"}
        </p>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2 justify-center mb-4">
        <div className="w-8 h-1 rounded-full bg-primary-500" />
        <div className={`w-8 h-1 rounded-full ${step === "details" ? "bg-primary-500" : "bg-gray-200"}`} />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3 mb-4">{error}</div>
      )}

      {step === "verify" && (
        <form onSubmit={handleVerify} className="flex flex-col gap-3">
          <div className="flex gap-2 bg-surface-dim rounded-[10px] p-1">
            <button type="button" onClick={() => { setSearchMode("email"); setSearch(""); setResidentName(""); setError(null); }} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${searchMode === "email" ? "bg-white shadow-sm text-text-primary" : "text-text-secondary"}`}>
              By Email
            </button>
            <button type="button" onClick={() => { setSearchMode("unit"); setSearch(""); setResidentName(""); setError(null); }} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${searchMode === "unit" ? "bg-white shadow-sm text-text-primary" : "text-text-secondary"}`}>
              By Unit
            </button>
          </div>
          <Input
            label={searchMode === "email" ? "Resident Email" : "Unit Number"}
            icon={searchMode === "email" ? Mail : Building}
            placeholder={searchMode === "email" ? "resident@example.com" : "1101"}
            value={search}
            onChange={(e) => {
              const val = e.target.value;
              if (searchMode === "unit") {
                // Only allow digits, max 4 characters
                if (val && !/^\d{0,4}$/.test(val)) return;
              }
              setSearch(val);
              setError(null);
            }}
            required
            inputMode={searchMode === "unit" ? "numeric" : undefined}
            maxLength={searchMode === "unit" ? 4 : undefined}
          />
          {searchMode === "unit" && (
            <Input
              label="Resident Name (optional)"
              icon={User}
              placeholder="Jane Doe"
              value={residentName}
              onChange={(e) => setResidentName(e.target.value)}
            />
          )}
          <Button type="submit" loading={loading} className="w-full mt-2">
            Find Resident
          </Button>
        </form>
      )}

      {step === "details" && verified && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* Verified resident banner */}
          <div className="bg-green-50 border border-green-200 rounded-[10px] p-3">
            <div className="flex items-center gap-1.5 text-xs text-green-600 font-medium mb-0.5">
              <ShieldCheck size={13} /> Verified Resident
            </div>
            <p className="text-sm font-bold text-text-primary">{verified.residentName} &mdash; Unit {verified.unitNumber}</p>
          </div>

          <Input label="Guest Name" icon={User} placeholder="Guest Full Name" value={form.name} onChange={(e) => update("name", e.target.value)} required />
          <Input label="Guest Email (Optional)" icon={AtSign} type="email" placeholder="Guest Email" value={form.email} onChange={(e) => update("email", e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Vehicle Plate" icon={Car} placeholder="Plate (e.g. LLK0322)" value={form.plate} onChange={(e) => update("plate", e.target.value)} required />
            <Input label="Vehicle Make" icon={Car} placeholder="e.g. White Toyota" value={form.vehicle} onChange={(e) => update("vehicle", e.target.value)} required />
          </div>
          <DateRangePicker
            label="Stay Duration"
            startDate={form.startDate}
            endDate={form.endDate}
            onChange={(s, e) => { update("startDate", s); update("endDate", e); }}
            min={today}
            required
          />
          <div className="grid grid-cols-2 gap-3 mt-2">
            <Button variant="ghost" type="button" onClick={() => { setStep("verify"); setError(null); }} className="gap-1.5">
              <ArrowLeft size={16} /> Previous
            </Button>
            <Button type="submit" loading={loading} className="gap-1.5">
              Confirm <ArrowRight size={16} />
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
