/**
 * ESC/POS QR helper — pure Node module, isole de pos.js pour permettre
 * les tests automatises sans dependre du DOM ni du navigateur.
 *
 * Couvre:
 *   - Construction des commandes ESC/POS pour un QR code natif imprimante
 *     thermique (GS ( k Model 2, taille 8, error correction L).
 *   - Parsing inverse: extrait les URLs encodees dans un buffer ESC/POS.
 *   - Injection: remplace un placeholder texte par les bytes QR dans un
 *     ticket.
 *
 * NOTE: pos.js inline une copie de cette logique (browser-side ne peut pas
 * require() directement). La fonction `expectedQrSignaturePattern()` permet
 * a un test de verifier que la copie inline reste alignee.
 */

'use strict';

const QR_DEFAULTS = {
    model: 0x32,          // 0x32 = Model 2 (le plus utilise)
    size: 0x08,           // 1-16 (8 = taille moyenne, lisible 3-5 cm)
    errorCorrection: 0x30 // 0x30=L (7%), 0x31=M (15%), 0x32=Q (25%), 0x33=H (30%)
};

/**
 * Construit la sequence de bytes ESC/POS qui, envoyee a une imprimante
 * thermique compatible, imprime un QR code encodant `url`.
 *
 * Sequence:
 *   1. GS ( k 04 00 31 41 m 00     — set model
 *   2. GS ( k 03 00 31 43 size     — set size
 *   3. GS ( k 03 00 31 45 err      — set error correction
 *   4. GS ( k pL pH 31 50 30 data  — store data (pL+pH*256 = data.length+3)
 *   5. GS ( k 03 00 31 51 30       — print QR
 *
 * @param {string} url - donnees a encoder (URL ou autre)
 * @param {object} [opts]
 * @param {number} [opts.model=0x32]
 * @param {number} [opts.size=0x08]
 * @param {number} [opts.errorCorrection=0x30]
 * @returns {string} sequence ESC/POS en chaine latin1 (1 char = 1 byte)
 */
function buildQrCommand(url, opts) {
    if (typeof url !== 'string' || url.length === 0) {
        throw new Error('buildQrCommand: url doit etre une chaine non vide');
    }
    const cfg = Object.assign({}, QR_DEFAULTS, opts || {});
    const urlLength = Buffer.byteLength(url, 'utf8');
    const total = urlLength + 3;
    const pl = total % 256;
    const ph = Math.floor(total / 256);

    let s = '';
    // Set model
    s += '\x1D\x28\x6B\x04\x00\x31\x41' + String.fromCharCode(cfg.model) + '\x00';
    // Set size
    s += '\x1D\x28\x6B\x03\x00\x31\x43' + String.fromCharCode(cfg.size);
    // Set error correction
    s += '\x1D\x28\x6B\x03\x00\x31\x45' + String.fromCharCode(cfg.errorCorrection);
    // Store data
    s += '\x1D\x28\x6B' + String.fromCharCode(pl, ph) + '\x31\x50\x30' + url;
    // Print
    s += '\x1D\x28\x6B\x03\x00\x31\x51\x30';
    return s;
}

/**
 * Parse un buffer ESC/POS et retourne toutes les URLs trouvees dans les
 * commandes "store QR data" (GS ( k pL pH 31 50 30 <data>).
 *
 * @param {Buffer|string} input
 * @returns {Array<{url: string, urlStart: number, urlEnd: number}>}
 */
function parseQrCommands(input) {
    const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input, 'binary');
    const sig = Buffer.from([0x1D, 0x28, 0x6B]);
    const results = [];
    let pos = 0;
    while (pos < buffer.length) {
        const idx = buffer.indexOf(sig, pos);
        if (idx === -1) break;
        if (idx + 7 >= buffer.length) break;
        const pL = buffer[idx + 3];
        const pH = buffer[idx + 4];
        const m  = buffer[idx + 5];
        const fn = buffer[idx + 6];
        const total = pL + pH * 256;
        const cmdEnd = idx + 5 + total;
        if (m === 0x31 && fn === 0x50) {
            const dataStart = idx + 8;
            const dataLen = total - 3;
            if (dataStart + dataLen <= buffer.length) {
                const data = buffer.slice(dataStart, dataStart + dataLen).toString('utf8');
                results.push({ url: data, urlStart: idx, urlEnd: cmdEnd });
            }
        }
        pos = cmdEnd > pos ? cmdEnd : pos + 1;
    }
    return results;
}

/**
 * Remplace toutes les occurrences de `placeholder` dans `ticket` par la
 * sequence ESC/POS encodant `url`. Si le placeholder n'est pas trouve,
 * retourne `ticket` inchange.
 *
 * @param {string} ticket
 * @param {string} placeholder
 * @param {string} url
 * @param {object} [opts]
 * @returns {string}
 */
function injectQrIntoTicket(ticket, placeholder, url, opts) {
    if (typeof ticket !== 'string') return ticket;
    if (!placeholder || ticket.indexOf(placeholder) === -1) return ticket;
    const qrBytes = buildQrCommand(url, opts);
    return ticket.split(placeholder).join(qrBytes);
}

/**
 * Retourne un RegExp qui matche la signature des commandes QR ESC/POS
 * generees par buildQrCommand. Utilise par les tests pour verifier qu'un
 * autre fichier (pos.js) contient bien la meme sequence inline, sinon
 * la copie inline a derive de cette implementation de reference.
 *
 * Le pattern verifie la presence des octets statiques cles:
 *   - Set model:  1D 28 6B 04 00 31 41 ?  00
 *   - Set size:   1D 28 6B 03 00 31 43 ?
 *   - Set err:    1D 28 6B 03 00 31 45 ?
 *   - Store data: 1D 28 6B ?  ?  31 50 30
 *   - Print:      1D 28 6B 03 00 31 51 30
 *
 * @returns {RegExp[]} liste des regex a tester individuellement.
 */
function expectedQrSignaturePatterns() {
    return [
        /\\x1D\\x28\\x6B\\x04\\x00\\x31\\x41/,         // set model
        /\\x1D\\x28\\x6B\\x03\\x00\\x31\\x43/,         // set size
        /\\x1D\\x28\\x6B\\x03\\x00\\x31\\x45/,         // set error correction
        /\\x1D\\x28\\x6B\\x03\\x00\\x31\\x51\\x30/,    // print
        // Store data: les bytes pL/pH sont dynamiques (depend de la longueur
        // de l'URL), construits via String.fromCharCode(pl, ph). On match
        // donc l'opcode statique 31 50 30 qui suit, suffisant pour detecter
        // une derive sur cette commande.
        /\\x31\\x50\\x30/                              // store data opcode
    ];
}

module.exports = {
    buildQrCommand,
    parseQrCommands,
    injectQrIntoTicket,
    expectedQrSignaturePatterns,
    QR_DEFAULTS
};
