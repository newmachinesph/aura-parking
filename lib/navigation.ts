import { Home, Users, Car, Briefcase, Ticket, UserPlus, Building } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Role } from "@/stores/authStore";

export interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  path: string;
  /** Hide from mobile bottom nav (shown only in sidebar) */
  desktopOnly?: boolean;
  /** Override label for desktop sidebar */
  desktopLabel?: string;
  /** Override path for desktop sidebar */
  desktopPath?: string;
}

export const NAV_CONFIG: Record<Role, NavItem[]> = {
  resident: [
    { key: "home", label: "Home", icon: Home, path: "/dashboard" },
    { key: "passes", label: "Passes", icon: Ticket, path: "/dashboard/passes" },
  ],
  admin: [
    { key: "home", label: "Home", icon: Home, path: "/admin/dashboard" },
    { key: "parking", label: "Parking", icon: Car, path: "/admin/parking" },
    { key: "guests", label: "Guests", icon: Users, path: "/admin/guests" },
    { key: "users", label: "Add User", icon: UserPlus, path: "/admin/users?add=true", desktopLabel: "Users", desktopPath: "/admin/users" },
  ],
  staff: [
    { key: "home", label: "Home", icon: Home, path: "/staff/dashboard" },
  ],
};

export const DASHBOARD_BY_ROLE: Record<Role, string> = {
  admin: "/admin/dashboard",
  staff: "/staff/dashboard",
  resident: "/dashboard",
};
