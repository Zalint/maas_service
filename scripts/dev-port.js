#!/usr/bin/env node
/**
 * Lance server.js sur un PORT impose, sans toucher a .env.local.
 *
 * Sert a faire tourner une seconde instance a cote de celle du developpeur:
 * .env.local fixe PORT=3005, et dotenv n'ecrase pas une variable deja posee
 * dans process.env. On la pose donc AVANT tout require applicatif.
 *
 * Usage: PORT=3007 node scripts/dev-port.js   (ou node scripts/dev-port.js 3007)
 */
'use strict';
const port = process.argv[2] || process.env.DEV_PORT || '3007';
process.env.PORT = port;
console.log(`[dev-port] server.js sur le port ${port}`);
require('../server.js');
