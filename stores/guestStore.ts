import { create } from "zustand";
import { isBefore, isAfter, isToday, startOfDay } from "date-fns";
import { apiFetch } from "@/lib/api";

export interface Guest {
  id: number;
  name: string;
  unit: string;
  plate: string;
  vehicle: string;
  email: string;
  startDate: Date;
  endDate: Date;
  status: "approved" | "active" | "pending" | "needs_payment" | "paid" | "cancelled" | "expired";
  amountDue: number;
  amountPaid: number;
  billableNights: number;
  freePassUsed: number;
  guestFreePassNights: number;
}

interface ApiStay {
  id: number;
  unit_id: number;
  start_date: string;
  end_date: string;
  vehicle_plate: string;
  vehicle_desc: string;
  status: string;
  unit_number: string;
  guest_name: string;
  guest_email: string;
  amount_cents?: number;
  passes_applied?: number;
  guest_free_pass_nights?: number;
  billable_nights?: number;
}

function mapStay(raw: ApiStay): Guest {
  const startDate = new Date(raw.start_date);
  const endDate = new Date(raw.end_date);
  const now = startOfDay(new Date());

  let status = raw.status.toLowerCase().replace(/ /g, "_") as Guest["status"];
  if (status === "approved") {
    if (isBefore(endDate, now) && !isToday(endDate)) {
      status = "expired";
    } else if ((isBefore(startDate, now) || isToday(startDate)) && (isAfter(endDate, now) || isToday(endDate))) {
      status = "active";
    }
  }

  return {
    id: raw.id,
    name: raw.guest_name || "",
    unit: raw.unit_number || "",
    plate: raw.vehicle_plate || "",
    vehicle: raw.vehicle_desc || "",
    email: raw.guest_email || "",
    startDate,
    endDate,
    status,
    amountDue: (raw.amount_cents || 0) / 100,
    amountPaid: status === "paid" ? (raw.amount_cents || 0) / 100 : 0,
    billableNights: raw.billable_nights || 0,
    freePassUsed: raw.passes_applied || 0,
    guestFreePassNights: raw.guest_free_pass_nights || 0,
  };
}

interface FreePass {
  /** Combined total: monthly accumulated + bonus passes */
  total: number;
  used: number;
  remaining: number;
  /** Purchased bonus passes */
  bonusPasses: number;
  /** Monthly accumulated passes */
  monthlyTotal: number;
  monthlyUsed: number;
  monthlyRemaining: number;
}

interface PaginatedStaysResponse {
  stays: ApiStay[];
  hasMore: boolean;
  nextCursor: number | null;
}

interface GuestState {
  guests: Guest[];
  isLoading: boolean;
  error: string | null;
  search: string;
  unitId: number | null;
  unitNumber: string | null;
  freePass: FreePass | null;
  _lastResidentId: number | undefined;
  _queryParams: string;
  hasMore: boolean;
  nextCursor: number | null;
  isLoadingMore: boolean;

  setSearch: (search: string) => void;
  fetchGuests: (residentId?: number, queryParams?: string) => Promise<void>;
  fetchMoreGuests: () => Promise<void>;
  addGuest: (data: { name: string; email?: string; plate: string; vehicle?: string; startDate: string; endDate: string }) => Promise<{ id: number; status: string; billing: unknown }>;
  updateGuest: (id: number, data: { name?: string; plate?: string; vehicle?: string; startDate?: string; endDate?: string }) => Promise<void>;
  deleteGuest: (id: number) => Promise<void>;
  approveGuest: (id: number) => Promise<{ id: number; status: string; billing: unknown }>;
  fetchFreePass: (residentId: number) => Promise<void>;
  getStats: () => { upcoming: number; active: number; needsPayment: number; total: number };
  clearError: () => void;
}

