// ==UserScript==
// @name         Mais_Controle_Automação_de_Transferência
// @namespace    http://tampermonkey.net/
// @version      2026-10-29-v15
// @description  Automação de transferência com atalho, painel flutuante, lotes de 10, índices, ordenação A-Z e ponte Clipboard (ERP Mais Controle + AppSheet)
// @match        https://acessar.maiscontroleerp.com.br/*
// @match        https://www.appsheet.com/*
// @match        https://appsheet.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// ==/UserScript==


(() => {
  // src/config.js
  var HOTKEY = {
    ctrl: true,
    alt: true,
    shift: false,
    meta: false,
    key: "Z"
  };
  var STORAGE_KEY = "insumos_transferencia_copiados";
  var CLIPBOARD_SOURCE = "APPSHEET_MAIS_CONTROLE";
  var PROGRESS_KEY = "insumos_transferencia_progresso";
  var PEDIDO_PROGRESS_KEY = "insumos_pedido_progresso";
  var POSITION_KEY = "mc_automation_panel_position";
  var BATCH_SIZE = 10;
  var OBSERVER_DELAY = 700;
  var PANEL_ID = "mc-automation-panel";
  var UI_CLASS = "mc-automation-ui";
  var ERP = {
    keywordId: "keyword",
    modalSelectors: [
      ".modal",
      ".modal-dialog",
      ".modal-content",
      ".modal-body",
      '[role="dialog"]',
      '[aria-modal="true"]',
      ".popup",
      ".drawer",
      '[class*="modal"]',
      '[class*="Modal"]',
      '[class*="dialog"]',
      '[class*="Dialog"]'
    ],
    adicionarInsumoText: "adicionar insumo",
    adicionarText: "adicionar",
    observacoesLabels: [
      "observações",
      "observacao",
      "observação"
    ],
    timeouts: {
      modalOpen: 1e4,
      modalClose: 2e4,
      materialRow: 6e3
    }
  };

  // src/state.js
  var appState = {
    // SEMPRE comeca desligada quando a pagina e atualizada.
    extensionEnabled: false,
    // idle | running | paused | waitingAdd | cancelled | completed
    automationState: "idle",
    // transfer | pedido
    activeFlow: "transfer",
    // Resumo da ultima copia (usado pelo painel no AppSheet)
    copySummary: null,
    sortAscending: true,
    stopRequested: false,
    pauseRequested: false,
    setupRunning: false,
    observerTimer: null,
    observacoesTimer: null,
    currentRunPromise: null,
    suppressHooks: false
  };
  var controls = {
    play: null,
    pause: null,
    cancel: null,
    restart: null,
    copyAppSheet: null
  };
  function registerControls(next) {
    Object.assign(controls, next);
  }

  // src/utils.js
  var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function log(...args) {
    console.log("[Mais Controle]", ...args);
  }
  function bodyText() {
    return document.body?.innerText?.toLowerCase() || "";
  }
  function cleanText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }
  function extractMatCode(text) {
    if (!text) return null;
    const match = String(text).match(/\bMAT\s*[-_]?\s*(\d+)\b/i);
    return match ? `MAT${match[1]}`.toUpperCase() : null;
  }
  function normalizeMatCode(code) {
    if (!code) return null;
    const match = String(code).match(/\bMAT\s*[-_]?\s*(\d+)\b/i);
    return match ? `MAT${match[1]}`.toUpperCase() : null;
  }
  function getSearchNumber(code) {
    if (!code) return "";
    const match = String(code).match(/MAT\s*[-_]?\s*(\d+)/i);
    return match ? match[1] : String(code).trim();
  }
  function parseQuantity(text) {
    const value = cleanText(text);
    if (!value)
      return null;
    const match = value.match(
      /-?\d+(?:[.,]\d+)?/
    );
    if (!match)
      return null;
    return match[0].replace(",", ".");
  }

  // src/pages.js
  var MODAL_SELECTOR = ERP.modalSelectors.join(", ");
  var FIELD_SELECTOR = 'button, a, [role="button"], input[type="button"], input[type="submit"], div[role="button"]';
  var CONFIRM_BUTTON_PATTERN = /^adicionar\s*\(\s*\d+\s*\)$/;
  function isElementVisible(el) {
    if (!el)
      return false;
    if (el.hidden)
      return false;
    if (typeof el.getClientRects === "function") {
      const rects = el.getClientRects();
      if (!rects || !rects.length)
        return false;
    }
    if (typeof window !== "undefined") {
      const style = window.getComputedStyle?.(el);
      if (style) {
        if (style.display === "none")
          return false;
        if (style.visibility === "hidden")
          return false;
      }
    }
    return true;
  }
  function isElementEnabled(el) {
    if (!el)
      return false;
    if (el.disabled)
      return false;
    const disabledAttribute = el.getAttribute?.("disabled");
    if (disabledAttribute !== null && disabledAttribute !== void 0)
      return false;
    if (el.getAttribute?.("aria-disabled") === "true")
      return false;
    if (/(^|\s)Mui-disabled(\s|$)/.test(String(el.className || "")))
      return false;
    return true;
  }
  function isReallyVisible(el) {
    if (!el)
      return false;
    if (el.hidden)
      return false;
    if (typeof el.getClientRects === "function") {
      const rects = el.getClientRects();
      if (!rects || !rects.length)
        return false;
    }
    let node = el;
    while (node) {
      if (node.hidden)
        return false;
      if (typeof node.getAttribute === "function" && node.getAttribute("aria-hidden") === "true") {
        return false;
      }
      if (typeof window !== "undefined") {
        const style = window.getComputedStyle?.(node);
        if (style) {
          if (style.display === "none")
            return false;
          if (style.visibility === "hidden" || style.visibility === "collapse") {
            return false;
          }
          const opacity = parseFloat(style.opacity);
          if (Number.isFinite(opacity) && opacity <= 0.01)
            return false;
        }
      }
      node = node.parentElement || null;
    }
    return true;
  }
  function getModalContainers() {
    return Array.from(document.querySelectorAll(MODAL_SELECTOR));
  }
  function getVisibleTables() {
    return Array.from(document.querySelectorAll("table")).filter((table) => isElementVisible(table)).filter((table) => table.querySelectorAll("tr").length > 0);
  }
  function getSearchInputs() {
    return Array.from(document.querySelectorAll(
      `input#${ERP.keywordId}, input[name="${ERP.keywordId}"]`
    ));
  }
  function getSearchHint(input) {
    if (!input)
      return "";
    const parts = [
      input.getAttribute?.("placeholder"),
      input.getAttribute?.("aria-label"),
      input.getAttribute?.("title"),
      input.getAttribute?.("name")
    ];
    const labelledBy = input.getAttribute?.("aria-labelledby");
    if (labelledBy && typeof document !== "undefined") {
      for (const id of String(labelledBy).split(/\s+/).filter(Boolean)) {
        const label = document.getElementById?.(id);
        if (label)
          parts.push(label.innerText || label.textContent || "");
      }
    }
    let node = input.parentElement;
    for (let i = 0; i < 2 && node; i++) {
      const label = Array.from(node.children || []).find(
        (child) => String(child.tagName || "").toUpperCase() === "LABEL"
      );
      if (label) {
        parts.push(label.innerText || label.textContent || "");
        break;
      }
      node = node.parentElement;
    }
    return cleanText(parts.filter(Boolean).join(" ")).toLowerCase();
  }
  function getSearchInputHint(input) {
    return getSearchHint(input);
  }
  function isAddedItemsFilter(input) {
    const hint = getSearchHint(input);
    return hint.includes("adicionad") || hint.includes("incluíd") || hint.includes("incluid") || hint.includes("salvos");
  }
  function isAdicionarInsumoSearchHint(input) {
    const hint = getSearchHint(input);
    if (!hint || isAddedItemsFilter(input))
      return false;
    return hint.includes("um insumo") || hint.includes("buscar insumo") || hint.includes("procurar insumo") || hint.includes("pesquisar insumo") || hint.includes("adicionar insumo");
  }
  var ADICIONAR_INSUMO_TITLE = /adicionar\s+insumo/i;
  function hasAdicionarInsumoTitle(container) {
    if (!container || typeof container.querySelectorAll !== "function")
      return false;
    const attributes = [
      container.getAttribute?.("aria-label"),
      container.getAttribute?.("title")
    ];
    if (attributes.some(
      (value) => ADICIONAR_INSUMO_TITLE.test(cleanText(value).toLowerCase())
    )) {
      return true;
    }
    const headings = Array.from(container.querySelectorAll(
      'h1, h2, h3, h4, h5, h6, [role="heading"], .MuiDialogTitle-root, [id*="supplies"]'
    )).filter(isReallyVisible);
    return headings.some(
      (heading) => ADICIONAR_INSUMO_TITLE.test(
        cleanText(heading.innerText || heading.textContent || "").toLowerCase()
      )
    );
  }
  function pickSearchInput(inputs) {
    if (!inputs || !inputs.length)
      return null;
    const strong = inputs.find(isAdicionarInsumoSearchHint);
    if (strong)
      return strong;
    const insumo = inputs.find((input) => {
      const hint = getSearchHint(input);
      return hint.includes("insumo") && !isAddedItemsFilter(input);
    });
    if (insumo)
      return insumo;
    const remaining = inputs.filter((input) => !isAddedItemsFilter(input));
    if (!remaining.length)
      return null;
    if (remaining.length === 1)
      return remaining[0];
    const plain = remaining.filter(
      (input) => !String(input.className || "").includes("AdornedEnd")
    );
    if (plain.length === 1)
      return plain[0];
    return remaining[0];
  }
  var DIALOG_ANCESTOR_SELECTOR = '[role="dialog"], [aria-modal="true"], .MuiDialog-paper, .MuiDialog-container, .modal, .modal-dialog, .modal-content, .modal-body, .popup, .drawer';
  function getDialogAncestor(input) {
    if (!input || typeof input.closest !== "function")
      return null;
    try {
      return input.closest(DIALOG_ANCESTOR_SELECTOR);
    } catch (e) {
      return null;
    }
  }
  function isInsideDialog(input) {
    return !!getDialogAncestor(input);
  }
  function findSearchInputIn(container) {
    if (!container)
      return null;
    const keywords = Array.from(container.querySelectorAll(`input#${ERP.keywordId}`)).filter(isReallyVisible).filter(isInsideDialog);
    return pickSearchInput(keywords);
  }
  function isDialogLike(container) {
    if (!container)
      return false;
    if (typeof container.matches === "function") {
      try {
        if (container.matches(
          '[role="dialog"], [aria-modal="true"], .modal, .modal-dialog, .modal-content, .modal-body, .popup, .drawer'
        )) {
          return true;
        }
      } catch (e) {
      }
    }
    const className = String(container.className || "");
    if (/(^|[\s_-])(modal|popup|drawer|overlay|backdrop|dialog)/i.test(className))
      return true;
    if (typeof window !== "undefined") {
      const style = window.getComputedStyle?.(container);
      if (style && (style.position === "fixed" || style.position === "absolute"))
        return true;
    }
    return false;
  }
  function findConfirmButtonIn(container) {
    if (!container || typeof container.querySelectorAll !== "function")
      return null;
    const candidates = Array.from(container.querySelectorAll(FIELD_SELECTOR)).filter((el) => isReallyVisible(el)).filter((el) => CONFIRM_BUTTON_PATTERN.test(getButtonText(el)));
    if (!candidates.length)
      return null;
    return candidates[candidates.length - 1];
  }
  function findConfirmButton() {
    return findConfirmButtonIn(typeof document !== "undefined" ? document : null);
  }
  function getAdicionarInsumoModal() {
    const containers = getModalContainers();
    for (let i = containers.length - 1; i >= 0; i--) {
      const container = containers[i];
      if (typeof document !== "undefined" && (container === document.body || container === document.documentElement)) {
        continue;
      }
      if (!isReallyVisible(container))
        continue;
      const titled = hasAdicionarInsumoTitle(container);
      if (!isDialogLike(container) && !titled)
        continue;
      const input = findSearchInputIn(container);
      if (!input)
        continue;
      if (!titled && !findConfirmButtonIn(container)) {
        continue;
      }
      return container;
    }
    const inputs = getSearchInputs().filter(isReallyVisible).filter(isInsideDialog);
    if (findConfirmButton()) {
      const picked = pickSearchInput(inputs);
      if (picked)
        return getDialogAncestor(picked) || picked;
    }
    return null;
  }
  function getAdicionarInsumoSearchInput() {
    const modal = getAdicionarInsumoModal();
    if (!modal)
      return null;
    if (String(modal.tagName || "").toUpperCase() === "INPUT")
      return isReallyVisible(modal) ? modal : null;
    const input = findSearchInputIn(modal);
    if (input)
      return input;
    return null;
  }
  function getButtonText(el) {
    return cleanText(el?.innerText || el?.textContent || el?.value || "").toLowerCase();
  }
  function getAdicionarInsumoButton() {
    const modal = getAdicionarInsumoModal();
    const candidates = Array.from(document.querySelectorAll(FIELD_SELECTOR)).filter((el) => isReallyVisible(el)).filter((el) => !modal || !modal.contains?.(el));
    const exact = candidates.find((el) => getButtonText(el) === ERP.adicionarInsumoText);
    if (exact)
      return exact;
    const partial = candidates.filter((el) => getButtonText(el).includes(ERP.adicionarInsumoText)).sort((a, b) => getButtonText(a).length - getButtonText(b).length);
    return partial[0] || null;
  }
  function getAdicionarButton() {
    const modal = getAdicionarInsumoModal();
    const candidates = Array.from(document.querySelectorAll(FIELD_SELECTOR)).filter((el) => isReallyVisible(el));
    const withCount = candidates.filter((el) => CONFIRM_BUTTON_PATTERN.test(getButtonText(el)));
    if (withCount.length) {
      if (!modal)
        return withCount[withCount.length - 1];
      const inside = withCount.filter((el) => modal.contains?.(el));
      return inside[inside.length - 1] || null;
    }
    const exact = candidates.filter((el) => getButtonText(el) === ERP.adicionarText);
    if (exact.length) {
      if (!modal)
        return exact[exact.length - 1];
      const inside = exact.filter((el) => modal.contains?.(el));
      return inside[inside.length - 1] || null;
    }
    return null;
  }
  function isAdicionarInsumoPage() {
    return !!getAdicionarInsumoModal();
  }
  function isPedidoPath() {
    const pathname = String(
      typeof window !== "undefined" && window.location?.pathname || ""
    );
    if (/\/compras\/(?:solicitac|pedid)/i.test(pathname))
      return true;
    return /\/solicitac(?:ao|oes|ões)|\/pedidos?\//i.test(pathname);
  }
  function isPedidoPage() {
    if (isPedidoPath())
      return true;
    const text = bodyText();
    return (text.includes("solicitação") || text.includes("solicitacao") || text.includes("adicionar item")) && (text.includes("qtde solicitada") || text.includes("quantidade solicitada") || text.includes("itens"));
  }
  function isTransferenciaPage() {
    if (isAdicionarInsumoPage())
      return false;
    const pathname = String(
      typeof window !== "undefined" && window.location?.pathname || ""
    );
    if (/transferenc/i.test(pathname))
      return true;
    const text = bodyText();
    if (/qtde\s+a\s+transfer/.test(text))
      return true;
    return !!getAdicionarInsumoButton();
  }
  function isAppSheetHost() {
    if (typeof window === "undefined")
      return false;
    const host = String(
      window.location?.hostname || ""
    ).toLowerCase();
    return host === "appsheet.com" || host.endsWith(".appsheet.com");
  }

  // src/styles.js
  function installStyles() {
    if (document.getElementById(
      "mc-automation-styles"
    )) {
      return;
    }
    const style = document.createElement("style");
    style.id = "mc-automation-styles";
    style.className = UI_CLASS;
    style.textContent = `

        /* =================================================
           PAINEL FLUTUANTE
           ================================================= */

        #${PANEL_ID} {

            position: fixed;

            top: 90px;
            right: 20px;

            width: 340px;

            max-width:
                calc(100vw - 20px);

            z-index: 2147483646;

            background: #fff;

            border:
                1px solid #d9d9d9;

            border-radius: 14px;

            box-shadow:
                0 12px 35px
                rgba(0,0,0,.24);

            overflow: hidden;

            font-family:
                Arial,
                Helvetica,
                sans-serif;

            color: #444;

            user-select: none;
        }


        #${PANEL_ID}.mc-collapsed {

            width: 100px;

            border-radius: 10px;
        }


        .mc-panel-header {

            height: 48px;

            background: #1976d2;

            color: #fff;

            display: flex;

            align-items: center;

            justify-content:
                space-between;

            padding:
                0 14px;

            cursor: move;
        }


        .mc-panel-title {

            font-size: 16px;

            font-weight: 700;
        }


        .mc-panel-header-actions button,
        .mc-collapsed-bar button {

            border: 0;

            background:
                rgba(255,255,255,.18);

            color: #fff;

            border-radius: 6px;

            width: 30px;

            height: 30px;

            font-size: 20px;

            cursor: pointer;
        }


        .mc-panel-body {

            padding: 12px;
        }


        .mc-panel-status {

            font-size: 15px;

            margin-bottom: 10px;
        }


        .mc-panel-line {

            font-size: 13px;

            margin: 5px 0;
        }


        .mc-panel-items {

            max-height: 88px;

            overflow-y: auto;

            background: #fafafa;

            border: 1px solid #e0e0e0;

            border-radius: 8px;

            padding: 7px;

            margin: 8px 0;

            font-size: 11px;

            line-height: 1.45;
        }

        .mc-panel-items-title {

            font-weight: 700;

            margin-bottom: 4px;
        }


        .mc-panel-notfound {

            color: #e53935;

            font-size: 14px;

            line-height: 1.45;

            margin: 10px 0;

            overflow-wrap:
                anywhere;
        }


        .mc-panel-message {

            background: #f4f5f7;

            border-radius: 8px;

            padding: 8px;

            font-size: 12px;

            line-height: 1.35;

            margin: 8px 0;
        }


        .mc-panel-log {

            height: 78px;

            overflow-y: auto;

            background: #fafafa;

            border:
                1px solid #eee;

            border-radius: 8px;

            padding: 6px;

            font-size: 10px;

            line-height: 1.3;

            margin-bottom: 8px;
        }


        .mc-panel-actions {

            display: grid;

            grid-template-columns:
                repeat(2, minmax(0, 1fr));

            gap: 6px;

            margin-bottom: 8px;
        }


        .mc-panel-actions .mc-btn {

            width: 100%;

            padding: 8px 5px;

            font-size: 10px;

            line-height: 1.25;
        }


        .mc-panel-buttons {

            display: grid;

            grid-template-columns:
                1fr 1fr;

            gap: 6px;
        }


        #${PANEL_ID}.mc-appsheet .mc-panel-actions {

            grid-template-columns: 1fr;
        }


        #${PANEL_ID}.mc-appsheet .mc-play {

            grid-column: 1 / -1;
        }


        .mc-btn {

            border: 0;

            border-radius: 7px;

            padding: 8px 5px;

            font-size: 11px;

            font-weight: 700;

            line-height: 1.25;

            cursor: pointer;
        }


        .mc-copy-panel,
        .mc-copy-pedido {

            background: #1976d2;

            color: #fff;
        }


        .mc-pedido-panel,
        .mc-fill-panel {

            background: #28a745;

            color: #fff;
        }


        .mc-play {

            background: #28a745;

            color: #fff;
        }


        .mc-pause {

            background: #ffc107;

            color: #111;
        }


        .mc-cancel {

            background: #dc3545;

            color: #fff;
        }


        .mc-restart {

            background: #6c757d;

            color: #fff;
        }


        .mc-btn:hover {

            filter:
                brightness(.95);
        }


        .mc-collapsed-bar {

            height: 44px;

            padding:
                0 8px 0 12px;

            display: flex;

            align-items: center;

            justify-content:
                space-between;

            background: #1976d2;

            color: #fff;

            font-weight: 700;

            cursor: move;
        }


        /* =================================================
           TOAST
           ================================================= */

        #mc-automation-toast {

            position: fixed;

            right: 20px;

            bottom: 20px;

            z-index: 2147483647;

            background: #333;

            color: #fff;

            padding:
                11px 15px;

            border-radius: 8px;

            box-shadow:
                0 5px 18px
                rgba(0,0,0,.25);

            font:
                14px Arial,
                sans-serif;

            max-width: 420px;
        }


        #mc-automation-toast[data-type="success"] {

            background: #198754;
        }


        #mc-automation-toast[data-type="error"] {

            background: #dc3545;
        }


        #mc-automation-toast[data-type="warning"] {

            background: #ffc107;

            color: #111;
        }


        /* =================================================
           BOTÃO DE ORDENAR
           ================================================= */

        .mc-sort-button {

            margin:
                8px 0 8px auto !important;

            display: block !important;

            background:
                #087ff5 !important;

            color:
                #fff !important;

            border:
                0 !important;

            border-radius:
                7px !important;

            padding:
                10px 14px !important;

            font-weight:
                700 !important;

            cursor:
                pointer !important;

            box-shadow:
                0 2px 7px
                rgba(0,0,0,.15) !important;
        }


        /* =================================================
           BOTÕES PRINCIPAIS
           ================================================= */

        .mc-floating-actions {

            position: fixed !important;

            top: 30px !important;

            right: 28px !important;

            z-index: 2147483645 !important;

            display: flex !important;

            flex-direction: row !important;

            flex-wrap: wrap !important;

            justify-content:
                flex-end !important;

            align-items: center !important;

            gap: 8px !important;

            max-width:
                calc(100vw - 56px) !important;

            pointer-events: none !important;
        }


        .mc-floating-actions > * {

            pointer-events: auto !important;
        }


        .mc-copy-button,
        .mc-auto-button,
        .mc-fill-button,
        .mc-pedido-auto-button {

            position: static !important;

            top: auto !important;

            right: auto !important;

            left: auto !important;

            bottom: auto !important;

            border: 0 !important;

            border-radius:
                8px !important;

            padding:
                12px 17px !important;

            background:
                #1976d2 !important;

            color:
                #fff !important;

            font-weight:
                700 !important;

            font-size:
                14px !important;

            cursor:
                pointer !important;

            box-shadow:
                0 4px 12px
                rgba(0,0,0,.2) !important;
        }


        .mc-auto-button,
        .mc-pedido-auto-button {

            background:
                #28a745 !important;
        }


        .mc-fill-button {

            background:
                #1976d2 !important;
        }


        /* =================================================
           ÍNDICES
           ================================================= */

        .mc-index-cell {

            width: 60px;

            text-align:
                center !important;

            font-weight:
                700 !important;
        }

    `;
    document.head.appendChild(
      style
    );
  }

  // src/storage.js
  function saveStorageData(key, data) {
    const jsonValue = JSON.stringify(data);
    try {
      if (typeof GM_setValue !== "undefined")
        GM_setValue(key, jsonValue);
    } catch (err) {
      console.error(`[Storage] Erro ao salvar via GM em ${key}:`, err);
    }
    try {
      localStorage.setItem(key, jsonValue);
    } catch (err) {
      console.error(`[Storage] Erro ao salvar ${key}:`, err);
    }
  }
  function getStorageData(key, defaultValue = null) {
    try {
      let raw = null;
      if (typeof GM_getValue !== "undefined")
        raw = GM_getValue(key, null);
      if (raw === null || raw === void 0 || raw === "") {
        try {
          raw = localStorage.getItem(key);
        } catch (e) {
          raw = null;
        }
      }
      if (raw === null || raw === void 0 || raw === "")
        return defaultValue;
      if (typeof raw !== "string")
        return raw;
      return JSON.parse(raw);
    } catch (err) {
      console.error(`[Storage] Erro ao ler chave ${key}:`, err);
      return defaultValue;
    }
  }
  function removeStorageData(key) {
    try {
      if (typeof GM_deleteValue !== "undefined")
        GM_deleteValue(key);
      else if (typeof GM_setValue !== "undefined")
        GM_setValue(key, "");
    } catch (err) {
      console.error(`[Storage] Erro ao remover via GM ${key}:`, err);
    }
    try {
      localStorage.removeItem(key);
    } catch (err) {
      console.error(`[Storage] Erro ao remover ${key}:`, err);
    }
  }
  function emptyMetadata() {
    return {
      orderNumber: "",
      description: ""
    };
  }
  function normalizeMetadata(meta) {
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
      return emptyMetadata();
    }
    return {
      orderNumber: String(meta.orderNumber ?? "").trim(),
      description: String(meta.description ?? "").trim()
    };
  }
  function parsePayload(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return {
        metadata: emptyMetadata(),
        items: {}
      };
    }
    const hasItems = raw.items && typeof raw.items === "object" && !Array.isArray(raw.items);
    const hasMetadata = raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata);
    if (hasItems) {
      const items = {};
      Object.keys(raw.items).forEach((key) => {
        if (key === "metadata") return;
        items[key] = raw.items[key];
      });
      return {
        metadata: normalizeMetadata(hasMetadata ? raw.metadata : raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {}),
        items
      };
    }
    if (hasMetadata) {
      const items = {};
      Object.keys(raw).forEach((key) => {
        if (key === "metadata") return;
        items[key] = raw[key];
      });
      return {
        metadata: normalizeMetadata(raw.metadata),
        items
      };
    }
    return {
      metadata: emptyMetadata(),
      items: { ...raw }
    };
  }
  function getStoredPayload() {
    try {
      const data = getStorageData(STORAGE_KEY, null);
      return parsePayload(data);
    } catch (e) {
      return {
        metadata: emptyMetadata(),
        items: {}
      };
    }
  }
  function getMetadataFromStorage() {
    return getStoredPayload().metadata;
  }
  function getItemsFromStorage() {
    return getStoredPayload().items;
  }
  function getCodesFromStorage() {
    try {
      const items = getItemsFromStorage();
      return Object.keys(items).map(normalizeMatCode).filter(Boolean);
    } catch (e) {
      return [];
    }
  }
  function clearCopiedData() {
    removeStorageData(STORAGE_KEY);
    clearProgress();
    clearPedidoProgress();
  }
  function saveCopiedItems(items, metadata) {
    const cleanItems = {};
    Object.keys(items || {}).forEach((key) => {
      if (key !== "metadata")
        cleanItems[key] = items[key];
    });
    const sortedItems = {};
    Object.keys(cleanItems).sort(
      (a, b) => a.localeCompare(b, "pt-BR", {
        sensitivity: "base",
        numeric: true
      })
    ).forEach((code) => {
      sortedItems[code] = cleanItems[code];
    });
    removeStorageData(STORAGE_KEY);
    saveStorageData(STORAGE_KEY, {
      metadata: normalizeMetadata(metadata),
      items: sortedItems
    });
    return Object.keys(sortedItems).length;
  }
  function normalizeClipboardItems(items) {
    const normalized = {};
    if (!items || typeof items !== "object" || Array.isArray(items))
      return normalized;
    Object.keys(items).forEach((key) => {
      const raw = items[key];
      const item = raw && typeof raw === "object" ? raw : {};
      const code = normalizeMatCode(item.code || key) || String(item.code || key || "").trim().toUpperCase();
      const quantity = String(
        raw && typeof raw === "object" ? item.quantity ?? "" : raw ?? ""
      ).trim();
      if (!code || !quantity)
        return;
      normalized[code] = {
        code,
        quantity
      };
    });
    const sorted = {};
    Object.keys(normalized).sort(
      (a, b) => a.localeCompare(b, "pt-BR", {
        sensitivity: "base",
        numeric: true
      })
    ).forEach((code) => {
      sorted[code] = normalized[code];
    });
    return sorted;
  }
  function parseClipboardPayload(value) {
    let data = value;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (err) {
        return null;
      }
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return null;
    }
    if (String(data.source || "") !== CLIPBOARD_SOURCE)
      return null;
    const parsed = parsePayload(data);
    const items = normalizeClipboardItems(parsed.items);
    if (!Object.keys(items).length)
      return null;
    const timestamp = Number(data.timestamp);
    return {
      source: CLIPBOARD_SOURCE,
      timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
      metadata: parsed.metadata,
      items
    };
  }
  function saveClipboardPayload(payload) {
    const parsed = parseClipboardPayload(payload);
    if (!parsed)
      return 0;
    const count = Object.keys(parsed.items).length;
    removeStorageData(STORAGE_KEY);
    saveStorageData(STORAGE_KEY, {
      source: parsed.source,
      timestamp: parsed.timestamp,
      metadata: parsed.metadata,
      items: parsed.items
    });
    resetProgress(count);
    resetPedidoProgress(count);
    return count;
  }
  function readProgress(key, total) {
    try {
      const saved = getStorageData(key, null);
      if (!saved || Number(saved.total) !== Number(total)) {
        return {
          nextIndex: 0,
          total,
          paused: false,
          notFound: []
        };
      }
      let nextIndex = Number(saved.nextIndex);
      if (!Number.isFinite(nextIndex)) {
        nextIndex = 0;
      }
      nextIndex = Math.max(
        0,
        Math.min(nextIndex, total)
      );
      return {
        nextIndex,
        total,
        paused: Boolean(saved.paused),
        notFound: Array.isArray(saved.notFound) ? saved.notFound : []
      };
    } catch (e) {
      return {
        nextIndex: 0,
        total,
        paused: false,
        notFound: []
      };
    }
  }
  function writeProgress(key, nextIndex, total, paused = false, notFound = null) {
    const old = readProgress(key, total);
    saveStorageData(
      key,
      {
        nextIndex,
        total,
        paused,
        notFound: Array.isArray(notFound) ? notFound : old.notFound,
        updatedAt: Date.now()
      }
    );
    notifyProgressChanged();
  }
  function clearStoredProgress(key, total) {
    saveStorageData(
      key,
      {
        nextIndex: 0,
        total,
        paused: false,
        notFound: [],
        updatedAt: Date.now()
      }
    );
  }
  function getProgress(total) {
    return readProgress(PROGRESS_KEY, total);
  }
  function saveProgress(nextIndex, total, paused = false, notFound = null) {
    writeProgress(
      PROGRESS_KEY,
      nextIndex,
      total,
      paused,
      notFound
    );
  }
  function resetProgress(total) {
    clearStoredProgress(PROGRESS_KEY, total);
  }
  function clearProgress() {
    removeStorageData(PROGRESS_KEY);
  }
  function getPedidoProgress(total) {
    return readProgress(PEDIDO_PROGRESS_KEY, total);
  }
  function savePedidoProgress(nextIndex, total, paused = false, notFound = null) {
    writeProgress(
      PEDIDO_PROGRESS_KEY,
      nextIndex,
      total,
      paused,
      notFound
    );
  }
  function resetPedidoProgress(total) {
    clearStoredProgress(PEDIDO_PROGRESS_KEY, total);
  }
  function clearPedidoProgress() {
    removeStorageData(PEDIDO_PROGRESS_KEY);
  }
  function loadPanelPosition() {
    try {
      const pos = getStorageData(POSITION_KEY, null);
      if (!pos) return null;
      if (!Number.isFinite(pos.left) || !Number.isFinite(pos.top)) {
        return null;
      }
      return pos;
    } catch (e) {
      return null;
    }
  }
  function savePanelPosition(panel) {
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    saveStorageData(
      POSITION_KEY,
      {
        left: Math.round(rect.left),
        top: Math.round(rect.top)
      }
    );
  }
  var progressListener = null;
  function setProgressListener(listener) {
    progressListener = listener;
  }
  function notifyProgressChanged() {
    if (progressListener) {
      progressListener();
    }
  }

  // src/clipboard.js
  function legacyCopy(text) {
    if (typeof document === "undefined")
      return false;
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    area.style.top = "0";
    document.body?.appendChild(area);
    area.focus?.();
    area.select?.();
    area.setSelectionRange?.(0, text.length);
    let copied = false;
    try {
      copied = document.execCommand?.("copy") === true;
    } catch (e) {
      copied = false;
    }
    area.remove?.();
    return copied;
  }
  async function writeClipboardText(text, allowEmpty = false) {
    const value = String(text || "");
    if (!value && !allowEmpty)
      return false;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch (e) {
      }
    }
    if (typeof GM_setClipboard === "function") {
      try {
        GM_setClipboard(value, "text");
        return true;
      } catch (e) {
      }
    }
    return legacyCopy(value);
  }
  async function replaceClipboardText(text) {
    await writeClipboardText("", true);
    return writeClipboardText(text);
  }
  async function readClipboardText(allowPrompt = true) {
    if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
      try {
        const text = await navigator.clipboard.readText();
        if (text)
          return text;
      } catch (e) {
      }
    }
    if (allowPrompt && typeof window !== "undefined" && typeof window.prompt === "function") {
      const text = window.prompt(
        "Cole aqui o JSON copiado do AppSheet:"
      );
      if (text)
        return text;
    }
    return "";
  }

  // src/panel.js
  function getPanel() {
    return document.getElementById(PANEL_ID);
  }
  var PANEL_HTML = `

        <div
            class="mc-panel-header"
            data-drag-handle="true"
        >

            <div class="mc-panel-title">
                ⚡ Automação Mais Controle
            </div>

            <div class="mc-panel-header-actions">

                <button
                    type="button"
                    class="mc-panel-minimize"
                    title="Minimizar"
                >
                    −
                </button>

            </div>

        </div>


        <div class="mc-panel-body">

            <div class="mc-panel-status">
                Status:
                <strong>Pronto</strong>
            </div>


            <div class="mc-panel-line">
                Itens:
                <strong class="mc-progress">
                    0 / 0
                </strong>
            </div>


            <div class="mc-panel-line">
                Atual:
                <strong class="mc-current">
                    -
                </strong>
            </div>


            <div class="mc-panel-line">
                Encontrados:
                <strong class="mc-found">
                    0
                </strong>
            </div>


            <div class="mc-panel-items"></div>


            <div class="mc-panel-notfound">
                Não encontrados:
                <strong>-</strong>
            </div>


            <div class="mc-panel-message">
                Pronto para iniciar.
            </div>


            <div class="mc-panel-log"></div>


            <div class="mc-panel-actions"></div>


            <div class="mc-panel-buttons">

                <button
                    type="button"
                    class="mc-btn mc-play"
                >
                    ▶️ PLAY
                </button>


                <button
                    type="button"
                    class="mc-btn mc-pause"
                >
                    ⏸️ PAUSAR
                </button>


                <button
                    type="button"
                    class="mc-btn mc-cancel"
                >
                    ⛔ CANCELAR
                </button>


                <button
                    type="button"
                    class="mc-btn mc-restart"
                >
                    🔄 REINICIAR
                </button>

            </div>

        </div>
    `;
  var PANEL_ACTIONS = [
    {
      selector: ".mc-paste-panel",
      className: "mc-paste-panel",
      text: "📥 CARREGAR / COLAR INSUMOS",
      title: "Carregar os insumos copiados do AppSheet via Área de Transferência"
    },
    {
      selector: ".mc-copy-panel",
      className: "mc-copy-panel",
      text: "📋 COPIAR INSUMOS DO APPSHEET",
      title: "Copiar os insumos exibidos no AppSheet"
    },
    {
      selector: ".mc-copy-pedido",
      className: "mc-copy-pedido",
      text: "📋 COPIAR INSUMOS DO PEDIDO",
      title: "Copiar os itens da solicitação/pedido atual"
    },
    {
      selector: ".mc-pedido-panel",
      className: "mc-pedido-panel",
      text: "⚡ ADICIONAR ITENS NO PEDIDO",
      title: "Abrir a modal, buscar e marcar os itens do pedido"
    },
    {
      selector: ".mc-fill-panel",
      className: "mc-fill-panel",
      text: "⚡ PREENCHER QUANTIDADES",
      title: "Preencher as quantidades copiadas na Transferência"
    }
  ];
  function ensurePanelActions(panel) {
    let container = panel.querySelector(".mc-panel-actions");
    if (!container) {
      container = document.createElement("div");
      container.className = "mc-panel-actions";
      panel.appendChild(container);
    }
    for (const action of PANEL_ACTIONS) {
      if (panel.querySelector(action.selector))
        continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `mc-btn ${action.className}`;
      button.textContent = action.text;
      button.title = action.title;
      button.hidden = true;
      container.appendChild(button);
    }
    return container;
  }
  function createPanel(force = false) {
    if (!appState.extensionEnabled && !force) return null;
    let panel = getPanel();
    if (panel) {
      ensurePanelActions(panel);
      updatePanel();
      return panel;
    }
    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = UI_CLASS;
    panel.innerHTML = PANEL_HTML;
    ensurePanelActions(panel);
    document.body.appendChild(panel);
    const position = loadPanelPosition();
    if (position) {
      const maxLeft = Math.max(
        5,
        window.innerWidth - 30
      );
      const maxTop = Math.max(
        5,
        window.innerHeight - 60
      );
      panel.style.left = `${Math.min(
        Math.max(5, position.left),
        maxLeft
      )}px`;
      panel.style.top = `${Math.min(
        Math.max(5, position.top),
        maxTop
      )}px`;
      panel.style.right = "auto";
    }
    setupPanelEvents(panel);
    updatePanel();
    return panel;
  }
  function copyFromAppSheet() {
    if (typeof controls.copyAppSheet === "function") {
      controls.copyAppSheet();
      return;
    }
    setPanelMessage(
      "A cópia do AppSheet não está disponível nesta tela."
    );
  }
  function readSharedPayloadFallback() {
    const raw = getStorageData(STORAGE_KEY, null);
    if (!raw)
      return null;
    const direct = parseClipboardPayload(raw);
    if (direct)
      return direct;
    const items = getItemsFromStorage();
    const metadata = getMetadataFromStorage();
    if (!Object.keys(items).length)
      return null;
    return {
      source: CLIPBOARD_SOURCE,
      timestamp: Date.now(),
      metadata,
      items
    };
  }
  async function pasteInsumosFromClipboard() {
    const text = await readClipboardText();
    let payload = parseClipboardPayload(text);
    let origin = "Clipboard";
    if (!payload && !text) {
      payload = readSharedPayloadFallback();
      if (payload)
        origin = "memória compartilhada";
    }
    if (!payload) {
      const message = "Nenhum dado válido do AppSheet encontrado na Área de Transferência.";
      addLog(`⚠️ ${message}`);
      setPanelMessage(message);
      showToast(message, "warning");
      updatePanel();
      return false;
    }
    const count = saveClipboardPayload(payload);
    if (!count) {
      const message = "O conteúdo colado não possui insumos válidos.";
      addLog(`⚠️ ${message}`);
      setPanelMessage(message);
      showToast(message, "warning");
      updatePanel();
      return false;
    }
    appState.copySummary = null;
    controls.sortTables?.(true);
    addLog(
      origin === "Clipboard" ? "✅ Insumos colados e carregados com sucesso do Clipboard!" : `✅ ${count} insumos recuperados da memória compartilhada!`
    );
    setPanelMessage(
      `✅ ${count} insumos carregados. Vá para a Transferência e clique PLAY.`
    );
    showToast(
      `${count} insumos carregados do ${origin}.`,
      "success"
    );
    updatePanel();
    return true;
  }
  var autoClipboardCheck = false;
  async function autoPasteFromClipboard() {
    if (autoClipboardCheck || isAppSheetHost())
      return;
    if (!getPanel())
      return;
    if (getCodesFromStorage().length)
      return;
    autoClipboardCheck = true;
    try {
      const text = await readClipboardText(false);
      const payload = parseClipboardPayload(text);
      if (!payload)
        return;
      const count = saveClipboardPayload(payload);
      if (!count)
        return;
      appState.copySummary = null;
      controls.sortTables?.(true);
      addLog(
        "✅ Insumos carregados automaticamente do Clipboard!"
      );
      setPanelMessage(
        `✅ ${count} insumos carregados do Clipboard. Vá para a Transferência e clique PLAY.`
      );
      updatePanel();
    } finally {
      autoClipboardCheck = false;
    }
  }
  function handlePanelPlay() {
    if (isAppSheetHost()) {
      copyFromAppSheet();
      return;
    }
    controls.play?.();
  }
  function setupPanelEvents(panel) {
    const minimize = panel.querySelector(
      ".mc-panel-minimize"
    );
    const play = panel.querySelector(".mc-play");
    const pause = panel.querySelector(".mc-pause");
    const cancel = panel.querySelector(".mc-cancel");
    const restart = panel.querySelector(".mc-restart");
    const pastePanel = panel.querySelector(".mc-paste-panel");
    const copyPanel = panel.querySelector(".mc-copy-panel");
    const copyPedido = panel.querySelector(".mc-copy-pedido");
    const addPedido = panel.querySelector(".mc-pedido-panel");
    const fillPanel = panel.querySelector(".mc-fill-panel");
    pastePanel?.addEventListener(
      "click",
      () => pasteInsumosFromClipboard()
    );
    copyPanel?.addEventListener(
      "click",
      copyFromAppSheet
    );
    copyPedido?.addEventListener(
      "click",
      () => controls.copyPedido?.()
    );
    addPedido?.addEventListener(
      "click",
      () => controls.play?.()
    );
    fillPanel?.addEventListener(
      "click",
      () => controls.fillTransfer?.()
    );
    minimize?.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        setPanelCollapsed(
          panel,
          true
        );
      }
    );
    play?.addEventListener(
      "click",
      handlePanelPlay
    );
    pause?.addEventListener(
      "click",
      () => controls.pause?.()
    );
    cancel?.addEventListener(
      "click",
      () => controls.cancel?.()
    );
    restart?.addEventListener(
      "click",
      () => controls.restart?.()
    );
    makeDraggable(
      panel,
      panel.querySelector(
        ".mc-panel-header"
      )
    );
  }
  function setPanelCollapsed(panel, collapsed) {
    if (!panel) return;
    panel.classList.toggle(
      "mc-collapsed",
      collapsed
    );
    if (!collapsed) return;
    panel.innerHTML = `

        <div
            class="mc-collapsed-bar"
            title="Abrir painel"
        >

            <span>
                ⚡ MC
            </span>

            <button
                type="button"
                class="mc-panel-open"
            >
                ＋
            </button>

        </div>
    `;
    panel.querySelector(".mc-panel-open").addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        recreateExpandedPanel(
          panel
        );
      }
    );
    makeDraggable(
      panel,
      panel.querySelector(
        ".mc-collapsed-bar"
      )
    );
  }
  function recreateExpandedPanel(panel) {
    const rect = panel.getBoundingClientRect();
    panel.classList.remove(
      "mc-collapsed"
    );
    panel.innerHTML = PANEL_HTML;
    ensurePanelActions(panel);
    panel.style.left = `${Math.max(5, rect.left)}px`;
    panel.style.top = `${Math.max(5, rect.top)}px`;
    panel.style.right = "auto";
    setupPanelEvents(panel);
    updatePanel();
  }
  function makeDraggable(element, handle) {
    if (!element || !handle) return;
    if (handle.dataset.dragReady === "true") {
      return;
    }
    handle.dataset.dragReady = "true";
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    handle.addEventListener(
      "pointerdown",
      (e) => {
        if (e.target.closest("button")) {
          return;
        }
        const rect = element.getBoundingClientRect();
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = rect.left;
        startTop = rect.top;
        element.style.left = `${startLeft}px`;
        element.style.top = `${startTop}px`;
        element.style.right = "auto";
        element.style.bottom = "auto";
        handle.setPointerCapture?.(
          e.pointerId
        );
        e.preventDefault();
      }
    );
    handle.addEventListener(
      "pointermove",
      (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const width = element.offsetWidth;
        const height = element.offsetHeight;
        const left = Math.min(
          Math.max(
            5,
            startLeft + dx
          ),
          Math.max(
            5,
            window.innerWidth - width - 5
          )
        );
        const top = Math.min(
          Math.max(
            5,
            startTop + dy
          ),
          Math.max(
            5,
            window.innerHeight - height - 5
          )
        );
        element.style.left = `${left}px`;
        element.style.top = `${top}px`;
      }
    );
    const stop = () => {
      if (!dragging) return;
      dragging = false;
      savePanelPosition(
        element
      );
    };
    handle.addEventListener(
      "pointerup",
      stop
    );
    handle.addEventListener(
      "pointercancel",
      stop
    );
  }
  function addLog(message) {
    const panel = getPanel();
    if (!panel) return;
    const box = panel.querySelector(
      ".mc-panel-log"
    );
    if (!box) return;
    const line = document.createElement("div");
    line.textContent = `${(/* @__PURE__ */ new Date()).toLocaleTimeString(
      "pt-BR"
    )} - ${message}`;
    box.appendChild(line);
    while (box.children.length > 80) {
      box.removeChild(
        box.firstChild
      );
    }
    box.scrollTop = box.scrollHeight;
  }
  function setPanelMessage(message) {
    const panel = getPanel();
    const el = panel?.querySelector(
      ".mc-panel-message"
    );
    if (el) {
      el.textContent = message;
    }
  }
  function setPanelStatus(status) {
    const panel = getPanel();
    const el = panel?.querySelector(
      ".mc-panel-status"
    );
    if (el) {
      el.innerHTML = `Status: <strong>${status}</strong>`;
    }
  }
  function updatePanel() {
    const panel = getPanel();
    if (!panel) return;
    if (panel.classList.contains(
      "mc-collapsed"
    )) {
      return;
    }
    const codes = getCodesFromStorage();
    const total = codes.length;
    const progress = appState.activeFlow === "pedido" ? getPedidoProgress(total) : getProgress(total);
    const onAppSheet = isAppSheetHost();
    panel.classList.toggle(
      "mc-appsheet",
      onAppSheet
    );
    const onPedido = !onAppSheet && isPedidoPage();
    const onTransfer = !onAppSheet && isTransferenciaPage();
    const summary = onAppSheet ? appState.copySummary : null;
    const copiedNow = summary && summary.count > 0 ? summary.count : 0;
    const found = copiedNow || Math.max(
      0,
      progress.nextIndex - progress.notFound.length
    );
    const current = copiedNow || progress.nextIndex >= total ? "-" : codes[progress.nextIndex];
    const copies = [
      [".mc-paste-panel", !onAppSheet],
      [".mc-copy-panel", onAppSheet],
      [".mc-copy-pedido", onPedido],
      [".mc-pedido-panel", onPedido],
      [".mc-fill-panel", onTransfer]
    ];
    for (const [selector, visible] of copies) {
      const button = panel.querySelector(selector);
      if (button) {
        button.hidden = !visible;
      }
    }
    const actions = panel.querySelector(".mc-panel-actions");
    if (actions) {
      actions.hidden = !onAppSheet && !onPedido && !onTransfer;
    }
    const controlsVisibility = [
      [".mc-pause", !onAppSheet],
      [".mc-cancel", !onAppSheet],
      [".mc-restart", !onAppSheet]
    ];
    for (const [selector, visible] of controlsVisibility) {
      const button = panel.querySelector(selector);
      if (button) {
        button.hidden = !visible;
      }
    }
    const playButton = panel.querySelector(".mc-play");
    if (playButton) {
      playButton.textContent = onPedido ? "▶️ CONTINUAR PEDIDO" : onTransfer ? "▶️ BUSCAR E SELECIONAR" : "▶️ PLAY";
    }
    const progressEl = panel.querySelector(
      ".mc-progress"
    );
    const currentEl = panel.querySelector(
      ".mc-current"
    );
    const foundEl = panel.querySelector(
      ".mc-found"
    );
    const notFoundEl = panel.querySelector(
      ".mc-panel-notfound strong"
    );
    if (progressEl) {
      progressEl.textContent = `${copiedNow || progress.nextIndex} / ${total}`;
    }
    if (currentEl) {
      currentEl.textContent = current;
    }
    if (foundEl) {
      foundEl.textContent = String(found);
    }
    if (notFoundEl) {
      notFoundEl.textContent = !copiedNow && progress.notFound.length ? progress.notFound.join(", ") : "-";
    }
    const itemsEl = panel.querySelector(".mc-panel-items");
    if (itemsEl) {
      while (itemsEl.firstChild)
        itemsEl.removeChild(itemsEl.firstChild);
      const storedItems = getItemsFromStorage();
      const storedCodes = Object.keys(storedItems);
      if (!storedCodes.length) {
        itemsEl.textContent = "Nenhum insumo carregado.";
      } else {
        itemsEl.textContent = "";
        const title = document.createElement("div");
        title.className = "mc-panel-items-title";
        title.textContent = `Itens carregados (${storedCodes.length})`;
        itemsEl.appendChild(title);
        for (const code of storedCodes) {
          const line = document.createElement("div");
          line.textContent = `${code} × ${storedItems[code]?.quantity ?? ""}`;
          itemsEl.appendChild(line);
        }
      }
    }
    let status = "Pronto";
    if (appState.automationState === "running") {
      status = "Rodando";
    } else if (appState.automationState === "paused") {
      status = "Pausado";
    } else if (appState.automationState === "waitingAdd") {
      status = "Aguardando ADICIONAR";
    } else if (appState.automationState === "cancelled") {
      status = "Cancelado";
    } else if (appState.automationState === "completed") {
      status = "Concluído";
    }
    setPanelStatus(status);
  }
  function showToast(message, type = "info") {
    if (!appState.extensionEnabled) return;
    let toast = document.getElementById(
      "mc-automation-toast"
    );
    if (!toast) {
      toast = document.createElement(
        "div"
      );
      toast.id = "mc-automation-toast";
      toast.className = UI_CLASS;
      document.body.appendChild(
        toast
      );
    }
    toast.textContent = message;
    toast.dataset.type = type;
    toast.style.display = "block";
    clearTimeout(
      showToast.timer
    );
    showToast.timer = setTimeout(
      () => {
        toast.style.display = "none";
      },
      4e3
    );
  }
  function removeExtensionUI() {
    document.querySelectorAll(
      `.${UI_CLASS}`
    ).forEach(
      (el) => el.remove()
    );
  }
  function refreshPanelState() {
    updatePanel();
    autoPasteFromClipboard();
  }
  function setupStorageSync() {
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener(
        "focus",
        refreshPanelState
      );
    }
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener(
        "visibilitychange",
        () => {
          if (document.visibilityState === "visible")
            refreshPanelState();
        }
      );
    }
  }
  setupStorageSync();
  setProgressListener(updatePanel);

  // src/control.js
  async function controlledSleep(ms) {
    const step = 100;
    let elapsed = 0;
    while (elapsed < ms) {
      if (appState.stopRequested)
        return "cancel";
      if (appState.pauseRequested || appState.automationState === "paused") {
        return "pause";
      }
      await sleep(
        Math.min(
          step,
          ms - elapsed
        )
      );
      elapsed += step;
    }
    return "ok";
  }

  // src/erp.js
  async function waitForAdicionarInsumoModal(timeout = ERP.timeouts.modalOpen) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeout) {
      const st = await controlledSleep(200);
      if (st !== "ok")
        return st;
      if (isAdicionarInsumoPage() && getAdicionarInsumoSearchInput())
        return "ok";
    }
    if (isAdicionarInsumoPage() && getAdicionarInsumoSearchInput())
      return "ok";
    addLog("⚠️ Timeout aguardando abertura da modal de Adicionar Insumo.");
    return "fail";
  }
  async function waitForTransferenciaPage(timeout = ERP.timeouts.modalClose) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeout) {
      const st = await controlledSleep(250);
      if (st !== "ok")
        return st;
      if (isTransferenciaPage())
        return "ok";
    }
    if (isTransferenciaPage())
      return "ok";
    addLog("⚠️ Timeout aguardando retorno à tela de Transferência.");
    return "fail";
  }
  async function waitForEnabledAdicionarInsumoButton(timeout = ERP.timeouts.modalOpen) {
    const inicio = Date.now();
    let ultimoBotao = null;
    while (Date.now() - inicio < timeout) {
      const botao = getAdicionarInsumoButton();
      if (botao) {
        ultimoBotao = botao;
        if (isElementEnabled(botao))
          return botao;
      }
      const st = await controlledSleep(200);
      if (st !== "ok")
        return st;
    }
    if (ultimoBotao && isElementEnabled(ultimoBotao))
      return ultimoBotao;
    return null;
  }
  async function openAdicionarInsumoModal() {
    if (isAdicionarInsumoPage()) {
      const input = getAdicionarInsumoSearchInput();
      if (input)
        return "ok";
      return await waitForAdicionarInsumoModal();
    }
    const inicio = Date.now();
    let tentativas = 0;
    while (Date.now() - inicio < ERP.timeouts.modalOpen) {
      if (isAdicionarInsumoPage() && getAdicionarInsumoSearchInput())
        return "ok";
      const restante = ERP.timeouts.modalOpen - (Date.now() - inicio);
      const botao = await waitForEnabledAdicionarInsumoButton(restante);
      if (botao === "pause" || botao === "cancel")
        return botao;
      if (!botao)
        break;
      tentativas++;
      try {
        appState.suppressHooks = true;
        botao.click();
      } catch (e) {
        addLog("⚠️ Não foi possível clicar em ADICIONAR INSUMO.");
        return "fail";
      } finally {
        appState.suppressHooks = false;
      }
      addLog(
        `➕ Clicado em ADICIONAR INSUMO: abrindo a modal de busca (tentativa ${tentativas}).`
      );
      const espera = Math.max(
        1e3,
        Math.min(2500, ERP.timeouts.modalOpen - (Date.now() - inicio))
      );
      const opened = await waitForAdicionarInsumoModal(espera);
      if (opened !== "fail")
        return opened;
      addLog("⚠️ A modal de Adicionar Insumo não abriu. Tentando novamente...");
      const st = await controlledSleep(300);
      if (st !== "ok")
        return st;
      if (tentativas >= 3)
        break;
    }
    addLog("⚠️ Botão ADICIONAR INSUMO não encontrado ou indisponível na tela de Transferência.");
    return "fail";
  }
  async function commitBatch() {
    if (!isAdicionarInsumoPage()) {
      addLog("⚠️ A modal de Adicionar Insumo não está aberta para confirmar o lote.");
      return "fail";
    }
    const botao = getAdicionarButton();
    if (!botao) {
      addLog("⚠️ Botão ADICIONAR (X) não encontrado para confirmar o lote.");
      return "fail";
    }
    const rotulo = cleanText(botao.innerText || botao.textContent || botao.value || "");
    addLog(`✅ Confirmando lote: ${rotulo || "ADICIONAR"}.`);
    try {
      appState.suppressHooks = true;
      botao.click();
    } catch (e) {
      appState.suppressHooks = false;
      addLog("⚠️ Não foi possível clicar no botão ADICIONAR para confirmar o lote.");
      return "fail";
    }
    appState.suppressHooks = false;
    return await waitForTransferenciaPage();
  }
  async function fillReactInput(inputEl, value) {
    if (!inputEl)
      return false;
    inputEl.focus();
    try {
      inputEl.select();
    } catch (e) {
    }
    document.execCommand(
      "delete"
    );
    const texto = String(value ?? "");
    for (const char of texto) {
      document.execCommand(
        "insertText",
        false,
        char
      );
      await sleep(20);
    }
    inputEl.dispatchEvent(
      new Event(
        "input",
        {
          bubbles: true,
          cancelable: true
        }
      )
    );
    inputEl.dispatchEvent(
      new Event(
        "change",
        {
          bubbles: true,
          cancelable: true
        }
      )
    );
    return true;
  }
  function pressEnter(inputEl) {
    if (!inputEl)
      return;
    inputEl.focus();
    [
      "keydown",
      "keypress",
      "keyup"
    ].forEach((type) => {
      inputEl.dispatchEvent(
        new KeyboardEvent(
          type,
          {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
            view: window
          }
        )
      );
    });
  }
  async function searchMaterial(code) {
    const input = getAdicionarInsumoSearchInput();
    if (!input) {
      log(
        "Campo de busca não encontrado."
      );
      return false;
    }
    const searchNumber = getSearchNumber(code);
    const hint = getSearchInputHint(input);
    addLog(
      `🔎 ${code} → ${searchNumber}${hint ? ` (campo: ${hint})` : ""}`
    );
    const filled = await fillReactInput(
      input,
      searchNumber
    );
    if (!filled)
      return false;
    let state = await controlledSleep(100);
    if (state !== "ok") {
      return state;
    }
    pressEnter(input);
    state = await controlledSleep(
      2500
    );
    return state === "ok" ? true : state;
  }
  function findMaterialRow(code) {
    const targetCode = normalizeMatCode(code);
    if (!targetCode)
      return null;
    const scopes = [];
    const modal = getAdicionarInsumoModal();
    if (modal)
      scopes.push(modal);
    scopes.push(document);
    for (const scope of scopes) {
      const rows = Array.from(
        scope.querySelectorAll(
          'table tr, [role="row"]'
        )
      ).filter(
        (row) => row.children.length > 1
      );
      for (const row of rows) {
        const rowText = row.innerText || "";
        const rowCode = extractMatCode(
          rowText
        );
        if (rowCode && rowCode === targetCode) {
          return row;
        }
      }
    }
    return null;
  }
  async function waitForMaterialRow(code, timeout = ERP.timeouts.materialRow) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeout) {
      if (appState.stopRequested)
        return "cancel";
      if (appState.pauseRequested || appState.automationState === "paused") {
        return "pause";
      }
      const row = findMaterialRow(code);
      if (row)
        return row;
      await sleep(300);
    }
    return null;
  }
  function selectMaterialRow(row, code) {
    if (!row)
      return false;
    const checkbox = row.querySelector(
      'input[type="checkbox"], [role="checkbox"], .MuiCheckbox-root input'
    );
    if (!checkbox) {
      log(
        `${code}: linha encontrada, mas sem checkbox.`
      );
      return false;
    }
    const isChecked = () => {
      if (typeof checkbox.checked === "boolean")
        return checkbox.checked;
      return checkbox.getAttribute?.("aria-checked") === "true";
    };
    if (!isChecked()) {
      checkbox.click();
      try {
        checkbox.dispatchEvent(
          new Event(
            "change",
            {
              bubbles: true
            }
          )
        );
      } catch (e) {
      }
    }
    return true;
  }
  async function clearSearch() {
    const input = getAdicionarInsumoSearchInput();
    if (!input)
      return false;
    const result = await fillReactInput(
      input,
      ""
    );
    if (!result)
      return false;
    return await controlledSleep(
      250
    );
  }
  function hookAdicionarButton() {
    const botao = getAdicionarButton();
    if (!botao)
      return;
    if (botao.dataset.mcContinueHook === "true") {
      return;
    }
    botao.dataset.mcContinueHook = "true";
    botao.addEventListener(
      "click",
      () => {
        if (!appState.extensionEnabled)
          return;
        if (appState.suppressHooks)
          return;
        if (appState.automationState === "running")
          return;
        const codes = getCodesFromStorage();
        const progress = getProgress(
          codes.length
        );
        if (progress.nextIndex < codes.length) {
          appState.automationState = "waitingAdd";
          setPanelMessage(
            `ADICIONAR foi clicado. Quando terminar, clique PLAY para continuar no item ${progress.nextIndex + 1}.`
          );
          addLog(
            "🟢 Botão ADICIONAR do ERP clicado."
          );
          updatePanel();
        }
      },
      true
    );
  }

  // src/copiar.js
  function getSortedItemCodes(items) {
    return Object.keys(items || {}).sort(
      (a, b) => a.localeCompare(b, "pt-BR", {
        sensitivity: "base",
        numeric: true
      })
    );
  }
  function saveExtractedItems(items, metadata) {
    const codes = getSortedItemCodes(items);
    if (!codes.length)
      return 0;
    const payload = {};
    for (const code of codes) {
      const item = items[code] || {};
      payload[code] = {
        code: item.code || code,
        quantity: String(item.quantity ?? "")
      };
    }
    saveCopiedItems(payload, metadata);
    resetProgress(codes.length);
    resetPedidoProgress(codes.length);
    appState.automationState = "idle";
    appState.stopRequested = false;
    appState.pauseRequested = false;
    return codes.length;
  }
  function buildClipboardPayload(items, metadata) {
    const sortedItems = {};
    getSortedItemCodes(items).forEach((code) => {
      sortedItems[code] = items[code];
    });
    return {
      source: CLIPBOARD_SOURCE,
      timestamp: Date.now(),
      metadata: {
        orderNumber: String(metadata?.orderNumber ?? "").trim(),
        description: String(metadata?.description ?? "").trim()
      },
      items: sortedItems
    };
  }
  function serializeClipboardPayload(items, metadata) {
    return JSON.stringify(
      buildClipboardPayload(items, metadata)
    );
  }
  function notifyCopied(count, metadata, source) {
    const order = metadata?.orderNumber ? ` ${metadata.orderNumber}` : "";
    const fromAppSheet = String(source).toLowerCase() === "appsheet";
    addLog(
      fromAppSheet ? `✅ ${count} insumos copiados com sucesso do AppSheet!` : `📋 ${count} insumos copiados${order} (${source}).`
    );
    setPanelMessage(
      fromAppSheet ? `${count} insumos copiados com sucesso do AppSheet!` : `${count} insumos copiados${order}. Vá para a Transferência no Mais Controle e clique PLAY.`
    );
    updatePanel();
    showToast(
      `${count} insumos copiados do ${source}. Vá para a Transferência no Mais Controle.`,
      "success"
    );
  }

  // src/tables.js
  function getRelevantTables() {
    return Array.from(
      document.querySelectorAll(
        "table"
      )
    ).filter(
      (table) => {
        const text = cleanText(
          table.innerText
        );
        return /MAT\s*[-_]?\s*\d+/i.test(text);
      }
    );
  }
  function hasIndexHeader(table) {
    return Array.from(
      table.querySelectorAll(
        "thead th, tr:first-child th"
      )
    ).some(
      (th) => cleanText(
        th.innerText
      ).toLowerCase() === "índice"
    );
  }
  function ensureIndexColumn(table) {
    const headerRow = table.querySelector(
      "thead tr"
    ) || table.querySelector(
      "tr"
    );
    if (!headerRow)
      return;
    const existingIndex = headerRow.querySelector(
      ".mc-index-header"
    );
    const alreadyNative = hasIndexHeader(
      table
    );
    if (!alreadyNative && !existingIndex) {
      const th = document.createElement(
        "th"
      );
      th.textContent = "Índice";
      th.className = "mc-index-header mc-index-cell";
      th.dataset.mcGenerated = "true";
      headerRow.insertBefore(
        th,
        headerRow.firstElementChild
      );
      const bodyRows = Array.from(
        table.querySelectorAll(
          "tbody tr"
        )
      );
      bodyRows.forEach(
        (row) => {
          const td = document.createElement(
            "td"
          );
          td.className = `mc-index-cell ${UI_CLASS}`;
          td.dataset.mcGenerated = "true";
          row.insertBefore(
            td,
            row.firstElementChild
          );
        }
      );
    }
    reindexTable(table);
  }
  function getBodyRows(table) {
    let rows = Array.from(
      table.querySelectorAll(
        "tbody tr"
      )
    );
    if (!rows.length) {
      rows = Array.from(
        table.querySelectorAll(
          "tr"
        )
      ).slice(1);
    }
    return rows.filter(
      (row) => {
        const text = cleanText(
          row.innerText
        );
        return /MAT\s*[-_]?\s*\d+/i.test(text);
      }
    );
  }
  function getIndexCell(row) {
    const cells = Array.from(
      row.children
    );
    return cells.find(
      (cell) => cell.classList.contains(
        "mc-index-cell"
      )
    ) || null;
  }
  function reindexTable(table) {
    const rows = getBodyRows(table);
    if (!rows.length)
      return;
    rows.forEach(
      (row, index) => {
        let cell = getIndexCell(
          row
        );
        if (!cell) {
          const first = row.firstElementChild;
          if (first && !extractMatCode(
            first.innerText
          )) {
            const firstText = cleanText(
              first.innerText
            );
            if (/^\d+$/.test(
              firstText
            )) {
              cell = first;
              cell.classList.add(
                "mc-index-cell"
              );
            }
          }
        }
        if (cell) {
          cell.textContent = String(
            index + 1
          );
          cell.classList.add(
            "mc-index-cell"
          );
        }
      }
    );
  }
  function getNameForRow(row) {
    const text = cleanText(
      row.innerText
    );
    const codeMatch = text.match(
      /\bMAT\s*[-_]?\s*\d+\b/i
    );
    if (!codeMatch)
      return text.toLowerCase();
    const afterCode = text.slice(
      codeMatch.index + codeMatch[0].length
    ).replace(
      /^\s*[-–—:]?\s*/,
      ""
    ).trim();
    return afterCode.toLowerCase();
  }
  function sortTable(table, ascending = true) {
    const tbody = table.querySelector(
      "tbody"
    );
    if (!tbody)
      return;
    const rows = getBodyRows(
      table
    );
    if (rows.length < 2) {
      return;
    }
    rows.sort(
      (a, b) => {
        const nameA = getNameForRow(a);
        const nameB = getNameForRow(b);
        return ascending ? nameA.localeCompare(
          nameB,
          "pt-BR",
          {
            sensitivity: "base"
          }
        ) : nameB.localeCompare(
          nameA,
          "pt-BR",
          {
            sensitivity: "base"
          }
        );
      }
    );
    rows.forEach(
      (row) => tbody.appendChild(
        row
      )
    );
    reindexTable(
      table
    );
  }
  function addSortButton(table) {
    if (!appState.extensionEnabled) {
      return;
    }
    if (table.dataset.mcSortButtonAdded === "true") {
      return;
    }
    ensureIndexColumn(
      table
    );
    const wrapper = document.createElement(
      "div"
    );
    wrapper.className = UI_CLASS;
    wrapper.style.display = "flex";
    wrapper.style.justifyContent = "flex-end";
    wrapper.style.marginBottom = "4px";
    const button = document.createElement(
      "button"
    );
    button.type = "button";
    button.className = `mc-sort-button ${UI_CLASS}`;
    button.textContent = "⇅ Ordenar por Nome (A-Z)";
    let ascending = true;
    button.addEventListener(
      "click",
      () => {
        sortTable(
          table,
          ascending
        );
        button.textContent = ascending ? "⇅ Ordenar por Nome (Z-A)" : "⇅ Ordenar por Nome (A-Z)";
        ascending = !ascending;
      }
    );
    wrapper.appendChild(
      button
    );
    table.parentElement?.insertBefore(
      wrapper,
      table
    );
    table.dataset.mcSortButtonAdded = "true";
  }
  function sortRelevantTables(ascending = true) {
    const tables = getRelevantTables();
    const direction = ascending !== false;
    tables.forEach(
      (table) => {
        ensureIndexColumn(
          table
        );
        sortTable(
          table,
          direction
        );
      }
    );
    appState.sortAscending = direction;
    return tables.length;
  }
  function setupSortingAndIndexes() {
    if (!appState.extensionEnabled) {
      return;
    }
    getRelevantTables().forEach(
      (table) => {
        ensureIndexColumn(
          table
        );
        addSortButton(
          table
        );
      }
    );
  }
  registerControls({
    sortTables: sortRelevantTables
  });

  // src/pedido.js
  function extractOrderMetadata() {
    let body = "";
    if (document.body) {
      body = document.body.innerText || "";
    }
    const title = document.title || body || "";
    let orderNumber = "";
    const match = title.match(/solicita(?:ç|c)[ãa]o\s*#\s*(\d+)/i) || body.match(/solicita(?:ç|c)[ãa]o\s*#\s*(\d+)/i) || body.match(/pedido\s*#\s*(\d+)/i) || body.match(/#\s*(\d+)/);
    if (match && match[1]) {
      orderNumber = `#${match[1]}`;
    }
    let description = extractDescription(title, body);
    return { orderNumber, description };
  }
  function extractDescription(title, body) {
    const labels = Array.from(document.querySelectorAll("label, th, legend, span, div, p"));
    const candidates = labels.map((el) => ({ el, text: cleanText(el.innerText || el.textContent || "") })).filter((x) => /^descri(?:ç|c)[ãa]o$/i.test(x.text)).sort((a, b) => a.text.length - b.textLength);
    for (const { el } of candidates) {
      const value = readValueFromLabel(el);
      if (value) return value;
    }
    const m = body.match(/descri(?:ç|c)[ãa]o\s*[:\-]?\s*(.+?)(?:\n|\r|$)/i) || title.match(/descri(?:ç|c)[ãa]o\s*[:\-]?\s*(.+?)(?:\n|\r|$)/i);
    return m ? cleanText(m[1]) : "";
  }
  function readValueFromLabel(label) {
    if (label.control) {
      const v = String(label.control.value ?? "").trim();
      if (v) return cleanText(v);
    }
    const scoped = label.querySelector("input, textarea") || label.parentElement?.querySelector("input, textarea");
    if (scoped) {
      const v = String(scoped.value ?? "").trim();
      if (v) return cleanText(v);
    }
    const next = label.nextElementSibling;
    if (next) {
      const v = String(next.value ?? "").trim();
      if (v) return cleanText(v);
      const inner = cleanText(next.innerText || next.textContent || "");
      if (inner && !/^descri(?:ç|c)[ãa]o$/i.test(inner)) return inner;
    }
    const parent = label.parentElement;
    if (parent) {
      const inner = cleanText(parent.innerText || parent.textContent || "").replace(/descri(?:ç|c)[ãa]o/i, "").trim();
      if (inner && inner.length > 2) return inner;
    }
    return "";
  }
  function getHeaderIndex(table) {
    const headers = Array.from(
      table.querySelectorAll(
        "thead th, tr:first-child th"
      )
    ).map(
      (th) => cleanText(
        th.innerText
      ).toLowerCase()
    );
    const find = (...terms) => headers.findIndex(
      (h) => terms.some(
        (t) => h.includes(t)
      )
    );
    return {
      item: find(
        "item",
        "material",
        "descrição",
        "descricao"
      ),
      quantity: find(
        "qtde solicitada",
        "quantidade solicitada",
        "qtde"
      ),
      unit: find(
        "unid",
        "unidade"
      )
    };
  }
  function extractPedidoItems() {
    const tables = getRelevantTables();
    const items = {};
    for (const table of tables) {
      const rows = Array.from(
        table.querySelectorAll(
          "tbody tr, tr"
        )
      ).filter(
        (row) => row.querySelectorAll(
          "td"
        ).length > 0
      );
      const indexes = getHeaderIndex(
        table
      );
      for (const row of rows) {
        const text = cleanText(
          row.innerText
        );
        const code = extractMatCode(
          text
        );
        if (!code)
          continue;
        const cells = Array.from(
          row.querySelectorAll(
            "td"
          )
        );
        let quantity = null;
        if (indexes.quantity >= 0 && cells[indexes.quantity]) {
          quantity = parseQuantity(
            cells[indexes.quantity].innerText
          );
        }
        if (quantity == null) {
          for (const cell of cells) {
            const cellText = cleanText(
              cell.innerText
            );
            if (/^\d+(?:[.,]\d+)?$/.test(
              cellText
            )) {
              quantity = parseQuantity(
                cellText
              );
              if (quantity != null) {
                break;
              }
            }
          }
        }
        if (quantity == null) {
          continue;
        }
        items[code] = {
          code,
          quantity,
          name: text
        };
      }
    }
    return items;
  }
  function copyPedidoInsumos() {
    if (isAppSheetHost() || !isPedidoPage()) {
      setPanelMessage(
        "Abra a tela do Pedido/Solicitação para copiar os insumos."
      );
      return false;
    }
    clearCopiedData();
    appState.copySummary = null;
    const items = extractPedidoItems();
    const metadata = extractOrderMetadata();
    const count = saveExtractedItems(
      items,
      metadata
    );
    if (!count) {
      setPanelMessage(
        "Nenhum MAT + quantidade foi encontrado nesta página."
      );
      showToast(
        "Nenhum insumo encontrado na solicitação.",
        "warning"
      );
      return false;
    }
    notifyCopied(
      count,
      metadata,
      "pedido"
    );
    return true;
  }
  registerControls({
    copyPedido: copyPedidoInsumos
  });

  // src/pedido_automation.js
  var KEYWORD_SELECTOR = 'input#keyword, input[name="keyword"], search-field input, .search-field input, input[type="search"], input[placeholder*="Buscar"], input[placeholder*="buscar"], input[placeholder*="insumo"]';
  var CLICKABLE_SELECTOR = 'button, a, [role="button"], input[type="button"], input[type="submit"]';
  var MODAL_SELECTOR2 = ERP.modalSelectors.join(", ");
  var ADD_ITEM_PATTERN = /(?:adicionar|incluir|novo|nova)\s+(?:it(?:em|ens)|insumos?|produtos?|materiais|material)\b/i;
  var CONFIRM_PATTERN = /^(?:incluir|adicionar|confirmar|salvar|finalizar|ok)\b/i;
  function normalizeText(text) {
    return cleanText(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  function elementText(el) {
    return normalizeText(
      el?.innerText || el?.textContent || el?.value || ""
    ).replace(/^[^a-z0-9]+/, "");
  }
  function isOwnUI(el) {
    try {
      if (el.classList?.contains?.(UI_CLASS))
        return true;
      return !!el.closest?.(`.${UI_CLASS}`);
    } catch (e) {
      return false;
    }
  }
  function isReallyVisible2(el) {
    if (!isElementVisible(el))
      return false;
    let node = el;
    let depth = 0;
    while (node && node !== document.body && depth < 25) {
      if (node.hidden)
        return false;
      if (node.getAttribute?.("aria-hidden") === "true")
        return false;
      const style = window.getComputedStyle?.(node);
      if (style) {
        if (style.display === "none")
          return false;
        if (style.visibility === "hidden" || style.visibility === "collapse")
          return false;
        if (style.opacity === "0")
          return false;
      }
      node = node.parentElement;
      depth++;
    }
    return true;
  }
  function isDisabledLike(el) {
    if (!el)
      return true;
    if (el.disabled)
      return true;
    if (el.getAttribute?.("disabled") !== null)
      return true;
    if (el.getAttribute?.("aria-disabled") === "true")
      return true;
    if (el.classList?.contains?.("Mui-disabled"))
      return true;
    return false;
  }
  function getVisibleClickables() {
    return Array.from(
      document.querySelectorAll(CLICKABLE_SELECTOR)
    ).filter(isReallyVisible2).filter((el) => !isOwnUI(el));
  }
  function getVisibleKeywordInputs() {
    const set = /* @__PURE__ */ new Set();
    const add = (el) => {
      if (!el)
        return;
      if (!isReallyVisible2(el))
        return;
      set.add(el);
    };
    Array.from(document.querySelectorAll(KEYWORD_SELECTOR)).forEach(add);
    Array.from(document.querySelectorAll("input")).forEach((input) => {
      const ph = String(input.getAttribute?.("placeholder") || "").toLowerCase();
      const ngModel = String(input.getAttribute?.("ng-model") || "").toLowerCase();
      if (ph.includes("buscar") || ph.includes("insumo") || ngModel.includes("keyword"))
        add(input);
    });
    return Array.from(set);
  }
  function findDialogAncestor(el) {
    let node = el?.parentElement;
    let found = null;
    let depth = 0;
    while (node && node !== document.body && depth < 12) {
      if (isDialogLike(node))
        found = node;
      node = node.parentElement;
      depth++;
    }
    return found;
  }
  function findConfirmCandidates() {
    return getVisibleClickables().filter((el) => {
      const text = elementText(el);
      return text && CONFIRM_PATTERN.test(text) && !ADD_ITEM_PATTERN.test(text);
    });
  }
  function isPedidoAutomationPage() {
    if (typeof document === "undefined")
      return false;
    if (isAppSheetHost())
      return false;
    if (isTransferenciaPage())
      return false;
    if (isAdicionarInsumoPage() && getAdicionarInsumoButton())
      return false;
    if (isPedidoPath())
      return true;
    if (isAdicionarInsumoPage())
      return false;
    return isPedidoPage();
  }
  function getPedidoModal() {
    const inputs = getVisibleKeywordInputs();
    if (!inputs.length)
      return null;
    for (const input of inputs) {
      const dialog = findDialogAncestor(input);
      if (dialog)
        return dialog;
    }
    const modalContainers = getModalContainers().filter(isReallyVisible2).filter(isDialogLike);
    for (const container of modalContainers) {
      if (container.querySelector("input") && (container.querySelector('table tr, [role="row"]') || container.querySelector('input[type="checkbox"]')))
        return container;
      if (container.querySelector(KEYWORD_SELECTOR))
        return container;
    }
    for (const input of inputs) {
      const dialog = findDialogAncestor(input);
      if (dialog)
        return dialog;
    }
    if (inputs.length >= 2) {
      const last = inputs[inputs.length - 1];
      return findDialogAncestor(last) || last.closest?.(MODAL_SELECTOR2) || last.closest?.('[role="dialog"], [aria-modal="true"]') || last;
    }
    const confirms = findConfirmCandidates();
    if (confirms.length) {
      let node = inputs[0].parentElement;
      let depth = 0;
      while (node && depth < 12) {
        if (confirms.some((btn) => node.contains?.(btn)))
          return node;
        node = node.parentElement;
        depth++;
      }
    }
    for (const input of inputs) {
      let node = input.parentElement;
      let depth = 0;
      while (node && depth < 15) {
        if (node.querySelector && node.querySelector('table tr, [role="row"]') && node.querySelector('input[type="checkbox"]'))
          return node;
        node = node.parentElement;
        depth++;
      }
    }
    return null;
  }
  function getPedidoSearchInput() {
    const modal = getPedidoModal();
    const inputs = getVisibleKeywordInputs();
    if (modal) {
      if (String(modal.tagName || "").toUpperCase() === "INPUT") {
        return modal;
      }
      const inside = inputs.filter(
        (input) => modal.contains?.(input)
      );
      if (inside.length)
        return inside[inside.length - 1];
      for (const input of inputs) {
        if (modal.contains?.(input))
          return input;
      }
      if (inputs.length)
        return inputs[inputs.length - 1];
      return null;
    }
    if (inputs.length === 1)
      return inputs[0];
    if (inputs.length >= 2)
      return inputs[inputs.length - 1];
    return inputs.length ? inputs[inputs.length - 1] : null;
  }
  function isPedidoModalReallyOpen() {
    const modal = getPedidoModal();
    if (!modal)
      return false;
    const input = getPedidoSearchInput();
    return !!input && isReallyVisible2(input);
  }
  function getPedidoAddItemButton() {
    const modal = isPedidoModalReallyOpen() ? getPedidoModal() : null;
    const candidates = getVisibleClickables().filter((el) => !modal || !modal.contains?.(el)).filter((el) => !isDisabledLike(el)).filter((el) => ADD_ITEM_PATTERN.test(elementText(el)));
    if (!candidates.length)
      return null;
    const exact = candidates.find((el) => {
      const text = elementText(el);
      return /^(?:adicionar|incluir)\s+(?:item|insumo)$/.test(text) || /^(?:adicionar|incluir)\s+(?:itens|insumos)$/.test(text);
    });
    if (exact)
      return exact;
    return candidates.sort(
      (a, b) => elementText(a).length - elementText(b).length
    )[0];
  }
  function getPedidoConfirmButton() {
    const modal = getPedidoModal();
    const all = getVisibleClickables().filter((el) => CONFIRM_PATTERN.test(elementText(el)));
    if (!all.length)
      return null;
    if (modal) {
      const inside = all.filter(
        (button) => modal.contains?.(button)
      );
      if (!inside.length)
        return null;
      const preferred = inside.filter(
        (button) => !ADD_ITEM_PATTERN.test(elementText(button))
      );
      const list = preferred.length ? preferred : inside;
      return list[list.length - 1];
    }
    const confirms = all.filter(
      (button) => !ADD_ITEM_PATTERN.test(elementText(button))
    );
    return confirms.length ? confirms[confirms.length - 1] : null;
  }
  async function waitForPedidoModal(timeout = ERP.timeouts.modalOpen) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeout) {
      const state = await controlledSleep(200);
      if (state !== "ok")
        return state;
      if (isPedidoModalReallyOpen())
        return "ok";
    }
    if (isPedidoModalReallyOpen())
      return "ok";
    addLog("⚠️ Timeout aguardando a modal de Adicionar item do Pedido.");
    return "fail";
  }
  async function waitForPedidoModalClose(timeout = ERP.timeouts.modalClose) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeout) {
      const state = await controlledSleep(250);
      if (state !== "ok")
        return state;
      if (!isPedidoModalReallyOpen())
        return "ok";
    }
    if (!isPedidoModalReallyOpen())
      return "ok";
    addLog("⚠️ Timeout aguardando o fechamento da modal de Adicionar item.");
    return "fail";
  }
  async function openPedidoItemModal() {
    if (isPedidoModalReallyOpen())
      return "ok";
    const maxAttempts = 6;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (appState.stopRequested)
        return "cancel";
      if (appState.pauseRequested || appState.automationState === "paused") {
        return "pause";
      }
      if (isPedidoModalReallyOpen())
        return "ok";
      const button = getPedidoAddItemButton();
      if (!button) {
        addLog(`⚠️ Botão "Adicionar item" não encontrado na tela de Pedido (tentativa ${attempt}/${maxAttempts}).`);
      } else {
        try {
          appState.suppressHooks = true;
          button.click();
        } catch (e) {
          addLog('⚠️ Não foi possível clicar em "Adicionar item".');
        } finally {
          appState.suppressHooks = false;
        }
        addLog('➕ Clicado em "Adicionar item": abrindo a modal de busca.');
        const opened = await waitForPedidoModal(
          attempt === 1 ? ERP.timeouts.modalOpen : 2500
        );
        if (opened === "pause")
          return "pause";
        if (opened === "cancel")
          return "cancel";
        if (isPedidoModalReallyOpen())
          return "ok";
      }
      const settle = await controlledSleep(
        600 * attempt
      );
      if (settle !== "ok")
        return settle;
    }
    addLog("⚠️ Não foi possível abrir a modal de Adicionar item do Pedido.");
    return "fail";
  }
  function findPedidoMaterialRow(code) {
    const target = normalizeMatCode(code);
    if (!target)
      return null;
    const modal = getPedidoModal();
    const scopes = [];
    if (modal)
      scopes.push(modal);
    else
      scopes.push(document);
    for (const scope of scopes) {
      const rows = Array.from(
        scope.querySelectorAll(
          'table tr, [role="row"]'
        )
      ).filter((row) => row.children.length > 1);
      for (const row of rows) {
        const rowCode = extractMatCode(row.innerText || "");
        if (rowCode === target)
          return row;
      }
    }
    return null;
  }
  async function waitForPedidoMaterialRow(code, timeout = ERP.timeouts.materialRow) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeout) {
      if (appState.stopRequested)
        return "cancel";
      if (appState.pauseRequested || appState.automationState === "paused") {
        return "pause";
      }
      const row = findPedidoMaterialRow(code);
      if (row)
        return row;
      await sleep(300);
    }
    return null;
  }
  async function searchPedidoMaterial(code) {
    let input = getPedidoSearchInput();
    if (!input) {
      const inputs = getVisibleKeywordInputs();
      if (inputs.length)
        input = inputs[inputs.length - 1];
    }
    if (!input) {
      addLog("⚠️ Campo de busca da modal de Pedido não encontrado.");
      return false;
    }
    const searchNumber = getSearchNumber(code);
    addLog(`🔎 Pedido: ${code} → ${searchNumber}`);
    try {
      input.scrollIntoView?.({ block: "center" });
    } catch (e) {
    }
    try {
      input.focus?.();
    } catch (e) {
    }
    try {
      input.click?.();
    } catch (e) {
    }
    const filled = await fillReactInput(input, searchNumber);
    if (!filled)
      return false;
    try {
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) {
    }
    let state = await controlledSleep(200);
    if (state !== "ok")
      return state;
    try {
      pressEnter(input);
    } catch (e) {
    }
    state = await controlledSleep(3e3);
    return state === "ok" ? true : state;
  }
  async function clearPedidoSearch() {
    const input = getPedidoSearchInput();
    if (!input)
      return false;
    const filled = await fillReactInput(input, "");
    if (!filled)
      return false;
    return await controlledSleep(250);
  }
  function selectPedidoRow(row, code) {
    if (!row)
      return false;
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (!checkbox) {
      addLog(`⚠️ ${code}: linha encontrada, mas sem checkbox.`);
      return false;
    }
    if (!checkbox.checked) {
      checkbox.click();
      checkbox.dispatchEvent(
        new Event(
          "change",
          {
            bubbles: true
          }
        )
      );
    }
    return true;
  }
  async function commitPedidoBatch() {
    if (!isPedidoModalReallyOpen()) {
      addLog("⚠️ A modal de Adicionar item não está aberta para confirmar o lote.");
      return "fail";
    }
    const button = getPedidoConfirmButton();
    if (!button) {
      addLog('⚠️ Botão "Incluir"/"Adicionar" não encontrado para confirmar o lote do Pedido.');
      return "fail";
    }
    const label = cleanText(
      button.innerText || button.textContent || button.value || ""
    );
    addLog(`✅ Confirmando lote do Pedido: ${label || "INCLUIR"}.`);
    try {
      appState.suppressHooks = true;
      button.click();
    } catch (e) {
      appState.suppressHooks = false;
      addLog("⚠️ Não foi possível confirmar o lote do Pedido.");
      return "fail";
    } finally {
      appState.suppressHooks = false;
    }
    return await waitForPedidoModalClose();
  }
  async function processPedidoItem(code, index, total, notFound) {
    setPanelMessage(
      `Pedido: processando ${code} (${index + 1}/${total})`
    );
    addLog(
      `▶️ Pedido: processando ${code} (${index + 1}/${total})`
    );
    updatePanel();
    const searchResult = await searchPedidoMaterial(code);
    if (searchResult === "pause")
      return "pause";
    if (searchResult === "cancel")
      return "cancel";
    if (searchResult !== true) {
      addLog("⚠️ Campo de busca do Pedido indisponível ou não confirmado.");
      return "fail";
    }
    const rowResult = await waitForPedidoMaterialRow(
      code,
      ERP.timeouts.materialRow
    );
    if (rowResult === "pause")
      return "pause";
    if (rowResult === "cancel")
      return "cancel";
    if (!rowResult) {
      if (!notFound.includes(code))
        notFound.push(code);
      addLog(`❌ Pedido: ${code} não encontrado.`);
      const clear2 = await clearPedidoSearch();
      if (clear2 === "pause")
        return "pause";
      if (clear2 === "cancel")
        return "cancel";
      return "ok";
    }
    const selected = selectPedidoRow(rowResult, code);
    if (!selected) {
      if (!notFound.includes(code))
        notFound.push(code);
      addLog(`⚠️ Pedido: ${code} linha encontrada, mas não foi possível marcar.`);
    } else {
      addLog(`✅ Pedido: ${code} marcado.`);
    }
    const clear = await clearPedidoSearch();
    if (clear === "pause")
      return "pause";
    if (clear === "cancel")
      return "cancel";
    return selected ? "found" : "ok";
  }
  function interruptPedido(state, index, total, notFound, message) {
    if (state === "pause") {
      appState.automationState = "paused";
      savePedidoProgress(index, total, true, notFound);
      setPanelMessage(
        message || `Pedido pausado antes do item ${index + 1}. Clique PLAY para continuar.`
      );
      addLog(`⏸️ Pedido pausado antes do item ${index + 1}.`);
      updatePanel();
      return;
    }
    if (state === "cancel") {
      appState.automationState = "cancelled";
      savePedidoProgress(index, total, true, notFound);
      setPanelMessage(
        `Pedido cancelado antes do item ${index + 1}. O progresso foi mantido.`
      );
      addLog(`⛔ Pedido cancelado antes do item ${index + 1}.`);
      updatePanel();
      return;
    }
    appState.automationState = "paused";
    savePedidoProgress(index, total, true, notFound);
    setPanelMessage(message || "Automação do Pedido pausada.");
    addLog(`⚠️ ${message || "Automação do Pedido pausada."}`);
    updatePanel();
  }
  async function runPedidoBatch() {
    const codes = getCodesFromStorage();
    const total = codes.length;
    if (!total) {
      setPanelMessage('Nenhum insumo copiado. Primeiro use "Copiar Insumos".');
      showToast("Nenhum insumo foi copiado.", "warning");
      updatePanel();
      return;
    }
    const progress = getPedidoProgress(total);
    let index = progress.nextIndex;
    const notFound = Array.isArray(progress.notFound) ? [...progress.notFound] : [];
    let foundInBatch = 0;
    while (index < total) {
      if (appState.stopRequested) {
        interruptPedido("cancel", index, total, notFound);
        return;
      }
      if (appState.pauseRequested || appState.automationState === "paused") {
        interruptPedido("pause", index, total, notFound);
        return;
      }
      addLog(
        `📦 Pedido: procurando até ${BATCH_SIZE} itens encontrados (${total - index} restante(s) de ${total}).`
      );
      setPanelMessage(
        `Pedido: buscando itens encontrados ${foundInBatch}/${BATCH_SIZE} (${index}/${total} processado(s)).`
      );
      updatePanel();
      const opened = await openPedidoItemModal();
      if (opened === "pause") {
        interruptPedido("pause", index, total, notFound);
        return;
      }
      if (opened === "cancel") {
        interruptPedido("cancel", index, total, notFound);
        return;
      }
      if (opened !== "ok") {
        interruptPedido("fail", index, total, notFound, "Não foi possível abrir a modal de Adicionar item. Automação do Pedido pausada.");
        return;
      }
      while (index < total && foundInBatch < BATCH_SIZE) {
        if (appState.stopRequested) {
          interruptPedido("cancel", index, total, notFound);
          return;
        }
        if (appState.pauseRequested || appState.automationState === "paused") {
          interruptPedido("pause", index, total, notFound);
          return;
        }
        const result = await processPedidoItem(codes[index], index, total, notFound);
        if (result === "pause") {
          interruptPedido("pause", index, total, notFound);
          return;
        }
        if (result === "cancel") {
          interruptPedido("cancel", index, total, notFound);
          return;
        }
        if (result === "fail") {
          interruptPedido("fail", index, total, notFound, "Falha ao processar insumo do Pedido. Automação pausada.");
          return;
        }
        if (result === "found") {
          foundInBatch++;
          addLog(
            `✅ Pedido: lote ${foundInBatch}/${BATCH_SIZE} item(ns) encontrado(s).`
          );
        }
        index++;
        savePedidoProgress(index, total, false, notFound);
        setPanelMessage(
          `Pedido: lote ${foundInBatch}/${BATCH_SIZE} encontrado(s) — ${index}/${total} processado(s).`
        );
        updatePanel();
      }
      if (foundInBatch === 0) {
        addLog(
          "⚠️ Pedido: nenhum item encontrado. Nada para confirmar — seguindo sem clicar em Incluir."
        );
        break;
      }
      if (appState.stopRequested) {
        interruptPedido("cancel", index, total, notFound);
        return;
      }
      if (appState.pauseRequested || appState.automationState === "paused") {
        interruptPedido("pause", index, total, notFound);
        return;
      }
      const batchFound = foundInBatch;
      const committed = await commitPedidoBatch();
      if (committed === "pause") {
        interruptPedido("pause", index, total, notFound);
        return;
      }
      if (committed === "cancel") {
        interruptPedido("cancel", index, total, notFound);
        return;
      }
      if (committed !== "ok") {
        interruptPedido("fail", index, total, notFound, "Falha ao confirmar o lote do Pedido. Automação pausada.");
        return;
      }
      foundInBatch = 0;
      if (index < total) {
        const settle = await controlledSleep(400);
        if (settle === "pause") {
          interruptPedido("pause", index, total, notFound);
          return;
        }
        if (settle === "cancel") {
          interruptPedido("cancel", index, total, notFound);
          return;
        }
        setPanelMessage(`Pedido: lote confirmado (${batchFound} item(ns), ${index}/${total}). Abrindo a modal do próximo lote...`);
        addLog(`⏭️ Pedido: lote confirmado com ${batchFound} item(ns) (${index}/${total}). Abrindo o próximo lote.`);
        updatePanel();
      } else {
        addLog(`⏭️ Pedido: lote final concluído com ${batchFound} item(ns) confirmado(s) (${index}/${total}).`);
      }
    }
    appState.automationState = "completed";
    savePedidoProgress(total, total, true, notFound);
    const message = notFound.length ? `Pedido concluído. ${notFound.length} item(ns) não encontrado(s).` : "Pedido concluído! Todos os itens foram adicionados.";
    setPanelMessage(message);
    addLog(`🏁 ${message}`);
    updatePanel();
    showToast(
      message,
      notFound.length ? "warning" : "success"
    );
  }
  async function playPedidoAutomation() {
    if (!appState.extensionEnabled)
      return;
    if (appState.currentRunPromise)
      return;
    if (!isPedidoAutomationPage() && !(appState.activeFlow === "pedido" && isPedidoPage() && !isTransferenciaPage())) {
      setPanelMessage(
        "Abra a tela de Solicitação/Pedido do Mais Controle para automatizar."
      );
      showToast(
        "Esta automação só funciona na tela de Pedido/Solicitação.",
        "warning"
      );
      updatePanel();
      return;
    }
    const codes = getCodesFromStorage();
    const total = codes.length;
    if (!total) {
      setPanelMessage(
        'Nenhum insumo copiado. Primeiro use "Copiar Insumos".'
      );
      showToast(
        "Nenhum insumo foi copiado.",
        "warning"
      );
      updatePanel();
      return;
    }
    if (appState.stopRequested)
      appState.stopRequested = false;
    if (appState.pauseRequested)
      appState.pauseRequested = false;
    appState.activeFlow = "pedido";
    appState.automationState = "running";
    const progress = getPedidoProgress(total);
    savePedidoProgress(
      progress.nextIndex,
      total,
      false,
      progress.notFound
    );
    setPanelMessage("Iniciando processamento do Pedido...");
    addLog(`▶️ Pedido: continuando no item ${progress.nextIndex + 1}/${total}.`);
    updatePanel();
    appState.currentRunPromise = runPedidoBatch();
    try {
      await appState.currentRunPromise;
    } finally {
      appState.currentRunPromise = null;
    }
  }
  function pausePedidoAutomation() {
    if (appState.automationState === "running") {
      appState.pauseRequested = true;
      setPanelMessage("Pausando o Pedido após o item atual...");
      addLog("⏸️ Pedido: solicitação de pausa recebida.");
      return;
    }
    if (appState.automationState === "paused") {
      appState.automationState = "paused";
      setPanelMessage("Pedido pausado. Clique PLAY para continuar.");
      updatePanel();
    }
  }
  function cancelPedidoAutomation() {
    appState.stopRequested = true;
    appState.pauseRequested = false;
    const total = getCodesFromStorage().length;
    const progress = getPedidoProgress(total);
    savePedidoProgress(
      progress.nextIndex,
      total,
      true,
      progress.notFound
    );
    appState.automationState = "cancelled";
    setPanelMessage("Pedido cancelado. O progresso foi mantido. PLAY continua de onde parou.");
    addLog("⛔ Pedido cancelado. Progresso mantido.");
    updatePanel();
  }
  function restartPedidoAutomation() {
    appState.stopRequested = true;
    appState.pauseRequested = false;
    appState.currentRunPromise = null;
    const total = getCodesFromStorage().length;
    resetPedidoProgress(total);
    appState.automationState = "idle";
    setPanelMessage("Progresso do Pedido zerado. Clique PLAY para começar novamente.");
    addLog("🔄 Progresso do Pedido reiniciado.");
    updatePanel();
  }
  function setupPedidoAutomation() {
    if (!appState.extensionEnabled)
      return;
    createPanel();
    updatePanel();
  }

  // src/appsheet.js
  var FIELD_HEADER_SELECTOR = [
    ".field-header",
    ".field-title",
    ".field-label",
    ".field-name",
    ".column-name",
    ".cell-label",
    ".detail-label",
    '[class*="field-header"]',
    '[class*="field-title"]',
    '[class*="field-label"]',
    '[class*="field-name"]',
    '[class*="column-name"]',
    '[class*="detail-label"]'
  ].join(", ");
  var VALUE_SELECTOR = [
    ".field-value",
    ".field-text",
    ".field-data",
    ".cell-value",
    ".detail-value",
    ".detail-data",
    '[class*="field-value"]',
    '[class*="field-data"]',
    '[class*="cell-value"]',
    '[class*="detail-value"]',
    '[class*="value-text"]'
  ].join(", ");
  var FIELD_SYNONYMS = {
    observacoes: [
      "observacoes",
      "observacao",
      "obs"
    ],
    destino: [
      "destino",
      "obra",
      "local de destino",
      "local de entrega",
      "local"
    ],
    responsavel: [
      "responsavel",
      "solicitante",
      "requerente",
      "responsavel pela retirada"
    ],
    descricao: [
      "descricao",
      "cliente",
      "pedido",
      "nome",
      "titulo"
    ]
  };
  var QUANTITY_HEADERS = [
    "quantidade",
    "quantidade solicitada",
    "quantidade pedida",
    "qtde",
    "qtd",
    "qtd.",
    "qtd solicitada",
    "qtde solicitada",
    "quant",
    "quant."
  ];
  function normalizeLabel(text) {
    return cleanText(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[:*]+$/, "").replace(/\s+/g, " ").trim();
  }
  function normalizeSynonyms(list) {
    return list.map(normalizeLabel);
  }
  function readOwnValue(el) {
    if (!el)
      return "";
    const tag = String(el.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      const value = String(el.value ?? "").trim();
      if (value)
        return cleanText(value);
    }
    const inner = el.querySelector?.("input, textarea");
    if (inner) {
      const value = String(inner.value ?? "").trim();
      if (value)
        return cleanText(value);
    }
    return cleanText(el.innerText || el.textContent || "");
  }
  function isLabelLike(el) {
    const className = String(el?.className || "").toLowerCase();
    return /header|title|label/.test(className);
  }
  function readValueNear(node) {
    if (!node)
      return "";
    const tag = String(node.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
      return readOwnValue(node);
    const own = node.querySelector?.("input, textarea");
    if (own) {
      const value = String(own.value ?? "").trim();
      if (value)
        return cleanText(value);
    }
    const parent = node.parentElement;
    if (parent) {
      let next = node.nextElementSibling;
      while (next) {
        if (!isLabelLike(next)) {
          const value = readOwnValue(next);
          if (value)
            return value;
        }
        next = next.nextElementSibling;
      }
      const valueEl = parent.querySelector(VALUE_SELECTOR);
      if (valueEl && !valueEl.contains(node)) {
        const value = readOwnValue(valueEl);
        if (value)
          return value;
      }
      const parentInput = parent.querySelector("input, textarea");
      if (parentInput && parentInput !== node) {
        const value = String(parentInput.value ?? "").trim();
        if (value)
          return cleanText(value);
      }
      const siblings = parent.children;
      if (siblings.length === 2 && siblings[0] === node) {
        const value = readOwnValue(siblings[1]);
        if (value)
          return value;
      }
    }
    return "";
  }
  function collectFieldValues(root = document) {
    const fields = /* @__PURE__ */ new Map();
    const set = (label, value) => {
      const key = normalizeLabel(label);
      if (!key)
        return;
      const text = cleanText(value);
      if (!text)
        return;
      if (!fields.has(key))
        fields.set(key, text);
    };
    const headers = Array.from(
      root.querySelectorAll(FIELD_HEADER_SELECTOR)
    );
    for (const node of headers) {
      const label = cleanText(
        node.innerText || node.textContent || ""
      );
      set(label, readValueNear(node));
    }
    const detailNodes = Array.from(
      root.querySelectorAll(
        '.detail-field, .detail-row, .detail-item, [class*="detail-field"], [class*="detail-row"], [class*="detail-item"]'
      )
    );
    for (const node of detailNodes) {
      const labelEl = node.querySelector(FIELD_HEADER_SELECTOR);
      if (!labelEl)
        continue;
      const label = cleanText(
        labelEl.innerText || labelEl.textContent || ""
      );
      let value = readValueNear(labelEl);
      if (!value) {
        const valueEl = node.querySelector(VALUE_SELECTOR);
        if (valueEl && !valueEl.contains(labelEl))
          value = readOwnValue(valueEl);
      }
      set(label, value);
    }
    const ariaNodes = Array.from(
      root.querySelectorAll("[aria-label]")
    );
    for (const node of ariaNodes) {
      const label = node.getAttribute("aria-label");
      if (!label)
        continue;
      set(label, readOwnValue(node));
    }
    const labels = Array.from(
      root.querySelectorAll("label")
    );
    for (const node of labels) {
      const label = cleanText(
        node.innerText || node.textContent || ""
      );
      const value = readValueNear(node);
      if (!value && node.control)
        set(label, readOwnValue(node.control));
      else
        set(label, value);
    }
    for (const table of getVisibleTables()) {
      const rows = Array.from(
        table.querySelectorAll("tr")
      );
      for (const row of rows) {
        const th = row.querySelector("th");
        if (!th)
          continue;
        const label = cleanText(th.innerText);
        const td = row.querySelector("td");
        if (td)
          set(label, readOwnValue(td));
      }
    }
    return fields;
  }
  function pickField(fields, synonyms) {
    if (!fields)
      return "";
    const wanted = normalizeSynonyms(synonyms);
    for (const key of fields.keys()) {
      if (wanted.includes(key))
        return fields.get(key);
    }
    for (const key of fields.keys()) {
      if (wanted.some((term) => key.startsWith(term)))
        return fields.get(key);
    }
    return "";
  }
  function extractAppSheetMetadata() {
    const fields = collectFieldValues();
    const body = document.body?.innerText || "";
    const orderNumber = extractOrderNumber(fields, body);
    const description = extractDescription2(fields);
    return { orderNumber, description };
  }
  function extractOrderNumber(fields, body) {
    const observacoes = pickField(
      fields,
      FIELD_SYNONYMS.observacoes
    );
    const fromObservacoes = String(observacoes || "").match(/#\s*(\d+)/) || String(observacoes || "").match(/\bpedido\s*(?:n[º°o.]*)?\s*(\d+)/i);
    if (fromObservacoes)
      return `#${fromObservacoes[1]}`;
    const pedido = pickField(
      fields,
      FIELD_SYNONYMS.descricao
    );
    const fromPedido = String(pedido || "").match(/#\s*(\d+)/);
    if (fromPedido)
      return `#${fromPedido[1]}`;
    const fromBody = String(body || "").match(/#\s*(\d+)/);
    if (fromBody)
      return `#${fromBody[1]}`;
    return "";
  }
  function extractDescription2(fields) {
    const destino = pickField(
      fields,
      FIELD_SYNONYMS.destino
    );
    const responsavel = pickField(
      fields,
      FIELD_SYNONYMS.responsavel
    );
    const parts = [destino, responsavel].map((part) => cleanText(part || "")).filter(Boolean);
    if (!parts.length) {
      const descricao = pickField(
        fields,
        FIELD_SYNONYMS.descricao
      );
      if (descricao)
        parts.push(cleanText(descricao));
    }
    return parts.join(" - ");
  }
  function getCells(row) {
    if (!row)
      return [];
    const tds = Array.from(row.querySelectorAll("td"));
    if (tds.length)
      return tds;
    const roles = Array.from(
      row.querySelectorAll('[role="cell"], [role="gridcell"]')
    );
    if (roles.length)
      return roles;
    return Array.from(row.children);
  }
  function isHeaderRow(row) {
    if (row.closest?.("thead"))
      return true;
    const cells = getCells(row);
    if (!cells.length)
      return true;
    return cells.every(
      (cell) => String(cell.tagName || "").toUpperCase() === "TH"
    );
  }
  function getTableHeaders(table) {
    const ths = Array.from(
      table.querySelectorAll("thead th")
    );
    if (ths.length) {
      return ths.map(
        (th) => cleanText(th.innerText)
      );
    }
    const firstRow = table.querySelector("tr");
    if (firstRow) {
      const rowThs = Array.from(
        firstRow.querySelectorAll("th")
      );
      if (rowThs.length) {
        return rowThs.map(
          (th) => cleanText(th.innerText)
        );
      }
    }
    return [];
  }
  function findHeaderIndex(headers, terms) {
    if (!headers || !headers.length)
      return -1;
    const wanted = terms.map(normalizeLabel);
    const exact = headers.findIndex(
      (header) => wanted.includes(normalizeLabel(header))
    );
    if (exact >= 0)
      return exact;
    return headers.findIndex(
      (header) => wanted.some(
        (term) => normalizeLabel(header).includes(term)
      )
    );
  }
  function readQuantity(cells, codeIndex, headers) {
    const index = findHeaderIndex(
      headers,
      QUANTITY_HEADERS
    );
    if (index >= 0 && cells[index]) {
      const quantity = parseQuantity(
        readOwnValue(cells[index])
      );
      if (quantity != null)
        return quantity;
    }
    for (let i = 0; i < cells.length; i++) {
      if (i === codeIndex)
        continue;
      const text = readOwnValue(cells[i]);
      if (/^\d+(?:[.,]\d+)?$/.test(text)) {
        const quantity = parseQuantity(text);
        if (quantity != null)
          return quantity;
      }
    }
    return null;
  }
  var MAX_ROW_TEXT_LENGTH = 500;
  var MAX_FALLBACK_SEGMENT = 400;
  function matCodeCount(text) {
    const matches = String(text || "").match(/\bMAT\s*[-_]?\s*\d+\b/gi);
    return matches ? matches.length : 0;
  }
  function looksLikeRow(node) {
    if (!node)
      return false;
    const tag = String(node.tagName || "").toUpperCase();
    if (tag === "TR")
      return true;
    const role = String(
      node.getAttribute?.("role") || ""
    ).toLowerCase();
    if (role === "row")
      return true;
    const className = String(node.className || "");
    if (/(^|[\s_-])(row|data-row|grid-row|table-row|list-row)([\s_-]|$)/i.test(className))
      return true;
    const cells = getCells(node);
    const filled = cells.filter(
      (cell) => readOwnValue(cell)
    );
    return cells.length >= 2 && filled.length >= 2;
  }
  function findRowFor(node) {
    let current = node;
    let best = node;
    if (looksLikeRow(current))
      return current;
    for (let depth = 0; depth < 10; depth++) {
      const parent = current?.parentElement;
      if (!parent)
        break;
      const text = readOwnValue(parent);
      if (!text)
        break;
      if (matCodeCount(text) !== 1)
        break;
      if (text.length > MAX_ROW_TEXT_LENGTH)
        break;
      best = parent;
      if (looksLikeRow(parent))
        return parent;
      current = parent;
    }
    return best;
  }
  var ACTIVE_ROW_SELECTOR = [
    "tr",
    '[role="row"]',
    '[class*="data-row"]',
    '[class*="grid-row"]',
    '[class*="list-row"]',
    '[class*="item-row"]'
  ].join(", ");
  function isWithinViewport(el) {
    if (!el)
      return false;
    const rect = el.getBoundingClientRect?.();
    if (!rect)
      return isElementVisible(el);
    const left = Number(
      rect.left ?? 0
    );
    const top = Number(
      rect.top ?? 0
    );
    const width = Number(
      rect.width ?? rect.right - rect.left
    );
    const height = Number(
      rect.height ?? rect.bottom - rect.top
    );
    if (!(width > 0) || !(height > 0))
      return false;
    const right = Number(
      rect.right ?? left + width
    );
    const bottom = Number(
      rect.bottom ?? top + height
    );
    const viewportWidth = Number(
      typeof window !== "undefined" ? window.innerWidth : 0
    );
    const viewportHeight = Number(
      typeof window !== "undefined" ? window.innerHeight : 0
    );
    if (!(viewportWidth > 0) || !(viewportHeight > 0))
      return true;
    if (top < 0 || bottom > viewportHeight)
      return false;
    return bottom > 0 && right > 0 && top < viewportHeight && left < viewportWidth;
  }
  function isActiveOnScreen(el) {
    if (!el)
      return false;
    if (!isElementVisible(el))
      return false;
    if (typeof el.getBoundingClientRect !== "function")
      return false;
    const rect = el.getBoundingClientRect();
    if (!rect)
      return false;
    const width = Number(rect.width ?? rect.right - rect.left);
    const height = Number(rect.height ?? rect.bottom - rect.top);
    if (!(width > 0) || !(height > 0))
      return false;
    return isWithinViewport(el);
  }
  function nodeDepth(el) {
    let depth = 0;
    let current = el;
    while (current?.parentElement) {
      depth++;
      current = current.parentElement;
    }
    return depth;
  }
  function isDataRowCandidate(row) {
    return Boolean(row) && !isHeaderRow(row) && matCodeCount(readOwnValue(row)) === 1;
  }
  function readScrollMetrics(el) {
    if (!el)
      return null;
    const scrollTop = Number(el.scrollTop ?? 0);
    const scrollHeight = Number(el.scrollHeight);
    const clientHeight = Number(el.clientHeight);
    if (!Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight))
      return null;
    return {
      scrollTop: Number.isFinite(scrollTop) ? scrollTop : 0,
      scrollHeight,
      clientHeight
    };
  }
  function findScrollableContainer(node) {
    let innermost = null;
    let current = node;
    while (current && current !== document.body && current !== document.documentElement) {
      const style = typeof window.getComputedStyle === "function" ? window.getComputedStyle(current) : null;
      if (style) {
        const overflowY = String(style.overflowY || "");
        const overflowX = String(style.overflowX || "");
        if (/auto|scroll|overlay/i.test(overflowY) || /auto|scroll|overlay/i.test(overflowX)) {
          if (!innermost)
            innermost = current;
          const metrics = readScrollMetrics(current);
          if (metrics && metrics.scrollHeight > metrics.clientHeight)
            return current;
        }
      }
      current = current.parentElement;
    }
    return innermost;
  }
  function identifyTableContainer(scope) {
    const root = scope || document;
    if (!root || typeof root.querySelectorAll !== "function")
      return null;
    const rowEls = Array.from(
      root.querySelectorAll(ACTIVE_ROW_SELECTOR)
    );
    const dataRows = rowEls.filter(isDataRowCandidate);
    const pool = dataRows.length ? dataRows : rowEls;
    const candidates = /* @__PURE__ */ new Map();
    for (const row of pool) {
      const container = findScrollableContainer(row);
      if (!container)
        continue;
      candidates.set(
        container,
        (candidates.get(container) || 0) + 1
      );
    }
    if (!candidates.size) {
      const first = dataRows[0] || rowEls[0];
      if (first)
        return findScrollableContainer(first);
      return null;
    }
    let best = null;
    for (const [container, count] of candidates) {
      if (!best || count > best.count || count === best.count && nodeDepth(container) > nodeDepth(best.container)) {
        best = { container, count };
      }
    }
    return best ? best.container : null;
  }
  function getTableContainerRect(scope) {
    const container = identifyTableContainer(scope);
    if (!container || typeof container.getBoundingClientRect !== "function") {
      return null;
    }
    const rect = container.getBoundingClientRect();
    if (!rect)
      return null;
    if (!(rect.width > 0) || !(rect.height > 0))
      return null;
    return rect;
  }
  function isRowInVisibleArea(rect, containerRect, viewportHeight) {
    if (!rect)
      return false;
    const width = Number(rect.width ?? rect.right - rect.left);
    const height = Number(rect.height ?? rect.bottom - rect.top);
    if (!(width > 0) || !(height > 0))
      return false;
    if (containerRect) {
      const rowTop = Number(rect.top ?? 0);
      const rowBottom = Number(rect.bottom ?? rowTop + height);
      const rowLeft = Number(rect.left ?? 0);
      const rowRight = Number(rect.right ?? rowLeft + width);
      const cTop = Number(containerRect.top ?? 0);
      const cBottom = Number(containerRect.bottom ?? cTop + (containerRect.height ?? 0));
      const cLeft = Number(containerRect.left ?? 0);
      const cRight = Number(containerRect.right ?? cLeft + (containerRect.width ?? 0));
      const vertical = rowBottom >= cTop && rowTop <= cBottom;
      const horizontal = rowRight >= cLeft && rowLeft <= cRight;
      return vertical && horizontal;
    }
    return true;
  }
  function getActiveDataRows(scope, debug = false) {
    const root = scope || document;
    const viewportHeight = Number(
      typeof window !== "undefined" ? window.innerHeight : 0
    );
    const containerRect = getTableContainerRect(scope);
    const scrollContainer = identifyTableContainer(scope);
    return Array.from(
      root.querySelectorAll(ACTIVE_ROW_SELECTOR)
    ).filter(
      (row) => {
        let skipReason = "";
        const rect = typeof row.getBoundingClientRect === "function" ? row.getBoundingClientRect() : null;
        const logRow = (passed) => {
          if (!debug)
            return;
          const text = cleanText(
            readOwnValue(row)
          ).slice(0, 200);
          const rectInfo = rect ? {
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width ?? rect.right - rect.left),
            height: Math.round(rect.height ?? rect.bottom - rect.top)
          } : null;
          console.log(
            "[AppSheet Extractor] Elemento verificado:",
            { texto: text, rect: rectInfo, passou: passed },
            passed ? "" : `| Motivo: ${skipReason}`
          );
        };
        if (!isDataRowCandidate(row)) {
          skipReason = "Não é linha de dados (sem MAT único ou é cabeçalho)";
          logRow(false);
          return false;
        }
        if (!isElementVisible(row)) {
          skipReason = "Oculto";
          logRow(false);
          return false;
        }
        if (typeof row.getBoundingClientRect !== "function") {
          skipReason = "Sem getBoundingClientRect";
          logRow(false);
          return false;
        }
        if (!rect) {
          skipReason = "Sem rect válido";
          logRow(false);
          return false;
        }
        const width = Number(rect.width ?? rect.right - rect.left);
        const height = Number(rect.height ?? rect.bottom - rect.top);
        if (!(width > 0) || !(height > 0)) {
          skipReason = "Dimensões zeradas";
          logRow(false);
          return false;
        }
        if (scrollContainer && scrollContainer.contains(row)) {
          logRow(true);
          return true;
        }
        if (containerRect) {
          if (!isRowInVisibleArea(rect, containerRect, viewportHeight)) {
            skipReason = "Fora do container visível da tabela";
            logRow(false);
            return false;
          }
          logRow(true);
          return true;
        }
        logRow(true);
        return true;
      }
    );
  }
  function findActiveItemsContainer() {
    const candidates = /* @__PURE__ */ new Map();
    const add = (container) => {
      if (!container || container === document.body || container === document.documentElement) {
        return;
      }
      if (candidates.has(container))
        return;
      if (!isActiveOnScreen(container))
        return;
      const score = getActiveDataRows(container).length;
      if (!score)
        return;
      candidates.set(container, {
        container,
        score,
        depth: nodeDepth(container)
      });
    };
    for (const table of getVisibleTables())
      add(table);
    for (const row of getActiveDataRows(document.body)) {
      add(row.parentElement);
      add(row.closest?.("table"));
      add(
        row.closest?.(
          '[role="grid"], [role="treegrid"], [role="table"], [class*="related"], [class*="list"], [class*="grid"]'
        )
      );
    }
    let best = null;
    for (const candidate of candidates.values()) {
      if (!best || candidate.score > best.score || candidate.score === best.score && candidate.depth > best.depth) {
        best = candidate;
      }
    }
    return best ? best.container : null;
  }
  function findHeadersFor(row) {
    const table = row?.closest?.("table");
    if (table)
      return getTableHeaders(table);
    const container = row?.parentElement || row;
    if (!container)
      return [];
    return Array.from(
      container.querySelectorAll('[role="columnheader"]')
    ).filter(isActiveOnScreen).map((header) => cleanText(header.innerText));
  }
  function collectDataRows() {
    const rows = [];
    const seen = /* @__PURE__ */ new Set();
    const viewportHeight = Number(
      typeof window !== "undefined" ? window.innerHeight : 0
    );
    const add = (row, headers) => {
      if (!row)
        return;
      if (seen.has(row))
        return;
      if (!isElementVisible(row))
        return;
      if (typeof row.getBoundingClientRect !== "function")
        return;
      const rect = row.getBoundingClientRect();
      if (!rect)
        return;
      const width = Number(rect.width ?? rect.right - rect.left);
      const height = Number(rect.height ?? rect.bottom - rect.top);
      if (!(width > 0) || !(height > 0))
        return;
      if (!isRowInVisibleArea(rect, containerRect, viewportHeight))
        return;
      if (!isDataRowCandidate(row))
        return;
      seen.add(row);
      rows.push({ row, headers: headers || [] });
    };
    const scope = findActiveItemsContainer();
    const containerRect = getTableContainerRect(scope);
    for (const row of getActiveDataRows(scope || document.body, true))
      add(row, findHeadersFor(row));
    if (!rows.length) {
      const leafScope = scope || document.body;
      const all = Array.from(
        leafScope.querySelectorAll("*")
      );
      for (const node of all) {
        if (!isElementVisible(node))
          continue;
        if (typeof node.getBoundingClientRect !== "function")
          continue;
        const nrect = node.getBoundingClientRect();
        if (!nrect)
          continue;
        const nwidth = Number(nrect.width ?? nrect.right - nrect.left);
        const nheight = Number(nrect.height ?? nrect.bottom - nrect.top);
        if (!(nwidth > 0) || !(nheight > 0))
          continue;
        if (!isRowInVisibleArea(nrect, containerRect, viewportHeight))
          continue;
        const text = node.textContent || "";
        if (!text || text.length > MAX_ROW_TEXT_LENGTH)
          continue;
        if (matCodeCount(text) !== 1)
          continue;
        const hasChildWithMat = Array.from(node.children || []).some(
          (child) => /\bMAT\s*[-_]?\s*\d+\b/i.test(child.textContent || "")
        );
        if (hasChildWithMat)
          continue;
        const row = findRowFor(node);
        add(row, findHeadersFor(row));
      }
    }
    return { rows, scope };
  }
  function numericCandidates(value) {
    const candidates = [];
    const re = /-?\d+(?:[.,]\d+)?/g;
    let match;
    while (match = re.exec(value)) {
      const raw = match[0];
      const start2 = match.index;
      const end = start2 + raw.length;
      const before = value[start2 - 1];
      const after = value[end];
      if (before === "#" || before === "/" || after === "/")
        continue;
      const around = value.slice(
        Math.max(0, start2 - 6),
        Math.min(value.length, end + 6)
      );
      if (/\d{1,4}[\/.-]\d{1,2}[\/.-]\d{1,4}/.test(around))
        continue;
      candidates.push(raw);
    }
    return candidates;
  }
  function readQuantityFromText(text, code) {
    let value = String(text || "");
    if (!value)
      return null;
    const codeMatch = value.match(
      /\bMAT\s*[-_]?\s*\d+\b/i
    );
    if (codeMatch && codeMatch.index != null) {
      value = value.slice(
        codeMatch.index + codeMatch[0].length
      );
    }
    value = value.replace(/^[\s:;|,\-]+/, "");
    if (!value)
      return null;
    const labelled = value.match(
      /(?:quantidade|quant\.?|qtde\.?|qtd\.?)\s*[:.\-]?\s*(\d+(?:[.,]\d+)?)/i
    );
    if (labelled) {
      const parsed = parseQuantity(labelled[1]);
      if (parsed != null)
        return parsed;
    }
    const lines = value.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = cleanText(lines[i]);
      if (!line)
        continue;
      if (/^\d+(?:[.,]\d+)?(?:\s*[a-zA-Z]{1,8}\.?)?$/.test(line)) {
        const parsed = parseQuantity(line);
        if (parsed != null)
          return parsed;
      }
    }
    const candidates = numericCandidates(value);
    if (!candidates.length)
      return null;
    return parseQuantity(candidates[candidates.length - 1]);
  }
  function extractItemsFromVisibleText(text) {
    const items = {};
    const source = String(text || "");
    if (!source || !/\bMAT\s*[-_]?\s*\d+\b/i.test(source))
      return items;
    const lines = source.split(/\r?\n/);
    for (const line of lines) {
      if (!/\bMAT\s*[-_]?\s*\d+\b/i.test(line))
        continue;
      const matches2 = Array.from(
        line.matchAll(/\bMAT\s*[-_]?\s*\d+\b/gi)
      );
      for (let i = 0; i < matches2.length; i++) {
        const match = matches2[i];
        const code = extractMatCode(match[0]);
        if (!code || items[code])
          continue;
        const start2 = match.index + match[0].length;
        const end = i + 1 < matches2.length ? matches2[i + 1].index : line.length;
        const quantity = readQuantityFromText(
          line.slice(start2, end),
          code
        );
        if (quantity != null) {
          items[code] = {
            code,
            quantity: String(quantity)
          };
        }
      }
    }
    const matches = Array.from(
      source.matchAll(/\bMAT\s*[-_]?\s*\d+\b/gi)
    );
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const code = extractMatCode(match[0]);
      if (!code || items[code])
        continue;
      const start2 = match.index + match[0].length;
      const nextStart = i + 1 < matches.length ? matches[i + 1].index : source.length;
      const end = Math.min(
        nextStart,
        start2 + MAX_FALLBACK_SEGMENT
      );
      const quantity = readQuantityFromText(
        source.slice(start2, end),
        code
      );
      if (quantity != null) {
        items[code] = {
          code,
          quantity: String(quantity)
        };
      }
    }
    return items;
  }
  function extractAppSheetItems() {
    const items = {};
    const viewportHeight = Number(
      typeof window !== "undefined" ? window.innerHeight : 0
    );
    const addItem = (code, quantity) => {
      if (!code || quantity == null)
        return;
      const key = String(code).toUpperCase();
      if (items[key])
        return;
      items[key] = {
        code: key,
        quantity: String(quantity)
      };
      console.log(
        `[AppSheet Extractor] ✅ Matéria-prima válida encontrada -> Código: [${key}], Qtd: [${String(quantity)}]`
      );
    };
    const { rows: dataRows, scope } = collectDataRows();
    const containerRect = getTableContainerRect(scope);
    const scrollContainer = identifyTableContainer(scope);
    for (const { row, headers } of dataRows) {
      if (!row)
        continue;
      if (!isElementVisible(row))
        continue;
      if (typeof row.getBoundingClientRect !== "function")
        continue;
      const rect = row.getBoundingClientRect();
      if (!rect)
        continue;
      const width = Number(rect.width ?? rect.right - rect.left);
      const height = Number(rect.height ?? rect.bottom - rect.top);
      if (!(width > 0) || !(height > 0))
        continue;
      if (scrollContainer && scrollContainer.contains(row)) {
      } else if (containerRect) {
        if (!isRowInVisibleArea(rect, containerRect, viewportHeight)) {
          continue;
        }
      } else if (!containerRect && viewportHeight > 0) {
        const top = Number(rect.top ?? 0);
        const bottom = Number(rect.bottom ?? top + height);
        if (top < 0 || bottom > viewportHeight)
          continue;
      }
      const rowText = readOwnValue(row);
      const cells = getCells(row);
      let code = null;
      let codeIndex = -1;
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        if (!cell)
          continue;
        if (!isElementVisible(cell))
          continue;
        if (typeof cell.getBoundingClientRect === "function") {
          const crect = cell.getBoundingClientRect();
          if (crect) {
            const cwidth = Number(crect.width ?? crect.right - crect.left);
            const cheight = Number(crect.height ?? crect.bottom - crect.top);
            if (!(cwidth > 0) || !(cheight > 0))
              continue;
          }
        }
        const found = extractMatCode(
          readOwnValue(cell)
        );
        if (found) {
          code = found;
          codeIndex = i;
          break;
        }
      }
      if (!code)
        code = extractMatCode(rowText);
      if (!code)
        continue;
      let quantity = readQuantity(
        cells,
        codeIndex,
        headers
      );
      if (quantity == null)
        quantity = readQuantityFromText(rowText, code);
      addItem(code, quantity);
    }
    if (!Object.keys(items).length) {
      const fallbackSource = scope || document.body;
      if (!fallbackSource)
        return items;
      if (!isElementVisible(fallbackSource))
        return items;
      if (typeof fallbackSource.getBoundingClientRect === "function") {
        const frect = fallbackSource.getBoundingClientRect();
        if (frect) {
          const fwidth = Number(frect.width ?? frect.right - frect.left);
          const fheight = Number(frect.height ?? frect.bottom - frect.top);
          if (!(fwidth > 0) || !(fheight > 0))
            return items;
        }
      }
      const fallbackText = fallbackSource?.innerText || fallbackSource?.textContent || "";
      const fallbackItems = extractItemsFromVisibleText(fallbackText);
      for (const code of Object.keys(fallbackItems)) {
        if (!items[code])
          items[code] = fallbackItems[code];
      }
    }
    return items;
  }
  function copyAppSheetInsumos() {
    console.log(
      `[AppSheet Extractor] 🔄 Hard Reset executado. A limpar buffers, storage e clipboard...`
    );
    const items = {};
    if (appState) {
      appState.copySummary = null;
    }
    if (!isAppSheetHost()) {
      setPanelMessage(
        "Abra uma tela do AppSheet para copiar os insumos."
      );
      return false;
    }
    clearCopiedData();
    if (appState) {
      appState.copySummary = null;
    }
    const extracted = extractAppSheetItems();
    Object.keys(extracted).forEach((key) => {
      items[key] = extracted[key];
    });
    const metadata = extractAppSheetMetadata();
    const count = saveExtractedItems(
      items,
      metadata
    );
    if (!count) {
      appState.copySummary = null;
      setPanelMessage(
        "Nenhum MAT + quantidade foi encontrado no AppSheet."
      );
      updatePanel();
      showToast(
        "Nenhum insumo encontrado no AppSheet.",
        "warning"
      );
      return false;
    }
    appState.copySummary = {
      count,
      source: "AppSheet"
    };
    console.log(
      `[AppSheet Extractor] 📦 Payload final gerado (Total de ${count} itens):`,
      JSON.stringify(items, null, 2)
    );
    const clipboardJson = serializeClipboardPayload(items, metadata);
    replaceClipboardText(clipboardJson).then((copied) => {
      if (copied) {
        addLog(
          "✅ Dados copiados para a Área de Transferência (Ctrl+C)!"
        );
        return;
      }
      addLog(
        "⚠️ Não foi possível copiar os dados para a Área de Transferência."
      );
      showToast(
        "Copie manualmente: a área de transferência foi bloqueada.",
        "warning"
      );
    }).catch(() => {
      addLog(
        "⚠️ Falha ao copiar os dados para a Área de Transferência."
      );
    });
    notifyCopied(
      count,
      metadata,
      "AppSheet"
    );
    return true;
  }
  function setupCopiarAppSheet() {
    if (!isAppSheetHost())
      return;
    createPanel(true);
    updatePanel();
  }
  registerControls({
    copyAppSheet: copyAppSheetInsumos
  });

  // src/preencher.js
  var FIELD_SELECTOR2 = 'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="button"]):not([type="submit"]), textarea';
  function setInputValue(input, value) {
    if (!input)
      return false;
    const tag = String(input.tagName || "").toUpperCase();
    const ctor = tag === "TEXTAREA" ? typeof HTMLTextAreaElement !== "undefined" ? HTMLTextAreaElement : null : typeof HTMLInputElement !== "undefined" ? HTMLInputElement : null;
    const descriptor = ctor ? Object.getOwnPropertyDescriptor(ctor.prototype, "value") : null;
    if (input.focus) input.focus();
    if (descriptor?.set) {
      descriptor.set.call(input, String(value ?? ""));
    } else {
      input.value = String(value ?? "");
    }
    input.dispatchEvent(
      new Event(
        "input",
        {
          bubbles: true
        }
      )
    );
    input.dispatchEvent(
      new Event(
        "change",
        {
          bubbles: true
        }
      )
    );
    input.dispatchEvent(
      new Event(
        "blur",
        {
          bubbles: true
        }
      )
    );
    return true;
  }
  function isObservacoesLabel(text) {
    const normalized = String(text || "").replace(/[:*]+$/, "").trim();
    return ERP.observacoesLabels.some((label) => normalized === label || normalized.startsWith(`${label} `));
  }
  function isUsableField(el, modal) {
    if (!el) return false;
    if (modal && modal.contains(el)) return false;
    const tag = String(el.tagName || "").toUpperCase();
    if (tag !== "TEXTAREA" && tag !== "INPUT") return false;
    const type = String(el.type || "").toLowerCase();
    if (tag === "INPUT" && (type === "checkbox" || type === "radio" || type === "hidden" || type === "button" || type === "submit")) return false;
    return true;
  }
  function resolveFieldFromLabel(label, modal) {
    if (label.control && isUsableField(label.control, modal)) {
      return label.control;
    }
    const nested = label.querySelector(FIELD_SELECTOR2);
    if (isUsableField(nested, modal)) return nested;
    const next = label.nextElementSibling;
    if (next) {
      if (isUsableField(next, modal)) return next;
      const inner = next.querySelector(FIELD_SELECTOR2);
      if (isUsableField(inner, modal)) return inner;
    }
    const parent = label.parentElement;
    if (parent) {
      const inner = parent.querySelector(FIELD_SELECTOR2);
      if (isUsableField(inner, modal)) return inner;
    }
    return null;
  }
  function findObservacoesField() {
    const modal = getAdicionarInsumoModal();
    const labels = Array.from(document.querySelectorAll("label, th, legend, span, div, p")).map((el) => ({ el, text: cleanText(el.innerText || el.textContent || "").toLowerCase() })).filter((x) => isObservacoesLabel(x.text)).sort((a, b) => a.text.length - b.text.length);
    for (const { el } of labels) {
      const field = resolveFieldFromLabel(el, modal);
      if (field) return field;
    }
    const byAttr = Array.from(document.querySelectorAll(FIELD_SELECTOR2)).find((el) => {
      if (modal && modal.contains(el)) return false;
      const attrs = [el.placeholder, el.name, el.id, el.getAttribute?.("aria-label")].filter(Boolean).join(" ").toLowerCase();
      return attrs.includes("observa");
    });
    if (byAttr) return byAttr;
    const textareas = Array.from(document.querySelectorAll("textarea")).filter((el) => !modal || !modal.contains(el));
    if (textareas.length === 1)
      return textareas[0];
    return null;
  }
  function buildObservacoesText(metadata) {
    const orderNumber = String(metadata?.orderNumber || "").trim();
    const description = String(metadata?.description || "").trim();
    const parts = [];
    if (orderNumber)
      parts.push(`Pedido ${orderNumber}`);
    if (description)
      parts.push(description);
    return parts.join(" - ");
  }
  function fillObservacoes() {
    if (!isTransferenciaPage())
      return false;
    const field = findObservacoesField();
    if (!field)
      return false;
    const current = String(field.value ?? "").trim();
    if (current) {
      field.dataset.mcObservacoes = "done";
      return false;
    }
    if (field.dataset.mcObservacoes === "done")
      return false;
    const metadata = getMetadataFromStorage();
    const text = buildObservacoesText(metadata);
    if (!text)
      return false;
    const ok = setInputValue(field, text);
    if (ok) {
      field.dataset.mcObservacoes = "done";
      addLog(`📝 Observações preenchidas: ${text}`);
      setPanelMessage(`Observações preenchidas com "${text}".`);
      updatePanel();
    }
    return ok;
  }
  function findTransferRow(code) {
    const target = normalizeMatCode(code);
    if (!target)
      return null;
    const rows = Array.from(
      document.querySelectorAll(
        "table tr"
      )
    ).filter(
      (row) => row.querySelectorAll(
        "td"
      ).length > 0
    );
    for (const row of rows) {
      const rowCode = extractMatCode(
        row.innerText
      );
      if (rowCode === target) {
        return row;
      }
    }
    return null;
  }
  function fillTransferQuantities() {
    if (!isTransferenciaPage()) {
      setPanelMessage(
        "Abra a tela de Transferência para preencher as quantidades."
      );
      return false;
    }
    const items = getItemsFromStorage();
    const codes = Object.keys(items);
    if (!codes.length) {
      setPanelMessage(
        "Nenhum insumo copiado para preencher."
      );
      showToast(
        "Primeiro copie os insumos do pedido.",
        "warning"
      );
      return false;
    }
    let preenchidos = 0;
    let faltantes = [];
    for (const rawCode of codes) {
      const code = normalizeMatCode(
        rawCode
      );
      const item = items[rawCode];
      const row = findTransferRow(
        code
      );
      if (!row) {
        faltantes.push(
          code
        );
        continue;
      }
      const input = row.querySelector(
        'input:not([type="checkbox"]), textarea'
      );
      if (!input) {
        faltantes.push(
          code
        );
        continue;
      }
      if (setInputValue(
        input,
        item.quantity
      )) {
        preenchidos++;
      }
    }
    const msg = faltantes.length ? `${preenchidos} preenchidos. Não encontrados: ${faltantes.join(", ")}` : `${preenchidos} quantidades preenchidas.`;
    addLog(
      `🧮 ${msg}`
    );
    setPanelMessage(
      msg
    );
    updatePanel();
    showToast(
      msg,
      faltantes.length ? "warning" : "success"
    );
    return true;
  }
  function setupPreencherTransferencia() {
    if (!appState.extensionEnabled || !isTransferenciaPage()) {
      return;
    }
    fillObservacoes();
    updatePanel();
  }
  registerControls({
    fillTransfer: fillTransferQuantities
  });

  // src/automation.js
  async function processItem(code, index, total, notFound) {
    setPanelMessage(
      `Processando ${code} (${index + 1}/${total})`
    );
    addLog(
      `▶️ Processando ${code} (${index + 1}/${total})`
    );
    updatePanel();
    const searchResult = await searchMaterial(code);
    if (searchResult === "pause") {
      return "pause";
    }
    if (searchResult === "cancel") {
      return "cancel";
    }
    if (searchResult !== true) {
      addLog("⚠️ Campo de busca indisponível ou não confirmado.");
      return "fail";
    }
    const rowResult = await waitForMaterialRow(code, ERP.timeouts.materialRow);
    if (rowResult === "pause") {
      return "pause";
    }
    if (rowResult === "cancel") {
      return "cancel";
    }
    if (!rowResult) {
      if (!notFound.includes(code)) {
        notFound.push(code);
      }
      addLog(`❌ ${code} não encontrado.`);
      const clearRes2 = await clearSearch();
      if (clearRes2 === "pause") return "pause";
      if (clearRes2 === "cancel") return "cancel";
      return "ok";
    }
    const selected = selectMaterialRow(rowResult, code);
    if (!selected) {
      if (!notFound.includes(code)) {
        notFound.push(code);
      }
      addLog(`⚠️ ${code}: não foi possível selecionar.`);
    } else {
      addLog(`✅ ${code} selecionado.`);
    }
    const clearRes = await clearSearch();
    if (clearRes === "pause") return "pause";
    if (clearRes === "cancel") return "cancel";
    return selected ? "found" : "ok";
  }
  function interrupt(state, index, total, notFound, message) {
    if (state === "pause") {
      appState.automationState = "paused";
      saveProgress(index, total, true, notFound);
      setPanelMessage(
        message || `Pausado antes do item ${index + 1}. Clique PLAY para continuar.`
      );
      addLog(
        `⏸️ Pausado antes do item ${index + 1}.`
      );
      updatePanel();
      return;
    }
    if (state === "cancel") {
      appState.automationState = "cancelled";
      saveProgress(index, total, true, notFound);
      setPanelMessage(
        `Cancelado antes do item ${index + 1}. O progresso foi mantido.`
      );
      addLog(
        `⛔ Cancelado antes do item ${index + 1}.`
      );
      updatePanel();
      return;
    }
    appState.automationState = "paused";
    saveProgress(index, total, true, notFound);
    setPanelMessage(message || "Automação pausada.");
    addLog(`⚠️ ${message || "Automação pausada."}`);
    updatePanel();
  }
  async function ensureAdicionarInsumoModal() {
    if (isAdicionarInsumoPage()) {
      const input = getAdicionarInsumoSearchInput();
      if (input)
        return "ok";
      return await waitForAdicionarInsumoModal();
    }
    if (!isTransferenciaPage()) {
      addLog("⚠️ Tela atual não é a de Transferência nem a modal de Adicionar Insumo.");
      return "fail";
    }
    const opened = await openAdicionarInsumoModal();
    if (opened !== "ok") {
      if (opened === "pause" || opened === "cancel")
        return opened;
      addLog("⚠️ Não foi possível abrir a modal de Adicionar Insumo.");
      return "fail";
    }
    return "ok";
  }
  async function runBatch() {
    const codes = getCodesFromStorage();
    const total = codes.length;
    if (!total) {
      setPanelMessage('Nenhum insumo copiado. Primeiro use "Copiar Insumos do Pedido".');
      showToast("Nenhum insumo foi copiado.", "warning");
      updatePanel();
      return;
    }
    const progress = getProgress(total);
    let index = progress.nextIndex;
    const notFound = Array.isArray(progress.notFound) ? [...progress.notFound] : [];
    let foundInBatch = 0;
    while (index < total) {
      if (appState.stopRequested) {
        interrupt("cancel", index, total, notFound);
        return;
      }
      if (appState.pauseRequested || appState.automationState === "paused") {
        interrupt("pause", index, total, notFound);
        return;
      }
      addLog(
        `📦 Procurando até ${BATCH_SIZE} itens encontrados (${total - index} restante(s) de ${total}).`
      );
      setPanelMessage(
        `Buscando itens encontrados: ${foundInBatch}/${BATCH_SIZE} (${index}/${total} processado(s)).`
      );
      updatePanel();
      const ensured = await ensureAdicionarInsumoModal();
      if (ensured === "pause") {
        interrupt("pause", index, total, notFound);
        return;
      }
      if (ensured === "cancel") {
        interrupt("cancel", index, total, notFound);
        return;
      }
      if (ensured !== "ok") {
        interrupt("fail", index, total, notFound, "Não foi possível abrir a modal de Adicionar Insumo. Automação pausada.");
        return;
      }
      while (index < total && foundInBatch < BATCH_SIZE) {
        if (appState.stopRequested) {
          interrupt("cancel", index, total, notFound);
          return;
        }
        if (appState.pauseRequested || appState.automationState === "paused") {
          interrupt("pause", index, total, notFound);
          return;
        }
        const result = await processItem(codes[index], index, total, notFound);
        if (result === "pause") {
          interrupt("pause", index, total, notFound);
          return;
        }
        if (result === "cancel") {
          interrupt("cancel", index, total, notFound);
          return;
        }
        if (result === "fail") {
          interrupt("fail", index, total, notFound, "Falha ao processar insumo. Automação pausada.");
          return;
        }
        if (result === "found") {
          foundInBatch++;
          addLog(
            `✅ Lote: ${foundInBatch}/${BATCH_SIZE} item(ns) encontrado(s).`
          );
        }
        index++;
        saveProgress(index, total, false, notFound);
        setPanelMessage(
          `Lote: ${foundInBatch}/${BATCH_SIZE} encontrado(s) — ${index}/${total} processado(s).`
        );
        updatePanel();
      }
      if (foundInBatch === 0) {
        addLog(
          "⚠️ Nenhum item encontrado. Nada para confirmar — seguindo sem clicar em ADICIONAR."
        );
        break;
      }
      if (appState.stopRequested) {
        interrupt("cancel", index, total, notFound);
        return;
      }
      if (appState.pauseRequested || appState.automationState === "paused") {
        interrupt("pause", index, total, notFound);
        return;
      }
      const batchFound = foundInBatch;
      const committed = await commitBatch();
      if (committed === "pause") {
        interrupt("pause", index, total, notFound);
        return;
      }
      if (committed === "cancel") {
        interrupt("cancel", index, total, notFound);
        return;
      }
      if (committed !== "ok") {
        interrupt("fail", index, total, notFound, "Falha ao confirmar o lote. Automação pausada.");
        return;
      }
      foundInBatch = 0;
      if (index < total) {
        const settle = await controlledSleep(400);
        if (settle === "pause") {
          interrupt("pause", index, total, notFound);
          return;
        }
        if (settle === "cancel") {
          interrupt("cancel", index, total, notFound);
          return;
        }
        setPanelMessage(`Lote confirmado (${batchFound} item(ns), ${index}/${total}). Abrindo a modal do próximo lote...`);
        addLog(`⏭️ Lote confirmado com ${batchFound} item(ns) (${index}/${total}). Voltou para Transferência — abrindo a modal do próximo lote.`);
        updatePanel();
      } else {
        addLog(`⏭️ Lote final concluído: ${batchFound} item(ns) confirmado(s) (${index}/${total}).`);
      }
    }
    appState.automationState = "completed";
    saveProgress(total, total, true, notFound);
    const msg = notFound.length ? `Concluído. ${notFound.length} item(ns) não encontrado(s).` : "Concluído! Todos os itens foram selecionados.";
    setPanelMessage(msg);
    addLog(`🏁 ${msg}`);
    updatePanel();
    showToast(msg, notFound.length ? "warning" : "success");
  }
  async function playAutomation() {
    if (!appState.extensionEnabled)
      return;
    if (appState.currentRunPromise)
      return;
    if (isPedidoAutomationPage() || appState.activeFlow === "pedido" && isPedidoPage() && !isTransferenciaPage()) {
      return playPedidoAutomation();
    }
    appState.activeFlow = "transfer";
    const codes = getCodesFromStorage();
    const total = codes.length;
    if (!total) {
      setPanelMessage(
        'Nenhum insumo copiado. Primeiro use "Copiar Insumos do Pedido".'
      );
      showToast(
        "Nenhum insumo foi copiado.",
        "warning"
      );
      updatePanel();
      return;
    }
    if (appState.stopRequested)
      appState.stopRequested = false;
    if (appState.pauseRequested)
      appState.pauseRequested = false;
    appState.automationState = "running";
    const progress = getProgress(total);
    saveProgress(progress.nextIndex, total, false, progress.notFound);
    setPanelMessage("Iniciando processamento...");
    addLog(`▶️ Continuando no item ${progress.nextIndex + 1}/${total}.`);
    updatePanel();
    appState.currentRunPromise = runBatch();
    try {
      await appState.currentRunPromise;
    } finally {
      appState.currentRunPromise = null;
    }
  }
  function pauseAutomation() {
    if (appState.activeFlow === "pedido")
      return pausePedidoAutomation();
    if (appState.automationState === "running") {
      appState.pauseRequested = true;
      setPanelMessage(
        "Pausando após o item atual..."
      );
      addLog(
        "⏸️ Solicitação de pausa recebida."
      );
      return;
    }
    if (appState.automationState === "paused") {
      appState.automationState = "paused";
      setPanelMessage(
        "Automação pausada. Clique PLAY para continuar."
      );
      updatePanel();
    }
  }
  function cancelAutomation() {
    if (appState.activeFlow === "pedido")
      return cancelPedidoAutomation();
    appState.stopRequested = true;
    appState.pauseRequested = false;
    const total = getCodesFromStorage().length;
    const progress = getProgress(total);
    saveProgress(
      progress.nextIndex,
      total,
      true,
      progress.notFound
    );
    appState.automationState = "cancelled";
    setPanelMessage(
      "Automação cancelada. O progresso foi mantido. PLAY continua de onde parou."
    );
    addLog(
      "⛔ Automação cancelada. Progresso mantido."
    );
    updatePanel();
  }
  function restartAutomation() {
    if (appState.activeFlow === "pedido")
      return restartPedidoAutomation();
    appState.stopRequested = true;
    appState.pauseRequested = false;
    appState.currentRunPromise = null;
    const total = getCodesFromStorage().length;
    resetProgress(total);
    appState.automationState = "idle";
    setPanelMessage(
      "Progresso zerado. Clique PLAY para começar novamente."
    );
    addLog(
      "🔄 Progresso reiniciado."
    );
    updatePanel();
  }
  registerControls({
    play: playAutomation,
    pause: pauseAutomation,
    cancel: cancelAutomation,
    restart: restartAutomation
  });

  // src/transferencia.js
  var observacoesTimer = null;
  function scheduleObservacoes() {
    if (observacoesTimer) {
      clearTimeout(observacoesTimer);
    }
    observacoesTimer = setTimeout(() => {
      observacoesTimer = null;
      try {
        fillObservacoes();
      } catch (e) {
      }
    }, OBSERVER_DELAY);
  }
  function hotkeyMatches(e) {
    return e.ctrlKey === HOTKEY.ctrl && e.altKey === HOTKEY.alt && e.shiftKey === HOTKEY.shift && e.metaKey === HOTKEY.meta && String(e.key).toLowerCase() === String(HOTKEY.key).toLowerCase();
  }
  function hotkeyLabel() {
    const parts = [];
    if (HOTKEY.ctrl)
      parts.push("CTRL");
    if (HOTKEY.alt)
      parts.push("ALT");
    if (HOTKEY.shift)
      parts.push("SHIFT");
    if (HOTKEY.meta)
      parts.push("META");
    parts.push(
      String(
        HOTKEY.key
      ).toUpperCase()
    );
    return parts.join(" + ");
  }
  function toggleExtension() {
    appState.extensionEnabled = !appState.extensionEnabled;
    if (appState.extensionEnabled) {
      installStyles();
      setupAutomationButtons();
      createPanel();
      showToast(
        `AutomaÃ§Ã£o ativada â€” ${hotkeyLabel()} para desativar.`,
        "success"
      );
      return;
    }
    if (appState.automationState === "running") {
      appState.pauseRequested = true;
    }
    appState.extensionEnabled = false;
    removeExtensionUI();
    if (isAppSheetHost()) {
      setupCopiarAppSheet();
    }
  }
  function setupAutomationButtons() {
    if (!appState.extensionEnabled) {
      return;
    }
    if (appState.setupRunning)
      return;
    if (appState.automationState === "running") {
      return;
    }
    appState.setupRunning = true;
    try {
      installStyles();
      if (isAppSheetHost()) {
        setupCopiarAppSheet();
        return;
      }
      createPanel();
      setupPedidoAutomation();
      setupPreencherTransferencia();
      setupSortingAndIndexes();
      hookAdicionarButton();
      updatePanel();
    } finally {
      appState.setupRunning = false;
    }
  }
  function start() {
    appState.extensionEnabled = false;
    appState.automationState = "idle";
    appState.stopRequested = false;
    appState.pauseRequested = false;
    if (document.body) {
      observer.observe(
        document.body,
        {
          childList: true,
          subtree: true
        }
      );
    }
    try {
      fillObservacoes();
    } catch (e) {
    }
    if (isAppSheetHost()) {
      installStyles();
      setupCopiarAppSheet();
    }
    log(
      `ExtensÃ£o carregada desligada. Atalho: ${hotkeyLabel()}`
    );
  }
  document.addEventListener(
    "keydown",
    (e) => {
      if (!hotkeyMatches(e)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      toggleExtension();
    },
    true
  );
  var observer = new MutationObserver(
    () => {
      if (appState.automationState === "running") {
        return;
      }
      scheduleObservacoes();
      if (!appState.extensionEnabled) {
        return;
      }
      if (appState.observerTimer) {
        clearTimeout(
          appState.observerTimer
        );
      }
      appState.observerTimer = setTimeout(
        () => {
          appState.observerTimer = null;
          setupAutomationButtons();
        },
        OBSERVER_DELAY
      );
    }
  );
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      start
    );
  } else {
    start();
  }
})();
