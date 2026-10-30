/* =========================================================
   CONTROLE DE EXECUCAO
   ========================================================= */

import { appState } from './state'
import { sleep } from './utils'

export async function controlledSleep(ms) {

    const step = 100;

    let elapsed = 0;


    while (
        elapsed < ms
    ) {

        if (appState.stopRequested)
            return 'cancel';


        if (
            appState.pauseRequested ||
            appState.automationState === 'paused'
        ) {
            return 'pause';
        }


        await sleep(
            Math.min(
                step,
                ms - elapsed
            )
        );


        elapsed += step;
    }


    return 'ok';
}
