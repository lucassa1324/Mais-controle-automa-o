/* =========================================================
   DETECCAO DAS PAGINAS
   ========================================================= */

import { ERP } from './config'
import { bodyText, cleanText } from './utils'

const MODAL_SELECTOR = ERP.modalSelectors.join(', ');
const FIELD_SELECTOR = 'button, a, [role="button"], input[type="button"], input[type="submit"], div[role="button"]';

/*
 * Botao de confirmacao da modal ("ADICIONAR (20)").
 *
 * Esse botao SO existe dentro da modal de busca,
 * por isso ele e um sinal confiavel de que a
 * modal esta aberta.
 */
const CONFIRM_BUTTON_PATTERN = /^adicionar\s*\(\s*\d+\s*\)$/;


export function isElementVisible(el) {

    if (!el)
        return false;

    if (el.hidden)
        return false;

    if (typeof el.getClientRects === 'function') {

        const rects = el.getClientRects();

        if (!rects || !rects.length)
            return false;
    }

    if (typeof window !== 'undefined') {

        const style = window.getComputedStyle?.(el);

        if (style) {

            if (style.display === 'none')
                return false;

            if (style.visibility === 'hidden')
                return false;
        }
    }

    return true;
}


/*
 * Visibilidade REAL para modais MUI/React.
 *
 * O MUI mantem modais antigos montados com opacity: 0
 * e/ou aria-hidden="true". Eles continuam tendo
 * getClientRects(), entao isElementVisible() os
 * considera visiveis — e a automacao acaba digitando
 * no #keyword errado (modal velha em vez da ativa).
 */
export function isElementEnabled(el) {

    if (!el)
        return false;

    if (el.disabled)
        return false;

    const disabledAttribute = el.getAttribute?.('disabled');

    if (disabledAttribute !== null && disabledAttribute !== undefined)
        return false;

    if (el.getAttribute?.('aria-disabled') === 'true')
        return false;

    if (/(^|\s)Mui-disabled(\s|$)/.test(String(el.className || '')))
        return false;

    return true;
}


export function isReallyVisible(el) {

    if (!el)
        return false;

    if (el.hidden)
        return false;

    if (typeof el.getClientRects === 'function') {

        const rects = el.getClientRects();

        if (!rects || !rects.length)
            return false;
    }

    let node = el;

    while (node) {

        if (node.hidden)
            return false;

        if (
            typeof node.getAttribute === 'function' &&
            node.getAttribute('aria-hidden') === 'true'
        ) {
            return false;
        }

        if (typeof window !== 'undefined') {

            const style = window.getComputedStyle?.(node);

            if (style) {

                if (style.display === 'none')
                    return false;

                if (
                    style.visibility === 'hidden' ||
                    style.visibility === 'collapse'
                ) {
                    return false;
                }

                const opacity = parseFloat(style.opacity);

                if (Number.isFinite(opacity) && opacity <= 0.01)
                    return false;
            }
        }

        node = node.parentElement || null;
    }

    return true;
}


export function getModalContainers() {
    return Array.from(document.querySelectorAll(MODAL_SELECTOR));
}


export function getVisibleTables() {

    return Array.from(document.querySelectorAll('table'))
        .filter(table => isElementVisible(table))
        .filter(table => table.querySelectorAll('tr').length > 0);
}


export function getSearchInputs() {
    return Array.from(document.querySelectorAll(
        `input#${ERP.keywordId}, input[name="${ERP.keywordId}"]`
    ));
}


/**
 * Texto do bloco (ate N niveis acima) que contem o elemento.
 */
export function getContextText(el, levels = 4) {

    let node = el;
    let best = '';

    for (let i = 0; i < levels && node; i++) {

        const text = cleanText(node.innerText || node.textContent || '').toLowerCase();

        if (text.length > best.length)
            best = text;

        node = node.parentElement;
    }

    return best;
}


function getSearchHint(input) {

    if (!input)
        return '';

    const parts = [
        input.getAttribute?.('placeholder'),
        input.getAttribute?.('aria-label'),
        input.getAttribute?.('title'),
        input.getAttribute?.('name')
    ];

    const labelledBy = input.getAttribute?.('aria-labelledby');

    if (labelledBy && typeof document !== 'undefined') {

        for (const id of String(labelledBy).split(/\s+/).filter(Boolean)) {

            const label = document.getElementById?.(id);

            if (label)
                parts.push(label.innerText || label.textContent || '');
        }
    }

    /*
     * No MUI o texto "Buscar um insumo" fica em um
     * <label> dentro do FormControl do proprio campo;
     * o input pode nao ter placeholder.
     *
     * Procuramos apenas labels FILHOS DIRETOS dos
     * ancestrais proximos, para nao pegar o label de
     * outro campo que esteja no mesmo bloco.
     */
    let node = input.parentElement;

    for (let i = 0; i < 2 && node; i++) {

        const label = Array.from(node.children || [])
            .find(child =>
                String(child.tagName || '').toUpperCase() === 'LABEL'
            );

        if (label) {
            parts.push(label.innerText || label.textContent || '');
            break;
        }

        node = node.parentElement;
    }

    return cleanText(parts.filter(Boolean).join(' ')).toLowerCase();
}


