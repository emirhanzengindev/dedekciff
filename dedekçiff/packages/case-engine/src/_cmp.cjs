const fs = require('fs');
const src = fs.readFileSync('c:/Users/emirhanzengin/Desktop/dedekçiff/packages/case-engine/src/engine.ts', 'utf8');
const i = src.indexOf('function findQuestionEvidence');
const j = src.indexOf('function conditionSatisfied', i);
const fileFunc = src.slice(i, j);

// Reconstruct the old_text exactly as the assistant intended
const oldText = `function findQuestionEvidence(caseData: CaseData, characterId: Id, accessibleEvidence: CaseEvidence[], question: string): CaseEvidence | undefined {
  const allowedIds = evidenceScopeAllows(caseData.rules, characterId, accessibleEvidence);
  const ignoredWords = new Set([
    "acaba", "bana", "bunu", "biliyor", "diye", "gerçekten", "hangi", "hakkında", "nasıl", "nerede",
    "oldu", "olmuş", "sence", "söyler", "söyle", "şey", "var", "yok", "mi", "mı", "mu", "mü"
  ]);
  const words = normalize(question)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    .filter((word) => word.length >= 4 && !ignoredWords.has(word));
  if (words.length === 0) return undefined;

  return accessibleEvidence.find((evidence) => {
    if (!allowedIds.has(evidence.id)) return false;
    const facts = normalize(evidence.facts.join(" ")).replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/u);
    return words.some((questionWord) => facts.some((factWord) =>
      factWord === questionWord ||
      (Math.min(factWord.length, questionWord.length) >= 5 &&
        (factWord.startsWith(questionWord.slice(0, 5)) ||
          questionWord.startsWith(factWord.slice(0, 5))))
    ));
  });
}`;

console.log('oldText in file:', fileFunc === oldText);
if (fileFunc !== oldText) {
  for (let k = 0; k < Math.max(fileFunc.length, oldText.length); k++) {
    const a = fileFunc[k], b = oldText[k];
    if (a !== b) {
      console.log('mismatch at', k);
      console.log('file char:', JSON.stringify(a), 'code:', a.codePointAt(0));
      console.log('old char:', JSON.stringify(b), 'code:', b.codePointAt(0));
      break;
    }
  }
}
