/* =========================================================
   CSS DA EXTENSAO
   ========================================================= */

import { PANEL_ID, UI_CLASS } from './config'
import { log } from './utils'

export function installStyles() {

    if (
        document.getElementById(
            'mc-automation-styles'
        )
    ) {
        return;
    }


    const style =
        document.createElement('style');


    style.id =
        'mc-automation-styles';


    style.className =
        UI_CLASS;


    style.textContent = `

        /* =================================================
           PAINEL FLUTUANTE
           ================================================= */

        #${PANEL_ID} {

            position: fixed;

            top: 90px;
            right: 20px;

            width: 340px;

            max-width:
                calc(100vw - 20px);

            z-index: 2147483646;

            background: #fff;

            border:
                1px solid #d9d9d9;

            border-radius: 14px;

            box-shadow:
                0 12px 35px
                rgba(0,0,0,.24);

            overflow: hidden;

            font-family:
                Arial,
                Helvetica,
                sans-serif;

            color: #444;

            user-select: none;
        }


        #${PANEL_ID}.mc-collapsed {

            width: 100px;

            border-radius: 10px;
        }


        .mc-panel-header {

            height: 48px;

            background: #1976d2;

            color: #fff;

            display: flex;

            align-items: center;

            justify-content:
                space-between;

            padding:
                0 14px;

            cursor: move;
        }


        .mc-panel-title {

            font-size: 16px;

            font-weight: 700;
        }


        .mc-panel-header-actions button,
        .mc-collapsed-bar button {

            border: 0;

            background:
                rgba(255,255,255,.18);

            color: #fff;

            border-radius: 6px;

            width: 30px;

            height: 30px;

            font-size: 20px;

            cursor: pointer;
        }


        .mc-panel-body {

            padding: 12px;
        }


        .mc-panel-status {

            font-size: 15px;

            margin-bottom: 10px;
        }


        .mc-panel-line {

            font-size: 13px;

            margin: 5px 0;
        }


        .mc-panel-items {

            max-height: 88px;

            overflow-y: auto;

            background: #fafafa;

            border: 1px solid #e0e0e0;

            border-radius: 8px;

            padding: 7px;

            margin: 8px 0;

            font-size: 11px;

            line-height: 1.45;
        }

        .mc-panel-items-title {

            font-weight: 700;

            margin-bottom: 4px;
        }


        .mc-panel-notfound {

            color: #e53935;

            font-size: 14px;

            line-height: 1.45;

            margin: 10px 0;

            overflow-wrap:
                anywhere;
        }


        .mc-panel-message {

            background: #f4f5f7;

            border-radius: 8px;

            padding: 8px;

            font-size: 12px;

            line-height: 1.35;

            margin: 8px 0;
        }


        .mc-panel-log {

            height: 78px;

            overflow-y: auto;

            background: #fafafa;

            border:
                1px solid #eee;

            border-radius: 8px;

            padding: 6px;

            font-size: 10px;

            line-height: 1.3;

            margin-bottom: 8px;
        }


        .mc-panel-actions {

            display: grid;

            grid-template-columns:
                repeat(2, minmax(0, 1fr));

            gap: 6px;

            margin-bottom: 8px;
        }


        .mc-panel-actions .mc-btn {

            width: 100%;

            padding: 8px 5px;

            font-size: 10px;

            line-height: 1.25;
        }


        .mc-panel-buttons {

            display: grid;

            grid-template-columns:
                1fr 1fr;

            gap: 6px;
        }


        #${PANEL_ID}.mc-appsheet .mc-panel-actions {

            grid-template-columns: 1fr;
        }


        #${PANEL_ID}.mc-appsheet .mc-play {

            grid-column: 1 / -1;
        }


        .mc-btn {

            border: 0;

            border-radius: 7px;

            padding: 8px 5px;

            font-size: 11px;

            font-weight: 700;

            line-height: 1.25;

            cursor: pointer;
        }


        .mc-copy-panel,
        .mc-copy-pedido {

            background: #1976d2;

            color: #fff;
        }


        .mc-pedido-panel,
        .mc-fill-panel {

            background: #28a745;

            color: #fff;
        }


        .mc-play {

            background: #28a745;

            color: #fff;
        }


        .mc-pause {

            background: #ffc107;

            color: #111;
        }


        .mc-cancel {

            background: #dc3545;

            color: #fff;
        }


        .mc-restart {

            background: #6c757d;

            color: #fff;
        }


        .mc-btn:hover {

            filter:
                brightness(.95);
        }


        .mc-collapsed-bar {

            height: 44px;

            padding:
                0 8px 0 12px;

            display: flex;

            align-items: center;

            justify-content:
                space-between;

            background: #1976d2;

            color: #fff;

            font-weight: 700;

            cursor: move;
        }


        /* =================================================
           TOAST
           ================================================= */

        #mc-automation-toast {

            position: fixed;

            right: 20px;

            bottom: 20px;

            z-index: 2147483647;

            background: #333;

            color: #fff;

            padding:
                11px 15px;

            border-radius: 8px;

            box-shadow:
                0 5px 18px
                rgba(0,0,0,.25);

            font:
                14px Arial,
                sans-serif;

            max-width: 420px;
        }


        #mc-automation-toast[data-type="success"] {

            background: #198754;
        }


        #mc-automation-toast[data-type="error"] {

            background: #dc3545;
        }


        #mc-automation-toast[data-type="warning"] {

            background: #ffc107;

            color: #111;
        }


        /* =================================================
           BOTÃO DE ORDENAR
           ================================================= */

        .mc-sort-button {

            margin:
                8px 0 8px auto !important;

            display: block !important;

            background:
                #087ff5 !important;

            color:
                #fff !important;

            border:
                0 !important;

            border-radius:
                7px !important;

            padding:
                10px 14px !important;

            font-weight:
                700 !important;

            cursor:
                pointer !important;

            box-shadow:
                0 2px 7px
                rgba(0,0,0,.15) !important;
        }


        /* =================================================
           BOTÕES PRINCIPAIS
           ================================================= */

        .mc-floating-actions {

            position: fixed !important;

            top: 30px !important;

            right: 28px !important;

            z-index: 2147483645 !important;

            display: flex !important;

            flex-direction: row !important;

            flex-wrap: wrap !important;

            justify-content:
                flex-end !important;

            align-items: center !important;

            gap: 8px !important;

            max-width:
                calc(100vw - 56px) !important;

            pointer-events: none !important;
        }


        .mc-floating-actions > * {

            pointer-events: auto !important;
        }


        .mc-copy-button,
        .mc-auto-button,
        .mc-fill-button,
        .mc-pedido-auto-button {

            position: static !important;

            top: auto !important;

            right: auto !important;

            left: auto !important;

            bottom: auto !important;

            border: 0 !important;

            border-radius:
                8px !important;

            padding:
                12px 17px !important;

            background:
                #1976d2 !important;

            color:
                #fff !important;

            font-weight:
                700 !important;

            font-size:
                14px !important;

            cursor:
                pointer !important;

            box-shadow:
                0 4px 12px
                rgba(0,0,0,.2) !important;
        }


        .mc-auto-button,
        .mc-pedido-auto-button {

            background:
                #28a745 !important;
        }


        .mc-fill-button {

            background:
                #1976d2 !important;
        }


        /* =================================================
           ÍNDICES
           ================================================= */

        .mc-index-cell {

            width: 60px;

            text-align:
                center !important;

            font-weight:
                700 !important;
        }

    `;


    document.head.appendChild(
        style
    );
}


/**
 * Container unico dos botoes flutuantes.
 *
 * Todos os botoes da extensao sao inseridos aqui,
 * empilhados/agrupados pelo flexbox do CSS.
 * Assim nenhum botao fica exatamente em cima do outro.
 */
export function getFloatingActionsContainer() {

    installStyles();

    let container =
        document.getElementById(
            'mc-floating-actions'
        );


    if (!container) {

        container =
            document.createElement('div');

        container.id =
            'mc-floating-actions';

        container.className =
            `mc-floating-actions ${UI_CLASS}`;

        document.body.appendChild(
            container
        );
    }


    return container;
}


export function mountFloatingButton(button) {

    if (!button)
        return null;

    getFloatingActionsContainer()
        .appendChild(button);

    return button;
}
