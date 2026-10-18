"use client";

import Link from "next/link";
import { XCircle } from "lucide-react";
import Button from "@/components/ui/Button";

export default function PaymentCancelPage() {
  return (
    <div className="bg-white rounded-[10px] border border-border overflow-hidden px-6 sm:px-8 py-6 w-full max-w-md text-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
          <XCircle size={32} className="text-danger" />
        </div>
        <h1 className="text-xl font-black">Payment Cancelled</h1>
        <p className="text-sm text-text-secondary">
          Your payment was not completed. You can try again from your dashboard.
        </p>
        <Link href="/dashboard" className="w-full">
          <Button className="w-full">Back to Dashboard</Button>
        </Link>
      </div>
    </div>
  );
}
