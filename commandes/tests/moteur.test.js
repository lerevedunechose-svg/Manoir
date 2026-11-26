/* Tests du moteur : node --test commandes/tests/ */
const test = require('node:test');
const assert = require('node:assert');
const M = require('../js/moteur.js');
const ref = require('../data/referentiel.json');
const con = require('../data/connaissances.json');

const idx = M.indexer(ref, con, {});

// Devis au format du logiciel de facturation (texte tel que le Drive le restitue), client anonymisé.
const DEVIS_JOURNEE = `CLIENT TEST

Date : Vendredi 11 décembre 2026 Horaires : 8h30-17h30 (installation et démontage compris) Evénement : Réunion CODIR Nombre : 11 personnes (nombre final 20 jours avant)

Libellé Qté PU HT Montant HT TVA

Forfait journée de travail comprenant

\\- La location d’un salon (Vidéoprojecteur + wifi + whiteboard)

\\- Le petit-déjeuner d'accueil (1 boisson chaude + 1 jus de pomme Bio + 2 mini viennoiseries pur

beurre)

\\- Le déjeuner complet (Entrée + plat + dessert)

\\- Une pause boisson en matinée ou après-midi-

\\- Eau à disposition toute la journée

11,00 50,00 € 550,00 € 20,00%

Forfait boissons (1 verre de vin + 1 boisson chaude) pendant le déjeuner 11,00 6,50 € 71,50 € 20,00%

Frais de dossier 1,00 20,00 € 20,00 € 20,00%

Devis gratuit

Détail de la TVA

Total HT 641,50 €`;

const DEVIS_3_JOURS = `CLIENT FORMATION

Evénement : Formations Nombre : 10 personnes (Minimum de facturation : 6 personnes) Dates : 4 + 5 + 6 février 2027

Libellé Qté PU HT Rem. Montant HT TVA

Forfait 04/02 : Location + DEJ + 1 verre de vin + Pause boisson 10,00 54,00 € 8,00% 496,80 € 20,00%

04/02 : Privatisation de 2 salons à l'étage 1,00 250,00 € 30,00% 175,00 € 20,00%

Forfait 05/02 : Location + DEJ + 1 verre de vin + Pause boisson 10,00 54,00 € 8,00% 496,80 € 20,00%

05/02 : Privatisation de 2 salons à l'étage 1,00 250,00 € 30,00% 175,00 € 20,00%

06/02 : Location d'un salon de 25m2 équipé (vidéoprojecteur) 1,00 200,00 € 0,00% 200,00 € 20,00%

\\- Jeudi et vendredi : 8h15 : arrivée intervenant / 8h30 : arrivée participants / 19h maximum : fin // Samedi : 8h15 à 12h - Pas de petits déjeuners / Café / thé / eau à disposition

Devis gratuit

Total HT 1 543,60 €`;

const FICHE_COCKTAIL = `Mardi 1er décembre – CLIENT SOIREE
Evénement : soirée professionnelle
Nombre : 15 personnes
Horaires : 19h-23h
DÉROULÉ
19h30 accueil en table d'hôte
RESTAURATION
15 cocktails dînatoires
11 pièces salées :
Crevette croustillante & sauce aigre douce
Nem de cochon & sauce aigre douce
Falafel & yaourt aux herbes
4 pièces sucrées : assortiment de mignardises Honoré
BOISSONS
15 forfaits boissons : 3 verres parmi crémant, vin, bière artisanale, sans alcool`;

test('parse nombres et unités', () => {
  assert.strictEqual(M.parseNombre('une demi'), 0.5);
  assert.strictEqual(M.parseNombre('1,5'), 1.5);
  assert.strictEqual(M.parseNombre('2'), 2);
  assert.strictEqual(M.unite('kg').facteur, 1000);
  assert.strictEqual(M.formatQte(1250, 'g'), '1,25 kg');
  assert.strictEqual(M.parseDelai('1-2j'), 48);
  assert.deepStrictEqual(M.parseJours('Mardi et vendredi'), [2, 5]);
  assert.strictEqual(M.parseConditionnement('seau 8kg').qte, 8000);
});

