/*
 * Teste do motor de automacao da tela de Pedido/Solicitacao.
 *
 * Valida:
 *  - deteccao da pagina de Pedido;
 *  - botao "Adicionar item";
 *  - modal com #keyword, linha MAT, checkbox e botao "Incluir";
 *  - agrupamento dos botoes flutuantes no container flex;
 *  - progresso independente do progresso da Transferencia.
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { el, makeSandbox } from './mock-dom.mjs';

const BASE = 'C:/Users/Lucas sa/Documents/Programação/mais_controle';
const TMP = 'C:/Users/LUCASS~1/AppData/Local/Temp/kilo';

const ENTRY = path.join(TMP, 'pedido-entry.js');
fs.writeFileSync(ENTRY, `
import { isPedidoPage } from '${BASE}/src/pages.js';
import {
    isPedidoAutomationPage,
    getPedidoModal,
    getPedidoSearchInput,
    getPedidoAddItemButton,
    getPedidoConfirmButton,
    openPedidoItemModal,
    findPedidoMaterialRow,
    selectPedidoRow,
    setupPedidoAutomation
} from '${BASE}/src/pedido_automation.js';
import { getFloatingActionsContainer, mountFloatingButton } from '${BASE}/src/styles.js';
import { appState } from '${BASE}/src/state.js';
import { getProgress, saveProgress, getPedidoProgress, savePedidoProgress } from '${BASE}/src/storage.js';
import { copyPedidoInsumos } from '${BASE}/src/pedido.js';
export {
    isPedidoPage,
    copyPedidoInsumos,
    isPedidoAutomationPage,
    getPedidoModal,
    getPedidoSearchInput,
    getPedidoAddItemButton,
    getPedidoConfirmButton,
    openPedidoItemModal,
    findPedidoMaterialRow,
    selectPedidoRow,
    setupPedidoAutomation,
    getFloatingActionsContainer,
    mountFloatingButton,
    appState,
    getProgress,
    saveProgress,
    getPedidoProgress,
    savePedidoProgress
};
`, 'utf8');

const OUT = path.join(TMP, 'b-pedido.js');
await esbuild.build({
    bundle: true, format: 'iife', globalName: '__EXPORTS',
    target: ['chrome100'], charset: 'utf8', legalComments: 'none', logLevel: 'error',
    entryPoints: [ENTRY], outfile: OUT
});

function buildPedido() {
    const body = el('body');

    const page = el('div', undefined, 'page Solicitacao');
    page.appendChild(el('h1', 'Solicitação #184'));

    const card = el('div', undefined, 'card');
    const add = el('button', 'Adicionar item', 'btn btn-primary');
    card.appendChild(add);

    const table = el('table');
    const tbody = el('tbody');
    const tr = el('tr');
    tr.appendChild(el('td', 'MAT010 Parafuso 10mm'));
    tr.appendChild(el('td', '3'));
    tbody.appendChild(tr);
    table.appendChild(tbody);
    card.appendChild(table);

    page.appendChild(card);
    body.appendChild(page);

    body.innerText = 'Solicitação #184 qtde solicitada itens Adicionar item';

    return { body, add };
}

function buildModal(parent, rowText = 'MAT010 Parafuso 10mm') {
    const overlay = el('div', undefined, 'modal-overlay');
    overlay.style.display = 'block';

    const content = el('div', undefined, 'modal-content');
    content.setAttribute('role', 'dialog');

    const header = el('div', undefined, 'modal-header');
    header.appendChild(el('h5', 'Adicionar item'));
    content.appendChild(header);

    const body = el('div', undefined, 'modal-body');

    const search = el('input');
    search.id = 'keyword';
    search.setAttribute('name', 'keyword');
    body.appendChild(search);

    const table = el('table');
    const tbody = el('tbody');
    const tr = el('tr');
    tr.appendChild(el('td', rowText));
    const tdCheck = el('td');
    const check = el('input');
    check.type = 'checkbox';
    check.setAttribute('type', 'checkbox');
    check.onClick = () => { check.checked = !check.checked; };
    tdCheck.appendChild(check);
    tr.appendChild(tdCheck);
    tbody.appendChild(tr);
    table.appendChild(tbody);
    body.appendChild(table);

    content.appendChild(body);

    const footer = el('div', undefined, 'modal-footer');
    const confirm = el('button', 'Incluir', 'btn btn-success');
    footer.appendChild(confirm);
    content.appendChild(footer);

    overlay.appendChild(content);
    parent.appendChild(overlay);

    return { overlay, content, search, confirm, check, row: tr };
}

function load(options = {}) {
    const dom = buildPedido();
    if (options.transferBody) {
        dom.body.innerText = 'Transferencia qtde a transferir ADICIONAR INSUMO';
    }
    const sb = makeSandbox(dom, {
        hostname: 'acessar.maiscontroleerp.com.br',
        href: 'https://acessar.maiscontroleerp.com.br/compras/solicitacoes/184'
    });
    if (nonEmpty(options.pathname)) {
        sb.window.location.pathname = options.pathname;
        sb.location.pathname = options.pathname;
    }
    vm.runInContext(fs.readFileSync(OUT, 'utf8'), sb, { filename: 'b-pedido.js' });
    return { T: sb.__EXPORTS, dom, sb };
}

function nonEmpty(value) {
    return value !== undefined && value !== null && value !== '';
}

const checks = [];
const show = v => {
    if (v && typeof v === 'object') return v?.innerText ?? v?.tagName ?? '[objeto]';
    return JSON.stringify(v);
};
function check(name, actual, expected) {
    const same = JSON.stringify(actual) === JSON.stringify(expected);
    checks.push({ name, same, actual, expected });
}

/* ---------- 1) DETECCAO ---------- */
{
    const { T } = load({ pathname: '/compras/solicitacoes/184' });
    check('Pedido: isPedidoPage() = true', T.isPedidoPage(), true);
    check('Pedido: isPedidoAutomationPage() = true', T.isPedidoAutomationPage(), true);
}

