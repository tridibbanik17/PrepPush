// PrepPush - content.js (Milestone 2 + Toast)

// Re-injection guard: background may "executeScript" after extension reloads.
// `const` would throw on re-exec in same isolated world.
var PREPPUSH_FRAME = globalThis.PREPPUSH_FRAME || (window.top === window ? 'top' : 'child');
try { globalThis.PREPPUSH_FRAME = PREPPUSH_FRAME; } catch {}
console.log(
  '%c[PrepPush] Content script loaded ✅ (' + PREPPUSH_FRAME + ')',
  'color: #22c55e; font-weight: bold;'
);

// ─── EXTENSION CONNECTION (survives extension reload) ─────────────────────────
function getExtensionId() {
  try {
    return chrome.runtime?.id || null;
  } catch {
    return null;
  }
}

function isExtensionAlive() {
  return Boolean(getExtensionId());
}

function pingExtension() {
  return new Promise((resolve) => {
    if (!isExtensionAlive()) {
      resolve(false);
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: 'PING' }, (res) => {
        resolve(!chrome.runtime.lastError && res?.status === 'alive');
      });
    } catch {
      resolve(false);
    }
  });
}

function scheduleReconnect(reason) {
  if (window.top !== window || !isExtensionAlive()) return;
  if (window.__preppushReconnectTimer) return;
  if (reason) console.warn('[PrepPush]', reason);
  window.__preppushReconnectTimer = setTimeout(() => {
    window.__preppushReconnectTimer = null;
    requestExtensionReconnect();
  }, 400);
}

function sendToExtension(message, onResponse) {
  if (!isExtensionAlive()) {
    return false;
  }

  try {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError?.message || '';
      if (err) {
        if (
          err.includes('Extension context invalidated') ||
          err.includes('Receiving end does not exist')
        ) {
          scheduleReconnect('Background waking up — retrying connection');
          return;
        }
        if (err.includes('message channel closed')) {
          console.warn('[PrepPush] Background is still working — check the PrepPush popup in a few seconds.');
          return;
        }
        console.error('[PrepPush] Could not reach background:', err);
        return;
      }
      onResponse?.(response);
    });
    return true;
  } catch {
    scheduleReconnect('Extension context reset — retrying connection');
    return false;
  }
}

// ─── INJECT INTERCEPTOR INTO PAGE CONTEXT (via scripting API — CSP-safe) ─────
function injectInterceptor(attempt = 0) {
  if (!isExtensionAlive()) {
    if (attempt < 6) {
      setTimeout(() => injectInterceptor(attempt + 1), 400 + attempt * 250);
      return;
    }
    scheduleReconnect('Extension not ready — retrying interceptor');
    return;
  }

  try {
    chrome.runtime.sendMessage({ type: 'INJECT_PAGE_INTERCEPTOR' }, (res) => {
    const err = chrome.runtime.lastError?.message || '';
    if (err) {
      if (
        attempt < 8 &&
        (/Receiving end does not exist|context invalidated/i.test(err) ||
          /message port closed/i.test(err))
      ) {
        setTimeout(() => injectInterceptor(attempt + 1), 500);
        return;
      }
      console.error('[PrepPush] Interceptor inject failed:', err);
      if (/invalidated|does not exist/i.test(err)) scheduleReconnect('Retrying interceptor after disconnect');
      return;
    }
    if (res?.ok) {
      console.log('[PrepPush] Interceptor injected into page context ✅');
    } else if (attempt < 6) {
      setTimeout(() => injectInterceptor(attempt + 1), 500);
    } else {
      console.error('[PrepPush] Interceptor inject failed:', res?.error || 'unknown');
    }
  });
  } catch {
    scheduleReconnect('Retrying interceptor');
  }
}

function requestExtensionReconnect() {
  if (!isExtensionAlive()) return;
  try {
    chrome.runtime.sendMessage({ type: 'ENSURE_CONTENT_SCRIPT' }, () => {
      injectInterceptor(0);
      ensureInterceptorReady().catch(() => {});
    });
  } catch {
    /* stale content script — background reinjects on popup open / tab wake */
  }
}

// ─── DISMISS TOAST ───────────────────────────────────────────────────────────
// Top-level so it's accessible everywhere in this file
function dismissToast(toast) {
  if (!toast || toast.classList.contains('preppush-hiding')) return;
  toast.classList.add('preppush-hiding');
  setTimeout(() => toast.remove(), 350);
}