test('dates : codes JJMMAA et texte', () => {
  assert.deepStrictEqual(M.datesDepuisCodes('Devis Manoir de Procé -  040227 + 050227 + 060227 - X.pdf'), ['2027-02-04', '2027-02-05', '2027-02-06']);
  assert.deepStrictEqual(M.datesDepuisTexte('Dates : 4 + 5 + 6 février 2027', 2026), ['2027-02-04', '2027-02-05', '2027-02-06']);
  assert.deepStrictEqual(M.datesDepuisTexte('Date : Vendredi 11 décembre 2026', 2026), ['2026-12-11']);
  const s = M.semaineDe(M.deIso('2026-12-03'));
  assert.strictEqual(M.iso(s.lundi), '2026-11-30');
  assert.strictEqual(s.cle, '2026-S49');
});

test('devis journée de travail : forfait reconnu, convives, boissons explicites', () => {
  const f = M.lireDocument(DEVIS_JOURNEE, 'Devis Manoir de Procé - 111226 - CLIENT TEST.pdf', idx);
  assert.strictEqual(f.type, 'devis');
  assert.strictEqual(f.client, 'CLIENT TEST');
  assert.deepStrictEqual(f.dates, ['2026-12-11']);
  assert.strictEqual(f.convives, 11);
  const ps = f.jours[0].prestations;
  assert.strictEqual(ps.length, 3);
  assert.ok(ps[0].forfaits.includes('journee_travail'), JSON.stringify(ps[0].forfaits));
  assert.ok(!ps[0].forfaits.includes('petit_dejeuner'));
  assert.deepStrictEqual(ps[1].forfaits.filter(x => x !== 'hors_cuisine').sort(), ['boisson_chaude', 'verre_vin']);
  assert.ok(ps[2].horsCuisine);
  const postes = M.developperJour(f, f.jours[0], idx);
  const codes = postes.filter(p => p.type === 'fixe' && p.ref.code).map(p => p.ref.code);
  assert.ok(codes.includes('P055'));
  const choix = postes.filter(p => p.type === 'choix').map(p => p.famille).sort();
  assert.deepStrictEqual(choix, ['dessert', 'entree', 'plat']);
  assert.ok(postes.every(p => p.convives === 11));
});

test('devis sur 3 jours : prestations datées, mention « pas de petits déjeuners » ignorée', () => {
  const f = M.lireDocument(DEVIS_3_JOURS, 'Devis Manoir de Procé -  040227 + 050227 + 060227 - CLIENT FORMATION.pdf', idx);
  assert.strictEqual(f.jours.length, 3);
  const j1 = f.jours.find(j => j.date === '2027-02-04');
  const ids = j1.prestations.flatMap(p => p.forfaits);
  assert.ok(ids.includes('dejeuner_menu_chef'));
  assert.ok(ids.includes('verre_vin'));
  assert.ok(ids.includes('pause_boisson'));
  const j3 = f.jours.find(j => j.date === '2027-02-06');
  const postes3 = M.developperJour(f, j3, idx);
  assert.strictEqual(postes3.length, 0, 'le samedi ne comporte que la location');
  assert.ok(f.remarques.some(r => /petits déjeuners/.test(r)));
});

test('fiche de fonction : pièces choisies reprises telles quelles', () => {
  const f = M.lireDocument(FICHE_COCKTAIL, '011226 - CLIENT SOIREE.docx', idx);
  assert.strictEqual(f.type, 'fiche_fonction');
  assert.strictEqual(f.convives, 15);
  const cocktail = f.jours[0].prestations.find(p => p.forfaits.includes('cocktail_proce'));
  assert.ok(cocktail, JSON.stringify(f.jours[0].prestations.map(p => [p.libelle, p.forfaits])));
  assert.deepStrictEqual(cocktail.choisis.map(c => c.code).sort(), ['P001', 'P007', 'P010']);
  assert.strictEqual(cocktail.nbParConvive, 11);
  const postes = M.developperJour(f, f.jours[0], idx);
  const salees = postes.find(p => p.famille === 'salees_cocktail');
  assert.ok(salees.explicite && salees.partiel);
  assert.strictEqual(salees.recettes.P001, 1);
  const total = Object.values(salees.recettes).reduce((s, n) => s + n, 0);
  assert.ok(Math.abs(total - 11) < 1e-9, 'total ' + total);
});

