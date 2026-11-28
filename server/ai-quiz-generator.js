const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) return;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && val) {
        process.env[key] = val;
      }
    });
  } catch (e) {
    // ignore malformed .env
  }
}

function initEnv() {
  loadEnvFile(path.join(__dirname, '.env'));
  loadEnvFile(path.join(__dirname, '..', '.env'));
}

const VALID_TYPES = ['classic', 'short_answer', 'slider', 'match'];

function extractJsonText(rawText) {
  let cleaned = String(rawText || '').trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
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

function resolveClassicCorrectIndex(q, opts) {
  const raw = q.correctAnswer ?? q.correct_answer ?? q.answer ?? q.correctOption ?? q.correct_option ?? q.correct;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.min(opts.length - 1, Math.max(0, Math.round(raw)));
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    const lower = trimmed.toLowerCase();
    const exactIdx = opts.findIndex((o) => o.toLowerCase() === lower);
    if (exactIdx !== -1) return exactIdx;
    if (/^[a-z]$/i.test(trimmed)) {
      const letterIdx = lower.charCodeAt(0) - 97;
      if (letterIdx >= 0 && letterIdx < opts.length) return letterIdx;
    }
    if (/^\d+$/.test(trimmed)) {
      return Math.min(opts.length - 1, Math.max(0, parseInt(trimmed, 10)));
    }
  }
  return 0;
}

function validateAndNormalizeAiOutput(rawContent, defaultTimeLimit = 20) {
  const parsed = typeof rawContent === 'string' ? JSON.parse(extractJsonText(rawContent)) : rawContent;
  const rawQuestions = Array.isArray(parsed)
    ? parsed
    : (parsed?.questions || parsed?.quiz || parsed?.items);

  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    throw new Error('AI returned an empty or missing questions array.');
  }

  const normalized = [];
  rawQuestions.forEach((q) => {
    if (!q || typeof q !== 'object') return;
    const text = String(q.text ?? q.question ?? q.prompt ?? '').trim().slice(0, 200);
    if (!text) return;

    const rawType = String(q.type || '').trim().toLowerCase();
    let type = VALID_TYPES.includes(rawType) ? rawType : 'classic';
    if (!VALID_TYPES.includes(rawType)) {
      if (Array.isArray(q.pairs) && q.pairs.length >= 2) type = 'match';
      else if (q.min !== undefined && q.max !== undefined) type = 'slider';
      else if (Array.isArray(q.options) && q.options.length >= 2) type = 'classic';
      else if (q.correctAnswerText ?? q.correct_answer ?? q.answer) type = 'short_answer';
    }

    const timeLimit = Math.max(5, Math.round(Number(q.timeLimit ?? q.time_limit ?? defaultTimeLimit)) || 20);

    if (type === 'classic') {
      const opts = Array.isArray(q.options)
        ? q.options.map((o) => String(o || '').trim().slice(0, 80)).filter(Boolean)
        : [];
      if (opts.length < 2) return;
      const correctAnswer = resolveClassicCorrectIndex(q, opts);
      normalized.push({
        type: 'classic',
        text,
        options: opts,
        correctAnswer,
        correctAnswerText: '',
        min: 0,
        max: 100,
        correctNumber: 50,
        pairs: [{ left: '', right: '' }, { left: '', right: '' }],
        timeLimit,
        image: null,
        imageUrl: ''
      });
    } else if (type === 'short_answer') {
      const ans = String(q.correctAnswerText ?? q.correct_answer ?? q.answer ?? '').trim().slice(0, 80);
      if (!ans) return;
      const rawAliases = q.acceptedAnswers ?? q.accepted_answers ?? q.aliases;
      const acceptedAnswers = Array.isArray(rawAliases)
        ? Array.from(
            new Set(
              rawAliases
                .map((a) => String(a || '').trim().slice(0, 80))
                .filter((a) => a && a.toLowerCase() !== ans.toLowerCase())
            )
          ).slice(0, 6)
        : [];
      normalized.push({
        type: 'short_answer',
        text,
        options: ['', '', '', ''],
        correctAnswer: 0,
        correctAnswerText: ans,
        acceptedAnswers,
        min: 0,
        max: 100,
        correctNumber: 50,
        pairs: [{ left: '', right: '' }, { left: '', right: '' }],
        timeLimit,
        image: null,
        imageUrl: ''
      });
    } else if (type === 'slider') {
      let min = Number(q.min);
      let max = Number(q.max);
      if (!Number.isFinite(min)) min = 0;
      if (!Number.isFinite(max) || max <= min) max = min + 100;
      let target = Number(q.correctNumber ?? q.correct_answer ?? q.answer);
      if (!Number.isFinite(target)) target = Math.round((min + max) / 2);
      target = Math.min(max, Math.max(min, target));
      normalized.push({
        type: 'slider',
        text,
        options: ['', '', '', ''],
        correctAnswer: 0,
        correctAnswerText: '',
        min,
        max,
        correctNumber: target,
        pairs: [{ left: '', right: '' }, { left: '', right: '' }],
        timeLimit,
        image: null,
        imageUrl: ''
      });
    } else if (type === 'match') {
      const pairs = Array.isArray(q.pairs)
        ? q.pairs
            .map((p) => {
              if (Array.isArray(p)) return { left: String(p[0] || '').trim().slice(0, 60), right: String(p[1] || '').trim().slice(0, 60) };
              return {
                left: String(p?.left ?? p?.term ?? p?.key ?? '').trim().slice(0, 60),
                right: String(p?.right ?? p?.definition ?? p?.value ?? '').trim().slice(0, 60)
              };
            })
            .filter((p) => p.left && p.right)
            .slice(0, 6)
        : [];
      if (pairs.length < 2) return;
      normalized.push({
        type: 'match',
        text,
        options: ['', '', '', ''],
        correctAnswer: 0,
        correctAnswerText: '',
        min: 0,
        max: 100,
        correctNumber: 50,
        pairs,
        timeLimit,
        image: null,
        imageUrl: ''
      });
    }
  });

  if (normalized.length === 0) {
    throw new Error('AI response did not produce any usable Finnival questions.');
  }

  return {
    packName: String(parsed?.name || parsed?.title || '').trim().slice(0, 60) || null,
    questions: normalized
  };
}

