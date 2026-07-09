// PrepPush - popup.js

const DEFAULT_GITHUB_REPO = 'hackerrank-solutions';
const POPUP_THEME_KEY = 'preppushPopupTheme';

document.addEventListener('DOMContentLoaded', () => {
  const VALID_THEMES = new Set(['light', 'dark']);
  const themeToggleBtn = document.getElementById('theme-toggle');
  const appFooter = document.getElementById('app-footer');

  function applyPopupTheme(theme) {
    const t = VALID_THEMES.has(theme) ? theme : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    document.body.setAttribute('data-theme', t);
    if (themeToggleBtn) {
      const isLight = t === 'light';
      themeToggleBtn.textContent = isLight ? '🌙' : '☀️';
      const label = isLight ? 'Switch to dark mode' : 'Switch to light mode';
      themeToggleBtn.title = label;
      themeToggleBtn.setAttribute('aria-label', label);
    }
  }

  function loadPopupTheme() {
    chrome.storage.local.get([POPUP_THEME_KEY], ({ [POPUP_THEME_KEY]: saved }) => {
      applyPopupTheme(saved || 'dark');
    });
  }

  loadPopupTheme();

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      chrome.storage.local.get([POPUP_THEME_KEY], ({ [POPUP_THEME_KEY]: current }) => {
        const next = current === 'light' ? 'dark' : 'light';
        chrome.storage.local.set({ [POPUP_THEME_KEY]: next }, () => applyPopupTheme(next));
      });
    });
  }

  if (appFooter) {
    const version = chrome.runtime.getManifest().version;
    appFooter.textContent = `PrepPush v${version}`;
  }

  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const submissionCard = document.getElementById('submission-card');
  const pushStatusEl = document.getElementById('push-status');
  const clearBtn = document.getElementById('clear-btn');

  const tokenInput = document.getElementById('github-token');
  const toggleTokenBtn = document.getElementById('toggle-token');
  const testBtn = document.getElementById('test-btn');
  const clearSettingsBtn = document.getElementById('clear-settings-btn');
  const connectionStatus = document.getElementById('connection-status');
  const geminiKeyInput = document.getElementById('gemini-key');
  const toggleGeminiBtn = document.getElementById('toggle-gemini');
  const autoAnalyzeCheckbox = document.getElementById('auto-analyze');
  const testAiBtn = document.getElementById('test-ai-btn');
  const aiStatus = document.getElementById('ai-status');

  let currentTimestamp = null;
  let currentPushKey = null;
  let currentAnalysisKey = null;

  // Auto-save: the popup can close when you switch tabs (e.g. to open Gemini),
  // so persist tokens/keys as soon as the user pastes them.
  const AUTO_SAVE_DEBOUNCE_MS = 300;
  let autoSaveTimer = null;
  function scheduleAutoSave() {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      const githubToken = tokenInput.value.trim();
      const geminiApiKey = geminiKeyInput.value.trim();
      const autoAnalyze = autoAnalyzeCheckbox.checked;
      updateSetupGuideVisibility(!!githubToken);
      chrome.storage.sync.set({ githubToken, geminiApiKey, autoAnalyze });
    }, AUTO_SAVE_DEBOUNCE_MS);
  }

  tokenInput.addEventListener('input', scheduleAutoSave);
  geminiKeyInput.addEventListener('input', scheduleAutoSave);
  autoAnalyzeCheckbox.addEventListener('change', scheduleAutoSave);
  tokenInput.addEventListener('blur', scheduleAutoSave);
  geminiKeyInput.addEventListener('blur', scheduleAutoSave);

  function analysisKey(sub) {
    if (!sub?.analysis) return sub?.analysisError || '';
    return JSON.stringify(sub.analysis);
  }

  function pushStatusKey(push) {
    if (!push) return '';
    return JSON.stringify(push);
  }

  // ─── TABS ───────────────────────────────────────────────────────────────────
  function activateTab(tabName) {
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });
    document.querySelectorAll('.panel').forEach((p) => {
      p.classList.toggle('active', p.id === `tab-${tabName}`);
    });
  }

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });

  // ─── FORMAT HELPERS ──────────────────────────────────────────────────────────
  function formatTimestamp(ts) {
    if (!ts) return 'Unknown';
    return new Date(ts).toLocaleString();
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatProblemName(slug) {
    if (!slug) return 'Unknown Problem';
    return slug
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  // ─── RENDER SUBMISSION CARD ──────────────────────────────────────────────────
  function renderSubmission(sub) {
    if (!sub) {
      submissionCard.innerHTML = `
        <div class="empty-icon">⏳</div>
        <div class="empty-text">No submission captured yet.<br/>Submit a solution on HackerRank to see it here.</div>
      `;
      submissionCard.className = 'submission-card empty';
      return;
    }

    const name =
      sub.problemName && !sub.problemName.includes('-')
        ? sub.problemName
        : formatProblemName(sub.problemSlug || sub.problemName);

    const a = sub.analysis;
    const analysisHtml = a
      ? `<div class="analysis-box">
          ${a.technique ? `<div class="analysis-meta" style="margin-bottom:4px">${escapeHtml(a.technique)}</div>` : ''}
          <div class="analysis-label">Trick to remember</div>
          <div class="analysis-trick">${escapeHtml(a.trick)}</div>
          ${a.code_hint ? `<div class="analysis-meta" style="margin-top:4px">Hint: ${escapeHtml(a.code_hint)}</div>` : ''}
        </div>`
      : sub.analysisError
        ? `<div class="analysis-pending">AI: ${escapeHtml(sub.analysisError)}</div>`
        : '';

    submissionCard.className = 'submission-card';
    submissionCard.innerHTML = `
      <div class="problem-name">✅ ${escapeHtml(name)}</div>
      <div class="stats-grid">
        <div class="stat">
          <div class="stat-label">Difficulty</div>
          <div class="stat-value">${escapeHtml(sub.difficulty || 'N/A')}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Space</div>
          <div class="stat-value">${a ? escapeHtml(a.space_complexity) : '…'}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Language</div>
          <div class="stat-value neutral">${escapeHtml(sub.language || 'N/A')}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Time</div>
          <div class="stat-value">${a ? escapeHtml(a.time_complexity) : '…'}</div>
        </div>
      </div>
      ${analysisHtml}
      <div class="timestamp">🕐 ${formatTimestamp(sub.timestamp)}</div>
    `;
  }

  const GITHUB_VIEW_ZOOM = 0.9;

  function openGitHubCommit(url) {
    if (!url?.startsWith('https://github.com/')) return;
    chrome.tabs.create({ url, active: true }, (tab) => {
      if (chrome.runtime.lastError || !tab?.id) return;
      const tabId = tab.id;
      const applyZoom = () => chrome.tabs.setZoom(tabId, GITHUB_VIEW_ZOOM);
      applyZoom();
      const onUpdated = (updatedId, info) => {
        if (updatedId !== tabId || info.status !== 'complete') return;
        applyZoom();
        chrome.tabs.onUpdated.removeListener(onUpdated);
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
    });
  }

  pushStatusEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.push-status-github-btn');
    if (!btn) return;
    e.preventDefault();
    const url = pushStatusEl.dataset.commitUrl;
    if (url) openGitHubCommit(url);
  });

  // ─── RENDER PUSH STATUS ──────────────────────────────────────────────────────
  function renderPushStatus(push) {
    if (!push) {
      pushStatusEl.style.display = 'none';
      pushStatusEl.className = 'push-status';
      pushStatusEl.innerHTML = '';
      delete pushStatusEl.dataset.commitUrl;
      return;
    }

    pushStatusEl.style.display = 'block';
    pushStatusEl.className = `push-status ${push.status}`;

    let html = push.message || '';
    if (push.status === 'success' && push.commitUrl) {
      pushStatusEl.dataset.commitUrl = push.commitUrl;
      html +=
        '<button type="button" class="push-status-github-btn">View on GitHub →</button>';
    } else {
      delete pushStatusEl.dataset.commitUrl;
    }
    pushStatusEl.innerHTML = html;
  }

  // ─── LOAD STORAGE INTO UI ────────────────────────────────────────────────────
  function refreshFromStorage() {
    chrome.storage.local.get(['latestSubmission', 'pushStatus'], ({ latestSubmission, pushStatus }) => {
      const aKey = analysisKey(latestSubmission);
      const subId = latestSubmission?.submissionId ?? null;
      const prevId = submissionCard.dataset.submissionId ?? null;
      if (
        latestSubmission?.timestamp !== currentTimestamp ||
        aKey !== currentAnalysisKey ||
        String(subId) !== String(prevId)
      ) {
        currentTimestamp = latestSubmission?.timestamp ?? null;
        currentAnalysisKey = aKey;
        if (submissionCard.dataset) {
          submissionCard.dataset.submissionId = subId ?? '';
        }
        renderSubmission(latestSubmission ?? null);
      }
      const pushKey = pushStatusKey(pushStatus);
      if (pushKey !== currentPushKey) {
        currentPushKey = pushKey;
        renderPushStatus(pushStatus);
      }
    });
  }

  function pingContentScript(tabId, onResult) {
    chrome.tabs.sendMessage(tabId, { type: 'PING' }, (res) => {
      if (chrome.runtime.lastError || !res?.status) {
        onResult(false);
        return;
      }
      onResult(true, res);
    });
  }

  function ensureAndPingTab(tab) {
    if (!tab?.id || !tab.url?.includes('hackerrank.com')) {
      statusDot.classList.remove('active');
      statusDot.classList.add('inactive');
      statusText.textContent = 'Not on HackerRank';
      return;
    }

    statusDot.classList.remove('inactive');
    statusDot.classList.add('active');
    statusText.textContent = 'Connecting…';

    chrome.runtime.sendMessage({ type: 'ENSURE_CONTENT_SCRIPT', tabId: tab.id }, () => {
      pingContentScript(tab.id, (alive) => {
        if (alive) {
          statusDot.classList.remove('inactive');
          statusDot.classList.add('active');
          statusText.textContent = 'Active on HackerRank';
          chrome.tabs.sendMessage(tab.id, { type: 'PREPPUSH_CONNECT' }, () => {});
          return;
        }
        statusDot.classList.remove('active');
        statusDot.classList.add('inactive');
        statusText.textContent = 'Could not connect — try again';
      });
    });
  }

  // ─── ON OPEN: CHECK TAB & INJECT IF NEEDED ───────────────────────────────────
  setTimeout(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      ensureAndPingTab(tabs[0]);
    });
  }, 300);

  chrome.storage.local.get(['latestSubmission', 'pushStatus'], ({ latestSubmission, pushStatus }) => {
    if (latestSubmission) {
      currentTimestamp = latestSubmission.timestamp;
      currentAnalysisKey = analysisKey(latestSubmission);
      renderSubmission(latestSubmission);
    }
    currentPushKey = pushStatusKey(pushStatus);
    renderPushStatus(pushStatus);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[POPUP_THEME_KEY]) {
      applyPopupTheme(changes[POPUP_THEME_KEY].newValue);
    }
    if (changes.latestSubmission) {
      const sub = changes.latestSubmission.newValue;
      const aKey = analysisKey(sub);
      if (sub?.timestamp !== currentTimestamp || aKey !== currentAnalysisKey) {
        currentTimestamp = sub?.timestamp ?? null;
        currentAnalysisKey = aKey;
        renderSubmission(sub);
      }
    }
    if (changes.pushStatus) {
      currentPushKey = pushStatusKey(changes.pushStatus.newValue);
      renderPushStatus(changes.pushStatus.newValue);
    }
  });

  const pollInterval = setInterval(refreshFromStorage, 2000);
  window.addEventListener('unload', () => clearInterval(pollInterval));

  function withHackerRankTab(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id || !tab.url?.includes('hackerrank.com')) {
        return;
      }
      chrome.runtime.sendMessage({ type: 'ENSURE_CONTENT_SCRIPT', tabId: tab.id }, () => {
        callback(tab);
      });
    });
  }

  function messageTab(tabId, message, onResult) {
    chrome.tabs.sendMessage(tabId, message, (res) => {
      if (chrome.runtime.lastError) {
        onResult(null, chrome.runtime.lastError.message);
        return;
      }
      onResult(res);
    });
  }

  // ─── CLEAR BUTTON ────────────────────────────────────────────────────────────
  clearBtn.addEventListener('click', () => {
    chrome.storage.local.remove(['latestSubmission', 'pushStatus'], () => {
      currentTimestamp = null;
      currentPushKey = null;
      renderSubmission(null);
      renderPushStatus(null);
    });
  });

  // ─── SETTINGS ────────────────────────────────────────────────────────────────
  const setupGuide = document.getElementById('setup-guide');

  function updateSetupGuideVisibility(hasGithubToken) {
    if (!setupGuide) return;
    setupGuide.hidden = false;
    if (hasGithubToken) {
      setupGuide.removeAttribute('open');
    } else {
      setupGuide.setAttribute('open', '');
    }
  }

  chrome.storage.sync.get(
    ['githubToken', 'geminiApiKey', 'anthropicApiKey', 'autoAnalyze'],
    (data) => {
      if (data.githubToken) tokenInput.value = data.githubToken;
      if (data.geminiApiKey) geminiKeyInput.value = data.geminiApiKey;
      else if (data.anthropicApiKey) {
        showAiStatus('PrepPush now uses free Gemini — get a key above (Anthropic no longer used)', 'error');
      }
      if (data.autoAnalyze === false) autoAnalyzeCheckbox.checked = false;
      const hasToken = !!(data.githubToken || tokenInput.value.trim());
      updateSetupGuideVisibility(hasToken);
      if (!hasToken) activateTab('settings');
    }
  );

  toggleTokenBtn.addEventListener('click', () => {
    const isPassword = tokenInput.type === 'password';
    tokenInput.type = isPassword ? 'text' : 'password';
    toggleTokenBtn.textContent = isPassword ? '🙈' : '👁';
  });

  toggleGeminiBtn.addEventListener('click', () => {
    const isPassword = geminiKeyInput.type === 'password';
    geminiKeyInput.type = isPassword ? 'text' : 'password';
    toggleGeminiBtn.textContent = isPassword ? '🙈' : '👁';
  });

  function showConnection(msg, type) {
    connectionStatus.textContent = msg;
    connectionStatus.className = `settings-status ${type}`;
  }

  function showAiStatus(msg, type) {
    aiStatus.textContent = msg;
    aiStatus.className = `settings-status ${type}`;
  }

  testBtn.addEventListener('click', () => {
    const token = tokenInput.value.trim();
    if (!token) {
      showConnection('Token is required', 'error');
      return;
    }

    testBtn.disabled = true;
    showConnection('Testing connection…', 'success');

    chrome.storage.sync.get(['githubRepo'], (data) => {
      const repo = (data.githubRepo || '').trim() || DEFAULT_GITHUB_REPO;
      chrome.runtime.sendMessage(
        { type: 'TEST_GITHUB', payload: { token, repo } },
        (result) => {
          testBtn.disabled = false;
          if (chrome.runtime.lastError || !result?.success) {
            let errMsg = result?.error || chrome.runtime.lastError?.message || 'Test failed';
            if (result?.createUrl) {
              connectionStatus.innerHTML = `${errMsg} <a href="${result.createUrl}" target="_blank" rel="noopener" style="color:#4ade80">Create repo →</a>`;
              connectionStatus.className = 'settings-status error';
            } else {
              showConnection(errMsg, 'error');
            }
            return;
          }
          const extra = result.repoReady
            ? ` — repo "${repo}" is writable ✅`
            : result.warning
              ? ` — ${result.warning}`
              : '';
          showConnection(`Connected as ${result.name}${extra}`, 'success');
        }
      );
    });
  });

  testAiBtn.addEventListener('click', () => {
    const apiKey = geminiKeyInput.value.trim();
    if (!apiKey) {
      showAiStatus('Add a Gemini API key first', 'error');
      return;
    }
    testAiBtn.disabled = true;
    showAiStatus('Testing AI…', 'success');
    chrome.runtime.sendMessage({ type: 'TEST_GEMINI', payload: { apiKey } }, (result) => {
      testAiBtn.disabled = false;
      if (chrome.runtime.lastError || !result?.success) {
        showAiStatus(result?.error || chrome.runtime.lastError?.message || 'Test failed', 'error');
        return;
      }
      const modelNote = result.model ? ` (${result.model})` : '';
      showAiStatus(`Gemini connected ✅${modelNote}`, 'success');
    });
  });

  function withHackerRankTab(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id || !tab.url?.includes('hackerrank.com')) {
        return;
      }
      callback(tab);
    });
  }

  clearSettingsBtn.addEventListener('click', () => {
    chrome.storage.sync.remove(
      ['githubToken', 'githubRepo', 'geminiApiKey', 'anthropicApiKey', 'autoAnalyze'],
      () => {
        tokenInput.value = '';
        geminiKeyInput.value = '';
        autoAnalyzeCheckbox.checked = true;
        connectionStatus.className = 'settings-status';
        connectionStatus.textContent = '';
        aiStatus.className = 'settings-status';
        aiStatus.textContent = '';
        updateSetupGuideVisibility(false);
        activateTab('settings');
      }
    );
  });
});
