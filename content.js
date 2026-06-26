(function () {
  const TRANSLATE_ICON_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>';

  let translateBtn = null;
  let tooltip = null;

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function getSelectedText() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return "";
    return selection.toString().trim();
  }

  function getSelectionRect() {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return range.getBoundingClientRect();
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

  function createTooltip(text, translatedText, detectedLang, targetLang) {
    removeTooltip();
    tooltip = document.createElement("div");
    tooltip.className = "persian-translator-tooltip";

    const langLabel = detectedLang.toUpperCase() + " → " + targetLang.toUpperCase();
    const displayText = text.length > 200 ? text.slice(0, 200) + "..." : text;

    tooltip.innerHTML =
      '<div class="pt-header">' +
        '<span class="pt-lang-badge">' + langLabel + '</span>' +
        '<button class="pt-close" title="Close">&times;</button>' +
      '</div>' +
      '<div class="pt-original">' + escapeHtml(displayText) + '</div>' +
      '<div class="pt-translated">' + escapeHtml(translatedText) + '</div>' +
      '<div class="pt-actions">' +
        '<button class="pt-copy">Copy</button>' +
      '</div>';

    tooltip.querySelector(".pt-close").addEventListener("click", removeTooltip);
    tooltip.querySelector(".pt-copy").addEventListener("click", function () {
      navigator.clipboard.writeText(translatedText).then(function () {
        var btn = tooltip.querySelector(".pt-copy");
        btn.textContent = "Copied!";
        setTimeout(function () { btn.textContent = "Copy"; }, 1500);
      });
    });

    document.body.appendChild(tooltip);
    positionTooltip();
  }

  function positionTooltip() {
    if (!tooltip) return;
    var rect = getSelectionRect();
    if (!rect) return;

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
  }

  function createLoadingTooltip() {
    removeTooltip();
    tooltip = document.createElement("div");
    tooltip.className = "persian-translator-tooltip";
    tooltip.innerHTML = '<div class="pt-loading">Translating...</div>';
    document.body.appendChild(tooltip);

    var rect = getSelectionRect();
    if (rect) {
      tooltip.style.left = (rect.left + window.scrollX) + "px";
      tooltip.style.top = (rect.bottom + window.scrollY + 8) + "px";
    }
  }

  function createErrorTooltip(message) {
    removeTooltip();
    tooltip = document.createElement("div");
    tooltip.className = "persian-translator-tooltip";
    tooltip.innerHTML =
      '<div class="pt-header">' +
        '<span class="pt-lang-badge">Error</span>' +
        '<button class="pt-close" title="Close">&times;</button>' +
      '</div>' +
      '<div class="pt-error">' + escapeHtml(message) + '</div>';
    tooltip.querySelector(".pt-close").addEventListener("click", removeTooltip);
    document.body.appendChild(tooltip);

    var rect = getSelectionRect();
    if (rect) {
      tooltip.style.left = (rect.left + window.scrollX) + "px";
      tooltip.style.top = (rect.bottom + window.scrollY + 8) + "px";
    }
  }

  function handleTranslate() {
    var text = getSelectedText();
    if (!text) return;

    removeButton();
    createLoadingTooltip();

    chrome.runtime.sendMessage({ action: "translate", text: text }, function (response) {
      if (chrome.runtime.lastError) {
        createErrorTooltip("Extension context lost. Please refresh the page.");
        return;
      }
      if (!response) {
        createErrorTooltip("No response from background script");
        return;
      }
      if (!response.success) {
        createErrorTooltip(response.error || "Translation failed");
        return;
      }
      createTooltip(text, response.translated, response.detectedLang, response.targetLang);
    });
  }

  document.addEventListener("mouseup", function () {
    if (tooltip) return;

    setTimeout(function () {
      var text = getSelectedText();
      if (text && text.length > 0 && text.length < 5000) {
        var rect = getSelectionRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          if (!translateBtn) {
            translateBtn = document.createElement("button");
            translateBtn.className = "persian-translator-btn";
            translateBtn.innerHTML = TRANSLATE_ICON_SVG;
            translateBtn.title = "Translate selection";
            translateBtn.addEventListener("mousedown", function (e) {
              e.preventDefault();
              e.stopPropagation();
              handleTranslate();
            });
            document.body.appendChild(translateBtn);
          }
          translateBtn.style.left = (rect.left + window.scrollX + rect.width / 2 - 16) + "px";
          translateBtn.style.top = (rect.top + window.scrollY - 40) + "px";
          translateBtn.classList.add("visible");
          return;
        }
      }
      if (translateBtn) {
        translateBtn.classList.remove("visible");
      }
    }, 10);
  });

  document.addEventListener("mousedown", function (e) {
    if (tooltip && !tooltip.contains(e.target)) {
      removeTooltip();
    }
    if (translateBtn && !translateBtn.contains(e.target) && !tooltip) {
      translateBtn.classList.remove("visible");
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      removeTooltip();
      if (translateBtn) translateBtn.classList.remove("visible");
    }
  });
})();
