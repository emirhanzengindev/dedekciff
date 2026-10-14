/**
 * Mobile UI presentation profiles.
 *
 * The game engine and API are fully case-agnostic; all narrative copy,
 * action buttons, suspect-interrogation wording and map chrome that used to
 * be hardcoded for case-001 now live here so additional case packs (e.g.
 * case-002) can be played without touching the screen logic.
 *
 * A case with no registered profile falls back to a neutral, data-driven
 * profile, so newly added packs still load and are playable.
 */
import type { ComponentProps } from "react";
import { MaterialCommunityIcons } from "@expo/vector-icons";

export type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

export interface SuspectInterrogationState {
  characterId: string;
  startedAt: string;
  questionTopics: string[];
}

export interface ActionContext {
  hasEvidence: (evidenceId: string) => boolean;
  suspectInterrogation?: SuspectInterrogationState;
  suspectInterviewDone: boolean;
  suspectCanFinish: boolean;
  suspectAvailable: boolean;
  suspectTopicCount: number;
  timeRemainingLabel: string;
  busy: boolean;
}

export interface ActionSpec {
  icon: IconName;
  title: string;
  detail: string | ((context: ActionContext) => string);
  disabled?: (context: ActionContext) => boolean;
  /** Marks the investigation step complete once the given evidence exists (quest panel). */
  isDone?: (context: ActionContext) => boolean;
  buildAction: () => { type: string; locationId?: string; characterId?: string };
}

export interface CaseProfile {
  caseId: string;
  title: string;
  /** Eyebrow shown on the pre-game briefing screen. */
  eyebrow: string;
  /** Eyebrow shown inside the workspace header. */
  workspaceEyebrow: string;
  /** Short region label above the map. */
  mapHeading: string;
  /** Stamp label on the map corner. */
  mapStamp: string;
  briefingLabel: string;
  briefingText: string;
  /** Cinematic briefing cover extras (classification stamp, persona, first step). */
  briefing?: {
    classification: string;
    fileLabel: string;
    assignedDetective: string;
    firstStepHint: string;
  };
  statements: Array<{ name: string; text: string; note?: string }>;
  disclaimer: string;
  /** Optional source-of-truth note shown under a character's opening statement. */
  interviewSourceNote?: string;
  startFeedback: string;
  evidenceNames: Record<string, string>;
  suspectTopicLabels: Record<string, string>;
  suspect: {
    characterId: string;
    displayName: string;
    doneEvidenceId: string;
    finishEvidenceIds: string[];
    /** e.g. "İki konu ve E07/E08 gerekli." */
    finishRequirementText: string;
    minimumTopics: number;
    topicCount: number;
    targetMinutes: number;
    startHint: string;
    panelStartDetail: string;
    finishHint: string;
    topicsHint: string;
    corroboration: {
      characterId: string;
      topic: string;
      readyText: string;
      pendingText: string;
    } | null;
  };
  /** Locations whose action routes to the forensics tab (case-001: show_room). */
  forensicsLocationIds: string[];
  investigationActions: ActionSpec[];
  forensicsActions: ActionSpec[];
  prosecutionDefaults: {
    suspectId: string;
    crimeSummary: string;
    contradictionAnalysis: string;
    gaps: string;
  };
}

