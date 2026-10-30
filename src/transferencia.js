/* =========================================================
   ORQUESTRACAO GERAL
   ========================================================= */

import { HOTKEY, OBSERVER_DELAY } from './config'
import { appState } from './state'
import { log } from './utils'
import { isAppSheetHost } from './pages'
import { installStyles } from './styles'
import { createPanel, removeExtensionUI, showToast, updatePanel } from './panel'
import { hookAdicionarButton } from './erp'
import { setupCopiarPedido } from './pedido'
import { setupPedidoAutomation } from './pedido_automation'
import { setupCopiarAppSheet } from './appsheet'
import { fillObservacoes, setupPreencherTransferencia } from './preencher'
import { setupSortingAndIndexes } from './tables'
import './automation'


let observacoesTimer = null;


function scheduleObservacoes() {

    if (observacoesTimer) {
        clearTimeout(observacoesTimer);
    }

    observacoesTimer = setTimeout(() => {
        observacoesTimer = null;
        try {
            fillObservacoes();
        } catch (e) { }
    }, OBSERVER_DELAY);
}

export function hotkeyMatches(e) {

    return (

        e.ctrlKey === HOTKEY.ctrl &&

        e.altKey === HOTKEY.alt &&

        e.shiftKey === HOTKEY.shift &&

        e.metaKey === HOTKEY.meta &&

        String(e.key).toLowerCase() ===
        String(HOTKEY.key).toLowerCase()

    );
}


export function hotkeyLabel() {

    const parts = [];

    if (HOTKEY.ctrl)
        parts.push('CTRL');

    if (HOTKEY.alt)
        parts.push('ALT');

    if (HOTKEY.shift)
        parts.push('SHIFT');

    if (HOTKEY.meta)
        parts.push('META');

    parts.push(
        String(
            HOTKEY.key
        ).toUpperCase()
    );

    return parts.join(' + ');
}


export function toggleExtension() {

    appState.extensionEnabled =
        !appState.extensionEnabled;


    /*
     * =====================================================
     * ATIVAR
     * =====================================================
     */

    if (appState.extensionEnabled) {

        installStyles();

        setupAutomationButtons();

        createPanel();

        showToast(
            `AutomaÃ§Ã£o ativada â€” ${hotkeyLabel()} para desativar.`,
            'success'
        );

        return;
    }


    /*
     * =====================================================
     * DESATIVAR
     * =====================================================
     */

    if (
        appState.automationState === 'running'
    ) {
        appState.pauseRequested = true;
    }


    appState.extensionEnabled = false;


    /*
     * Aqui desaparecem:
     *
     * - painel
     * - botÃ£o copiar
     * - botÃ£o buscar
     * - botÃ£o preencher
     * - botÃµes A-Z
     * - toast
     *
     * O ERP continua completamente normal.
     */

    removeExtensionUI();


    /*
     * No AppSheet o painel com a copia
     * continua disponivel.
     */
    if (isAppSheetHost()) {

        setupCopiarAppSheet();
    }
}


export function setupAutomationButtons() {

    if (
        !appState.extensionEnabled
    ) {
        return;
    }


    if (appState.setupRunning)
        return;


    /*
     * Durante a automaÃ§Ã£o nÃ£o ficamos
     * recriando elementos toda hora.
     */

    if (
        appState.automationState === 'running'
    ) {
        return;
    }


    appState.setupRunning =
        true;


    try {

        installStyles();

        /*
         * No AppSheet o painel exibe o botao
         * "ðŸ“‹ COPIAR INSUMOS DO APPSHEET".
         *
         * Nao criamos botoes soltos na tela.
         */
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

        appState.setupRunning =
            false;
    }
}


export function start() {

    /*
     * IMPORTANTE:
     *
     * Toda atualizaÃ§Ã£o da pÃ¡gina
     * comeÃ§a com a extensÃ£o DESLIGADA.
     */

    appState.extensionEnabled =
        false;


    appState.automationState =
        'idle';


    appState.stopRequested =
        false;


    appState.pauseRequested =
        false;


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
    } catch (e) { }


    /*
     * No AppSheet o botao de copiar insumos
     * aparece assim que a pagina carrega,
     * sem depender do atalho de ativacao.
     */
    if (isAppSheetHost()) {

        installStyles();

        setupCopiarAppSheet();
    }


    log(
        `ExtensÃ£o carregada desligada. Atalho: ${hotkeyLabel()}`
    );
}


/* =========================================================
   ATALHO
   ========================================================= */

document.addEventListener(
    'keydown',
    e => {

        if (
            !hotkeyMatches(e)
        ) {
            return;
        }


        e.preventDefault();

        e.stopPropagation();


        toggleExtension();

    },
    true
);


/* =========================================================
   OBSERVER
   ========================================================= */

const observer =
    new MutationObserver(
        () => {

            if (
                appState.automationState ===
                'running'
            ) {
                return;
            }

            scheduleObservacoes();

            if (
                !appState.extensionEnabled
            ) {
                return;
            }


            if (
                appState.observerTimer
            ) {
                clearTimeout(
                    appState.observerTimer
                );
            }


            appState.observerTimer =
                setTimeout(
                    () => {

                        appState.observerTimer =
                            null;


                        setupAutomationButtons();

                    },
                    OBSERVER_DELAY
                );
        }
    );




/* =========================================================
   INICIALIZACAO
   ========================================================= */

if (
    document.readyState ===
    'loading'
) {

    document.addEventListener(
        'DOMContentLoaded',
        start
    );

} else {

    start();
}
