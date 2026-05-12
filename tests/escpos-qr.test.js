/**
 * @jest-environment node
 *
 * Tests du helper ESC/POS QR + verification que pos.js (browser) inline une
 * sequence d'octets coherente avec ce helper.
 */

const fs = require('fs');
const path = require('path');

const {
    buildQrCommand,
    parseQrCommands,
    injectQrIntoTicket,
    expectedQrSignaturePatterns,
    QR_DEFAULTS
} = require('../lib/escpos-qr');

const TRACABILITE_URL = 'https://www.maas-tracabilite.com';

describe('escpos-qr helper', () => {
    describe('buildQrCommand', () => {
        test('retourne une chaine non vide qui contient l\'URL', () => {
            const bytes = buildQrCommand(TRACABILITE_URL);
            expect(typeof bytes).toBe('string');
            expect(bytes.length).toBeGreaterThan(TRACABILITE_URL.length);
            expect(bytes.includes(TRACABILITE_URL)).toBe(true);
        });

        test('genere les 5 commandes ESC/POS attendues (model, size, err, data, print)', () => {
            const bytes = buildQrCommand(TRACABILITE_URL);
            // Compte les occurrences de la signature GS ( k = \x1D\x28\x6B
            const matches = bytes.match(/\x1D\x28\x6B/g);
            expect(matches).not.toBeNull();
            expect(matches.length).toBe(5);
        });

        test('respecte les valeurs par defaut (Model 2, taille 8, correction L)', () => {
            const bytes = buildQrCommand(TRACABILITE_URL);
            // Set model: \x1D\x28\x6B\x04\x00\x31\x41 <model> \x00
            expect(bytes).toContain('\x1D\x28\x6B\x04\x00\x31\x41' + String.fromCharCode(QR_DEFAULTS.model) + '\x00');
            // Set size: \x1D\x28\x6B\x03\x00\x31\x43 <size>
            expect(bytes).toContain('\x1D\x28\x6B\x03\x00\x31\x43' + String.fromCharCode(QR_DEFAULTS.size));
            // Set error correction
            expect(bytes).toContain('\x1D\x28\x6B\x03\x00\x31\x45' + String.fromCharCode(QR_DEFAULTS.errorCorrection));
            // Print
            expect(bytes).toContain('\x1D\x28\x6B\x03\x00\x31\x51\x30');
        });

        test('jette si l\'URL est vide ou non-string', () => {
            expect(() => buildQrCommand('')).toThrow();
            expect(() => buildQrCommand(null)).toThrow();
            expect(() => buildQrCommand(undefined)).toThrow();
            expect(() => buildQrCommand(42)).toThrow();
        });

        test('encode correctement la longueur (pL, pH) pour des URLs longues', () => {
            // 300 chars > 256 → pH doit etre >= 1
            const longUrl = 'https://example.com/' + 'a'.repeat(280);
            const bytes = buildQrCommand(longUrl);
            // Cherche la commande store: 1D 28 6B pL pH 31 50 30
            // 4eme commande dans l'ordre. On reparse pour valider.
            const parsed = parseQrCommands(Buffer.from(bytes, 'binary'));
            expect(parsed.length).toBe(1);
            expect(parsed[0].url).toBe(longUrl);
        });
    });

    describe('parseQrCommands', () => {
        test('retourne tableau vide pour un buffer sans QR', () => {
            const buf = Buffer.from('Ticket sans QR\n', 'utf8');
            expect(parseQrCommands(buf)).toEqual([]);
        });

        test('extrait l\'URL d\'un buffer construit par buildQrCommand (round-trip)', () => {
            const bytes = buildQrCommand(TRACABILITE_URL);
            const parsed = parseQrCommands(Buffer.from(bytes, 'binary'));
            expect(parsed.length).toBe(1);
            expect(parsed[0].url).toBe(TRACABILITE_URL);
            expect(parsed[0].urlStart).toBeGreaterThanOrEqual(0);
            expect(parsed[0].urlEnd).toBeGreaterThan(parsed[0].urlStart);
        });

        test('extrait plusieurs QRs si le buffer en contient plusieurs', () => {
            const url1 = 'https://example.com/a';
            const url2 = 'https://example.com/b';
            const combined = buildQrCommand(url1) + 'separateur' + buildQrCommand(url2);
            const parsed = parseQrCommands(Buffer.from(combined, 'binary'));
            expect(parsed.length).toBe(2);
            expect(parsed[0].url).toBe(url1);
            expect(parsed[1].url).toBe(url2);
        });

        test('accepte une string en input (pas seulement Buffer)', () => {
            const bytes = buildQrCommand(TRACABILITE_URL);
            const parsed = parseQrCommands(bytes); // string
            expect(parsed.length).toBe(1);
            expect(parsed[0].url).toBe(TRACABILITE_URL);
        });
    });

    describe('injectQrIntoTicket', () => {
        const placeholder = '[QR Code]';
        const ticket = `================================\nVERIFIEZ VOTRE PRODUIT\n================================\n\n${placeholder}\n\nwww.maas-tracabilite.com\n================================\n`;

        test('remplace le placeholder par les bytes QR', () => {
            const result = injectQrIntoTicket(ticket, placeholder, TRACABILITE_URL);
            // Le placeholder doit avoir disparu
            expect(result.includes(placeholder)).toBe(false);
            // L'URL doit etre dans le buffer (encodee dans la commande store)
            expect(result.includes(TRACABILITE_URL)).toBe(true);
            // Re-parse: doit y avoir 1 QR avec la bonne URL
            const parsed = parseQrCommands(Buffer.from(result, 'binary'));
            expect(parsed.length).toBe(1);
            expect(parsed[0].url).toBe(TRACABILITE_URL);
        });

        test('retourne le ticket inchange si le placeholder est absent', () => {
            const noPh = 'Ticket sans placeholder';
            expect(injectQrIntoTicket(noPh, placeholder, TRACABILITE_URL)).toBe(noPh);
        });

        test('preserve le texte autour du placeholder', () => {
            const result = injectQrIntoTicket(ticket, placeholder, TRACABILITE_URL);
            expect(result.startsWith('================================\nVERIFIEZ VOTRE PRODUIT')).toBe(true);
            expect(result.endsWith('================================\n')).toBe(true);
        });
    });

    describe('pos.js inline implementation (drift detection)', () => {
        const posJsPath = path.join(__dirname, '..', 'pos.js');
        const posJsSource = fs.readFileSync(posJsPath, 'utf8');

        test('pos.js contient les 4 patterns de commande QR ESC/POS', () => {
            // Verifie que les 4 sequences statiques de buildQrCommand sont
            // presentes (sous forme d\\x echappee) dans le source de pos.js.
            // Si quelqu'un casse la copie inline (typo dans les bytes), ce
            // test plantera.
            for (const pattern of expectedQrSignaturePatterns()) {
                expect(posJsSource).toMatch(pattern);
            }
        });

        test('pos.js reference bien l\'URL de tracabilite cible', () => {
            expect(posJsSource).toContain(TRACABILITE_URL);
        });

        test('pos.js contient les placeholders [QR Tracabilite] et [QR Feedback]', () => {
            // Deux QRs distincts: tracabilite (URL fixe) et feedback (URL
            // configurable via brand-config.feedback_url). Les deux
            // placeholders doivent etre presents pour qu'ils soient
            // remplaces par les bytes ESC/POS au build.
            expect(posJsSource).toContain('[QR Tracabilite]');
            expect(posJsSource).toContain('[QR Feedback]');
        });

        test('pos.js lit config.feedback_url et substitue {commande_id}', () => {
            // Le pattern de lecture: config.feedback_url + replace placeholder.
            expect(posJsSource).toContain('config.feedback_url');
            expect(posJsSource).toContain('{commande_id}');
        });
    });

    describe('end-to-end: ticket fixture realiste', () => {
        // Simule exactement la chaine de pos.js: ticket texte avec
        // placeholder, puis injection QR avant envoi a RawBT.
        const samplePath = path.join(__dirname, 'fixtures', 'ticket-sample.txt');

        test('fixture: parse l\'URL apres injection', () => {
            const baseTicket = [
                '================================',
                '         MBAO POS TEST',
                '================================',
                '',
                'COMMANDE: TEST-001',
                '',
                '================================',
                '     VERIFIEZ VOTRE PRODUIT',
                '================================',
                '',
                '          [QR Code]',
                '',
                '       www.maas-tracabilite.com',
                '================================'
            ].join('\n');

            const withQr = injectQrIntoTicket(baseTicket, '[QR Code]', TRACABILITE_URL);
            const parsed = parseQrCommands(Buffer.from(withQr, 'binary'));
            expect(parsed.length).toBe(1);
            expect(parsed[0].url).toBe(TRACABILITE_URL);
        });
    });
});
