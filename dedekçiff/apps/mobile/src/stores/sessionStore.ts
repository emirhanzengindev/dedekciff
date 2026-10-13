import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createJSONStorage, persist } from "zustand/middleware";

interface SessionStore {
  sessionId?: string;
  hasHydrated: boolean;
  setSessionId: (sessionId: string) => void;
  clearSessionId: () => void;
  setHasHydrated: (hasHydrated: boolean) => void;
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      hasHydrated: false,
      setSessionId: (sessionId) => set({ sessionId }),
      clearSessionId: () => set({ sessionId: undefined }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated })
    }),
    {
      name: "case-001-session",
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true)
    }
  )
);
