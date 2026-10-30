/* =========================================================
   BUSCA NO ERP
   ========================================================= */

import { ERP } from './config'
import { appState } from './state'
import { cleanText, extractMatCode, getSearchNumber, log, normalizeMatCode, sleep } from './utils'
import { getCodesFromStorage, getProgress } from './storage'
import { addLog, setPanelMessage, updatePanel } from './panel'
import { controlledSleep } from './control'
import { getAdicionarButton, getAdicionarInsumoButton, getAdicionarInsumoModal, getAdicionarInsumoSearchInput, getSearchInputHint, isAdicionarInsumoPage, isElementEnabled, isTransferenciaPage } from './pages'

export { getAdicionarInsumoSearchInput, getAdicionarButton, getAdicionarInsumoButton, getAdicionarInsumoModal }


export async function waitForAdicionarInsumoModal(timeout = ERP.timeouts.modalOpen) {

    const inicio = Date.now();

    while (Date.now() - inicio < timeout) {

        const st = await controlledSleep(200);

        if (st !== 'ok')
            return st;

        if (isAdicionarInsumoPage() && getAdicionarInsumoSearchInput())
            return 'ok';
    }

    if (isAdicionarInsumoPage() && getAdicionarInsumoSearchInput())
        return 'ok';

    addLog('⚠️ Timeout aguardando abertura da modal de Adicionar Insumo.');

    return 'fail';
}


export async function waitForTransferenciaPage(timeout = ERP.timeouts.modalClose) {

    const inicio = Date.now();

    while (Date.now() - inicio < timeout) {

        const st = await controlledSleep(250);

        if (st !== 'ok')
            return st;

        if (isTransferenciaPage())
            return 'ok';
    }

    if (isTransferenciaPage())
        return 'ok';

    addLog('⚠️ Timeout aguardando retorno à tela de Transferência.');

    return 'fail';
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

        if (st !== 'ok')
            return st;
    }

    if (ultimoBotao && isElementEnabled(ultimoBotao))
        return ultimoBotao;

    return null;
}


export async function openAdicionarInsumoModal() {

    /*
     * A modal ja esta aberta?
     *
     * Se ela existe mas o campo de busca ainda nao renderizou,
     * apenas esperamos (sem clicar em nada).
     */
    if (isAdicionarInsumoPage()) {

        const input = getAdicionarInsumoSearchInput();

        if (input)
            return 'ok';

        return await waitForAdicionarInsumoModal();
    }

    /*
     * Depois de confirmar um lote a tela de Transferencia
     * pode ficar alguns instantes sem o botao (re-render).
     * Esperamos o botao existir e estar habilitado antes
     * de clicar, em vez de desistir no primeiro frame.
     */
    const inicio = Date.now();
    let tentativas = 0;

    while (Date.now() - inicio < ERP.timeouts.modalOpen) {

        /*
         * A modal pode ter aberto no meio da espera/tentativa
         * anterior. Nesse caso nao clicamos de novo.
         */
        if (isAdicionarInsumoPage() && getAdicionarInsumoSearchInput())
            return 'ok';

        const restante = ERP.timeouts.modalOpen - (Date.now() - inicio);

        const botao = await waitForEnabledAdicionarInsumoButton(restante);

        if (botao === 'pause' || botao === 'cancel')
            return botao;

        if (!botao)
            break;

        tentativas++;

        try {
            appState.suppressHooks = true;
            botao.click();
        } catch (e) {
            addLog('⚠️ Não foi possível clicar em ADICIONAR INSUMO.');
            return 'fail';
        } finally {
            appState.suppressHooks = false;
        }

        addLog(
            `➕ Clicado em ADICIONAR INSUMO: abrindo a modal de busca (tentativa ${tentativas}).`
        );

        const espera = Math.max(
            1000,
            Math.min(2500, ERP.timeouts.modalOpen - (Date.now() - inicio))
        );

        const opened = await waitForAdicionarInsumoModal(espera);

        if (opened !== 'fail')
            return opened;

        addLog('⚠️ A modal de Adicionar Insumo não abriu. Tentando novamente...');

        const st = await controlledSleep(300);

        if (st !== 'ok')
            return st;

        if (tentativas >= 3)
            break;
    }

    addLog('⚠️ Botão ADICIONAR INSUMO não encontrado ou indisponível na tela de Transferência.');

    return 'fail';
}


export async function commitBatch() {

    if (!isAdicionarInsumoPage()) {
        addLog('⚠️ A modal de Adicionar Insumo não está aberta para confirmar o lote.');
        return 'fail';
    }

    const botao = getAdicionarButton();

    if (!botao) {
        addLog('⚠️ Botão ADICIONAR (X) não encontrado para confirmar o lote.');
        return 'fail';
    }

    const rotulo = cleanText(botao.innerText || botao.textContent || botao.value || '');
    addLog(`✅ Confirmando lote: ${rotulo || 'ADICIONAR'}.`);

    try {
        appState.suppressHooks = true;
        botao.click();
    } catch (e) {
        appState.suppressHooks = false;
        addLog('⚠️ Não foi possível clicar no botão ADICIONAR para confirmar o lote.');
        return 'fail';
    }

    appState.suppressHooks = false;

    return await waitForTransferenciaPage();
}


