import { create } from "zustand";

export type ConversationLine = {
  characterId: string;
  role: "player" | "character";
  text: string;
  evidenceIds?: string[];
};

interface ConversationStore {
  sessionId?: string;
  lines: ConversationLine[];
  /** Starts (or resumes) a conversation buffer bound to one session. */
  beginSession: (sessionId: string) => void;
  appendLines: (lines: ConversationLine[]) => void;
  reset: () => void;
}

/**
 * Interrogation chat history lives outside the screen so navigating between
 * the workspace and the standalone interrogation route never loses lines.
 */
export const useConversationStore = create<ConversationStore>()((set, get) => ({
  lines: [],
  beginSession: (sessionId) => {
    if (get().sessionId === sessionId) return;
    set({ sessionId, lines: [] });
  },
  appendLines: (lines) => set((state) => ({ lines: [...state.lines, ...lines] })),
  reset: () => set({ sessionId: undefined, lines: [] })
}));