// ─── TOAST NOTIFICATION ──────────────────────────────────────────────────────
function showToast(problemName) {
  // Remove existing toast if any
  const existing = document.getElementById('preppush-toast');
  if (existing) existing.remove();

  // Inject styles once
  if (!document.getElementById('preppush-toast-styles')) {
    const style = document.createElement('style');
    style.id = 'preppush-toast-styles';
    style.textContent = `
      #preppush-toast {
        position: fixed;
        bottom: 28px;
        right: 28px;
        z-index: 999999;
        background: #0f172a;
        border: 1px solid #22c55e40;
        border-left: 3px solid #22c55e;
        border-radius: 10px;
        padding: 12px 16px;
        display: flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px;
        color: #f1f5f9;
        min-width: 260px;
        max-width: 340px;
        cursor: default;
        animation: preppush-slidein 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      #preppush-toast.preppush-hiding {
        animation: preppush-slideout 0.35s ease forwards;
      }

      @keyframes preppush-slidein {
        from { opacity: 0; transform: translateY(16px) scale(0.95); }
        to   { opacity: 1; transform: translateY(0)    scale(1);    }
      }

      @keyframes preppush-slideout {
        from { opacity: 1; transform: translateY(0)    scale(1);    }
        to   { opacity: 0; transform: translateY(10px) scale(0.95); }
      }

      #preppush-toast .pp-icon {
        width: 28px;
        height: 28px;
        background: linear-gradient(135deg, #22c55e, #16a34a);
        border-radius: 7px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 800;
        color: #0f172a;
        flex-shrink: 0;
        font-family: 'Courier New', monospace;
      }

      #preppush-toast .pp-content {
        flex: 1;
        min-width: 0;
      }

      #preppush-toast .pp-title {
        font-weight: 600;
        font-size: 13px;
        color: #f1f5f9;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      #preppush-toast .pp-subtitle {
        font-size: 11px;
        color: #64748b;
        margin-top: 2px;
      }

      #preppush-toast .pp-close {
        background: none;
        border: none;
        color: #475569;
        font-size: 14px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
        flex-shrink: 0;
        transition: color 0.15s;
      }

      #preppush-toast .pp-close:hover {
        color: #94a3b8;
      }

      #preppush-toast .pp-progress {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 2px;
        background: #22c55e;
        border-radius: 0 0 10px 10px;
        animation: preppush-progress 4s linear forwards;
        animation-play-state: running;
      }

      @keyframes preppush-progress {
        from { width: 100%; }
        to   { width: 0%;   }
      }
    `;
    document.head.appendChild(style);
  }

  // Build toast element
  const toast = document.createElement('div');
  toast.id = 'preppush-toast';
  toast.innerHTML = `
    <div class="pp-icon">PP</div>
    <div class="pp-content">
      <div class="pp-title">✅ ${problemName}</div>
      <div class="pp-subtitle">Saved — open PrepPush from toolbar to view</div>
    </div>
    <button class="pp-close" id="preppush-close">✕</button>
    <div class="pp-progress"></div>
  `;

  document.body.appendChild(toast);

  // Close button
  document.getElementById('preppush-close').addEventListener('click', () => {
    dismissToast(toast);
  });

  // ── TIMER: variable remaining time ────────────────────────────────────────
  const TOTAL_DURATION = 4200; // slightly > 4s CSS animation so bar finishes first
  let remaining = TOTAL_DURATION;
  let startTime = Date.now();
  let autoTimer = setTimeout(() => dismissToast(toast), remaining);
  let leaveTimer = null;

  const progressBar = toast.querySelector('.pp-progress');

  toast.addEventListener('mouseenter', () => {
    const elapsed = Date.now() - startTime;
    remaining = Math.max(0, remaining - elapsed);

    clearTimeout(autoTimer);
    clearTimeout(leaveTimer);

    progressBar.style.animationPlayState = 'paused';
  });

  toast.addEventListener('mouseleave', () => {
    progressBar.style.animationPlayState = 'running';
    startTime = Date.now(); // reset so next mouseenter measures from now
    leaveTimer = setTimeout(() => dismissToast(toast), remaining);
  });

  // Click toast body — flash badge to guide user to toolbar icon
  toast.addEventListener('click', (e) => {
    if (e.target.id === 'preppush-close') return;
    sendToExtension({ type: 'FLASH_BADGE' });
    toast.style.borderLeftColor = '#86efac';
    toast.style.transition = 'border-left-color 0.15s';
    setTimeout(() => { toast.style.borderLeftColor = '#22c55e'; }, 200);
  });
}

var SUBMISSION_FRESH_MS = globalThis.SUBMISSION_FRESH_MS || 30 * 60 * 1000;
try { globalThis.SUBMISSION_FRESH_MS = SUBMISSION_FRESH_MS; } catch {}

function isFreshSubmission(submission) {
  const ts = submission?.timestamp;
  if (!ts) return true;
  return Date.now() - ts < SUBMISSION_FRESH_MS;
}

function isSubstantiveCode(code) {
  const t = (code || '').trim();
  if (t.length < 20) return false;
  if (/if\s+__name__\s*==/m.test(t)) return true;
  if (/\binput\s*\(/m.test(t) && /\bprint\s*\(/m.test(t)) return true;
  if (/\bdef\s+\w+/m.test(t)) return t.length >= 30;
  if (looksLikeSqlCode(t)) return true;
  const lines = t.split('\n').filter((l) => l.trim()).length;
  return lines >= 3 && t.length >= 35;
}

/** Editor scrape may miss lines; still usable for prep-kit saves. */
function isEditorCodeUsable(code) {
  return isSubstantiveCode(code);
}

function shouldCaptureSubmission(submission, source) {
  if (!submission) return false;
  if (source === 'force' || source === 'api-fetch' || source === 'poll-watch') {
    if (!submission.code?.trim()) {
      console.log('[PrepPush] Skip — no code (', source, ')');
      return false;
    }
    if (
      (source === 'api-fetch' || source === 'poll-watch') &&
      !isSubstantiveCode(submission.code)
    ) {
      console.log('[PrepPush] Skip — API code incomplete (', source, ')');
      return false;
    }
    if (source === 'force' && !isEditorCodeUsable(submission.code)) {
      console.log(
        '[PrepPush] Skip — editor code incomplete (',
        submission.code.length,
        'chars). Click Submit Code, or refresh and try Capture again.'
      );
      return false;
    }
    return true;
  }
  if (source === 'dom') return false;
  if (!isSubstantiveCode(submission.code)) {
    console.log('[PrepPush] Ignoring — solution code incomplete (need full API response)');
    return false;
  }
  if (!isFreshSubmission(submission)) {
    console.log('[PrepPush] Ignoring stale submission (opened old result, not a new submit)');
    return false;
  }
  const id = submission.submissionId;
  if (id == null || String(id).startsWith('dom-')) return false;
  return true;
}

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
  return {
    difficulty: difficultyLabelFromModel(model),
    subdomainName:
      model.track?.name ||
      model.track?.track_name ||
      model.primary_contest?.track?.name ||
      null,
    problemName: model.name || null,
  };
}

function friendlySubdomainName(contestSlug, existing) {
  if (existing) return existing;
  if (contestSlug === 'software-engineer-prep-kit') return 'Software Engineer Prep Kit';
  return null;
}

function challengeDetailsFromNextData(slug) {
  const el = document.querySelector('#__NEXT_DATA__');
  if (!el?.textContent) return {};
  try {
    const walk = (obj, depth = 0) => {
      if (!obj || depth > 16) return null;
      if (typeof obj === 'object' && !Array.isArray(obj)) {
        if (
          (obj.difficulty_name || obj.difficulty != null) &&
          (obj.slug === slug || obj.challenge_slug === slug)
        ) {
          return parseChallengeModel(obj);
        }
        for (const v of Object.values(obj)) {
          const found = walk(v, depth + 1);
          if (found?.difficulty || found?.subdomainName) return found;
        }
      }
      if (Array.isArray(obj)) {
        for (const item of obj) {
          const found = walk(item, depth + 1);
          if (found?.difficulty || found?.subdomainName) return found;
        }
      }
      return null;
    };
    return walk(JSON.parse(el.textContent)) || {};
  } catch {
    return {};
  }
}

async function fetchChallengeDetailsInPage(slug, contestSlug) {
  if (!slug) return {};
  const contests = [...new Set([contestSlug || contestSlugFromPath(), contestSlugFromPath()].filter(Boolean))];
  for (const contest of contests) {
    try {
      const url = `https://www.hackerrank.com/rest/contests/${contest}/challenges/${slug}`;
      const res = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!res.ok) continue;
      const parsed = parseChallengeModel((await res.json())?.model);
      parsed.subdomainName = friendlySubdomainName(contest, parsed.subdomainName);
      if (parsed.difficulty || parsed.subdomainName) return parsed;
    } catch {
      /* ignore */
    }
  }
  const fallback = challengeDetailsFromNextData(slug);
  fallback.subdomainName = friendlySubdomainName(contestSlugFromPath(), fallback.subdomainName);
  return fallback;
}

