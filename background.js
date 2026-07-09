// PrepPush - background.js (Milestone 4)
// Handles: LLM analysis, submission storage, GitHub push

console.log('[PrepPush] Background service worker started ✅');

const DEFAULT_GITHUB_REPO = 'hackerrank-solutions';
const HACKERRANK_TAB_URL = ['https://www.hackerrank.com/*'];
const CONTENT_SCRIPT_ID = 'preppush-content';

async function registerPrepPushContentScripts() {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts();
    const current = existing?.find((s) => s.id === CONTENT_SCRIPT_ID);
    if (
      current &&
      current.matches?.includes('https://www.hackerrank.com/*') &&
      current.runAt === 'document_start' &&
      current.allFrames === true
    ) {
      return;
    }
    if (current) {
      await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    }
  } catch (e) {
    console.warn('[PrepPush] unregister content scripts:', e?.message || e);
  }
  await chrome.scripting.registerContentScripts([
    {
      id: CONTENT_SCRIPT_ID,
      js: ['content.js'],
      matches: HACKERRANK_TAB_URL,
      runAt: 'document_start',
      allFrames: true,
    },
  ]);
}

async function tabHasContentScript(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return res?.status === 'alive';
  } catch {
    return false;
  }
}

async function probeContentScriptInit(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => ({
        hasInit: !!globalThis.__preppushContentInit,
        hasListener: !!globalThis.__preppushRuntimeListener,
      }),
    });
    return results?.some((r) => r.result?.hasInit || r.result?.hasListener) ?? false;
  } catch {
    return false;
  }
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content.js'],
    });
    return true;
  } catch (e) {
    const msg = e?.message || String(e);
    if (/duplicate|already been injected|Cannot access/i.test(msg)) {
      return false;
    }
    throw e;
  }
}

/** Inject poll observer into all frames (fullscreen editor polls from iframes). */
async function injectPageInterceptor(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    files: ['interceptor.js'],
  });
}

async function injectPageInterceptorFallback(tabId) {
  await injectPageInterceptor(tabId);
}

async function ensurePageInterceptor(tabId) {
  try {
    await injectPageInterceptor(tabId);
    return { ok: true, method: 'file' };
  } catch (e) {
    console.warn('[PrepPush] interceptor.js inject failed, using fallback:', e?.message);
    try {
      await injectPageInterceptorFallback(tabId);
      return { ok: true, method: 'fallback' };
    } catch (e2) {
      return { ok: false, error: e2?.message || String(e2) };
    }
  }
}

async function wakeContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PREPPUSH_CONNECT' });
    return true;
  } catch {
    return false;
  }
}

/** Inject into HackerRank tabs (recovers stale tabs after extension reload). */
async function ensurePrepPushOnHackerRankTabs(onlyTabId = null) {
  let injected = 0;
  let connected = 0;
  const tabs = onlyTabId != null
    ? [await chrome.tabs.get(onlyTabId).catch(() => null)].filter(Boolean)
    : await chrome.tabs.query({ url: HACKERRANK_TAB_URL });

  for (const tab of tabs) {
    if (!tab?.id || !tab.url?.includes('hackerrank.com')) continue;
    try {
      // Prefer reconnect message + registered content script; only inject as last resort.
      let alive = await tabHasContentScript(tab.id);
      if (!alive) {
        await wakeContentScript(tab.id);
        await new Promise((r) => setTimeout(r, 150));
        alive = await tabHasContentScript(tab.id);
      }
      if (!alive) {
        const alreadyInit = await probeContentScriptInit(tab.id);
        if (!alreadyInit) {
          if (await injectContentScript(tab.id)) {
            injected += 1;
            console.log('[PrepPush] Injected content script into tab', tab.id);
          }
          await new Promise((r) => setTimeout(r, 250));
          alive = await tabHasContentScript(tab.id);
        }
      }
      await ensurePageInterceptor(tab.id);
      if (await wakeContentScript(tab.id)) {
        connected += 1;
        continue;
      }
      // If connect failed but content script is already initialized, do NOT reinject.
      const alreadyInit = alive || (await probeContentScriptInit(tab.id));
      if (!alreadyInit && (await injectContentScript(tab.id))) {
        injected += 1;
        await new Promise((r) => setTimeout(r, 250));
      }
      if (await wakeContentScript(tab.id)) connected += 1;
    } catch (e) {
      console.warn('[PrepPush] Could not connect tab', tab.id, e?.message || e);
    }
  }
  return { ok: true, injected, connected };
}

function scheduleHeartbeat() {
  try {
    chrome.alarms.create('preppush-heartbeat', { periodInMinutes: 1 });
  } catch (e) {
    console.warn('[PrepPush] alarms not available:', e?.message || e);
  }
}

function onExtensionReady() {
  scheduleHeartbeat();
  registerPrepPushContentScripts()
    .then(() => ensurePrepPushOnHackerRankTabs())
    .catch((e) => console.warn('[PrepPush] Startup setup failed:', e?.message || e));
}

chrome.runtime.onInstalled.addListener(onExtensionReady);
chrome.runtime.onStartup.addListener(onExtensionReady);
onExtensionReady();

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === 'preppush-heartbeat') {
    /* keep service worker reachable */
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab?.url?.includes('hackerrank.com')) return;
  ensurePrepPushOnHackerRankTabs(tabId).catch((e) =>
    console.warn('[PrepPush] Tab injection failed:', e?.message || e)
  );
});


// ─── LANGUAGE → FILE EXTENSION MAP ──────────────────────────────────────────
const EXTENSIONS = {
  python3: 'py', python: 'py',
  java: 'java', java8: 'java', java15: 'java',
  javascript: 'js', javascript16: 'js', javascript20: 'js', node: 'js',
  typescript: 'ts',
  cpp: 'cpp', cpp14: 'cpp', cpp17: 'cpp', cpp20: 'cpp',
  c: 'c',
  csharp: 'cs',
  ruby: 'rb',
  swift: 'swift',
  kotlin: 'kt',
  go: 'go',
  scala: 'scala',
  rust: 'rs',
  php: 'php',
  r: 'r',
  haskell: 'hs',
  perl: 'pl',
  bash: 'sh',
  sql: 'sql',
  db2: 'sql',
  mysql: 'sql',
  mariadb: 'sql',
  oracle: 'sql',
  postgresql: 'sql',
  postgres: 'sql',
  mssql: 'sql',
  sqlite: 'sql',
  plsql: 'sql',
};

function normalizeHrLanguage(raw) {
  const t = String(raw || '')
    .toLowerCase()
    .trim()
    .replace(/_/g, '-');
  if (!t) return '';
  if (EXTENSIONS[t]) return t;
  const base = t.replace(/-v?\d+(\.\d+)*$/, '').replace(/-\d+$/, '');
  if (EXTENSIONS[base]) return base;
  if (/^(db2|mysql|oracle|postgresql|postgres|mssql|sqlite|mariadb|plsql|sql)/.test(base)) {
    return base === 'postgres' ? 'postgresql' : base;
  }
  return t;
}

