#!/usr/bin/env node
/*
 * Convertit le classeur « Fiches techniques cuisine » en data/referentiel.json
 * (le même code de lecture que l'appli, qui accepte aussi le .xlsx par glisser-déposer).
 * Usage : node commandes/outils/excel-vers-json.js "Fiches techniques cuisine.xlsx"
 * Nécessite le paquet npm « xlsx » (npm install xlsx@0.18.5).
 */
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const Moteur = require('../js/moteur.js');

const fichier = process.argv[2];
if (!fichier) { console.error('Usage : node excel-vers-json.js <classeur.xlsx>'); process.exit(1); }
const wb = XLSX.readFile(fichier);
const sheets = {};
wb.SheetNames.forEach(n => { sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }); });
const ref = Moteur.parseReferentiel(sheets, path.basename(fichier));
ref.importeLe = new Date().toISOString().slice(0, 10);
const sortie = path.join(__dirname, '..', 'data', 'referentiel.json');
fs.writeFileSync(sortie, JSON.stringify(ref, null, 1));
console.log(`${sortie} : ${ref.fournisseurs.length} fournisseurs, ${ref.catalogue.length} pièces, ${ref.composants.length} composants, ${ref.bar.length} boissons`);
