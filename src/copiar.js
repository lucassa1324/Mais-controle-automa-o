/* =========================================================
   COPIAR INSUMOS (COMUM)
   ========================================================= */

import { CLIPBOARD_SOURCE, UI_CLASS } from './config'
import { appState } from './state'
import { resetPedidoProgress, resetProgress, saveCopiedItems } from './storage'
import { mountFloatingButton } from './styles'
import { addLog, setPanelMessage, showToast, updatePanel } from './panel'


function getSortedItemCodes(items) {

    return Object.keys(items || {}).sort(
        (a, b) => a.localeCompare(b, 'pt-BR', {
            sensitivity: 'base',
            numeric: true
        })
    );
}


/**
 * Grava os itens extraidos no storage compartilhado
 * (GM_* com fallback para localStorage), usando o
 * mesmo formato do ERP.
 *
 * {
 *   "metadata": { "orderNumber": "#184", "description": "..." },
 *   "items": { "MAT051": { "code": "MAT051", "quantity": "4" } }
 * }
 *
 * Retorna a quantidade de itens gravados.
 */
export function saveExtractedItems(items, metadata) {

    const codes = getSortedItemCodes(items);

    if (!codes.length)
        return 0;

    const payload = {};

    for (const code of codes) {

        const item = items[code] || {};

        payload[code] = {
            code: item.code || code,
            quantity: String(item.quantity ?? '')
        };
    }

    saveCopiedItems(payload, metadata);

    resetProgress(codes.length);
    resetPedidoProgress(codes.length);

    appState.automationState = 'idle';
    appState.stopRequested = false;
    appState.pauseRequested = false;

    return codes.length;
}


/**
 * Payload unificado usado como ponte via Area de Transferencia.
 */
export function buildClipboardPayload(items, metadata) {

    const sortedItems = {};

    getSortedItemCodes(items).forEach(code => {
        sortedItems[code] = items[code];
    });

    return {
        source: CLIPBOARD_SOURCE,
        timestamp: Date.now(),
        metadata: {
            orderNumber: String(metadata?.orderNumber ?? '').trim(),
            description: String(metadata?.description ?? '').trim()
        },
        items: sortedItems
    };
}


export function serializeClipboardPayload(items, metadata) {
    return JSON.stringify(
        buildClipboardPayload(items, metadata)
    );
}


/**
 * Aviso visual de que a copia funcionou.
 */
export function notifyCopied(count, metadata, source) {

    const order = metadata?.orderNumber
        ? ` ${metadata.orderNumber}`
        : '';

    const fromAppSheet =
        String(source).toLowerCase() === 'appsheet';

    addLog(
        fromAppSheet
            ? `✅ ${count} insumos copiados com sucesso do AppSheet!`
            : `📋 ${count} insumos copiados${order} (${source}).`
    );

    setPanelMessage(
        fromAppSheet
            ? `${count} insumos copiados com sucesso do AppSheet!`
            : `${count} insumos copiados${order}. Vá para a Transferência no Mais Controle e clique PLAY.`
    );

    updatePanel();

    showToast(
        `${count} insumos copiados do ${source}. Vá para a Transferência no Mais Controle.`,
        'success'
    );
}


/**
 * Botao flutuante de copia.
 *
 * Só existe UM botao ".mc-copy-button" por pagina,
 * evitando sobreposição entre ERP e AppSheet.
 */
export function mountCopyButton(options) {

    const {
        text,
        title,
        onClick
    } = options || {};


    if (document.querySelector('.mc-copy-button'))
        return null;


    const button =
        document.createElement('button');


    button.type = 'button';

    button.className =
        `mc-copy-button ${UI_CLASS}`;

    button.textContent =
        text || '📋 Copiar Insumos';

    button.title =
        title || button.textContent;

    button.addEventListener(
        'click',
        onClick
    );


    mountFloatingButton(
        button
    );

    return button;
}