export function getSearchInputHint(input) {
    return getSearchHint(input);
}


/*
 * Campo que filtra os itens JA ADICIONADOS.
 *
 * Ele tambem tem id="keyword" e aparece depois que o
 * primeiro lote e adicionado. Nunca devemos digitar nele.
 */
function isAddedItemsFilter(input) {

    const hint = getSearchHint(input);

    return (
        hint.includes('adicionad') ||
        hint.includes('incluíd') ||
        hint.includes('incluid') ||
        hint.includes('salvos')
    );
}


function isAdicionarInsumoSearchHint(input) {

    const hint = getSearchHint(input);

    if (!hint || isAddedItemsFilter(input))
        return false;

    return (
        hint.includes('um insumo') ||
        hint.includes('buscar insumo') ||
        hint.includes('procurar insumo') ||
        hint.includes('pesquisar insumo') ||
        hint.includes('adicionar insumo')
    );
}


/*
 * Titulo da modal ("Adicionar Insumo").
 *
 * No ERP real o #keyword da modal tem apenas o label
 * "Busca" e o botao de confirmacao fica "Adicionar"
 * (sem contagem) enquanto nada esta selecionado.
 * Sem o titulo, a modal nao era reconhecida e a
 * automacao pausava dizendo que nao abriu.
 */
const ADICIONAR_INSUMO_TITLE = /adicionar\s+insumo/i;

function hasAdicionarInsumoTitle(container) {

    if (!container || typeof container.querySelectorAll !== 'function')
        return false;

    const attributes = [
        container.getAttribute?.('aria-label'),
        container.getAttribute?.('title')
    ];

    if (attributes.some(value =>
        ADICIONAR_INSUMO_TITLE.test(cleanText(value).toLowerCase())
    )) {
        return true;
    }

    const headings = Array.from(container.querySelectorAll(
        'h1, h2, h3, h4, h5, h6, [role="heading"], ' +
        '.MuiDialogTitle-root, [id*="supplies"]'
    )).filter(isReallyVisible);

    return headings.some(heading =>
        ADICIONAR_INSUMO_TITLE.test(
            cleanText(heading.innerText || heading.textContent || '').toLowerCase()
        )
    );
}


/**
 * Escolhe o campo de busca da modal entre varios #keyword.
 *
 * Depois do primeiro lote o ERP passa a renderizar tambem
 * o filtro dos itens adicionados. O campo certo e o que
 * tem o texto "Buscar um insumo".
 */
function pickSearchInput(inputs) {

    if (!inputs || !inputs.length)
        return null;

    const strong = inputs.find(isAdicionarInsumoSearchHint);

    if (strong)
        return strong;

    const insumo = inputs.find(input => {

        const hint = getSearchHint(input);

        return hint.includes('insumo') && !isAddedItemsFilter(input);
    });

    if (insumo)
        return insumo;

    const remaining = inputs.filter(input => !isAddedItemsFilter(input));

    if (!remaining.length)
        return null;

    if (remaining.length === 1)
        return remaining[0];

    /*
     * Sem dica no texto: prefere o campo que NAO tem
     * adornment (o filtro dos adicionados costuma ter
     * icone de busca no fim).
     */
    const plain = remaining.filter(input =>
        !String(input.className || '').includes('AdornedEnd')
    );

    if (plain.length === 1)
        return plain[0];

    return remaining[0];
}


const DIALOG_ANCESTOR_SELECTOR =
    '[role="dialog"], [aria-modal="true"], ' +
    '.MuiDialog-paper, .MuiDialog-container, ' +
    '.modal, .modal-dialog, .modal-content, .modal-body, .popup, .drawer';


function getDialogAncestor(input) {

    if (!input || typeof input.closest !== 'function')
        return null;

    try {
        return input.closest(DIALOG_ANCESTOR_SELECTOR);
    } catch (e) {
        return null;
    }
}


function isInsideDialog(input) {
    return !!getDialogAncestor(input);
}


