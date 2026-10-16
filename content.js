(function () {
  // Self-heal double-injection: reloading the extension without refreshing
  // the tab leaves this orphaned copy running alongside the new one. The old
  // copy has a dead chrome.runtime port - ANY chrome.* call from it throws
  // "Extension context invalidated" as an Uncaught Error (your screenshots).
  var PT_INSTANCE = "pt_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  try {
    if (window.__PERSIAN_TRANSLATOR_ACTIVE__) {
      try { window.__PERSIAN_TRANSLATOR_DEAD__[window.__PERSIAN_TRANSLATOR_ACTIVE__] = true; } catch (e0) { /* ignore */ }
    }
    window.__PERSIAN_TRANSLATOR_ACTIVE__ = PT_INSTANCE;
    window.__PERSIAN_TRANSLATOR_DEAD__ = window.__PERSIAN_TRANSLATOR_DEAD__ || {};
  } catch (e) { /* ignore */ }
  function isOrphaned() {
    try { return !!(window.__PERSIAN_TRANSLATOR_ACTIVE__ && window.__PERSIAN_TRANSLATOR_ACTIVE__ !== PT_INSTANCE); }
    catch (e2) { return false; }
  }
  // Last-resort safety net: Chrome can surface a rejected sendMessage promise
  // as "Uncaught Error: Extension context invalidated" with a WRONG line
  // number (your screenshots show :134 pointing at 3 different lines).
  // Swallow ONLY that specific error globally; let all real bugs through.
  function isContextError(msg) {
    return /extension context invalidated/i.test(String(msg || ""));
  }
  try {
    window.addEventListener("unhandledrejection", function (ev) {
      try {
        var msg = (ev && ev.reason && (ev.reason.message || ev.reason)) || "";
        if (isContextError(msg)) {
          if (ev.preventDefault) ev.preventDefault();
          return false;
        }
      } catch (e3) { /* ignore */ }
    });
    window.addEventListener("error", function (ev) {
      try {
        var m = (ev && (ev.message || (ev.error && ev.error.message))) || "";
        if (isContextError(m)) {
          if (ev.preventDefault) ev.preventDefault();
          return false;
        }
      } catch (e4) { /* ignore */ }
    }, true);
  } catch (e5) { /* ignore */ }
  // Material Icons "translate" glyph. The SVG is built with createElementNS
  // (see createTranslateIcon) instead of innerHTML.
  const TRANSLATE_ICON_PATH_D = "M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const PT_VERSION = "1.0.5-bidi-fix";
  const MAX_SELECTION_LENGTH = 30000;

  let translateBtn = null;
  let tooltip = null;

  // NOTE: Never use innerHTML in this file. Pages such as aistudio.google.com
  // send `Content-Security-Policy: require-trusted-types-for 'script'`, which
  // makes innerHTML string assignments throw TypeError even inside content
  // scripts. Build all DOM with createElement/createElementNS + textContent.
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function createTranslateIcon() {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("xmlns", SVG_NS);
    var path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", TRANSLATE_ICON_PATH_D);
    svg.appendChild(path);
    return svg;
  }

  function mountRoot() {
    return document.body || document.documentElement;
  }

  function getSelectedText() {
    var selection = window.getSelection();
    if (!selection || selection.isCollapsed) return "";
    return selection.toString().trim();
  }

  function getSelectionRect() {
    var selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;
    var range = selection.getRangeAt(0);
    return range.getBoundingClientRect();
  }

  // Text selected inside <textarea>/<input> is not exposed through
  // window.getSelection(), so read it straight from the focused control.
  // Password fields are deliberately excluded.
  function getInputSelection() {
    try {
      var active = document.activeElement;
      if (!active || typeof active.value !== "string") return null;
      var tag = active.tagName;
      var isTextArea = tag === "TEXTAREA";
      var isTextInput = tag === "INPUT" && /^(text|search|email|url|tel)$/i.test(active.type || "text");
      if (!isTextArea && !isTextInput) return null;
      // NOTE: Chrome throws InvalidStateError when reading selectionStart/
      // selectionEnd from input types that do not support selection (email,
      // number, ...), so the whole read is guarded.
      var start = active.selectionStart;
      var end = active.selectionEnd;
      if (typeof start !== "number" || typeof end !== "number") return null;
      if (start === end) return null;
      var text = active.value.slice(start, end).trim();
      if (!text) return null;
      return { text: text, rect: active.getBoundingClientRect() };
    } catch (e) {
      return null;
    }
  }

  // { text, rect } for whatever is selected. The DOM branch requires actual
  // text: browsers retarget a textarea/input selection to a range covering
  // the control itself (empty toString()), so fall through to the input reader.
  function getAnchor() {
    var rect = getSelectionRect();
    var text = getSelectedText();
    if (text && rect && rect.width > 0 && rect.height > 0) {
      return { text: text, rect: rect };
    }
    return getInputSelection();
  }

  function getAnchorRect() {
    var anchor = getAnchor();
    return anchor ? anchor.rect : null;
  }

  function removeTooltip() {
    if (tooltip) {
      tooltip.remove();
      tooltip = null;
    }
  }

  function removeButton() {
    if (translateBtn) {
      translateBtn.remove();
      translateBtn = null;
    }
  }

  // NOTE: chrome.runtime is intentionally NEVER touched from this file. Even
  // reading chrome.runtime.id can throw "Extension context invalidated"
  // (Chromium reports it at a bogus line like content.js:134) and some throws
  // happen outside any try/catch. Translation goes through fetch() instead.

  function friendlyError(e) {
    var message = e && e.message ? e.message : String(e);
    if (/invalidated|context lost/i.test(message)) {
      return "the extension was reloaded - please refresh this page";
    }
    return message;
  }

  function createTooltip(text, translatedText, detectedLang, targetLang) {
    removeTooltip();
    tooltip = el("div", "persian-translator-tooltip");

    var langLabel = (detectedLang || "?").toUpperCase() + " \u2192 " + (targetLang || "?").toUpperCase();
    var displayText = text.length > 200 ? text.slice(0, 200) + "..." : text;

    var header = el("div", "pt-header");
    header.appendChild(el("span", "pt-lang-badge", langLabel));
    var closeBtn = el("button", "pt-close");
    closeBtn.title = "Close";
    closeBtn.textContent = "\u00d7";
    header.appendChild(closeBtn);

    var copyBtn = el("button", "pt-copy");
    copyBtn.textContent = "Copy";

    var actions = el("div", "pt-actions");
    actions.appendChild(copyBtn);

    tooltip.appendChild(header);

    // Each text block gets its own bidi base direction so embedded English
    // words inside Persian (and vice versa) keep the surrounding sentence in
    // the correct visual order. The dir attribute + inline styles are applied
    // together; applyBidi also preserves the translation's line breaks.
    var originalEl = el("div", "pt-original", displayText);
    applyBidi(originalEl, displayText);
    tooltip.appendChild(originalEl);

    var translatedEl = el("div", "pt-translated", translatedText);
    applyBidi(translatedEl, translatedText);
    tooltip.appendChild(translatedEl);

    tooltip.appendChild(actions);

    closeBtn.addEventListener("click", removeTooltip);
    copyBtn.addEventListener("click", function () {
      var flash = function (msg) {
        copyBtn.textContent = msg;
        setTimeout(function () { copyBtn.textContent = "Copy"; }, 1500);
      };
      var onCopied = function () { flash("Copied!"); };
      var onFailed = function (err) {
        // A dead extension context means this page still runs a script from
        // before the extension was reloaded: tell the user to refresh.
        flash(err && /context/i.test(String(err.message || err)) ? "Refresh page" : "Copy failed");
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          // Two-callback then() so a rejection can never surface as an
          // uncaught "Extension context invalidated" error.
          navigator.clipboard.writeText(translatedText).then(onCopied, onFailed);
        } else {
          // Fallback for non-secure contexts without the async clipboard API.
          var helper = document.createElement("textarea");
          helper.value = translatedText;
          helper.setAttribute("readonly", "");
          helper.style.position = "fixed";
          helper.style.opacity = "0";
          mountRoot().appendChild(helper);
          helper.select();
          var copied = !!(document.execCommand && document.execCommand("copy"));
          helper.remove();
          if (copied) onCopied(); else onFailed(null);
        }
      } catch (e) {
        onFailed(e);
      }
    });

    mountRoot().appendChild(tooltip);
    positionTooltip();
  }

  function positionTooltip() {
    if (!tooltip) return;
    try {
      var rect = getAnchorRect();
      if (!rect) {
        // No anchor available: fall back to a stable spot in the viewport.
        tooltip.style.left = (window.scrollX + 16) + "px";
        tooltip.style.top = (window.scrollY + 16) + "px";
        return;
      }

      var left = rect.left + window.scrollX;
      var top = rect.bottom + window.scrollY + 8;

      var tooltipRect = tooltip.getBoundingClientRect();
      if (left + tooltipRect.width > window.innerWidth - 16) {
        left = window.innerWidth - tooltipRect.width - 16 + window.scrollX;
      }
      if (left < 16) left = 16 + window.scrollX;
      if (top + tooltipRect.height > window.innerHeight + window.scrollY - 16) {
        top = rect.top + window.scrollY - tooltipRect.height - 8;
      }

      tooltip.style.left = left + "px";
      tooltip.style.top = top + "px";
    } catch (e) {
      // Positioning must never break the translation flow; park the tooltip
      // at a safe default spot instead.
      try {
        tooltip.style.left = (window.scrollX + 16) + "px";
        tooltip.style.top = (window.scrollY + 16) + "px";
      } catch (e2) { /* ignore */ }
    }
  }

  function createLoadingTooltip() {
    removeTooltip();
    tooltip = el("div", "persian-translator-tooltip");
    tooltip.appendChild(el("div", "pt-loading", "Translating..."));
    mountRoot().appendChild(tooltip);
    positionTooltip();
  }

  function createErrorTooltip(message) {
    removeTooltip();
    tooltip = el("div", "persian-translator-tooltip");

    var header = el("div", "pt-header");
    header.appendChild(el("span", "pt-lang-badge", "Error"));
    var closeBtn = el("button", "pt-close");
    closeBtn.title = "Close";
    closeBtn.textContent = "\u00d7";
    header.appendChild(closeBtn);
    tooltip.appendChild(header);
    tooltip.appendChild(el("div", "pt-error", message));

    closeBtn.addEventListener("click", removeTooltip);
    mountRoot().appendChild(tooltip);
    positionTooltip();
  }

  function detectTargetLangLocal(text) {
    try {
      return /[؀-ۿݐ-ݿﭐ-﷿]/.test(text) ? "en" : "fa";
    } catch (e) { return "fa"; }
  }

  // Bidi helper. Persian/Arabic/Hebrew text must be rendered with an RTL base
  // direction; otherwise an embedded English word (e.g. "async") splits the
  // sentence into LTR-ordered segments and the Persian reads scrambled.
  // A leading punctuation/space must not decide the direction, so we only look
  // for the first strong (letter) character.
  const RTL_CHARS = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
  const LTR_CHARS = /[A-Za-z\u00C0-\u02B8\u0370-\u0590\u0900-\u1FFF\u2C00-\uD7FF\uF900-\uFB17]/;
  function textDirection(text) {
    var s = String(text || "");
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (RTL_CHARS.test(ch)) return "rtl";
      if (LTR_CHARS.test(ch)) return "ltr";
    }
    return "ltr";
  }

  // Apply the bidi base direction as INLINE !important styles. Host-page CSS
  // (RTL themes, "direction: ltr !important" resets, ...) otherwise overrides
  // the injected stylesheet and the sentence scrambles again. Inline !important
  // outranks every author rule, so the direction always sticks.
  function applyBidi(node, text) {
    var dir = textDirection(text);
    try { node.setAttribute("dir", dir); } catch (e) { /* ignore */ }
    try {
      node.style.setProperty("direction", dir, "important");
      node.style.setProperty("text-align", dir === "rtl" ? "right" : "left", "important");
      node.style.setProperty("unicode-bidi", "isolate", "important");
      node.style.setProperty("white-space", "pre-wrap", "important");
    } catch (e2) { /* ignore */ }
  }

  // Direct translation inside the content script: no chrome.runtime needed,
  // so an invalidated extension context can never produce "Uncaught Error".
  // Requires host permission for translate.googleapis.com (already in manifest).
  function translateDirectly(text, targetLang, onDone) {
    try {
      var params = "client=gtx&sl=auto&tl=" + encodeURIComponent(targetLang) +
        "&dt=t&q=" + encodeURIComponent(text);
      fetch("https://translate.googleapis.com/translate_a/single", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: params
      }).then(function (resp) {
        if (!resp.ok) throw new Error("API returned status " + resp.status);
        return resp.json();
      }).then(function (data) {
        if (!data || !data[0] || !Object.prototype.toString.call(data[0]).slice(8, -1)) {
          // data[0] must be an array; checked without Array.isArray for CSP safety.
        }
        var parts = (data && data[0]) || [];
        var out = "";
        for (var i = 0; i < parts.length; i++) {
          if (parts[i] && parts[i][0]) out += parts[i][0];
        }
        var detected = (data && data[2]) || null;
        onDone(null, { translated: out, detectedLang: detected, targetLang: targetLang });
      }, function (err) {
        onDone(err || new Error("Translation failed"));
      });
    } catch (e) {
      onDone(e);
    }
  }

  function handleTranslate() {
    var settled = false;
    var timeoutId = null;
    // A superseded copy must stay completely silent: its chrome.* port is
    // dead and even guarded chrome.runtime touches may reject as uncaught.
    if (isOrphaned()) return;
    try {
      var anchor = getAnchor();
      if (!anchor || !anchor.text) return;
      var text = anchor.text;

      removeButton();
      createLoadingTooltip();

      if (text.length > MAX_SELECTION_LENGTH) {
        createErrorTooltip(
          "Selected text is too long to translate (" + text.length +
          " characters, the limit is " + MAX_SELECTION_LENGTH + ")."
        );
        return;
      }

      // The UI must never stay stuck on "Translating...": time out if the
      // background script does not answer.
      timeoutId = setTimeout(function () {
        if (settled) return;
        settled = true;
        createErrorTooltip("Translation timed out. Please try again.");
      }, 30000);

      var done = function (showResult) {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        try {
          showResult();
        } catch (e) {
          createErrorTooltip("Translation failed: " + friendlyError(e));
        }
      };

      var targetLang = detectTargetLangLocal(text);

      // DIRECT-ONLY: no chrome.runtime.sendMessage at all. In MV3 that call
      // throws "Extension context invalidated" from Chromium internals where
      // try/catch cannot reach it (it reports at an unrelated line, e.g.
      // content.js:134 pointing at a "}" brace). fetch() has no extension
      // context dependency, so it can never raise this error.
      var CHUNK = 1500;
      var chunks = [];
      var rest = text;
      while (rest.length > CHUNK) {
        var cut = rest.lastIndexOf(" ", CHUNK);
        var nl = rest.lastIndexOf("\n", CHUNK);
        if (nl > cut) cut = nl;
        if (cut < Math.floor(CHUNK / 2)) cut = CHUNK;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut).replace(/^\s+/, "");
      }
      if (rest.length > 0) chunks.push(rest);

      var translated = "";
      var detected = null;
      var idx = 0;
      var step = function () {
        if (idx >= chunks.length) {
          if (!detected) {
            detected = detectTargetLangLocal(text) === "en" ? "fa" : "en";
          }
          done(function () {
            createTooltip(text, translated, detected, targetLang);
          });
          return;
        }
        translateDirectly(chunks[idx], targetLang, function (err, res) {
          if (err) {
            done(function () {
              createErrorTooltip("Translation failed: " + friendlyError(err));
            });
            return;
          }
          translated += res.translated;
          if (res.detectedLang) detected = res.detectedLang;
          idx += 1;
          step();
        });
      };
      step();
    } catch (e) {
      // Covers synchronous failures (e.g. "Extension context invalidated"
      // thrown by chrome.runtime.sendMessage after an extension reload).
      // The timeout must be cancelled here, otherwise it would fire later and
      // pop up a zombie "timed out" tooltip over the page.
      settled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      try { removeTooltip(); } catch (e2) { /* ignore */ }
      createErrorTooltip("Translation failed: " + friendlyError(e));
    }
  }

  function refreshButton() {
    if (tooltip) return;
    // Superseded copy: remove its UI and go silent so only the newest
    // injected copy handles the page. No chrome.* calls here on purpose.
    if (isOrphaned()) {
      try {
        if (translateBtn && translateBtn.parentNode) translateBtn.parentNode.removeChild(translateBtn);
      } catch (e) { /* ignore */ }
      translateBtn = null;
      try {
        if (tooltip && tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
      } catch (e2) { /* ignore */ }
      tooltip = null;
      return;
    }

    try {
      var anchor = getAnchor();
      if (anchor && anchor.text) {
        var rect = anchor.rect;
        if (!translateBtn) {
          translateBtn = document.createElement("button");
          translateBtn.className = "persian-translator-btn";
          translateBtn.appendChild(createTranslateIcon());
          translateBtn.title = "Translate selection";
          translateBtn.addEventListener("mousedown", function (e) {
            e.preventDefault();
            e.stopPropagation();
            handleTranslate();
          });
          mountRoot().appendChild(translateBtn);
        }
        var top = rect.top + window.scrollY - 40;
        // If there is no room above the selection (top of page, form control),
        // place the button below instead.
        if (top < window.scrollY + 4) top = rect.bottom + window.scrollY + 8;
        translateBtn.style.left = (rect.left + window.scrollX + rect.width / 2 - 16) + "px";
        translateBtn.style.top = top + "px";
        translateBtn.classList.add("visible");
        return;
      }
      if (translateBtn) {
        translateBtn.classList.remove("visible");
      }
    } catch (e) {
      // A page quirk must never silently kill selection handling; log it so
      // the failure is diagnosable.
      if (typeof console !== "undefined" && console.error) {
        console.error("[Persian Translator]", e);
      }
    }
  }

  // Listeners are registered on window in the capture phase: they run before
  // any page handler, so page code that calls stopPropagation() on document
  // (common on heavyweight SPAs) cannot hide the selection UI from us.
  window.addEventListener("mouseup", function () {
    setTimeout(refreshButton, 10);
  }, true);

  window.addEventListener("keyup", function () {
    // Covers keyboard-driven selections (Shift+Arrow, Ctrl+A, ...).
    refreshButton();
  }, true);

  window.addEventListener("mousedown", function (e) {
    if (tooltip && !tooltip.contains(e.target)) {
      removeTooltip();
    }
    if (translateBtn && !translateBtn.contains(e.target) && !tooltip) {
      translateBtn.classList.remove("visible");
    }
  }, true);

  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      removeTooltip();
      if (translateBtn) translateBtn.classList.remove("visible");
    }
  }, true);
})();
