import { create } from "zustand";
import { apiFetch, ApiError } from "@/lib/api";

export type Role = "resident" | "admin" | "staff";

interface User {
  id: number;
  email: string;
  role: Role;
  residentId: number | null;
  fullName: string;
  unitNumber: string | null;
}

interface AuthState {
  session: { user: User } | null;
  role: Role | null;
  isLoading: boolean;
  error: string | null;
  initialized: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  initialize: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  role: null,
  isLoading: false,
  error: null,
  initialized: false,

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiFetch<{ token: string; user: { id: number; email: string; role: string; residentId: number | null; fullName?: string; unitNumber?: string | null } }>(
        "/api/auth/login",
        { method: "POST", body: JSON.stringify({ email, password }) }
      );
      const role = data.user.role as Role;
      set({
        session: {
          user: {
            id: data.user.id,
            email: data.user.email,
            role,
            residentId: data.user.residentId,
            fullName: data.user.fullName || data.user.email.split("@")[0],
            unitNumber: data.user.unitNumber || null,
          },
        },
        role,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Login failed";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  logout: async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // clear state even if API fails
    }
    set({ session: null, role: null, error: null });
  },

  initialize: async () => {
    if (get().initialized) return;
    set({ isLoading: true });
    try {
      const data = await apiFetch<{ user: { id: number; email: string; role: string; residentId: number | null; fullName?: string; unitNumber?: string | null } }>(
        "/api/auth/me"
      );
      const role = data.user.role as Role;
      set({
        session: {
          user: {
            id: data.user.id,
            email: data.user.email,
            role,
            residentId: data.user.residentId,
            fullName: data.user.fullName || data.user.email.split("@")[0],
            unitNumber: data.user.unitNumber || null,
          },
        },
        role,
        isLoading: false,
        initialized: true,
      });
    } catch {
      set({ session: null, role: null, isLoading: false, initialized: true });
    }
  },

  clearError: () => set({ error: null }),
}));
