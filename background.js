function detectTargetLang(text) {
  const persianRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
  return persianRegex.test(text) ? "en" : "fa";
}

async function translateText(text, targetLang) {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", targetLang);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error("API returned status " + response.status);
  }

  const data = await response.json();

  if (!data || !data[0] || !Array.isArray(data[0])) {
    throw new Error("Unexpected API response format");
  }

  const translatedParts = data[0]
    .filter(part => part && part[0])
    .map(part => part[0])
    .join("");

  const detectedLang = data[2] || (detectTargetLang(text) === "en" ? "fa" : "en");

  return { translated: translatedParts, detectedLang: detectedLang, targetLang: targetLang };
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
