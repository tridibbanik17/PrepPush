$path = 'C:\Users\OWNER\Downloads\PrepPush\content.js'
$lines = [System.IO.File]::ReadAllLines($path)

if ($lines[2] -match 'PREPPUSH_FRAME' -and $lines[0] -notmatch 'IIFE') {
  $header = @(
    '// PrepPush - content.js (Milestone 2 + Toast)',
    '// Wrapped in an IIFE so executeScript re-injection does not redeclare top-level const.',
    '(function PrepPushContentModule() {',
    "  'use strict';",
    '',
    "  var PREPPUSH_CS_BUILD = '1.1.0';",
    '  var isReinject = window.__preppushCsBuild === PREPPUSH_CS_BUILD;',
    '  if (isReinject || (window.__preppushCsBuild && window.__preppushCsBuild !== PREPPUSH_CS_BUILD)) {',
    '    window.__preppushMsgBridge = false;',
    '    window.__preppushNetWatch = false;',
    '    window.__preppushTestsWatcher = false;',
    '    window.__preppushSubmitWatcher = false;',
    '    window.__preppushRuntimeListener = false;',
    '    window.__preppushContentInit = false;',
    '    window.__preppushIdScan = false;',
    '    if (isReinject) {',
    "      console.log('[PrepPush] Re-injecting content script (rebind listeners)');",
    '    }',
    '  }',
    '  window.__preppushCsBuild = PREPPUSH_CS_BUILD;',
    '',
    "  var PREPPUSH_FRAME = window.top === window ? 'top' : 'child';",
    '  console.log(',
    "    '%c[PrepPush] Content script loaded ✅ (' + PREPPUSH_FRAME + ')',",
    "    'color: #22c55e; font-weight: bold;'",
    '  );',
    ''
  )

  # Remove old header lines 0-6 (comment through closing paren of console.log)
  $body = $lines[7..($lines.Length - 1)]

  # Replace footer
  $footerStart = $body.Length - 9
  for ($i = $body.Length - 1; $i -ge 0; $i--) {
    if ($body[$i] -eq 'startPrepPush();') {
      $footerStart = $i - 8
      break
    }
  }

  $middle = $body[0..($footerStart - 1)]
  $footer = @(
    '  if (window.top === window && !window.__preppushVisibilityHook) {',
    '    window.__preppushVisibilityHook = true;',
    "    document.addEventListener('visibilitychange', () => {",
    "      if (document.visibilityState === 'visible' && isExtensionAlive()) {",
    '        connectPrepPush();',
    '      }',
    '    });',
    '  }',
    '',
    '  startPrepPush();',
    '})();'
  )

  $out = $header + $middle + $footer
  [System.IO.File]::WriteAllLines($path, $out)
  Write-Output 'patched content.js'
} else {
  Write-Output 'content.js already patched or unexpected format'
  exit 1
}