async function handleAcceptedSubmission(submission, source) {
  if (window.top !== window) return;

  const id =
    submission?.submissionId != null ? String(submission.submissionId) : null;
  if (!id) return;

  if (!window.__preppushSeenIds) window.__preppushSeenIds = new Set();
  if (window.__preppushSeenIds.has(id)) return;
  if (!window.__preppushCaptureInFlight) window.__preppushCaptureInFlight = new Set();
  if (window.__preppushCaptureInFlight.has(id)) return;
  window.__preppushCaptureInFlight.add(id);

  try {
    if (!looksLikeFullSubmit(submission)) {
      ppLog('Skip — not a full Submit evaluation (Run/sample only)');
      return;
    }

    if (!shouldCaptureSubmission(submission, source)) {
      ppLog('Skip — shouldCaptureSubmission=false (' + source + ')');
      return;
    }

    if (!apiIndicatesFullAcceptance(submission) && !(await awaitAllTestsPassed())) {
      ppLog('Skip — API not fully accepted yet and tests-pass UI not visible');
      return;
    }

    window.__preppushSeenIds.add(id);
    clearWatching(submission.submissionId);

    if (!submission.difficulty || !submission.subdomainName) {
      const details = await fetchChallengeDetailsInPage(
        submission.problemSlug,
        submission.contestSlug
      );
      submission = {
        ...submission,
        difficulty: submission.difficulty || details.difficulty,
        subdomainName: submission.subdomainName || details.subdomainName,
        problemName: submission.problemName || details.problemName,
      };
    }

    console.log(`[PrepPush] New accepted submission (${source}):`, submission);

    const displayName = submission.problemName || submission.problemSlug || 'Solution';

    sendToExtension({ type: 'SUBMISSION_ACCEPTED', payload: submission }, (response) => {
      const err = chrome.runtime.lastError?.message;
      if (err) {
        console.error('[PrepPush] Background unreachable:', err);
        return;
      }
      if (response?.saved !== false) {
        showToast(displayName);
        try {
          sessionStorage.setItem('preppush_captured_' + (submission.problemSlug || 'unknown'), '1');
        } catch {
          /* ignore */
        }
        console.log('[PrepPush] Background saved submission ✅', response);
        window.__preppushSubmitIntent = false;
        return;
      }
      console.error('[PrepPush] Background did not save submission:', response);
    });
  } finally {
    window.__preppushCaptureInFlight?.delete(id);
  }
}

function problemSlugFromPath() {
  const m = window.location.pathname.match(/\/challenges\/([^/]+)/);
  return m ? m[1] : 'unknown-problem';
}

function contestSlugFromPath() {
  const m = window.location.pathname.match(/\/contests\/([^/]+)\//);
  if (m) return m[1];
  if (window.location.pathname.includes('software-engineer-prep-kit')) {
    return 'software-engineer-prep-kit';
  }
  return 'master';
}

function isContestTrackPage() {
  return /\/contests\/[^/]+\/challenges\//.test(window.location.pathname);
}

function testcaseCountFrom(model) {
  if (!model) return 0;
  if (Array.isArray(model.testcase_status)) return model.testcase_status.length;
  if (typeof model.testcaseCount === 'number') return model.testcaseCount;
  return 0;
}

function isRunEvaluation(model) {
  const code = (model?.code ?? '').trim();
  const n = testcaseCountFrom(model);
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

function isFullSubmitEvaluation(model) {
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

function isHrSubmissionAccepted(model) {
  return isFullSubmitEvaluation(model);
}

function looksLikeFullSubmit(sub) {
  if (!sub) return false;
  if (sub.isFullSubmit) return true;
  const code = (sub.code ?? '').trim();
  if (code.length < 20) return false;
  const statusStr = String(sub.status ?? '').trim();
  if (/^accepted$/i.test(statusStr) && (sub.solved === 1 || sub.solved === true)) return true;
  if (
    (sub.statusCode === 1 || sub.status_code === 1) &&
    (sub.solved === 1 || sub.solved === true)
  ) {
    return true;
  }
  const n = testcaseCountFrom(sub);
  if (n > 3 && (sub.solved === 1 || sub.solved === true)) return true;
  if (isRunEvaluation(sub)) return false;
  return false;
}

function apiIndicatesFullAcceptance(sub) {
  return looksLikeFullSubmit(sub);
}

function markSubmitCodeClicked() {
  window.__preppushSubmitIntent = true;
  window.__preppushSubmitIntentAt = Date.now();
  window.__preppushTestsPassedScheduled = false;
}

function hasSubmitIntent() {
  if (!window.__preppushSubmitIntent) return false;
  const age = Date.now() - (window.__preppushSubmitIntentAt || 0);
  if (age > 20 * 60 * 1000) {
    window.__preppushSubmitIntent = false;
    return false;
  }
  return true;
}

async function awaitAllTestsPassed(maxMs = 5000) {
  if (testsPassedOnPage()) return true;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 300));
    if (testsPassedOnPage()) return true;
  }
  return false;
}

