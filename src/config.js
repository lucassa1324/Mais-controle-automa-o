/* =========================================================
   CONFIGURACAO
   ========================================================= */

export const HOTKEY = {
    ctrl: true,
    alt: true,
    shift: false,
    meta: false,
    key: 'Z'
};

export const STORAGE_KEY = 'insumos_transferencia_copiados';
export const CLIPBOARD_SOURCE = 'APPSHEET_MAIS_CONTROLE';
export const PROGRESS_KEY = 'insumos_transferencia_progresso';
export const PEDIDO_PROGRESS_KEY = 'insumos_pedido_progresso';
export const POSITION_KEY = 'mc_automation_panel_position';

export const BATCH_SIZE = 10;
export const OBSERVER_DELAY = 700;

export const PANEL_ID = 'mc-automation-panel';
export const UI_CLASS = 'mc-automation-ui';

/* =========================================================
   SELECTORES DO ERP
   ========================================================= */

export const ERP = {
    keywordId: 'keyword',

    modalSelectors: [
        '.modal',
        '.modal-dialog',
        '.modal-content',
        '.modal-body',
        '[role="dialog"]',
        '[aria-modal="true"]',
        '.popup',
        '.drawer',
        '[class*="modal"]',
        '[class*="Modal"]',
        '[class*="dialog"]',
        '[class*="Dialog"]'
    ],

    adicionarInsumoText: 'adicionar insumo',
    adicionarText: 'adicionar',

    observacoesLabels: [
        'observações',
        'observacao',
        'observação'
    ],

    timeouts: {
        modalOpen: 10000,
        modalClose: 20000,
        materialRow: 6000
    }
};
