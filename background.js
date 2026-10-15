chrome.runtime.onInstalled.addListener(() => {
  // After install/update/reload, old tabs still run the previous content.js
  // whose chrome.runtime port is dead ("Extension context invalidated").
  // Re-inject the fresh script so the new copy marks itself active and the
  // orphaned copy goes silent.
  reInjectAllTabs();
});

chrome.runtime.onStartup.addListener(() => {
  reInjectAllTabs();
});

async function reInjectAllTabs() {
  try {
    if (!chrome.tabs || !chrome.scripting) return;
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      try {
        if (!tab || tab.id == null) continue;
        const url = tab.url || "";
        if (!/^https?:\/\//i.test(url)) continue;
        if (/^https?:\/\/chrome\.google\.com\/webstore/i.test(url)) continue;
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ["content.js"]
        });
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id, allFrames: true },
          files: ["content.css"]
        });
      } catch (e) {
        // Tab may not allow scripting (chrome://, edge://, pdf viewer...).
      }
    }
  } catch (e) {
    // Never break the service worker over best-effort re-injection.
  }
}

function detectTargetLang(text) {
  const persianRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
  return persianRegex.test(text) ? "en" : "fa";
}

// Keep individual requests small: percent-encoded Persian text grows ~9x, so
// long selections are split on word/sentence boundaries before translating.
const MAX_CHUNK_LENGTH = 1500;

function splitIntoChunks(text, maxLen) {
  const chunks = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf(" ", maxLen);
    const newlineCut = rest.lastIndexOf("\n", maxLen);
    if (newlineCut > cut) cut = newlineCut;
    if (cut < Math.floor(maxLen / 2)) cut = maxLen;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, "");
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

async function requestChunk(text, targetLang) {
  const params = new URLSearchParams();
  params.set("client", "gtx");
  params.set("sl", "auto");
  params.set("tl", targetLang);
  params.set("dt", "t");
  params.set("q", text);

  const endpoint = "https://translate.googleapis.com/translate_a/single";

  // POST keeps very long text out of the URL; fall back to GET if refused.
  let response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: params.toString()
  });
  if (response.status === 400 || response.status === 404 || response.status === 405) {
    response = await fetch(endpoint + "?" + params.toString());
  }
  if (!response.ok) {
    throw new Error("API returned status " + response.status);
  }

  const data = await response.json();
  if (!data || !data[0] || !Array.isArray(data[0])) {
    throw new Error("Unexpected API response format");
  }

  const translated = data[0]
    .filter(part => part && part[0])
    .map(part => part[0])
    .join("");

  return { translated: translated, detectedLang: data[2] || null };
}

async function translateText(text, targetLang) {
  const chunks = splitIntoChunks(text, MAX_CHUNK_LENGTH);
  let translated = "";
  let detectedLang = null;

  for (let i = 0; i < chunks.length; i++) {
    const result = await requestChunk(chunks[i], targetLang);
    translated += result.translated;
    if (!detectedLang) detectedLang = result.detectedLang;
  }

  if (!detectedLang) {
    detectedLang = detectTargetLang(text) === "en" ? "fa" : "en";
  }

  return { translated: translated, detectedLang: detectedLang, targetLang: targetLang };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "translate") {
    const targetLang = detectTargetLang(request.text);
    translateText(request.text, targetLang)
      .then(result => {
        sendResponse({ success: true, translated: result.translated, detectedLang: result.detectedLang, targetLang: result.targetLang });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});
