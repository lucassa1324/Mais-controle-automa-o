/* =========================================================
   EXTRACAO NO APPSHEET
   ========================================================= */

import { cleanText, extractMatCode, parseQuantity, sleep } from './utils'
import { getVisibleTables, isAppSheetHost, isElementVisible } from './pages'
import { notifyCopied, saveExtractedItems, serializeClipboardPayload } from './copiar'
import { clearCopiedData } from './storage'
import { replaceClipboardText } from './clipboard'
import { addLog, createPanel, setPanelMessage, showToast, updatePanel } from './panel'
import { appState, registerControls } from './state'


/*
 * Cabecalho dos campos do AppSheet.
 *
 * O web app do AppSheet usa classes como
 * "field-header" / "field-title" / "column-name"
 * para o nome do campo e "field-value" para o valor.
 */
const FIELD_HEADER_SELECTOR = [
    '.field-header',
    '.field-title',
    '.field-label',
    '.field-name',
    '.column-name',
    '.cell-label',
    '.detail-label',
    '[class*="field-header"]',
    '[class*="field-title"]',
    '[class*="field-label"]',
    '[class*="field-name"]',
    '[class*="column-name"]',
    '[class*="detail-label"]'
].join(', ');


const VALUE_SELECTOR = [
    '.field-value',
    '.field-text',
    '.field-data',
    '.cell-value',
    '.detail-value',
    '.detail-data',
    '[class*="field-value"]',
    '[class*="field-data"]',
    '[class*="cell-value"]',
    '[class*="detail-value"]',
    '[class*="value-text"]'
].join(', ');


/*
 * Sinonimos dos campos de cabecalho.
 *
 * Os nomes sao comparados SEM acento
 * e sem os dois pontos.
 */
const FIELD_SYNONYMS = {

    observacoes: [
        'observacoes',
        'observacao',
        'obs'
    ],

    destino: [
        'destino',
        'obra',
        'local de destino',
        'local de entrega',
        'local'
    ],

    responsavel: [
        'responsavel',
        'solicitante',
        'requerente',
        'responsavel pela retirada'
    ],

    descricao: [
        'descricao',
        'cliente',
        'pedido',
        'nome',
        'titulo'
    ]
};


const QUANTITY_HEADERS = [
    'quantidade',
    'quantidade solicitada',
    'quantidade pedida',
    'qtde',
    'qtd',
    'qtd.',
    'qtd solicitada',
    'qtde solicitada',
    'quant',
    'quant.'
];


/* =========================================================
   NORMALIZACAO
   ========================================================= */

export function normalizeLabel(text) {

    return cleanText(text)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[:*]+$/, '')
        .replace(/\s+/g, ' ')
        .trim();
}


function normalizeSynonyms(list) {

    return list.map(normalizeLabel);
}


function readOwnValue(el) {

    if (!el)
        return '';

    const tag = String(el.tagName || '').toUpperCase();

    if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT'
    ) {

        const value = String(el.value ?? '').trim();

        if (value)
            return cleanText(value);
    }

    const inner = el.querySelector?.('input, textarea');

    if (inner) {

        const value = String(inner.value ?? '').trim();

        if (value)
            return cleanText(value);
    }

    return cleanText(el.innerText || el.textContent || '');
}


function isLabelLike(el) {

    const className = String(el?.className || '').toLowerCase();

    return /header|title|label/.test(className);
}


