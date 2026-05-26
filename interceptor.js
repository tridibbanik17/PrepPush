// PrepPush - interceptor.js (MAIN world)
// Observes HackerRank's own /submissions/{id} polls — no extra API requests from us.
// Contest/prep-kit pages: XHR only (fetch trap breaks compile on those flows).

(function () {
  if (window.__preppushInjected) return;
  window.__preppushInjected = true;

  const frameLabel = window.top === window ? 'top' : 'child';
  const path = window.top?.location?.pathname || window.location.pathname;
  const isContestTrack = /\/contests\/[^/]+\/challenges\//.test(path);

  console.log(
    '%c[PrepPush] Interceptor active (' +
      frameLabel +
      (isContestTrack ? ', contest track, XHR-only' : '') +
      ')',
    'color: #22c55e; font-weight: bold;'
  );

  function resolveUrl(url) {
    if (!url) return '';
    const s = String(url);
    try {
      return s.startsWith('http') ? s : new URL(s, location.origin).href;
    } catch {
      return s;
    }
  }

  function isSubmissionPollURL(url) {
    const full = resolveUrl(url);
    if (!full || full.includes('/submissions/code')) return false;
    const pathOnly = full.split('?')[0];
    return /\/submissions\/\d+\/?$/.test(pathOnly);
  }

  /** Run Code: few sample tests, no full solution code in poll body. */
  function isRunEvaluation(model) {
    const code = (model.code ?? '').trim();
    const n = model.testcase_status?.length ?? 0;
    const statusStr = String(model.status ?? '').trim();
    const statusCode = model.status_code ?? model.statusCode;
    if (/^accepted$/i.test(statusStr) && code.length > 20) return false;
    if (statusCode === 1 && code.length > 20) return false;
    if ((model.solved === 1 || model.solved === true) && code.length > 20 && n > 3) {
      return false;
    }
    if (n > 3) return false;
    if (!code && n > 0 && n <= 3) return true;
    if (statusStr === '1' && statusCode !== 1 && code.length < 20) return true;
    return false;
  }

  /** Submit Code: full evaluation with solution code (prep-kit + classic). */
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

  function modelTimestamp(model) {
    const raw = model.updated_at || model.created_at;
    return raw ? new Date(raw).getTime() : Date.now();
  }

  function buildSubmission(model) {
    const code = model.code ?? '';
    if (!code || code.trim().length < 20) return null;
    const pagePath = window.top?.location?.pathname || window.location.pathname;
    const slug =
      model.challenge_slug ??
      model.slug ??
      (pagePath.match(/\/challenges\/([^/]+)/) || [])[1] ??
      'unknown-problem';
    const contestMatch = pagePath.match(/\/contests\/([^/]+)\//);
    return {
      status: model.status || 'Accepted',
      language: model.language ?? null,
      problemName: model.name ?? null,
      problemSlug: slug,
      contestSlug:
        model.contest_slug ??
        (contestMatch ? contestMatch[1] : 'master'),
      submissionId: model.id ?? null,
      timestamp: modelTimestamp(model),
      code,
      solved: model.solved,
      statusCode: model.status_code ?? model.statusCode,
      testcaseCount: model.testcase_status?.length ?? 0,
      isFullSubmit: true,
    };
  }

  function emitAccepted(submission) {
    const id = String(submission.submissionId ?? '');
    if (!id) return;
    if (!window.__preppushEmittedIds) window.__preppushEmittedIds = new Set();
    if (window.__preppushEmittedIds.has(id)) return;
    window.__preppushEmittedIds.add(id);

    console.log(
      '[PrepPush] Captured Accepted id=%s (%d chars) [%s]',
      submission.submissionId,
      submission.code.length,
      frameLabel
    );
    const msg = { source: 'preppush', type: 'PREPPUSH_ACCEPTED', submission };
    try {
      window.postMessage(msg, '*');
      if (window.top && window.top !== window) window.top.postMessage(msg, '*');
    } catch {
      /* ignore */
    }
    document.dispatchEvent(
      new CustomEvent('preppush:accepted', { detail: submission, bubbles: true })
    );
  }

  function emitWatch(submissionId) {
    if (!submissionId) return;
    const id = String(submissionId);
    if (!window.__preppushWatchEmitted) window.__preppushWatchEmitted = new Set();
    if (window.__preppushWatchEmitted.has(id)) return;
    window.__preppushWatchEmitted.add(id);
    const msg = { source: 'preppush', type: 'PREPPUSH_WATCH', submissionId: id };
    try {
      window.postMessage(msg, '*');
      if (window.top && window.top !== window) window.top.postMessage(msg, '*');
    } catch {
      /* ignore */
    }
  }

  function tryHandlePollResponse(url, responseText) {
    if (!isSubmissionPollURL(url) || !responseText) return;
    try {
      const data = JSON.parse(responseText);
      const model = data?.model ?? data;
      if (!model) return;
      const id = model.id ?? (url.match(/\/submissions\/(\d+)/) || [])[1];
      const status = String(model.status ?? '').trim();

      if (/processing|running|in queue|compil/i.test(status)) {
        if (id) emitWatch(id);
        return;
      }

      if (!isFullSubmitEvaluation(model)) return;

      const submission = buildSubmission(model);
      if (!submission) return;
      emitAccepted(submission);
    } catch {
      /* ignore */
    }
  }

  function installXhrObserver() {
    if (window.__preppushXhrObserver) return;
    window.__preppushXhrObserver = true;

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__preppushUrl = url;
      return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      const url = this.__preppushUrl;
      if (isSubmissionPollURL(url)) {
        this.addEventListener(
          'load',
          function () {
            tryHandlePollResponse(url, this.responseText);
          },
          { once: true }
        );
      }
      return origSend.apply(this, args);
    };
  }

  /** Classic /challenges/ only — contest pages skip this (breaks prep-kit compile). */
  function installFetchTrap() {
    if (isContestTrack || window.__preppushFetchTrap) return;
    window.__preppushFetchTrap = true;

    let underlying = window.fetch.bind(window);

    async function trappedFetch(...args) {
      const response = await underlying.apply(window, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
        if (isSubmissionPollURL(url) && response?.clone) {
          response
            .clone()
            .text()
            .then((text) => tryHandlePollResponse(url, text))
            .catch(() => {});
        }
      } catch {
        /* never block HackerRank */
      }
      return response;
    }

    try {
      Object.defineProperty(window, 'fetch', {
        configurable: true,
        enumerable: true,
        get() {
          return trappedFetch;
        },
        set(fn) {
          if (typeof fn === 'function') underlying = fn.bind(window);
        },
      });
      console.log('[PrepPush] Fetch trap installed ✅ (' + frameLabel + ')');
    } catch {
      window.fetch = trappedFetch;
    }
  }

  /** Assignment-based fetch observer (safe on contest track; no defineProperty). */
  function installFetchPollObserver() {
    if (window.__preppushFetchPollObserver) return;
    window.__preppushFetchPollObserver = true;

    function attach() {
      const prev = window.fetch;
      if (!prev || typeof prev !== 'function') return;
      if (prev.__preppushPollAttached) return;
      const bound = prev.bind(window);
      async function wrapped(...args) {
        const response = await bound(...args);
        try {
          const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
          if (isSubmissionPollURL(url) && response?.clone) {
            response
              .clone()
              .text()
              .then((text) => tryHandlePollResponse(url, text))
              .catch(() => {});
          }
        } catch {
          /* never block HackerRank */
        }
        return response;
      }
      wrapped.__preppushPollAttached = true;
      window.fetch = wrapped;
    }

    attach();
    let ticks = 0;
    const reattach = setInterval(() => {
      if (!window.fetch?.__preppushPollAttached) attach();
      if (++ticks >= 45) clearInterval(reattach);
    }, 2000);
    console.log('[PrepPush] Fetch poll observer installed ✅ (' + frameLabel + ')');
  }

  installXhrObserver();
  installFetchPollObserver();

  if (!isContestTrack) {
    const scheduleFetchTrap = () => {
      if (document.readyState === 'complete') installFetchTrap();
      else window.addEventListener('load', () => installFetchTrap(), { once: true });
    };
    scheduleFetchTrap();
  }
})();
