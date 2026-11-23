'use client';

import { useSyncExternalStore } from 'react';
import type { RequestLogEntry, Session, TrackedTrip } from './types';

// Kho trạng thái nhỏ dùng chung cho toàn ứng dụng: các phiên đăng nhập, phiên đang dùng,
// nhật ký request và danh sách chuyến đã tạo. Lưu vào localStorage để giữ lại khi tải lại trang.

interface State {
  sessions: Session[];
  activeSessionId: string | null;
  logs: RequestLogEntry[];
  trips: TrackedTrip[];
}

const STORAGE_KEY = 'rideflow-console:v1';
const MAX_LOGS = 300;

const emptyState: State = { sessions: [], activeSessionId: null, logs: [], trips: [] };
let state: State = emptyState;
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate() {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<State>;
      const now = Date.now();
      state = {
        sessions: (parsed.sessions ?? []).filter(s => s.expiresAt > now),
        activeSessionId: parsed.activeSessionId ?? null,
        logs: parsed.logs ?? [],
        trips: parsed.trips ?? [],
      };
      if (state.activeSessionId && !state.sessions.some(s => s.id === state.activeSessionId)) {
        state.activeSessionId = state.sessions[0]?.id ?? null;
      }
    }
  } catch {
    state = emptyState;
  }
}

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Trình duyệt chặn localStorage: ứng dụng vẫn chạy, chỉ không giữ dữ liệu khi tải lại.
  }
}

function setState(update: (prev: State) => State) {
  state = update(state);
  persist();
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  hydrate();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  hydrate();
  return state;
}

function getServerSnapshot() {
  return emptyState;
}

export function useAppState<T>(selector: (s: State) => T): T {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return selector(snapshot);
}

export function getState(): State {
  hydrate();
  return state;
}

export const actions = {
  addSession(session: Session) {
    setState(prev => ({
      ...prev,
      sessions: [session, ...prev.sessions.filter(s => s.email !== session.email)],
      activeSessionId: session.id,
    }));
  },
  removeSession(id: string) {
    setState(prev => {
      const sessions = prev.sessions.filter(s => s.id !== id);
      const activeSessionId = prev.activeSessionId === id ? sessions[0]?.id ?? null : prev.activeSessionId;
      return { ...prev, sessions, activeSessionId };
    });
  },
  setActiveSession(id: string) {
    setState(prev => ({ ...prev, activeSessionId: id }));
  },
  addLog(entry: RequestLogEntry) {
    setState(prev => ({ ...prev, logs: [entry, ...prev.logs].slice(0, MAX_LOGS) }));
  },
  clearLogs() {
    setState(prev => ({ ...prev, logs: [] }));
  },
  trackTrip(trip: TrackedTrip) {
    setState(prev => ({ ...prev, trips: [trip, ...prev.trips.filter(t => t.tripId !== trip.tripId)].slice(0, 50) }));
  },
  forgetTrip(tripId: string) {
    setState(prev => ({ ...prev, trips: prev.trips.filter(t => t.tripId !== tripId) }));
  },
};

export function useActiveSession(): Session | null {
  return useAppState(s => s.sessions.find(x => x.id === s.activeSessionId) ?? null);
}
