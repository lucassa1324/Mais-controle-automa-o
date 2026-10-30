import { BATCH_SIZE, ERP } from './config'
import { appState, registerControls } from './state'
import { getCodesFromStorage, getProgress, resetProgress, saveProgress } from './storage'
import { addLog, setPanelMessage, showToast, updatePanel } from './panel'
import { clearSearch, commitBatch, getAdicionarInsumoSearchInput, openAdicionarInsumoModal, searchMaterial, selectMaterialRow, waitForAdicionarInsumoModal, waitForMaterialRow } from './erp'
import { controlledSleep } from './control'
import { isAdicionarInsumoPage, isPedidoPage, isTransferenciaPage } from './pages'
import { cancelPedidoAutomation, isPedidoAutomationPage, pausePedidoAutomation, playPedidoAutomation, restartPedidoAutomation } from './pedido_automation'


async function processItem(code, index, total, notFound) {

    setPanelMessage(
        `Processando ${code} (${index + 1}/${total})`
    );

    addLog(
        `▶️ Processando ${code} (${index + 1}/${total})`
    );

    updatePanel();

    const searchResult = await searchMaterial(code);

    if (searchResult === 'pause') {
        return 'pause';
    }

    if (searchResult === 'cancel') {
        return 'cancel';
    }

    if (searchResult !== true) {
        addLog('⚠️ Campo de busca indisponível ou não confirmado.');
        return 'fail';
    }

    const rowResult = await waitForMaterialRow(code, ERP.timeouts.materialRow);

    if (rowResult === 'pause') {
        return 'pause';
    }

    if (rowResult === 'cancel') {
        return 'cancel';
    }

    if (!rowResult) {
        if (!notFound.includes(code)) {
            notFound.push(code);
        }
        addLog(`❌ ${code} não encontrado.`);
        const clearRes = await clearSearch();
        if (clearRes === 'pause') return 'pause';
        if (clearRes === 'cancel') return 'cancel';
        return 'ok';
    }

    const selected = selectMaterialRow(rowResult, code);

    if (!selected) {
        if (!notFound.includes(code)) {
            notFound.push(code);
        }
        addLog(`⚠️ ${code}: não foi possível selecionar.`);
    } else {
        addLog(`✅ ${code} selecionado.`);
    }

    const clearRes = await clearSearch();
    if (clearRes === 'pause') return 'pause';
    if (clearRes === 'cancel') return 'cancel';
    return selected ? 'found' : 'ok';
}


function interrupt(state, index, total, notFound, message) {

    if (state === 'pause') {

        appState.automationState = 'paused';
        saveProgress(index, total, true, notFound);

        setPanelMessage(
            message || `Pausado antes do item ${index + 1}. Clique PLAY para continuar.`
        );

        addLog(
            `⏸️ Pausado antes do item ${index + 1}.`
        );

        updatePanel();
        return;
    }

    if (state === 'cancel') {

        appState.automationState = 'cancelled';
        saveProgress(index, total, true, notFound);

        setPanelMessage(
            `Cancelado antes do item ${index + 1}. O progresso foi mantido.`
        );

        addLog(
            `⛔ Cancelado antes do item ${index + 1}.`
        );

        updatePanel();
        return;
    }

    appState.automationState = 'paused';
    saveProgress(index, total, true, notFound);
    setPanelMessage(message || 'Automação pausada.');
    addLog(`⚠️ ${message || 'Automação pausada.'}`);
    updatePanel();
}


/**
 * Garante que a MODAL de busca de insumos esteja aberta
 * antes de qualquer digitacao no campo #keyword.
 *
 * O ERP tem dois #keyword:
 *  - um na tela de Transferencia (itens da transferencia);
 *  - outro dentro da modal "ADICIONAR INSUMO".
 *
 * Digitar no campo errado faz a busca acontecer na tela
 * principal e a linha do material nunca e renderizada.
 *
 * Retorna: 'ok' | 'pause' | 'cancel' | 'fail'
 */
async function ensureAdicionarInsumoModal() {

    /*
     * 1) Ja estamos na modal de busca?
     */
    if (isAdicionarInsumoPage()) {

        const input = getAdicionarInsumoSearchInput();

        if (input)
            return 'ok';

        /*
         * A modal existe, mas o campo de busca
         * ainda nao renderizou: apenas espera.
         */
        return await waitForAdicionarInsumoModal();
    }

    /*
     * 2) Sem a modal e sem a tela de Transferencia
     *    nao ha o que fazer.
     */
    if (!isTransferenciaPage()) {

        addLog('⚠️ Tela atual não é a de Transferência nem a modal de Adicionar Insumo.');

        return 'fail';
    }

    /*
     * 3) Clica em ADICIONAR INSUMO e espera
     *    o #keyword da modal aparecer.
     */
    const opened = await openAdicionarInsumoModal();

    if (opened !== 'ok') {

        if (opened === 'pause' || opened === 'cancel')
            return opened;

        addLog('⚠️ Não foi possível abrir a modal de Adicionar Insumo.');

        return 'fail';
    }

    return 'ok';
}