function looksLikeSql(code) {
  const t = String(code || '').trim();
  if (!t) return false;
  if (/^\s*\/\*[\s\S]*?\*\/\s*(select|insert|update|delete|with)\b/i.test(t)) return true;
  return /\b(select|insert|update|delete|with)\b[\s\S]*\b(from|into|set|values)\b/i.test(t);
}

function inferLanguage(submission) {
  const raw = normalizeHrLanguage(submission?.language);
  if (raw && EXTENSIONS[raw]) return raw;

  const code = submission?.code || '';
  if (looksLikeSql(code)) return raw && /^(db2|mysql|oracle|postgresql|mssql|sqlite|mariadb|plsql|sql)/.test(raw) ? raw : 'sql';

  // Trust HackerRank's language slug when present (avoid mislabeling SQL/DB2 as Python).
  if (raw) return raw;

  if (/if\s+__name__/m.test(code) || /\binput\s*\(/m.test(code)) return 'python3';
  if (/\bdef\s+\w+/m.test(code)) return 'python3';
  if (/\bpublic\s+class\b/m.test(code)) return 'java';
  if (/\b#include\s*</m.test(code)) return 'cpp';
  if (/\bfunction\s+\w+/m.test(code) && /\bconst\s+/m.test(code)) return 'javascript';
  if (/\bfn\s+\w+/m.test(code)) return 'rust';

  return 'unknown';
}

function fileExtensionForLanguage(language, code = '') {
  const lang = normalizeHrLanguage(language);
  if (lang && EXTENSIONS[lang]) return EXTENSIONS[lang];
  if (looksLikeSql(code)) return 'sql';
  return 'txt';
}

// ─── LANGUAGE → COMMENT STYLE ────────────────────────────────────────────────
const COMMENT_STYLE = {
  py: '#', js: '//', ts: '//', java: '//', cpp: '//', c: '//',
  cs: '//', rb: '#', swift: '//', kt: '//', go: '//', scala: '//',
  rs: '//', php: '//', r: '#', hs: '--', pl: '#', sh: '#', sql: '--',
};

// ─── PATH + SLUG HELPERS ─────────────────────────────────────────────────────
function slugify(text) {
  if (!text || typeof text !== 'string') return '';
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Interview-prep layout: language → difficulty → problem → solution-approachN per distinct code
const APPROACH_REGISTRY_KEY = 'approachRegistry';

function buildProblemDir(submission) {
  const lang = slugify(submission.language) || 'unknown';
  const difficulty = slugify(submission.difficulty) || 'uncategorized';
  const slug = slugify(submission.problemSlug) || slugify(submission.problemName) || 'unknown';
  return `solutions/${lang}/${difficulty}/${slug}`;
}

// Legacy normalizer (pre-0.6.3) — kept so existing approach registry entries still match.
function normalizeCodeLegacy(code) {
  return String(code || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Compare from first `def` onward — ignores HackerRank boilerplate/import drift.
function extractCoreLines(code) {
  const lines = String(code || '').replace(/\r\n/g, '\n').split('\n');
  const defIdx = lines.findIndex((line) => /^\s*def \w+/.test(line));
  return defIdx >= 0 ? lines.slice(defIdx) : lines;
}

// Ignores blank lines, comment-only lines, and spacing so formatting-only edits reuse approachN.
function normalizeCode(code) {
  return extractCoreLines(code)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => {
      if (!line.length) return false;
      if (line.startsWith('#')) return false;
      return true;
    })
    .join('\n');
}

async function hashNormalized(normalized) {
  if (!normalized) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashCode(code) {
  return hashNormalized(normalizeCode(code));
}

// Whitespace-stripped core — same algorithm with different blanks/comments → same fingerprint.
function codeFingerprint(code) {
  return normalizeCode(code).replace(/\s+/g, '');
}

async function loadApproachRegistry() {
  const local = await chrome.storage.local.get(APPROACH_REGISTRY_KEY);
  if (local[APPROACH_REGISTRY_KEY]) return local[APPROACH_REGISTRY_KEY];

  const sync = await chrome.storage.sync.get(APPROACH_REGISTRY_KEY);
  if (sync[APPROACH_REGISTRY_KEY]) {
    await chrome.storage.local.set({ [APPROACH_REGISTRY_KEY]: sync[APPROACH_REGISTRY_KEY] });
    return sync[APPROACH_REGISTRY_KEY];
  }
  return {};
}

async function saveApproachRegistry(registry) {
  await chrome.storage.local.set({ [APPROACH_REGISTRY_KEY]: registry });
}

function approachMatchesFingerprint(a, fingerprint, fpHash, norm, normHash, legacyHash, legacyCoreHash) {
  if (fpHash && a.fpHash === fpHash) return true;
  if (normHash && a.normHash === normHash) return true;
  if (norm && a.norm === norm) return true;
  if (a.lastNorm && codeFingerprint(a.lastNorm) === fingerprint) return true;
  if (a.codeHash === normHash || a.codeHash === fpHash) return true;
  if (legacyHash && a.codeHash === legacyHash) return true;
  if (legacyCoreHash && a.codeHash === legacyCoreHash) return true;
  return false;
}

function consolidateProblemApproaches(problem, matchId, fpHash, fingerprint) {
  problem.byFp = problem.byFp || {};
  problem.byFp[fpHash] = matchId;
  problem.approaches = problem.approaches.filter((a) => {
    if (a.id === matchId) return true;
    if (a.fpHash === fpHash) return false;
    if (a.lastNorm && codeFingerprint(a.lastNorm) === fingerprint) return false;
    return true;
  });
}

// Maps solution core → approach1, approach2, … (same logic = same number, even if formatting differs).
async function resolveApproachKey(submission) {
  const problemKey = buildProblemDir(submission);
  const norm = normalizeCode(submission.code);
  const fingerprint = codeFingerprint(submission.code);
  const normHash = await hashNormalized(norm);
  const fpHash = await hashNormalized(fingerprint);
  if (!fpHash) return 'approach1';

  const registry = await loadApproachRegistry();
  const problem = registry[problemKey] || { approaches: [], byFp: {} };
  problem.byFp = problem.byFp || {};

  const legacyHash = await hashNormalized(normalizeCodeLegacy(submission.code));
  const legacyCoreHash = await hashNormalized(normalizeCodeLegacy(extractCoreLines(submission.code).join('\n')));

  let match = null;

  if (problem.byFp[fpHash] != null) {
    match = problem.approaches.find((a) => a.id === problem.byFp[fpHash]) || { id: problem.byFp[fpHash] };
  }

  if (!match) {
    const candidates = problem.approaches.filter((a) =>
      approachMatchesFingerprint(a, fingerprint, fpHash, norm, normHash, legacyHash, legacyCoreHash),
    );
    if (candidates.length) {
      match = candidates.reduce((best, a) => (a.id < best.id ? a : best));
    }
  }

  // Same algorithm already filed under a higher approach number (e.g. approach7 = approach2).
  if (!match) {
    const withFp = problem.approaches.filter((a) => a.fpHash === fpHash);
    const orphans = problem.approaches.filter((a) => !a.fpHash);
    if (withFp.length && orphans.length) {
      match = [...withFp, ...orphans].reduce((best, a) => (a.id < best.id ? a : best));
    }
  }

  if (match) {
    if (!problem.approaches.some((a) => a.id === match.id)) {
      problem.approaches.push({ id: match.id, fpHash, normHash, norm, lastNorm: norm });
      match = problem.approaches[problem.approaches.length - 1];
    }
    match.norm = norm;
    match.normHash = normHash;
    match.fpHash = fpHash;
    match.lastNorm = norm;
    match.codeHash = fpHash;
    consolidateProblemApproaches(problem, match.id, fpHash, fingerprint);
    registry[problemKey] = problem;
    await saveApproachRegistry(registry);
    console.log(`[PrepPush] Same logic → approach${match.id} (fp ${fpHash.slice(0, 8)}…)`);
  } else {
    const nextId = problem.approaches.reduce((max, a) => Math.max(max, a.id), 0) + 1;
    match = { id: nextId, fpHash, normHash, norm, lastNorm: norm, codeHash: fpHash };
    problem.approaches.push(match);
    problem.byFp[fpHash] = nextId;
    registry[problemKey] = problem;
    await saveApproachRegistry(registry);
    console.log(`[PrepPush] New approach for ${problemKey}: approach${nextId} (fp ${fpHash.slice(0, 8)}…)`);
  }

  return `approach${match.id}`;
}

async function buildFilePath(submission, ext) {
  const dir = buildProblemDir(submission);
  const approachKey = submission.approachKey || (await resolveApproachKey(submission));
  return `${dir}/solution-${approachKey}.${ext}`;
}

// ─── LLM ANALYSIS (GOOGLE GEMINI — free tier, no card required) ─────────────
// Free tier: Flash Lite only (~500 analyses/day on typical Google AI Studio projects).
const GEMINI_MODELS = [
  'gemini-3.1-flash-lite-preview',
  'gemini-3.1-flash-lite',
];
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Passed in each POST body as generationConfig (Gemini generateContent API).
// temperature: 0 = deterministic; 1+ = more random phrasing (bad for stable Big-O labels).
// topP / topK: nucleus sampling caps; kept conservative so quality stays high at temp 0.
const GEMINI_PARAMS = {
  analysis: {
    temperature: 0,
    topP: 0.95,
    topK: 40,
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        technique: {
          type: 'STRING',
          description: 'Short label for THIS implementation only (e.g. isupper-scan, regex-split, ord-ascii, filter-upper)',
        },
        time_complexity: { type: 'STRING', description: 'Big-O time, short' },
        space_complexity: { type: 'STRING', description: 'Big-O space, short' },
        trick: {
          type: 'STRING',
          description:
            'One sentence (≤25 words): key idea of THIS code only — cite a function, syntax, or API actually used (e.g. [::-1], dict lookup). No generic interview advice.',
        },
        code_hint: {
          type: 'STRING',
          description:
            'Optional (≤12 words): one API/syntax pitfall from THIS file, or empty string "" if nothing specific. Must name a symbol used in the code.',
        },
      },
      required: ['technique', 'time_complexity', 'space_complexity', 'trick'],
    },
  },
  test: {
    temperature: 0,
    topP: 1,
    topK: 1,
  },
};

function buildGenerationConfig(model, purpose, maxOutputTokens) {
  const profile = GEMINI_PARAMS[purpose] || GEMINI_PARAMS.analysis;
  const config = {
    maxOutputTokens,
    thinkingConfig: buildThinkingConfig(model),
    temperature: profile.temperature,
  };
  if (profile.topP != null) config.topP = profile.topP;
  if (profile.topK != null) config.topK = profile.topK;
  if (profile.responseMimeType) config.responseMimeType = profile.responseMimeType;
  if (profile.responseSchema) config.responseSchema = profile.responseSchema;
  return config;
}

function isGeminiQuotaError(message) {
  const m = String(message || '').toLowerCase();
  return m.includes('quota') || m.includes('rate limit') || m.includes('limit: 0');
}

function formatGeminiError(message) {
  const m = String(message || '');
  if (!isGeminiQuotaError(m)) return m;
  if (/gemini-3-flash/i.test(m) && /limit:\s*20/i.test(m)) {
    return 'Gemini 3 Flash quota is separate (20/day). PrepPush uses Flash Lite only — reload the extension if you still see this.';
  }
  if (m.length > 160) {
    return 'Gemini free quota or rate limit hit. Wait a minute, then retry. Usage: ai.dev/rate-limit';
  }
  return `${m.split('Please retry')[0].trim()} — wait and retry, or check ai.dev/rate-limit`;
}

function isGeminiModelUnavailable(message) {
  const m = String(message || '').toLowerCase();
  return m.includes('not found') || m.includes('not supported') || m.includes('invalid model');
}

function buildThinkingConfig(model) {
  // Gemini 3 defaults to medium/high thinking and can burn the whole output budget.
  if (/gemini-3/i.test(model)) {
    return { thinkingLevel: 'minimal' };
  }
  return { thinkingBudget: 0 };
}

function extractVisibleText(candidate) {
  const parts = candidate?.content?.parts;
  if (!parts?.length) return '';
  return parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('')
    .trim();
}

function stripCodeForAnalysis(code) {
  let t = String(code || '').trim();
  if (!t) return t;
  t = t.replace(/\r\n/g, '\n');
  t = t.replace(/if\s+__name__\s*==\s*['"]__main__['"][\s\S]*$/m, '').trim();
  if (/^\s*\/\*[\s\S]*?\*\//m.test(t)) {
    t = t.replace(/^\s*\/\*[\s\S]*?\*\/\s*/m, '').trim();
  }
  return t || String(code || '').trim();
}

function codeAnalysisTokens(code) {
  const t = String(code || '');
  const tokens = new Set();
  for (const m of t.matchAll(/\b[a-zA-Z_][a-zA-Z0-9_]{2,}\b/g)) {
    tokens.add(m[0].toLowerCase());
  }
  if (/\[::-1\]/.test(t)) tokens.add('[::-1]');
  if (/\[::\s*-1\s*\]/.test(t)) tokens.add('[::-1]');
  if (/\breversed\s*\(/.test(t)) tokens.add('reversed');
  if (/\bsorted\s*\(/.test(t)) tokens.add('sorted');
  if (/\benumerate\s*\(/.test(t)) tokens.add('enumerate');
  if (/\bcollections\./.test(t)) tokens.add('collections');
  return tokens;
}

function textReferencesCode(text, codeTokens) {
  const raw = String(text || '').trim();
  if (!raw || !codeTokens?.size) return false;
  if (/\[::-1\]/.test(raw) && codeTokens.has('[::-1]')) return true;
  const lower = raw.toLowerCase();
  for (const tok of codeTokens) {
    if (tok.startsWith('[')) continue;
    if (lower.includes(tok)) return true;
  }
  return false;
}

const GENERIC_AI_PHRASE =
  /\b(practice more|edge cases?|interview tip|read carefully|test cases|think about|always remember|make sure|study more|good luck)\b/i;

function buildAnalysisPrompt({ code, language, problemName, problemSlug, problemUrl }) {
  const problemLine = problemUrl
    ? `Problem: ${problemName || problemSlug || 'Unknown'}\nLink: ${problemUrl}`
    : `Problem: ${problemName || problemSlug || 'Unknown'}`;

  return `${problemLine}
Language: ${language || 'unknown'}

You help developers prep for coding interviews. Analyze the ACCEPTED solution below.

Focus on what is UNIQUE about THIS code — not a generic explanation of the problem that would apply to every approach.

Rules:
- "technique": 2–4 words, kebab-case, naming the method in this file (e.g. list-slice-reverse, hash-map, two-pointers).
- "time_complexity" / "space_complexity": Big-O for THIS implementation exactly (not a faster algorithm the user did not write).
- "trick": ONE sentence, max 25 words — must mention a function name, syntax, or API that appears in the code (e.g. [::-1], .items(), dict). No generic filler ("watch edge cases", "practice more"). Optional: note one tradeoff of this approach vs a common alternative in ≤8 words.
- "code_hint": "" (empty string) unless you can name a specific API/symbol from the code and a pitfall in ≤12 words. Never repeat the trick.

Respond with ONLY valid JSON (no markdown).

Code:
${code}`;
}

async function callGeminiOnModel({ apiKey, model, prompt, maxOutputTokens, purpose = 'analysis' }) {
  const generationConfig = buildGenerationConfig(model, purpose, maxOutputTokens);

  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig,
    }),
  });

  if (!res.ok) {
    let msg = `Gemini API error ${res.status}`;
    try {
      const err = await res.json();
      msg = err.error?.message || msg;
    } catch {}
    const error = new Error(msg);
    error.status = res.status;
    throw error;
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  const text = extractVisibleText(candidate);
  const finishReason = candidate?.finishReason;

  if (!text) {
    const blockReason = finishReason || data.promptFeedback?.blockReason;
    const error = new Error(
      blockReason ? `Gemini blocked response: ${blockReason}` : 'Empty response from Gemini',
    );
    error.finishReason = finishReason;
    error.retryable = finishReason === 'MAX_TOKENS';
    throw error;
  }

  if (finishReason === 'MAX_TOKENS') {
    console.warn(`[PrepPush] Gemini ${model} hit MAX_TOKENS; using partial output (${text.length} chars)`);
  }
  return text;
}

async function callGemini({
  apiKey,
  prompt,
  maxOutputTokens = 1024,
  purpose = 'analysis',
  models = GEMINI_MODELS,
}) {
  let lastError = null;
  const tokenSteps = [maxOutputTokens, Math.min(maxOutputTokens * 2, 2048)];

  for (const model of models) {
    for (const tokens of tokenSteps) {
      try {
        const text = await callGeminiOnModel({
          apiKey,
          model,
          prompt,
          maxOutputTokens: tokens,
          purpose,
        });
        return { text, model };
      } catch (e) {
        lastError = e;
        const retryTokens = e.retryable && tokens === tokenSteps[0];
        const retryable =
          retryTokens ||
          isGeminiQuotaError(e.message) ||
          isGeminiModelUnavailable(e.message) ||
          e.status === 429 ||
          e.status === 404;
        if (retryTokens) {
          console.warn(`[PrepPush] Gemini ${model} retrying with ${tokenSteps[1]} tokens…`, e.message);
          continue;
        }
        if (!retryable) throw e;
        console.warn(`[PrepPush] Gemini model ${model} unavailable, trying next…`, e.message);
        break;
      }
    }
  }

  throw lastError || new Error('All Gemini models failed');
}

function truncate(text, max = 140) {
  if (!text) return '';
  const s = String(text).trim();
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function truncateAtWord(text, max = 200) {
  if (!text) return '';
  const s = String(text).trim();
  if (s.length <= max) return s;
  const slice = s.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > max * 0.45 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

function normalizeForCompare(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function hintIsRedundantWithTrick(trick, hint) {
  const t = normalizeForCompare(trick);
  const h = normalizeForCompare(hint);
  if (!h) return true;
  if (t === h) return true;
  if (t.includes(h) || h.includes(t)) return true;
  return false;
}

function parseAnalysisJson(text, code = '') {
  const match = text.trim().match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in model response (got: ${truncate(text, 120)})`);
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch (e) {
    throw new Error(`Invalid JSON from model: ${e.message}`);
  }

  const codeTokens = codeAnalysisTokens(code);
  const technique = truncate(parsed.technique || parsed.approach || 'unknown', 48);

  let trick = truncateAtWord(parsed.trick, 200);
  const trickGeneric = GENERIC_AI_PHRASE.test(trick);
  const trickGrounded = textReferencesCode(trick, codeTokens);
  if (!trick || (trickGeneric && !trickGrounded) || (!trickGrounded && codeTokens.size > 0)) {
    trick = truncateAtWord(`${technique}: see implementation below.`, 200);
  }

  const rawHint = truncateAtWord(parsed.code_hint || parsed.codeHint || '', 120);
  const hintOk =
    rawHint &&
    !hintIsRedundantWithTrick(trick, rawHint) &&
    textReferencesCode(rawHint, codeTokens) &&
    !GENERIC_AI_PHRASE.test(rawHint);
  const code_hint = hintOk ? rawHint : null;

  return {
    technique,
    time_complexity: truncate(parsed.time_complexity || parsed.timeComplexity || 'N/A', 40),
    space_complexity: truncate(parsed.space_complexity || parsed.spaceComplexity || 'N/A', 40),
    trick,
    code_hint,
  };
}

async function analyzeCode({ code, language, problemName, problemSlug, contestSlug, apiKey }) {
  const stripped = stripCodeForAnalysis(code);
  const prompt = buildAnalysisPrompt({
    code: stripped,
    language,
    problemName,
    problemSlug,
    problemUrl: buildHackerRankProblemUrl({ problemSlug, contestSlug }),
  });
  const { text } = await callGemini({ apiKey, prompt, maxOutputTokens: 1024 });
  return parseAnalysisJson(text, stripped);
}

async function testGeminiConnection(apiKey) {
  try {
    const { text, model } = await callGemini({
      apiKey,
      models: GEMINI_MODELS,
      prompt: 'Reply with exactly: OK',
      maxOutputTokens: 64,
      purpose: 'test',
    });
    const reply = text.trim();
    if (!reply) throw new Error('Empty response from Gemini');
    if (/\bok\b/i.test(reply)) return { success: true, model };

    throw new Error(`Unexpected test reply: ${truncate(reply, 80)}`);
  } catch (e) {
    return { success: false, error: formatGeminiError(e.message) };
  }
}

function buildHackerRankProblemUrl(submission) {
  const slug = String(submission?.problemSlug || '').trim();
  if (!slug) return null;
  const contest = String(submission?.contestSlug || 'master').trim() || 'master';
  const path =
    contest === 'master'
      ? `/challenges/${slug}/problem`
      : `/contests/${contest}/challenges/${slug}/problem`;
  return `https://www.hackerrank.com${path}?isFullScreen=true`;
}

// ─── BUILD FILE HEADER ────────────────────────────────────────────────────────
function buildHeader(submission, ext) {
  const c = COMMENT_STYLE[ext] || '#';
  const line = `${c} ${'─'.repeat(50)}`;
  const date = new Date(submission.timestamp).toLocaleString('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: true
  });

  const analysis = submission.analysis;
  const problemUrl = buildHackerRankProblemUrl(submission);
  const rows = [
    ...(problemUrl ? [['Link', problemUrl]] : []),
    ['Problem',    submission.problemName || submission.problemSlug],
    ['Difficulty', submission.difficulty || 'N/A'],
    ['Subdomain',  submission.subdomainName || 'N/A'],
    ['Platform',   'HackerRank'],
    ['Language',   submission.language || 'N/A'],
    ['Status',     'Accepted'],
    ['Submitted',  date],
  ];

  if (analysis) {
    rows.push(
      ['Technique', analysis.technique || 'N/A'],
      ['Time', analysis.time_complexity],
      ['Space', analysis.space_complexity],
      ['Trick', analysis.trick],
    );
    if (analysis.code_hint) rows.push(['Hint', analysis.code_hint]);
  }

  const maxLabel = Math.max(...rows.map(([l]) => l.length));
  const body = rows
    .map(([label, value]) => `${c} ${label.padEnd(maxLabel)}  ${value}`)
    .join('\n');

  return `${line}\n${body}\n${line}\n\n`;
}

function injectCodeHint(code, hint, ext) {
  if (!hint || !code?.trim()) return code;
  const c = COMMENT_STYLE[ext] || '#';
  const hintLine = `${c} ${hint}\n`;
  const defMatch = code.match(/^(\s*def \w+)/m);
  if (defMatch) {
    return code.replace(defMatch[0], `${hintLine}${defMatch[0]}`);
  }
  return hintLine + code;
}

// ─── FETCH ACCEPTED SUBMISSION (extension context + session cookies) ─────────
function isRunEvaluation(model) {
  const code = (model?.code ?? '').trim();
  const n = model?.testcase_status?.length ?? 0;
  const statusStr = String(model?.status ?? '').trim();
  const statusCode = model?.status_code ?? model?.statusCode;
  if (/^accepted$/i.test(statusStr) && code.length > 20) return false;
  if (statusCode === 1 && code.length > 20) return false;
  if ((model?.solved === 1 || model?.solved === true) && code.length > 20 && n > 3) {
    return false;
  }
  if (n > 3) return false;
  if (!code && n > 0 && n <= 3) return true;
  if (statusStr === '1' && statusCode !== 1 && code.length < 20) return true;
  return false;
}

function isHrSubmissionAccepted(model) {
  if (!model || typeof model !== 'object') return false;
  if (isRunEvaluation(model)) return false;
  const status = String(model.status ?? '').trim();
  const statusCode = model.status_code ?? model.statusCode;
  const code = (model.code ?? '').trim();
  if (code.length < 20) return false;
  if (/processing|compil|running|queue|pending|wrong|fail|error|timeout/i.test(status)) {
    return false;
  }
  if (/^accepted$/i.test(status) && (model.solved === 1 || model.solved === true)) return true;
  if (statusCode === 1 && (model.solved === 1 || model.solved === true)) return true;
  if (statusCode === 2 && /^processed$/i.test(status) && model.solved === 1) return true;
  return false;
}

function parseHrSubmissionModel(model, contest, slug) {
  if (!isHrSubmissionAccepted(model)) return null;
  const code = model.code ?? '';
  if (!code || !isSubstantiveSubmissionCode(code)) return null;
  return {
    status: model.status || 'Accepted',
    language: model.language ?? null,
    problemName: model.name ?? null,
    problemSlug: model.challenge_slug ?? model.slug ?? slug,
    contestSlug: model.contest_slug ?? contest,
    submissionId: model.id ?? null,
    timestamp: model.updated_at
      ? new Date(model.updated_at).getTime()
      : model.created_at
        ? new Date(model.created_at).getTime()
        : Date.now(),
    code,
  };
}

let hrBgLastFetch = 0;

async function hrBgFetch(url) {
  const gap = 5000 - (Date.now() - hrBgLastFetch);
  if (gap > 0) await new Promise((r) => setTimeout(r, gap));
  hrBgLastFetch = Date.now();
  return fetch(url, {
    credentials: 'include',
    headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
  });
}

async function fetchHrSubmissionById(contest, slug, id) {
  const url = `https://www.hackerrank.com/rest/contests/${contest}/challenges/${slug}/submissions/${id}`;
  const res = await hrBgFetch(url);
  if (!res.ok) return { ok: false, status: res.status, url };
  const data = await res.json();
  const sub = parseHrSubmissionModel(data?.model ?? data, contest, slug);
  return sub ? { ok: true, submission: sub } : { ok: false, status: res.status, url };
}

async function fetchLatestSubmissionFromHr(contest, slug) {
  const listUrls = [
    `https://www.hackerrank.com/rest/contests/${contest}/challenges/${slug}/submissions?limit=5&offset=0`,
  ];
  const attempts = [];

  for (const listUrl of listUrls) {
    try {
      const res = await hrBgFetch(listUrl);
      attempts.push({ url: listUrl, status: res.status });
      if (res.status === 429) break;
      if (!res.ok) continue;
      const data = await res.json();
      const items = data?.models ?? data?.data ?? data?.submissions ?? [];
      const list = Array.isArray(items) ? items : [];
      const sorted = [...list].sort((a, b) => {
        const ta = new Date(a?.model?.created_at || a?.created_at || 0).getTime();
        const tb = new Date(b?.model?.created_at || b?.created_at || 0).getTime();
        return tb - ta;
      });
      for (const item of sorted) {
        const model = item?.model ?? item;
        let sub = parseHrSubmissionModel(model, contest, slug);
        if (sub) return { submission: sub, attempts };
        if (model?.id) {
          const poll = await fetchHrSubmissionById(contest, slug, model.id);
          if (poll.ok && poll.submission) return { submission: poll.submission, attempts };
        }
      }
    } catch (e) {
      attempts.push({ url: listUrl, error: e?.message || String(e) });
    }
  }
  return { submission: null, attempts };
}

// ─── FETCH DIFFICULTY + SUBDOMAIN FROM HACKERRANK ────────────────────────────
function difficultyLabelFromModel(model) {
  if (!model) return null;
  if (model.difficulty_name) return String(model.difficulty_name);
  const score = model.difficulty ?? model.difficulty_score;
  if (score == null || score === '') return null;
  const n = Number(score);
  if (Number.isNaN(n)) return String(score);
  if (n <= 1.25) return 'Easy';
  if (n <= 2.25) return 'Medium';
  return 'Hard';
}

function parseChallengeModel(model) {
  if (!model || typeof model !== 'object') return {};
  const subdomainName =
    model.track?.name ||
    model.track?.track_name ||
    model.primary_contest?.track?.name ||
    null;
  return {
    difficulty: difficultyLabelFromModel(model),
    subdomainName,
    problemName: model.name || null,
  };
}

function friendlySubdomainName(contestSlug, existing) {
  if (existing) return existing;
  if (contestSlug === 'software-engineer-prep-kit') return 'Software Engineer Prep Kit';
  return null;
}

async function fetchChallengeDetails(slug, contestSlug) {
  if (!slug) return {};
  const contests = [];
  if (contestSlug) contests.push(contestSlug);
  if (!contests.includes('master')) contests.push('master');

  for (const contest of contests) {
    try {
      const url = `https://www.hackerrank.com/rest/contests/${contest}/challenges/${slug}`;
      const res = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!res.ok) {
        console.warn('[PrepPush] Challenge metadata', contest, slug, res.status);
        continue;
      }
      const data = await res.json();
      const parsed = parseChallengeModel(data?.model);
      parsed.subdomainName = friendlySubdomainName(contest, parsed.subdomainName);
      if (parsed.difficulty || parsed.subdomainName) {
        console.log('[PrepPush] Challenge metadata ✅', parsed);
        return parsed;
      }
    } catch (e) {
      console.warn('[PrepPush] Challenge metadata failed:', contest, e?.message || e);
    }
  }
  return {};
}

// ─── GITHUB API HELPERS ──────────────────────────────────────────────────────
const GITHUB_API = 'https://api.github.com';

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function githubFetch(path, token, options = {}) {
  const headers = { ...githubHeaders(token), ...options.headers };
  return fetch(`${GITHUB_API}${path}`, { ...options, headers });
}

async function githubErrorMessage(res, context = '') {
  let message = `GitHub API error ${res.status}`;
  try {
    const body = await res.json();
    message = body.message || message;
  } catch {}

  if (message.includes('Resource not accessible by personal access token')) {
    return (
      `${context}Token lacks permission. Generate a new classic token with the ` +
      '"repo" scope from PrepPush Settings → Generate token on GitHub.'
    );
  }

  return context ? `${context}${message}` : message;
}

function repoCreateUrl(repoName) {
  return (
    `https://github.com/new?name=${encodeURIComponent(repoName)}` +
    `&description=${encodeURIComponent('Coding solutions — auto-documented by PrepPush')}`
  );
}

function autoCreateTokenHint() {
  return 'Use PrepPush Settings → Generate token on GitHub (classic token with "repo" scope).';
}

const REPO_CACHE_KEY = 'preppushRepoCache';

async function ensureRepoExistsCached(username, repoName, token) {
  const cacheKey = `${username}/${repoName}`;
  const { [REPO_CACHE_KEY]: cache = {} } = await chrome.storage.local.get(REPO_CACHE_KEY);
  if (cache[cacheKey] && Date.now() - cache[cacheKey] < 60 * 60 * 1000) {
    return { success: true, created: false, cached: true };
  }
  const result = await ensureRepoExists(username, repoName, token);
  if (result.success) {
    await chrome.storage.local.set({ [REPO_CACHE_KEY]: { ...cache, [cacheKey]: Date.now() } });
  }
  return result;
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

async function getGithubLoginCached(token) {
  if (!token) return null;
  const tokenHash = hashString(String(token).slice(0, 60));
  const cacheKey = `preppushGithubLogin:${tokenHash}`;
  const { [cacheKey]: cached } = await chrome.storage.local.get(cacheKey);
  if (cached?.login && cached?.expiresAt && Date.now() < cached.expiresAt) return cached.login;

  const userRes = await githubFetch('/user', token);
  if (!userRes.ok) return null;
  const data = await userRes.json();
  const login = data?.login;
  if (!login) return null;

  await chrome.storage.local.set({ [cacheKey]: { login, expiresAt: Date.now() + 60 * 60 * 1000 } });
  return login;
}

// ─── GITHUB: GET OR CREATE REPO ──────────────────────────────────────────────
async function ensureRepoExists(username, repoName, token) {
  const checkRes = await githubFetch(`/repos/${username}/${repoName}`, token);

  if (checkRes.ok) {
    const repo = await checkRes.json();
    if (repo.permissions && !repo.permissions.push) {
      return {
        success: false,
        error: 'Token can read the repo but cannot push. Grant Contents (write) permission.',
      };
    }
    console.log('[PrepPush] Repo exists ✅');
    return { success: true, created: false };
  }

  if (checkRes.status === 403) {
    return { success: false, error: await githubErrorMessage(checkRes, 'Repo check failed: ') };
  }

  if (checkRes.status !== 404) {
    return { success: false, error: await githubErrorMessage(checkRes, 'Repo check failed: ') };
  }

  // Repo not found — create it
  console.log(`[PrepPush] Repo "${repoName}" not found, creating...`);
  const createRes = await githubFetch('/user/repos', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: repoName,
      description: 'Coding solutions — auto-documented by PrepPush',
      private: false,
      auto_init: true,
    }),
  });

  if (!createRes.ok) {
    return {
      success: false,
      error: await githubErrorMessage(createRes, 'Could not create repo: '),
      hint: autoCreateTokenHint(),
      createUrl: repoCreateUrl(repoName),
    };
  }

  console.log('[PrepPush] Repo created ✅, waiting for GitHub to initialize...');
  await new Promise((r) => setTimeout(r, 2500));

  const verifyRes = await githubFetch(`/repos/${username}/${repoName}`, token);
  if (!verifyRes.ok) {
    return {
      success: false,
      error: `Repo "${repoName}" was created but your token cannot access it yet.`,
      hint: autoCreateTokenHint(),
      createUrl: repoCreateUrl(repoName),
    };
  }

  const created = await verifyRes.json();
  if (created.permissions && !created.permissions.push) {
    return {
      success: false,
      error: `Repo "${repoName}" exists but token cannot push to it.`,
      hint: 'Grant Contents (read & write) on this repository.',
    };
  }

  return { success: true, created: true };
}

// ─── GITHUB: COMMIT FILE ─────────────────────────────────────────────────────
async function commitToGitHub({ username, repoName, token, path, content, commitMessage }) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = `/repos/${username}/${repoName}/contents/${encodedPath}`;

  let sha;
  const existing = await githubFetch(url, token);
  if (existing.ok) {
    const data = await existing.json();
    sha = data.sha;
  } else if (existing.status !== 404) {
    throw new Error(await githubErrorMessage(existing, 'Cannot read file: '));
  }

  const encoded = btoa(unescape(encodeURIComponent(content)));
  const res = await githubFetch(url, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: commitMessage,
      content: encoded,
      ...(sha && { sha }),
    }),
  });

  if (!res.ok) {
    throw new Error(await githubErrorMessage(res, 'Commit failed: '));
  }

  return await res.json();
}

