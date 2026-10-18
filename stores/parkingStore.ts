import { create } from "zustand";
import { isBefore, isToday, startOfDay } from "date-fns";
import { apiFetch } from "@/lib/api";

export type VehicleStatus = "active" | "expired" | "unauthorized";

export interface Vehicle {
  id: number;
  name: string;
  unit: string;
  plate: string;
  vehicle: string;
  startDate: Date | null;
  endDate: Date | null;
  status: VehicleStatus;
  notes?: string;
  photoUrl?: string;
  location?: string;
  reportedAt?: Date;
  _isUnauthorized?: boolean;
}

interface ApiStay {
  id: number;
  unit_number: string;
  start_date: string;
  end_date: string;
  vehicle_plate: string;
  vehicle_desc: string;
  status: string;
  guest_name: string;
}

interface ApiUnauthorized {
  id: number;
  plate_number: string;
  vehicle_make: string | null;
  vehicle_color: string | null;
  violation_note: string | null;
  image_url: string | null;
  spotted_date: string;
  spotted_location: string | null;
  recommended_action: string;
  resolved: boolean;
  created_at: string;
}

interface PaginatedStaysResponse {
  stays: ApiStay[];
  hasMore: boolean;
  nextCursor: number | null;
}

interface PaginatedUnauthorizedResponse {
  vehicles: ApiUnauthorized[];
  hasMore: boolean;
  nextCursor: number | null;
}

function mapGuestToVehicle(raw: ApiStay): Vehicle | null {
  const startDate = new Date(raw.start_date);
  const endDate = new Date(raw.end_date);
  const now = startOfDay(new Date());
  const dbStatus = raw.status.toLowerCase();

  if (dbStatus === "cancelled" || dbStatus === "pending") return null;

  const status: VehicleStatus =
    isBefore(endDate, now) && !isToday(endDate) ? "expired" : "active";

  return {
    id: raw.id,
    name: raw.guest_name || "Guest",
    unit: raw.unit_number || "",
    plate: raw.vehicle_plate || "",
    vehicle: raw.vehicle_desc || "",
    startDate,
    endDate,
    status,
  };
}

function mapUnauthorized(raw: ApiUnauthorized): Vehicle {
  const vehicleParts = [raw.vehicle_color, raw.vehicle_make].filter(Boolean);
  return {
    id: raw.id,
    name: "Unknown",
    unit: "—",
    plate: raw.plate_number,
    vehicle: vehicleParts.join(" ") || "Unknown vehicle",
    startDate: null,
    endDate: null,
    status: "unauthorized",
    notes: raw.violation_note || undefined,
    photoUrl: raw.image_url || undefined,
    location: raw.spotted_location || undefined,
    reportedAt: new Date(raw.spotted_date),
    _isUnauthorized: true,
  };
}

export type TabKey = "all" | "active" | "expired" | "unauthorized";

interface CursorState {
  hasMore: boolean;
  nextCursor: number | null;
}

interface ParkingState {
  vehicles: Vehicle[];
  isLoading: boolean;
  error: string | null;
  search: string;
  activeTab: TabKey;
  hasMore: boolean;
  isLoadingMore: boolean;
  _staysPag: CursorState;
  _unauthorizedPag: CursorState;

  setSearch: (search: string) => void;
  setActiveTab: (tab: TabKey) => void;
  fetchVehicles: () => Promise<void>;
  fetchMoreVehicles: () => Promise<void>;
  addUnauthorized: (data: {
    plate: string;
    vehicleMake?: string;
    vehicleColor?: string;
    notes?: string;
    location?: string;
    imageUrl?: string;
  }) => Promise<void>;
  resolveVehicle: (id: number) => Promise<void>;
  removeVehicle: (id: number) => Promise<void>;
  getStats: () => { active: number; expired: number; unauthorized: number };
  getFilteredVehicles: () => Vehicle[];
  clearError: () => void;
}

const EMPTY_PAG: CursorState = { hasMore: false, nextCursor: null };