{
    const { T } = load({ pathname: '/compras/transferencias/10', transferBody: true });
    check('Transferencia: isPedidoAutomationPage() = false', T.isPedidoAutomationPage(), false);
}

{
    /*
     * Transferencia aberta dentro de /compras/solicitacoes/...
     * nao pode cair no motor do Pedido (senao o PLAY nao busca).
     */
    const { T } = load({ pathname: '/compras/solicitacoes/184', transferBody: true });
    check('Transferencia em URL de solicitacao: nao usa motor do Pedido',
        T.isPedidoAutomationPage(), false);
}

/* ---------- 2) BOTAO E MODAL FECHADA ---------- */
{
    const { T } = load({ pathname: '/compras/solicitacoes/184' });

    check('Pedido: modal fechada', T.getPedidoModal(), null);
    check('Pedido: botao "Adicionar item" encontrado',
        T.getPedidoAddItemButton()?.innerText, 'Adicionar item');
}

/* ---------- 3) MODAL ABERTA ---------- */
{
    const { T, dom } = load({ pathname: '/compras/solicitacoes/184' });
    const modal = buildModal(dom.body);

    check('Pedido: modal detectada', T.getPedidoModal() === modal.overlay, true);
    check('Pedido: campo de busca e o da modal',
        T.getPedidoSearchInput() === modal.search, true);
    check('Pedido: botao de confirmacao "Incluir"',
        T.getPedidoConfirmButton()?.innerText, 'Incluir');
    check('Pedido: linha MAT010 encontrada na modal',
        T.findPedidoMaterialRow('MAT010') === modal.row, true);
    check('Pedido: MAT999 nao encontrado', T.findPedidoMaterialRow('MAT999'), null);

    check('Pedido: checkbox marcado', T.selectPedidoRow(modal.row, 'MAT010'), true);
    check('Pedido: checkbox checked', modal.check.checked, true);
}

/* ---------- 4) MODAL ESCONDIDA ---------- */
{
    const { T, dom } = load({ pathname: '/compras/solicitacoes/184' });
    const modal = buildModal(dom.body);
    modal.overlay.style.display = 'none';

    check('Pedido: modal escondida nao e detectada', T.getPedidoModal(), null);
}

