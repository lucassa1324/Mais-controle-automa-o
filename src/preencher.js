/* =========================================================
   PREENCHIMENTO (OBSERVACOES E QUANTIDADES)
   ========================================================= */

import { ERP } from './config'
import { appState, registerControls } from './state'
import { cleanText, extractMatCode, normalizeMatCode } from './utils'
import { getItemsFromStorage, getMetadataFromStorage } from './storage'
import { getAdicionarInsumoModal, isTransferenciaPage } from './pages'
import { addLog, setPanelMessage, showToast, updatePanel } from './panel'

const FIELD_SELECTOR = 'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="button"]):not([type="submit"]), textarea';


export function setInputValue(
    input,
    value
) {

    if (!input)
        return false;

    const tag = String(input.tagName || '').toUpperCase();

    const ctor = tag === 'TEXTAREA'
        ? (typeof HTMLTextAreaElement !== 'undefined' ? HTMLTextAreaElement : null)
        : (typeof HTMLInputElement !== 'undefined' ? HTMLInputElement : null);

    const descriptor = ctor
        ? Object.getOwnPropertyDescriptor(ctor.prototype, 'value')
        : null;

    if (input.focus) input.focus();

    if (descriptor?.set) {
        descriptor.set.call(input, String(value ?? ''));
    } else {
        input.value = String(value ?? '');
    }

    input.dispatchEvent(
        new Event(
            'input',
            {
                bubbles: true
            }
        )
    );


    input.dispatchEvent(
        new Event(
            'change',
            {
                bubbles: true
            }
        )
    );

    input.dispatchEvent(
        new Event(
            'blur',
            {
                bubbles: true
            }
        )
    );


    return true;
}


function isObservacoesLabel(text) {
    const normalized = String(text || '').replace(/[:*]+$/, '').trim();
    return ERP.observacoesLabels.some(label => normalized === label || normalized.startsWith(`${label} `));
}


function isUsableField(el, modal) {
    if (!el) return false;
    if (modal && modal.contains(el)) return false;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag !== 'TEXTAREA' && tag !== 'INPUT') return false;
    const type = String(el.type || '').toLowerCase();
    if (tag === 'INPUT' && (type === 'checkbox' || type === 'radio' || type === 'hidden' || type === 'button' || type === 'submit')) return false;
    return true;
}


function resolveFieldFromLabel(label, modal) {

    if (label.control && isUsableField(label.control, modal)) {
        return label.control;
    }

    const nested = label.querySelector(FIELD_SELECTOR);
    if (isUsableField(nested, modal)) return nested;

    const next = label.nextElementSibling;
    if (next) {
        if (isUsableField(next, modal)) return next;
        const inner = next.querySelector(FIELD_SELECTOR);
        if (isUsableField(inner, modal)) return inner;
    }

    const parent = label.parentElement;
    if (parent) {
        const inner = parent.querySelector(FIELD_SELECTOR);
        if (isUsableField(inner, modal)) return inner;
    }

    return null;
}


export function findObservacoesField() {

    const modal = getAdicionarInsumoModal();

    const labels = Array.from(document.querySelectorAll('label, th, legend, span, div, p'))
        .map(el => ({ el, text: cleanText(el.innerText || el.textContent || '').toLowerCase() }))
        .filter(x => isObservacoesLabel(x.text))
        .sort((a, b) => a.text.length - b.text.length);

    for (const { el } of labels) {
        const field = resolveFieldFromLabel(el, modal);
        if (field) return field;
    }

    const byAttr = Array.from(document.querySelectorAll(FIELD_SELECTOR)).find(el => {
        if (modal && modal.contains(el)) return false;
        const attrs = [el.placeholder, el.name, el.id, el.getAttribute?.('aria-label')]
            .filter(Boolean).join(' ').toLowerCase();
        return attrs.includes('observa');
    });

    if (byAttr) return byAttr;

    const textareas = Array.from(document.querySelectorAll('textarea')).filter(el => !modal || !modal.contains(el));

    if (textareas.length === 1)
        return textareas[0];

    return null;
}


export function buildObservacoesText(metadata) {

    const orderNumber = String(metadata?.orderNumber || '').trim();
    const description = String(metadata?.description || '').trim();

    const parts = [];

    if (orderNumber)
        parts.push(`Pedido ${orderNumber}`);

    if (description)
        parts.push(description);

    return parts.join(' - ');
}


export function fillObservacoes() {

    if (!isTransferenciaPage())
        return false;

    const field = findObservacoesField();

    if (!field)
        return false;

    const current = String(field.value ?? '').trim();

    if (current) {
        field.dataset.mcObservacoes = 'done';
        return false;
    }

    if (field.dataset.mcObservacoes === 'done')
        return false;

    const metadata = getMetadataFromStorage();
    const text = buildObservacoesText(metadata);

    if (!text)
        return false;

    const ok = setInputValue(field, text);

    if (ok) {
        field.dataset.mcObservacoes = 'done';
        addLog(`📝 Observações preenchidas: ${text}`);
        setPanelMessage(`Observações preenchidas com "${text}".`);
        updatePanel();
    }

    return ok;
}


export function findTransferRow(code) {

    const target =
        normalizeMatCode(code);


    if (!target)
        return null;


    const rows =
        Array.from(
            document.querySelectorAll(
                'table tr'
            )
        )
        .filter(
            row =>
                row.querySelectorAll(
                    'td'
                ).length > 0
        );


    for (
        const row of rows
    ) {

        const rowCode =
            extractMatCode(
                row.innerText
            );


        if (
            rowCode === target
        ) {
            return row;
        }
    }


    return null;
}


export function fillTransferQuantities() {

    if (!isTransferenciaPage()) {

        setPanelMessage(
            'Abra a tela de Transferência para preencher as quantidades.'
        );

        return false;
    }


    const items =
        getItemsFromStorage();


    const codes =
        Object.keys(items);


    if (!codes.length) {

        setPanelMessage(
            'Nenhum insumo copiado para preencher.'
        );


        showToast(
            'Primeiro copie os insumos do pedido.',
            'warning'
        );


        return false;
    }


    let preenchidos =
        0;


    let faltantes =
        [];


    for (
        const rawCode of codes
    ) {

        const code =
            normalizeMatCode(
                rawCode
            );


        const item =
            items[rawCode];


        const row =
            findTransferRow(
                code
            );


        if (!row) {

            faltantes.push(
                code
            );

            continue;
        }


        const input =
            row.querySelector(
                'input:not([type="checkbox"]), textarea'
            );


        if (!input) {

            faltantes.push(
                code
            );

            continue;
        }


        if (
            setInputValue(
                input,
                item.quantity
            )
        ) {

            preenchidos++;
        }
    }


    const msg =
        faltantes.length

            ? `${preenchidos} preenchidos. Não encontrados: ${faltantes.join(', ')}`

            : `${preenchidos} quantidades preenchidas.`;


    addLog(
        `🧮 ${msg}`
    );


    setPanelMessage(
        msg
    );


    updatePanel();


    showToast(
        msg,
        faltantes.length
            ? 'warning'
            : 'success'
    );


    return true;
}


export function setupPreencherTransferencia() {

    if (
        !appState.extensionEnabled ||
        !isTransferenciaPage()
    ) {
        return;
    }

    fillObservacoes();

    updatePanel();
}


registerControls({
    fillTransfer: fillTransferQuantities
});
