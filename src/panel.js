/* =========================================================
   PAINEL FLUTUANTE
   ========================================================= */

import { CLIPBOARD_SOURCE, PANEL_ID, STORAGE_KEY, UI_CLASS } from './config'
import { appState, controls } from './state'
import { log } from './utils'
import { getCodesFromStorage, getItemsFromStorage, getMetadataFromStorage, getPedidoProgress, getProgress, getStorageData, loadPanelPosition, parseClipboardPayload, saveClipboardPayload, savePanelPosition, setProgressListener } from './storage'
import { readClipboardText } from './clipboard'
import { isAppSheetHost, isPedidoPage, isTransferenciaPage } from './pages'

export function getPanel() {
    return document.getElementById(PANEL_ID);
}


/**
 * HTML do painel expandido.
 *
 * Compartilhado entre a criacao inicial e a expansao
 * apos ser minimizado.
 */
const PANEL_HTML = `

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

const PANEL_ACTIONS = [
    {
        selector: '.mc-paste-panel',
        className: 'mc-paste-panel',
        text: '📥 CARREGAR / COLAR INSUMOS',
        title: 'Carregar os insumos copiados do AppSheet via Área de Transferência'
    },
    {
        selector: '.mc-copy-panel',
        className: 'mc-copy-panel',
        text: '📋 COPIAR INSUMOS DO APPSHEET',
        title: 'Copiar os insumos exibidos no AppSheet'
    },
    {
        selector: '.mc-copy-pedido',
        className: 'mc-copy-pedido',
        text: '📋 COPIAR INSUMOS DO PEDIDO',
        title: 'Copiar os itens da solicitação/pedido atual'
    },
    {
        selector: '.mc-pedido-panel',
        className: 'mc-pedido-panel',
        text: '⚡ ADICIONAR ITENS NO PEDIDO',
        title: 'Abrir a modal, buscar e marcar os itens do pedido'
    },
    {
        selector: '.mc-fill-panel',
        className: 'mc-fill-panel',
        text: '⚡ PREENCHER QUANTIDADES',
        title: 'Preencher as quantidades copiadas na Transferência'
    }
];


function ensurePanelActions(panel) {

    let container =
        panel.querySelector('.mc-panel-actions');

    if (!container) {

        container =
            document.createElement('div');

        container.className =
            'mc-panel-actions';

        panel.appendChild(container);
    }


    for (const action of PANEL_ACTIONS) {

        if (panel.querySelector(action.selector))
            continue;


        const button =
            document.createElement('button');

        button.type = 'button';

        button.className =
            `mc-btn ${action.className}`;

        button.textContent =
            action.text;

        button.title =
            action.title;

        button.hidden = true;

        container.appendChild(button);
    }


    return container;
}


export function createPanel(force = false) {

    if (!appState.extensionEnabled && !force) return null;

    let panel = getPanel();

    if (panel) {

        ensurePanelActions(panel);
        updatePanel();

        return panel;
    }


    panel = document.createElement('div');

    panel.id = PANEL_ID;

    panel.className = UI_CLASS;


    panel.innerHTML = PANEL_HTML;

    ensurePanelActions(panel);


    document.body.appendChild(panel);


    const position =
        loadPanelPosition();


    if (position) {

        const maxLeft =
            Math.max(
                5,
                window.innerWidth - 30
            );

        const maxTop =
            Math.max(
                5,
                window.innerHeight - 60
            );


        panel.style.left =
            `${Math.min(
                Math.max(5, position.left),
                maxLeft
            )}px`;

        panel.style.top =
            `${Math.min(
                Math.max(5, position.top),
                maxTop
            )}px`;

        panel.style.right = 'auto';
    }


    setupPanelEvents(panel);

    updatePanel();

    return panel;
}


function copyFromAppSheet() {

    if (typeof controls.copyAppSheet === 'function') {
        controls.copyAppSheet();
        return;
    }

    setPanelMessage(
        'A cópia do AppSheet não está disponível nesta tela.'
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


export async function pasteInsumosFromClipboard() {

    const text = await readClipboardText();

    let payload = parseClipboardPayload(text);
    let origin = 'Clipboard';

    if (!payload && !text) {

        payload = readSharedPayloadFallback();

        if (payload)
            origin = 'memória compartilhada';
    }


    if (!payload) {

        const message =
            'Nenhum dado válido do AppSheet encontrado na Área de Transferência.';

        addLog(`⚠️ ${message}`);
        setPanelMessage(message);
        showToast(message, 'warning');
        updatePanel();

        return false;
    }


    const count = saveClipboardPayload(payload);

    if (!count) {

        const message =
            'O conteúdo colado não possui insumos válidos.';

        addLog(`⚠️ ${message}`);
        setPanelMessage(message);
        showToast(message, 'warning');
        updatePanel();

        return false;
    }


    appState.copySummary = null;

    controls.sortTables?.(true);

    addLog(
        origin === 'Clipboard'
            ? '✅ Insumos colados e carregados com sucesso do Clipboard!'
            : `✅ ${count} insumos recuperados da memória compartilhada!`
    );

    setPanelMessage(
        `✅ ${count} insumos carregados. Vá para a Transferência e clique PLAY.`
    );

    showToast(
        `${count} insumos carregados do ${origin}.`,
        'success'
    );

    updatePanel();

    return true;
}


let autoClipboardCheck = false;

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
            '✅ Insumos carregados automaticamente do Clipboard!'
        );

        setPanelMessage(
            `✅ ${count} insumos carregados do Clipboard. Vá para a Transferência e clique PLAY.`
        );

        updatePanel();

    } finally {
        autoClipboardCheck = false;
    }
}


export function handlePanelPlay() {

    if (isAppSheetHost()) {
        copyFromAppSheet();
        return;
    }

    controls.play?.();
}


export function setupPanelEvents(panel) {

    const minimize =
        panel.querySelector(
            '.mc-panel-minimize'
        );

    const play =
        panel.querySelector('.mc-play');

    const pause =
        panel.querySelector('.mc-pause');

    const cancel =
        panel.querySelector('.mc-cancel');

    const restart =
        panel.querySelector('.mc-restart');

    const pastePanel =
        panel.querySelector('.mc-paste-panel');

    const copyPanel =
        panel.querySelector('.mc-copy-panel');

    const copyPedido =
        panel.querySelector('.mc-copy-pedido');

    const addPedido =
        panel.querySelector('.mc-pedido-panel');

    const fillPanel =
        panel.querySelector('.mc-fill-panel');


    pastePanel?.addEventListener(
        'click',
        () => pasteInsumosFromClipboard()
    );

    copyPanel?.addEventListener(
        'click',
        copyFromAppSheet
    );

    copyPedido?.addEventListener(
        'click',
        () => controls.copyPedido?.()
    );

    addPedido?.addEventListener(
        'click',
        () => controls.play?.()
    );

    fillPanel?.addEventListener(
        'click',
        () => controls.fillTransfer?.()
    );


    minimize?.addEventListener(
        'click',
        e => {

            e.stopPropagation();

            setPanelCollapsed(
                panel,
                true
            );
        }
    );


    play?.addEventListener(
        'click',
        handlePanelPlay
    );


    pause?.addEventListener(
        'click',
        () => controls.pause?.()
    );


    cancel?.addEventListener(
        'click',
        () => controls.cancel?.()
    );


    restart?.addEventListener(
        'click',
        () => controls.restart?.()
    );


    makeDraggable(
        panel,
        panel.querySelector(
            '.mc-panel-header'
        )
    );
}


export function setPanelCollapsed(
    panel,
    collapsed
) {

    if (!panel) return;


    panel.classList.toggle(
        'mc-collapsed',
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


    panel
        .querySelector('.mc-panel-open')
        .addEventListener(
            'click',
            e => {

                e.stopPropagation();

                recreateExpandedPanel(
                    panel
                );
            }
        );


    makeDraggable(
        panel,
        panel.querySelector(
            '.mc-collapsed-bar'
        )
    );
}


export function recreateExpandedPanel(panel) {

    const rect =
        panel.getBoundingClientRect();


    panel.classList.remove(
        'mc-collapsed'
    );


    panel.innerHTML = PANEL_HTML;

    ensurePanelActions(panel);


    panel.style.left =
        `${Math.max(5, rect.left)}px`;

    panel.style.top =
        `${Math.max(5, rect.top)}px`;

    panel.style.right = 'auto';


    setupPanelEvents(panel);

    updatePanel();
}


export function makeDraggable(
    element,
    handle
) {

    if (!element || !handle) return;

    if (
        handle.dataset.dragReady === 'true'
    ) {
        return;
    }

    handle.dataset.dragReady = 'true';


    let dragging = false;

    let startX = 0;
    let startY = 0;

    let startLeft = 0;
    let startTop = 0;


    handle.addEventListener(
        'pointerdown',
        e => {

            if (
                e.target.closest('button')
            ) {
                return;
            }


            const rect =
                element.getBoundingClientRect();


            dragging = true;

            startX = e.clientX;
            startY = e.clientY;

            startLeft = rect.left;
            startTop = rect.top;


            element.style.left =
                `${startLeft}px`;

            element.style.top =
                `${startTop}px`;

            element.style.right =
                'auto';

            element.style.bottom =
                'auto';


            handle.setPointerCapture?.(
                e.pointerId
            );

            e.preventDefault();
        }
    );


    handle.addEventListener(
        'pointermove',
        e => {

            if (!dragging) return;


            const dx =
                e.clientX - startX;

            const dy =
                e.clientY - startY;


            const width =
                element.offsetWidth;

            const height =
                element.offsetHeight;


            const left =
                Math.min(
                    Math.max(
                        5,
                        startLeft + dx
                    ),
                    Math.max(
                        5,
                        window.innerWidth -
                        width -
                        5
                    )
                );


            const top =
                Math.min(
                    Math.max(
                        5,
                        startTop + dy
                    ),
                    Math.max(
                        5,
                        window.innerHeight -
                        height -
                        5
                    )
                );


            element.style.left =
                `${left}px`;

            element.style.top =
                `${top}px`;
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
        'pointerup',
        stop
    );

    handle.addEventListener(
        'pointercancel',
        stop
    );
}


export function addLog(message) {

    const panel = getPanel();

    if (!panel) return;


    const box =
        panel.querySelector(
            '.mc-panel-log'
        );

    if (!box) return;


    const line =
        document.createElement('div');


    line.textContent =
        `${new Date().toLocaleTimeString(
            'pt-BR'
        )} - ${message}`;


    box.appendChild(line);


    while (
        box.children.length > 80
    ) {
        box.removeChild(
            box.firstChild
        );
    }


    box.scrollTop =
        box.scrollHeight;
}


export function setPanelMessage(message) {

    const panel = getPanel();

    const el =
        panel?.querySelector(
            '.mc-panel-message'
        );

    if (el) {
        el.textContent = message;
    }
}


export function setPanelStatus(status) {

    const panel = getPanel();

    const el =
        panel?.querySelector(
            '.mc-panel-status'
        );

    if (el) {

        el.innerHTML =
            `Status: <strong>${status}</strong>`;
    }
}


export function updatePanel() {

    const panel = getPanel();

    if (!panel) return;

    if (
        panel.classList.contains(
            'mc-collapsed'
        )
    ) {
        return;
    }


    const codes =
        getCodesFromStorage();


    const total =
        codes.length;


    const progress =
        appState.activeFlow === 'pedido'
            ? getPedidoProgress(total)
            : getProgress(total);


    const onAppSheet =
        isAppSheetHost();

    panel.classList.toggle(
        'mc-appsheet',
        onAppSheet
    );

    const onPedido =
        !onAppSheet &&
        isPedidoPage();

    const onTransfer =
        !onAppSheet &&
        isTransferenciaPage();

    const summary =
        onAppSheet
            ? appState.copySummary
            : null;

    const copiedNow =
        summary &&
        summary.count > 0
            ? summary.count
            : 0;


    /*
     * Encontrados = processados menos
     * os que foram registrados como não encontrados.
     */

    const found =
        copiedNow ||
        Math.max(
            0,
            progress.nextIndex -
            progress.notFound.length
        );


    const current =
        copiedNow || progress.nextIndex >= total
            ? '-'
            : codes[progress.nextIndex];


    const copies = [
        ['.mc-paste-panel', !onAppSheet],
        ['.mc-copy-panel', onAppSheet],
        ['.mc-copy-pedido', onPedido],
        ['.mc-pedido-panel', onPedido],
        ['.mc-fill-panel', onTransfer]
    ];


    for (const [selector, visible] of copies) {

        const button =
            panel.querySelector(selector);

        if (button) {
            button.hidden = !visible;
        }
    }


    const actions =
        panel.querySelector('.mc-panel-actions');

    if (actions) {
        actions.hidden =
            !onAppSheet &&
            !onPedido &&
            !onTransfer;
    }


    const controlsVisibility = [
        ['.mc-pause', !onAppSheet],
        ['.mc-cancel', !onAppSheet],
        ['.mc-restart', !onAppSheet]
    ];

    for (const [selector, visible] of controlsVisibility) {

        const button =
            panel.querySelector(selector);

        if (button) {
            button.hidden = !visible;
        }
    }


    const playButton =
        panel.querySelector('.mc-play');

    if (playButton) {

        playButton.textContent =
            onPedido
                ? '▶️ CONTINUAR PEDIDO'
                : onTransfer
                    ? '▶️ BUSCAR E SELECIONAR'
                    : '▶️ PLAY';
    }


    const progressEl =
        panel.querySelector(
            '.mc-progress'
        );


    const currentEl =
        panel.querySelector(
            '.mc-current'
        );


    const foundEl =
        panel.querySelector(
            '.mc-found'
        );


    const notFoundEl =
        panel.querySelector(
            '.mc-panel-notfound strong'
        );


    if (progressEl) {

        progressEl.textContent =
            `${copiedNow || progress.nextIndex} / ${total}`;
    }


    if (currentEl) {
        currentEl.textContent =
            current;
    }


    if (foundEl) {
        foundEl.textContent =
            String(found);
    }


    if (notFoundEl) {

        notFoundEl.textContent =
            !copiedNow &&
            progress.notFound.length
                ? progress.notFound.join(', ')
                : '-';
    }


    const itemsEl =
        panel.querySelector('.mc-panel-items');

    if (itemsEl) {

        while (itemsEl.firstChild)
            itemsEl.removeChild(itemsEl.firstChild);

        const storedItems = getItemsFromStorage();
        const storedCodes = Object.keys(storedItems);

        if (!storedCodes.length) {

            itemsEl.textContent =
                'Nenhum insumo carregado.';

        } else {

            itemsEl.textContent = '';

            const title =
                document.createElement('div');

            title.className =
                'mc-panel-items-title';

            title.textContent =
                `Itens carregados (${storedCodes.length})`;

            itemsEl.appendChild(title);

            for (const code of storedCodes) {

                const line =
                    document.createElement('div');

                line.textContent =
                    `${code} × ${storedItems[code]?.quantity ?? ''}`;

                itemsEl.appendChild(line);
            }
        }
    }


    let status = 'Pronto';


    if (
        appState.automationState === 'running'
    ) {
        status = 'Rodando';

    } else if (
        appState.automationState === 'paused'
    ) {
        status = 'Pausado';

    } else if (
        appState.automationState === 'waitingAdd'
    ) {
        status = 'Aguardando ADICIONAR';

    } else if (
        appState.automationState === 'cancelled'
    ) {
        status = 'Cancelado';

    } else if (
        appState.automationState === 'completed'
    ) {
        status = 'Concluído';
    }


    setPanelStatus(status);
}


export function showToast(
    message,
    type = 'info'
) {

    if (!appState.extensionEnabled) return;


    let toast =
        document.getElementById(
            'mc-automation-toast'
        );


    if (!toast) {

        toast =
            document.createElement(
                'div'
            );

        toast.id =
            'mc-automation-toast';

        toast.className =
            UI_CLASS;

        document.body.appendChild(
            toast
        );
    }


    toast.textContent =
        message;

    toast.dataset.type =
        type;

    toast.style.display =
        'block';


    clearTimeout(
        showToast.timer
    );


    showToast.timer =
        setTimeout(
            () => {

                toast.style.display =
                    'none';

            },
            4000
        );
}


export function removeExtensionUI() {

    document
        .querySelectorAll(
            `.${UI_CLASS}`
        )
        .forEach(
            el => el.remove()
        );
}


/**
 * Rele o storage compartilhado (GM_*) e redesenha as metricas.
 *
 * Chamado quando o usuario volta para a aba do Mais Controle
 * depois de copiar os insumos no AppSheet.
 */
export function refreshPanelState() {
    updatePanel();
    autoPasteFromClipboard();
}


function setupStorageSync() {

    if (
        typeof window !== 'undefined' &&
        typeof window.addEventListener === 'function'
    ) {
        window.addEventListener(
            'focus',
            refreshPanelState
        );
    }

    if (
        typeof document !== 'undefined' &&
        typeof document.addEventListener === 'function'
    ) {
        document.addEventListener(
            'visibilitychange',
            () => {

                if (document.visibilityState === 'visible')
                    refreshPanelState();
            }
        );
    }
}


setupStorageSync();


/*
 * O painel reage a cada gravacao de progresso.
 */
setProgressListener(updatePanel);
