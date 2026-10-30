/* =========================================================
   AUTOMACAO DA TELA DE PEDIDOS / SOLICITACOES
   ========================================================= */

import { BATCH_SIZE, ERP, UI_CLASS } from './config'
import { appState } from './state'
import { getCodesFromStorage, getPedidoProgress, resetPedidoProgress, savePedidoProgress } from './storage'
import { addLog, createPanel, setPanelMessage, showToast, updatePanel } from './panel'
import { cleanText, extractMatCode, getSearchNumber, normalizeMatCode, sleep } from './utils'
import { fillReactInput, pressEnter } from './erp'
import { controlledSleep } from './control'
import { getAdicionarInsumoButton, getModalContainers, isAdicionarInsumoPage, isAppSheetHost, isDialogLike, isElementVisible, isPedidoPage, isPedidoPath, isTransferenciaPage } from './pages'


const KEYWORD_SELECTOR =
    'input#keyword, input[name="keyword"], search-field input, .search-field input, input[type="search"], input[placeholder*="Buscar"], input[placeholder*="buscar"], input[placeholder*="insumo"]';

const CLICKABLE_SELECTOR =
    'button, a, [role="button"], input[type="button"], input[type="submit"]';

const MODAL_SELECTOR =
    ERP.modalSelectors.join(', ');

const ADD_ITEM_PATTERN =
    /(?:adicionar|incluir|novo|nova)\s+(?:it(?:em|ens)|insumos?|produtos?|materiais|material)\b/i;

const CONFIRM_PATTERN =
    /^(?:incluir|adicionar|confirmar|salvar|finalizar|ok)\b/i;


/* =========================================================
   UTILITARIOS DE DOM
   ========================================================= */

function normalizeText(text) {

    return cleanText(text)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}