function findSearchInputIn(container) {

    if (!container)
        return null;

    /*
     * SOMENTE #keyword e SOMENTE dentro de um dialogo.
     *
     * Antes havia um fallback para "qualquer input de texto",
     * mas ele confundia campos comuns da tela (ex.: filtro
     * dos itens da Transferencia) com o campo da modal.
     * O filtro de dialogo garante que um wrapper da pagina
     * nunca forneca o campo de busca errado.
     */
    const keywords = Array.from(container.querySelectorAll(`input#${ERP.keywordId}`))
        .filter(isReallyVisible)
        .filter(isInsideDialog);

    return pickSearchInput(keywords);
}


/**
 * O container realmente e um dialogo/modal?
 *
 * Sem esse filtro, qualquer bloco da tela de Transferencia
 * que contenha a palavra "ADICIONAR INSUMO" seria confundido
 * com a modal de busca.
 */
export function isDialogLike(container) {

    if (!container)
        return false;

    if (typeof container.matches === 'function') {

        try {

            if (container.matches(
                '[role="dialog"], [aria-modal="true"], .modal, .modal-dialog, ' +
                '.modal-content, .modal-body, .popup, .drawer'
            )) {
                return true;
            }

        } catch (e) { }
    }

    const className = String(container.className || '');

    if (/(^|[\s_-])(modal|popup|drawer|overlay|backdrop|dialog)/i.test(className))
        return true;

    if (typeof window !== 'undefined') {

        const style = window.getComputedStyle?.(container);

        if (style && (style.position === 'fixed' || style.position === 'absolute'))
            return true;
    }

    return false;
}


/**
 * Botao de confirmacao da modal ("ADICIONAR (20)").
 */
export function findConfirmButtonIn(container) {

    if (!container || typeof container.querySelectorAll !== 'function')
        return null;

    const candidates = Array.from(container.querySelectorAll(FIELD_SELECTOR))
        .filter(el => isReallyVisible(el))
        .filter(el => CONFIRM_BUTTON_PATTERN.test(getButtonText(el)));

    if (!candidates.length)
        return null;

    return candidates[candidates.length - 1];
}


export function findConfirmButton() {
    return findConfirmButtonIn(typeof document !== 'undefined' ? document : null);
}


export function getAdicionarInsumoModal() {

    const containers = getModalContainers();

    /*
     * 1) Dialogo/modal REALMENTE visivel contendo #keyword.
     *
     * Percorremos de tras para frente: o MUI anexa o
     * dialogo ativo no fim do body, entao o ultimo
     * container visivel e o correto. Modais antigos
     * (opacity 0 / aria-hidden) ficam de fora.
     */
    for (let i = containers.length - 1; i >= 0; i--) {

        const container = containers[i];

        /*
         * body/html podem ganhar classes como "modal-open"
         * quando a modal abre. Eles nao sao a modal.
         */
        if (
            typeof document !== 'undefined' &&
            (container === document.body || container === document.documentElement)
        ) {
            continue;
        }

        if (!isReallyVisible(container))
            continue;

        const titled = hasAdicionarInsumoTitle(container);

        if (!isDialogLike(container) && !titled)
            continue;

        const input = findSearchInputIn(container);

        if (!input)
            continue;

        /*
         * Confirma que o container e mesmo a area de
         * ADICIONAR INSUMO: precisa ter o titulo
         * "Adicionar Insumo" ou o botao de confirmacao
         * do lote.
         *
         * NAO usamos a dica do campo como confirmacao:
         * a tela de Transferencia tambem tem um #keyword
         * com "Buscar insumo" e um wrapper modal-open
         * poderia ser confundido com a modal.
         */
        if (
            !titled &&
            !findConfirmButtonIn(container)
        ) {
            continue;
        }

        return container;
    }

    const inputs = getSearchInputs()
        .filter(isReallyVisible)
        .filter(isInsideDialog);

    /*
     * 2) Sem container reconhecido, o botao "ADICIONAR (n)"
     *    realmente visivel e o sinal de que a modal esta aberta.
     */
    if (findConfirmButton()) {

        const picked = pickSearchInput(inputs);

        if (picked)
            return getDialogAncestor(picked) || picked;
    }

    return null;
}


export function getAdicionarInsumoSearchInput() {

    const modal = getAdicionarInsumoModal();

    if (!modal)
        return null;

    /*
     * O "container" pode ser o proprio input
     * (quando nao existe uma classe de modal no ERP).
     */
    if (String(modal.tagName || '').toUpperCase() === 'INPUT')
        return isReallyVisible(modal) ? modal : null;

    const input = findSearchInputIn(modal);

    if (input)
        return input;

    /*
     * NUNCA cair para "qualquer #keyword da pagina".
     * Era isso que fazia a automacao digitar no campo
     * de itens da Transferencia depois de confirmar o lote.
     */
    return null;
}