function isSubstantiveSubmissionCode(code) {
  const t = (code || '').trim();
  if (t.length < 20) return false;

  // Python stdin/stdout (common on prep-kit — no def/return)
  if (/if\s+__name__\s*==/m.test(t)) return true;
  if (/\binput\s*\(/m.test(t) && /\bprint\s*\(/m.test(t)) return true;

  // Python function-style
  if (/\bdef\s+\w+/m.test(t)) return t.length >= 30;

  // SQL (HackerRank DB challenges — e.g. DB2, MySQL)
  if (looksLikeSql(t)) return true;

  // Other languages
  if (/\bpublic\s+class\b/m.test(t)) return true;
  if (/\b#include\s*</m.test(t)) return true;
  if (/\bint\s+main\s*\(/m.test(t)) return true;

  const lines = t.split('\n').filter((l) => l.trim()).length;
  if (lines >= 3 && t.length >= 35) return true;

  return t.length >= 60;
}

// ─── GITHUB PUSH (code first, AI header can be added in a follow-up commit) ───
async function pushSubmissionToGitHub(submission, { githubToken, githubUsername, githubRepo }, options = {}) {
  const repoName = (githubRepo || '').trim() || DEFAULT_GITHUB_REPO;
  submission = { ...submission, language: inferLanguage(submission) };
  const ext = fileExtensionForLanguage(submission.language, submission.code);
  const codeHash = await hashCode(submission.code);

  const username =
    githubUsername ||
    (githubToken ? await getGithubLoginCached(githubToken) : null);
  if (!username) {
    return { pushed: false, reason: 'github_user_missing', message: 'GitHub token is missing/invalid login.' };
  }

  const [repoResult, approachKey] = await Promise.all([
    ensureRepoExistsCached(username, repoName, githubToken),
    resolveApproachKey({ ...submission, codeHash }),
  ]);

  if (!repoResult.success) {
    let message = repoResult.error || 'Repository not accessible.';
    if (repoResult.hint) message += ` ${repoResult.hint}`;
    if (repoResult.createUrl) {
      message += ` <a href="${repoResult.createUrl}" target="_blank" rel="noopener">Create "${repoName}" manually →</a>`;
    }
    return { pushed: false, reason: 'repo_error', message };
  }

  submission = { ...submission, codeHash, approachKey };
  const filePath = `${buildProblemDir(submission)}/solution-${approachKey}.${ext}`;
  const header = buildHeader(submission, ext);
  const fileContent = header + (submission.code || '// No code captured');
  const slug = submission.problemSlug || 'solution';
  const commitMessage =
    options.commitMessage ||
    `✅ ${submission.problemName || slug} [${submission.language}] — ${approachKey}`;

  const result = await commitToGitHub({
    username,
    repoName,
    token: githubToken,
    path: filePath,
    content: fileContent,
    commitMessage,
  });

  const commitUrl = result?.content?.html_url || `https://github.com/${username}/${repoName}`;
  return { pushed: true, commitUrl, filePath, submission, approachKey };
}

async function enrichWithAiNotes(submission, creds, commitUrl, filePath) {
  const { geminiApiKey, autoAnalyze = true, githubToken, githubRepo } = creds;
  if (autoAnalyze === false || !geminiApiKey || !submission.code?.trim()) return;

  try {
    const analysis = await analyzeCode({
      code: submission.code,
      language: submission.language,
      problemName: submission.problemName || submission.problemSlug,
      problemSlug: submission.problemSlug,
      contestSlug: submission.contestSlug,
      apiKey: geminiApiKey,
    });
    submission = { ...submission, analysis };
    await chrome.storage.local.set({ latestSubmission: submission });

    if (githubToken && commitUrl) {
      await pushSubmissionToGitHub(
        submission,
        { githubToken, githubRepo },
        { commitMessage: `📝 ${submission.problemName || submission.problemSlug} — AI notes` }
      );
      await chrome.storage.local.set({
        pushStatus: {
          status: 'success',
          message: 'Pushed to GitHub with AI notes ✅',
          commitUrl,
          filePath,
          timestamp: Date.now(),
        },
      });
    }
  } catch (e) {
    const analysisError = formatGeminiError(e.message);
    console.warn('[PrepPush] AI enrichment failed:', analysisError);
    await chrome.storage.local.set({
      latestSubmission: { ...submission, analysisError },
    });
  }
}

// ─── MAIN: HANDLE ACCEPTED SUBMISSION ────────────────────────────────────────
const handlingSubmissionIds = new Set();

async function handleSubmission(submission) {
  const t0 = Date.now();
  submission = { ...submission, language: inferLanguage(submission) };

  const submissionIdStr =
    submission?.submissionId != null ? String(submission.submissionId) : null;
  if (submissionIdStr && handlingSubmissionIds.has(submissionIdStr)) {
    console.log('[PrepPush] Duplicate pipeline for submission', submissionIdStr);
    return { saved: true, pushed: false, reason: 'duplicate_in_flight' };
  }
  if (submissionIdStr) handlingSubmissionIds.add(submissionIdStr);

  try {
  const [syncSettings, { lastHandledSubmissionId }, details] = await Promise.all([
    chrome.storage.sync.get(['githubToken', 'githubRepo', 'geminiApiKey', 'autoAnalyze']),
    chrome.storage.local.get(['lastHandledSubmissionId']),
    submission.difficulty && submission.subdomainName
      ? Promise.resolve({})
      : fetchChallengeDetails(submission.problemSlug, submission.contestSlug).catch(() => ({})),
  ]);

  if (details.difficulty || details.subdomainName || details.problemName) {
    submission = {
      ...submission,
      difficulty: submission.difficulty || details.difficulty,
      subdomainName: submission.subdomainName || details.subdomainName,
      problemName: submission.problemName || details.problemName,
    };
  }

  await chrome.storage.local.set({ latestSubmission: submission });
  console.log('[PrepPush] Submission saved to storage ✅');

  if (!isSubstantiveSubmissionCode(submission?.code)) {
    console.warn('[PrepPush] Push skipped — solution code incomplete');
    await chrome.storage.local.set({
      pushStatus: {
        status: 'error',
        message: 'Captured submission but code looks incomplete. Submit again.',
        timestamp: Date.now(),
      },
    });
    return { saved: true, pushed: false, reason: 'incomplete_code' };
  }

  if (submissionIdStr && String(lastHandledSubmissionId) === submissionIdStr) {
    console.log('[PrepPush] Duplicate event — popup updated, skipping GitHub/AI');
    return { saved: true, pushed: false, reason: 'duplicate' };
  }
  if (submissionIdStr) {
    await chrome.storage.local.set({ lastHandledSubmissionId: submission.submissionId });
  }

  const { githubToken, githubRepo, geminiApiKey, autoAnalyze = true } = syncSettings;
  let pushed = false;
  let commitUrl = null;
  let filePath = null;

  if (!githubToken) {
    console.warn('[PrepPush] GitHub settings not configured. Open popup to set up.');
    await chrome.storage.local.set({
      pushStatus: { status: 'error', message: 'GitHub not configured — open PrepPush to set up' },
    });
  } else {
    await chrome.storage.local.set({
      pushStatus: { status: 'loading', message: 'Pushing to GitHub…', timestamp: Date.now() },
    });
    try {
      const pushResult = await pushSubmissionToGitHub(submission, {
        githubToken,
        githubRepo,
      });
      if (pushResult.pushed) {
        pushed = true;
        commitUrl = pushResult.commitUrl;
        filePath = pushResult.filePath;
        submission = pushResult.submission;
        console.log('[PrepPush] Pushed to GitHub ✅', commitUrl);
        await chrome.storage.local.set({
          pushStatus: {
            status: 'success',
            message: 'Pushed to GitHub ✅',
            commitUrl,
            problemName: submission.problemName,
            filePath,
            timestamp: Date.now(),
          },
          latestSubmission: submission,
        });
        chrome.action.setBadgeText({ text: '✓' });
        chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
        setTimeout(() => chrome.action.setBadgeText({ text: '' }), 5000);
      } else if (pushResult.message) {
        await chrome.storage.local.set({
          pushStatus: { status: 'error', message: pushResult.message, timestamp: Date.now() },
        });
        return { saved: true, pushed: false, reason: pushResult.reason || 'repo_error' };
      }
    } catch (err) {
      console.error('[PrepPush] GitHub push failed:', err);
      await chrome.storage.local.set({
        pushStatus: { status: 'error', message: err.message, timestamp: Date.now() },
      });
      return { saved: true, pushed: false, reason: 'github_error' };
    }
  }

  if (autoAnalyze !== false && geminiApiKey && submission.code?.trim()) {
    if (pushed) {
      await chrome.storage.local.set({
        pushStatus: {
          status: 'loading',
          message: 'Adding AI notes…',
          timestamp: Date.now(),
        },
      });
    }
    await enrichWithAiNotes(
      { ...submission },
      { githubToken, githubRepo, geminiApiKey, autoAnalyze },
      pushed ? commitUrl : null,
      pushed ? filePath : null
    );
  }

  return { saved: true, pushed, reason: pushed ? undefined : 'no_github' };
  } finally {
    if (submissionIdStr) handlingSubmissionIds.delete(submissionIdStr);
  }
}

// ─── MESSAGE LISTENER ─────────────────────────────────────────────────────────
function onceSendResponse(sendResponse) {
  let done = false;
  return (payload) => {
    if (done) return;
    done = true;
    try {
      sendResponse(payload);
    } catch (e) {
      console.warn('[PrepPush] sendResponse failed:', e?.message || e);
    }
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const reply = onceSendResponse(sendResponse);

  if (message.type === 'SUBMISSION_ACCEPTED') {
    reply({
      status: 'received',
      saved: true,
      submissionId: message.payload?.submissionId,
    });
    handleSubmission(message.payload)
      .then((result) => console.log('[PrepPush] Submission pipeline finished', result))
      .catch((err) => console.error('[PrepPush] handleSubmission failed:', err));
    return false;
  }

  if (message.type === 'FLASH_BADGE') {
    let count = 0;
    const flash = setInterval(() => {
      chrome.action.setBadgeText({ text: count % 2 === 0 ? '!' : '' });
      chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
      count++;
      if (count >= 6) {
        clearInterval(flash);
        chrome.action.setBadgeText({ text: '' });
      }
    }, 200);
    reply({ status: 'flashed' });
    return false;
  }

  if (message.type === 'TEST_GITHUB') {
    testGitHubConnection(message.payload).then(sendResponse);
    return true;
  }

  if (message.type === 'TEST_GEMINI') {
    testGeminiConnection(message.payload?.apiKey).then(sendResponse);
    return true;
  }

  if (message.type === 'ENSURE_CONTENT_SCRIPT') {
    registerPrepPushContentScripts()
      .then(() => ensurePrepPushOnHackerRankTabs(message.tabId ?? null))
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  }

  if (message.type === 'INJECT_PAGE_INTERCEPTOR') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: 'No tab id' });
      return;
    }
    ensurePageInterceptor(tabId)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  }

  if (message.type === 'PROBE_PAGE_INTERCEPTOR') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ injected: false });
      return;
    }
    chrome.scripting
      .executeScript({
        target: { tabId, allFrames: true },
        world: 'MAIN',
        func: () => ({
          injected: !!window.__preppushInjected,
          xhrHook: !!window.__preppushXhrObserver,
          fetchTrap: !!window.__preppushFetchTrap,
          fetchPollObserver: !!window.__preppushFetchPollObserver,
          contestTrack: /\/contests\/[^/]+\/challenges\//.test(location.pathname),
          frame: window.top === window ? 'top' : 'child',
        }),
      })
      .then((results) => {
        const injected =
          results?.some(
            (r) =>
              r.result?.injected ||
              r.result?.xhrHook ||
              r.result?.fetchTrap ||
              r.result?.fetchPollObserver
          ) ?? false;
        const xhrHook = results?.some((r) => r.result?.xhrHook) ?? false;
        const fetchTrap = results?.some((r) => r.result?.fetchTrap) ?? false;
        const fetchPollObserver = results?.some((r) => r.result?.fetchPollObserver) ?? false;
        reply({ injected, xhrHook, fetchTrap, fetchPollObserver });
      })
      .catch(() => reply({ injected: false }));
    return true;
  }

  if (message.type === 'FETCH_LATEST_SUBMISSION') {
    const { contest, slug } = message;
    fetchLatestSubmissionFromHr(contest || 'master', slug || '')
      .then(reply)
      .catch((e) => reply({ submission: null, error: e?.message || String(e) }));
    return true;
  }

  if (message.type === 'SCRAPE_EDITOR_CODE') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      reply({ code: '' });
      return false;
    }
    chrome.scripting
      .executeScript({
        target: { tabId, allFrames: true },
        world: 'MAIN',
        func: () => {
          const pick = (s) => (s && String(s).trim()) || '';
          try {
            if (window.monaco?.editor?.getEditors) {
              const t = window.monaco.editor.getEditors().map((ed) => ed.getValue()).join('\n');
              const v = pick(t);
              if (v.length > 10) return v;
            }
          } catch {
            /* ignore */
          }
          const viewLines = [...document.querySelectorAll('.view-lines .view-line')];
          if (viewLines.length) {
            const v = pick(viewLines.map((l) => l.textContent || '').join('\n'));
            if (v.length > 10) return v;
          }
          for (const ta of document.querySelectorAll('textarea')) {
            const v = pick(ta.value);
            if (v.length > 20) return v;
          }
          return '';
        },
      })
      .then((results) => {
        const codes = (results || []).map((r) => r.result).filter((c) => c && c.length > 10);
        codes.sort((a, b) => b.length - a.length);
        reply({ code: codes[0] || '' });
      })
      .catch(() => reply({ code: '' }));
    return true;
  }

  return false;
});

