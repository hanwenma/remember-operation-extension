async function ensureContentScripts(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["src/content/content.css"]
  }).catch(() => {});

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/shared/storage.js"]
  }).catch(() => {});

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/content/content.js"]
  }).catch(() => {});
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id || !tab.url || !/^(https?:|file:)/.test(tab.url)) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "RO_TOGGLE_PANEL" });
  } catch (error) {
    await ensureContentScripts(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: "RO_TOGGLE_PANEL" }).catch(() => {});
  }
});