function genericProfile(caseId: string): CaseProfile {
  const numeric = caseId.replace(/[^0-9]/g, "") || "000";
  return {
    caseId,
    title: caseId,
    eyebrow: `DOSYA ${numeric} / İNCELEME`,
    workspaceEyebrow: `${caseId.toUpperCase()} / SORUŞTURMA`,
    mapHeading: "Saha",
    mapStamp: `DOSYA ${numeric}`,
    briefingLabel: "BAŞLANGIÇ TUTANAĞI",
    briefingText: "Dosya kaydı sunucudan yüklendi. Erişilebilir delilleri ve konumları incelemeye hazır.",
    statements: [],
    disclaimer: "Dosyadaki bilgiler yalnızca vaka paketinin iddialarıdır; bağımsız doğrulama taşımaz.",
    startFeedback: "Dosya açıldı. Erişilebilir konumlar incelemeye hazır.",
    evidenceNames: {},
    suspectTopicLabels: {},
    suspect: {
      characterId: "",
      displayName: "Şüpheli",
      doneEvidenceId: "",
      finishEvidenceIds: [],
      finishRequirementText: "",
      minimumTopics: 1,
      topicCount: 1,
      targetMinutes: 2,
      startHint: "Önce ilgili delilleri aç.",
      panelStartDetail: "Sunucu süreyi kaydeder.",
      finishHint: "Sorguyu bitirmek için gerekli delilleri aç.",
      topicsHint: "En az bir konu hakkında soru sor.",
      corroboration: null
    },
    forensicsLocationIds: [],
    investigationActions: [],
    forensicsActions: [],
    prosecutionDefaults: {
      suspectId: "",
      crimeSummary: "Erişilmiş delillerle birlikte sunulur.",
      contradictionAnalysis: "Çelişkiler açıkça belirtilir.",
      gaps: "Bağımsız doğrulama sınırları dosyada belirtilir."
    }
  };
}

