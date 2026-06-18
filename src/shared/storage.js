(function () {
  const STORAGE_PREFIX = "rememberOperation";

  function getStorageArea() {
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        return chrome.storage.local;
      }
    } catch (error) {
      throw createStorageError("access", error);
    }
    return null;
  }

  function getChromeLastError() {
    try {
      if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.lastError) {
        return null;
      }
      return chrome.runtime.lastError;
    } catch (error) {
      throw createStorageError("lastError", error);
    }
  }

  function createStorageError(action, error) {
    const rawMessage = error && error.message ? error.message : String(error || "Unknown error");
    const storageError = new Error(`Storage ${action} failed: ${rawMessage}`);
    storageError.code = /Extension context invalidated/i.test(rawMessage)
      ? "RO_EXTENSION_CONTEXT_INVALIDATED"
      : "RO_STORAGE_ERROR";
    storageError.cause = error;
    return storageError;
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

    return new Promise((resolve, reject) => {
      try {
        area.get(key, (result) => {
          try {
            const lastError = getChromeLastError();
            if (lastError) {
              reject(createStorageError("get", lastError));
              return;
            }
            resolve(result ? result[key] : undefined);
          } catch (error) {
            reject(createStorageError("get", error));
          }
        });
      } catch (error) {
        reject(createStorageError("get", error));
      }
    });
  }

  function chromeSet(key, value) {
    const area = getStorageArea();
    if (!area) {
      localFallbackSet(key, value);
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      try {
        area.set({ [key]: value }, () => {
          try {
            const lastError = getChromeLastError();
            if (lastError) {
              reject(createStorageError("set", lastError));
              return;
            }
            resolve();
          } catch (error) {
            reject(createStorageError("set", error));
          }
        });
      } catch (error) {
        reject(createStorageError("set", error));
      }
    });
  }

  function chromeRemove(key) {
    const area = getStorageArea();
    if (!area) {
      window.localStorage.removeItem(key);
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      try {
        area.remove(key, () => {
          try {
            const lastError = getChromeLastError();
            if (lastError) {
              reject(createStorageError("remove", lastError));
              return;
            }
            resolve();
          } catch (error) {
            reject(createStorageError("remove", error));
          }
        });
      } catch (error) {
        reject(createStorageError("remove", error));
      }
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