/* ---------- 4b) MODAL ANTIGA + BOTAO MUI DUPLICADO ---------- */
{
    const { T, dom } = load({ pathname: '/compras/solicitacoes/184' });

    /*
     * Simula o ERP/MUI: a modal do lote anterior continua
     * montada no DOM, mas invisivel (opacity 0), e a tela
     * tem dois botoes "Adicionar item".
     */
    const stale = buildModal(dom.body);
    stale.overlay.style.opacity = '0';

    const duplicate = el('button', 'Adicionar item', 'MuiButtonBase-root MuiButton-root');
    dom.body.appendChild(duplicate);

    check('Pedido: modal antiga (opacity 0) nao conta como aberta',
        T.getPedidoModal() === null, true);
    check('Pedido: botao Adicionar item MUI encontrado',
        T.getPedidoAddItemButton()?.innerText, 'Adicionar item');

    dom.add.onClick = () => {
        buildModal(dom.body);
    };

    const opened = await T.openPedidoItemModal();

    check('Pedido: openPedidoItemModal clica Adicionar item de novo', opened, 'ok');
    check('Pedido: modal reaberta apos Incluir', !!T.getPedidoModal(), true);
}

/* ---------- 4c) BOTAO DESABILITADO ---------- */
{
    const { T, dom } = load({ pathname: '/compras/solicitacoes/184' });
    dom.add.setAttribute('disabled', '');

    check('Pedido: botao desabilitado nao e retornado', T.getPedidoAddItemButton(), null);
}

/* ---------- 5) BOTOES FLUTUANTES ---------- */
{
    const { T } = load({ pathname: '/compras/solicitacoes/184' });

    const a = el('button', 'A');
    const b = el('button', 'B');

    T.mountFloatingButton(a);
    T.mountFloatingButton(b);

    const container = T.getFloatingActionsContainer();

    check('Botoes flutuantes: container unico', container.className.includes('mc-floating-actions'), true);
    check('Botoes flutuantes: dois botoes no mesmo container', container.children.length, 2);
    check('Botoes flutuantes: botao A agrupado', a.parentElement === container, true);
    check('Botoes flutuantes: botao B agrupado', b.parentElement === container, true);
}

/* ---------- 6) ACOES DENTRO DO PAINEL ---------- */
{
    const { T, dom, sb } = load({ pathname: '/compras/solicitacoes/184' });

    T.appState.extensionEnabled = true;
    T.setupPedidoAutomation();

    const panel = dom.body.querySelector('#mc-automation-panel');
    const copy = panel?.querySelector('.mc-copy-pedido');
    const add = panel?.querySelector('.mc-pedido-panel');

    check('Pedido: nenhum botao flutuante externo', dom.body.querySelector('.mc-pedido-auto-button'), null);
    check('Pedido: painel criado', !!panel, true);
    check('Pedido: botao Copiar Insumos dentro do painel', copy?.textContent, '📋 COPIAR INSUMOS DO PEDIDO');
    check('Pedido: botao Adicionar Itens dentro do painel', add?.textContent, '⚡ ADICIONAR ITENS NO PEDIDO');
    check('Pedido: botao Adicionar Itens visivel', add?.hidden, false);

    copy.click();

    const raw = sb.localStorage.getItem('insumos_transferencia_copiados');
    check('Pedido: botao do painel copia os itens', !!raw, true);
}

/* ---------- 7) PROGRESSO INDEPENDENTE ---------- */
{
    const { T } = load({ pathname: '/compras/solicitacoes/184' });

    T.saveProgress(1, 10, false, []);
    T.savePedidoProgress(3, 10, false, []);

    check('Progresso: Transferencia independente', T.getProgress(10).nextIndex, 1);
    check('Progresso: Pedido independente', T.getPedidoProgress(10).nextIndex, 3);
}

/* ================= resultado ================= */
let fail = 0;
for (const c of checks) {
    if (!c.same) fail++;
    console.log(`${c.same ? 'OK   ' : 'FALHA'} ${c.name}`);
    if (!c.same) {
        console.log('   esperado:', show(c.expected));
        console.log('   obtido  :', show(c.actual));
    }
}
console.log(`\n${checks.length - fail}/${checks.length} verificacoes do Pedido OK`);
process.exit(fail ? 1 : 0);