const case001: CaseProfile = {
  caseId: "case-001",
  title: "Çil Çil Altınlar",
  eyebrow: "DOSYA 001 / İLK İNCELEME",
  workspaceEyebrow: "CASE-001 / SORUŞTURMA",
  mapHeading: "Gümüştepe",
  mapStamp: "DOSYA 001",
  briefing: {
    classification: "GİZLİ",
    fileLabel: "İNCELEME DOSYASI",
    assignedDetective: "Dedektif McDaniel",
    firstStepHint: "Benzer şikâyetleri araştır; ikinci mağdur kaydı dosyanın çerçevesini genişletir."
  },
  briefingLabel: "BAŞLANGIÇ TUTANAĞI",
  briefingText:
    "İlk dosya kaydı, altın vaadi içeren bir gösteriye katıldığını ve ödeme yaptıktan sonra vaat edilen altını alamadığını bildiren Leyla Karaca’nın şikâyetidir. Bu, henüz doğrulanmamış bir iddiadır.",
  statements: [
    {
      name: "Leyla Karaca · şikâyetçi",
      text: "Bir tanıdık aracılığıyla altın bulunduğu söylenen bir gösteriye çağrıldım. Gösteriden sonra para verdiğimi ve vaat edilen altının teslim edilmediğini bildiriyorum."
    },
    {
      name: "Nermin Aksoy · ikinci şikâyet özeti",
      text: "Benzer bir altın vaadiyle para verdiğimi bildiriyorum.",
      note: "Ayrıntılı görüşme, ilgili şikâyet kaydı araştırmada açıldığında yapılabilir."
    }
  ],
  disclaimer:
    "Oyun içindeki kişiler, olaylar ve deliller kurgusaldır. Şikâyet beyanı tek başına kanıt veya suçluluk sonucu değildir.",
  startFeedback: "Dosya açıldı. İlk tutanak ve erişilebilir konumlar incelemeye hazır.",
  evidenceNames: {
    E02: "Gösteri alanı inceleme notu",
    E03: "Nesne inceleme raporu",
    E04: "Gösteriyi düzenleyen kişiyle bağlantı",
    E05: "Leyla’nın ayrıntılı ödeme beyanı",
    E06: "İkinci mağdur şikâyeti",
    E07: "Kurgusal mesaj çıktısı",
    E08: "Mağdur anlatımları karşılaştırması",
    E09: "Şüpheli görüşmesi tutanağı",
    E10: "Ödeme iddiası çapraz kontrolü"
  },
  suspectTopicLabels: {
    show_details: "Gösterideki rolü",
    payment_details: "Ödeme iddiası",
    who_invited: "Çağrı ve bağlantı"
  },
  suspect: {
    characterId: "C02",
    displayName: "Murat",
    doneEvidenceId: "E09",
    finishEvidenceIds: ["E07", "E08"],
    finishRequirementText: "İki konu ve E07/E08 gerekli.",
    minimumTopics: 2,
    topicCount: 3,
    targetMinutes: 2,
    startHint: "Önce C03 tanık bağlantısıyla E04’ü aç.",
    panelStartDetail:
      "Sunucu süreyi kaydeder. İki konu ve gerekli deliller sonrası 2 dakika dolmadan da bitirebilirsin.",
    finishHint: "Sorguyu bitirmek için E07 mesaj kaydı ve E08 beyan karşılaştırması gerekli.",
    topicsHint: "En az iki farklı konu hakkında soru sor.",
    corroboration: {
      characterId: "C03",
      topic: "who_arranged_show",
      readyText: "Cem’in E04 beyanı dosyada. Aynı noktayı tekrar sor; Murat yalnızca bu beyanın desteklediği kısmı kabul edebilir.",
      pendingText: "Başka bir karakterden aynı konuyla ilgili ifade al; tekrar sorudaki baskı ancak bağımsız destekle anlam kazanır."
    }
  },
  forensicsLocationIds: ["show_room"],
  investigationActions: [
    {
      icon: "account-search",
      title: "Benzer şikâyetleri ara",
      detail: "İkinci şikâyet kaydını ve Nermin’in görüşmesini araştır.",
      isDone: (context) => context.hasEvidence("E06"),
      buildAction: () => ({ type: "search_similar_complaints" })
    },
    {
      icon: "message-text-outline",
      title: "Mesaj kayıtlarını incele",
      detail: (context) =>
        context.hasEvidence("E05")
          ? "Leyla’nın ödeme beyanıyla ilişkili iletişimi kontrol et."
          : "Ön koşul: Leyla’nın ayrıntılı ödeme beyanı.",
      disabled: (context) => !context.hasEvidence("E05"),
      isDone: (context) => context.hasEvidence("E07"),
      buildAction: () => ({ type: "inspect_phone_messages" })
    },
    {
      icon: "compare-horizontal",
      title: "Beyanları karşılaştır",
      detail: (context) =>
        context.hasEvidence("E06")
          ? "İki şikâyetteki ortak ve farklı noktaları çıkar."
          : "Ön koşul: benzer şikâyet kaydını aç.",
      disabled: (context) => !context.hasEvidence("E06"),
      isDone: (context) => context.hasEvidence("E08"),
      buildAction: () => ({ type: "compare_victim_statements" })
    }
  ],
  forensicsActions: [
    {
      icon: "flask-outline",
      title: "Nesne incelemesi iste",
      detail: (context) =>
        context.hasEvidence("E02")
          ? "Gösteri alanı notu mevcut; kurgusal inceleme raporu istenebilir."
          : "Ön koşul: Leyla’yla gösteri hakkında görüş ve sahne notu.",
      disabled: (context) => !context.hasEvidence("E02"),
      isDone: (context) => context.hasEvidence("E03"),
      buildAction: () => ({ type: "request_object_examination" })
    },
    {
      icon: "bank-check",
      title: "Ödeme iddiasını çapraz kontrol et",
      detail: (context) =>
        context.hasEvidence("E05") && context.hasEvidence("E07")
          ? "Mevcut dosyada bağımsız doğrulama sınırlarını incele."
          : "Ön koşul: ödeme beyanı ve mesaj incelemesi.",
      disabled: (context) => !context.hasEvidence("E05") || !context.hasEvidence("E07"),
      isDone: (context) => context.hasEvidence("E10"),
      buildAction: () => ({ type: "cross_check_payment_claim" })
    }
  ],
  prosecutionDefaults: {
    suspectId: "C02",
    crimeSummary: "Kurgusal gösteri ve ödeme iddiası, erişilmiş delillerle birlikte sunulur.",
    contradictionAnalysis: "Ödeme iddiasının bağımsız doğrulama sınırı açıkça belirtilir.",
    gaps: "Gerçek banka transferi yoktur; dosya bunu kesin suçluluk gibi sunmaz."
  }
};

