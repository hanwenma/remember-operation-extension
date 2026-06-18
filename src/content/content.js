(function () {
  const STORAGE = window.RememberOperationStorage;
  const ROOT_ID = "remember-operation-root";
  const REPLAY_MASK_ID = "remember-operation-replay-mask";
  const PATH_CONFIRM_ID = "remember-operation-path-confirm";
  const PENDING_REPLAY_KEY = "rememberOperationPendingReplay";
  const MASKED_VALUE = "__remember_operation_masked__";
  const REPLAY_STEP_DELAY_MS = 800;
  const RESUME_REPLAY_DELAY_MS = 1500;
  const UNSAFE_REPLAY_CLICK_PATTERN = /rtl|ltr|direction|flip|mirror|reverse|layout|locale|language|i18n|translate|翻转|镜像|方向|布局|语言|翻译/i;
  const OPTION_SELECTORS = [
    "option",
    ".el-select-dropdown__item",
    ".el-cascader-node",
    ".ant-select-item-option",
    ".ant-cascader-menu-item",
    ".n-base-select-option",
    ".n-cascader-option",
    ".t-select-option",
    ".t-cascader__item",
    ".arco-select-option",
    ".arco-select-option-content",
    ".arco-cascader-option",
    ".arco-tree-node",
    ".arco-tree-node-title",
    "[role='option']",
    "[role='treeitem']"
  ];
  const CUSTOM_WIDGET_SELECTOR = [
    ".el-select",
    ".el-cascader",
    ".ant-select",
    ".ant-cascader-picker",
    ".n-select",
    ".n-cascader",
    ".t-select",
    ".t-cascader",
    ".arco-select",
    ".arco-cascader",
    ".arco-tree-select"
  ].join(",");
  const FLOATING_ROOT_SELECTOR = [
    ".el-select-dropdown",
    ".ant-select-dropdown",
    ".n-select-menu",
    ".t-popup",
    ".arco-trigger-popup",
    ".arco-select-dropdown",
    ".arco-dropdown",
    ".arco-cascader-popup",
    ".arco-tree-select-popup"
  ].join(",");
  const FORM_ITEM_SELECTOR = [
    ".el-form-item",
    ".ant-form-item",
    ".n-form-item",
    ".t-form__item",
    ".ivu-form-item",
    ".arco-form-item",
    ".form-item",
    ".form-group"
  ].join(",");
  const LABEL_SELECTOR = [
    ".el-form-item__label",
    ".ant-form-item-label label",
    ".n-form-item-label",
    ".t-form__label",
    ".ivu-form-item-label",
    ".arco-form-item-label",
    ".arco-form-item-label-col label",
    "label"
  ].join(",");
  const CLICKABLE_SELECTOR = [
    "button",
    "[role='button']",
    ".el-button",
    ".ant-btn",
    ".n-button",
    ".t-button",
    ".arco-btn",
    "a"
  ].join(",");
  let panelRoot = null;
  let panelOpen = false;
  let isRecording = false;
  let isReplaying = false;
  let stopReplayRequested = false;
  let recordBuffer = [];
  let recordStartedAt = 0;
  let currentDetail = null;
  let pendingPathReplay = null;
  let lastRouteKey = "";
  let recordingFilters = {
    scope: "all",
    keyword: ""
  };

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) {
      return false;
    }

    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      rect.width > 0 &&
      rect.height > 0;
  }

  function captureHorizontalScrollState() {
    const nodes = [document.documentElement, document.body];
    document.querySelectorAll("*").forEach((node) => {
      if (node instanceof Element && node.scrollWidth > node.clientWidth) {
        nodes.push(node);
      }
    });

    return nodes
      .filter(Boolean)
      .map((node) => ({
        node,
        scrollLeft: node.scrollLeft
      }));
  }

  function restoreHorizontalScrollState(state) {
    state.forEach(({ node, scrollLeft }) => {
      if (node && node.scrollLeft !== scrollLeft) {
        node.scrollLeft = scrollLeft;
      }
    });
  }

  function restoreHorizontalScrollStateSoon(state) {
    restoreHorizontalScrollState(state);
    window.requestAnimationFrame(() => restoreHorizontalScrollState(state));
    window.setTimeout(() => restoreHorizontalScrollState(state), 80);
  }

  function scrollElementIntoReplayView(element) {
    const horizontalScrollState = captureHorizontalScrollState();
    element.scrollIntoView({ block: "center", inline: "nearest" });
    restoreHorizontalScrollState(horizontalScrollState);
  }

  function cssEscape(value) {
    if (window.CSS && window.CSS.escape) {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function getScope() {
    const dialog = findActiveDialog();
    const dialogTitle = dialog ? getDialogTitle(dialog) : "";
    return {
      host: location.host,
      path: location.pathname,
      pagePath: location.pathname,
      title: normalizeText(document.title),
      dialogTitle,
      key: [
        location.host,
        location.pathname,
        dialogTitle || "page"
      ].join("::")
    };
  }

  function getRecordingPath(recording) {
    return recording && recording.scope
      ? (recording.scope.pagePath || recording.scope.path || "")
      : "";
  }

  function validateReplayPath(recording) {
    const recordedPath = getRecordingPath(recording);
    const currentPath = location.pathname;
    if (!recordedPath || recordedPath === currentPath) {
      return {
        ok: true,
        recordedPath,
        currentPath
      };
    }

    return {
      ok: false,
      recordedPath,
      currentPath,
      message: `回放失败：当前页面 path 不匹配。录制 path：${recordedPath}，当前 path：${currentPath}`
    };
  }

  function setPendingReplay(id) {
    window.sessionStorage.setItem(PENDING_REPLAY_KEY, JSON.stringify({
      id,
      createdAt: Date.now()
    }));
  }

  function consumePendingReplay() {
    const raw = window.sessionStorage.getItem(PENDING_REPLAY_KEY);
    if (!raw) {
      return null;
    }

    window.sessionStorage.removeItem(PENDING_REPLAY_KEY);
    try {
      const pending = JSON.parse(raw);
      if (!pending || !pending.id || Date.now() - pending.createdAt > 60000) {
        return null;
      }
      return pending;
    } catch (error) {
      return null;
    }
  }

  function buildPathUrl(path) {
    return `${location.origin}${path}`;
  }

  function hidePathConfirm() {
    const confirm = document.getElementById(PATH_CONFIRM_ID);
    if (confirm) {
      confirm.remove();
    }
    pendingPathReplay = null;
  }

  function showPathMismatchConfirm(recording, pathCheck) {
    hidePathConfirm();
    pendingPathReplay = {
      id: recording.id,
      path: pathCheck.recordedPath
    };

    updatePanelStatus(pathCheck.message, "error");

    const confirm = document.createElement("div");
    confirm.id = PATH_CONFIRM_ID;
    confirm.className = "ro-path-confirm";
    confirm.innerHTML = `
      <div class="ro-path-confirm-card">
        <div class="ro-path-confirm-title">当前页面 path 不匹配</div>
        <div class="ro-path-confirm-message">
          <div>录制 path：${escapeHtml(pathCheck.recordedPath)}</div>
          <div>当前 path：${escapeHtml(pathCheck.currentPath)}</div>
        </div>
        <div class="ro-path-confirm-actions">
          <button class="ro-button primary" data-ro-action="jump-and-replay" type="button">跳转并回放</button>
          <button class="ro-button" data-ro-action="cancel-path-replay" type="button">取消</button>
        </div>
      </div>
    `;
    document.documentElement.appendChild(confirm);
    confirm.querySelector("[data-ro-action='jump-and-replay']").addEventListener("click", jumpAndReplayPending);
    confirm.querySelector("[data-ro-action='cancel-path-replay']").addEventListener("click", () => {
      hidePathConfirm();
      updatePanelStatus("已取消跳转回放。");
    });
  }

  function jumpAndReplayPending() {
    if (!pendingPathReplay || !pendingPathReplay.id || !pendingPathReplay.path) {
      hidePathConfirm();
      updatePanelStatus("没有可跳转回放的任务。", "error");
      return;
    }

    const { id, path } = pendingPathReplay;
    setPendingReplay(id);
    hidePathConfirm();
    updatePanelStatus(`正在跳转到：${path}`);
    location.assign(buildPathUrl(path));
  }

  function getRouteKey() {
    return `${location.host}${location.pathname}${location.search}${location.hash}`;
  }

  function scheduleRouteRefresh() {
    window.clearTimeout(scheduleRouteRefresh.timer);
    scheduleRouteRefresh.timer = window.setTimeout(async () => {
      const routeKey = getRouteKey();
      if (routeKey === lastRouteKey) {
        return;
      }

      lastRouteKey = routeKey;
      currentDetail = null;
      renderDetail();
      await updatePanelMeta();
      await renderRecordings();
      await resumePendingReplay();
    }, 120);
  }

  function initRouteObserver() {
    lastRouteKey = getRouteKey();

    ["pushState", "replaceState"].forEach((method) => {
      const original = history[method];
      if (original.__rememberOperationPatched) {
        return;
      }

      const patched = function (...args) {
        const result = original.apply(this, args);
        scheduleRouteRefresh();
        return result;
      };
      patched.__rememberOperationPatched = true;
      history[method] = patched;
    });

    window.addEventListener("popstate", scheduleRouteRefresh);
    window.addEventListener("hashchange", scheduleRouteRefresh);
  }

  async function resumePendingReplay() {
    const pending = consumePendingReplay();
    if (!pending) {
      return;
    }

    togglePanel(true);
    updatePanelStatus("已跳转，准备回放...");
    await sleep(RESUME_REPLAY_DELAY_MS);
    await replayRecording(pending.id);
  }

  function getActiveRoot() {
    return findActiveDialog() || document;
  }

  function findActiveDialog() {
    const dialogSelectors = [
      ".el-dialog",
      ".ant-modal",
      ".n-modal",
      ".t-dialog",
      ".arco-modal",
      "[role='dialog']",
      ".modal",
      ".dialog"
    ];

    const dialogs = dialogSelectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter(isVisible);

    return dialogs[dialogs.length - 1] || null;
  }

  function getDialogTitle(dialog) {
    if (!dialog) {
      return "";
    }

    const title = dialog.querySelector(
      ".el-dialog__title, .ant-modal-title, .n-card-header, .t-dialog__header, .arco-modal-title, [data-dialog-title], .modal-title"
    );
    return normalizeText(title ? title.textContent : "");
  }

  function findActiveDialogTitle() {
    return getDialogTitle(findActiveDialog());
  }

  function findLabelForControl(control) {
    if (!control) {
      return "";
    }

    const id = control.getAttribute("id");
    if (id) {
      const label = document.querySelector(`label[for="${cssEscape(id)}"]`);
      if (label) {
        return normalizeText(label.textContent);
      }
    }

    const wrappingLabel = control.closest("label");
    if (wrappingLabel) {
      const cloned = wrappingLabel.cloneNode(true);
      cloned.querySelectorAll("input, textarea, select, button").forEach((node) => node.remove());
      const text = normalizeText(cloned.textContent);
      if (text) {
        return text;
      }
    }

    const formItem = getFormItem(control);

    if (formItem) {
      const labelNode = formItem.querySelector(LABEL_SELECTOR);
      const label = cleanLabelText(labelNode);
      if (label) {
        return label;
      }
    }

    const aria = control.getAttribute("aria-label");
    if (aria) {
      return normalizeText(aria);
    }

    return "";
  }

  function getFormItem(node) {
    return node && node.closest ? node.closest(FORM_ITEM_SELECTOR) : null;
  }

  function cleanLabelText(labelNode) {
    if (!labelNode) {
      return "";
    }

    const cloned = labelNode.cloneNode(true);
    cloned.querySelectorAll("svg, .arco-form-item-label-required-symbol, .el-form-item__asterisk, input, textarea, select, button").forEach((node) => node.remove());
    return normalizeText(cloned.textContent).replace(/^[*：:\s]+|[*：:\s]+$/g, "");
  }

  function getFieldKey(control) {
    const label = findLabelForControl(control);
    const aria = control.getAttribute("aria-label");
    const placeholder = control.getAttribute("placeholder");
    const name = control.getAttribute("name");
    const id = control.getAttribute("id");
    const text = normalizeText(control.textContent);

    return normalizeText(label || aria || placeholder || name || id || text || getStableSelector(control));
  }

  function getFieldAliases(control) {
    return [
      findLabelForControl(control),
      control.getAttribute("aria-label"),
      control.getAttribute("placeholder"),
      control.getAttribute("name"),
      control.getAttribute("id")
    ].map(normalizeText).filter(Boolean);
  }

  function getStableSelector(el) {
    if (!el || !(el instanceof Element)) {
      return "";
    }

    if (el.id) {
      return `#${cssEscape(el.id)}`;
    }

    const parts = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body && parts.length < 5) {
      const tag = current.tagName.toLowerCase();
      const dataKey = current.getAttribute("data-testid") || current.getAttribute("data-test") || current.getAttribute("name");
      if (dataKey) {
        parts.unshift(`${tag}[${current.hasAttribute("name") ? "name" : current.hasAttribute("data-testid") ? "data-testid" : "data-test"}="${cssEscape(dataKey)}"]`);
        break;
      }

      const parent = current.parentElement;
      if (!parent) {
        break;
      }

      const siblings = Array.from(parent.children).filter((node) => node.tagName === current.tagName);
      const index = siblings.indexOf(current) + 1;
      parts.unshift(`${tag}:nth-of-type(${index})`);
      current = parent;
    }

    return parts.join(" > ");
  }

  function getUniqueSelector(el) {
    const formItem = getFormItem(el);
    if (formItem) {
      const label = findLabelForControl(el);
      if (label) {
        return `[data-ro-field-label="${label}"]`;
      }
    }
    return getStableSelector(el);
  }

  function detectControlType(control) {
    const tag = control.tagName.toLowerCase();
    const type = (control.getAttribute("type") || "").toLowerCase();
    const closest = (selector) => Boolean(control.closest(selector));

    if (tag === "select") {
      return "native-select";
    }
    if (tag === "textarea") {
      return "textarea";
    }
    if (type === "checkbox") {
      return "checkbox";
    }
    if (type === "radio") {
      return "radio";
    }
    if (closest(CUSTOM_WIDGET_SELECTOR)) {
      return "custom-select";
    }
    if (type === "password") {
      return "password";
    }
    if (type === "date" || type === "datetime-local" || closest(".el-date-editor, .ant-picker, .n-date-picker, .t-date-picker")) {
      return "date";
    }
    if (control.isContentEditable) {
      return "contenteditable";
    }
    return "text";
  }

  function collectControls() {
    const root = getActiveRoot();
    const selectors = [
      "input:not([type='hidden']):not([disabled])",
      "textarea:not([disabled])",
      "select:not([disabled])",
      "[contenteditable='true']",
      ".el-select:not(.is-disabled)",
      ".el-cascader:not(.is-disabled)",
      ".ant-select:not(.ant-select-disabled)",
      ".ant-cascader-picker:not(.ant-cascader-picker-disabled)",
      ".n-select:not(.n-select--disabled)",
      ".n-cascader:not(.n-cascader--disabled)",
      ".t-select:not(.t-is-disabled)",
      ".t-cascader:not(.t-is-disabled)",
      ".arco-select:not(.arco-select-disabled)",
      ".arco-cascader:not(.arco-cascader-disabled)",
      ".arco-tree-select:not(.arco-tree-select-disabled)"
    ];

    const seen = new Set();
    const controls = Array.from(root.querySelectorAll(selectors.join(",")))
      .filter((control) => {
        const customRoot = control.closest(CUSTOM_WIDGET_SELECTOR);
        if (customRoot && customRoot !== control) {
          return false;
        }

        const identity = getControlIdentity(control);
        if (seen.has(identity) || !isVisible(control)) {
          return false;
        }
        seen.add(identity);
        return true;
      })
      .map((control) => ({
        element: control,
        type: detectControlType(control),
        key: getFieldKey(control),
        aliases: getFieldAliases(control),
        selector: getUniqueSelector(control),
        fallbackSelector: getStableSelector(control),
        identity: getControlIdentity(control),
        label: findLabelForControl(control)
      }))
      .filter((item) => item.key);

    return controls;
  }

  function getControlIdentity(control) {
    const formItem = getFormItem(control);
    const label = findLabelForControl(control);
    if (formItem && label) {
      const formItems = Array.from(getActiveRoot().querySelectorAll(FORM_ITEM_SELECTOR));
      return `field:${label}:${formItems.indexOf(formItem)}`;
    }
    return getStableSelector(control);
  }

  function readControlValue(item, settings) {
    const el = item.element;
    if (item.type === "password" && !settings.savePasswords) {
      return {
        ignored: true,
        value: MASKED_VALUE
      };
    }

    if (item.type === "checkbox") {
      return { value: Boolean(el.checked) };
    }

    if (item.type === "radio") {
      if (!el.checked) {
        return { ignored: true };
      }
      return { value: el.value || normalizeText(el.closest("label")?.textContent) };
    }

    if (item.type === "native-select") {
      const option = el.options[el.selectedIndex];
      return {
        value: el.value,
        displayValue: option ? normalizeText(option.textContent) : el.value
      };
    }

    if (item.type === "custom-select") {
      const selectValue = readCustomSelectText(el);
      return {
        value: selectValue,
        displayValue: selectValue
      };
    }

    if (item.type === "contenteditable") {
      return { value: normalizeText(el.textContent) };
    }

    return { value: el.value };
  }

  function readCustomSelectText(el) {
    const tagNodes = Array.from(el.querySelectorAll([
      ".arco-select-view-tag",
      ".ant-select-selection-item",
      ".n-base-selection-tag",
      ".el-select__tags-text"
    ].join(","))).filter(isVisible);

    if (tagNodes.length > 1 || el.matches(".arco-select-view-multiple, .ant-select-multiple, .el-select--multiple")) {
      return tagNodes.map((node) => normalizeText(node.textContent)).filter(Boolean);
    }

    const textNode = el.querySelector([
      ".el-select__selected-item",
      ".el-input__inner",
      ".ant-select-selection-item",
      ".ant-select-selection-placeholder",
      ".n-base-selection-label",
      ".n-base-selection-tags",
      ".t-select__single",
      ".t-select-input",
      ".arco-select-view-value:not(.arco-select-view-value-hidden)",
      ".arco-select-view-tag",
      "input"
    ].join(","));

    if (!textNode) {
      return normalizeText(el.textContent);
    }

    if ("value" in textNode && textNode.value) {
      return normalizeText(textNode.value);
    }
    return normalizeText(textNode.textContent);
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");

    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function setContentEditable(el, value) {
    el.focus();
    el.textContent = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  }

  function setCheckbox(el, value) {
    const desired = Boolean(value);
    if (el.checked !== desired) {
      el.click();
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setRadio(el, value) {
    const groupName = el.getAttribute("name");
    const candidates = groupName
      ? Array.from(document.querySelectorAll(`input[type='radio'][name="${cssEscape(groupName)}"]`))
      : [el];

    const matched = candidates.find((candidate) => {
      const label = normalizeText(candidate.closest("label")?.textContent);
      return candidate.value === value || label === value;
    });

    if (matched && !matched.checked) {
      matched.click();
    }
  }

  function setNativeSelect(el, stored) {
    const target = typeof stored === "object" ? (stored.value || stored.displayValue) : stored;
    const match = Array.from(el.options).find((option) => {
      return option.value === target || normalizeText(option.textContent) === target;
    });

    if (match) {
      el.value = match.value;
    } else {
      el.value = target;
    }

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  async function waitFor(predicate, timeout = 3000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const result = predicate();
      if (result) {
        return result;
      }
      await sleep(80);
    }
    return null;
  }

  async function setCustomSelect(el, value) {
    const raw = typeof value === "object" ? (value.displayValue || value.value) : value;
    const values = Array.isArray(raw) ? raw : [raw];
    const targets = values.map(normalizeText).filter(Boolean);
    if (!targets.length) {
      return false;
    }

    let selected = 0;
    for (const text of targets) {
      const trigger = findVisibleChild(el, ".el-select__wrapper, .ant-select-selector, .n-base-selection, .t-select__wrap, .arco-select-view, input") || el;
      safeClick(trigger);

      const option = await waitFor(() => findOptionByText(text), 3500);
      if (!option) {
        continue;
      }

      scrollElementIntoReplayView(option);
      safeClick(option);
      selected += 1;
      await sleep(120);
    }
    return selected > 0;
  }

  function findVisibleChild(root, selector) {
    return Array.from(root.querySelectorAll(selector)).find(isVisible);
  }

  function findOptionByText(text) {
    const normalized = normalizeText(text);
    const options = OPTION_SELECTORS
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .map((option) => getOptionClickable(option))
      .filter(Boolean)
      .filter(isVisible);

    return options.find((option) => normalizeText(option.textContent) === normalized) ||
      options.find((option) => normalizeText(option.textContent).includes(normalized));
  }

  function getOptionClickable(option) {
    if (!option || !(option instanceof Element)) {
      return null;
    }

    return option.closest(".arco-select-option, .ant-select-item-option, .el-select-dropdown__item, .n-base-select-option, .t-select-option, [role='option'], [role='treeitem']") || option;
  }

  async function fillControl(item, stored) {
    const value = stored && typeof stored === "object" && "value" in stored ? stored.value : stored;
    if (value === undefined || value === null || value === MASKED_VALUE) {
      return false;
    }

    const el = item.element;
    item.element.classList.add("ro-highlight");
    window.setTimeout(() => item.element.classList.remove("ro-highlight"), 1000);

    if (item.type === "checkbox") {
      setCheckbox(el, value);
      return true;
    }
    if (item.type === "radio") {
      setRadio(el, value);
      return true;
    }
    if (item.type === "native-select") {
      setNativeSelect(el, stored);
      return true;
    }
    if (item.type === "custom-select") {
      return await setCustomSelect(el, stored);
    }
    if (item.type === "contenteditable") {
      setContentEditable(el, value);
      return true;
    }

    setNativeValue(el, value);
    return true;
  }

  function getActionTarget(target) {
    if (!target || !(target instanceof Element)) {
      return null;
    }

    const optionLike = target.closest("[role='option'], [role='treeitem'], .arco-select-option, .arco-select-option-content");
    if (optionLike) {
      return optionLike;
    }

    const buttonLike = target.closest(CLICKABLE_SELECTOR);
    if (buttonLike) {
      return buttonLike;
    }
    return target;
  }

  function getClickableElement(target) {
    if (!target || !(target instanceof Element)) {
      return null;
    }

    if (target.matches(CLICKABLE_SELECTOR) || target.matches("[role='option'], [role='treeitem'], .arco-select-option, .arco-select-option-content")) {
      return target;
    }

    return target.closest(`${CLICKABLE_SELECTOR}, [role='option'], [role='treeitem'], .arco-select-option, .arco-select-option-content`);
  }

  function getReplayClickTarget(target) {
    return getClickableElement(target) || target;
  }

  function getElementDebugText(el) {
    if (!el || !(el instanceof Element)) {
      return "unknown";
    }

    const parts = [el.tagName.toLowerCase()];
    const id = el.getAttribute("id");
    const role = el.getAttribute("role");
    const title = el.getAttribute("title");
    const aria = el.getAttribute("aria-label");
    const classes = Array.from(el.classList || []).slice(0, 4);
    if (id) {
      parts.push(`#${id}`);
    }
    if (classes.length) {
      parts.push(`.${classes.join(".")}`);
    }
    if (role) {
      parts.push(`[role=${role}]`);
    }
    if (title) {
      parts.push(`[title=${title}]`);
    }
    if (aria) {
      parts.push(`[aria-label=${aria}]`);
    }
    return parts.join("");
  }

  function getElementSafetyText(el) {
    const values = [];
    let current = el;
    let depth = 0;
    while (current && current instanceof Element && current !== document.body && depth < 3) {
      ["id", "class", "title", "aria-label", "aria-describedby", "data-testid", "data-test", "data-action", "data-name"].forEach((name) => {
        const value = current.getAttribute(name);
        if (value) {
          values.push(value);
        }
      });
      values.push(normalizeText(current.textContent).slice(0, 80));
      current = current.parentElement;
      depth += 1;
    }
    return values.join(" ");
  }

  function isUnsafeReplayClickTarget(target) {
    const clickable = getReplayClickTarget(target);
    if (!clickable || !(clickable instanceof Element)) {
      return false;
    }

    return UNSAFE_REPLAY_CLICK_PATTERN.test(getElementSafetyText(clickable));
  }

  function highlightReplayClickTarget(target) {
    if (!target || !(target instanceof Element)) {
      return;
    }

    target.classList.add("ro-replay-target-highlight");
    window.setTimeout(() => {
      target.classList.remove("ro-replay-target-highlight");
    }, 900);
  }

  function safeClick(target) {
    const clickable = getReplayClickTarget(target);
    if (!clickable || !(clickable instanceof Element)) {
      return false;
    }

    scrollElementIntoReplayView(clickable);

    ["pointerdown", "mousedown", "pointerup", "mouseup"].forEach((type) => {
      clickable.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window
      }));
    });

    if (typeof clickable.click === "function") {
      clickable.click();
    } else {
      clickable.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
      }));
    }
    return true;
  }

  function getVisibleFloatingRoots() {
    return Array.from(document.querySelectorAll(FLOATING_ROOT_SELECTOR)).filter(isVisible);
  }

  function getRecordScope(target) {
    const floatingRoot = target.closest(FLOATING_ROOT_SELECTOR);
    if (floatingRoot && isVisible(floatingRoot)) {
      return {
        kind: "floating",
        root: floatingRoot,
        rootIndex: getVisibleFloatingRoots().indexOf(floatingRoot)
      };
    }

    const activeRoot = getActiveRoot();
    if (activeRoot !== document && activeRoot.contains(target)) {
      return {
        kind: "active-root",
        root: activeRoot,
        rootIndex: 0
      };
    }

    return {
      kind: "document",
      root: document.body,
      rootIndex: 0
    };
  }

  function getElementAttrs(el) {
    const attrs = {};
    if (!el || !(el instanceof Element)) {
      return attrs;
    }

    [
      "id",
      "name",
      "type",
      "role",
      "data-testid",
      "data-test",
      "data-value",
      "value",
      "aria-controls",
      "aria-labelledby",
      "aria-haspopup",
      "aria-expanded"
    ].forEach((name) => {
      const value = el.getAttribute(name);
      if (value) {
        attrs[name] = value;
      }
    });

    Array.from(el.attributes).forEach((attr) => {
      if (attr.name.startsWith("data-") && attr.value) {
        attrs[attr.name] = attr.value;
      }
    });

    return attrs;
  }

  function getRelativeSelector(el, root) {
    if (!el || !(el instanceof Element) || !root || !root.contains(el)) {
      return "";
    }

    const parts = [];
    let current = el;
    while (current && current !== root && current.nodeType === Node.ELEMENT_NODE) {
      const parent = current.parentElement;
      if (!parent) {
        break;
      }

      const tag = current.tagName.toLowerCase();
      const siblings = Array.from(parent.children).filter((node) => node.tagName === current.tagName);
      const index = siblings.indexOf(current) + 1;
      parts.unshift(`${tag}:nth-of-type(${index})`);
      current = parent;
    }

    return parts.join(" > ");
  }

  function getElementPathEntry(el) {
    const parent = el.parentElement;
    const siblings = parent
      ? Array.from(parent.children).filter((node) => node.tagName === el.tagName)
      : [];

    return {
      tag: el.tagName.toLowerCase(),
      indexOfType: siblings.indexOf(el),
      childIndex: parent ? Array.from(parent.children).indexOf(el) : -1,
      attrs: getElementAttrs(el)
    };
  }

  function buildElementPath(el, root) {
    if (!el || !(el instanceof Element) || !root || !root.contains(el)) {
      return [];
    }

    const path = [];
    let current = el;
    while (current && current !== root && current.nodeType === Node.ELEMENT_NODE) {
      path.unshift(getElementPathEntry(current));
      current = current.parentElement;
    }

    return path;
  }

  function buildComposedElementPath(event, root) {
    if (!event || typeof event.composedPath !== "function" || !root) {
      return [];
    }

    const fullPath = event.composedPath();
    const elements = [];
    for (const node of fullPath) {
      if (!(node instanceof Element)) {
        continue;
      }
      if (node === root) {
        break;
      }
      if (root.contains(node)) {
        elements.unshift(getElementPathEntry(node));
      }
    }

    return elements;
  }

  function hasUsefulAttrs(attrs) {
    return Object.keys(attrs || {}).some((name) => {
      return !["aria-expanded"].includes(name);
    });
  }

  function getCandidatesForPathStep(parent, entry) {
    if (!parent || !entry) {
      return [];
    }

    const children = Array.from(parent.children || []);
    let candidates = children.filter((child) => child.tagName && child.tagName.toLowerCase() === entry.tag);

    if (hasUsefulAttrs(entry.attrs)) {
      const attrSelector = buildAttrSelector(entry.tag, entry.attrs);
      if (attrSelector) {
        const attrMatches = Array.from(parent.querySelectorAll(`:scope > ${attrSelector}`));
        if (attrMatches.length) {
          candidates = attrMatches;
        }
      }
    }

    return candidates;
  }

  function resolveElementPath(root, path) {
    if (!root || !Array.isArray(path) || !path.length) {
      return null;
    }

    let current = root;
    for (const entry of path) {
      const candidates = getCandidatesForPathStep(current, entry);
      if (!candidates.length) {
        return null;
      }

      if (entry.indexOfType < 0 || entry.indexOfType >= candidates.length) {
        return null;
      }

      current = candidates[entry.indexOfType];
    }

    return current instanceof Element && isVisible(current) ? current : null;
  }

  function buildClickLocator(target, event) {
    const scope = getRecordScope(target);
    const root = scope.root;
    const clickable = getClickableElement(target) || target;
    const formItem = getFormItem(clickable);
    const composedPath = buildComposedElementPath(event, root);

    return {
      version: 3,
      scopeKind: scope.kind,
      scopeRootIndex: scope.rootIndex,
      tag: clickable.tagName ? clickable.tagName.toLowerCase() : "",
      attrs: getElementAttrs(clickable),
      rawTargetPath: composedPath.length
        ? composedPath
        : buildElementPath(target, root),
      clickablePath: buildElementPath(clickable, root),
      relativeSelector: getRelativeSelector(clickable, root),
      formItemIndex: getFormItemIndex(formItem),
      fieldIdentity: formItem ? `form-item:${getFormItemIndex(formItem)}` : ""
    };
  }

  function resolveClickScope(locator) {
    if (!locator || !locator.scopeKind) {
      return getActiveRoot();
    }

    if (locator.scopeKind === "floating") {
      const roots = getVisibleFloatingRoots();
      return roots[locator.scopeRootIndex] || roots[roots.length - 1] || null;
    }

    if (locator.scopeKind === "active-root") {
      const activeRoot = getActiveRoot();
      return activeRoot === document ? null : activeRoot;
    }

    return document.body;
  }

  function buildAttrSelector(tag, attrs) {
    const entries = Object.entries(attrs || {}).filter(([name, value]) => {
      return value && !["aria-expanded"].includes(name);
    });

    if (!entries.length) {
      return "";
    }

    return `${tag || "*"}${entries.map(([name, value]) => `[${name}="${cssEscape(value)}"]`).join("")}`;
  }

  function resolveClickTarget(step) {
    const locator = step.locator;
    if (!locator) {
      return null;
    }

    const root = resolveClickScope(locator);
    if (!root) {
      return null;
    }

    const clickablePathMatch = resolveElementPath(root, locator.clickablePath);
    if (clickablePathMatch) {
      return getClickableElement(clickablePathMatch) || clickablePathMatch;
    }

    const rawPathMatch = resolveElementPath(root, locator.rawTargetPath);
    if (rawPathMatch) {
      return getClickableElement(rawPathMatch) || rawPathMatch;
    }

    const attrSelector = buildAttrSelector(locator.tag, locator.attrs);
    if (attrSelector) {
      const attrMatch = root.querySelector(attrSelector);
      if (attrMatch && isVisible(attrMatch)) {
        return getClickableElement(attrMatch) || attrMatch;
      }
    }

    if (locator.relativeSelector) {
      const pathMatch = root.querySelector(locator.relativeSelector);
      if (pathMatch && isVisible(pathMatch)) {
        return getClickableElement(pathMatch) || pathMatch;
      }
    }

    return null;
  }

  function shouldIgnoreRecordTarget(target) {
    return Boolean(target.closest(`#${ROOT_ID}`));
  }

  function pushRecordStep(step) {
    if (step.action === "input" || step.action === "select") {
      const identity = step.fieldLabel || step.fieldKey || step.selector;
      const existingIndex = recordBuffer.findIndex((item) => {
        return (item.action === "input" || item.action === "select") &&
          (item.fieldLabel || item.fieldKey || item.selector) === identity;
      });

      if (existingIndex >= 0) {
        recordBuffer[existingIndex] = {
          ...recordBuffer[existingIndex],
          ...step,
          at: Date.now() - recordStartedAt
        };
        updatePanelMeta();
        return;
      }
    }

    recordBuffer.push({
      ...step,
      at: Date.now() - recordStartedAt
    });
    updatePanelMeta();
  }

  function onRecordClick(event) {
    if (!isRecording || shouldIgnoreRecordTarget(event.target)) {
      return;
    }

    const target = getActionTarget(event.target);
    if (!target) {
      return;
    }

    pushRecordStep({
      action: "click",
      locator: buildClickLocator(target, event)
    });
  }

  function onRecordInput(event) {
    if (!isRecording || shouldIgnoreRecordTarget(event.target)) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
      return;
    }

    const item = describeControl(target);
    if (!item || !item.key) {
      return;
    }

    const read = readControlValue(item, { savePasswords: true });
    pushRecordStep({
      action: item.type === "native-select" || item.type === "custom-select" ? "select" : "input",
      fieldKey: item.key,
      fieldLabel: item.label,
      aliases: item.aliases,
      selector: item.selector,
      identity: item.identity,
      controlType: item.type,
      value: read.value,
      displayValue: read.displayValue
    });
  }

  function findNearestFieldLabel(target) {
    const formItem = getFormItem(target);
    if (!formItem) {
      return "";
    }

    return cleanLabelText(formItem.querySelector(LABEL_SELECTOR));
  }

  function getFormItemIndex(formItem) {
    if (!formItem) {
      return -1;
    }
    return Array.from(getActiveRoot().querySelectorAll(FORM_ITEM_SELECTOR)).indexOf(formItem);
  }

  function describeControl(control) {
    const customRoot = control.closest(CUSTOM_WIDGET_SELECTOR);
    const element = customRoot || control;
    return {
      element,
      type: detectControlType(element),
      key: getFieldKey(element),
      aliases: getFieldAliases(element),
      selector: getUniqueSelector(element),
      fallbackSelector: getStableSelector(element),
      identity: getControlIdentity(element),
      label: findLabelForControl(element)
    };
  }

  async function startRecording() {
    if (isRecording) {
      return { recording: true, count: recordBuffer.length };
    }

    isRecording = true;
    recordBuffer = [];
    recordStartedAt = Date.now();
    document.addEventListener("click", onRecordClick, true);
    document.addEventListener("input", onRecordInput, true);
    document.addEventListener("change", onRecordInput, true);
    updatePanelStatus("正在录制操作，请按正常流程操作页面。");
    updatePanelMeta();
    return { recording: true, count: 0 };
  }

  async function stopRecording() {
    if (!isRecording) {
      return { recording: false, count: recordBuffer.length };
    }

    isRecording = false;
    document.removeEventListener("click", onRecordClick, true);
    document.removeEventListener("input", onRecordInput, true);
    document.removeEventListener("change", onRecordInput, true);

    const name = window.prompt("给这段操作取个名字，例如：选择授权组织", `操作 ${new Date().toLocaleString()}`);
    if (!name) {
      updatePanelStatus("录制已停止，未保存。");
      updatePanelMeta();
      return { recording: false, saved: false, count: recordBuffer.length };
    }

    await sleep(300);

    const data = await STORAGE.getAllData();
    const scope = getScope();
    const id = `${scope.key}::${Date.now()}`;
    const steps = compressRecordSteps(recordBuffer);
    data.recordings[id] = {
      id,
      name,
      scope,
      steps,
      savedAt: new Date().toISOString()
    };
    await STORAGE.setAllData(data);

    updatePanelStatus(`已保存录制：${name}，步骤 ${steps.length} 个。`);
    await renderRecordings();
    updatePanelMeta();
    return { recording: false, saved: true, count: recordBuffer.length, id };
  }

  function compressRecordSteps(steps) {
    const result = [];
    const finalFieldSteps = new Map();

    for (const step of steps) {
      if (step.action === "input" || step.action === "select") {
        const identity = step.fieldLabel || step.fieldKey || step.identity || step.selector;
        finalFieldSteps.set(identity, step);
        continue;
      }

      result.push(step);
    }

    const finalSteps = [...result, ...finalFieldSteps.values()];
    return finalSteps.sort((a, b) => a.at - b.at);
  }

  function findControlByRecordedStep(step) {
    const controls = collectControls();
    const candidates = [
      step.fieldLabel,
      step.fieldKey,
      ...(step.aliases || [])
    ].map(normalizeText).filter(Boolean);

    return controls.find((control) => candidates.includes(normalizeText(control.label))) ||
      controls.find((control) => candidates.includes(normalizeText(control.key))) ||
      controls.find((control) => control.aliases.some((alias) => candidates.includes(normalizeText(alias)))) ||
      controls.find((control) => step.identity && normalizeText(control.identity) === normalizeText(step.identity)) ||
      controls.find((control) => step.selector && normalizeText(control.selector) === normalizeText(step.selector));
  }

  function createMissingTargetError(message) {
    const error = new Error(message);
    error.code = "MISSING_REPLAY_TARGET";
    return error;
  }

  function isMissingTargetError(error) {
    return error && error.code === "MISSING_REPLAY_TARGET";
  }

  async function replayRecording(id) {
    if (isReplaying) {
      return { ok: false, message: "正在回放中" };
    }

    const data = await STORAGE.getAllData();
    const recording = data.recordings[id];
    if (!recording) {
      return { ok: false, message: "录制不存在" };
    }
    if (!recording.steps || !recording.steps.length) {
      showReplayFailure(recording.name || id, "录制没有可回放步骤");
      return { ok: false, message: "录制没有可回放步骤" };
    }
    const pathCheck = validateReplayPath(recording);
    if (!pathCheck.ok) {
      showPathMismatchConfirm(recording, pathCheck);
      return { ok: false, message: "当前页面 path 不匹配", pathMismatch: true };
    }

    isReplaying = true;
    stopReplayRequested = false;
    showReplayMask();
    updatePanelStatus(`正在回放：${recording.name}`);
    await updatePanelMeta();

    const replayHorizontalScrollState = captureHorizontalScrollState();
    try {
      let missingTargetCount = 0;
      const missingTargetLimit = Math.max(1, Math.round(recording.steps.length / 3));
      for (const step of recording.steps) {
        if (stopReplayRequested) {
          break;
        }

        const horizontalScrollState = captureHorizontalScrollState();
        try {
          await runReplayStep(step);
          restoreHorizontalScrollStateSoon(horizontalScrollState);
        } catch (error) {
          restoreHorizontalScrollStateSoon(horizontalScrollState);
          if (!isMissingTargetError(error)) {
            throw error;
          }

          missingTargetCount += 1;
          if (missingTargetCount > missingTargetLimit) {
            throw new Error(`当前页找不到操作目标节点超过 ${missingTargetLimit} 个，已自动结束回放`);
          }

          updatePanelStatus(`未找到 ${missingTargetCount}/${missingTargetLimit} 个目标节点，已跳过并继续回放。`);
        }
        if (stopReplayRequested) {
          break;
        }
        await sleep(REPLAY_STEP_DELAY_MS);
      }

      if (stopReplayRequested) {
        const stopMessage = `已停止回放：${recording.name}`;
        updatePanelStatus(stopMessage);
        showToast(stopMessage);
        return { ok: false, stopped: true, missingTargetCount };
      }

      const doneMessage = missingTargetCount
        ? `已回放：${recording.name}，跳过 ${missingTargetCount} 个未匹配目标`
        : `已回放：${recording.name}`;
      updatePanelStatus(doneMessage);
      showToast(`回放完毕：${recording.name}`);
      return { ok: true, count: recording.steps.length, missingTargetCount };
    } catch (error) {
      showReplayFailure(recording.name, error.message);
      return { ok: false, message: error.message };
    } finally {
      restoreHorizontalScrollStateSoon(replayHorizontalScrollState);
      isReplaying = false;
      stopReplayRequested = false;
      hideReplayMask();
      await updatePanelMeta();
    }
  }

  function stopReplay() {
    if (!isReplaying) {
      return;
    }

    stopReplayRequested = true;
    updatePanelStatus("正在停止回放...");
  }

  async function runReplayStep(step) {
    if (step.action === "input" || step.action === "select") {
      const item = findControlByRecordedStep(step);
      if (!item) {
        throw createMissingTargetError(`无法匹配字段：${step.fieldLabel || step.fieldKey || step.action}`);
      }

      const ok = await fillControl(item, { value: step.value, displayValue: step.displayValue });
      if (!ok) {
        throw new Error(`字段回放失败：${step.fieldLabel || step.fieldKey || step.action}`);
      }
      return;
    }

    if (step.action === "click") {
      const target = resolveClickTarget(step);

      if (!target || !isVisible(target)) {
        throw createMissingTargetError("无法匹配点击目标");
      }

      const clickTarget = getReplayClickTarget(target);
      if (isUnsafeReplayClickTarget(clickTarget)) {
        throw createMissingTargetError(`疑似误匹配页面功能按钮，已跳过：${getElementDebugText(clickTarget)}`);
      }

      updatePanelStatus(`正在点击：${getElementDebugText(clickTarget)}`);
      highlightReplayClickTarget(clickTarget);

      const ok = safeClick(clickTarget);
      if (!ok) {
        throw new Error("点击目标失败");
      }
      return;
    }

    throw new Error(`不支持的步骤类型：${step.action || "unknown"}`);
  }

  function showReplayFailure(name, reason) {
    const message = `回放失败：${name}${reason ? `，${reason}` : ""}`;
    updatePanelStatus(message, "error");
    showToast(message, "error");
  }

  async function getStatus() {
    const data = await STORAGE.getAllData();
    const scope = getScope();
    const recordings = getFilteredRecordings(data.recordings);

    return {
      scope,
      recordingCount: recordings.length,
      isRecording,
      isReplaying,
      currentSteps: recordBuffer.length
    };
  }

  async function deleteRecording(id) {
    const data = await STORAGE.getAllData();
    const recording = data.recordings && data.recordings[id];
    if (!recording) {
      updatePanelStatus("这条录制已经不存在。");
      await renderRecordings();
      updatePanelMeta();
      return { ok: false };
    }

    delete data.recordings[id];
    await STORAGE.setAllData(data);
    await renderRecordings();
    updatePanelStatus(`已删除录制：${recording.name || id}`);
    updatePanelMeta();
    return { ok: true };
  }

  function compactRecordingForView(recording) {
    return {
      id: recording.id,
      name: recording.name,
      pagePath: getRecordingPath(recording),
      scope: recording.scope,
      savedAt: recording.savedAt,
      stepCount: (recording.steps || []).length,
      steps: recording.steps || []
    };
  }

  async function showRecordingDetail(id) {
    const data = await STORAGE.getAllData();
    const recording = data.recordings && data.recordings[id];
    if (!recording) {
      currentDetail = {
        title: "录制不存在",
        data: { id }
      };
    } else {
      currentDetail = {
        title: `录制：${recording.name || id}`,
        data: compactRecordingForView(recording)
      };
    }

    renderDetail();
    updatePanelStatus("已展开录制内容。");
  }

  function clearDetail() {
    currentDetail = null;
    renderDetail();
  }

  async function copyCurrentDetail() {
    if (!currentDetail) {
      updatePanelStatus("没有可复制的内容。");
      return;
    }

    const text = JSON.stringify(currentDetail.data, null, 2);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        copyTextFallback(text);
      }
      updatePanelStatus("JSON 已复制到剪贴板。");
    } catch (error) {
      copyTextFallback(text);
      updatePanelStatus("JSON 已复制到剪贴板。");
    }
  }

  function copyTextFallback(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function getRecordingSearchText(recording) {
    return [
      recording.id,
      recording.name,
      recording.savedAt,
      recording.scope && recording.scope.host,
      recording.scope && recording.scope.path,
      recording.scope && recording.scope.dialogTitle
    ].map((value) => String(value || "").toLowerCase()).join(" ");
  }

  function getFilteredRecordings(recordings) {
    const currentScope = getScope();
    const keyword = normalizeText(recordingFilters.keyword).toLowerCase();

    return Object.values(recordings || {})
      .filter((recording) => {
        if (recordingFilters.scope === "current-host") {
          return recording.scope && recording.scope.host === currentScope.host;
        }
        return true;
      })
      .filter((recording) => {
        if (!keyword) {
          return true;
        }
        return getRecordingSearchText(recording).includes(keyword);
      })
      .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  }

  function createPanel() {
    if (document.getElementById(ROOT_ID)) {
      panelRoot = document.getElementById(ROOT_ID);
      return;
    }

    panelRoot = document.createElement("div");
    panelRoot.id = ROOT_ID;
    panelRoot.innerHTML = `
      <div class="ro-panel" hidden>
        <div class="ro-header">
          <div class="ro-title">操作录制/回放</div>
          <button class="ro-close" type="button" title="关闭">×</button>
        </div>
        <div class="ro-body">
          <div class="ro-grid">
            <button class="ro-button success" data-ro-action="start-record" type="button">开始录制</button>
            <button class="ro-button primary" data-ro-action="stop-record" type="button" hidden>停止保存</button>
            <button class="ro-button danger replay-stop" data-ro-action="stop-replay" type="button" hidden>停止回放</button>
          </div>
          <div class="ro-meta"></div>
          <div class="ro-status"></div>
          <div class="ro-filter">
            <select class="ro-filter-select" data-ro-filter="scope">
              <option value="all">全部</option>
              <option value="current-host">按当前域名</option>
            </select>
            <div class="ro-filter-input-wrap">
              <input class="ro-filter-input" data-ro-filter="keyword" type="text" placeholder="按名称搜索">
              <button class="ro-clear-input" data-ro-action="clear-search" type="button" title="清空搜索">×</button>
            </div>
            <button class="ro-button" data-ro-action="search-recordings" type="button">搜索</button>
          </div>
          <div class="ro-recordings"></div>
          <div class="ro-detail" hidden></div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(panelRoot);
    panelRoot.querySelector(".ro-close").addEventListener("click", () => {
      if (isRecording || isReplaying) {
        updatePanelStatus(isReplaying ? "正在回放中，请先停止回放。" : "正在录制中，请先停止保存。");
        return;
      }
      togglePanel(false);
    });
    panelRoot.addEventListener("click", onPanelClick);
    panelRoot.addEventListener("keydown", onPanelKeydown);
    updatePanelMeta();
    renderRecordings();
  }

  async function onPanelKeydown(event) {
    if (event.key !== "Enter" || !event.target.matches("[data-ro-filter='keyword']")) {
      return;
    }

    applyRecordingFilters();
    await renderRecordings();
    await updatePanelMeta();
  }

  async function onPanelClick(event) {
    const action = event.target.getAttribute("data-ro-action");
    if (!action) {
      return;
    }

    if (isReplaying && action !== "stop-replay") {
      updatePanelStatus("正在回放中，请稍候。");
      return;
    }

    if (isRecording && action !== "stop-record") {
      updatePanelStatus("正在录制中，请先停止保存。");
      return;
    }

    try {
      if (action === "start-record") {
        await startRecording();
      }

      if (action === "stop-record") {
        await stopRecording();
      }

      if (action === "stop-replay") {
        stopReplay();
      }

      if (action === "replay") {
        const id = event.target.getAttribute("data-ro-id");
        await replayRecording(id);
      }

      if (action === "delete-recording") {
        const id = event.target.getAttribute("data-ro-id");
        await deleteRecording(id);
      }

      if (action === "view-recording") {
        const id = event.target.getAttribute("data-ro-id");
        await showRecordingDetail(id);
      }

      if (action === "close-detail") {
        clearDetail();
      }

      if (action === "copy-detail") {
        await copyCurrentDetail();
      }

      if (action === "search-recordings") {
        applyRecordingFilters();
        await renderRecordings();
        await updatePanelMeta();
      }

      if (action === "clear-search") {
        const keywordInput = panelRoot.querySelector("[data-ro-filter='keyword']");
        if (keywordInput) {
          keywordInput.value = "";
        }
        applyRecordingFilters();
        await renderRecordings();
        await updatePanelMeta();
      }
    } catch (error) {
      handlePanelActionError(error);
    }
  }

  function handlePanelActionError(error) {
    const message = error && error.code === "RO_EXTENSION_CONTEXT_INVALIDATED"
      ? "扩展上下文已失效，请刷新页面或重新加载扩展后再试。"
      : `操作失败：${error && error.message ? error.message : "未知错误"}`;
    updatePanelStatus(message, "error");
    showToast(message, "error");
  }

  function applyRecordingFilters() {
    if (!panelRoot) {
      return;
    }

    const scopeSelect = panelRoot.querySelector("[data-ro-filter='scope']");
    const keywordInput = panelRoot.querySelector("[data-ro-filter='keyword']");
    recordingFilters = {
      scope: scopeSelect ? scopeSelect.value : "all",
      keyword: keywordInput ? keywordInput.value : ""
    };
  }

  function togglePanel(force) {
    createPanel();
    if (isRecording || isReplaying) {
      panelOpen = true;
      panelRoot.querySelector(".ro-panel").hidden = false;
      updatePanelStatus(isReplaying ? "正在回放中，可点击停止回放结束。" : "正在录制中，请先停止保存。");
      updatePanelMeta();
      return;
    }

    panelOpen = typeof force === "boolean" ? force : !panelOpen;
    panelRoot.querySelector(".ro-panel").hidden = !panelOpen;
    if (panelOpen) {
      updatePanelMeta();
      renderRecordings();
    }
  }

  function updatePanelStatus(message, tone = "success") {
    createPanel();
    const status = panelRoot.querySelector(".ro-status");
    if (status) {
      status.textContent = message || "";
      status.classList.toggle("error", tone === "error");
    }
  }

  async function updatePanelMeta() {
    if (!panelRoot) {
      return;
    }

    const meta = panelRoot.querySelector(".ro-meta");
    if (!meta) {
      return;
    }

    const status = await getStatus();
    updateRecordButtons(status.isRecording, status.isReplaying);
    updatePanelDisabledState({
      recording: status.isRecording,
      replaying: status.isReplaying
    });
    meta.innerHTML = `
      <div>当前范围：${status.scope.dialogTitle || status.scope.path || "/"}</div>
      <div>录制：<span class="ro-badge">${status.recordingCount}</span></div>
      <div>状态：${status.isReplaying ? "回放中" : status.isRecording ? `录制中，${status.currentSteps} 步` : "空闲"}</div>
    `;
  }

  function updateRecordButtons(recording, replaying) {
    if (!panelRoot) {
      return;
    }

    const startButton = panelRoot.querySelector("[data-ro-action='start-record']");
    const stopButton = panelRoot.querySelector("[data-ro-action='stop-record']");
    const stopReplayButton = panelRoot.querySelector("[data-ro-action='stop-replay']");
    if (startButton) {
      startButton.hidden = recording || replaying;
    }
    if (stopButton) {
      stopButton.hidden = !recording || replaying;
    }
    if (stopReplayButton) {
      stopReplayButton.hidden = !replaying;
    }
  }

  function updatePanelDisabledState(state) {
    if (!panelRoot) {
      return;
    }

    panelRoot.querySelectorAll("[data-ro-action]").forEach((button) => {
      const action = button.getAttribute("data-ro-action");
      const allowedWhileRecording = action === "stop-record";
      const allowedWhileReplaying = action === "stop-replay";
      button.disabled = Boolean(
        (state.recording && !allowedWhileRecording) ||
        (state.replaying && !allowedWhileReplaying)
      );
    });

    panelRoot.querySelectorAll("[data-ro-filter]").forEach((control) => {
      control.disabled = Boolean(state.recording || state.replaying);
    });
  }

  function showReplayMask() {
    let mask = document.getElementById(REPLAY_MASK_ID);
    if (!mask) {
      mask = document.createElement("div");
      mask.id = REPLAY_MASK_ID;
      mask.className = "ro-replay-mask";
      mask.setAttribute("aria-hidden", "true");
      document.documentElement.appendChild(mask);
    }
    mask.hidden = false;
  }

  function hideReplayMask() {
    const mask = document.getElementById(REPLAY_MASK_ID);
    if (mask) {
      mask.hidden = true;
    }
  }

  function showToast(message, tone = "success") {
    let toast = document.getElementById("remember-operation-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "remember-operation-toast";
      document.documentElement.appendChild(toast);
    }

    toast.className = `ro-toast ${tone}`;
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      toast.hidden = true;
    }, 2600);
  }

  async function renderRecordings() {
    if (!panelRoot) {
      return;
    }

    const container = panelRoot.querySelector(".ro-recordings");
    if (!container) {
      return;
    }

    const data = await STORAGE.getAllData();
    const recordings = getFilteredRecordings(data.recordings);
    if (!recordings.length) {
      container.innerHTML = "";
      return;
    }

    container.innerHTML = recordings.map((recording) => `
      <div class="ro-recording-row">
        <div class="ro-recording-info">
          <div class="ro-recording-name" title="${escapeHtml(recording.name)}">${escapeHtml(recording.name)}</div>
          <div class="ro-recording-domain">(${escapeHtml(recording.scope && recording.scope.host ? recording.scope.host : "unknown")})</div>
        </div>
        <div class="ro-recording-actions">
          <button class="ro-button" data-ro-action="view-recording" data-ro-id="${escapeHtml(recording.id)}" type="button">查看</button>
          <button class="ro-button" data-ro-action="replay" data-ro-id="${escapeHtml(recording.id)}" type="button">回放</button>
          <button class="ro-button danger" data-ro-action="delete-recording" data-ro-id="${escapeHtml(recording.id)}" type="button">删除</button>
        </div>
      </div>
    `).join("");
  }

  function renderDetail() {
    if (!panelRoot) {
      return;
    }

    const detail = panelRoot.querySelector(".ro-detail");
    if (!detail) {
      return;
    }

    if (!currentDetail) {
      detail.hidden = true;
      detail.innerHTML = "";
      return;
    }

    detail.hidden = false;
    detail.innerHTML = `
      <div class="ro-detail-header">
        <div class="ro-detail-title">${escapeHtml(currentDetail.title)}</div>
        <div class="ro-detail-actions">
          <button class="ro-close-detail" data-ro-action="copy-detail" type="button">复制 JSON</button>
          <button class="ro-close-detail" data-ro-action="close-detail" type="button">关闭</button>
        </div>
      </div>
      <pre class="ro-detail-code">${escapeHtml(JSON.stringify(currentDetail.data, null, 2))}</pre>
    `;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function initMessages() {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.onMessage) {
      return;
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const run = async () => {
        if (message.type === "RO_TOGGLE_PANEL") {
          togglePanel();
          return { ok: true };
        }
        if (message.type === "RO_START_RECORD") {
          return { ok: true, result: await startRecording() };
        }
        if (message.type === "RO_STOP_RECORD") {
          return { ok: true, result: await stopRecording() };
        }
        if (message.type === "RO_STATUS") {
          return { ok: true, result: await getStatus() };
        }
        if (message.type === "RO_DELETE_RECORDING") {
          return { ok: true, result: await deleteRecording(message.id) };
        }
        return { ok: false, message: "未知消息" };
      };

      run().then(sendResponse).catch((error) => {
        sendResponse({ ok: false, message: error.message });
      });

      return true;
    });
  }

  createPanel();
  initMessages();
  initRouteObserver();
  resumePendingReplay();
})();