function testsPassedOnPage(bodyText) {
  const t = bodyText || document.body?.innerText || '';
  return (
    /all (available )?test cases passed/i.test(t) ||
    /all tests? passed/i.test(t) ||
    (/compiler message/i.test(t) && /\bsuccess\b/i.test(t)) ||
    /submission (was )?successful/i.test(t) ||
    /status[:\s]*accepted/i.test(t) ||
    /challenge\s+(completed|solved)/i.test(t) ||
    /you\s+(have\s+)?solved\s+this/i.test(t)
  );
}

function submissionFromModel(model) {
  if (!model) return null;
  if (!isFullSubmitEvaluation(model)) return null;
  const code = model.code ?? '';
  if (!code || !isSubstantiveCode(code)) return null;
  return {
    status: model.status || 'Accepted',
    language: model.language ?? null,
    problemName: model.name ?? null,
    problemSlug: model.challenge_slug ?? model.slug ?? problemSlugFromPath(),
    contestSlug: model.contest_slug ?? contestSlugFromPath(),
    submissionId: model.id ?? null,
    timestamp: model.updated_at
      ? new Date(model.updated_at).getTime()
      : model.created_at
        ? new Date(model.created_at).getTime()
        : Date.now(),
    code,
    solved: model.solved,
    statusCode: model.status_code ?? model.statusCode,
    testcaseCount: model.testcase_status?.length ?? 0,
    isFullSubmit: true,
  };
}

function rememberSubmissionPollId(id) {
  if (id != null && id !== '') window.__preppushLastPollId = String(id);
}
try {
  globalThis.rememberSubmissionPollId = rememberSubmissionPollId;
} catch {
  /* ignore */
}

function submissionIdFromPage() {
  if (window.__preppushLastPollId) return String(window.__preppushLastPollId);
  try {
    const entries = performance.getEntriesByType('resource');
    for (let i = entries.length - 1; i >= 0; i--) {
      const name = entries[i]?.name || '';
      if (name.includes('/submissions/code')) continue;
      const hit = name.match(/\/submissions\/(\d{8,})/);
      if (hit) return hit[1];
    }
  } catch {
    /* ignore */
  }
  const html = document.documentElement?.innerHTML || '';
  const m = html.match(/\/submissions\/(\d{8,})/);
  return m ? m[1] : null;
}

function looksLikeSqlCode(code) {
  const t = String(code || '').trim();
  if (!t) return false;
  if (/^\s*\/\*[\s\S]*?\*\/\s*(select|insert|update|delete|with)\b/i.test(t)) return true;
  return /\b(select|insert|update|delete|with)\b[\s\S]*\b(from|into|set|values)\b/i.test(t);
}

function detectLanguageFromPage(code) {
  const snippet = (document.body?.innerText || '').slice(0, 8000);
  if (/\bdb2\b/i.test(snippet)) return 'db2';
  if (/\bmysql\b/i.test(snippet)) return 'mysql';
  if (/\b(postgresql|postgres)\b/i.test(snippet)) return 'postgresql';
  if (/\boracle\b/i.test(snippet)) return 'oracle';
  if (/\bsql\b/i.test(snippet)) return 'sql';
  if (looksLikeSqlCode(code)) return 'sql';
  if (/python\s*3/i.test(snippet)) return 'python3';
  if (/python/i.test(snippet)) return 'python3';
  if (/java\b/i.test(snippet)) return 'java';
  if (/javascript/i.test(snippet)) return 'javascript';
  if (/if\s+__name__/.test(code || '')) return 'python3';
  if (/\binput\s*\(/.test(code || '')) return 'python3';
  if (/\bdef\s+\w+/.test(code || '')) return 'python3';
  if (/\bpublic\s+class\b/.test(code || '')) return 'java';
  return 'unknown';
}

function ppLog(msg, level = 'log') {
  window.__preppushLastSkip = msg;
  const debug = (() => {
    try {
      return localStorage.getItem('preppush_debug') === '1';
    } catch {
      return false;
    }
  })();
  if (debug || level === 'warn' || level === 'error') {
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
      '[PrepPush]',
      msg
    );
  }
}

var PREPPUSH_API_MIN_GAP_MS = globalThis.PREPPUSH_API_MIN_GAP_MS || 8000;
/** Min gap between our API fetches during Submit / poll-watch (faster than background rate). */
var PREPPUSH_API_URGENT_GAP_MS = globalThis.PREPPUSH_API_URGENT_GAP_MS || 3000;
/** Spaced backup checks only if page hook misses Accepted. Fewer on contest track (avoid 429). */
var PREPPUSH_BACKUP_CHECK_MS = globalThis.PREPPUSH_BACKUP_CHECK_MS || [4000, 8000, 12000];
var PREPPUSH_BACKUP_CHECK_CONTEST_MS = globalThis.PREPPUSH_BACKUP_CHECK_CONTEST_MS || [12000];
try {
  globalThis.PREPPUSH_API_MIN_GAP_MS = PREPPUSH_API_MIN_GAP_MS;
  globalThis.PREPPUSH_API_URGENT_GAP_MS = PREPPUSH_API_URGENT_GAP_MS;
  globalThis.PREPPUSH_BACKUP_CHECK_MS = PREPPUSH_BACKUP_CHECK_MS;
  globalThis.PREPPUSH_BACKUP_CHECK_CONTEST_MS = PREPPUSH_BACKUP_CHECK_CONTEST_MS;
} catch {}

