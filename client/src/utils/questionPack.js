export const AI_QUIZ_PROMPT = `Create a Finnival trivia quiz in raw JSON ONLY (no extra explanation).
Use this exact schema and mix question types ("classic", "short_answer", "slider", "match"):

{
  "name": "Quiz Title",
  "questions": [
    { "type": "classic", "text": "Multiple choice question?", "options": ["A", "B", "C", "D"], "correctAnswer": 0, "timeLimit": 20 },
    { "type": "short_answer", "text": "Short answer question?", "correctAnswerText": "Primary answer", "acceptedAnswers": ["Optional alias"], "timeLimit": 25 },
    { "type": "slider", "text": "Numeric guess question?", "min": 0, "max": 100, "correctNumber": 50, "timeLimit": 20 },
    { "type": "match", "text": "Match the pairs:", "pairs": [{"left": "Item 1", "right": "Match 1"}, {"left": "Item 2", "right": "Match 2"}], "timeLimit": 30 }
  ]
}

Topic & number of questions: [TYPE YOUR TOPIC AND COUNT HERE]`;

export function downloadJsonPack(packName, questionsList) {
  const safeName = String(packName || 'finnival-pack')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'finnival-pack';
  const payload = {
    name: packName || 'Finnival Question Pack',
    exportedAt: new Date().toISOString(),
    questions: questionsList
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function extractJsonText(rawText) {
  let cleaned = String(rawText || '').trim();
  // Strip markdown code fences if copied from AI chat
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // If surrounded by conversational prose, slice from first { or [ to last } or ]
  const firstObj = cleaned.indexOf('{');
  const firstArr = cleaned.indexOf('[');
  let start = -1;
  if (firstObj !== -1 && firstArr !== -1) start = Math.min(firstObj, firstArr);
  else start = Math.max(firstObj, firstArr);

  if (start > 0) {
    const endChar = cleaned[start] === '[' ? ']' : '}';
    const end = cleaned.lastIndexOf(endChar);
    if (end > start) cleaned = cleaned.slice(start, end + 1);
  }
  return cleaned;
}

function detectQuestionType(q) {
  const rawType = String(q.type || q.question_type || '').trim().toLowerCase();
  if (['classic', 'mcq', 'multiple_choice', 'multiple-choice', 'choice', 'true_false', 'boolean'].includes(rawType)) {
    return 'classic';
  }
  if (['short_answer', 'short-answer', 'short', 'text', 'fill_blank', 'open'].includes(rawType)) {
    return 'short_answer';
  }
  if (['slider', 'range', 'number', 'estimate'].includes(rawType)) {
    return 'slider';
  }
  if (['match', 'matching', 'pairs'].includes(rawType)) {
    return 'match';
  }

  // Infer type when omitted by generic AI generators
  if (Array.isArray(q.pairs) && q.pairs.length >= 2) return 'match';
  if ((q.min !== undefined && q.max !== undefined) || q.correctNumber !== undefined || q.correct_number !== undefined) return 'slider';
  if (Array.isArray(q.options) && q.options.length >= 2) return 'classic';
  if ((q.correctAnswerText ?? q.correct_answer_text ?? q.correct_answer ?? q.answer) !== undefined) return 'short_answer';
  return 'classic';
}

function resolveClassicCorrectIndex(q, opts) {
  const raw = q.correctAnswer ?? q.correct_answer ?? q.answer ?? q.correctOption ?? q.correct_option ?? q.correct;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.min(opts.length - 1, Math.max(0, Math.round(raw)));
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    const lower = trimmed.toLowerCase();

    // 1. Exact option text match (case-insensitive)
    const exactIdx = opts.findIndex((o) => o.toLowerCase() === lower);
    if (exactIdx !== -1) return exactIdx;

    // 2. Single option letter like "A", "B", "C", "D"
    if (/^[a-z]$/i.test(trimmed)) {
      const letterIdx = lower.charCodeAt(0) - 97;
      if (letterIdx >= 0 && letterIdx < opts.length) return letterIdx;
    }

    // 3. Numeric index string like "2"
    if (/^\d+$/.test(trimmed)) {
      return Math.min(opts.length - 1, Math.max(0, parseInt(trimmed, 10)));
    }
  }
  return 0;
}

export function parseImportedPack(rawText) {
  const parsed = JSON.parse(extractJsonText(rawText));
  const rawQuestions = Array.isArray(parsed)
    ? parsed
    : (parsed?.questions || parsed?.quiz || parsed?.items);

  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    throw new Error('JSON must contain a non-empty "questions" array (or be an array of questions).');
  }

  const normalized = [];
  rawQuestions.forEach((q) => {
    if (!q || typeof q !== 'object') return;
    const qText = String(q.text ?? q.question ?? q.prompt ?? q.title ?? '').trim().slice(0, 200);
    if (!qText) return;

    const type = detectQuestionType(q);
    const timeVal = Math.max(5, Math.round(Number(q.timeLimit ?? q.time_limit ?? q.duration)) || 20);
    const img = String(q.imageUrl ?? q.image_url ?? q.image ?? '').trim();

    if (type === 'classic') {
      const opts = Array.isArray(q.options)
        ? q.options
            .map((o) => (o && typeof o === 'object' ? (o.text ?? o.label ?? '') : o))
            .map((o) => String(o || '').trim())
            .filter(Boolean)
        : [];
      if (opts.length < 2) return;
      const corr = resolveClassicCorrectIndex(q, opts);
      normalized.push({
        type,
        text: qText,
        options: opts,
        correctAnswer: corr,
        correctAnswerText: '',
        min: 0,
        max: 100,
        correctNumber: 50,
        pairs: [{ left: '', right: '' }, { left: '', right: '' }],
        timeLimit: timeVal,
        image: img || null,
        imageUrl: img
      });
    } else if (type === 'short_answer') {
      const ansTxt = String(
        q.correctAnswerText ??
        q.correct_answer_text ??
        q.correct_answer ??
        q.answer ??
        (typeof q.correctAnswer === 'string' ? q.correctAnswer : '')
      ).trim();
      const rawAliases = q.acceptedAnswers ?? q.accepted_answers ?? q.aliases;
      const acceptedAnswers = Array.isArray(rawAliases)
        ? Array.from(
            new Set(
              rawAliases
                .map((a) => String(a || '').trim().slice(0, 80))
                .filter((a) => a && a.toLowerCase() !== ansTxt.toLowerCase())
            )
          ).slice(0, 8)
        : [];
      normalized.push({
        type,
        text: qText,
        options: ['', '', '', ''],
        correctAnswer: 0,
        correctAnswerText: ansTxt,
        acceptedAnswers,
        min: 0,
        max: 100,
        correctNumber: 50,
        pairs: [{ left: '', right: '' }, { left: '', right: '' }],
        timeLimit: timeVal,
        image: img || null,
        imageUrl: img
      });
    } else if (type === 'slider') {
      const min = Number.isFinite(Number(q.min)) ? Number(q.min) : 0;
      const max = Number.isFinite(Number(q.max)) ? Number(q.max) : 100;
      const rawTarget = q.correctNumber ?? q.correct_number ?? q.correct_answer ?? q.answer;
      const correctNumber = Number.isFinite(Number(rawTarget)) ? Number(rawTarget) : Math.round((min + max) / 2);
      normalized.push({
        type,
        text: qText,
        options: ['', '', '', ''],
        correctAnswer: 0,
        correctAnswerText: '',
        min,
        max,
        correctNumber,
        pairs: [{ left: '', right: '' }, { left: '', right: '' }],
        timeLimit: timeVal,
        image: img || null,
        imageUrl: img
      });
    } else if (type === 'match') {
      const pairs = Array.isArray(q.pairs)
        ? q.pairs
            .map((p) => {
              if (Array.isArray(p)) return { left: String(p[0] || '').trim(), right: String(p[1] || '').trim() };
              return {
                left: String(p?.left ?? p?.term ?? p?.key ?? p?.a ?? '').trim(),
                right: String(p?.right ?? p?.definition ?? p?.value ?? p?.b ?? '').trim()
              };
            })
            .filter((p) => p.left && p.right)
        : [];
      if (pairs.length < 2) return;
      normalized.push({
        type,
        text: qText,
        options: ['', '', '', ''],
        correctAnswer: 0,
        correctAnswerText: '',
        min: 0,
        max: 100,
        correctNumber: 50,
        pairs,
        timeLimit: timeVal,
        image: img || null,
        imageUrl: img
      });
    }
  });

  if (normalized.length === 0) {
    throw new Error('No valid questions found in JSON.');
  }

  const rawName = parsed?.name ?? parsed?.title;
  return {
    name: typeof rawName === 'string' && rawName.trim() ? rawName.trim() : null,
    questions: normalized
  };
}
