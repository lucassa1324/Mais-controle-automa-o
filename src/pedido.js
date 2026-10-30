/* =========================================================
   COPIAR INSUMOS DO PEDIDO
   ========================================================= */

import { appState, registerControls } from './state'
import { cleanText, extractMatCode, parseQuantity } from './utils'
import { isAppSheetHost, isPedidoPage } from './pages'
import { notifyCopied, saveExtractedItems } from './copiar'
import { clearCopiedData } from './storage'
import { createPanel, setPanelMessage, showToast, updatePanel } from './panel'
import { getRelevantTables } from './tables'

export function extractOrderMetadata() {
    let body = '';
    if (document.body) {
        body = document.body.innerText || '';
    }

    const title = document.title || body || '';

    let orderNumber = '';

    const match = title.match(/solicita(?:ç|c)[ãa]o\s*#\s*(\d+)/i)
        || body.match(/solicita(?:ç|c)[ãa]o\s*#\s*(\d+)/i)
        || body.match(/pedido\s*#\s*(\d+)/i)
        || body.match(/#\s*(\d+)/);

    if (match && match[1]) {
        orderNumber = `#${match[1]}`;
    }

    let description = extractDescription(title, body);

    return { orderNumber, description };
}

function extractDescription(title, body) {
    const labels = Array.from(document.querySelectorAll('label, th, legend, span, div, p'));

    const candidates = labels
        .map(el => ({ el, text: cleanText(el.innerText || el.textContent || '') }))
        .filter(x => /^descri(?:ç|c)[ãa]o$/i.test(x.text))
        .sort((a, b) => a.text.length - b.textLength);

    for (const { el } of candidates) {
        const value = readValueFromLabel(el);
        if (value) return value;
    }

    const m = body.match(/descri(?:ç|c)[ãa]o\s*[:\-]?\s*(.+?)(?:\n|\r|$)/i)
        || title.match(/descri(?:ç|c)[ãa]o\s*[:\-]?\s*(.+?)(?:\n|\r|$)/i);

    return m ? cleanText(m[1]) : '';
}

function readValueFromLabel(label) {
    if (label.control) {
        const v = String(label.control.value ?? '').trim();
        if (v) return cleanText(v);
    }

    const scoped = label.querySelector('input, textarea') || label.parentElement?.querySelector('input, textarea');
    if (scoped) {
        const v = String(scoped.value ?? '').trim();
        if (v) return cleanText(v);
    }

    const next = label.nextElementSibling;
    if (next) {
        const v = String(next.value ?? '').trim();
        if (v) return cleanText(v);
        const inner = cleanText(next.innerText || next.textContent || '');
        if (inner && !/^descri(?:ç|c)[ãa]o$/i.test(inner)) return inner;
    }

    const parent = label.parentElement;
    if (parent) {
        const inner = cleanText(parent.innerText || parent.textContent || '').replace(/descri(?:ç|c)[ãa]o/i, '').trim();
        if (inner && inner.length > 2) return inner;
    }

    return '';
}

export function getHeaderIndex(table) {

    const headers =
        Array.from(
            table.querySelectorAll(
                'thead th, tr:first-child th'
            )
        )
        .map(
            th =>
                cleanText(
                    th.innerText
                ).toLowerCase()
        );


    const find = (...terms) =>
        headers.findIndex(
            h =>
                terms.some(
                    t =>
                        h.includes(t)
                )
        );


    return {

        item:
            find(
                'item',
                'material',
                'descrição',
                'descricao'
            ),

        quantity:
            find(
                'qtde solicitada',
                'quantidade solicitada',
                'qtde'
            ),

        unit:
            find(
                'unid',
                'unidade'
            )
    };
}


export function extractPedidoItems() {

    const tables =
        getRelevantTables();


    const items = {};


    for (
        const table of tables
    ) {

        const rows =
            Array.from(
                table.querySelectorAll(
                    'tbody tr, tr'
                )
            )
            .filter(
                row =>
                    row.querySelectorAll(
                        'td'
                    ).length > 0
            );


        const indexes =
            getHeaderIndex(
                table
            );


        for (
            const row of rows
        ) {

            const text =
                cleanText(
                    row.innerText
                );


            const code =
                extractMatCode(
                    text
                );


            if (!code)
                continue;


            const cells =
                Array.from(
                    row.querySelectorAll(
                        'td'
                    )
                );


            let quantity =
                null;


            if (
                indexes.quantity >= 0 &&
                cells[indexes.quantity]
            ) {

                quantity =
                    parseQuantity(
                        cells[indexes.quantity]
                            .innerText
                    );
            }


            if (
                quantity == null
            ) {

                for (
                    const cell of cells
                ) {

                    const cellText =
                        cleanText(
                            cell.innerText
                        );


                    if (
                        /^\d+(?:[.,]\d+)?$/
                            .test(
                                cellText
                            )
                    ) {

                        quantity =
                            parseQuantity(
                                cellText
                            );


                        if (
                            quantity != null
                        ) {
                            break;
                        }
                    }
                }
            }


            if (
                quantity == null
            ) {
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


export function copyPedidoInsumos() {

    if (isAppSheetHost() || !isPedidoPage()) {

        setPanelMessage(
            'Abra a tela do Pedido/Solicitação para copiar os insumos.'
        );

        return false;
    }


    clearCopiedData();

    appState.copySummary = null;

    const items =
        extractPedidoItems();

    const metadata =
        extractOrderMetadata();

    const count =
        saveExtractedItems(
            items,
            metadata
        );


    if (!count) {

        setPanelMessage(
            'Nenhum MAT + quantidade foi encontrado nesta página.'
        );

        showToast(
            'Nenhum insumo encontrado na solicitação.',
            'warning'
        );

        return false;
    }


    notifyCopied(
        count,
        metadata,
        'pedido'
    );

    return true;
}


export function setupCopiarPedido() {

    if (
        !appState.extensionEnabled ||
        !isPedidoPage() ||
        isAppSheetHost()
    ) {
        return;
    }

    createPanel();

    updatePanel();
}


registerControls({
    copyPedido: copyPedidoInsumos
});