test('proposition du chef : 8 recettes variées dont une végétarienne, 11 pièces', () => {
  const pioche = M.piocheDe(con.choix.salees_cocktail, idx, '2026-12-01');
  assert.ok(!pioche.includes('P016'), 'pas de recette estivale en décembre');
  const codes = M.proposer(pioche, 8, idx, 'salees_cocktail', 0);
  assert.strictEqual(codes.length, 8);
  assert.ok(codes.some(c => /jardin/.test(idx.catalogue[c].categorie)));
  const r = M.repartir(11, codes);
  assert.strictEqual(Object.values(r).reduce((s, n) => s + n, 0), 11);
});

test('besoins et commandes : grammages × convives × marge, stock déduit, bouteilles', () => {
  const f = M.lireDocument(FICHE_COCKTAIL, '011226 - CLIENT SOIREE.docx', idx);
  const postes = M.developperJour(f, f.jours[0], idx);
  const besoins = M.calculerBesoins([{ fiche: f, jour: f.jours[0], postes }], idx, { margeDefaut: 0 });
  const crevette = besoins.lignes.find(l => /Crevette/.test(l.produit));
  assert.ok(crevette, besoins.lignes.map(l => l.produit).join(', '));
  assert.strictEqual(crevette.fournisseurSlug, 'coup-de-pates');
  assert.strictEqual(crevette.dateBesoin, '2026-11-30');
  const mign = besoins.lignes.find(l => l.produit === 'Mignardises');
  assert.strictEqual(mign.qteBrute, 60);
  assert.strictEqual(mign.dateBesoin, '2026-12-01', 'Honoré livre le jour même');
  const cremant = besoins.lignes.find(l => l.produit === 'Crémant');
  assert.ok(cremant && cremant.base === 'bouteille', JSON.stringify(cremant));
  const stock = {}; stock[M.cleProduit(crevette.fournisseurSlug, crevette.produit, crevette.base)] = 5;
  const cmd = M.calculerCommandes(besoins, idx, stock, { maintenant: new Date(2026, 10, 26, 10) });
  const bonCdp = cmd.bons.find(b => b.slug === 'coup-de-pates');
  const ligne = bonCdp.livraisons[0].lignes.find(l => /Crevette/.test(l.produit));
  assert.strictEqual(ligne.stock, 5);
  assert.strictEqual(ligne.aCommander, Math.ceil(crevette.qte - 5));
});

test('apprentissage : alias de libellé prioritaire, coefficient borné', () => {
  const idx2 = M.indexer(ref, con, { alias: { [M.cleAlias('Formule Gourmet du Manoir')]: { forfaits: ['cocktail_proce'] } } });
  const d = M.detecterForfaits('Formule Gourmet du Manoir', idx2);
  assert.strictEqual(d[0].id, 'cocktail_proce');
  assert.strictEqual(d[0].via, 'alias');
  let c = null; for (let i = 0; i < 20; i++) c = M.ajusterCoefficient(c, 'manque');
  assert.strictEqual(c.coef, 1.6);
  c = M.ajusterCoefficient(null, 'trop'); assert.strictEqual(c.coef, 0.92);
});

test('forfaits boissons : générique ou détail explicite', () => {
  const ids = t => M.detecterForfaits(t, idx).map(x => x.id).sort();
  assert.deepStrictEqual(ids('Forfait boissons 3 verres + 1 boisson chaude'), ['forfait_boissons']);
  assert.deepStrictEqual(ids('Forfait boissons (1 verre de vin + 1 boisson chaude) pendant le déjeuner'), ['boisson_chaude', 'verre_vin']);
  assert.deepStrictEqual(ids('Mises en bouche (4 par personne)'), ['mises_en_bouche']);
  assert.deepStrictEqual(ids('Cocktail sans alcool'), ['mocktail']);
});

