"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Headphones, ShieldCheck, Contact, Briefcase, ShieldUser, HelpCircle, AlertTriangle, Send, Check } from "lucide-react";
import BottomSheet from "@/components/ui/BottomSheet";
import Button from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";

export default function LandingPage() {
  const [showSupport, setShowSupport] = useState(false);
  const [subject, setSubject] = useState<"Question" | "Technical Problem">("Question");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const year = new Date().getFullYear();

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
    <div className="min-h-[100dvh] flex flex-col bg-chevron">
      {/* Navbar */}
      <nav className="flex items-center justify-between px-4 sm:px-6 py-2.5 bg-white sticky top-0 z-50 border-b border-border shadow-[0_0_2px_rgba(0,0,0,0.25)]">
        <div className="flex items-center gap-1.5">
          <Image
            src="/assets/img/aura-apache-logo.png"
            alt="Aura Apache Logo"
            width={40}
            height={40}
            className="w-10 h-10 object-contain"
          />
          <h1 className="text-lg font-bold text-text-primary m-0">Aura Parking</h1>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowSupport(true)}
            className="flex items-center gap-1.5 px-3 py-2 border border-text-primary rounded-full bg-transparent text-text-primary text-sm font-medium transition-all shadow-[0_0_2px_rgba(0,0,0,0.25)] hover:bg-text-primary hover:text-white cursor-pointer"
          >
            <Headphones size={18} />
            <span className="hidden sm:inline">Support</span>
          </button>
          <Link
            href="/ops"
            className="flex items-center gap-1.5 px-3 py-2 border border-transparent rounded-full bg-text-primary text-surface-dim text-sm font-medium transition-all shadow-[0_0_2px_rgba(0,0,0,0.25)] hover:bg-primary-500 no-underline"
          >
            <ShieldUser size={18} />
            <span className="hidden sm:inline">Management</span>
          </Link>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-sm text-center">
          {/* Illustration */}
          <div className="flex items-center justify-center mb-2">
            <Image
              src="/assets/img/aura-apache-role.png"
              alt="Visitor Parking"
              width={180}
              height={180}
              className="w-[180px] h-auto"
            />
          </div>

          {/* Heading */}
          <h2 className="text-xl font-black text-text-primary mb-1">Visitor Parking</h2>
          <p className="text-sm text-text-secondary m-0">Select how you want to continue</p>

          {/* Role Buttons */}
          <div className="grid grid-cols-2 gap-3 py-4">
            <Link href="/login" className="no-underline">
              <div className="group relative bg-surface-dim rounded-[10px] h-[120px] flex items-center justify-center transition-all hover:shadow-[0_0_5px_rgba(0,0,0,0.5)] hover:scale-105 hover:-rotate-1 cursor-pointer overflow-hidden">
                <div className="flex flex-col items-center gap-1.5 text-text-primary transition-colors group-hover:text-white z-10">
                  <Contact size={35} />
                  <span className="text-sm font-medium">Resident</span>
                </div>
                <div className="absolute inset-0 bg-primary-500 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </Link>
            <Link href="/guest" className="no-underline">
              <div className="group relative bg-surface-dim rounded-[10px] h-[120px] flex items-center justify-center transition-all hover:shadow-[0_0_5px_rgba(0,0,0,0.5)] hover:scale-105 hover:-rotate-1 cursor-pointer overflow-hidden">
                <div className="flex flex-col items-center gap-1.5 text-text-primary transition-colors group-hover:text-white z-10">
                  <Briefcase size={35} />
                  <span className="text-sm font-medium">Guest</span>
                </div>
                <div className="absolute inset-0 bg-primary-500 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </Link>
          </div>

          {/* Disclaimer */}
          <div className="flex items-center justify-center gap-1.5 text-text-secondary mt-2">
            <ShieldCheck size={15} />
            <small className="text-[13px]">Your information is safe and securely encrypted.</small>
          </div>
        </div>
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