export async function fillReactInput(
    inputEl,
    value
) {

    if (!inputEl)
        return false;


    inputEl.focus();


    try {
        inputEl.select();
    } catch (e) {}


    document.execCommand(
        'delete'
    );


    const texto =
        String(value ?? '');


    for (
        const char of texto
    ) {

        document.execCommand(
            'insertText',
            false,
            char
        );


        await sleep(20);
    }


    inputEl.dispatchEvent(
        new Event(
            'input',
            {
                bubbles: true,
                cancelable: true
            }
        )
    );


    inputEl.dispatchEvent(
        new Event(
            'change',
            {
                bubbles: true,
                cancelable: true
            }
        )
    );


    return true;
}


export function pressEnter(inputEl) {

    if (!inputEl)
        return;


    inputEl.focus();


    [
        'keydown',
        'keypress',
        'keyup'
    ].forEach(type => {

        inputEl.dispatchEvent(
            new KeyboardEvent(
                type,
                {
                    key: 'Enter',
                    code: 'Enter',
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


export async function searchMaterial(code) {

    const input =
        getAdicionarInsumoSearchInput();


    if (!input) {

        log(
            'Campo de busca não encontrado.'
        );

        return false;
    }


    const searchNumber =
        getSearchNumber(code);

    const hint =
        getSearchInputHint(input);

    addLog(
        `🔎 ${code} → ${searchNumber}${hint ? ` (campo: ${hint})` : ''}`
    );


    const filled =
        await fillReactInput(
            input,
            searchNumber
        );


    if (!filled)
        return false;


    let state =
        await controlledSleep(100);


    if (
        state !== 'ok'
    ) {
        return state;
    }


    pressEnter(input);


    state =
        await controlledSleep(
            2500
        );


    return (
        state === 'ok'
            ? true
            : state
    );
}


export function findMaterialRow(code) {

    const targetCode =
        normalizeMatCode(code);


    if (!targetCode)
        return null;


    /*
     * A tabela de resultados fica DENTRO da modal.
     *
     * Buscar no documento inteiro poderia achar
     * a linha do mesmo material na tabela da
     * tela de Transferencia (que fica atras da modal).
     */
    const scopes = [];

    const modal = getAdicionarInsumoModal();

    if (modal)
        scopes.push(modal);

    scopes.push(document);


    for (
        const scope of scopes
    ) {

        const rows =
            Array.from(
                scope.querySelectorAll(
                    'table tr, [role="row"]'
                )
            )
            .filter(
                row =>
                    row.children.length > 1
            );


        for (
            const row of rows
        ) {

            const rowText =
                row.innerText || '';


            const rowCode =
                extractMatCode(
                    rowText
                );


            /*
             * COMPARAÇÃO EXATA.
             *
             * MAT010 != MAT10
             */

            if (
                rowCode &&
                rowCode === targetCode
            ) {

                return row;
            }
        }
    }


    return null;
}


export async function waitForMaterialRow(
    code,
    timeout = ERP.timeouts.materialRow
) {

    const inicio =
        Date.now();


    while (
        Date.now() - inicio <
        timeout
    ) {

        if (appState.stopRequested)
            return 'cancel';


        if (
            appState.pauseRequested ||
            appState.automationState === 'paused'
        ) {
            return 'pause';
        }


        const row =
            findMaterialRow(code);


        if (row)
            return row;


        await sleep(300);
    }


    return null;
}


export function selectMaterialRow(
    row,
    code
) {

    if (!row)
        return false;


    const checkbox =
        row.querySelector(
            'input[type="checkbox"], ' +
            '[role="checkbox"], ' +
            '.MuiCheckbox-root input'
        );


    if (!checkbox) {

        log(
            `${code}: linha encontrada, mas sem checkbox.`
        );

        return false;
    }


    const isChecked = () => {

        if (typeof checkbox.checked === 'boolean')
            return checkbox.checked;

        return checkbox.getAttribute?.('aria-checked') === 'true';
    };


    if (!isChecked()) {

        checkbox.click();


        try {

            checkbox.dispatchEvent(
                new Event(
                    'change',
                    {
                        bubbles: true
                    }
                )
            );

        } catch (e) { }
    }


    return true;
}


export async function clearSearch() {

    const input =
        getAdicionarInsumoSearchInput();


    if (!input)
        return false;


    const result =
        await fillReactInput(
            input,
            ''
        );


    if (!result)
        return false;


    return await controlledSleep(
        250
    );
}


export function hookAdicionarButton() {

    const botao =
        getAdicionarButton();


    if (!botao)
        return;


    if (
        botao.dataset.mcContinueHook ===
        'true'
    ) {
        return;
    }


    botao.dataset.mcContinueHook =
        'true';


    botao.addEventListener(
        'click',
        () => {

            /*
             * NÃO inicia automaticamente.
             *
             * O usuário clica ADICIONAR
             * e depois PLAY.
             */

            if (!appState.extensionEnabled)
                return;

            if (appState.suppressHooks)
                return;

            if (appState.automationState === 'running')
                return;


            const codes =
                getCodesFromStorage();


            const progress =
                getProgress(
                    codes.length
                );


            if (
                progress.nextIndex <
                codes.length
            ) {

                appState.automationState =
                    'waitingAdd';


                setPanelMessage(
                    `ADICIONAR foi clicado. Quando terminar, clique PLAY para continuar no item ${progress.nextIndex + 1}.`
                );


                addLog(
                    '🟢 Botão ADICIONAR do ERP clicado.'
                );


                updatePanel();
            }
        },
        true
    );
}