test('fournisseur à long délai : une seule livraison dans la semaine', () => {
  const f1 = M.lireDocument(DEVIS_JOURNEE.replace('11 décembre', '1 décembre'), 'Devis Manoir de Procé - 011226 - A.pdf', idx);
  const f2 = M.lireDocument(DEVIS_JOURNEE.replace('11 décembre', '3 décembre'), 'Devis Manoir de Procé - 031226 - B.pdf', idx);
  const evs = [f1, f2].map(f => ({ fiche: f, jour: f.jours[0], postes: M.developperJour(f, f.jours[0], idx) }));
  const cmd = M.calculerCommandes(M.calculerBesoins(evs, idx, {}), idx, {}, { maintenant: new Date(2026, 10, 20, 9) });
  const fourche = cmd.bons.find(b => b.slug === 'la-fourche');
  assert.strictEqual(fourche.livraisons.length, 1, 'La Fourche (10 jours) : une livraison');
  const jus = fourche.livraisons[0].lignes.find(l => /Jus de pomme/.test(l.produit));
  assert.strictEqual(new Set(jus.pour.map(p => p.client)).size, 2, 'les deux services sont regroupés sur la même ligne');
  const berjac = cmd.bons.find(b => b.slug === 'maison-berjac');
  assert.ok(berjac.livraisons.length >= 1);
});

test('fiche de fonction : boissons à l’unité et lignes de configuration', () => {
  const t = 'Samedi 12 décembre – TEST\nNombre : 30 personnes\nCONFIGURATION DES ESPACES : 200€ · Grande salle : repas assis, nappage blanc\nRESTAURATION\n30 cocktails déjeunatoire debout : 11 pièces salées + 3 pièces sucrées au choix du chef\n6 menus adolescents x 18€\nAllergies :\n2 végétariens\nBOISSONS\n29 bouteilles de champagne x 40€ HT\n3 AOC Côtes du Rhône Colline 2022 (La Cabotte) x 30€\n6 Kirs pétillants x 6€\n8 cafés x 2€';
  const f = M.lireDocument(t, '121226 - TEST.docx', idx);
  const ps = f.jours[0].prestations;
  const par = l => ps.find(p => p.libelle.indexOf(l) === 0);
  assert.deepStrictEqual(par('30 cocktails').forfaits, ['cocktail_proce']);
  assert.deepStrictEqual(par('6 menus adolescents').forfaits, ['menu_ado']);
  assert.deepStrictEqual(par('29 bouteilles').forfaits, ['bouteilles']);
  assert.deepStrictEqual(par('6 Kirs').forfaits, ['aperitif']);
  assert.deepStrictEqual(par('8 cafés').forfaits, ['boisson_chaude']);
  assert.ok(!ps.some(p => /^2 végétariens/.test(p.libelle)), 'un régime n’est pas une prestation');
  assert.deepStrictEqual(M.detecterForfaits('CONFIGURATION DES ESPACES : 200€ · Grande salle : repas assis, nappage blanc', idx).map(x => x.id), ['hors_cuisine']);
  const ev = [{ fiche: f, jour: f.jours[0], postes: M.developperJour(f, f.jours[0], idx) }];
  const mign = ev[0].postes.find(p => p.ref && p.ref.code === 'P051');
  assert.strictEqual(mign.parConvive, 3, '3 pièces sucrées lues dans la fiche');
  const cave = M.calculerCommandes(M.calculerBesoins(ev, idx, { margeDefaut: 0 }), idx, {}, {}).bons.find(b => /Cave/.test(b.nom));
  const lignes = cave.livraisons.flatMap(l => l.lignes);
  assert.strictEqual(lignes.find(l => l.produit === 'Champagne').aCommander, 29);
  assert.strictEqual(lignes.find(l => /Côtes du Rhône/.test(l.produit)).aCommander, 3);
});