function getButtonText(el) {
    return cleanText(el?.innerText || el?.textContent || el?.value || '').toLowerCase();
}


export function getAdicionarInsumoButton() {

    const modal = getAdicionarInsumoModal();

    const candidates = Array.from(document.querySelectorAll(FIELD_SELECTOR))
        .filter(el => isReallyVisible(el))
        .filter(el => !modal || !modal.contains?.(el));

    const exact = candidates.find(el => getButtonText(el) === ERP.adicionarInsumoText);

    if (exact)
        return exact;

    const partial = candidates
        .filter(el => getButtonText(el).includes(ERP.adicionarInsumoText))
        .sort((a, b) => getButtonText(a).length - getButtonText(b).length);

    return partial[0] || null;
}


export function getAdicionarButton() {

    const modal = getAdicionarInsumoModal();

    const candidates = Array.from(document.querySelectorAll(FIELD_SELECTOR))
        .filter(el => isReallyVisible(el));

    const withCount = candidates.filter(el => CONFIRM_BUTTON_PATTERN.test(getButtonText(el)));

    if (withCount.length) {

        if (!modal)
            return withCount[withCount.length - 1];

        const inside = withCount.filter(el => modal.contains?.(el));

        return inside[inside.length - 1] || null;
    }

    const exact = candidates.filter(el => getButtonText(el) === ERP.adicionarText);

    if (exact.length) {

        if (!modal)
            return exact[exact.length - 1];

        const inside = exact.filter(el => modal.contains?.(el));

        /*
         * Com a modal aberta, o botao certo e SEMPRE o que
         * esta dentro dela. Nunca clicar em um "Adicionar"
         * perdido na pagina de Transferencia.
         */
        return inside[inside.length - 1] || null;
    }

    return null;
}


export function isAdicionarInsumoPage() {
    return !!getAdicionarInsumoModal();
}


export function isPedidoPath() {

    const pathname = String(
        (typeof window !== 'undefined' && window.location?.pathname) || ''
    );

    /*
     * Ex.: /compras/solicitacoes/123, /compras/pedidos/123
     */
    if (/\/compras\/(?:solicitac|pedid)/i.test(pathname))
        return true;

    return /\/solicitac(?:ao|oes|ões)|\/pedidos?\//i.test(pathname);
}


export function isPedidoPage() {

    /*
     * 1) URL da tela de solicitações/pedidos.
     */
    if (isPedidoPath())
        return true;


    /*
     * 2) Conteudo da tela.
     *
     * Página onde ficam listados os itens da solicitação.
     */
    const text = bodyText();

    return (
        (
            text.includes('solicitação') ||
            text.includes('solicitacao') ||
            text.includes('adicionar item')
        ) &&
        (
            text.includes('qtde solicitada') ||
            text.includes('quantidade solicitada') ||
            text.includes('itens')
        )
    );
}


export function isTransferenciaPage() {

    if (isAdicionarInsumoPage())
        return false;

    /*
     * URL de transferencia (ex.: /compras/transferencias/10).
     * Vale mesmo se o texto da tela mudar em novas versoes.
     */
    const pathname = String(
        (typeof window !== 'undefined' && window.location?.pathname) || ''
    );

    if (/transferenc/i.test(pathname))
        return true;

    const text = bodyText();

    if (/qtde\s+a\s+transfer/.test(text))
        return true;

    return !!getAdicionarInsumoButton();
}


/**
 * Host do AppSheet.
 *
 * Nao depende do conteudo ja ter renderizado:
 * o painel/botao precisa aparecer mesmo enquanto
 * a tabela ainda esta carregando.
 */
export function isAppSheetHost() {

    if (typeof window === 'undefined')
        return false;

    const host = String(
        window.location?.hostname || ''
    ).toLowerCase();

    return (
        host === 'appsheet.com' ||
        host.endsWith('.appsheet.com')
    );
}


/**
 * Pagina de detalhe/lancamento do AppSheet.
 *
 * O AppSheet roda em appsheet.com e mostra
 * os campos do pedido (cabecalho) e a tabela
 * de itens relacionados.
 */
export function isAppSheetPage() {

    if (!isAppSheetHost())
        return false;


    /*
     * Precisa existir uma tabela visivel
     * ou os blocos de detalhe do pedido.
     */
    if (getVisibleTables().length)
        return true;

    return !!document.querySelector(
        '.field-header, .field-title, .field-label, .field-value, ' +
        '.detail-field, .detail-value, .column-name, .cell-label, ' +
        '[class*="field-header"], [class*="field-value"], ' +
        '[class*="detail-field"], [class*="detail-row"], ' +
        '[role="row"], [role="grid"]'
    );
}
