/* =========================================================
   ARMAZENAMENTO COMPARTILHADO (GM_* + localStorage)
   ========================================================= */

import { CLIPBOARD_SOURCE, PEDIDO_PROGRESS_KEY, POSITION_KEY, PROGRESS_KEY, STORAGE_KEY } from './config'
import { normalizeMatCode } from './utils'

/*
 * O AppSheet e o Mais Controle ficam em origens diferentes,
 * por isso o localStorage sozinho nao sincroniza as abas.
 *
 * GM_setValue / GM_getValue usam a memoria do UserScript e
 * atravessam dominios. O localStorage continua como fallback
 * (testes e ambientes sem Tampermonkey).
 */
export function saveStorageData(key, data) {

    const jsonValue = JSON.stringify(data);

    try {
        if (typeof GM_setValue !== 'undefined')
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


export function getStorageData(key, defaultValue = null) {

    try {

        let raw = null;

        if (typeof GM_getValue !== 'undefined')
            raw = GM_getValue(key, null);

        /*
         * Fallback/migracao: dados antigos gravados apenas
         * no localStorage da origem atual.
         */
        if (raw === null || raw === undefined || raw === '') {

            try {
                raw = localStorage.getItem(key);
            } catch (e) {
                raw = null;
            }
        }

        if (raw === null || raw === undefined || raw === '')
            return defaultValue;

        if (typeof raw !== 'string')
            return raw;

        return JSON.parse(raw);

    } catch (err) {
        console.error(`[Storage] Erro ao ler chave ${key}:`, err);
        return defaultValue;
    }
}


export function removeStorageData(key) {

    try {
        if (typeof GM_deleteValue !== 'undefined')
            GM_deleteValue(key);
        else if (typeof GM_setValue !== 'undefined')
            GM_setValue(key, '');
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
        orderNumber: '',
        description: ''
    };
}

function normalizeMetadata(meta) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
        return emptyMetadata();
    }

    return {
        orderNumber: String(meta.orderNumber ?? '').trim(),
        description: String(meta.description ?? '').trim()
    };
}

function parsePayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {
            metadata: emptyMetadata(),
            items: {}
        };
    }

    const hasItems = raw.items && typeof raw.items === 'object' && !Array.isArray(raw.items);
    const hasMetadata = raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata);

    if (hasItems) {
        const items = {};
        Object.keys(raw.items).forEach(key => {
            if (key === 'metadata') return;
            items[key] = raw.items[key];
        });
        return {
            metadata: normalizeMetadata(hasMetadata ? raw.metadata : (raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {})),
            items
        };
    }

    if (hasMetadata) {
        const items = {};
        Object.keys(raw).forEach(key => {
            if (key === 'metadata') return;
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

export function getStoredPayload() {
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

export function getMetadataFromStorage() {
    return getStoredPayload().metadata;
}

export function getItemsFromStorage() {
    return getStoredPayload().items;
}

export function getCodesFromStorage() {
    try {
        const items = getItemsFromStorage();
        return Object.keys(items)
            .map(normalizeMatCode)
            .filter(Boolean);
    } catch (e) {
        return [];
    }
}

export function clearCopiedData() {

    removeStorageData(STORAGE_KEY);

    clearProgress();
    clearPedidoProgress();
}


export function saveCopiedItems(items, metadata) {

    const cleanItems = {};

    Object.keys(items || {}).forEach(key => {
        if (key !== 'metadata')
            cleanItems[key] = items[key];
    });

    const sortedItems = {};

    Object.keys(cleanItems).sort(
        (a, b) => a.localeCompare(b, 'pt-BR', {
            sensitivity: 'base',
            numeric: true
        })
    ).forEach(code => {
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

    if (!items || typeof items !== 'object' || Array.isArray(items))
        return normalized;

    Object.keys(items).forEach(key => {

        const raw = items[key];

        const item =
            raw && typeof raw === 'object'
                ? raw
                : {};

        const code =
            normalizeMatCode(item.code || key) ||
            String(item.code || key || '').trim().toUpperCase();

        const quantity = String(
            raw && typeof raw === 'object'
                ? item.quantity ?? ''
                : raw ?? ''
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
        (a, b) => a.localeCompare(b, 'pt-BR', {
            sensitivity: 'base',
            numeric: true
        })
    ).forEach(code => {
        sorted[code] = normalized[code];
    });

    return sorted;
}


/**
 * Valida o JSON vindo do Clipboard.
 *
 * Aceita string JSON ou o objeto ja interpretado.
 */
export function parseClipboardPayload(value) {

    let data = value;

    if (typeof data === 'string') {

        try {
            data = JSON.parse(data);
        } catch (err) {
            return null;
        }
    }

    if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data)
    ) {
        return null;
    }

    if (String(data.source || '') !== CLIPBOARD_SOURCE)
        return null;

    const parsed = parsePayload(data);

    const items = normalizeClipboardItems(parsed.items);

    if (!Object.keys(items).length)
        return null;

    const timestamp = Number(data.timestamp);

    return {
        source: CLIPBOARD_SOURCE,
        timestamp: Number.isFinite(timestamp)
            ? timestamp
            : Date.now(),
        metadata: parsed.metadata,
        items
    };
}


/**
 * Salva no storage local o payload recebido pelo Clipboard.
 */
export function saveClipboardPayload(payload) {

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

        if (
            !saved ||
            Number(saved.total) !== Number(total)
        ) {
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

            notFound: Array.isArray(saved.notFound)
                ? saved.notFound
                : []
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


function writeProgress(
    key,
    nextIndex,
    total,
    paused = false,
    notFound = null
) {

    const old = readProgress(key, total);

    saveStorageData(
        key,
        {
            nextIndex,

            total,

            paused,

            notFound:
                Array.isArray(notFound)
                    ? notFound
                    : old.notFound,

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


export function getProgress(total) {
    return readProgress(PROGRESS_KEY, total);
}


export function saveProgress(
    nextIndex,
    total,
    paused = false,
    notFound = null
) {
    writeProgress(
        PROGRESS_KEY,
        nextIndex,
        total,
        paused,
        notFound
    );
}


export function resetProgress(total) {
    clearStoredProgress(PROGRESS_KEY, total);
}


export function clearProgress() {
    removeStorageData(PROGRESS_KEY);
}


/* =========================================================
   PROGRESSO DA AUTOMACAO DE PEDIDOS (independente)
   ========================================================= */

export function getPedidoProgress(total) {
    return readProgress(PEDIDO_PROGRESS_KEY, total);
}


export function savePedidoProgress(
    nextIndex,
    total,
    paused = false,
    notFound = null
) {
    writeProgress(
        PEDIDO_PROGRESS_KEY,
        nextIndex,
        total,
        paused,
        notFound
    );
}


export function resetPedidoProgress(total) {
    clearStoredProgress(PEDIDO_PROGRESS_KEY, total);
}


export function clearPedidoProgress() {
    removeStorageData(PEDIDO_PROGRESS_KEY);
}


export function loadPanelPosition() {

    try {

        const pos = getStorageData(POSITION_KEY, null);

        if (!pos) return null;

        if (
            !Number.isFinite(pos.left) ||
            !Number.isFinite(pos.top)
        ) {
            return null;
        }

        return pos;

    } catch (e) {

        return null;
    }
}


export function savePanelPosition(panel) {

    if (!panel) return;

    const rect =
        panel.getBoundingClientRect();

    saveStorageData(
        POSITION_KEY,
        {
            left: Math.round(rect.left),
            top: Math.round(rect.top)
        }
    );
}


let progressListener = null;

/**
 * Registra o callback disparado sempre que o progresso e salvo.
 *
 * O painel usa isso para se atualizar sem precisar
 * importar de volta (evitando ciclo com panel.js).
 */
export function setProgressListener(listener) {
    progressListener = listener;
}

function notifyProgressChanged() {
    if (progressListener) {
        progressListener();
    }
}