export async function runBatch() {

    const codes = getCodesFromStorage();
    const total = codes.length;

    if (!total) {
        setPanelMessage('Nenhum insumo copiado. Primeiro use "Copiar Insumos do Pedido".');
        showToast('Nenhum insumo foi copiado.', 'warning');
        updatePanel();
        return;
    }

    const progress = getProgress(total);
    let index = progress.nextIndex;
    const notFound = Array.isArray(progress.notFound) ? [...progress.notFound] : [];

    /*
     * Quantos itens ENCONTRADOS já foram marcados na modal.
     *
     * O lote é confirmado quando esse contador chega a
     * BATCH_SIZE ou quando a lista termina. Buscas sem
     * resultado não contam e não fazem o ADICIONAR ser
     * clicado (o botão fica desabilitado sem seleção).
     */
    let foundInBatch = 0;

    while (index < total) {

        if (appState.stopRequested) {
            interrupt('cancel', index, total, notFound);
            return;
        }

        if (appState.pauseRequested || appState.automationState === 'paused') {
            interrupt('pause', index, total, notFound);
            return;
        }

        addLog(
            `📦 Procurando até ${BATCH_SIZE} itens encontrados (${total - index} restante(s) de ${total}).`
        );

        setPanelMessage(
            `Buscando itens encontrados: ${foundInBatch}/${BATCH_SIZE} (${index}/${total} processado(s)).`
        );

        updatePanel();

        /*
         * A BUSCA SÓ FUNCIONA DENTRO DA MODAL.
         *
         * Se ainda estamos na tela de Transferência,
         * clicamos em ADICIONAR INSUMO antes de digitar.
         */
        const ensured = await ensureAdicionarInsumoModal();

        if (ensured === 'pause') {
            interrupt('pause', index, total, notFound);
            return;
        }

        if (ensured === 'cancel') {
            interrupt('cancel', index, total, notFound);
            return;
        }

        if (ensured !== 'ok') {
            interrupt('fail', index, total, notFound, 'Não foi possível abrir a modal de Adicionar Insumo. Automação pausada.');
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
                interrupt('cancel', index, total, notFound);
                return;
            }

            if (appState.pauseRequested || appState.automationState === 'paused') {
                interrupt('pause', index, total, notFound);
                return;
            }

            const result = await processItem(codes[index], index, total, notFound);

            if (result === 'pause') {
                interrupt('pause', index, total, notFound);
                return;
            }

            if (result === 'cancel') {
                interrupt('cancel', index, total, notFound);
                return;
            }

            if (result === 'fail') {
                interrupt('fail', index, total, notFound, 'Falha ao processar insumo. Automação pausada.');
                return;
            }

            if (result === 'found') {

                foundInBatch++;

                addLog(
                    `✅ Lote: ${foundInBatch}/${BATCH_SIZE} item(ns) encontrado(s).`
                );
            }

            index++;
            saveProgress(index, total, false, notFound);

            setPanelMessage(
                `Lote: ${foundInBatch}/${BATCH_SIZE} encontrado(s) — ${index}/${total} processado(s).`
            );

            updatePanel();
        }

        /*
         * Nenhum item encontrado nesta rodada:
         * não existe seleção para confirmar, então
         * NÃO clicamos em ADICIONAR.
         */
        if (foundInBatch === 0) {

            addLog(
                '⚠️ Nenhum item encontrado. Nada para confirmar — seguindo sem clicar em ADICIONAR.'
            );

            break;
        }

        if (appState.stopRequested) {
            interrupt('cancel', index, total, notFound);
            return;
        }

        if (appState.pauseRequested || appState.automationState === 'paused') {
            interrupt('pause', index, total, notFound);
            return;
        }

        const batchFound = foundInBatch;

        /*
         * FIM DO LOTE.
         *
         * O botao "ADICIONAR (X)" e clicado em commitBatch(),
         * que tambem espera a tela voltar para Transferencia.
         */
        const committed = await commitBatch();

        if (committed === 'pause') {
            interrupt('pause', index, total, notFound);
            return;
        }

        if (committed === 'cancel') {
            interrupt('cancel', index, total, notFound);
            return;
        }

        if (committed !== 'ok') {
            interrupt('fail', index, total, notFound, 'Falha ao confirmar o lote. Automação pausada.');
            return;
        }

        foundInBatch = 0;

        /*
         * O laco abre a modal do proximo lote sozinho
         * (clicando em ADICIONAR INSUMO) e repete
         * o ciclo ate o fim.
         */
        if (index < total) {

            /*
             * Pequena pausa para o ERP terminar de
             * remontar a tela de Transferencia antes
             * de clicar em ADICIONAR INSUMO de novo.
             */
            const settle = await controlledSleep(400);

            if (settle === 'pause') {
                interrupt('pause', index, total, notFound);
                return;
            }

            if (settle === 'cancel') {
                interrupt('cancel', index, total, notFound);
                return;
            }

            setPanelMessage(`Lote confirmado (${batchFound} item(ns), ${index}/${total}). Abrindo a modal do próximo lote...`);
            addLog(`⏭️ Lote confirmado com ${batchFound} item(ns) (${index}/${total}). Voltou para Transferência — abrindo a modal do próximo lote.`);
            updatePanel();

        } else {

            addLog(`⏭️ Lote final concluído: ${batchFound} item(ns) confirmado(s) (${index}/${total}).`);

        }
    }

    appState.automationState = 'completed';
    saveProgress(total, total, true, notFound);
    const msg = notFound.length ? `Concluído. ${notFound.length} item(ns) não encontrado(s).` : 'Concluído! Todos os itens foram selecionados.';
    setPanelMessage(msg);
    addLog(`🏁 ${msg}`);
    updatePanel();
    showToast(msg, notFound.length ? 'warning' : 'success');
}