export const useParkingStore = create<ParkingState>((set, get) => ({
  vehicles: [],
  isLoading: false,
  error: null,
  search: "",
  activeTab: "all",
  hasMore: false,
  isLoadingMore: false,
  _staysPag: EMPTY_PAG,
  _unauthorizedPag: EMPTY_PAG,

  setSearch: (search) => set({ search }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  clearError: () => set({ error: null }),

  fetchVehicles: async () => {
    set({ isLoading: true, error: null, _staysPag: EMPTY_PAG, _unauthorizedPag: EMPTY_PAG, hasMore: false });
    try {
      const [staysData, unauthorizedData] = await Promise.all([
        apiFetch<PaginatedStaysResponse>("/api/guest-stays"),
        apiFetch<PaginatedUnauthorizedResponse>("/api/unauthorized-vehicles"),
      ]);

      const guestVehicles = staysData.stays
        .map(mapGuestToVehicle)
        .filter((v): v is Vehicle => v !== null);
      const unauthorizedVehicles = unauthorizedData.vehicles
        .filter((v) => !v.resolved)
        .map(mapUnauthorized);

      const sp: CursorState = { hasMore: staysData.hasMore ?? false, nextCursor: staysData.nextCursor ?? null };
      const up: CursorState = { hasMore: unauthorizedData.hasMore ?? false, nextCursor: unauthorizedData.nextCursor ?? null };

      set({
        vehicles: [...guestVehicles, ...unauthorizedVehicles],
        isLoading: false,
        _staysPag: sp,
        _unauthorizedPag: up,
        hasMore: sp.hasMore || up.hasMore,
      });
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : "Failed to fetch vehicles" });
    }
  },

  fetchMoreVehicles: async () => {
    const { _staysPag, _unauthorizedPag, isLoadingMore } = get();
    if (isLoadingMore) return;
    if (!_staysPag.hasMore && !_unauthorizedPag.hasMore) return;

    set({ isLoadingMore: true });
    try {
      let newGuestVehicles: Vehicle[] = [];
      let newUnauthorizedVehicles: Vehicle[] = [];
      let newSp = _staysPag;
      let newUp = _unauthorizedPag;

      const promises: Promise<void>[] = [];

      if (_staysPag.hasMore && _staysPag.nextCursor) {
        promises.push(
          apiFetch<PaginatedStaysResponse>(
            `/api/guest-stays?cursor=${_staysPag.nextCursor}&limit=50`
          ).then((data) => {
            newGuestVehicles = data.stays.map(mapGuestToVehicle).filter((v): v is Vehicle => v !== null);
            newSp = { hasMore: data.hasMore ?? false, nextCursor: data.nextCursor ?? null };
          })
        );
      }

      if (_unauthorizedPag.hasMore && _unauthorizedPag.nextCursor) {
        promises.push(
          apiFetch<PaginatedUnauthorizedResponse>(
            `/api/unauthorized-vehicles?cursor=${_unauthorizedPag.nextCursor}&limit=50`
          ).then((data) => {
            newUnauthorizedVehicles = data.vehicles.filter((v) => !v.resolved).map(mapUnauthorized);
            newUp = { hasMore: data.hasMore ?? false, nextCursor: data.nextCursor ?? null };
          })
        );
      }

      await Promise.all(promises);

      set((s) => ({
        vehicles: [...s.vehicles, ...newGuestVehicles, ...newUnauthorizedVehicles],
        isLoadingMore: false,
        _staysPag: newSp,
        _unauthorizedPag: newUp,
        hasMore: newSp.hasMore || newUp.hasMore,
      }));
    } catch (err) {
      set({ isLoadingMore: false, error: err instanceof Error ? err.message : "Failed to load more" });
    }
  },

  addUnauthorized: async (data) => {
    await apiFetch("/api/unauthorized-vehicles", {
      method: "POST",
      body: JSON.stringify({
        plate_number: data.plate,
        vehicle_make: data.vehicleMake,
        vehicle_color: data.vehicleColor,
        violation_note: data.notes,
        spotted_location: data.location,
        image_url: data.imageUrl,
        recommended_action: "warn",
      }),
    });
    await get().fetchVehicles();
  },

  resolveVehicle: async (id) => {
    try {
      await apiFetch(`/api/unauthorized-vehicles/${id}/resolve`, { method: "PATCH" });
      set((s) => ({ vehicles: s.vehicles.filter((v) => !(v._isUnauthorized && v.id === id)) }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to resolve vehicle" });
      throw err;
    }
  },

  removeVehicle: async (id) => {
    try {
      await apiFetch(`/api/unauthorized-vehicles/${id}`, { method: "DELETE" });
      set((s) => ({ vehicles: s.vehicles.filter((v) => !(v._isUnauthorized && v.id === id)) }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to delete vehicle" });
      throw err;
    }
  },

  getStats: () => {
    const vehicles = get().vehicles;
    return {
      active: vehicles.filter((v) => v.status === "active").length,
      expired: vehicles.filter((v) => v.status === "expired").length,
      unauthorized: vehicles.filter((v) => v.status === "unauthorized").length,
    };
  },

  getFilteredVehicles: () => {
    const { vehicles, search, activeTab } = get();
    const q = search.toLowerCase();
    return vehicles
      .filter((v) => activeTab === "all" || v.status === activeTab)
      .filter(
        (v) =>
          !q ||
          v.name.toLowerCase().includes(q) ||
          v.plate.toLowerCase().includes(q) ||
          v.vehicle.toLowerCase().includes(q)
      );
  },
}));