function readValueNear(node) {

    if (!node)
        return '';

    const tag = String(node.tagName || '').toUpperCase();

    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')
        return readOwnValue(node);

    const own = node.querySelector?.('input, textarea');

    if (own) {

        const value = String(own.value ?? '').trim();

        if (value)
            return cleanText(value);
    }

    const parent = node.parentElement;

    if (parent) {

        /*
         * 1) O valor vem logo depois do rotulo.
         */
        let next = node.nextElementSibling;

        while (next) {

            if (!isLabelLike(next)) {

                const value = readOwnValue(next);

                if (value)
                    return value;
            }

            next = next.nextElementSibling;
        }

        /*
         * 2) O valor esta em um bloco proprio
         *    dentro do mesmo pai.
         */
        const valueEl = parent.querySelector(VALUE_SELECTOR);

        if (valueEl && !valueEl.contains(node)) {

            const value = readOwnValue(valueEl);

            if (value)
                return value;
        }

        /*
         * 3) O campo e um input dentro do mesmo pai.
         */
        const parentInput = parent.querySelector('input, textarea');

        if (parentInput && parentInput !== node) {

            const value = String(parentInput.value ?? '').trim();

            if (value)
                return cleanText(value);
        }

        /*
         * 4) Pai com dois filhos: rotulo + valor.
         */
        const siblings = parent.children;

        if (siblings.length === 2 && siblings[0] === node) {

            const value = readOwnValue(siblings[1]);

            if (value)
                return value;
        }
    }

    return '';
}


/* =========================================================
   CAMPOS DE CABECALHO
   ========================================================= */

/**
 * Mapa "rotulo normalizado" -> "valor"
 *
 * junta varias estrategias de leitura,
 * porque o DOM do AppSheet muda conforme a versao.
 */
export function collectFieldValues(root = document) {

    const fields = new Map();

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


    /*
     * 1) Cabecalho de campo do AppSheet.
     */
    const headers = Array.from(
        root.querySelectorAll(FIELD_HEADER_SELECTOR)
    );

    for (const node of headers) {

        const label = cleanText(
            node.innerText || node.textContent || ''
        );

        set(label, readValueNear(node));
    }


    /*
     * 2) Bloco de detalhe do AppSheet.
     *
     * Algumas versoes nao usam "field-header", e sim
     * um container com o rotulo e o valor lado a lado.
     */
    const detailNodes = Array.from(
        root.querySelectorAll(
            '.detail-field, .detail-row, .detail-item, ' +
            '[class*="detail-field"], [class*="detail-row"], ' +
            '[class*="detail-item"]'
        )
    );

    for (const node of detailNodes) {

        const labelEl = node.querySelector(FIELD_HEADER_SELECTOR);

        if (!labelEl)
            continue;

        const label = cleanText(
            labelEl.innerText || labelEl.textContent || ''
        );

        let value = readValueNear(labelEl);

        if (!value) {

            const valueEl = node.querySelector(VALUE_SELECTOR);

            if (valueEl && !valueEl.contains(labelEl))
                value = readOwnValue(valueEl);
        }

        set(label, value);
    }


    /*
     * 3) aria-label.
     */
    const ariaNodes = Array.from(
        root.querySelectorAll('[aria-label]')
    );

    for (const node of ariaNodes) {

        const label = node.getAttribute('aria-label');

        if (!label)
            continue;

        set(label, readOwnValue(node));
    }


    /*
     * 4) <label> tradicional.
     */
    const labels = Array.from(
        root.querySelectorAll('label')
    );

    for (const node of labels) {

        const label = cleanText(
            node.innerText || node.textContent || ''
        );

        const value = readValueNear(node);

        if (!value && node.control)
            set(label, readOwnValue(node.control));
        else
            set(label, value);
    }


    /*
     * 5) Tabela de detalhe (th / td).
     */
    for (const table of getVisibleTables()) {

        const rows = Array.from(
            table.querySelectorAll('tr')
        );

        for (const row of rows) {

            const th = row.querySelector('th');

            if (!th)
                continue;

            const label = cleanText(th.innerText);

            const td = row.querySelector('td');

            if (td)
                set(label, readOwnValue(td));
        }
    }


    return fields;
}


export function pickField(fields, synonyms) {

    if (!fields)
        return '';

    const wanted = normalizeSynonyms(synonyms);

    for (const key of fields.keys()) {

        if (wanted.includes(key))
            return fields.get(key);
    }

    for (const key of fields.keys()) {

        if (wanted.some(term => key.startsWith(term)))
            return fields.get(key);
    }

    return '';
}


/* =========================================================
   METADADOS
   ========================================================= */

