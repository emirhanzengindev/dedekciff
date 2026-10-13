import type { CharacterReply, Id } from "@case-001/shared";

export interface QuestionInput {
  question: string;
  characterId: Id;
  unlockedEvidenceIds: Id[];
}

export interface QuestionIntent {
  topic: string;
  confidence: number;
}

export interface CharacterReplyInput extends QuestionInput {
  allowedFacts: string[];
}

export interface AIProvider {
  classifyQuestion(input: QuestionInput): Promise<QuestionIntent>;
  generateCharacterReply(input: CharacterReplyInput): Promise<CharacterReply>;
}

export class MockAIProvider implements AIProvider {
  async classifyQuestion(input: QuestionInput): Promise<QuestionIntent> {
    const question = input.question.toLocaleLowerCase("tr-TR");
    if (question.includes("ödeme") || question.includes("para") || question.includes("banka")) {
      return { topic: "payment_details", confidence: 0.9 };
    }
    if (question.includes("göster") || question.includes("altın")) {
      return { topic: "show_details", confidence: 0.85 };
    }
    return { topic: "general", confidence: 0.6 };
  }

  async generateCharacterReply(input: CharacterReplyInput): Promise<CharacterReply> {
    return {
      status: input.allowedFacts.length > 0 ? "answered" : "unknown",
      answer:
        input.allowedFacts.length > 0
          ? input.allowedFacts.join(" ")
          : "Bu konuda erişilebilir ve doğrulanmış bilgi bulunmuyor.",
      supportingEvidenceIds: input.unlockedEvidenceIds,
      newlyUnlockedEvidenceIds: [],
      confidence: 0.7
    };
  }
}

export function createAIProvider(): AIProvider {
  return new MockAIProvider();
}
