(function () {
  const STORAGE_PREFIX = "rememberOperation";

  function getStorageArea() {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
    return null;
  }

  function localFallbackGet(key) {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  }

  function localFallbackSet(key, value) {
    window.localStorage.setItem(key, JSON.stringify(value));
  }

  function chromeGet(key) {
    const area = getStorageArea();
    if (!area) {
      return Promise.resolve(localFallbackGet(key));
    }

    return new Promise((resolve) => {
      area.get(key, (result) => {
        resolve(result ? result[key] : undefined);
      });
    });
  }

  function chromeSet(key, value) {
    const area = getStorageArea();
    if (!area) {
      localFallbackSet(key, value);
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      area.set({ [key]: value }, resolve);
    });
  }

  function chromeRemove(key) {
    const area = getStorageArea();
    if (!area) {
      window.localStorage.removeItem(key);
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      area.remove(key, resolve);
    });
  }

  async function getAllData() {
    return (await chromeGet(STORAGE_PREFIX)) || {
      recordings: {},
      settings: {
        savePasswords: false,
        autoShowPanel: true
      }
    };
  }

  async function setAllData(data) {
    await chromeSet(STORAGE_PREFIX, data);
  }

  async function resetAllData() {
    await chromeRemove(STORAGE_PREFIX);
  }

  window.RememberOperationStorage = {
    getAllData,
    setAllData,
    resetAllData,
    STORAGE_PREFIX
  };
})();
