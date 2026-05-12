#!/usr/bin/env node
/**
 * Simulateur RawBT minimal. Prend en entree:
 *   - un fichier (`node scripts/test-ticket-qr.js ticket.bin`)
 *   - ou du contenu sur stdin (`type ticket.bin | node scripts/test-ticket-qr.js`)
 *   - ou la sortie de `copy(window.currentTicketEscPos)` collee dans un .txt
 *
 * Le script:
 *   - parcourt les bytes a la recherche des commandes ESC/POS de generation
 *     QR (GS ( k 1P0 <data>)
 *   - extrait l'URL encodee dans le QR
 *   - genere un fichier PNG du QR a scanner avec un telephone pour valider
 *     l'URL de bout en bout
 *   - affiche dans le terminal le QR en ASCII art + la version "humaine" du
 *     ticket (bytes ESC/POS strippes)
 *
 * Dependance: qrcode (npm install --no-save qrcode si pas deja installe).
 */

const fs = require('fs');
const path = require('path');

let QRCode;
try {
    QRCode = require('qrcode');
} catch (e) {
    console.error('❌ Le module `qrcode` est introuvable.');
    console.error('   Installez-le avec: npm install --no-save qrcode');
    process.exit(1);
}

// ===== Lecture de l'input =====

async function lireInput() {
    const arg = process.argv[2];
    if (arg) {
        if (!fs.existsSync(arg)) {
            console.error(`❌ Fichier introuvable: ${arg}`);
            process.exit(1);
        }
        return fs.readFileSync(arg); // Buffer
    }
    // Pas d'argument: lire stdin
    return new Promise((resolve, reject) => {
        const chunks = [];
        process.stdin.on('data', (c) => chunks.push(c));
        process.stdin.on('end', () => resolve(Buffer.concat(chunks)));
        process.stdin.on('error', reject);
        if (process.stdin.isTTY) {
            console.error('❌ Aucun fichier en argument ET pas de stdin pipe.');
            console.error('   Usage:');
            console.error('     node scripts/test-ticket-qr.js ticket.bin');
            console.error('     type ticket.bin | node scripts/test-ticket-qr.js');
            process.exit(1);
        }
    });
}

// ===== Parseur ESC/POS QR =====

/**
 * Cherche la commande "store QR data": 1D 28 6B pL pH 31 50 30 <data>.
 * pL + pH*256 = longueur des donnees + 3 (les 3 octets 31 50 30).
 *
 * Retourne { url, modelStart, modelEnd, dataStart, dataEnd, printEnd } pour
 * pouvoir reconstruire un ticket "lisible" sans les bytes de commande.
 */
function extraireQR(buffer) {
    // Pattern: 1D 28 6B pL pH 31 50 30
    const sig = Buffer.from([0x1D, 0x28, 0x6B]);
    let pos = 0;
    const trouves = [];
    while (pos < buffer.length) {
        const idx = buffer.indexOf(sig, pos);
        if (idx === -1) break;
        // Apres 1D 28 6B il y a pL pH puis (m, fn, ...)
        if (idx + 5 >= buffer.length) break;
        const pL = buffer[idx + 3];
        const pH = buffer[idx + 4];
        const m  = buffer[idx + 5]; // toujours 0x31 dans nos commandes QR
        const fn = buffer[idx + 6]; // 41=model, 43=size, 45=err, 50=data, 51=print
        const total = pL + pH * 256;
        // Longueur totale de la commande = 5 octets header (1D 28 6B pL pH) + total
        const cmdEnd = idx + 5 + total;
        if (m === 0x31 && fn === 0x50) {
            // Store data: les donnees commencent apres 31 50 30 (donc idx+8)
            // et font total - 3 octets.
            const dataStart = idx + 8;
            const dataLen = total - 3;
            const data = buffer.slice(dataStart, dataStart + dataLen).toString('utf8');
            trouves.push({ urlStart: idx, urlEnd: cmdEnd, url: data });
        }
        pos = cmdEnd > pos ? cmdEnd : pos + 1;
    }
    return trouves;
}

