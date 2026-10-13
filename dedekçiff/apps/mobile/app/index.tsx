import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect } from "react";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { CaseMap } from "../src/components/CaseMap";
import { AuthScreen } from "../src/components/AuthScreen";
import {
  askQuestion,
  createSession,
  getSession,
  getCaseStrength,
  getEvidence,
  listCases,
  sendInteraction,
  submitProsecution,
  DEFAULT_CASE_ID,
  type CaseSummaryDto,
  type SessionDto
} from "../src/services/api";
import { getCaseProfile, type ActionContext, type ActionSpec, type CaseProfile } from "../src/services/caseProfiles";
import { useSessionStore } from "../src/stores/sessionStore";
import { supabase } from "../src/services/supabase";
import { colors } from "../src/theme/colors";
import type { Session as SupabaseSession } from "@supabase/supabase-js";

const questionSchema = z.object({ question: z.string().min(2) });
type QuestionForm = z.infer<typeof questionSchema>;
type WorkspaceTab = "map" | "investigation" | "forensics" | "prosecution";
type InteractionPayload = { type: string; locationId?: string; characterId?: string };
type ConversationLine = { characterId: string; role: "player" | "character"; text: string; evidenceIds?: string[] };

export default function InvestigationScreen() {
  const queryClient = useQueryClient();
  const { sessionId, setSessionId, clearSessionId, hasHydrated } = useSessionStore();
  const [session, setSession] = useState<SessionDto | undefined>();
  const [authSession, setAuthSession] = useState<SupabaseSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<string | undefined>();
  const [activeCharacterId, setActiveCharacterId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("map");
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [feedback, setFeedback] = useState<string>();
  const [conversation, setConversation] = useState<ConversationLine[]>([]);
  const [clockMs, setClockMs] = useState(Date.now());
  const [prosecutionResult, setProsecutionResult] = useState<{ outcome: string; score: number; reasons: string[] }>();

  const questionForm = useForm<QuestionForm>({
    resolver: zodResolver(questionSchema),
    defaultValues: { question: "" }
  });

  const availableCasesQuery = useQuery({
    queryKey: ["cases"],
    queryFn: listCases,
    enabled: !session
  });

  const profile: CaseProfile = getCaseProfile(session?.caseId ?? selectedCaseId ?? DEFAULT_CASE_ID);

  const startMutation = useMutation({
    mutationFn: (caseId: string) => createSession(caseId),
    onSuccess: (created) => {
      setSessionId(created.id);
      setSession(created);
      setActiveTab("map");
      setSelectedLocationId(created.locations[0]?.id ?? "");
      setActiveCharacterId(created.characters[0]?.id ?? "");
      setConversation([]);
      setProsecutionResult(undefined);
      setFeedback(getCaseProfile(created.caseId).startFeedback);
    },
    onError: (error) => setFeedback(toTurkishError(error))
  });
  const interactionMutation = useMutation({
    mutationFn: (payload: InteractionPayload) => sendInteraction(sessionId ?? "", payload),
    onSuccess: (result, payload) => {
      const previousLocationIds = new Set(session?.locations.map((location) => location.id) ?? []);
      setSession(result.session);
      if (payload.type === "visit_location" && payload.locationId) setSelectedLocationId(payload.locationId);
      const newLocations = result.session.locations.filter((location) => !previousLocationIds.has(location.id));
      const unlocked = result.newlyUnlockedEvidenceIds.map((id) => profile.evidenceNames[id] ?? id);
      const details = [
        unlocked.length ? `Yeni delil: ${unlocked.join(", ")}.` : "",
        newLocations.length ? `Haritada yeni konum: ${newLocations.map((location) => location.name).join(", ")}.` : ""
      ].filter(Boolean);
      setFeedback(details.join(" ") || (payload.type === "visit_location" ? "Konum açıldı. Çevredeki ayrıntıları incele." : "İşlem tamamlandı; bu adımda yeni delil çıkmadı."));
      void queryClient.invalidateQueries({ queryKey: ["evidence", sessionId] });
      void queryClient.invalidateQueries({ queryKey: ["strength", sessionId] });
    },
    onError: (error) => setFeedback(toTurkishError(error))
  });
  const questionMutation = useMutation({
    mutationFn: (payload: { characterId: string; question: string; topic?: string }) =>
      askQuestion(sessionId ?? "", payload),
    onSuccess: (result: { answer: string; status: string; supportingEvidenceIds: string[]; newlyUnlockedEvidenceIds: string[]; session: SessionDto }, payload) => {
      setSession(result.session);
      setConversation((current) => [
        ...current,
        { characterId: payload.characterId, role: "player", text: payload.question },
        { characterId: payload.characterId, role: "character", text: result.answer, evidenceIds: result.supportingEvidenceIds }
      ]);
      const opened = result.newlyUnlockedEvidenceIds.map((id) => profile.evidenceNames[id] ?? id);
      setFeedback(opened.length ? `Görüşme kaydedildi. Yeni delil: ${opened.join(", ")}.` : "Görüşme yanıtı kaydedildi.");
      questionForm.reset();
      void queryClient.invalidateQueries({ queryKey: ["evidence", sessionId] });
      void queryClient.invalidateQueries({ queryKey: ["strength", sessionId] });
    },
    onError: (error) => setFeedback(toTurkishError(error))
  });
  const prosecutionMutation = useMutation({
    mutationFn: () =>
      submitProsecution(sessionId ?? "", {
        suspectId: session?.suspectCharacterId || profile.prosecutionDefaults.suspectId,
        crimeSummary: profile.prosecutionDefaults.crimeSummary,
        evidenceIds: session?.unlockedEvidenceIds ?? [],
        contradictionAnalysis: profile.prosecutionDefaults.contradictionAnalysis,
        gaps: profile.prosecutionDefaults.gaps
      }),
    onSuccess: (result) => {
      setProsecutionResult(result);
      setFeedback("Savcılık dosyası değerlendirildi.");
    },
    onError: (error) => setFeedback(toTurkishError(error))
  });

  useEffect(() => {
    const interval = setInterval(() => setClockMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!feedback) return;
    const timeout = setTimeout(() => setFeedback(undefined), 4500);
    return () => clearTimeout(timeout);
  }, [feedback]);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) {
        setAuthSession(nextSession);
        setAuthReady(true);
      }
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setAuthSession(data.session);
        setAuthReady(true);
      }
    }).catch(() => {
      if (mounted) setAuthReady(true);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const savedSessionQuery = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSession(sessionId ?? ""),
    enabled: Boolean(sessionId && hasHydrated && authReady && (!supabase || authSession))
  });

  useEffect(() => {
    if (savedSessionQuery.data) setSession(savedSessionQuery.data);
  }, [savedSessionQuery.data]);

  const evidenceQuery = useQuery({
    queryKey: ["evidence", sessionId, session?.unlockedEvidenceIds],
    queryFn: () => getEvidence(sessionId ?? ""),
    enabled: Boolean(sessionId)
  });
  const strengthQuery = useQuery({
    queryKey: ["strength", sessionId, session?.unlockedEvidenceIds],
    queryFn: () => getCaseStrength(sessionId ?? ""),
    enabled: Boolean(sessionId)
  });

  const activeCharacter = useMemo(
    () => session?.characters.find((character) => character.id === activeCharacterId) ?? session?.characters[0],
    [activeCharacterId, session?.characters]
  );
  const suspectCharacterId = session?.suspectCharacterId || profile.suspect.characterId;
  const suspectInterrogation = session?.interrogations.find((interrogation) => interrogation.characterId === suspectCharacterId);
  const hasWitnessCorroboration = profile.suspect.corroboration
    ? session?.completedInterviews.some(
        (interview) => interview.characterId === profile.suspect.corroboration?.characterId && interview.topic === profile.suspect.corroboration?.topic
      ) ?? false
    : false;
  const suspectTopics = new Set((suspectInterrogation?.questionTopics ?? []).filter((topic) => topic in profile.suspectTopicLabels));
  const suspectAvailable = session?.characters.some((character) => character.id === suspectCharacterId) ?? false;
  const suspectTargetMs = profile.suspect.targetMinutes * 60_000;
  const suspectTimeRemainingMs = suspectInterrogation
    ? Math.max(0, suspectTargetMs - (clockMs - Date.parse(suspectInterrogation.startedAt)))
    : suspectTargetMs;
  const suspectInterviewDone = Boolean(profile.suspect.doneEvidenceId) && (session?.unlockedEvidenceIds.includes(profile.suspect.doneEvidenceId) ?? false);
  const suspectCanFinish = Boolean(
    suspectInterrogation &&
    suspectTopics.size >= profile.suspect.minimumTopics &&
    profile.suspect.finishEvidenceIds.every((id) => session?.unlockedEvidenceIds.includes(id)) &&
    !suspectInterviewDone
  );
  const selectedLocation = session?.locations.find((location) => location.id === selectedLocationId) ?? session?.locations[0];
  const unlockedEvidence = new Set(session?.unlockedEvidenceIds ?? []);
  const hasEvidence = (evidenceId: string) => unlockedEvidence.has(evidenceId);

  const actionContext: ActionContext = {
    hasEvidence,
    suspectInterrogation,
    suspectInterviewDone,
    suspectCanFinish,
    suspectAvailable,
    suspectTopicCount: suspectTopics.size,
    timeRemainingLabel: formatDuration(suspectTimeRemainingMs),
    busy: interactionMutation.isPending
  };
  const resolveDetail = (detail: ActionSpec["detail"]) => (typeof detail === "function" ? detail(actionContext) : detail);
  const isDisabled = (spec: ActionSpec) => spec.disabled?.(actionContext) ?? false;

  if (!authReady || !hasHydrated) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.emptyState}><Text style={styles.muted}>Dosya oturumu açılıyor...</Text></View>
      </SafeAreaView>
    );
  }
  if (supabase && !authSession) return <AuthScreen client={supabase} />;

  if (sessionId && !session) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingState}>
          {savedSessionQuery.isError ? (
            <>
              <Text style={styles.sectionTitle}>Kayıtlı dosya açılamadı</Text>
              <Text style={styles.muted}>{toTurkishError(savedSessionQuery.error)}</Text>
              <ActionButton icon="refresh" title="Yeniden dene" onPress={() => void savedSessionQuery.refetch()} />
              <ActionButton icon="folder-plus" title="Yeni dosya başlat" onPress={() => { clearSessionId(); setSession(undefined); setSelectedCaseId(undefined); setProsecutionResult(undefined); }} />
            </>
          ) : <Text style={styles.muted}>Kayıtlı dosya açılıyor...</Text>}
        </View>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.briefingScreen}>
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>{profile.eyebrow}</Text>
              <Text style={styles.title}>{profile.title}</Text>
            </View>
            {supabase && authSession ? <SignOutButton onPress={() => { void supabase?.auth.signOut(); clearSessionId(); }} /> : null}
          </View>

          <SectionHeading title="Vaka seçimi" detail="Sunucuda yüklü vaka paketlerinden birini seç." />
          <View style={styles.actionList}>
            {(availableCasesQuery.data ?? []).map((entry: CaseSummaryDto) => {
              const isActive = (selectedCaseId ?? DEFAULT_CASE_ID) === entry.caseId;
              return (
                <Pressable
                  key={entry.caseId}
                  testID={`select-${entry.caseId}`}
                  accessibilityRole="button"
                  onPress={() => setSelectedCaseId(entry.caseId)}
                  style={[styles.characterChoice, isActive && styles.characterChoiceActive]}
                >
                  <Text style={[styles.characterChoiceText, isActive && styles.characterChoiceTextActive]}>{entry.title}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.briefingLead}>
            <MaterialCommunityIcons name="folder-search" color={colors.accent} size={25} />
            <Text style={styles.briefingLabel}>{profile.briefingLabel}</Text>
            <Text style={styles.briefingText}>{profile.briefingText}</Text>
          </View>

          {profile.statements.length ? <Text style={styles.sectionTitle}>Dosyadaki ilk beyanlar</Text> : null}
          {profile.statements.map((statement, index) => (
            <StatementCard key={`${statement.name}-${index}`} name={statement.name} text={statement.text} note={statement.note} />
          ))}

          <View style={styles.disclaimer}>
            <MaterialCommunityIcons name="information-outline" color={colors.muted} size={18} />
            <Text style={styles.disclaimerText}>{profile.disclaimer}</Text>
          </View>

          {feedback ? <FeedbackBanner text={feedback} onDismiss={() => setFeedback(undefined)} /> : null}
          <Pressable testID="start-case" accessibilityRole="button" disabled={startMutation.isPending} style={[styles.startButton, startMutation.isPending && styles.disabled]} onPress={() => startMutation.mutate(selectedCaseId ?? DEFAULT_CASE_ID)}>
            <MaterialCommunityIcons name="folder-open" color={colors.background} size={20} />
            <Text style={styles.startButtonText}>{startMutation.isPending ? "Dosya hazırlanıyor..." : "Dosyayı al ve haritayı aç"}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const tabs: Array<{ id: WorkspaceTab; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }> = [
    { id: "map", label: "Harita", icon: "map-marker-radius" },
    { id: "investigation", label: "Soruşturma", icon: "account-search" },
    { id: "forensics", label: "Adli Tıp", icon: "flask-outline" },
    { id: "prosecution", label: "Savcılık", icon: "scale-balance" }
  ];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.workspace}>
        <View style={styles.workspaceHeader}>
          <View style={styles.headerTitleBlock}>
            <Text style={styles.eyebrow}>{profile.workspaceEyebrow}</Text>
            <Text numberOfLines={1} style={styles.workspaceTitle}>{session.caseTitle || profile.title}</Text>
          </View>
          <View style={styles.headerActions}>
            <View style={styles.statPill}><Text style={styles.statPillText}>{session.evidenceCount} delil</Text></View>
            <View style={styles.statPill}><Text style={styles.statPillText}>Güç {strengthQuery.data?.score ?? 0}</Text></View>
            {supabase && authSession ? <SignOutButton onPress={() => { void supabase?.auth.signOut(); clearSessionId(); setSession(undefined); }} /> : null}
          </View>
        </View>

        <View accessibilityRole="tablist" style={styles.tabs}>
          {tabs.map((tab) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === tab.id }}
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={[styles.tab, activeTab === tab.id && styles.tabActive]}
            >
              <MaterialCommunityIcons name={tab.icon} size={17} color={activeTab === tab.id ? colors.accent : colors.muted} />
              <Text numberOfLines={1} style={[styles.tabText, activeTab === tab.id && styles.tabTextActive]}>{tab.label}</Text>
            </Pressable>
          ))}
        </View>

        {feedback ? <FeedbackBanner text={feedback} onDismiss={() => setFeedback(undefined)} /> : null}

        {activeTab === "map" ? (
          <View style={styles.mapWorkspace}>
            <View style={styles.mapHeading}>
              <View>
                <Text style={styles.mapHeadingTitle}>{profile.mapHeading}</Text>
                <Text style={styles.muted}>Erişilebilir konumlar: {session.locations.length}</Text>
              </View>
              <MaterialCommunityIcons name="crosshairs-gps" color={colors.accent} size={21} />
            </View>
            <CaseMap
              locations={session.locations}
              selectedLocationId={selectedLocation?.id}
              stampLabel={profile.mapStamp}
              onLocationPress={(locationId) => setSelectedLocationId(locationId)}
            />
            {selectedLocation ? (
              <View style={styles.locationPanel}>
                <View style={styles.locationPanelCopy}>
                  <Text style={styles.locationPanelTitle}>{selectedLocation.name}</Text>
                  <Text numberOfLines={2} style={styles.locationPanelDescription}>{selectedLocation.description}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Soruşturmayı ${selectedLocation.name} konumunda aç`}
                  onPress={() => setActiveTab(profile.forensicsLocationIds.includes(selectedLocation.id) ? "forensics" : "investigation")}
                  style={styles.locationAction}
                >
                  <MaterialCommunityIcons name={profile.forensicsLocationIds.includes(selectedLocation.id) ? "flask-outline" : "arrow-right"} size={20} color={colors.background} />
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        {activeTab === "investigation" ? (
          <ScrollView contentContainerStyle={styles.areaScroll}>
            <SectionHeading title="Soruşturma" detail="Her işlem dosyaya kaydedilir; yeni deliller haritadaki erişimi etkiler." />
            <View style={styles.actionList}>
              {profile.investigationActions.map((spec) => (
                <ActionButton
                  key={spec.title}
                  icon={spec.icon}
                  title={spec.title}
                  detail={resolveDetail(spec.detail)}
                  disabled={isDisabled(spec)}
                  busy={interactionMutation.isPending}
                  onPress={() => interactionMutation.mutate(spec.buildAction())}
                />
              ))}
              <ActionButton
                icon={suspectInterviewDone ? "check-circle-outline" : "account-question-outline"}
                title={
                  suspectInterviewDone
                    ? "Sorgu tutanağı tamamlandı"
                    : suspectInterrogation
                      ? suspectCanFinish
                        ? "Sorguyu erken bitir"
                        : "Sorgu ilerlemesi"
                      : `${profile.suspect.displayName} ile sorguyu başlat`
                }
                detail={
                  suspectInterviewDone
                    ? `${profile.suspect.doneEvidenceId} şüpheli ifade tutanağı delillere eklendi.`
                    : suspectCanFinish
                      ? `Sorgu hazır · ${suspectTopics.size}/${profile.suspect.topicCount} konu · ${profile.suspect.targetMinutes} dakika dolmadan bitirebilirsin.`
                      : suspectInterrogation
                        ? `${profile.suspect.targetMinutes} dk hedef · ${formatDuration(suspectTimeRemainingMs)} kaldı · ${suspectTopics.size}/${profile.suspect.topicCount} konu. ${profile.suspect.finishRequirementText}`
                        : suspectAvailable
                          ? "Sorgu sunucu saatine kaydedilir; gerekli deliller açılınca erken bitirebilirsin."
                          : profile.suspect.startHint
                }
                disabled={suspectInterviewDone || (suspectInterrogation ? !suspectCanFinish : !suspectAvailable) || interactionMutation.isPending}
                busy={interactionMutation.isPending}
                onPress={() => interactionMutation.mutate(suspectInterrogation ? { type: "interview_suspect" } : { type: "start_interview", characterId: suspectCharacterId })}
              />
            </View>

            <SectionHeading title="Karakter görüşmesi" detail="Soru serbest metin; yanıt ve delil erişimi sunucu kurallarınca belirlenir." />
            <View style={styles.characterChoices}>
              {session.characters.map((character) => (
                <Pressable key={character.id} onPress={() => setActiveCharacterId(character.id)} style={[styles.characterChoice, activeCharacterId === character.id && styles.characterChoiceActive]}>
                  <Text style={[styles.characterChoiceText, activeCharacterId === character.id && styles.characterChoiceTextActive]}>{character.name}</Text>
                </Pressable>
              ))}
            </View>
            {activeCharacter ? (
              <View style={styles.interviewPanel}>
                <Text style={styles.panelTitle}>{activeCharacter.name}</Text>
                <Text style={styles.statementText}>{activeCharacter.initialStatement}</Text>
                {activeCharacter.id === suspectCharacterId ? (
                  <View style={styles.interrogationPanel}>
                    {!suspectInterrogation ? (
                      <ActionButton icon="timer-outline" title={`${profile.suspect.displayName} sorgusunu başlat`} detail={profile.suspect.panelStartDetail} busy={interactionMutation.isPending} onPress={() => interactionMutation.mutate({ type: "start_interview", characterId: suspectCharacterId })} />
                    ) : (
                      <>
                        <View style={styles.interrogationHeader}>
                          <Text style={styles.interrogationLabel}>{`${profile.suspect.targetMinutes} DK HEDEF · ERKEN BİTİRİLEBİLİR`}</Text>
                          <Text style={styles.interrogationTimer}>{formatDuration(suspectTimeRemainingMs)}</Text>
                        </View>
                        {Object.entries(profile.suspectTopicLabels).map(([topic, label]) => (
                          <View key={topic} style={styles.topicProgress}>
                            <MaterialCommunityIcons name={suspectTopics.has(topic) ? "check-circle" : "circle-outline"} color={suspectTopics.has(topic) ? colors.ok : colors.muted} size={17} />
                            <Text style={styles.topicProgressText}>{label}</Text>
                          </View>
                        ))}
                        {!profile.suspect.finishEvidenceIds.every(hasEvidence) ? <Text style={styles.interrogationHint}>{profile.suspect.finishHint}</Text> : null}
                        {suspectTopics.size < profile.suspect.minimumTopics ? <Text style={styles.interrogationHint}>{profile.suspect.topicsHint}</Text> : null}
                        {profile.suspect.corroboration ? (
                          <Text style={styles.interrogationHint}>{hasWitnessCorroboration ? profile.suspect.corroboration.readyText : profile.suspect.corroboration.pendingText}</Text>
                        ) : null}
                      </>
                    )}
                  </View>
                ) : null}
                {conversation.filter((line) => line.characterId === activeCharacter.id).map((line, index) => (
                  <View key={`${line.role}-${index}`} style={[styles.chatLine, line.role === "player" ? styles.playerLine : styles.characterLine]}>
                    <Text style={styles.chatRole}>{line.role === "player" ? "DEDEKTİF" : activeCharacter.name.toLocaleUpperCase("tr-TR")}</Text>
                    <Text style={styles.chatText}>{line.text}</Text>
                    {line.evidenceIds?.length ? <Text style={styles.chatEvidence}>Dayanak: {line.evidenceIds.join(", ")}</Text> : null}
                  </View>
                ))}
                <Controller
                  control={questionForm.control}
                  name="question"
                  render={({ field: { value, onChange } }) => (
                    <TextInput
                      accessibilityLabel="Karaktere soru yaz"
                      style={styles.input}
                      value={value}
                      onChangeText={onChange}
                      editable={activeCharacter.id !== suspectCharacterId || Boolean(suspectInterrogation)}
                      placeholder={activeCharacter.id === suspectCharacterId && !suspectInterrogation ? "Önce sorguyu başlat" : "Örn. Olay günü ne oldu?"}
                      placeholderTextColor={colors.muted}
                      multiline
                    />
                  )}
                />
                {questionForm.formState.errors.question ? <Text style={styles.errorText}>{questionForm.formState.errors.question.message}</Text> : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={questionMutation.isPending || (activeCharacter.id === suspectCharacterId && !suspectInterrogation)}
                  style={[styles.primaryButton, questionMutation.isPending && styles.disabled]}
                  onPress={questionForm.handleSubmit((values) => questionMutation.mutate({
                    characterId: activeCharacter.id,
                    question: values.question,
                  }))}
                >
                  <MaterialCommunityIcons name={questionMutation.isPending ? "timer-sand" : "send"} color={colors.background} size={18} />
                  <Text style={styles.primaryText}>{questionMutation.isPending ? "Yanıt bekleniyor..." : "Soruyu ilet"}</Text>
                </Pressable>
              </View>
            ) : <EmptyState icon="account-lock-outline" title="Henüz görüşülebilir kişi yok" detail="Yeni ifadeler dosyaya girdikçe karakterler açılır." />}
          </ScrollView>
        ) : null}

        {activeTab === "forensics" ? (
          <ScrollView contentContainerStyle={styles.areaScroll}>
            <SectionHeading title="Adli Tıp ve deliller" detail="Yalnızca dosyada açılmış deliller gösterilir." />
            {profile.forensicsActions.length ? (
              <View style={styles.actionList}>
                {profile.forensicsActions.map((spec) => (
                  <ActionButton
                    key={spec.title}
                    icon={spec.icon}
                    title={spec.title}
                    detail={resolveDetail(spec.detail)}
                    disabled={isDisabled(spec)}
                    busy={interactionMutation.isPending}
                    onPress={() => interactionMutation.mutate(spec.buildAction())}
                  />
                ))}
              </View>
            ) : null}
            <SectionHeading title="Açılmış deliller" detail={evidenceQuery.data?.evidence?.length ? `${evidenceQuery.data.evidence.length} kayıt` : "Henüz delil yüklenmedi"} />
            {evidenceQuery.isError ? <ActionButton icon="refresh" title="Delilleri yeniden yükle" onPress={() => void evidenceQuery.refetch()} /> : null}
            {evidenceQuery.data?.evidence?.map((item: { id: string; name: string; facts: string[]; limitations?: string[] }) => (
              <EvidenceCard key={item.id} id={item.id} name={item.name} fact={item.facts[0]} limitation={item.limitations?.[0]} />
            ))}
          </ScrollView>
        ) : null}

        {activeTab === "prosecution" ? (
          <ScrollView contentContainerStyle={styles.areaScroll}>
            <SectionHeading title="Savcılığa dosya sun" detail="Karar yalnızca eriştiğin ve dosyaya eklediğin delillerle, deterministik kurallarla hesaplanır." />
            <View style={styles.prosecutionSummary}>
              <Text style={styles.statPillText}>Erişilmiş delil: {session.evidenceCount}</Text>
              <Text style={styles.statPillText}>Dosya gücü: {strengthQuery.data?.score ?? 0}/100</Text>
              {strengthQuery.data?.weakAreas?.map((area: string) => <Text key={area} style={styles.gapText}>• {area}</Text>)}
            </View>
            <Text style={styles.muted}>Başvuru erken yapılabilir. Eksik veya zayıf dosya gerekçeli biçimde geri çevrilebilir; sonuç gerçek bir hukuki karar değildir.</Text>
            <Pressable accessibilityRole="button" disabled={prosecutionMutation.isPending} style={[styles.primaryButton, prosecutionMutation.isPending && styles.disabled]} onPress={() => prosecutionMutation.mutate()}>
              <MaterialCommunityIcons name="file-send-outline" color={colors.background} size={19} />
              <Text style={styles.primaryText}>{prosecutionMutation.isPending ? "Dosya değerlendiriliyor..." : "Dosyayı savcılığa sun"}</Text>
            </Pressable>
            {prosecutionResult ? (
              <View style={styles.decisionPanel}>
                <Text style={styles.panelTitle}>{prosecutionOutcome(prosecutionResult.outcome)}</Text>
                <Text style={styles.muted}>Dosya puanı: {prosecutionResult.score}/100</Text>
                {prosecutionResult.reasons.map((reason) => <Text key={reason} style={styles.statementText}>{reason}</Text>)}
              </View>
            ) : null}
          </ScrollView>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function prosecutionOutcome(outcome: string) {
  const labels: Record<string, string> = {
    accepted_for_further_action: "İleri incelemeye alındı",
    returned_for_more_evidence: "Ek delil için geri gönderildi",
    rejected: "Başvuru reddedildi"
  };
  return labels[outcome] ?? outcome;
}

function SignOutButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Oturumu kapat" onPress={onPress} style={styles.signOutButton}>
      <MaterialCommunityIcons name="logout" color={colors.text} size={19} />
    </Pressable>
  );
}

function FeedbackBanner({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <View accessibilityRole="alert" style={styles.feedbackBanner}>
      <MaterialCommunityIcons name="text-box-check-outline" color={colors.ok} size={19} />
      <Text style={styles.feedbackText}>{text}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Bildirimi kapat" onPress={onDismiss} hitSlop={10}>
        <MaterialCommunityIcons name="close" color={colors.muted} size={18} />
      </Pressable>
    </View>
  );
}

function SectionHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.muted}>{detail}</Text>
    </View>
  );
}

function ActionButton({
  icon,
  title,
  detail,
  disabled = false,
  busy = false,
  onPress
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  detail?: string;
  disabled?: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled || busy} onPress={onPress} style={[styles.actionButton, (disabled || busy) && styles.actionButtonDisabled]}>
      <View style={styles.actionIcon}><MaterialCommunityIcons name={icon} color={disabled ? colors.muted : colors.accent} size={21} /></View>
      <View style={styles.actionCopy}>
        <Text style={[styles.actionTitle, disabled && styles.disabledText]}>{busy ? "İşleniyor..." : title}</Text>
        {detail ? <Text style={styles.actionDetail}>{detail}</Text> : null}
      </View>
      <MaterialCommunityIcons name={disabled ? "lock-outline" : "chevron-right"} color={colors.muted} size={20} />
    </Pressable>
  );
}

function StatementCard({ name, text, note }: { name: string; text: string; note?: string }) {
  return (
    <View style={styles.statementCard}>
      <Text style={styles.statementName}>{name}</Text>
      <Text style={styles.statementText}>{`“${text}”`}</Text>
      {note ? <Text style={styles.statementNote}>{note}</Text> : null}
    </View>
  );
}

function EvidenceCard({ id, name, fact, limitation }: { id: string; name: string; fact: string; limitation?: string }) {
  return (
    <View style={styles.evidenceCard}>
      <View style={styles.evidenceHeader}>
        <Text style={styles.evidenceId}>{id}</Text>
        <Text style={styles.evidenceName}>{name}</Text>
      </View>
      <Text style={styles.statementText}>{fact}</Text>
      {limitation ? <Text style={styles.evidenceLimit}>{limitation}</Text> : null}
    </View>
  );
}

function EmptyState({ icon, title, detail }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; title: string; detail: string }) {
  return (
    <View style={styles.emptyState}>
      <MaterialCommunityIcons name={icon} color={colors.muted} size={28} />
      <Text style={styles.panelTitle}>{title}</Text>
      <Text style={styles.muted}>{detail}</Text>
    </View>
  );
}

function toTurkishError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const known: Record<string, string> = {
    location_locked_or_unknown: "Bu konum henüz haritada açılmadı.",
    character_locked_or_unknown: "Bu kişiyle görüşmek için önce ilgili delili bul.",
    missing_prerequisite_E02: "Önce gösteri alanına erişip sahne notunu bulmalısın.",
    missing_prerequisite_E05: "Önce Leyla’nın ödeme beyanını açmalısın.",
    missing_prerequisite_E07_E08: "Önce mesaj kaydını ve beyan karşılaştırmasını tamamlamalısın.",
    interrogation_not_started: "Önce Murat sorgusunu başlatmalısın.",
    interrogation_topics_incomplete: "Sorguyu bitirmek için en az iki farklı başlıkta soru sor.",
    unauthorized: "Oturum doğrulanamadı. Bağlantıyı ve hesabı kontrol et.",
    api_error: "Sunucuya ulaşılamadı. Bağlantıyı kontrol edip yeniden dene."
  };
  return known[code] ?? "İşlem tamamlanamadı. Bağlantıyı kontrol edip yeniden dene.";
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.background, flex: 1 },
  briefingScreen: { gap: 18, padding: 18, paddingBottom: 36 },
  workspace: { flex: 1, gap: 8, paddingHorizontal: 12, paddingTop: 7 },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  workspaceHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 45 },
  headerTitleBlock: { flex: 1, paddingRight: 8 },
  headerActions: { alignItems: "center", flexDirection: "row", gap: 6 },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: "700" },
  title: { color: colors.text, fontSize: 28, fontWeight: "800" },
  workspaceTitle: { color: colors.text, fontSize: 19, fontWeight: "800", marginTop: 2 },
  signOutButton: { alignItems: "center", borderColor: colors.line, borderRadius: 8, borderWidth: 1, height: 38, justifyContent: "center", width: 38 },
  statPill: { backgroundColor: colors.panelAlt, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 7 },
  statPillText: { color: colors.text, fontSize: 11, fontWeight: "700" },
  tabs: { borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: "row", gap: 2 },
  tab: { alignItems: "center", borderBottomColor: "transparent", borderBottomWidth: 2, flex: 1, flexDirection: "row", gap: 4, justifyContent: "center", minHeight: 42, paddingHorizontal: 3 },
  tabActive: { borderBottomColor: colors.accent },
  tabText: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  tabTextActive: { color: colors.text },
  feedbackBanner: { alignItems: "center", backgroundColor: colors.panel, borderColor: colors.line, borderRadius: 7, borderWidth: 1, flexDirection: "row", gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  feedbackText: { color: colors.text, flex: 1, fontSize: 12, lineHeight: 17 },
  mapWorkspace: { flex: 1, gap: 8, paddingBottom: 8 },
  mapHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 3 },
  mapHeadingTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  locationPanel: { alignItems: "center", backgroundColor: colors.panel, borderColor: colors.line, borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  locationPanelCopy: { flex: 1, gap: 3 },
  locationPanelTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  locationPanelDescription: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  locationAction: { alignItems: "center", backgroundColor: colors.accent, borderRadius: 7, height: 40, justifyContent: "center", width: 42 },
  areaScroll: { gap: 15, paddingBottom: 28, paddingTop: 7 },
  sectionHeading: { gap: 4, marginTop: 4 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  actionList: { gap: 7 },
  actionButton: { alignItems: "center", backgroundColor: colors.panel, borderColor: colors.line, borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 10, minHeight: 58, paddingHorizontal: 10, paddingVertical: 8 },
  actionButtonDisabled: { opacity: 0.63 },
  actionIcon: { alignItems: "center", height: 32, justifyContent: "center", width: 32 },
  actionCopy: { flex: 1, gap: 3 },
  actionTitle: { color: colors.text, fontSize: 13, fontWeight: "800" },
  actionDetail: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  disabledText: { color: colors.muted },
  characterChoices: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  characterChoice: { borderColor: colors.line, borderRadius: 6, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  characterChoiceActive: { backgroundColor: colors.accentDeep, borderColor: colors.accent },
  characterChoiceText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  characterChoiceTextActive: { color: colors.text },
  interviewPanel: { backgroundColor: colors.panel, borderColor: colors.line, borderRadius: 8, borderWidth: 1, gap: 10, padding: 12 },
  interrogationPanel: { backgroundColor: "#202A27", borderColor: colors.line, borderRadius: 7, borderWidth: 1, gap: 8, padding: 10 },
  interrogationHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  interrogationLabel: { color: colors.accent, fontSize: 9, fontWeight: "800" },
  interrogationTimer: { color: colors.text, fontSize: 19, fontVariant: ["tabular-nums"], fontWeight: "800" },
  topicProgress: { alignItems: "center", flexDirection: "row", gap: 7 },
  topicProgressText: { color: colors.muted, fontSize: 11 },
  interrogationHint: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  panelTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  statementText: { color: colors.text, fontSize: 13, lineHeight: 20 },
  statementNote: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  chatLine: { borderRadius: 7, gap: 5, padding: 10 },
  playerLine: { alignSelf: "flex-end", backgroundColor: colors.panelAlt, maxWidth: "92%" },
  characterLine: { alignSelf: "stretch", backgroundColor: "#26342F", borderLeftColor: colors.ok, borderLeftWidth: 2 },
  chatRole: { color: colors.accent, fontSize: 9, fontWeight: "800" },
  chatText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  chatEvidence: { color: colors.muted, fontSize: 10 },
  input: { borderColor: colors.line, borderRadius: 7, borderWidth: 1, color: colors.text, minHeight: 72, padding: 10, textAlignVertical: "top" },
  errorText: { color: colors.danger, fontSize: 12 },
  primaryButton: { alignItems: "center", alignSelf: "flex-start", backgroundColor: colors.accent, borderRadius: 7, flexDirection: "row", gap: 7, minHeight: 42, paddingHorizontal: 13, paddingVertical: 9 },
  disabled: { opacity: 0.6 },
  primaryText: { color: colors.background, fontWeight: "800" },
  prosecutionSummary: { backgroundColor: colors.panel, borderColor: colors.line, borderRadius: 8, borderWidth: 1, gap: 9, padding: 13 },
  gapText: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  decisionPanel: { backgroundColor: colors.panelAlt, borderColor: colors.ok, borderRadius: 8, borderWidth: 1, gap: 9, padding: 13 },
  briefingLead: { backgroundColor: colors.panel, borderColor: colors.line, borderLeftColor: colors.accent, borderRadius: 8, borderWidth: 1, gap: 10, padding: 15 },
  briefingLabel: { color: colors.accent, fontSize: 11, fontWeight: "800" },
  briefingText: { color: colors.text, fontSize: 14, lineHeight: 22 },
  statementCard: { backgroundColor: colors.panel, borderColor: colors.line, borderRadius: 8, borderWidth: 1, gap: 8, padding: 13 },
  statementName: { color: colors.accent, fontSize: 12, fontWeight: "800" },
  disclaimer: { alignItems: "flex-start", flexDirection: "row", gap: 8, paddingHorizontal: 2 },
  disclaimerText: { color: colors.muted, flex: 1, fontSize: 11, lineHeight: 16 },
  startButton: { alignItems: "center", backgroundColor: colors.accent, borderRadius: 7, flexDirection: "row", gap: 9, justifyContent: "center", minHeight: 48, paddingHorizontal: 16 },
  startButtonText: { color: colors.background, fontSize: 14, fontWeight: "800" },
  evidenceCard: { backgroundColor: colors.panel, borderBottomColor: colors.line, borderBottomWidth: 1, gap: 8, padding: 12 },
  evidenceHeader: { alignItems: "center", flexDirection: "row", gap: 9 },
  evidenceId: { backgroundColor: colors.panelAlt, borderRadius: 4, color: colors.accent, fontSize: 10, fontWeight: "800", overflow: "hidden", paddingHorizontal: 6, paddingVertical: 4 },
  evidenceName: { color: colors.text, flex: 1, fontSize: 13, fontWeight: "700" },
  evidenceLimit: { borderLeftColor: colors.accentDeep, borderLeftWidth: 2, color: colors.muted, fontSize: 11, lineHeight: 16, paddingLeft: 8 },
  loadingState: { alignItems: "center", flex: 1, gap: 13, justifyContent: "center", padding: 22 },
  emptyState: { alignItems: "center", backgroundColor: colors.panel, borderColor: colors.line, borderRadius: 8, borderWidth: 1, gap: 8, padding: 20 }
});
