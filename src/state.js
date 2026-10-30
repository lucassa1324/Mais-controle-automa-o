/* =========================================================
   ESTADO COMPARTILHADO
   ========================================================= */

/**
 * Estado global da automacao.
 *
 * Fica isolado aqui para que todos os modulos usem
 * a mesma instancia (e nao copias).
 */
export const appState = {
    // SEMPRE comeca desligada quando a pagina e atualizada.
    extensionEnabled: false,

    // idle | running | paused | waitingAdd | cancelled | completed
    automationState: 'idle',

    // transfer | pedido
    activeFlow: 'transfer',

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

/**
 * Ponte entre o painel e a automacao.
 *
 * Evita dependencia circular entre panel.js e automation.js:
 * o painel chama os controles pelo registro, e nao por import.
 */
export const controls = {
    play: null,
    pause: null,
    cancel: null,
    restart: null,
    copyAppSheet: null
};

export function registerControls(next) {
    Object.assign(controls, next);
}