/**
 * Strippe les bytes ESC/POS connus du ticket pour donner une version texte
 * lisible. Conserve les retours a la ligne et les caracteres imprimables.
 * Remplace les blocs QR par "[QR: <url>]".
 */
function nettoyerTexte(buffer, qrs) {
    // 1. Remplacer les blocs QR par un marqueur lisible (en partant de la fin
    //    pour ne pas casser les offsets).
    let bytes = Buffer.from(buffer);
    const tri = [...qrs].sort((a, b) => b.urlStart - a.urlStart);
    for (const qr of tri) {
        const marker = Buffer.from(`[QR: ${qr.url}]`, 'utf8');
        bytes = Buffer.concat([
            bytes.slice(0, qr.urlStart),
            marker,
            bytes.slice(qr.urlEnd)
        ]);
    }
    // 2. Strip toutes les autres commandes ESC/POS courantes:
    //    - 1B xx ...      ESC commands (longueur variable, mais pour notre
    //                     ticket il n'y en a pas, donc on enleve juste 1B xx)
    //    - 1D xx ...      GS commands (idem)
    //    Pour rester safe on convertit en string et on enleve les caracteres
    //    de controle non-imprimables sauf \n et \r.
    let text = bytes.toString('utf8');
    text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    return text;
}

// ===== Sortie =====

async function main() {
    const buf = await lireInput();
    console.log(`📥 Input: ${buf.length} octets recus.\n`);

    const qrs = extraireQR(buf);
    if (qrs.length === 0) {
        console.log('⚠️  Aucune commande QR ESC/POS detectee dans ce ticket.');
        console.log('   Verifiez que le fichier est bien la version `currentTicketEscPos`,');
        console.log('   pas `currentTicketText` (qui contient [QR Code] en clair).\n');
    } else {
        console.log(`✅ ${qrs.length} QR code(s) ESC/POS detecte(s):\n`);
        for (const [i, qr] of qrs.entries()) {
            const idx = i + 1;
            console.log(`  [${idx}] URL: ${qr.url}`);
            console.log(`      Offset: ${qr.urlStart}-${qr.urlEnd} (${qr.urlEnd - qr.urlStart} octets)`);

            // Generation PNG
            const pngPath = path.join(process.cwd(), `qr-${idx}.png`);
            try {
                await QRCode.toFile(pngPath, qr.url, {
                    width: 300,
                    margin: 2,
                    errorCorrectionLevel: 'L'
                });
                console.log(`      📷 PNG: ${pngPath}`);
            } catch (e) {
                console.log(`      ❌ Erreur PNG: ${e.message}`);
            }

            // ASCII art dans le terminal
            try {
                const asciiQR = await QRCode.toString(qr.url, {
                    type: 'terminal',
                    small: true,
                    errorCorrectionLevel: 'L'
                });
                console.log('\n' + asciiQR);
            } catch (e) {
                console.log(`      ❌ Erreur ASCII: ${e.message}`);
            }
        }
    }

    // Version "humaine" du ticket
    const texte = nettoyerTexte(buf, qrs);
    console.log('━'.repeat(50));
    console.log('🧾 TICKET (version lisible):');
    console.log('━'.repeat(50));
    console.log(texte);
    console.log('━'.repeat(50));

    if (qrs.length > 0) {
        console.log('\n💡 Pour tester end-to-end:');
        console.log('   1. Ouvrez qr-1.png et scannez-le avec votre telephone.');
        console.log('   2. Le navigateur doit ouvrir l\'URL ci-dessus.');
        console.log('   3. Si oui, le ticket envoye a RawBT contiendra le bon QR.');
    }
}

main().catch((err) => {
    console.error('❌ Erreur:', err);
    process.exit(1);
});