export const useGuestStore = create<GuestState>((set, get) => ({
  guests: [],
  isLoading: false,
  error: null,
  search: "",
  unitId: null,
  unitNumber: null,
  freePass: null,
  _lastResidentId: undefined,
  _queryParams: "",
  hasMore: false,
  nextCursor: null,
  isLoadingMore: false,

  setSearch: (search) => set({ search }),
  clearError: () => set({ error: null }),

  fetchGuests: async (residentId, queryParams) => {
    set({ isLoading: true, error: null, _lastResidentId: residentId, _queryParams: queryParams || "", hasMore: false, nextCursor: null });
    try {
      let data: PaginatedStaysResponse & { residentId?: number; unitId?: number };
      if (residentId) {
        data = await apiFetch<PaginatedStaysResponse & { residentId: number; unitId: number }>(
          `/api/residents/${residentId}/guest-stays${queryParams ? `?${queryParams}` : ""}`
        );
        set({ unitId: data.unitId });
      } else {
        data = await apiFetch<PaginatedStaysResponse>(`/api/guest-stays${queryParams ? `?${queryParams}` : ""}`);
      }
      set({
        guests: data.stays.map(mapStay),
        isLoading: false,
        hasMore: data.hasMore ?? false,
        nextCursor: data.nextCursor ?? null,
      });
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : "Failed to fetch guests" });
    }
  },

  fetchMoreGuests: async () => {
    const { nextCursor, hasMore, isLoadingMore, _lastResidentId, _queryParams } = get();
    if (!hasMore || isLoadingMore || !nextCursor) return;

    set({ isLoadingMore: true });
    try {
      const params = new URLSearchParams(_queryParams || "");
      params.set("cursor", String(nextCursor));
      params.set("limit", "50");
      const paramStr = params.toString();
      let data: PaginatedStaysResponse;
      if (_lastResidentId) {
        data = await apiFetch<PaginatedStaysResponse>(
          `/api/residents/${_lastResidentId}/guest-stays?${paramStr}`
        );
      } else {
        data = await apiFetch<PaginatedStaysResponse>(`/api/guest-stays?${paramStr}`);
      }
      set((s) => ({
        guests: [...s.guests, ...data.stays.map(mapStay)],
        isLoadingMore: false,
        hasMore: data.hasMore ?? false,
        nextCursor: data.nextCursor ?? null,
      }));
    } catch (err) {
      set({ isLoadingMore: false, error: err instanceof Error ? err.message : "Failed to load more" });
    }
  },

  addGuest: async (data) => {
    const { unitId, unitNumber } = get();
    const body: Record<string, unknown> = {
      guest: { fullName: data.name, email: data.email || undefined },
      vehicle: { plate: data.plate, desc: data.vehicle || undefined },
      stay: { startDate: data.startDate, endDate: data.endDate },
    };
    if (unitId) body.unitId = unitId;
    else if (unitNumber) body.unitNumber = unitNumber;
    body.autoApprove = true;

    const result = await apiFetch<{ id: number; status: string; billing: unknown }>("/api/guest-stays", {
      method: "POST",
      body: JSON.stringify(body),
    });
    // Re-fetch to get server-calculated billing
    await get().fetchGuests(get()._lastResidentId);
    return result;
  },

  updateGuest: async (id, data) => {
    const body: Record<string, string> = {};
    if (data.name) body.guestName = data.name;
    if (data.plate) body.vehiclePlate = data.plate;
    if (data.vehicle) body.vehicleDesc = data.vehicle;
    if (data.startDate) body.startDate = data.startDate;
    if (data.endDate) body.endDate = data.endDate;

    await apiFetch(`/api/guest-stays/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    await get().fetchGuests(get()._lastResidentId);
  },

  deleteGuest: async (id) => {
    await apiFetch(`/api/guest-stays/${id}`, { method: "DELETE" });
    set((s) => ({ guests: s.guests.filter((g) => g.id !== id) }));
  },

  approveGuest: async (id) => {
    const result = await apiFetch<{ id: number; status: string; billing: unknown }>(
      `/api/guest-stays/${id}/approve`,
      { method: "POST" }
    );
    await get().fetchGuests(get()._lastResidentId);
    return result;
  },

  fetchFreePass: async (residentId) => {
    try {
      const data = await apiFetch<{
        bonusPasses: number;
        monthlyFreeTotal: number;
        monthlyFreeUsed: number;
        monthlyFreeRemaining: number;
      }>(`/api/residents/${residentId}/pass-balance`);
      const monthlyRemaining = data.monthlyFreeRemaining;
      const bonus = data.bonusPasses;
      const combinedTotal = data.monthlyFreeTotal + bonus;
      const combinedUsed = data.monthlyFreeUsed;
      const combinedRemaining = monthlyRemaining + bonus;
      set({
        freePass: {
          total: combinedTotal,
          used: combinedUsed,
          remaining: combinedRemaining,
          bonusPasses: bonus,
          monthlyTotal: data.monthlyFreeTotal,
          monthlyUsed: data.monthlyFreeUsed,
          monthlyRemaining,
        },
      });
    } catch {
      // Free pass info not critical
    }
  },

  getStats: () => {
    const guests = get().guests;
    return {
      upcoming: guests.filter((g) => g.status === "approved").length,
      active: guests.filter((g) => g.status === "active").length,
      needsPayment: guests.filter((g) => g.status === "needs_payment").length,
      total: guests.length,
    };
  },
}));