function preppushApiState() {
  if (!window.__preppushApi) {
    window.__preppushApi = { pausedUntil: 0, lastFetchAt: 0, inFlight: false, recentById: {} };
  }
  return window.__preppushApi;
}

function canFetchSubmissionNow(submissionId, minGapMs = 4500) {
  if (!submissionId) return false;
  const api = preppushApiState();
  const id = String(submissionId);
  const last = api.recentById[id] || 0;
  const now = Date.now();
  if (now - last < minGapMs) return false;
  api.recentById[id] = now;
  return true;
}

/** Throttled HackerRank API fetch — avoids 429 from aggressive polling. */
async function hrApiFetch(url, { urgent = false } = {}) {
  const api = preppushApiState();
  const now = Date.now();
  if (now < api.pausedUntil) {
    return { ok: false, status: 429, paused: true, model: null };
  }
  while (api.inFlight) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const minGap = urgent ? PREPPUSH_API_URGENT_GAP_MS : PREPPUSH_API_MIN_GAP_MS;
  const gap = minGap - (now - api.lastFetchAt);
  if (gap > 0) await new Promise((r) => setTimeout(r, gap));

  api.inFlight = true;
  api.lastFetchAt = Date.now();
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (res.status === 429) {
      api.pausedUntil = Date.now() + 120_000;
      console.warn(
        '[PrepPush] HackerRank rate limit (429) — PrepPush will not call the API for 2 min. ' +
          'Capture still works via HackerRank\'s own polls (no action needed).'
      );
      return { ok: false, status: 429, model: null };
    }
    if (!res.ok) return { ok: false, status: res.status, model: null };
    const data = await res.json();
    return { ok: true, status: res.status, model: data?.model ?? data };
  } catch (e) {
    return { ok: false, status: 0, error: e?.message, model: null };
  } finally {
    api.inFlight = false;
  }
}

async function fetchSubmissionModelById(submissionId, urgent = false) {
  const contest = contestSlugFromPath();
  const slug = problemSlugFromPath();
  const url = `https://www.hackerrank.com/rest/contests/${contest}/challenges/${slug}/submissions/${submissionId}`;
  const result = await hrApiFetch(url, { urgent });
  return result.ok ? result.model : null;
}

function isAlreadyCaptured(submissionId) {
  if (submissionId == null) return false;
  return window.__preppushSeenIds?.has(String(submissionId));
}

/** One urgent fetch when we see a submission poll URL (works without page interceptor). */
async function tryFetchAndCapture(submissionId, reason) {
  if (window.top !== window || !submissionId || isAlreadyCaptured(submissionId)) return;
  if (!canFetchSubmissionNow(submissionId, 5000)) return;
  try {
    const model = await fetchSubmissionModelById(submissionId, true);
    const sub = submissionFromModel(model);
    if (sub) {
      ppLog('Capture via content API fetch (' + reason + ') id=' + submissionId);
      await handleAcceptedSubmission(sub, 'poll-watch');
    }
  } catch (e) {
    const msg = e?.message || String(e);
    if (/invalidated|Extension context/i.test(msg)) {
      scheduleReconnect('Retrying after extension reload');
    }
  }
}

/** Try to read accepted submission immediately (no multi-second wait). */
async function captureAsSoonAsAccepted(reason) {
  if (window.top !== window) return;
  if (!isExtensionAlive()) return;

  try {
    await ensureInterceptorReady();
  } catch {
    return;
  }

  const fromState = submissionFromPageState();
  if (fromState && !isAlreadyCaptured(fromState.submissionId)) {
    console.log('[PrepPush] Immediate capture from page state (' + reason + ')');
    handleAcceptedSubmission(fromState, 'api-fetch');
    return;
  }

  const pageId = submissionIdFromPage();
  if (pageId && !isAlreadyCaptured(pageId)) {
    if (!canFetchSubmissionNow(pageId, 5000)) {
      waitForAcceptedViaHrPolls(pageId, { urgent: true });
      return;
    }
    const model = await fetchSubmissionModelById(pageId, true);
    const sub = submissionFromModel(model);
    if (sub) {
      console.log('[PrepPush] Immediate capture from submission API (' + reason + ')');
      handleAcceptedSubmission(sub, 'poll-watch');
      return;
    }
    waitForAcceptedViaHrPolls(pageId, { urgent: true });
    return;
  }

  waitForSubmissionIdThenWatch();
}

function ensureInterceptorReady() {
  return new Promise((resolve) => {
    if (!isExtensionAlive()) {
      resolve(false);
      return;
    }
    let attempts = 0;
    const tryOnce = () => {
      try {
        chrome.runtime.sendMessage({ type: 'INJECT_PAGE_INTERCEPTOR' }, async () => {
          const err = chrome.runtime.lastError?.message || '';
          if (err && /invalidated|does not exist/i.test(err)) {
            resolve(false);
            return;
          }
          try {
            await new Promise((r) => setTimeout(r, 280));
            const p = await probePageInterceptor();
            if (p.injected && (p.xhrHook || p.fetchTrap || p.fetchPollObserver)) {
              ppLog('Interceptor ready');
              resolve(true);
              return;
            }
            if (++attempts < 5) {
              setTimeout(tryOnce, 400);
              return;
            }
            resolve(false);
          } catch {
            resolve(false);
          }
        });
      } catch {
        resolve(false);
      }
    };
    tryOnce();
  });
}

