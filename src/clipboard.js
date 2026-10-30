/* =========================================================
   AREA DE TRANSFERENCIA (ponte entre origens)
   ========================================================= */

function legacyCopy(text) {

    if (typeof document === 'undefined')
        return false;

    const area =
        document.createElement('textarea');

    area.value = text;

    area.setAttribute('readonly', '');

    area.style.position = 'fixed';
    area.style.left = '-9999px';
    area.style.top = '0';

    document.body?.appendChild(area);

    area.focus?.();
    area.select?.();
    area.setSelectionRange?.(0, text.length);

    let copied = false;

    try {
        copied = document.execCommand?.('copy') === true;
    } catch (e) {
        copied = false;
    }

    area.remove?.();

    return copied;
}


export async function writeClipboardText(text, allowEmpty = false) {

    const value = String(text || '');

    if (!value && !allowEmpty)
        return false;


    if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard?.writeText
    ) {

        try {

            await navigator.clipboard.writeText(value);

            return true;

        } catch (e) { }
    }


    if (typeof GM_setClipboard === 'function') {

        try {

            GM_setClipboard(value, 'text');

            return true;

        } catch (e) { }
    }


    return legacyCopy(value);
}


export async function replaceClipboardText(text) {

    await writeClipboardText('', true);

    return writeClipboardText(text);
}


export async function readClipboardText(allowPrompt = true) {

    if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard?.readText
    ) {

        try {

            const text =
                await navigator.clipboard.readText();

            if (text)
                return text;

        } catch (e) { }
    }


    if (
        allowPrompt &&
        typeof window !== 'undefined' &&
        typeof window.prompt === 'function'
    ) {

        const text = window.prompt(
            'Cole aqui o JSON copiado do AppSheet:'
        );

        if (text)
            return text;
    }


    return '';
}
