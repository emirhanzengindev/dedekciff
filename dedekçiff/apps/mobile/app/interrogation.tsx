import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown, LinearTransition } from "react-native-reanimated";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { askQuestion, getSession, sendInteraction, DEFAULT_CASE_ID, type SessionDto } from "../src/services/api";
import { getCaseProfile, type IconName } from "../src/services/caseProfiles";
import { useSessionStore } from "../src/stores/sessionStore";
import { useConversationStore, type ConversationLine } from "../src/stores/conversationStore";
import { colors } from "../src/theme/colors";
const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  emptyState: {
    alignItems: "center",
    padding: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
    color: colors.text,
  },
  muted: {
    color: colors.muted,
    fontSize: 14,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  primaryText: {
    color: colors.text,
    fontWeight: "600",
    fontSize: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  backButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  headerCopy: {
    flex: 1,
    marginLeft: 12,
  },
  eyebrow: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  headerTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "600",
  },
  statPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.panelAlt,
  },
  statPillText: {
    color: colors.muted,
    fontSize: 13,
  },
  feedbackBanner: {
    backgroundColor: colors.ok,
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  feedbackText: {
    color: colors.background,
    fontSize: 14,
  },
  scroll: {
    flex: 1,
  },
  characterChoices: {
    gap: 12,
  },
  characterChoice: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    backgroundColor: colors.background,
  },
  characterChoiceActive: {
    borderColor: colors.accent,
    backgroundColor: colors.panel,
  },
  characterChoiceText: {
    color: colors.text,
    fontWeight: "600",
  },
  characterChoiceTextActive: {
    color: colors.accent,
  },
  characterRoleTag: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: colors.line,
    color: colors.muted,
    fontSize: 12,
  },
  characterRoleTagActive: {
    backgroundColor: colors.accent,
    color: colors.background,
  },
});


const questionSchema = z.object({ question: z.string().min(2) });
type QuestionForm = z.infer<typeof questionSchema>;

/**
 * Relationship labels come strictly from neutral case-file roles. Verdict
 * spoilers (suspect / ruled-out / guilty / innocent) are never shown; unknown
 * roles fall back to a neutral "can be spoken with" label.
 */
const characterRelationshipLabels: Record<string, string> = {
  complainant_victim: "Şikâyetçi",
  second_victim: "İkinci şikâyetçi",
  witness: "Görgü tanığı",
  friend_witness: "Tanık",
  investigator: "Soruşturma ekibi",
  prosecutor: "Savcılık",
  victim: "Mağdur"
};

function characterRelationshipLabel(role: string) {
  return characterRelationshipLabels[role] ?? "Görüşülebilir kişi";
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function toTurkishError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const known: Record<string, string> = {
    character_locked_or_unknown: "Bu kişiyle görüşmek için önce ilgili delili bul.",
    interrogation_not_started: "Önce sorguyu başlatmalısın.",
    interrogation_topics_incomplete: "Sorguyu bitirmek için en az iki farklı başlıkta soru sor.",
    unauthorized: "Oturum doğrulanamadı. Bağlantıyı ve hesabı kontrol et.",
    api_error: "Sunucuya ulaşılamadı. Bağlantıyı kontrol edip yeniden dene."
  };
  return known[code] ?? "İşlem tamamlanamadı. Bağlantıyı kontrol edip yeniden dene.";
}