export async function playAutomation() {

    if (!appState.extensionEnabled)
        return;

    if (appState.currentRunPromise)
        return;

    /*
     * Na tela de Pedido/Solicitacao o PLAY usa o motor
     * proprio (modal "Adicionar item", "Incluir").
     */
    if (
        isPedidoAutomationPage() ||
        (
            appState.activeFlow === 'pedido' &&
            isPedidoPage() &&
            !isTransferenciaPage()
        )
    ) {
        return playPedidoAutomation();
    }

    appState.activeFlow = 'transfer';

    const codes = getCodesFromStorage();
    const total = codes.length;

    if (!total) {

        setPanelMessage(
            'Nenhum insumo copiado. Primeiro use "Copiar Insumos do Pedido".'
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

    appState.automationState = 'running';

    const progress = getProgress(total);

    saveProgress(progress.nextIndex, total, false, progress.notFound);

    setPanelMessage('Iniciando processamento...');
    addLog(`▶️ Continuando no item ${progress.nextIndex + 1}/${total}.`);
    updatePanel();

    appState.currentRunPromise = runBatch();

    try {
        await appState.currentRunPromise;
    } finally {
        appState.currentRunPromise = null;
    }
}


export function pauseAutomation() {

    if (appState.activeFlow === 'pedido')
        return pausePedidoAutomation();

    if (
        appState.automationState === 'running'
    ) {

        appState.pauseRequested = true;

        setPanelMessage(
            'Pausando após o item atual...'
        );

        addLog(
            '⏸️ Solicitação de pausa recebida.'
        );

        return;
    }


    if (
        appState.automationState === 'paused'
    ) {

        appState.automationState =
            'paused';

        setPanelMessage(
            'Automação pausada. Clique PLAY para continuar.'
        );

        updatePanel();
    }
}


export function cancelAutomation() {

    if (appState.activeFlow === 'pedido')
        return cancelPedidoAutomation();

    appState.stopRequested = true;
    appState.pauseRequested = false;

    const total =
        getCodesFromStorage().length;

    const progress =
        getProgress(total);

    saveProgress(
        progress.nextIndex,
        total,
        true,
        progress.notFound
    );

    appState.automationState =
        'cancelled';

    setPanelMessage(
        'Automação cancelada. O progresso foi mantido. PLAY continua de onde parou.'
    );

    addLog(
        '⛔ Automação cancelada. Progresso mantido.'
    );

    updatePanel();
}


export function restartAutomation() {

    if (appState.activeFlow === 'pedido')
        return restartPedidoAutomation();

    appState.stopRequested = true;
    appState.pauseRequested = false;
    appState.currentRunPromise = null;

    const total =
        getCodesFromStorage().length;

    resetProgress(total);

    appState.automationState =
        'idle';

    setPanelMessage(
        'Progresso zerado. Clique PLAY para começar novamente.'
    );

    addLog(
        '🔄 Progresso reiniciado.'
    );

    updatePanel();
}


registerControls({
    play: playAutomation,
    pause: pauseAutomation,
    cancel: cancelAutomation,
    restart: restartAutomation
});