function clearWatching(submissionId) {
  window.__preppushWatching?.delete(String(submissionId));
}

/**
 * Backup status checks if the page hook misses Accepted (sub-second, not 10s).
 */
function waitForAcceptedViaHrPolls(submissionId, options = {}) {
  if (window.top !== window) return;
  if (!submissionId) return;
  if (isAlreadyCaptured(submissionId)) return;
  if (!window.__preppushWatching) window.__preppushWatching = new Set();
  const id = String(submissionId);
  if (window.__preppushWatching.has(id)) return;
  window.__preppushWatching.add(id);

  const urgent = options.urgent === true;
  const delays = urgent
    ? isContestTrackPage()
      ? PREPPUSH_BACKUP_CHECK_CONTEST_MS
      : PREPPUSH_BACKUP_CHECK_MS
    : isContestTrackPage()
      ? PREPPUSH_BACKUP_CHECK_CONTEST_MS
      : PREPPUSH_BACKUP_CHECK_MS;

  console.log('[PrepPush] Watching', id, '— hook + backup ms:', delays.join(','));

  for (const ms of delays) {
    setTimeout(async () => {
      if (!window.__preppushWatching?.has(id) || isAlreadyCaptured(id)) return;
      const api = preppushApiState();
      if (Date.now() < api.pausedUntil) return;
      if (!canFetchSubmissionNow(id, 5000)) return;

      const model = await fetchSubmissionModelById(id, urgent || ms < 2000);
      const sub = submissionFromModel(model);
      if (sub) {
        clearWatching(id);
        handleAcceptedSubmission(sub, 'poll-watch').catch(() => {});
      }
    }, ms);
  }

  setTimeout(() => clearWatching(id), (delays.at(-1) || 0) + 4000);
}

function findAcceptedInObject(obj, depth = 0) {
  if (!obj || depth > 14) return null;
  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const sub = submissionFromModel(obj);
    if (sub) return sub;
    for (const v of Object.values(obj)) {
      const found = findAcceptedInObject(v, depth + 1);
      if (found) return found;
    }
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findAcceptedInObject(item, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function submissionFromPageState() {
  const el = document.querySelector('#__NEXT_DATA__');
  if (!el?.textContent) return null;
  try {
    return findAcceptedInObject(JSON.parse(el.textContent));
  } catch {
    return null;
  }
}

/** Manual capture only — one poll request, no list-API burst. */
async function fetchAcceptedSubmissionManual() {
  const fromState = submissionFromPageState();
  if (fromState) return fromState;

  const pageId = submissionIdFromPage();
  if (!pageId) return null;

  const model = await fetchSubmissionModelById(pageId);
  return submissionFromModel(model);
}

function scheduleActiveCapture(reason) {
  if (window.top !== window) return;
  console.log('[PrepPush] Auto-capture (' + reason + ')');
  captureAsSoonAsAccepted(reason);
}

function scrapeEditorCodeInPage() {
  const pick = (s) => (s && String(s).trim()) || '';
  try {
    if (window.monaco?.editor?.getEditors) {
      const t = window.monaco.editor
        .getEditors()
        .map((ed) => ed.getValue())
        .join('\n');
      const v = pick(t);
      if (v.length > 10) return v;
    }
  } catch {
    /* ignore */
  }
  try {
    const aceEl = document.querySelector('.ace_editor');
    if (aceEl?.env?.editor) {
      const v = pick(aceEl.env.editor.getValue());
      if (v.length > 10) return v;
    }
  } catch {
    /* ignore */
  }
  const cm = document.querySelector('.cm-content, .cm-editor .cm-line');
  if (cm) {
    const lines = [...document.querySelectorAll('.cm-line')].map((l) => l.textContent || '');
    const v = pick(lines.join('\n'));
    if (v.length > 10) return v;
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
  const ce = document.querySelector('[contenteditable="true"]');
  const v = pick(ce?.innerText);
  if (v.length > 20) return v;
  return '';
}

function readEditorCodeFromPage() {
  return new Promise((resolve) => {
    if (!isExtensionAlive()) {
      resolve(scrapeEditorCodeInPage().trim());
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: 'SCRAPE_EDITOR_CODE' }, (res) => {
        const err = chrome.runtime.lastError?.message || '';
        if (err && /invalidated|does not exist/i.test(err)) {
          scheduleReconnect('Retrying editor scrape via background');
          resolve(scrapeEditorCodeInPage().trim());
          return;
        }
        const remote = (res?.code || '').trim();
        const local = scrapeEditorCodeInPage().trim();
        const best = remote.length >= local.length ? remote : local;
        resolve(best);
      });
    } catch {
      resolve(scrapeEditorCodeInPage().trim());
    }
  });
}

/** Manual capture only (popup button). Auto-capture on page load is disabled. */
async function tryDomCapture(force = false) {
  if (!force) return;

  const bodyText = document.body?.innerText || '';
  if (!testsPassedOnPage(bodyText)) {
    console.warn('[PrepPush] Tests not showing as passed on page');
    return;
  }

  const code = await readEditorCodeFromPage();
  const slug = problemSlugFromPath();
  const title = document.title || '';
  const problemName = title.split('|')[0]?.trim() || slug;
  const pageId = submissionIdFromPage();

  handleAcceptedSubmission(
    {
      status: 'Accepted',
      language: detectLanguageFromPage(code),
      problemName,
      problemSlug: slug,
      contestSlug: contestSlugFromPath(),
      submissionId: pageId || 'force-' + slug + '-' + Date.now(),
      timestamp: Date.now(),
      code,
    },
    pageId ? 'poll-watch' : 'force'
  );
}

function initDomCapture() {
  if (window.__preppushDomCapture) return;
  window.__preppushDomCapture = true;
  window.__preppushTryDomCapture = () => tryDomCapture(true);
  window.__preppushDiagnostics = collectDiagnostics;
}

/** When API poll is missed, capture from editor after tests-pass UI appears. */
function initTestsPassedWatcher() {
  if (window.__preppushTestsWatcher) return;
  window.__preppushTestsWatcher = true;

  const check = () => {
    if (!testsPassedOnPage()) return;
    if (window.__preppushTestsPassedScheduled) return;
    window.__preppushTestsPassedScheduled = true;
    markSubmitCodeClicked();
    ppLog('Tests passed on page — capturing now');
    captureAsSoonAsAccepted('tests-passed');
    setTimeout(() => {
      if (!document.getElementById('preppush-toast')) tryDomCapture(true);
    }, 2500);
  };

  const obs = new MutationObserver(check);
  const start = () => {
    if (!document.body) return;
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    check();
  };

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}

function initPostMessageBridge() {
  if (window.top !== window) return;
  if (window.__preppushMsgBridge) return;
  window.__preppushMsgBridge = true;

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'preppush') return;
    if (data.type === 'PREPPUSH_SUBMIT_CLICKED') {
      window.__preppushWatchEmitted = new Set();
      window.__preppushEmittedIds = new Set();
      markSubmitCodeClicked();
      ensureInterceptorReady();
      waitForSubmissionIdThenWatch();
      scheduleActiveCapture('submit-click');
      return;
    }
    if (data.type === 'PREPPUSH_WATCH' && data.submissionId) {
      try {
        rememberSubmissionPollId(data.submissionId);
        markSubmitCodeClicked();
        waitForAcceptedViaHrPolls(data.submissionId, { urgent: true });
        tryFetchAndCapture(data.submissionId, 'watch');
      } catch (e) {
        console.warn('[PrepPush] WATCH handler:', e?.message || e);
      }
      return;
    }
    if (data.type === 'PREPPUSH_ACCEPTED' && data.submission) {
      rememberSubmissionPollId(data.submission.submissionId);
      handleAcceptedSubmission(data.submission, 'api').catch((e) => {
        const msg = e?.message || String(e);
        if (/invalidated|Extension context/i.test(msg)) {
          scheduleReconnect('Retrying capture after extension reload');
        }
      });
    }
  });
}

