"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Headphones, ShieldUser, HelpCircle, AlertTriangle, Send, Check } from "lucide-react";
import BottomSheet from "@/components/ui/BottomSheet";
import Button from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";

const chevronStyle: React.CSSProperties = {
  backgroundColor: "#252220",
  backgroundImage: [
    "linear-gradient(135deg, #2d292655 25%, transparent 25%)",
    "linear-gradient(225deg, #2d2926 25%, transparent 25%)",
    "linear-gradient(315deg, #2d292655 25%, transparent 25%)",
    "linear-gradient(45deg, #2d2926 25%, #252220 25%)",
  ].join(", "),
  backgroundPosition: "-40px 0, -40px 0, 0 0, 0 0",
  backgroundSize: "80px 80px",
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [showSupport, setShowSupport] = useState(false);
  const [subject, setSubject] = useState<"Question" | "Technical Problem">("Question");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const year = new Date().getFullYear();

  // Admin/staff pages: show "User" linking to /, else show "Management" linking to /admin/login
  const isOps = pathname.startsWith("/admin") || pathname.startsWith("/staff") || pathname === "/ops";
  const mgmtLabel = isOps ? "User" : "Management";
  const mgmtHref = isOps ? "/" : "/ops";

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      await apiFetch("/api/send-support-email", {
        method: "POST",
        body: JSON.stringify({
          userEmail: email || "anonymous@visitor.com",
          subject,
          message,
          role: "visitor",
        }),
      });
      setSent(true);
      setTimeout(() => {
        setShowSupport(false);
        setSent(false);
        setMessage("");
        setEmail("");
        setSubject("Question");
      }, 2000);
    } catch {
      setSendError("Failed to send. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col" style={chevronStyle}>
      {/* Navbar */}
      <nav className="flex items-center justify-between px-4 sm:px-6 py-2.5 bg-white sticky top-0 z-50 border-b border-border shadow-[0_0_2px_rgba(0,0,0,0.25)]">
        <Link href="/" className="flex items-center gap-1.5 no-underline">
          <Image
            src="/assets/img/aura-apache-logo.png"
            alt="Aura Apache Logo"
            width={40}
            height={40}
            className="w-10 h-10 object-contain"
          />
          <h1 className="text-lg font-bold text-text-primary m-0">Aura Parking</h1>
        </Link>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowSupport(true)}
            className="flex items-center gap-1.5 px-3 py-2 border border-text-primary rounded-full bg-transparent text-text-primary text-sm font-medium transition-all shadow-[0_0_2px_rgba(0,0,0,0.25)] hover:bg-text-primary hover:text-white cursor-pointer"
          >
            <Headphones size={18} />
            <span className="hidden sm:inline">Support</span>
          </button>
          <Link
            href={mgmtHref}
            className="flex items-center gap-1.5 px-3 py-2 border border-transparent rounded-full bg-text-primary text-surface-dim text-sm font-medium transition-all shadow-[0_0_2px_rgba(0,0,0,0.25)] hover:bg-primary-500 no-underline"
          >
            <ShieldUser size={18} />
            <span className="hidden sm:inline">{mgmtLabel}</span>
          </Link>
        </div>
      </nav>

      {/* Page Content */}
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="py-3 text-center">
        <span className="text-sm text-[#f4f4f4]">
          &copy; {year} Aura Apache Parking. All rights reserved.
        </span>
      </footer>

      {/* Support BottomSheet */}
      <BottomSheet open={showSupport} onClose={() => { setShowSupport(false); setSent(false); }} title="Help & Support">
        {sent ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
              <Check size={24} className="text-success" />
            </div>
            <p className="text-sm font-medium">Message sent!</p>
            <p className="text-xs text-text-secondary text-center">We&apos;ll get back to you via email.</p>
          </div>
        ) : (
          <form onSubmit={handleSend} className="flex flex-col gap-4">
            {sendError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-[10px] px-4 py-3">{sendError}</div>
            )}
            <p className="text-sm text-text-secondary">
              Have a question or experiencing a technical issue? Send us a message and we&apos;ll get back to you via email.
            </p>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-primary">Your Email</label>
              <input
                type="email"
                className="w-full rounded-[10px] bg-surface-dim border border-surface-dim text-sm placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-500 transition-all px-3 py-2.5"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-primary">Topic</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSubject("Question")}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                    subject === "Question"
                      ? "bg-primary-500 text-white"
                      : "bg-surface-dim text-text-secondary"
                  }`}
                >
                  <HelpCircle size={14} /> Question
                </button>
                <button
                  type="button"
                  onClick={() => setSubject("Technical Problem")}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                    subject === "Technical Problem"
                      ? "bg-danger text-white"
                      : "bg-surface-dim text-text-secondary"
                  }`}
                >
                  <AlertTriangle size={14} /> Technical Problem
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text-primary">Message</label>
              <textarea
                className="w-full h-32 rounded-[10px] bg-surface-dim border border-surface-dim text-sm placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-500 transition-all p-3 resize-none"
                placeholder="Describe your issue or question here..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
              />
            </div>
            <Button type="submit" loading={sending} className="w-full gap-2">
              <Send size={16} /> Send Message
            </Button>
          </form>
        )}
      </BottomSheet>
    </div>
  );
}