// ─── TEST GITHUB CONNECTION ───────────────────────────────────────────────────
async function testGitHubConnection({ token, username, repo }) {
  try {
    const userRes = await githubFetch('/user', token);
    if (!userRes.ok) {
      return { success: false, error: await githubErrorMessage(userRes, 'Invalid token: ') };
    }

    const data = await userRes.json();
    const inferredUsername = data.login;
    if (username && inferredUsername?.toLowerCase() !== username.toLowerCase()) {
      return { success: false, error: `Token belongs to "${inferredUsername}", not "${username}"` };
    }

    if (!repo) {
      return { success: true, name: data.name || inferredUsername };
    }

    const repoRes = await githubFetch(`/repos/${inferredUsername}/${repo}`, token);
    if (repoRes.status === 404) {
      return {
        success: true,
        name: data.name || inferredUsername,
        warning: `Repo "${repo}" not found — PrepPush will create it on first accepted submission.`,
      };
    }

    if (!repoRes.ok) {
      return { success: false, error: await githubErrorMessage(repoRes, 'Repo access failed: ') };
    }

    const repoData = await repoRes.json();
    if (repoData.permissions && !repoData.permissions.push) {
      return {
        success: false,
        error: 'Token can see the repo but cannot push. Grant Contents (write) permission.',
      };
    }

    return { success: true, name: data.name || inferredUsername, repoReady: true };
  } catch (e) {
    return { success: false, error: 'Network error — reload the extension after updating permissions.' };
  }
}