/** Detect /submissions/{id} poll requests (same URL as Network tab) and watch until Accepted. */
function initSubmissionNetworkWatcher() {
  if (window.top !== window) return;
  if (window.__preppushNetWatch) return;
  window.__preppushNetWatch = true;

  const started = new Set();
  const debounce = {};

  function onPollUrl(url) {
    if (!url || url.includes('/submissions/code')) return;
    const m = String(url).match(/\/submissions\/(\d{8,})/);
    if (!m) return;
    const id = m[1];
    if (started.has(id)) return;
    if (debounce[id]) return;
    debounce[id] = setTimeout(() => {
      try {
        delete debounce[id];
        started.add(id);
        rememberSubmissionPollId(id);
        markSubmitCodeClicked();
        ppLog('HackerRank polling submission ' + id);
        tryFetchAndCapture(id, 'net-poll');
        waitForAcceptedViaHrPolls(id, { urgent: true });
        captureAsSoonAsAccepted('poll-url');
      } catch (e) {
        console.warn('[PrepPush] poll handler:', e?.message || e);
      }
    }, 150);
  }

  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) onPollUrl(entry.name);
    });
    po.observe({ type: 'resource', buffered: true });
  } catch (e) {
    console.warn('[PrepPush] PerformanceObserver failed:', e?.message || e);
  }

  for (const entry of performance.getEntriesByType('resource')) onPollUrl(entry.name);
}

function waitForSubmissionIdThenWatch() {
  if (window.__preppushIdScan) return;
  window.__preppushIdScan = true;
  let attempts = 0;
  const tick = () => {
    const id = submissionIdFromPage();
    if (id) {
      window.__preppushIdScan = false;
      waitForAcceptedViaHrPolls(id, { urgent: true });
      captureAsSoonAsAccepted('submission-id');
      return;
    }
    if (++attempts < 20) setTimeout(tick, 400);
    else window.__preppushIdScan = false;
  };
  tick();
}

function isSubmitCodeControl(el, label) {
  if (!el && !label) return false;
  const l = (label || '').toLowerCase();
  if (/submit\s*code/i.test(l) || /^submit$/i.test(l) || /submit\s*solution/i.test(l)) return true;
  const testId = el?.getAttribute?.('data-testid') || el?.closest?.('[data-testid]')?.getAttribute?.('data-testid') || '';
  if (/submit/i.test(testId)) return true;
  const analytics = el?.getAttribute?.('data-analytics') || '';
  if (/submit/i.test(analytics)) return true;
  return false;
}

function isRunCodeControl(label) {
  return /run\s*code/i.test(label || '') || /^run$/i.test(label || '');
}

function onSubmitCodeClicked() {
  if (window.top !== window) {
    try {
      window.top.postMessage({ source: 'preppush', type: 'PREPPUSH_SUBMIT_CLICKED' }, '*');
    } catch {
      /* ignore */
    }
    return;
  }
  markSubmitCodeClicked();
  console.log('[PrepPush] Submit Code — will capture when all tests pass');
  ensureInterceptorReady();
  waitForSubmissionIdThenWatch();
  scheduleActiveCapture('submit-click');
}

function initSubmitButtonWatcher() {
  if (window.__preppushSubmitWatcher) return;
  window.__preppushSubmitWatcher = true;

  document.addEventListener(
    'click',
    (e) => {
      const el = e.target?.closest?.('button, a, [role="button"], input[type="submit"]') || e.target;
      const label = [
        el?.textContent,
        el?.innerText,
        el?.getAttribute?.('aria-label'),
        el?.getAttribute?.('title'),
        el?.value,
      ]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (isSubmitCodeControl(el, label)) {
        window.__preppushWatchEmitted = new Set();
        window.__preppushEmittedIds = new Set();
        onSubmitCodeClicked();
      } else if (isRunCodeControl(label)) {
        console.log('[PrepPush] Run Code — not capturing');
      }
    },
    true
  );
}