function buildQuizPrompts({ topic, count, types, difficulty, timeLimit }) {
  const activeTypes = Array.isArray(types) && types.length > 0
    ? types.filter((t) => VALID_TYPES.includes(t))
    : [...VALID_TYPES];
  const chosenTypes = activeTypes.length > 0 ? activeTypes : ['classic'];

  const typeRules = [];
  if (chosenTypes.includes('classic')) {
    typeRules.push(`- "classic": {"type": "classic", "text": "question (<=180 chars)", "options": ["opt1", "opt2", "opt3", "opt4"], "correctAnswer": 0_based_integer_index, "timeLimit": ${timeLimit}}`);
  }
  if (chosenTypes.includes('short_answer')) {
    typeRules.push(`- "short_answer": {"type": "short_answer", "text": "question requiring 1-3 word answer", "correctAnswerText": "primary short answer", "acceptedAnswers": ["optional alias or short form"], "timeLimit": ${timeLimit}}`);
  }
  if (chosenTypes.includes('slider')) {
    typeRules.push(`- "slider": {"type": "slider", "text": "numeric estimate/year/count question", "min": number, "max": number, "correctNumber": number_strictly_between_min_and_max, "timeLimit": ${timeLimit}}`);
  }
  if (chosenTypes.includes('match')) {
    typeRules.push(`- "match": {"type": "match", "text": "Match each item correctly:", "pairs": [{"left": "Item A", "right": "Match A"}, {"left": "Item B", "right": "Match B"}, {"left": "Item C", "right": "Match C"}], "timeLimit": ${timeLimit}}`);
  }

  const systemPrompt = `You are a trivia quiz generator for Finnival. Always reply with strictly valid raw JSON matching this schema and NO markdown or extra commentary:
{
  "name": "Short Quiz Title",
  "questions": [ ... ]
}
Allowed question schemas (ONLY use these types: ${chosenTypes.join(', ')}):
${typeRules.join('\n')}`;

  const userPrompt = `Generate ${count} fun, factually accurate trivia questions about: "${topic}".
If the topic/prompt above explicitly asks for a different total count (up to 25) or specific per-type breakdown, follow that explicit instruction; otherwise mix evenly across: ${chosenTypes.join(', ')}.
Difficulty: ${difficulty || 'mixed'}.
Make sure all correctAnswer indices are 0-based integers, slider targets sit strictly inside [min, max], short_answer answers are concise (1-3 words), and match pairs have 3 unique pairs each.`;

  return { systemPrompt, userPrompt };
}

async function callGemini({ apiKey, systemPrompt, userPrompt }) {
  const candidates = Array.from(
    new Set([
      process.env.GEMINI_MODEL,
      'gemini-3.8-flash',
      'gemini-3.1-flash-lite',
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash'
    ].filter(Boolean))
  );

  let lastErr = null;
  for (const model of candidates) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.7
        }
      })
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      lastErr = new Error(`Gemini (${model}) HTTP ${res.status}: ${errBody.slice(0, 160)}`);
      // Retry next candidate model if unsupported, rate-limited, or temporarily unavailable
      if (res.status === 404 || res.status === 429 || res.status === 503) continue;
      throw lastErr;
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error(`Gemini (${model}) returned no text content.`);
    }
    return { rawText: text, modelUsed: `gemini:${model}` };
  }
  throw lastErr || new Error('Gemini request failed for all candidate models.');
}

