#!/usr/bin/env node
/**
 * Genere un fichier ticket-sample.bin qui simule exactement ce que pos.js
 * produit dans window.currentTicketEscPos pour un ticket avec section
 * tracabilite. A utiliser comme:
 *
 *   node scripts/qr-simulator-sample.js
 *   node scripts/qr-simulator.js ticket-sample.bin
 *
 * Si la sortie du second appel affiche bien l'URL https://www.maas-tracabilite.com
 * et genere un PNG du QR, c'est que la chaine de generation est correcte.
 */

const fs = require('fs');
const path = require('path');

const LARGEUR = 32;
const SEPARATEUR = '='.repeat(LARGEUR);
const LIGNE = '-'.repeat(LARGEUR);
const centrer = (texte) => {
    const espaces = Math.max(0, Math.floor((LARGEUR - texte.length) / 2));
    return ' '.repeat(espaces) + texte;
};

// Construction du ticket texte (identique au format imprimerTicketThermique)
let ticket = '';
ticket += SEPARATEUR + '\n';
ticket += centrer('MBAO') + '\n';
ticket += '\n';
ticket += SEPARATEUR + '\n';
ticket += '\n';
ticket += 'COMMANDE: CMD-TEST-001\n';
ticket += 'DATE: 12/05/2026 15:30\n';
ticket += '\n';
ticket += LIGNE + '\n';
ticket += 'ARTICLES\n';
ticket += LIGNE + '\n';
ticket += 'Produit         Qte         Total\n';
ticket += LIGNE + '\n';
ticket += 'Poulet           2        7 500\n';
ticket += 'Boeuf en gros    1        4 250\n';
ticket += '\n';
ticket += SEPARATEUR + '\n';
ticket += 'TOTAL                    11 750\n';
ticket += SEPARATEUR + '\n';
ticket += '\n';
ticket += centrer('*** PAYE ***') + '\n';
ticket += '\n';

// Section tracabilite (placeholder)
ticket += SEPARATEUR + '\n';
ticket += centrer('VERIFIEZ VOTRE PRODUIT') + '\n';
ticket += SEPARATEUR + '\n';
ticket += '\n';
ticket += centrer('Scannez le QR code ci-dessous') + '\n';
ticket += centrer('pour verifier la tracabilite') + '\n';
ticket += '\n';
ticket += centrer('[QR Code]') + '\n';
ticket += '\n';
ticket += centrer('www.maas-tracabilite.com') + '\n';
ticket += '\n';
ticket += SEPARATEUR + '\n';
ticket += '\n';

ticket += centrer('Merci de votre confiance !') + '\n';
ticket += centrer('Bon appetit!') + '\n';
ticket += SEPARATEUR;

// Replacement du placeholder par les commandes ESC/POS QR (meme logique
// que dans pos.js imprimerTicketThermique).
const qrPlaceholder = centrer('[QR Code]') + '\n';
const qrCodePos = ticket.indexOf(qrPlaceholder);
if (qrCodePos === -1) {
    console.error('❌ Placeholder "[QR Code]" introuvable dans le ticket genere.');
    console.error('   Le script qr-simulator-sample.js est desynchronise. Verifier le format.');
    process.exit(1);
}
const qrUrl = 'https://www.maas-tracabilite.com';
const urlLength = qrUrl.length;

let escPosQR = '';
escPosQR += '\x1D\x28\x6B\x04\x00\x31\x41\x32\x00';
escPosQR += '\x1D\x28\x6B\x03\x00\x31\x43\x08';
escPosQR += '\x1D\x28\x6B\x03\x00\x31\x45\x30';
const pl = (urlLength + 3) % 256;
const ph = Math.floor((urlLength + 3) / 256);
escPosQR += '\x1D\x28\x6B' + String.fromCharCode(pl, ph) + '\x31\x50\x30' + qrUrl;
escPosQR += '\x1D\x28\x6B\x03\x00\x31\x51\x30';
escPosQR += '\n';

const ticketEscPos = ticket.substring(0, qrCodePos) + escPosQR + ticket.substring(qrCodePos + qrPlaceholder.length);

// Ecriture binaire (Buffer pour preserver les bytes < 0x20)
const outPath = path.join(process.cwd(), 'ticket-sample.bin');
fs.writeFileSync(outPath, Buffer.from(ticketEscPos, 'binary'));
console.log(`✅ Ticket d'exemple ecrit dans: ${outPath}`);
console.log(`   Taille: ${Buffer.byteLength(ticketEscPos, 'binary')} octets`);
console.log(`   QR cible: ${qrUrl}`);
console.log('');
console.log('💡 Etape suivante:');
console.log('   node scripts/qr-simulator.js ticket-sample.bin');
