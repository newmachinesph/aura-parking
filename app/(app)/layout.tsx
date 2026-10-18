"use client";

import AppShell from "@/components/layout/AppShell";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import { useAuthStore } from "@/stores/authStore";
import type { Role } from "@/stores/authStore";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import Loader from "@/components/ui/Loader";
import { DASHBOARD_BY_ROLE } from "@/lib/navigation";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { session, role, isLoading, initialized, initialize } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (!initialized || isLoading) return;

    if (!session) {
      router.replace("/");
      return;
    }

    // Role-based route protection
    if (role) {
      const wrongSection =
        (pathname.startsWith("/admin") && role !== "admin") ||
        (pathname.startsWith("/staff") && role !== "staff") ||
        (pathname.startsWith("/dashboard") && role !== "resident");

      if (wrongSection) {
        router.replace(DASHBOARD_BY_ROLE[role as Role] || "/");
      }
    }
  }, [session, role, isLoading, initialized, router, pathname]);

  if (!initialized || isLoading) return <Loader />;
  if (!session || !role) return <Loader />;

  return <ErrorBoundary><AppShell>{children}</AppShell></ErrorBoundary>;
}
