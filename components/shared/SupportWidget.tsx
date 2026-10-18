"use client";

import { useState } from "react";
import { HelpCircle, AlertTriangle, Send, Check } from "lucide-react";
import BottomSheet from "@/components/ui/BottomSheet";
import Button from "@/components/ui/Button";
import { useAuthStore } from "@/stores/authStore";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

export default function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState<"Question" | "Technical Problem">("Question");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const session = useAuthStore((s) => s.session);
  const role = useAuthStore((s) => s.role);
  const { toast } = useToast();

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      await apiFetch("/api/send-support-email", {
        method: "POST",
        body: JSON.stringify({ subject, message }),
      });
      setSent(true);
      toast({ title: "Message sent", variant: "success" });
      setTimeout(() => {
        setOpen(false);
        setSent(false);
        setMessage("");
        setSubject("Question");
      }, 2000);
    } catch (err) {
      setSendError("Failed to send message. Please try again or email support directly.");
      toast({ title: "Failed to send", description: err instanceof Error ? err.message : "Failed to send message", variant: "error" });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Floating help button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-22 z-50 w-11 h-11 rounded-full bg-primary-500 text-white shadow-lg flex items-center justify-center cursor-pointer active:scale-95 transition-transform hover:bg-primary-600"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Help and support"
      >
        <HelpCircle size={20} />
      </button>

      {/* Support modal */}
      <BottomSheet open={open} onClose={() => { setOpen(false); setSent(false); }} title="Help & Support">
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

            {/* Sending as info */}
            {session?.user?.email && (
              <div className="text-xs text-text-secondary bg-surface-dim rounded-lg px-3 py-2">
                Sending as <span className="font-medium text-text-primary">{session.user.email}</span>
                {role && <> ({role})</>}
              </div>
            )}

            {/* Topic selector */}
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

            {/* Message */}
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
    </>
  );
}