function probePageInterceptor() {
  return new Promise((resolve) => {
    if (!isExtensionAlive()) {
      resolve({ injected: false, xhrHook: false, fetchTrap: false, fetchPollObserver: false });
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: 'PROBE_PAGE_INTERCEPTOR' }, (res) => {
        resolve({
          injected: !!res?.injected,
          xhrHook: !!res?.xhrHook,
          fetchTrap: !!res?.fetchTrap,
          fetchPollObserver: !!res?.fetchPollObserver,
        });
      });
    } catch {
      resolve({ injected: false, xhrHook: false, fetchTrap: false, fetchPollObserver: false });
    }
  });
}

async function collectDiagnostics() {
  const bodyText = document.body?.innerText || '';
  if (isExtensionAlive()) {
    try {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'INJECT_PAGE_INTERCEPTOR' }, () => resolve());
      });
    } catch {
      /* extension reloaded */
    }
  }
  await new Promise((r) => setTimeout(r, 600));
  const page = await probePageInterceptor();
  const code = await readEditorCodeFromPage();

  const pageId = submissionIdFromPage();
  let pollProbe = null;
  if (pageId) {
    const model = await fetchSubmissionModelById(pageId, true);
    pollProbe = model
      ? {
          id: model.id,
          status: model.status,
          solved: model.solved,
          status_code: model.status_code,
          testcaseCount: model.testcase_status?.length,
          codeLen: (model.code || '').length,
          fullSubmit: isFullSubmitEvaluation(model),
        }
      : { id: pageId, fetchFailed: true };
  }

  let extensionVersion = null;
  try {
    extensionVersion = chrome.runtime.getManifest?.()?.version ?? null;
  } catch {
    /* invalidated */
  }

  return {
    extensionVersion,
    url: location.href,
    frame: window.top === window ? 'top' : 'iframe',
    contentScript: !!window.__preppushContentInit,
    pageInterceptor: page.injected,
    xhrHook: page.xhrHook,
    fetchPollObserver: page.fetchPollObserver,
    extensionAlive: isExtensionAlive(),
    submitIntent: hasSubmitIntent(),
    testsPassedVisible: testsPassedOnPage(bodyText),
    contestTrack: isContestTrackPage(),
    editorCodeChars: code.length,
    problemSlug: problemSlugFromPath(),
    submissionIdOnPage: pageId,
    lastPollId: window.__preppushLastPollId || null,
    pollProbe,
    lastSkip: window.__preppushLastSkip || null,
    seenIds: window.__preppushSeenIds ? [...window.__preppushSeenIds] : [],
    bodySnippet: bodyText.replace(/\s+/g, ' ').slice(0, 280),
  };
}

function registerRuntimeMessageListener() {
  if (window.__preppushRuntimeListener) return;
  window.__preppushRuntimeListener = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ status: 'alive', url: window.location.href, frame: PREPPUSH_FRAME });
      return;
    }
    if (message.type === 'PREPPUSH_CONNECT') {
      connectPrepPush();
      sendResponse({ status: 'connected', frame: PREPPUSH_FRAME });
      return;
    }
    if (message.type === 'DIAGNOSTICS') {
      collectDiagnostics().then((data) => sendResponse({ ok: true, ...data }));
      return true;
    }
    if (message.type === 'FORCE_CAPTURE') {
      (async () => {
        try {
          const pageId = submissionIdFromPage();
          if (pageId) {
            const model = await fetchSubmissionModelById(pageId);
            const sub = submissionFromModel(model);
            if (sub) {
              handleAcceptedSubmission(sub, 'api-fetch');
              sendResponse({ ok: true, method: 'api-poll' });
              return;
            }
            waitForAcceptedViaHrPolls(pageId);
            sendResponse({ ok: true, method: 'watch' });
            return;
          }
          const sub = await fetchAcceptedSubmissionManual();
          if (sub) {
            handleAcceptedSubmission(sub, 'api-fetch');
            sendResponse({ ok: true, method: 'api' });
            return;
          }
          const fn = window.__preppushTryDomCapture;
          if (typeof fn !== 'function') {
            sendResponse({ ok: false, error: 'No submission found — click Submit Code, then try again' });
            return;
          }
          await fn();
          sendResponse({ ok: true, method: 'dom' });
        } catch (e) {
          sendResponse({ ok: false, error: e?.message || String(e) });
        }
      })();
      return true;
    }
  });
}

function softReactivatePrepPush() {
  initDomCapture();
  initPostMessageBridge();
  initSubmissionNetworkWatcher();
  initTestsPassedWatcher();
  initSubmitButtonWatcher();
  injectInterceptor(0);
  ensureInterceptorReady();
}

function bootPrepPush() {
  softReactivatePrepPush();
  console.log('[PrepPush] Boot complete (' + PREPPUSH_FRAME + ')');
}

function connectPrepPush() {
  const extId = getExtensionId();
  if (!extId) return;
  const extensionChanged = window.__preppushExtensionId && window.__preppushExtensionId !== extId;
  window.__preppushExtensionId = extId;
  window.__preppushContentInit = true;

  if (extensionChanged) {
    console.log('[PrepPush] Extension reloaded — rebinding');
    bootPrepPush();
    return;
  }
  softReactivatePrepPush();
}

function startPrepPush() {
  try {
    registerRuntimeMessageListener();
  } catch {
    /* extension context invalidated */
  }

  if (!isExtensionAlive()) return;

  connectPrepPush();

  pingExtension()
    .then((ok) => {
      if (!ok && isExtensionAlive()) requestExtensionReconnect();
    })
    .catch(() => {});
}

if (window.top === window) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isExtensionAlive()) {
      connectPrepPush();
    }
  });
}

startPrepPush();