function elementText(el) {

    return normalizeText(
        el?.innerText ||
        el?.textContent ||
        el?.value ||
        ''
    )
    .replace(/^[^a-z0-9]+/, '');
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


/*
 * Visibilidade "real": alem do display/visibility do proprio
 * elemento, ignora containers escondidos por ancestrais
 * (aria-hidden, opacity 0). Isso evita que uma modal antiga
 * ainda montada no DOM seja confundida com a modal aberta.
 */
function isReallyVisible(el) {

    if (!isElementVisible(el))
        return false;

    let node = el;
    let depth = 0;

    while (
        node &&
        node !== document.body &&
        depth < 25
    ) {

        if (node.hidden)
            return false;

        if (node.getAttribute?.('aria-hidden') === 'true')
            return false;

        const style = window.getComputedStyle?.(node);

        if (style) {

            if (style.display === 'none')
                return false;

            if (style.visibility === 'hidden' || style.visibility === 'collapse')
                return false;

            if (style.opacity === '0')
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

    if (el.getAttribute?.('disabled') !== null)
        return true;

    if (el.getAttribute?.('aria-disabled') === 'true')
        return true;

    if (el.classList?.contains?.('Mui-disabled'))
        return true;

    return false;
}


function getVisibleClickables() {

    return Array.from(
        document.querySelectorAll(CLICKABLE_SELECTOR)
    )
    .filter(isReallyVisible)
    .filter(el => !isOwnUI(el));
}


function getVisibleKeywordInputs() {

    const set = new Set();
    const add = el => {
        if (!el)
            return;
        if (!isReallyVisible(el))
            return;
        set.add(el);
    };

    Array.from(document.querySelectorAll(KEYWORD_SELECTOR)).forEach(add);
    Array.from(document.querySelectorAll('input')).forEach(input => {
        const ph = String(input.getAttribute?.('placeholder') || '').toLowerCase();
        const ngModel = String(input.getAttribute?.('ng-model') || '').toLowerCase();
        if (ph.includes('buscar') || ph.includes('insumo') || ngModel.includes('keyword'))
            add(input);
    });

    return Array.from(set);
}
function findDialogAncestor(el) {

    let node = el?.parentElement;

    let found = null;

    let depth = 0;

    while (
        node &&
        node !== document.body &&
        depth < 12
    ) {

        /*
         * Guarda o ancestral MAIS EXTERNO.
         *
         * Assim o container inclui o campo de busca,
         * a tabela e tambem o rodape com "Incluir".
         */
        if (isDialogLike(node))
            found = node;

        node = node.parentElement;
        depth++;
    }

    return found;
}


function findConfirmCandidates() {

    return getVisibleClickables()
        .filter(el => {

            const text = elementText(el);

            return (
                text &&
                CONFIRM_PATTERN.test(text) &&
                !ADD_ITEM_PATTERN.test(text)
            );
        });
}


/* =========================================================
   DETECCAO DA PAGINA E DA MODAL
   ========================================================= */

export function isPedidoAutomationPage() {

    if (typeof document === 'undefined')
        return false;

    if (isAppSheetHost())
        return false;

    /*
     * A tela de Transferencia (botao "ADICIONAR INSUMO")
     * tem prioridade sobre a URL: algumas transferencias
     * sao abertas dentro de /compras/solicitacoes/... e
     * nao podem cair no motor do Pedido.
     */
    if (isTransferenciaPage())
        return false;

    if (isAdicionarInsumoPage() && getAdicionarInsumoButton())
        return false;

    /*
     * A URL de Pedido/Solicitacao e soberana: continua
     * valendo mesmo com a modal "Adicionar item" aberta.
     */
    if (isPedidoPath())
        return true;

    if (isAdicionarInsumoPage())
        return false;

    return isPedidoPage();
}


/**
 * Container da modal de "Adicionar item".
 *
 * A tela de Pedido pode ter um #keyword proprio; por isso
 * o container so e considerado modal quando o input esta
 * dentro de um dialogo ou quando existe um botao de
 * confirmacao (Incluir/Adicionar) no mesmo bloco.
 */
export function getPedidoModal() {

    const inputs =
        getVisibleKeywordInputs();

    if (!inputs.length)
        return null;


    for (const input of inputs) {

        const dialog = findDialogAncestor(input);

        if (dialog)
            return dialog;
    }


    const modalContainers =
        getModalContainers()
            .filter(isReallyVisible)
            .filter(isDialogLike);

    for (const container of modalContainers) {

        if (container.querySelector('input') && (container.querySelector('table tr, [role="row"]') || container.querySelector('input[type="checkbox"]')))
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

        return (
            findDialogAncestor(last) ||
            last.closest?.(MODAL_SELECTOR) ||
            last.closest?.('[role="dialog"], [aria-modal="true"]') ||
            last
        );
    }


    /*
     * Modal sem classe de modal:
     * procura o ancestral que tambem contem o botao
     * de confirmacao do lote.
     */
    const confirms = findConfirmCandidates();

    if (confirms.length) {

        let node = inputs[0].parentElement;
        let depth = 0;

        while (node && depth < 12) {

            if (confirms.some(btn => node.contains?.(btn)))
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


export function getPedidoSearchInput() {

    const modal =
        getPedidoModal();

    const inputs =
        getVisibleKeywordInputs();


    if (modal) {

        if (
            String(modal.tagName || '').toUpperCase() ===
            'INPUT'
        ) {
            return modal;
        }

        const inside = inputs.filter(
            input => modal.contains?.(input)
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

    return inputs.length
        ? inputs[inputs.length - 1]
        : null;
}


/*
 * A modal só conta como aberta quando o campo de busca
 * está realmente visível. Uma modal antiga que o ERP
 * deixou montada no DOM (fechada) não bloqueia a
 * abertura do próximo lote.
 */
function isPedidoModalReallyOpen() {

    const modal =
        getPedidoModal();

    if (!modal)
        return false;

    const input =
        getPedidoSearchInput();

    return !!input && isReallyVisible(input);
}


export function getPedidoAddItemButton() {

    /*
     * Só ignora os botões de dentro da modal quando ela
     * está de fato aberta. Os botões "Adicionar item"
     * duplicados do ERP (MUI) continuam válidos.
     */
    const modal =
        isPedidoModalReallyOpen()
            ? getPedidoModal()
            : null;

    const candidates =
        getVisibleClickables()
            .filter(el => !modal || !modal.contains?.(el))
            .filter(el => !isDisabledLike(el))
            .filter(el => ADD_ITEM_PATTERN.test(elementText(el)));

    if (!candidates.length)
        return null;

    const exact = candidates.find(el => {

        const text = elementText(el);

        return (
            /^(?:adicionar|incluir)\s+(?:item|insumo)$/.test(text) ||
            /^(?:adicionar|incluir)\s+(?:itens|insumos)$/.test(text)
        );
    });

    if (exact)
        return exact;

    return candidates.sort(
        (a, b) => elementText(a).length - elementText(b).length
    )[0];
}


export function getPedidoConfirmButton() {

    const modal =
        getPedidoModal();

    const all = getVisibleClickables()
        .filter(el => CONFIRM_PATTERN.test(elementText(el)));

    if (!all.length)
        return null;

    /*
     * Dentro da modal o botao de confirmacao pode ate
     * se chamar "Adicionar item"; fora dela esse texto
     * e o botao que ABRE a modal.
     */
    if (modal) {

        const inside = all.filter(
            button => modal.contains?.(button)
        );

        if (!inside.length)
            return null;

        const preferred = inside.filter(
            button => !ADD_ITEM_PATTERN.test(elementText(button))
        );

        const list = preferred.length
            ? preferred
            : inside;

        return list[list.length - 1];
    }

    const confirms = all.filter(
        button => !ADD_ITEM_PATTERN.test(elementText(button))
    );

    return confirms.length
        ? confirms[confirms.length - 1]
        : null;
}


/* =========================================================
   ABERTURA / FECHAMENTO DA MODAL
   ========================================================= */

export async function waitForPedidoModal(
    timeout = ERP.timeouts.modalOpen
) {

    const inicio = Date.now();

    while (Date.now() - inicio < timeout) {

        const state = await controlledSleep(200);

        if (state !== 'ok')
            return state;

        if (isPedidoModalReallyOpen())
            return 'ok';
    }

    if (isPedidoModalReallyOpen())
        return 'ok';

    addLog('⚠️ Timeout aguardando a modal de Adicionar item do Pedido.');

    return 'fail';
}


export async function waitForPedidoModalClose(
    timeout = ERP.timeouts.modalClose
) {

    const inicio = Date.now();

    while (Date.now() - inicio < timeout) {

        const state = await controlledSleep(250);

        if (state !== 'ok')
            return state;

        if (!isPedidoModalReallyOpen())
            return 'ok';
    }

    if (!isPedidoModalReallyOpen())
        return 'ok';

    addLog('⚠️ Timeout aguardando o fechamento da modal de Adicionar item.');

    return 'fail';
}


export async function openPedidoItemModal() {

    /*
     * A modal ja esta aberta de verdade?
     */
    if (isPedidoModalReallyOpen())
        return 'ok';

    /*
     * O ERP troca o botão "Adicionar item" (MUI) toda vez
     * que a lista é recarregada depois do "Incluir".
     * Por isso reconsultamos e tentamos de novo algumas
     * vezes antes de desistir.
     */
    const maxAttempts = 6;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {

        if (appState.stopRequested)
            return 'cancel';

        if (
            appState.pauseRequested ||
            appState.automationState === 'paused'
        ) {
            return 'pause';
        }

        if (isPedidoModalReallyOpen())
            return 'ok';

        const button =
            getPedidoAddItemButton();

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

            const opened =
                await waitForPedidoModal(
                    attempt === 1
                        ? ERP.timeouts.modalOpen
                        : 2500
                );

            if (opened === 'pause')
                return 'pause';

            if (opened === 'cancel')
                return 'cancel';

            if (isPedidoModalReallyOpen())
                return 'ok';
        }

        const settle =
            await controlledSleep(
                600 * attempt
            );

        if (settle !== 'ok')
            return settle;
    }

    addLog('⚠️ Não foi possível abrir a modal de Adicionar item do Pedido.');

    return 'fail';
}


/* =========================================================
   BUSCA / SELECAO / CONFIRMACAO
   ========================================================= */

export function findPedidoMaterialRow(code) {

    const target =
        normalizeMatCode(code);

    if (!target)
        return null;

    const modal =
        getPedidoModal();

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
        )
        .filter(row => row.children.length > 1);

        for (const row of rows) {

            const rowCode =
                extractMatCode(row.innerText || '');

            if (rowCode === target)
                return row;
        }
    }

    return null;
}


export async function waitForPedidoMaterialRow(
    code,
    timeout = ERP.timeouts.materialRow
) {

    const inicio = Date.now();

    while (Date.now() - inicio < timeout) {

        if (appState.stopRequested)
            return 'cancel';

        if (
            appState.pauseRequested ||
            appState.automationState === 'paused'
        ) {
            return 'pause';
        }

        const row =
            findPedidoMaterialRow(code);

        if (row)
            return row;

        await sleep(300);
    }

    return null;
}


export async function searchPedidoMaterial(code) {

    let input =
        getPedidoSearchInput();

    if (!input) {
        const inputs = getVisibleKeywordInputs();
        if (inputs.length)
            input = inputs[inputs.length - 1];
    }

    if (!input) {

        addLog('⚠️ Campo de busca da modal de Pedido não encontrado.');

        return false;
    }

    const searchNumber =
        getSearchNumber(code);

    addLog(`🔎 Pedido: ${code} → ${searchNumber}`);

    try {
        input.scrollIntoView?.({block: 'center'});
    } catch (e) {}
    try {
        input.focus?.();
    } catch (e) {}
    try {
        input.click?.();
    } catch (e) {}

    const filled =
        await fillReactInput(input, searchNumber);

    if (!filled)
        return false;

    try {
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.dispatchEvent(new Event('change', {bubbles: true}));
    } catch (e) {}

    let state = await controlledSleep(200);

    if (state !== 'ok')
        return state;

    try {
        pressEnter(input);
    } catch (e) {}

    state = await controlledSleep(3000);

    return state === 'ok' ? true : state;
}


export async function clearPedidoSearch() {

    const input =
        getPedidoSearchInput();

    if (!input)
        return false;

    const filled =
        await fillReactInput(input, '');

    if (!filled)
        return false;

    return await controlledSleep(250);
}


export function selectPedidoRow(row, code) {

    if (!row)
        return false;

    const checkbox =
        row.querySelector('input[type="checkbox"]');

    if (!checkbox) {

        addLog(`⚠️ ${code}: linha encontrada, mas sem checkbox.`);

        return false;
    }

    if (!checkbox.checked) {

        checkbox.click();

        checkbox.dispatchEvent(
            new Event(
                'change',
                {
                    bubbles: true
                }
            )
        );
    }

    return true;
}


export async function commitPedidoBatch() {

    if (!isPedidoModalReallyOpen()) {

        addLog('⚠️ A modal de Adicionar item não está aberta para confirmar o lote.');

        return 'fail';
    }

    const button =
        getPedidoConfirmButton();

    if (!button) {

        addLog('⚠️ Botão "Incluir"/"Adicionar" não encontrado para confirmar o lote do Pedido.');

        return 'fail';
    }

    const label = cleanText(
        button.innerText ||
        button.textContent ||
        button.value ||
        ''
    );

    addLog(`✅ Confirmando lote do Pedido: ${label || 'INCLUIR'}.`);

    try {

        appState.suppressHooks = true;
        button.click();

    } catch (e) {

        appState.suppressHooks = false;
        addLog('⚠️ Não foi possível confirmar o lote do Pedido.');

        return 'fail';

    } finally {

        appState.suppressHooks = false;
    }

    return await waitForPedidoModalClose();
}


/* =========================================================
   PROCESSAMENTO
   ========================================================= */

async function processPedidoItem(code, index, total, notFound) {

    setPanelMessage(
        `Pedido: processando ${code} (${index + 1}/${total})`
    );

    addLog(
        `▶️ Pedido: processando ${code} (${index + 1}/${total})`
    );

    updatePanel();

    const searchResult =
        await searchPedidoMaterial(code);

    if (searchResult === 'pause')
        return 'pause';

    if (searchResult === 'cancel')
        return 'cancel';

    if (searchResult !== true) {

        addLog('⚠️ Campo de busca do Pedido indisponível ou não confirmado.');

        return 'fail';
    }

    const rowResult =
        await waitForPedidoMaterialRow(
            code,
            ERP.timeouts.materialRow
        );

    if (rowResult === 'pause')
        return 'pause';

    if (rowResult === 'cancel')
        return 'cancel';

    if (!rowResult) {

        if (!notFound.includes(code))
            notFound.push(code);

        addLog(`❌ Pedido: ${code} não encontrado.`);

        const clear = await clearPedidoSearch();

        if (clear === 'pause')
            return 'pause';

        if (clear === 'cancel')
            return 'cancel';

        return 'ok';
    }

    const selected =
        selectPedidoRow(rowResult, code);

    if (!selected) {

        if (!notFound.includes(code))
            notFound.push(code);

        addLog(`⚠️ Pedido: ${code} linha encontrada, mas não foi possível marcar.`);

    } else {

        addLog(`✅ Pedido: ${code} marcado.`);
    }

    const clear = await clearPedidoSearch();

    if (clear === 'pause')
        return 'pause';

    if (clear === 'cancel')
        return 'cancel';

    return selected ? 'found' : 'ok';
}


function interruptPedido(state, index, total, notFound, message) {

    if (state === 'pause') {

        appState.automationState = 'paused';
        savePedidoProgress(index, total, true, notFound);

        setPanelMessage(
            message || `Pedido pausado antes do item ${index + 1}. Clique PLAY para continuar.`
        );

        addLog(`⏸️ Pedido pausado antes do item ${index + 1}.`);

        updatePanel();
        return;
    }

    if (state === 'cancel') {

        appState.automationState = 'cancelled';
        savePedidoProgress(index, total, true, notFound);

        setPanelMessage(
            `Pedido cancelado antes do item ${index + 1}. O progresso foi mantido.`
        );

        addLog(`⛔ Pedido cancelado antes do item ${index + 1}.`);

        updatePanel();
        return;
    }

    appState.automationState = 'paused';
    savePedidoProgress(index, total, true, notFound);
    setPanelMessage(message || 'Automação do Pedido pausada.');
    addLog(`⚠️ ${message || 'Automação do Pedido pausada.'}`);
    updatePanel();
}


/* =========================================================
   EXECUCAO EM LOTES
   ========================================================= */

export async function runPedidoBatch() {

    const codes = getCodesFromStorage();
    const total = codes.length;

    if (!total) {

        setPanelMessage('Nenhum insumo copiado. Primeiro use "Copiar Insumos".');
        showToast('Nenhum insumo foi copiado.', 'warning');
        updatePanel();

        return;
    }

    const progress = getPedidoProgress(total);

    let index = progress.nextIndex;

    const notFound = Array.isArray(progress.notFound)
        ? [...progress.notFound]
        : [];

    /*
     * Quantos itens ENCONTRADOS já foram marcados na modal.
     * O lote só é confirmado ao completar BATCH_SIZE itens
     * encontrados (ou no fim da lista). Buscas sem resultado
     * não contam e não clicam em "Incluir".
     */
    let foundInBatch = 0;


    while (index < total) {

        if (appState.stopRequested) {

            interruptPedido('cancel', index, total, notFound);
            return;
        }

        if (
            appState.pauseRequested ||
            appState.automationState === 'paused'
        ) {
            interruptPedido('pause', index, total, notFound);
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

        if (opened === 'pause') {
            interruptPedido('pause', index, total, notFound);
            return;
        }

        if (opened === 'cancel') {
            interruptPedido('cancel', index, total, notFound);
            return;
        }

        if (opened !== 'ok') {
            interruptPedido('fail', index, total, notFound, 'Não foi possível abrir a modal de Adicionar item. Automação do Pedido pausada.');
            return;
        }

        /*
         * Continua processando até completar o lote de
         * itens encontrados ou até acabar a lista.
         */
        while (
            index < total &&
            foundInBatch < BATCH_SIZE
        ) {

            if (appState.stopRequested) {
                interruptPedido('cancel', index, total, notFound);
                return;
            }

            if (
                appState.pauseRequested ||
                appState.automationState === 'paused'
            ) {
                interruptPedido('pause', index, total, notFound);
                return;
            }

            const result = await processPedidoItem(codes[index], index, total, notFound);

            if (result === 'pause') {
                interruptPedido('pause', index, total, notFound);
                return;
            }

            if (result === 'cancel') {
                interruptPedido('cancel', index, total, notFound);
                return;
            }

            if (result === 'fail') {
                interruptPedido('fail', index, total, notFound, 'Falha ao processar insumo do Pedido. Automação pausada.');
                return;
            }

            if (result === 'found') {

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

        /*
         * Nenhum item encontrado nesta rodada:
         * não existe seleção para confirmar, então
         * NÃO clicamos em "Incluir"/"Adicionar".
         */
        if (foundInBatch === 0) {

            addLog(
                '⚠️ Pedido: nenhum item encontrado. Nada para confirmar — seguindo sem clicar em Incluir.'
            );

            break;
        }

        if (appState.stopRequested) {
            interruptPedido('cancel', index, total, notFound);
            return;
        }

        if (
            appState.pauseRequested ||
            appState.automationState === 'paused'
        ) {
            interruptPedido('pause', index, total, notFound);
            return;
        }

        const batchFound = foundInBatch;

        const committed = await commitPedidoBatch();

        if (committed === 'pause') {
            interruptPedido('pause', index, total, notFound);
            return;
        }

        if (committed === 'cancel') {
            interruptPedido('cancel', index, total, notFound);
            return;
        }

        if (committed !== 'ok') {
            interruptPedido('fail', index, total, notFound, 'Falha ao confirmar o lote do Pedido. Automação pausada.');
            return;
        }

        foundInBatch = 0;

        if (index < total) {

            const settle = await controlledSleep(400);

            if (settle === 'pause') {
                interruptPedido('pause', index, total, notFound);
                return;
            }

            if (settle === 'cancel') {
                interruptPedido('cancel', index, total, notFound);
                return;
            }

            setPanelMessage(`Pedido: lote confirmado (${batchFound} item(ns), ${index}/${total}). Abrindo a modal do próximo lote...`);
            addLog(`⏭️ Pedido: lote confirmado com ${batchFound} item(ns) (${index}/${total}). Abrindo o próximo lote.`);
            updatePanel();

        } else {

            addLog(`⏭️ Pedido: lote final concluído com ${batchFound} item(ns) confirmado(s) (${index}/${total}).`);
        }
    }

    appState.automationState = 'completed';
    savePedidoProgress(total, total, true, notFound);

    const message = notFound.length
        ? `Pedido concluído. ${notFound.length} item(ns) não encontrado(s).`
        : 'Pedido concluído! Todos os itens foram adicionados.';

    setPanelMessage(message);
    addLog(`🏁 ${message}`);
    updatePanel();

    showToast(
        message,
        notFound.length ? 'warning' : 'success'
    );
}


/* =========================================================
   CONTROLES
   ========================================================= */

export async function playPedidoAutomation() {

    if (!appState.extensionEnabled)
        return;

    if (appState.currentRunPromise)
        return;

    if (
        !isPedidoAutomationPage() &&
        !(
            appState.activeFlow === 'pedido' &&
            isPedidoPage() &&
            !isTransferenciaPage()
        )
    ) {

        setPanelMessage(
            'Abra a tela de Solicitação/Pedido do Mais Controle para automatizar.'
        );

        showToast(
            'Esta automação só funciona na tela de Pedido/Solicitação.',
            'warning'
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
            'Nenhum insumo foi copiado.',
            'warning'
        );

        updatePanel();

        return;
    }

    if (appState.stopRequested)
        appState.stopRequested = false;

    if (appState.pauseRequested)
        appState.pauseRequested = false;

    appState.activeFlow = 'pedido';
    appState.automationState = 'running';

    const progress = getPedidoProgress(total);

    savePedidoProgress(
        progress.nextIndex,
        total,
        false,
        progress.notFound
    );

    setPanelMessage('Iniciando processamento do Pedido...');
    addLog(`▶️ Pedido: continuando no item ${progress.nextIndex + 1}/${total}.`);
    updatePanel();

    appState.currentRunPromise = runPedidoBatch();

    try {
        await appState.currentRunPromise;
    } finally {
        appState.currentRunPromise = null;
    }
}


export function pausePedidoAutomation() {

    if (appState.automationState === 'running') {

        appState.pauseRequested = true;

        setPanelMessage('Pausando o Pedido após o item atual...');
        addLog('⏸️ Pedido: solicitação de pausa recebida.');

        return;
    }

    if (appState.automationState === 'paused') {

        appState.automationState = 'paused';

        setPanelMessage('Pedido pausado. Clique PLAY para continuar.');
        updatePanel();
    }
}


export function cancelPedidoAutomation() {

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

    appState.automationState = 'cancelled';

    setPanelMessage('Pedido cancelado. O progresso foi mantido. PLAY continua de onde parou.');
    addLog('⛔ Pedido cancelado. Progresso mantido.');

    updatePanel();
}


export function restartPedidoAutomation() {

    appState.stopRequested = true;
    appState.pauseRequested = false;
    appState.currentRunPromise = null;

    const total = getCodesFromStorage().length;

    resetPedidoProgress(total);

    appState.automationState = 'idle';

    setPanelMessage('Progresso do Pedido zerado. Clique PLAY para começar novamente.');
    addLog('🔄 Progresso do Pedido reiniciado.');

    updatePanel();
}


/* =========================================================
   BOTAO
   ========================================================= */

export function setupPedidoAutomation() {

    if (!appState.extensionEnabled)
        return;

    /*
     * A acao "Adicionar Itens no Pedido" agora vive
     * dentro do painel flutuante. Nao criamos mais
     * botoes soltos na pagina.
     */
    createPanel();

    updatePanel();
}