const case002: CaseProfile = {
  caseId: "case-002",
  title: "Reddedilmenin Ölümcül Bedeli",
  eyebrow: "DOSYA 002 / BELGESEL UYARLAMASI",
  workspaceEyebrow: "CASE-002 / SORUŞTURMA",
  mapHeading: "Portsmouth, Virginia",
  mapStamp: "DOSYA 002",
  briefing: {
    classification: "GİZLİ",
    fileLabel: "İNCELEME DOSYASI",
    assignedDetective: "Dedektif McDaniel",
    firstStepHint: "Olay yeri özetini incele; giriş güzergâhı ve üst kat anlatımları bu adımdan açılır."
  },
  briefingLabel: "BAŞLANGIÇ TUTANAĞI",
  briefingText:
    "Belgesel anlatımına göre 16 yaşındaki Megan Landowski’nin evinde öldürülmüş olarak bulunmasıyla başlayan soruşturma, ilk şüphelilerin DNA ile elenmesinin ardından okul çevresinden tanınan Robert Burns/Barns’a yönelir. Bu dosyadaki tüm olay, bulgu ve ifadeler yalnızca belgesel anlatımındaki iddialardır.",
  statements: [
    {
      name: "Seslendirme · belgesel anlatımı",
      text: "Olay yeri anlatımında birinci kat penceresinden giriş, üst katta mücadele izleri, bant ve mutfakta bıçak bulunduğu aktarılır.",
      note: "Bu kart gerçek olay yeri fotoğrafı veya adli tıp raporu değildir."
    },
    {
      name: "Seslendirme · belgesel anlatımı",
      text: "DNA bulgularının Keith Camp ve Chris Short ile eşleşmediği; Robert Burns/Barns’ın verdiği sakız örneğinin kendisine ait olmadığı anlaşıldığı aktarılır."
    }
  ],
  disclaimer:
    "Bu paketteki olay, bulgu, ifade ve mahkûmiyet bilgileri yalnızca belgesel transkriptindeki iddialardır; bağımsız adli dosya, laboratuvar raporu veya mahkeme kaydı değildir. Kişi ve yer adlarındaki belirsizlikler korunmuştur. İçerik uyarısı: cinayet, cinsel şiddet ve reşit olmayan mağdur. Grafik ayrıntılar bilinçli olarak sınırlandırılmıştır.",
  startFeedback: "Dosya açıldı. Olay yeri anlatımı ve erişilebilir konumlar incelemeye hazır.",
  interviewSourceNote: "İfade, belgesel kaydına dayanır; bağımsız laboratuvar veya mahkeme kaydı değildir.",
  evidenceNames: {
    E01: "Olay yeri: mutfak",
    E02: "Pencere ve giriş güzergâhı",
    E03: "Üst kattaki bant ve mücadele izleri",
    E04: "Bıçak anlatımı",
    E05: "Olay yerindeki biyolojik örnek",
    E06: "Keith Camp DNA karşılaştırması",
    E07: "Chris Short DNA karşılaştırması",
    E08: "Sakız örneği ve yanıltıcı örnek",
    E09: "Okul çevresi ve tanışıklık",
    E10: "Şüphelinin anlatımı ve çelişkiler"
  },
  suspectTopicLabels: {
    prior_acquaintance: "Önceki tanışıklık",
    dna_sample_incident: "DNA örneği olayı",
    interview_account: "Verdiği ifade"
  },
  suspect: {
    characterId: "char-convicted",
    displayName: "Robert Burns/Barns",
    doneEvidenceId: "E10",
    finishEvidenceIds: ["E08", "E09"],
    finishRequirementText: "E08 sakız örneği ve E09 okul çevresi anlatımı gerekli.",
    minimumTopics: 2,
    topicCount: 3,
    targetMinutes: 2,
    startHint: "Önce okul çevresi anlatımını (E09) aç; Robert bu aşamada sorgulanabilir.",
    panelStartDetail:
      "Sunucu süreyi kaydeder. İki konu ve gerekli deliller sonrası hedef süre dolmadan da bitirebilirsin.",
    finishHint: "Sorguyu bitirmek için E08 sakız örneği ve E09 okul çevresi anlatımı gerekli.",
    topicsHint: "En az iki farklı konu hakkında soru sor.",
    corroboration: {
      characterId: "char-heather",
      topic: "school_social_circle",
      readyText: "Heather’ın okul çevresi ifadesi dosyada. Aynı noktayı tekrar sor; Robert yalnızca bu ifadenin desteklediği kısmı kabul edebilir.",
      pendingText: "Başka bir karakterden aynı konuyla ilgili ifade al; tekrar sorudaki baskı ancak bağımsız destekle anlam kazanır."
    }
  },
  forensicsLocationIds: [],
  investigationActions: [
    {
      icon: "home-search-outline",
      title: "Mutfak ve kan izlerini incele",
      detail: (context) =>
        !context.hasEvidence("E05")
          ? "Olay yeri özetini derinleştir; pencere, bant ve bıçak anlatımlarını aç."
          : "Bu adım tamamlandı.",
      disabled: (context) => context.hasEvidence("E05"),
      buildAction: () => ({ type: "visit_location", locationId: "LOC-kitchen" })
    },
    {
      icon: "window-open-variant",
      title: "Giriş güzergâhını incele",
      detail: (context) =>
        !context.hasEvidence("E02")
          ? "Önce olay yeri özetini (mutfak) incele."
          : context.hasEvidence("E08")
            ? "Bu adım tamamlandı."
            : "Pencere anlatımı mevcut; biyolojik örnek ve elenme anlatımlarını derinleştir.",
      disabled: (context) => !context.hasEvidence("E02") || context.hasEvidence("E08"),
      buildAction: () => ({ type: "visit_location", locationId: "LOC-window" })
    },
    {
      icon: "school-outline",
      title: "Okul çevresini araştır",
      detail: (context) =>
        !context.hasEvidence("E03")
          ? "Önce üst kat ve bant anlatımını (E03) aç."
          : context.hasEvidence("E09")
            ? "Bu adım tamamlandı."
            : "Eski tanışıklık ve arkadaş çevresi anlatısını gündeme getir.",
      disabled: (context) => !context.hasEvidence("E03") || context.hasEvidence("E09"),
      buildAction: () => ({ type: "visit_location", locationId: "LOC-upstairs" })
    },
    {
      icon: "account-details-outline",
      title: "Şüpheli anlatımını çapraz kontrol et",
      detail: (context) =>
        !context.hasEvidence("E09")
          ? "Önce okul çevresi anlatımını (E09) aç."
          : context.hasEvidence("E10")
            ? "Bu adım tamamlandı."
            : "Maskeli saldırgan anlatımını olay yeri bulgularıyla karşılaştır.",
      disabled: (context) => !context.hasEvidence("E09") || context.hasEvidence("E10"),
      buildAction: () => ({ type: "cross_check_payment_claim" })
    }
  ],
  forensicsActions: [],
  prosecutionDefaults: {
    suspectId: "char-convicted",
    crimeSummary:
      "Belgesel anlatımına göre olay yeri, biyolojik örnek, elenmeler, sakız örneği olayı ve şüpheli anlatımı birlikte sunulur.",
    contradictionAnalysis:
      "Maskeli saldırgan anlatımı üst kat bulgularıyla çelişir; sakız örneği güvenilir bir eşleşme değildir.",
    gaps:
      "Tüm bulgular belgesel anlatımıdır; bağımsız laboratuvar veya mahkeme kaydı dosyada yoktur. Reddedilme motivasyonu yalnızca belgeseldeki teori olarak değerlendirilir."
  }
};

const profiles: Record<string, CaseProfile> = {
  "case-001": case001,
  "case-002": case002
};

export function getCaseProfile(caseId: string | undefined): CaseProfile {
  if (caseId && profiles[caseId]) return profiles[caseId];
  return caseId ? genericProfile(caseId) : case001;
}

export function listCaseProfiles(): CaseProfile[] {
  return Object.values(profiles);
}