export function extractAppSheetMetadata() {

    const fields = collectFieldValues();

    const body = document.body?.innerText || '';

    const orderNumber =
        extractOrderNumber(fields, body);

    const description =
        extractDescription(fields);

    return { orderNumber, description };
}


function extractOrderNumber(fields, body) {

    /*
     * 1) Campo de observacoes (ex: "Pedido #184").
     */
    const observacoes = pickField(
        fields,
        FIELD_SYNONYMS.observacoes
    );

    const fromObservacoes = String(observacoes || '')
        .match(/#\s*(\d+)/)
        ||
        String(observacoes || '')
            .match(/\bpedido\s*(?:n[º°o.]*)?\s*(\d+)/i);

    if (fromObservacoes)
        return `#${fromObservacoes[1]}`;


    /*
     * 2) Campo do pedido.
     */
    const pedido = pickField(
        fields,
        FIELD_SYNONYMS.descricao
    );

    const fromPedido = String(pedido || '')
        .match(/#\s*(\d+)/);

    if (fromPedido)
        return `#${fromPedido[1]}`;


    /*
     * 3) Qualquer "#NNN" na tela.
     */
    const fromBody = String(body || '').match(/#\s*(\d+)/);

    if (fromBody)
        return `#${fromBody[1]}`;

    return '';
}


function extractDescription(fields) {

    const destino = pickField(
        fields,
        FIELD_SYNONYMS.destino
    );

    const responsavel = pickField(
        fields,
        FIELD_SYNONYMS.responsavel
    );

    const parts = [destino, responsavel]
        .map(part => cleanText(part || ''))
        .filter(Boolean);

    if (!parts.length) {

        const descricao = pickField(
            fields,
            FIELD_SYNONYMS.descricao
        );

        if (descricao)
            parts.push(cleanText(descricao));
    }

    return parts.join(' - ');
}


/* =========================================================
   TABELA DE ITENS
   ========================================================= */

function getCells(row) {

    if (!row)
        return [];

    const tds = Array.from(row.querySelectorAll('td'));

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

    if (row.closest?.('thead'))
        return true;

    const cells = getCells(row);

    if (!cells.length)
        return true;

    return cells.every(
        cell =>
            String(cell.tagName || '').toUpperCase() === 'TH'
    );
}


function getTableHeaders(table) {

    const ths = Array.from(
        table.querySelectorAll('thead th')
    );

    if (ths.length) {

        return ths.map(
            th => cleanText(th.innerText)
        );
    }

    const firstRow = table.querySelector('tr');

    if (firstRow) {

        const rowThs = Array.from(
            firstRow.querySelectorAll('th')
        );

        if (rowThs.length) {

            return rowThs.map(
                th => cleanText(th.innerText)
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
        header => wanted.includes(normalizeLabel(header))
    );

    if (exact >= 0)
        return exact;

    return headers.findIndex(
        header => wanted.some(
            term => normalizeLabel(header).includes(term)
        )
    );
}


function readQuantity(cells, codeIndex, headers) {

    /*
     * 1) Coluna pela coluna (ex: "Quantidade").
     */
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


    /*
     * 2) Primeiro numero da linha
     *    (fora da celula do codigo).
     */
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


/*
 * O DOM do AppSheet nao e estavel: a mesma lista pode vir em
 * <table>, em divs com role="row" ou em blocos com classes
 * genericas. Por isso a varredura abaixo aceita qualquer
 * elemento que contenha um codigo MAT.
 */
const MAX_ROW_TEXT_LENGTH = 500;
const MAX_FALLBACK_SEGMENT = 400;

/*
 * Limites de seguranca para a varredura de tabelas virtualizadas.
 */
const VIRTUAL_MAX_SCROLL_STEPS = 200;
const VIRTUAL_NO_PROGRESS_LIMIT = 3;
const VIRTUAL_SCROLL_SETTLE_MS = 120;


function matCodeCount(text) {

    const matches = String(text || '')
        .match(/\bMAT\s*[-_]?\s*\d+\b/gi);

    return matches ? matches.length : 0;
}


function looksLikeRow(node) {

    if (!node)
        return false;

    const tag = String(node.tagName || '').toUpperCase();

    if (tag === 'TR')
        return true;

    const role = String(
        node.getAttribute?.('role') || ''
    ).toLowerCase();

    if (role === 'row')
        return true;

    const className = String(node.className || '');

    if (/(^|[\s_-])(row|data-row|grid-row|table-row|list-row)([\s_-]|$)/i.test(className))
        return true;

    const cells = getCells(node);

    const filled = cells.filter(
        cell => readOwnValue(cell)
    );

    return cells.length >= 2 && filled.length >= 2;
}


/**
 * Sobe do elemento que contem o MAT ate o container da linha.
 *
 * O limite e o primeiro ancestral que passaria a englobar
 * outro MAT (a lista inteira) ou um bloco grande demais.
 */
function findRowFor(node) {

    let current = node;
    let best = node;

    /*
     * O proprio elemento ja e uma linha (tr / role=row /
     * container com varias celulas): nao precisa subir.
     */
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


const ACTIVE_ROW_SELECTOR = [
    'tr',
    '[role="row"]',
    '[class*="data-row"]',
    '[class*="grid-row"]',
    '[class*="list-row"]',
    '[class*="item-row"]'
].join(', ');


function isWithinViewport(el) {

    if (!el)
        return false;

    const rect =
        el.getBoundingClientRect?.();

    if (!rect)
        return isElementVisible(el);

    const left = Number(
        rect.left ?? 0
    );

    const top = Number(
        rect.top ?? 0
    );

    const width = Number(
        rect.width ?? (rect.right - rect.left)
    );

    const height = Number(
        rect.height ?? (rect.bottom - rect.top)
    );

    if (!(width > 0) || !(height > 0))
        return false;

    const right = Number(
        rect.right ?? (left + width)
    );

    const bottom = Number(
        rect.bottom ?? (top + height)
    );

    const viewportWidth = Number(
        typeof window !== 'undefined'
            ? window.innerWidth
            : 0
    );

    const viewportHeight = Number(
        typeof window !== 'undefined'
            ? window.innerHeight
            : 0
    );

    if (!(viewportWidth > 0) || !(viewportHeight > 0))
        return true;

    if (top < 0 || bottom > viewportHeight)
        return false;

    return (
        bottom > 0 &&
        right > 0 &&
        top < viewportHeight &&
        left < viewportWidth
    );
}


function isActiveOnScreen(el) {

    if (!el)
        return false;

    if (!isElementVisible(el))
        return false;

    if (typeof el.getBoundingClientRect !== 'function')
        return false;

    const rect = el.getBoundingClientRect();
    if (!rect)
        return false;

    const width = Number(rect.width ?? (rect.right - rect.left));
    const height = Number(rect.height ?? (rect.bottom - rect.top));
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

    return Boolean(row) &&
        !isHeaderRow(row) &&
        matCodeCount(readOwnValue(row)) === 1;
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


/*
 * Sobe a partir da linha procurando o ancestor que de fato
 * controla a rolagem vertical da tabela.
 *
 * Evita escolher o primeiro "overflow: auto" arbitrario:
 * prioriza o container mais interno que realmente rola
 * (scrollHeight > clientHeight) e, so depois, aceita o
 * mais interno com overflow declarado (para listas pequenas
 * sem rolagem, onde o container apenas recorta a area).
 */
function findScrollableContainer(node) {

    let innermost = null;
    let current = node;

    while (
        current &&
        current !== document.body &&
        current !== document.documentElement
    ) {

        const style = typeof window.getComputedStyle === 'function'
            ? window.getComputedStyle(current)
            : null;

        if (style) {

            const overflowY = String(style.overflowY || '');
            const overflowX = String(style.overflowX || '');

            if (
                /auto|scroll|overlay/i.test(overflowY) ||
                /auto|scroll|overlay/i.test(overflowX)
            ) {

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


/*
 * Identifica o container da tabela avaliando todos os ancestors
 * das linhas candidatas e escolhendo aquele que engloba o maior
 * numero de linhas de dados (desempate: o mais profundo).
 *
 * Isso evita confundir um menu/sidebar com overflow:auto, ja que
 * esses elementos nao sao ancestors das linhas da tabela.
 */
function identifyTableContainer(scope) {

    const root = scope || document;

    if (!root || typeof root.querySelectorAll !== 'function')
        return null;

    const rowEls = Array.from(
        root.querySelectorAll(ACTIVE_ROW_SELECTOR)
    );

    const dataRows = rowEls.filter(isDataRowCandidate);

    const pool = dataRows.length ? dataRows : rowEls;

    const candidates = new Map();

    for (const row of pool) {

        const container =
            findScrollableContainer(row);

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

        if (
            !best ||
            count > best.count ||
            (
                count === best.count &&
                nodeDepth(container) > nodeDepth(best.container)
            )
        ) {
            best = { container, count };
        }
    }

    return best ? best.container : null;
}


function getTableContainerRect(scope) {

    const container = identifyTableContainer(scope);

    if (
        !container ||
        typeof container.getBoundingClientRect !== 'function'
    ) {
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

    const width = Number(rect.width ?? (rect.right - rect.left));
    const height = Number(rect.height ?? (rect.bottom - rect.top));

    if (!(width > 0) || !(height > 0))
        return false;

    if (containerRect) {

        const rowTop = Number(rect.top ?? 0);
        const rowBottom = Number(rect.bottom ?? (rowTop + height));
        const rowLeft = Number(rect.left ?? 0);
        const rowRight = Number(rect.right ?? (rowLeft + width));

        const cTop = Number(containerRect.top ?? 0);
        const cBottom = Number(containerRect.bottom ?? (cTop + (containerRect.height ?? 0)));
        const cLeft = Number(containerRect.left ?? 0);
        const cRight = Number(containerRect.right ?? (cLeft + (containerRect.width ?? 0)));

        const vertical =
            rowBottom >= cTop &&
            rowTop <= cBottom;

        const horizontal =
            rowRight >= cLeft &&
            rowLeft <= cRight;

        return vertical && horizontal;
    }

    return true;
}


function getActiveDataRows(scope, debug = false) {

    const root = scope || document;

    const viewportHeight = Number(
        typeof window !== 'undefined'
            ? window.innerHeight
            : 0
    );

    const containerRect = getTableContainerRect(scope);
    const scrollContainer = identifyTableContainer(scope);

    return Array.from(
        root.querySelectorAll(ACTIVE_ROW_SELECTOR)
    ).filter(
        row => {

            let skipReason = '';

            const rect = typeof row.getBoundingClientRect === 'function'
                ? row.getBoundingClientRect()
                : null;

            const logRow = passed => {

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
                    width: Math.round(rect.width ?? (rect.right - rect.left)),
                    height: Math.round(rect.height ?? (rect.bottom - rect.top))
                } : null;

                console.log(
                    '[AppSheet Extractor] Elemento verificado:',
                    { texto: text, rect: rectInfo, passou: passed },
                    passed ? '' : `| Motivo: ${skipReason}`
                );
            };

            if (!isDataRowCandidate(row)) {
                skipReason = 'Não é linha de dados (sem MAT único ou é cabeçalho)';
                logRow(false);
                return false;
            }
            if (!isElementVisible(row)) {
                skipReason = 'Oculto';
                logRow(false);
                return false;
            }
            if (typeof row.getBoundingClientRect !== 'function') {
                skipReason = 'Sem getBoundingClientRect';
                logRow(false);
                return false;
            }
            if (!rect) {
                skipReason = 'Sem rect válido';
                logRow(false);
                return false;
            }
            const width = Number(rect.width ?? (rect.right - rect.left));
            const height = Number(rect.height ?? (rect.bottom - rect.top));
            if (!(width > 0) || !(height > 0)) {
                skipReason = 'Dimensões zeradas';
                logRow(false);
                return false;
            }

            if (scrollContainer && scrollContainer.contains(row)) {
                logRow(true);
                return true;
            }

            if (containerRect) {
                if (!isRowInVisibleArea(rect, containerRect, viewportHeight)) {
                    skipReason = 'Fora do container visível da tabela';
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

    const candidates = new Map();

    const add = container => {

        if (
            !container ||
            container === document.body ||
            container === document.documentElement
        ) {
            return;
        }

        if (candidates.has(container))
            return;

        if (!isActiveOnScreen(container))
            return;

        const score =
            getActiveDataRows(container).length;

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

        add(row.closest?.('table'));

        add(
            row.closest?.(
                '[role="grid"], [role="treegrid"], [role="table"], ' +
                '[class*="related"], [class*="list"], [class*="grid"]'
            )
        );
    }


    let best = null;

    for (const candidate of candidates.values()) {

        if (
            !best ||
            candidate.score > best.score ||
            (
                candidate.score === best.score &&
                candidate.depth > best.depth
            )
        ) {
            best = candidate;
        }
    }

    return best ? best.container : null;
}


function findHeadersFor(row) {

    const table = row?.closest?.('table');

    if (table)
        return getTableHeaders(table);

    const container =
        row?.parentElement || row;

    if (!container)
        return [];

    return Array.from(
        container.querySelectorAll('[role="columnheader"]')
    )
        .filter(isActiveOnScreen)
        .map(header => cleanText(header.innerText));
}


function collectDataRows() {

    const rows = [];

    const seen = new Set();

    const viewportHeight = Number(
        typeof window !== 'undefined'
            ? window.innerHeight
            : 0
    );

    const add = (row, headers) => {

        if (!row)
            return;
        if (seen.has(row))
            return;
        if (!isElementVisible(row))
            return;
        if (typeof row.getBoundingClientRect !== 'function')
            return;
        const rect = row.getBoundingClientRect();
        if (!rect)
            return;
        const width = Number(rect.width ?? (rect.right - rect.left));
        const height = Number(rect.height ?? (rect.bottom - rect.top));
        if (!(width > 0) || !(height > 0))
            return;
        if (!isRowInVisibleArea(rect, containerRect, viewportHeight))
            return;
        if (!isDataRowCandidate(row))
            return;

        seen.add(row);

        rows.push({ row, headers: headers || [] });
    };


    const scope =
        findActiveItemsContainer();

    const containerRect =
        getTableContainerRect(scope);


    for (const row of getActiveDataRows(scope || document.body, true))
        add(row, findHeadersFor(row));


    /*
     * Listas sem tr/role=row/classes de linha: procura apenas
     * o elemento mais interno com MAT dentro do container ativo
     * (ou, na ausencia dele, dentro do que esta visivel na tela).
     */
    if (!rows.length) {

        const leafScope =
            scope || document.body;

        const all = Array.from(
            leafScope.querySelectorAll('*')
        );

        for (const node of all) {

            if (!isElementVisible(node))
                continue;
            if (typeof node.getBoundingClientRect !== 'function')
                continue;
            const nrect = node.getBoundingClientRect();
            if (!nrect)
                continue;
            const nwidth = Number(nrect.width ?? (nrect.right - nrect.left));
            const nheight = Number(nrect.height ?? (nrect.bottom - nrect.top));
            if (!(nwidth > 0) || !(nheight > 0))
                continue;
            if (!isRowInVisibleArea(nrect, containerRect, viewportHeight))
                continue;

            const text = node.textContent || '';

            if (!text || text.length > MAX_ROW_TEXT_LENGTH)
                continue;

            if (matCodeCount(text) !== 1)
                continue;

            const hasChildWithMat = Array.from(node.children || [])
                .some(child =>
                    /\bMAT\s*[-_]?\s*\d+\b/i.test(child.textContent || '')
                );

            if (hasChildWithMat)
                continue;

            const row = findRowFor(node);

            add(row, findHeadersFor(row));
        }
    }

    return { rows, scope };
}


/* =========================================================
   QUANTIDADE A PARTIR DE TEXTO
   ========================================================= */

function numericCandidates(value) {

    const candidates = [];

    const re = /-?\d+(?:[.,]\d+)?/g;

    let match;

    while ((match = re.exec(value))) {

        const raw = match[0];
        const start = match.index;
        const end = start + raw.length;

        const before = value[start - 1];
        const after = value[end];

        if (before === '#' || before === '/' || after === '/')
            continue;

        const around = value.slice(
            Math.max(0, start - 6),
            Math.min(value.length, end + 6)
        );

        if (/\d{1,4}[\/.-]\d{1,2}[\/.-]\d{1,4}/.test(around))
            continue;

        candidates.push(raw);
    }

    return candidates;
}


function readQuantityFromText(text, code) {

    let value = String(text || '');

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

    value = value.replace(/^[\s:;|,\-]+/, '');

    if (!value)
        return null;


    /*
     * 1) Rotulo explicito ("Quantidade: 4").
     */
    const labelled = value.match(
        /(?:quantidade|quant\.?|qtde\.?|qtd\.?)\s*[:.\-]?\s*(\d+(?:[.,]\d+)?)/i
    );

    if (labelled) {

        const parsed = parseQuantity(labelled[1]);

        if (parsed != null)
            return parsed;
    }


    /*
     * 2) Linha composta apenas pelo numero (com unidade opcional).
     */
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


    /*
     * 3) Ultimo numero valido depois do codigo.
     *
     * A quantidade normalmente fica depois da descricao,
     * por isso o ultimo numero e a melhor aposta.
     */
    const candidates = numericCandidates(value);

    if (!candidates.length)
        return null;

    return parseQuantity(candidates[candidates.length - 1]);
}


/**
 * Fallback: varre o texto visivel da pagina.
 *
 * Primeiro linha a linha e depois em segmentos entre um
 * MAT e o proximo, para cobrir celulas que o innerText
 * separa em varias linhas.
 */
function extractItemsFromVisibleText(text) {

    const items = {};

    const source = String(text || '');

    if (!source || !/\bMAT\s*[-_]?\s*\d+\b/i.test(source))
        return items;


    const lines = source.split(/\r?\n/);

    for (const line of lines) {

        if (!/\bMAT\s*[-_]?\s*\d+\b/i.test(line))
            continue;

        const matches = Array.from(
            line.matchAll(/\bMAT\s*[-_]?\s*\d+\b/gi)
        );

        for (let i = 0; i < matches.length; i++) {

            const match = matches[i];
            const code = extractMatCode(match[0]);

            if (!code || items[code])
                continue;

            const start = match.index + match[0].length;

            const end = i + 1 < matches.length
                ? matches[i + 1].index
                : line.length;

            const quantity = readQuantityFromText(
                line.slice(start, end),
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

        const start = match.index + match[0].length;

        const nextStart = i + 1 < matches.length
            ? matches[i + 1].index
            : source.length;

        const end = Math.min(
            nextStart,
            start + MAX_FALLBACK_SEGMENT
        );

        const quantity = readQuantityFromText(
            source.slice(start, end),
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


export function extractAppSheetItems() {

    const items = {};

    const viewportHeight = Number(
        typeof window !== 'undefined'
            ? window.innerHeight
            : 0
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


    const { rows: dataRows, scope } =
        collectDataRows();

    const containerRect =
        getTableContainerRect(scope);
    const scrollContainer =
        identifyTableContainer(scope);


    for (const { row, headers } of dataRows) {

        if (!row)
            continue;

        if (!isElementVisible(row))
            continue;

        if (typeof row.getBoundingClientRect !== 'function')
            continue;

        const rect = row.getBoundingClientRect();
        if (!rect)
            continue;

        const width = Number(rect.width ?? (rect.right - rect.left));
        const height = Number(rect.height ?? (rect.bottom - rect.top));
        if (!(width > 0) || !(height > 0))
            continue;

        if (scrollContainer && scrollContainer.contains(row)) {
        } else if (containerRect) {
            if (!isRowInVisibleArea(rect, containerRect, viewportHeight)) {
                continue;
            }
        } else if (!containerRect && viewportHeight > 0) {
            const top = Number(rect.top ?? 0);
            const bottom = Number(rect.bottom ?? (top + height));
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
            if (typeof cell.getBoundingClientRect === 'function') {
                const crect = cell.getBoundingClientRect();
                if (crect) {
                    const cwidth = Number(crect.width ?? (crect.right - crect.left));
                    const cheight = Number(crect.height ?? (crect.bottom - crect.top));
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


    /*
     * Ultimo recurso: so usa texto quando a varredura
     * estruturada nao encontrou nenhum item. Assim linhas
     * antigas/ocultas do DOM nao se somam ao pedido atual.
     */
    if (!Object.keys(items).length) {

        const fallbackSource =
            scope || document.body;

        if (!fallbackSource)
            return items;

        if (!isElementVisible(fallbackSource))
            return items;

        if (typeof fallbackSource.getBoundingClientRect === 'function') {
            const frect = fallbackSource.getBoundingClientRect();
            if (frect) {
                const fwidth = Number(frect.width ?? (frect.right - frect.left));
                const fheight = Number(frect.height ?? (frect.bottom - frect.top));
                if (!(fwidth > 0) || !(fheight > 0))
                    return items;
            }
        }

        const fallbackText =
            fallbackSource?.innerText ||
            fallbackSource?.textContent ||
            '';

        const fallbackItems =
            extractItemsFromVisibleText(fallbackText);

        for (const code of Object.keys(fallbackItems)) {

            if (!items[code])
                items[code] = fallbackItems[code];
        }
    }

    return items;
}


/* =========================================================
   BOTAO
   ========================================================= */

export function copyAppSheetInsumos() {

    console.log(
        `[AppSheet Extractor] 🔄 Hard Reset executado. A limpar buffers, storage e clipboard...`
    );

    const items = {};

    if (appState) {
        appState.copySummary = null;
    }

    if (!isAppSheetHost()) {

        setPanelMessage(
            'Abra uma tela do AppSheet para copiar os insumos.'
        );

        return false;
    }


    clearCopiedData();

    if (appState) {
        appState.copySummary = null;
    }

    const extracted =
        extractAppSheetItems();
    Object.keys(extracted).forEach(key => {
        items[key] = extracted[key];
    });

    const metadata =
        extractAppSheetMetadata();

    const count =
        saveExtractedItems(
            items,
            metadata
        );


    if (!count) {

        appState.copySummary = null;

        setPanelMessage(
            'Nenhum MAT + quantidade foi encontrado no AppSheet.'
        );

        updatePanel();

        showToast(
            'Nenhum insumo encontrado no AppSheet.',
            'warning'
        );

        return false;
    }


    appState.copySummary = {
        count,
        source: 'AppSheet'
    };


    console.log(
        `[AppSheet Extractor] 📦 Payload final gerado (Total de ${count} itens):`,
        JSON.stringify(items, null, 2)
    );


    const clipboardJson =
        serializeClipboardPayload(items, metadata);

    replaceClipboardText(clipboardJson)
        .then(copied => {

            if (copied) {

                addLog(
                    '✅ Dados copiados para a Área de Transferência (Ctrl+C)!'
                );

                return;
            }

            addLog(
                '⚠️ Não foi possível copiar os dados para a Área de Transferência.'
            );

            showToast(
                'Copie manualmente: a área de transferência foi bloqueada.',
                'warning'
            );
        })
        .catch(() => {

            addLog(
                '⚠️ Falha ao copiar os dados para a Área de Transferência.'
            );
        });


    notifyCopied(
        count,
        metadata,
        'AppSheet'
    );

    return true;
}


export function setupCopiarAppSheet() {

    /*
     * No AppSheet o painel aparece sempre:
     *
     * o botao de copia fica dentro dele,
     * sem criar botoes soltos na tela.
     */
    if (!isAppSheetHost())
        return;

    createPanel(true);

    updatePanel();
}


registerControls({
    copyAppSheet: copyAppSheetInsumos
});