export default function InterrogationScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { sessionId, hasHydrated } = useSessionStore();
  const { lines, appendLines, beginSession } = useConversationStore();
  const [activeCharacterId, setActiveCharacterId] = useState<string>("");
  const [feedback, setFeedback] = useState<string>();
  const [clockMs, setClockMs] = useState(Date.now());

  const questionForm = useForm<QuestionForm>({
    resolver: zodResolver(questionSchema),
    defaultValues: { question: "" }
  });

  const sessionQuery = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSession(sessionId ?? ""),
    enabled: Boolean(sessionId && hasHydrated)
  });
  const session = sessionQuery.data;
  const profile = getCaseProfile(session?.caseId ?? DEFAULT_CASE_ID);

  useEffect(() => {
    if (sessionId) beginSession(sessionId);
  }, [sessionId, beginSession]);

  useEffect(() => {
    const interval = setInterval(() => setClockMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!feedback) return;
    const timeout = setTimeout(() => setFeedback(undefined), 4500);
    return () => clearTimeout(timeout);
  }, [feedback]);

  const applySession = (next: SessionDto) => {
    queryClient.setQueryData(["session", next.id], next);
    void queryClient.invalidateQueries({ queryKey: ["evidence", next.id] });
    void queryClient.invalidateQueries({ queryKey: ["strength", next.id] });
  };


  const interactionMutation = useMutation({
    mutationFn: (payload: { type: string; characterId?: string }) => sendInteraction(sessionId ?? "", payload),
    onSuccess: (result) => {
      applySession(result.session);
      setFeedback("Sorgu durumu güncellendi.");
    },
    onError: (error) => setFeedback(toTurkishError(error))
  });

  const questionMutation = useMutation({
    mutationFn: (payload: { characterId: string; question: string; topic?: string }) =>
      askQuestion(sessionId ?? "", payload),
    onSuccess: (
      result: { answer: string; status: string; supportingEvidenceIds: string[]; newlyUnlockedEvidenceIds: string[]; session: SessionDto },
      payload
    ) => {
      applySession(result.session);
      appendLines([
        { characterId: payload.characterId, role: "player", text: payload.question },
        { characterId: payload.characterId, role: "character", text: result.answer, evidenceIds: result.supportingEvidenceIds }
      ]);
      const opened = result.newlyUnlockedEvidenceIds.map((id) => profile.evidenceNames[id] ?? id);
      setFeedback(opened.length ? `Görüşme kaydedildi. Yeni delil: ${opened.join(", ")}.` : "Görüşme yanıtı kaydedildi.");
      questionForm.reset();
    },
    onError: (error) => setFeedback(toTurkishError(error))
  });
  const busy = interactionMutation.isPending || questionMutation.isPending;



  const activeCharacter = useMemo(
    () => session?.characters.find((character) => character.id === activeCharacterId) ?? session?.characters[0],
    [activeCharacterId, session?.characters]
  );
  const suspectCharacterId = session?.suspectCharacterId || profile.suspect.characterId;
  const suspectInterrogation = session?.interrogations.find((interrogation) => interrogation.characterId === suspectCharacterId);
  const hasWitnessCorroboration = profile.suspect.corroboration
    ? session?.completedInterviews.some(
        (interview) =>
          interview.characterId === profile.suspect.corroboration?.characterId &&
          interview.topic === profile.suspect.corroboration?.topic
      ) ?? false
    : false;
  const suspectTopics = new Set((suspectInterrogation?.questionTopics ?? []).filter((topic) => topic in profile.suspectTopicLabels));
  const suspectAvailable = session?.characters.some((character) => character.id === suspectCharacterId) ?? false;
  const suspectTargetMs = profile.suspect.targetMinutes * 60_000;
  const suspectTimeRemainingMs = suspectInterrogation
    ? Math.max(0, suspectTargetMs - (clockMs - Date.parse(suspectInterrogation.startedAt)))
    : suspectTargetMs;
  const unlockedEvidence = new Set(session?.unlockedEvidenceIds ?? []);
  const hasEvidence = (evidenceId: string) => unlockedEvidence.has(evidenceId);
  const suspectInterviewDone = Boolean(profile.suspect.doneEvidenceId) && hasEvidence(profile.suspect.doneEvidenceId);
  const suspectCanFinish = Boolean(
    suspectInterrogation &&
    suspectTopics.size >= profile.suspect.minimumTopics &&
    profile.suspect.finishEvidenceIds.every((id) => hasEvidence(id)) &&
    !suspectInterviewDone
  );

  if (!hasHydrated) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.emptyState}><Text style={styles.muted}>Dosya oturumu açılıyor...</Text></View>
      </SafeAreaView>
    );
  }

  if (!sessionId || !session) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="account-lock-outline" color={colors.muted} size={30} />
          <Text style={styles.sectionTitle}>Aktif dosya yok</Text>
          <Text style={styles.muted}>Sorgu ekranını kullanmak için önce bir soruşturma dosyası aç.</Text>
          <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={() => router.back()}>
            <MaterialCommunityIcons name="arrow-left" color={colors.background} size={18} />
            <Text style={styles.primaryText}>Geri dön</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Soruşturmaya dön" style={styles.backButton} onPress={() => router.back()}>
            <MaterialCommunityIcons name="arrow-left" color={colors.text} size={20} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>{profile.workspaceEyebrow}</Text>
            <Text numberOfLines={1} style={styles.headerTitle}>Sorgu</Text>
          </View>
          <View style={styles.statPill}><Text style={styles.statPillText}>{session.evidenceCount} delil</Text></View>
        </View>

        {feedback ? (
          <View accessibilityRole="alert" style={styles.feedbackBanner}>
            <MaterialCommunityIcons name="text-box-check-outline" color={colors.ok} size={18} />
            <Text style={styles.feedbackText}>{feedback}</Text>
          </View>
        ) : null}

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionTitle}>Görüşülebilir kişiler</Text>
          <Text style={styles.muted}>Seçim yalnızca konuşmayı açar; sorgu tamamlanması ayrı bir işlemdir.</Text>
          <View style={styles.characterChoices}>
            {session.characters.map((character) => (
              <Pressable
                key={character.id}
                onPress={() => setActiveCharacterId(character.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: activeCharacterId === character.id }}
                style={[styles.characterChoice, activeCharacterId === character.id && styles.characterChoiceActive]}
              >
                <Text style={[styles.characterChoiceText, activeCharacterId === character.id && styles.characterChoiceTextActive]}>
                  {character.name}
                </Text>
                <Text style={[styles.characterRoleTag, activeCharacterId === character.id && styles.characterRoleTagActive]}>
                  {characterRelationshipLabel(character.role)}
                </Text>
              </Pressable>
            ))}
          </View>


        </ScrollView>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );

}