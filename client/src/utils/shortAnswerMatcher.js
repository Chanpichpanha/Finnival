const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'and', 'or', 'for', 'by', 'is'
]);

const NUMBER_WORDS = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15',
  sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20',
  thirty: '30', forty: '40', fifty: '50', sixty: '60', seventy: '70',
  eighty: '80', ninety: '90', hundred: '100', thousand: '1000',
  first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th',
  sixth: '6th', seventh: '7th', eighth: '8th', ninth: '9th', tenth: '10th'
};

function normalizeTokens(raw) {
  const cleaned = String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}+#\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return [];
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((tok) => NUMBER_WORDS[tok] || tok);
}

function getContentTokens(tokens) {
  const filtered = tokens.filter((t) => !STOP_WORDS.has(t));
  return filtered.length > 0 ? filtered : tokens;
}

function hasDigits(str) {
  return /\d/.test(str);
}

function extractDigitSequences(tokens) {
  const digits = [];
  for (const tok of tokens) {
    const matches = tok.match(/\d+/g);
    if (matches) digits.push(...matches);
  }
  return digits;
}

function stemLatinToken(token) {
  if (!/^[a-z]+$/.test(token) || token.length < 5) return token;
  if (token.endsWith('ing') && token.length - 3 >= 4) return token.slice(0, -3);
  if (token.endsWith('ed') && token.length - 2 >= 4) return token.slice(0, -2);
  if (token.endsWith('es') && token.length - 2 >= 4) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss') && token.length - 1 >= 4) return token.slice(0, -1);
  return token;
}

function damerauLevenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  if (Math.abs(m - n) > 2) return 3;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, dp[i - 2][j - 2] + 1);
      }
      dp[i][j] = val;
    }
  }
  return dp[m][n];
}

function matchTokenPair(pTok, tTok) {
  if (pTok === tTok) return 'exact';

  if (hasDigits(pTok) || hasDigits(tTok)) {
    const pNums = (pTok.match(/\d+/g) || []).join(',');
    const tNums = (tTok.match(/\d+/g) || []).join(',');
    if (pNums !== tNums) return null;
    if (stemLatinToken(pTok) === stemLatinToken(tTok)) return 'exact';
    return null;
  }

  if (pTok.includes('+') || pTok.includes('#') || tTok.includes('+') || tTok.includes('#')) {
    return null;
  }

  if (stemLatinToken(pTok) === stemLatinToken(tTok)) return 'exact';

  const maxLen = Math.max(pTok.length, tTok.length);
  const minLen = Math.min(pTok.length, tTok.length);
  if (minLen >= 4 && maxLen >= 5) {
    const dist = damerauLevenshtein(pTok, tTok);
    const maxAllowed = maxLen >= 9 ? 2 : 1;
    if (dist <= maxAllowed) return 'typo';
  }

  return null;
}

function evaluateSingleTarget(playerRaw, targetRaw) {
  const wrong = { isCorrect: false, accuracy: 0, matchType: 'wrong' };
  const pAll = normalizeTokens(playerRaw);
  const tAll = normalizeTokens(targetRaw);
  if (pAll.length === 0 || tAll.length === 0) return wrong;

  const pContent = getContentTokens(pAll);
  const tContent = getContentTokens(tAll);

  const pDigits = extractDigitSequences(pAll);
  const tDigits = extractDigitSequences(tAll);
  if (tDigits.length > 0) {
    if (pDigits.length === 0) return wrong;
    const missingOrWrongDigit = pDigits.some((d) => !tDigits.includes(d));
    if (missingOrWrongDigit) return wrong;
  }

  const pCompact = pAll.join('');
  const tCompact = tAll.join('');
  const pContentCompact = pContent.join('');
  const tContentCompact = tContent.join('');

  if (pCompact === tCompact || pContentCompact === tContentCompact) {
    return { isCorrect: true, accuracy: 1, matchType: 'exact' };
  }

  if (!hasDigits(tCompact) && !tCompact.includes('+') && !tCompact.includes('#')) {
    const maxLen = Math.max(pContentCompact.length, tContentCompact.length);
    const minLen = Math.min(pContentCompact.length, tContentCompact.length);
    if (minLen >= 4 && maxLen >= 5) {
      const dist = damerauLevenshtein(pContentCompact, tContentCompact);
      const maxAllowed = maxLen >= 9 ? 2 : 1;
      if (dist <= maxAllowed) {
        return { isCorrect: true, accuracy: 1, matchType: 'typo' };
      }
    }
  }

  const usedTarget = new Set();
  const usedPlayer = new Set();
  let exactMatches = 0;
  let typoMatches = 0;
  const matchedTargets = [];

  for (let pi = 0; pi < pContent.length; pi += 1) {
    for (let ti = 0; ti < tContent.length; ti += 1) {
      if (usedTarget.has(ti)) continue;
      if (matchTokenPair(pContent[pi], tContent[ti]) === 'exact') {
        usedPlayer.add(pi);
        usedTarget.add(ti);
        exactMatches += 1;
        matchedTargets.push(tContent[ti]);
        break;
      }
    }
  }

  for (let pi = 0; pi < pContent.length; pi += 1) {
    if (usedPlayer.has(pi)) continue;
    for (let ti = 0; ti < tContent.length; ti += 1) {
      if (usedTarget.has(ti)) continue;
      if (matchTokenPair(pContent[pi], tContent[ti]) === 'typo') {
        usedPlayer.add(pi);
        usedTarget.add(ti);
        typoMatches += 1;
        matchedTargets.push(tContent[ti]);
        break;
      }
    }
  }

  const matchedTotal = exactMatches + typoMatches;
  if (matchedTotal === 0) return wrong;

  if (matchedTotal === tContent.length) {
    if (pContent.length === tContent.length || pContent.length <= tContent.length + 1) {
      return { isCorrect: true, accuracy: 1, matchType: typoMatches > 0 ? 'typo' : 'exact' };
    }
    return wrong;
  }

  const precision = matchedTotal / pContent.length;
  const coverage = matchedTotal / tContent.length;
  const hasSubstantialMatch = matchedTargets.some((t) => t.length >= 3 || hasDigits(t));

  if (tContent.length >= 2 && hasSubstantialMatch && coverage >= 0.45 && precision >= 0.65) {
    const accuracy = Math.min(0.88, Math.max(0.65, Math.round((0.5 + 0.4 * coverage) * 100) / 100));
    return { isCorrect: true, accuracy, matchType: 'partial' };
  }

  return wrong;
}

export function evaluateShortAnswer(playerRaw, targetRaw, acceptedAnswers = []) {
  const candidates = [
    targetRaw,
    ...(Array.isArray(acceptedAnswers) ? acceptedAnswers : [])
  ]
    .map((c) => String(c || '').trim())
    .filter(Boolean);

  let best = { isCorrect: false, accuracy: 0, matchType: 'wrong' };
  const rank = { wrong: 0, partial: 1, typo: 2, exact: 3 };

  for (const candidate of candidates) {
    const res = evaluateSingleTarget(playerRaw, candidate);
    if (
      res.accuracy > best.accuracy ||
      (res.accuracy === best.accuracy && rank[res.matchType] > rank[best.matchType])
    ) {
      best = res;
      if (best.accuracy === 1 && best.matchType === 'exact') break;
    }
  }

  return best;
}