async function callGroq({ apiKey, systemPrompt, userPrompt }) {
  const candidates = Array.from(
    new Set([
      process.env.GROQ_MODEL,
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'qwen/qwen3.8-27b'
    ].filter(Boolean))
  );

  let lastErr = null;
  for (const model of candidates) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.7
        })
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        lastErr = new Error(`Groq (${model}) HTTP ${res.status}: ${errBody.slice(0, 160)}`);
        if (res.status === 404 || res.status === 429 || res.status === 503) continue;
        throw lastErr;
      }

      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error(`Groq (${model}) returned empty message content.`);
      }
      return { rawText: text, modelUsed: `groq:${model}` };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Groq request failed for all candidate models.');
}

async function detectOllamaModel(baseUrl, preferredModel, timeoutMs = 1500) {
  const tagsRes = await fetch(`${baseUrl}/api/tags`, {
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!tagsRes.ok) {
    throw new Error(`Ollama unreachable at ${baseUrl}`);
  }
  const tagsData = await tagsRes.json();
  const installed = (tagsData?.models || []).map((m) => m.name).filter(Boolean);
  if (installed.length === 0) {
    throw new Error('Ollama is running, but no models are pulled yet (run e.g. `ollama pull llama3.2`).');
  }
  if (preferredModel) {
    const exact = installed.find((m) => m === preferredModel || m.startsWith(`${preferredModel}:`));
    if (exact) return exact;
  }
  return installed[0];
}

async function callOllama({ baseUrl, preferredModel, systemPrompt, userPrompt }) {
  const model = await detectOllamaModel(baseUrl, preferredModel);
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      format: 'json',
      stream: false
    })
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Ollama (${model}) HTTP ${res.status}: ${errBody.slice(0, 160)}`);
  }

  const data = await res.json();
  const text = data?.message?.content;
  if (!text) {
    throw new Error('Ollama returned empty response.');
  }
  return { rawText: text, modelUsed: `ollama:${model}` };
}

async function getAiStatus() {
  const ollamaUrl = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '');
  const preferredOllama = process.env.OLLAMA_MODEL || 'llama3.2';
  let ollamaAvailable = false;

  if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
    try {
      await detectOllamaModel(ollamaUrl, preferredOllama, 700);
      ollamaAvailable = true;
    } catch (e) {
      ollamaAvailable = false;
    }
  }

  return {
    available: Boolean(process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY || ollamaAvailable)
  };
}

async function generateQuiz({
  topic,
  count = 10,
  types = VALID_TYPES,
  difficulty = 'mixed',
  timeLimit = 20
}) {
  initEnv();
  const cleanTopic = String(topic || '').trim().slice(0, 400);
  if (!cleanTopic) {
    throw new Error('Please enter a quiz topic first.');
  }
  const safeCount = Math.min(25, Math.max(1, Math.round(Number(count)) || 10));
  const safeTime = Math.max(5, Math.round(Number(timeLimit)) || 20);

  const { systemPrompt, userPrompt } = buildQuizPrompts({
    topic: cleanTopic,
    count: safeCount,
    types,
    difficulty,
    timeLimit: safeTime
  });

  // Systematic automatic backend fallback: Gemini -> Groq -> Local Ollama
  const geminiKey = String(process.env.GEMINI_API_KEY || '').trim();
  const groqKey = String(process.env.GROQ_API_KEY || '').trim();
  const ollamaUrl = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '');
  const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2';

  const chain = [];
  if (geminiKey) chain.push({ name: 'gemini', run: () => callGemini({ apiKey: geminiKey, systemPrompt, userPrompt }) });
  if (groqKey) chain.push({ name: 'groq', run: () => callGroq({ apiKey: groqKey, systemPrompt, userPrompt }) });
  chain.push({ name: 'ollama', run: () => callOllama({ baseUrl: ollamaUrl, preferredModel: ollamaModel, systemPrompt, userPrompt }) });

  const errors = [];
  for (const step of chain) {
    try {
      const { rawText, modelUsed } = await step.run();
      const normalized = validateAndNormalizeAiOutput(rawText, safeTime);
      return {
        ...normalized,
        providerUsed: modelUsed
      };
    } catch (err) {
      errors.push(`${step.name}: ${err.message}`);
    }
  }

  // Keep detailed provider diagnostics server-side; show clean, non-technical messages to players/hosts
  console.error('[AI Quiz Generator] All backends failed:', errors.join(' | '));

  const hasCloudKeys = Boolean(geminiKey || groqKey);
  if (!hasCloudKeys && errors.length === 1 && errors[0].startsWith('ollama:')) {
    throw new Error("AI generator isn't enabled on this server yet. Add questions manually or import a quiz pack!");
  }
  throw new Error('Could not generate questions right now. Please try again in a moment, or add questions manually.');
}

module.exports = {
  initEnv,
  getAiStatus,
  generateQuiz,
  validateAndNormalizeAiOutput
};
