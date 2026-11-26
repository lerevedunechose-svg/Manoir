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
  // kir pétillant = crémant + cassis (cuisine-aperitifs-mal-mappes) : ce n'est plus l'apéritif générique 100 % crémant
  assert.deepStrictEqual(par('6 Kirs').forfaits, ['kir_petillant']);
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

/* ------------------------------------------------------------------ *
 * Régressions de la revue adversariale (un test par constat)
 * ------------------------------------------------------------------ */
const lire = (texte, nom, opt) => M.lireDocument(texte, nom, idx, Object.assign({ annee: 2026, reference: '2026-11-30' }, opt || {}));
const devis = (lignes, convives, date) => lire('CLIENT\nDate : ' + (date || 'Jeudi 10 décembre 2026') + ' Nombre : ' + convives + ' personnes\nLibellé Qté PU HT Montant HT TVA\n' + lignes.join('\n') + '\nTotal HT', 'Devis Test.pdf');
const fiche = (lignes, convives) => lire('Jeudi 10 décembre\nNombre : ' + convives + ' personnes\n' + lignes.join('\n'), '101226 - TEST.docx');
const postesDe = (f, j) => M.developperJour(f, j || f.jours[0], idx, {});
const besoinsDe = (f, opt, i) => M.calculerBesoins(f.jours.map(j => ({ fiche: f, jour: j, postes: M.developperJour(f, j, i || idx, {}) })), i || idx, opt || { margeDefaut: 0 });
const ligne = (b, re) => b.lignes.find(l => re.test(l.produit));
const ids = t => M.detecterForfaits(t, idx).map(x => x.id).sort();
const somme = o => Object.values(o || {}).reduce((s, n) => s + n, 0);
const proche = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, (msg || '') + ' : ' + a + ' ≠ ' + b);

test('moteur-delai-48h : « 48h » collé = 48 heures, « la veille avant 12h » = 24 h', () => {
  assert.strictEqual(M.parseDelai('48h'), 48);
  assert.strictEqual(M.parseDelai('24H'), 24);
  assert.strictEqual(M.parseDelai('72h'), 72);
  assert.strictEqual(M.parseDelai('la veille avant 12h'), 24);
  assert.strictEqual(M.parseDelai('commande avant 10h la veille'), 24);
  assert.strictEqual(M.parseDelai('avant-veille'), 48);
  assert.strictEqual(M.parseDelai('4-7 jours'), 168);
  assert.strictEqual(M.parseDelai('10 jours'), 240);
});

test('moteur-exclusion-globale : une exclusion n’écarte que le mot-clé qu’elle contient', () => {
  assert.deepStrictEqual(ids('Cocktail dînatoire Procé + cocktail sans alcool'), ['cocktail_proce', 'mocktail']);
  assert.deepStrictEqual(ids('Spritz, Hugo et Virgin Mojito'), ['cocktail_spritz', 'mocktail']);
  assert.ok(ids('Brunch (dont brunch enfant à 15 €)').includes('brunch'));
  assert.ok(ids('Apéritif dînatoire + verre de clôture').includes('aperitif'));
  // fiche : la ligne boissons avec « + cocktail sans alcool » n'efface plus le cocktail dînatoire
  const f = fiche(['RESTAURATION', '40 cocktails dînatoires', 'BOISSONS', 'Forfait boissons 3 verres (crémant, vin, bière) + cocktail sans alcool'], 40);
  const salees = postesDe(f).find(p => p.famille === 'salees_cocktail');
  assert.ok(salees && salees.convives === 40 && salees.parConvive === 11);
  // « crémant » dans la liste fait céder le forfait à l'apéritif, qui cède au cocktail sans alcool : le forfait reste
  assert.deepStrictEqual(f.jours[0].prestations[1].forfaits.sort(), ['forfait_boissons', 'mocktail']);
});

test('moteur-repartition-partielle-vegetarien : « dont 2 végétariens » sur 40 = 38 plats du chef + 2 végétariens', () => {
  const f = devis(['Déjeuner complet (entrée + plat + dessert) dont 2 végétariens 40,00 30,00 € 1 200,00 € 20,00%'], 40);
  const plat = postesDe(f).find(p => p.famille === 'plat');
  proche(plat.recettes.P031 * 40, 2, 'arancini');
  proche(somme(plat.recettes), 1, 'un plat par convive');
  assert.ok(plat.partiel && !plat.valide);
});

test('moteur-repartition-claude-zeros : une répartition à zéro (gabarit du prompt) est ignorée', () => {
  const base = lire('x', 'y.pdf');
  const f = M.normaliserLectureClaude({ jours: [{ date: '2026-12-10', convives: 40, prestations: [{ libelle: 'Déjeuner', forfaits: ['dejeuner_menu_chef'], quantite: 40, repartition: { viande: 0, poisson: 0, vegetarien: 0 } }] }] }, base, idx);
  assert.strictEqual(f.jours[0].prestations[0].repartition, null);
  const plat = postesDe(f).find(p => p.famille === 'plat');
  proche(somme(plat.recettes), 1);
  const f2 = M.normaliserLectureClaude({ jours: [{ date: '2026-12-10', convives: 30, prestations: [{ libelle: 'Menu', forfaits: ['dejeuner_menu_chef'], repartition: { viande: '20', poisson: 0, vegetarien: 'x' } }] }] }, base, idx);
  assert.deepStrictEqual(f2.jours[0].prestations[0].repartition, { viande: 20 });
});

test('moteur-mises-en-bouche-quantite : « 80 mises en bouche » sur une fiche = 80 convives × 3, pas 80 par personne', () => {
  const p = postesDe(fiche(['RESTAURATION', '80 mises en bouche'], 80)).find(x => x.forfait === 'mises_en_bouche');
  assert.strictEqual(p.convives, 80);
  assert.strictEqual(p.parConvive, 3);
  proche(somme(p.recettes), 3);
  const p2 = postesDe(fiche(['RESTAURATION', '80 mises en bouche (4 par personne)'], 80)).find(x => x.forfait === 'mises_en_bouche');
  assert.strictEqual(p2.parConvive, 4);
});

test('cuisine-mises-en-bouche-x30 : « 30 mises en bouche » pour 30 = 90 pièces, devis « (3 par personne) » inchangé', () => {
  const p = postesDe(fiche(['RESTAURATION', '30 mises en bouche'], 30)).find(x => x.forfait === 'mises_en_bouche');
  proche(somme(p.recettes) * p.convives, 90);
  const d = postesDe(devis(['Mises en bouche (5 par personne) 30,00 6,00 € 180,00 € 20,00%'], 30)).find(x => x.forfait === 'mises_en_bouche');
  assert.strictEqual(d.parConvive, 5);
});

test('moteur-conditionnement-produit-base : « Carton de 12 x 33 cl » = 12 bouteilles, jamais 330', () => {
  const i = M.indexer(ref, con, { fournisseurs: { vito: { nom: 'Vito', delai: '48 h', prix: { 'biere-artisanale': { prix: 24, unite: 'carton', conditionnement: 'Carton de 12 x 33 cl' } } } } });
  const besoins = { lignes: [{ cle: 'k', fournisseur: 'Vito', fournisseurSlug: 'vito', produit: 'Bière artisanale', produitSlug: 'biere-artisanale', base: 'bouteille', qte: 41.58, qteBrute: 39.6, coef: 1, dateBesoin: '2026-12-09', pour: [], type: 'bar' }], nonModelises: [], alertes: [] };
  const l = M.calculerCommandes(besoins, i, {}, { maintenant: new Date(2026, 10, 26, 10) }).bons[0].livraisons[0].lignes[0];
  assert.strictEqual(l.colis, 4);
  assert.strictEqual(l.aCommander, 48);
  assert.strictEqual(l.cout, 96);
  // conditionnement d'une autre unité, sans nombre de pièces : ignoré
  const i2 = M.indexer(ref, con, { fournisseurs: { vito: { nom: 'Vito', prix: { 'biere-artisanale': { conditionnement: 'Fût de 20 L' } } } } });
  const l2 = M.calculerCommandes(besoins, i2, {}, {}).bons[0].livraisons[0].lignes[0];
  assert.strictEqual(l2.aCommander, 42);
});

test('moteur-negation-fenetre : la négation s’arrête à la ponctuation et porte sur « à la place des »', () => {
  assert.ok(ids('Location de salle sans vidéoprojecteur, déjeuner complet').includes('dejeuner_menu_chef'));
  assert.ok(ids('Déjeuner assis (sans vin) + pause café').includes('pause_boisson'));
  assert.ok(ids('Petit-déjeuner offert sans supplément + apéritif').includes('aperitif'));
  assert.deepStrictEqual(ids('Option grand gâteau Honoré à la place des mignardises'), ['grand_gateau']);
  assert.deepStrictEqual(ids('Pas de petits déjeuners'), []);
});

test('moteur-date-emission : la date d’émission du devis n’est pas la date de l’événement', () => {
  const f = lire("MARIAGE DUPONT\nDate d'émission : 20/11/2026\nEvénement : Mariage Date : Samedi 12 décembre 2026 Nombre : 80 personnes", 'Devis Mariage Dupont.pdf');
  assert.deepStrictEqual(f.dates, ['2026-12-12']);
  const f2 = lire('Devis du 20/11/2026\nEvénement : repas\nLe repas aura lieu le 12 décembre 2026. Nombre : 20 personnes', 'Devis Z.pdf');
  assert.deepStrictEqual(f2.dates, ['2026-12-12']);
});

test('moteur-annee-nouvel-an : « Vendredi 1er janvier » vu depuis la semaine du 28/12/2026 tombe en 2027', () => {
  assert.deepStrictEqual(M.datesDepuisTexte('Date : Vendredi 1er janvier', 2026), ['2027-01-01']);
  assert.deepStrictEqual(M.datesDepuisTexte('Date : 1er janvier', 2026, '2026-12-28'), ['2027-01-01']);
  assert.deepStrictEqual(M.datesDepuisTexte('Date : 15 mars', 2026, '2026-03-02'), ['2026-03-15']);
  const f = M.lireDocument('Brunch du nouvel an\nDate : Vendredi 1er janvier Nombre : 20 personnes', 'Devis Brunch.pdf', idx, { annee: 2026 });
  assert.deepStrictEqual(f.dates, ['2027-01-01']);
});

test('moteur-prestation-datee-perdue : une ligne datée hors des dates de l’en-tête ajoute son jour', () => {
  const f = lire('CLIENT FORMATION\nNombre : 10 personnes\nLibellé Qté PU HT Rem. Montant HT TVA\nForfait 04/02 : Location + DEJ 10,00 54,00 € 0,00% 540,00 € 20,00%\nForfait 05/02 : Location + DEJ 10,00 54,00 € 0,00% 540,00 € 20,00%\nTotal HT', 'Devis Manoir de Procé - 040227 - CLIENT FORMATION.pdf');
  assert.deepStrictEqual(f.dates, ['2027-02-04', '2027-02-05']);
  const j5 = f.jours.find(j => j.date === '2027-02-05');
  assert.ok(j5.prestations.some(p => p.forfaits.includes('dejeuner_menu_chef')));
  assert.ok(f.remarques.some(r => /hors des dates/.test(r)));
});

const DEVIS_FORMATION = 'CLIENT FORMATION\nEvénement : Formations Nombre : 10 personnes Dates : 4 + 5 + 6 février 2027\nLibellé Qté PU HT Rem. Montant HT TVA\nPause café matin (10 pers. x 3 jours) 30,00 3,00 € 0,00% 90,00 € 20,00%\nDéjeuner du jeudi 4 février (entrée + plat + dessert) 10,00 25,00 € 0,00% 250,00 € 20,00%\nTotal HT';
test('moteur-multi-jours-quantite : « Pause café (10 pers. x 3 jours) » 30 = 10 par jour', () => {
  const f = lire(DEVIS_FORMATION, 'Devis Manoir de Procé - 040227 + 050227 + 060227 - CLIENT FORMATION.pdf');
  const total = f.jours.reduce((s, j) => s + postesDe(f, j).filter(p => p.forfait === 'pause_boisson').reduce((t, p) => t + p.convives, 0), 0);
  assert.strictEqual(total, 30);
  // une ligne non datée qui ne correspond pas à « effectif × jours » vaut pour chaque jour (prudent)
  const f2 = lire(DEVIS_FORMATION.replace('Pause café matin (10 pers. x 3 jours) 30,00', 'Pause café matin 25,00'), 'Devis Manoir de Procé - 040227 + 050227 + 060227 - CLIENT FORMATION.pdf');
  assert.deepStrictEqual(f2.jours.map(j => postesDe(f2, j).find(p => p.forfait === 'pause_boisson').convives), [25, 25, 25]);
});

test('moteur-multi-jours-date-texte : « Déjeuner du jeudi 4 février » ne vaut que pour le 4', () => {
  const f = lire(DEVIS_FORMATION, 'Devis Manoir de Procé - 040227 + 050227 + 060227 - CLIENT FORMATION.pdf');
  const dej = f.jours.map(j => postesDe(f, j).filter(p => p.famille === 'plat').length);
  assert.deepStrictEqual(dej, [1, 0, 0]);
});

test('moteur-jours-livraison-plages : tirets, « du mardi au samedi », « sauf »', () => {
  assert.deepStrictEqual(M.parseJours('Lundi-vendredi'), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(M.parseJours('Lun-Ven'), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(M.parseJours('Du mardi au samedi'), [2, 3, 4, 5, 6]);
  assert.deepStrictEqual(M.parseJours('Tous les jours sauf dimanche'), [1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(M.parseJours('Sauf le lundi'), [0, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(M.parseJours('du lundi au vendredi sauf mercredi'), [1, 2, 4, 5]);
  assert.deepStrictEqual(M.parseJours('Mardi et vendredi'), [2, 5]);
  assert.strictEqual(M.parseJours('Quand besoin'), null);
  assert.strictEqual(M.jourLivraison('2026-12-09', { joursLivraison: M.parseJours('Lun-Ven') }), '2026-12-09');
});

test('moteur-conditionnement-multipack : « 6 x 1 kg » = 6 kg, litres et kilos reconnus', () => {
  assert.strictEqual(M.parseConditionnement('Carton de 6 x 1 kg').qte, 6000);
  assert.strictEqual(M.parseConditionnement('Carton 6 x 75 cl').qte, 4500);
  assert.strictEqual(M.parseConditionnement('Bidon de 5 litres').qte, 5000);
  assert.strictEqual(M.parseConditionnement('Sac de 25 kilos').qte, 25000);
  assert.strictEqual(M.parseConditionnement('seau 8kg').qte, 8000);
  assert.strictEqual(M.parseConditionnement('Carton'), null);
});

test('moteur-parsenombre-fractions : 1/2, 1 1/2, une demie, 1 et demi', () => {
  assert.strictEqual(M.parseNombre('1/2'), 0.5);
  assert.strictEqual(M.parseNombre('1 1/2'), 1.5);
  assert.strictEqual(M.parseNombre('une demie'), 0.5);
  assert.strictEqual(M.parseNombre('1 et demi'), 1.5);
  assert.strictEqual(M.parseNombre('deux et demi'), 2.5);
  const r = M.parseReferentiel({ Composants: [['Code', 'Nom', 'Ingrédient', 'Qté', 'Unité', 'Fournisseur', 'Marge', 'Remarque'], ['P001', 'x', 'Citron vert', '1/2', 'pièce', 'Vito', '', '']] });
  assert.strictEqual(r.composants[0].qte, 0.5);
});

test('moteur-dates-liste-virgules : virgules, slash, plages et jours de semaine dans une liste', () => {
  const trois = ['2027-02-04', '2027-02-05', '2027-02-06'];
  assert.deepStrictEqual(M.datesDepuisTexte('Dates : 4, 5 et 6 février 2027', 2026), trois);
  assert.deepStrictEqual(M.datesDepuisTexte('4,5,6 février 2027', 2026), trois);
  assert.deepStrictEqual(M.datesDepuisTexte('4/5/6 février 2027', 2026), trois);
  assert.deepStrictEqual(M.datesDepuisTexte('du 4 au 6 février 2027', 2026), trois);
  assert.deepStrictEqual(M.datesDepuisTexte('Mardi 1er et mercredi 2 décembre 2026', 2026), ['2026-12-01', '2026-12-02']);
  assert.deepStrictEqual(M.datesDepuisTexte('Arrivée 8h30 - 1er décembre 2026', 2026), ['2026-12-01']);
});

test('moteur-halal-perdu : un plat halal exclu des propositions est pris dans tout le catalogue', () => {
  const plat = postesDe(fiche(['RESTAURATION', '40 menus du mois', '30 viandes, 8 poissons, 2 halal'], 40)).find(p => p.famille === 'plat');
  proche(plat.recettes.P033 * 40, 2, 'halal');
  proche(somme(plat.recettes), 1, '40 plats pour 40');
  // plat halal choisi explicitement pour tout le groupe : repris, même si le chef ne le propose pas d'office
  const halal = postesDe(fiche(['RESTAURATION', '11 menus Procé', 'Plat : Volaille Halal, écrasé de pommes de terre'], 11)).find(p => p.famille === 'plat');
  assert.deepStrictEqual(halal.recettes, { P033: 1 });
});

test('moteur-choix-hors-saison : une pièce estivale choisie par le client reste dans le poste', () => {
  const f = fiche(['RESTAURATION', '30 cocktails dînatoires', 'Focaccia, tomate confite, chorizo'], 30);
  const salees = postesDe(f).find(p => p.famille === 'salees_cocktail');
  assert.ok(salees.recettes.P018 >= 1, JSON.stringify(salees.recettes));
  proche(somme(salees.recettes), 11);
});

test('moteur-choix-nie : « Pas de nem de cochon ni de poulet croustillant » retire ces pièces des propositions', () => {
  const f = fiche(['RESTAURATION', '30 cocktails dînatoires', 'Pas de nem de cochon ni de poulet croustillant (convives ne mangeant pas de porc)'], 30);
  const p = f.jours[0].prestations[0];
  assert.deepStrictEqual(p.choisis, []);
  assert.deepStrictEqual(p.exclus.sort(), ['P007', 'P008']);
  const salees = postesDe(f).find(x => x.famille === 'salees_cocktail');
  assert.ok(!salees.recettes.P007 && !salees.recettes.P008 && !salees.explicite);
});

test('moteur-froides-chaudes : « 8 pièces froides » + « 4 pièces chaudes » = 12 pièces salées, sans pièce froide en plus', () => {
  const ps = postesDe(fiche(['RESTAURATION', '50 cocktails dînatoires', '8 pièces froides', '4 pièces chaudes'], 50));
  const salees = ps.filter(p => p.famille === 'salees_cocktail');
  assert.strictEqual(salees.length, 1);
  assert.strictEqual(salees[0].parConvive, 12);
});

test('moteur-fiche-sans-compte : restauration sans nombre en tête, titre MENU après le déroulé', () => {
  const f = fiche(['RESTAURATION', 'Cocktail dînatoire Procé – 15 pièces par personne', 'Plateau de fromages Beillevaire'], 40);
  const ps = postesDe(f);
  assert.ok(ps.some(p => p.famille === 'salees_cocktail' && p.convives === 40));
  assert.ok(ps.some(p => p.forfait === 'plateau_fromages'));
  const f2 = fiche(['DÉROULÉ', '12h accueil', 'MENU', '60 menus du mois'], 60);
  assert.ok(f2.jours[0].prestations.some(p => p.forfaits.includes('dejeuner_menu_chef') && p.quantite === 60));
});

test('moteur-type-fiche-devis : une fiche qui cite « devis n° … total TTC » reste une fiche', () => {
  const t = 'Mardi 1er décembre – CLIENT SOIREE\nBUDGET : devis n° 2026-142 signé – total TTC 1 260 €\nNombre : 15 personnes\nRESTAURATION\n15 cocktails dînatoires\nBOISSONS\n15 forfaits boissons : 3 verres parmi crémant, vin, bière artisanale, sans alcool';
  const f = M.lireDocument(t, '011226 - CLIENT SOIREE.docx', idx);
  assert.strictEqual(f.type, 'fiche_fonction');
  assert.strictEqual(f.jours[0].prestations.length, 2);
  assert.strictEqual(M.typeDocument(DEVIS_JOURNEE, 'Devis Manoir de Procé - 111226 - CLIENT TEST.pdf'), 'devis');
});

test('moteur-ligne-continuation-devis : la suite d’un libellé reste sur sa prestation', () => {
  const f = devis(['Forfait demi-journée 20,00 45,00 € 900,00 € 20,00%', '(accueil café + déjeuner entrée plat dessert)', 'Pause boisson après-midi 20,00 4,00 € 80,00 € 20,00%'], 20);
  const ps = f.jours[0].prestations;
  assert.ok(ps[0].details.some(d => /accueil café/.test(d)));
  assert.deepStrictEqual(ps[1].forfaits, ['pause_boisson']);
  assert.strictEqual(postesDe(f).filter(p => p.famille === 'plat').length, 1);
});

test('moteur-convives-forces / cuisine-convives-forces-ecrasent-tout : corriger l’effectif met les autres lignes à l’échelle', () => {
  const f = lire('CLIENT\nDate : Samedi 5 décembre 2026 Nombre : 30 adultes + 5 enfants\nLibellé Qté PU HT Montant HT TVA\nMenu Procé 30,00 35,00 € 1 050,00 € 10,00%\nMenu enfant 5,00 19,00 € 95,00 € 10,00%\nForfait journée 35,00 10,00 € 350,00 € 10,00%\nTotal HT', 'Devis Y.pdf');
  assert.strictEqual(f.jours[0].convivesLus, 35);
  f.jours[0].convives = 37; f.jours[0].convivesForces = true; // ce que fait l'appli
  const ps = postesDe(f);
  assert.strictEqual(ps.find(p => p.ref && p.ref.code === 'P040').convives, 5);
  assert.strictEqual(ps.find(p => p.forfait === 'menu_proce' && p.famille === 'plat').convives, 32);
  assert.ok(ps.filter(p => p.origine === 'journee_travail').every(p => p.convives === 37), 'la ligne qui suivait l’effectif prend la correction');
  // fiche enregistrée avant convivesLus : l'effectif de la fiche sert de référence
  delete f.jours[0].convivesLus;
  assert.strictEqual(postesDe(f).find(p => p.ref && p.ref.code === 'P040').convives, 5);
});

test('moteur-absorption-transitive : le cocktail convivial ne fait pas disparaître le dîner assis', () => {
  assert.deepStrictEqual(ids('Cocktail convivial à 19h puis dîner assis à 21h'), ['cocktail_convivial', 'dejeuner_menu_chef']);
  assert.deepStrictEqual(ids('Cocktail dînatoire à 19h puis dîner assis à 21h'), ['cocktail_proce', 'dejeuner_menu_chef']);
  assert.deepStrictEqual(ids('Cocktail dînatoire (repas debout)'), ['cocktail_proce']);
  // la fermeture par « inclut » reste : journée ⊃ petit-déjeuner ⊃ jus de pomme
  assert.deepStrictEqual(ids('Forfait journée de travail · Petit-déjeuner d’accueil (1 boisson chaude + 1 jus de pomme)'), ['journee_travail']);
});

test('moteur-convives-couverts : « couverts » et « invités » ; un devis sans effectif est signalé', () => {
  assert.strictEqual(M.convivesDepuisTexte('Nombre de couverts : 80').convives, 80);
  assert.strictEqual(M.convivesDepuisTexte('Mariage – 120 invités').convives, 120);
  assert.strictEqual(M.convivesDepuisTexte("Nombre d'invités : 120").convives, 120);
  const f = lire('MARIAGE\nDate : Samedi 12 décembre 2026\nLibellé Qté PU HT Montant HT TVA\nForfait mariage : cocktail dînatoire + dîner assis 1,00 6 800,00 € 6 800,00 € 10,00%\nTotal HT', 'Devis M.pdf');
  assert.ok(f.remarques[0] && /convives introuvable/.test(f.remarques[0]));
  assert.ok(postesDe(f).every(p => p.convivesInconnus));
});

test('moteur-cedea-nombre-verres / cuisine-nombre-de-verres-ignore : « 2 verres de vin », « 2 coupes » sont comptés', () => {
  const vin = f => { const b = besoinsDe(f); return ['Muscadet', 'Rouge local léger'].reduce((s, n) => s + ((b.lignes.find(l => l.produit === n) || {}).verres || 0), 0); };
  assert.strictEqual(vin(devis(['Forfait boissons (2 verres de vin + 1 café) pendant le déjeuner 30,00 6,50 € 195,00 € 20,00%'], 30)), 60);
  assert.strictEqual(vin(devis(['Forfait boissons : 3 verres de vin + 1 boisson chaude 30,00 6,50 € 195,00 € 20,00%'], 30)), 90);
  const b = besoinsDe(devis(["Vin d'honneur : 2 coupes de crémant par personne 30,00 6,50 € 195,00 € 20,00%"], 30));
  assert.strictEqual(ligne(b, /^Crémant/).verres, 60);
  // ligne de fiche « 30 verres de vin » : 30 convives × 1 verre, pas 900
  assert.strictEqual(vin(fiche(['BOISSONS', '30 verres de vin'], 30)), 30);
});

test('moteur-bar-verrecl-ignore : le verre (cl) de l’onglet Bar fixe les verres par bouteille', () => {
  const r = JSON.parse(JSON.stringify(ref));
  const cr = r.bar.find(b => b.nom === 'Crémant'); cr.fournisseur = 'Cave'; cr.conditionnement = 'bouteille 75 cl'; cr.verreCl = 10;
  const b = M.indexer(r, con, {}).bar.cremant;
  assert.strictEqual(b.verresParBouteille, 7);
  assert.strictEqual(b.defaut, false);
  const r2 = JSON.parse(JSON.stringify(ref)); r2.bar.find(x => x.nom === 'Crémant').fournisseur = 'Cave';
  assert.strictEqual(M.indexer(r2, con, {}).bar.cremant.defaut, true, 'le fournisseur seul ne cache pas la valeur par défaut');
});

test('moteur-marge-1pct : une marge « 1% » vaut 1 %, pas 100 %', () => {
  const r = M.parseReferentiel({ Composants: [['Code', 'Nom', 'Ingrédient', 'Qté', 'Unité', 'Fournisseur', 'Marge', 'Remarque'], ['P001', 'x', 'Huile', 20, 'g', 'Vito', '1%', ''], ['P001', '', 'Sel', 2, 'g', 'Vito', 0.05, ''], ['P001', '', 'Poivre', 2, 'g', 'Vito', 5, '']] });
  assert.deepStrictEqual(r.composants.map(c => c.marge), [0.01, 0.05, 0.05]);
});

test('moteur-fournisseur-sous-chaine : mots entiers, nom ambigu non attribué, « Maison » = production maison', () => {
  assert.strictEqual(M.trouverFournisseur(idx, 'Talensac'), null);
  assert.strictEqual(M.trouverFournisseur(idx, 'Maison').slug, 'production-maison');
  assert.strictEqual(M.trouverFournisseur(idx, 'fait maison').slug, 'production-maison');
  assert.strictEqual(M.trouverFournisseur(idx, 'Beillevaire').slug, 'fromagerie-pascal-beillevaire');
  assert.strictEqual(M.trouverFournisseur(idx, 'Maison Berjac').slug, 'maison-berjac');
});

test('moteur-heure-limite-dst : 48 h avant le lundi 29/03/2027 (heure d’été) = samedi 8 h ; 36 h = 17 h', () => {
  const tz = process.env.TZ; process.env.TZ = 'Europe/Paris';
  try {
    const l = M.heureLimite('2027-03-29', { delaiHeures: 48 }).limite;
    assert.deepStrictEqual([l.getDate(), l.getHours()], [27, 8]);
    const l2 = M.heureLimite('2027-03-22', { delaiHeures: 36 }).limite;
    assert.deepStrictEqual([l2.getDate(), l2.getHours()], [20, 17]);
  } finally { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
});

test('moteur-marge-bar-fixe : la marge réglée par l’équipe s’applique au bar', () => {
  const f = devis(['Forfait boissons (1 verre de vin + 1 café) 60,00 6,50 € 390,00 € 20,00%'], 60);
  assert.strictEqual(ligne(besoinsDe(f, { margeDefaut: 0 }), /^Muscadet/).verres, 30);
  assert.strictEqual(ligne(besoinsDe(f, { margeDefaut: 0.1 }), /^Muscadet/).verres, 33);
  assert.strictEqual(ligne(besoinsDe(f, { margeDefaut: 0.1, margeBar: 0 }), /^Muscadet/).verres, 30);
});

test('cuisine-pieces-sous-menu : « 3 pièces salées à l’apéritif » sous un menu = 3 mises en bouche, un seul plat', () => {
  const ps = postesDe(fiche(['RESTAURATION', '30 menus Procé', "3 pièces salées à l'apéritif", "Plat : Souris d'agneau"], 30));
  assert.ok(!ps.some(p => p.forfait === 'cocktail_proce'));
  proche(somme(ps.find(p => p.famille === 'plat').recettes), 1, 'un plat par convive');
  assert.strictEqual(ps.find(p => p.forfait === 'mises_en_bouche').parConvive, 3);
  assert.ok(!ps.some(p => p.ref && p.ref.code === 'P051' && p.forfait !== 'menu_proce'));
  const ps2 = postesDe(fiche(['RESTAURATION', '30 menus du mois', "3 pièces salées à l'apéritif"], 30));
  assert.ok(ps2.some(p => p.famille === 'plat'), 'le repas assis reste');
});

test('cuisine-brunch-double-compte : le descriptif du brunch ne déclenche ni petit-déjeuner ni plateau en plus', () => {
  const desc = con.forfaits.find(x => x.id === 'brunch').description;
  assert.deepStrictEqual(ids('Brunch : ' + desc + ' · fromages Beillevaire, charcuterie de Talensac'), ['brunch']);
  const b = besoinsDe(devis(['Brunch : ' + desc + ' 25,00 30,00 € 750,00 € 10,00%'], 25));
  assert.strictEqual(ligne(b, /Fromages/).qteBrute, 1250);
  assert.strictEqual(ligne(b, /Jus de pomme/).verres, 25);
});

test('cuisine-cocktail-boisson-declenche-cocktail-proce : « Cocktail Spritz / Hugo / Mojito » est une boisson', () => {
  assert.deepStrictEqual(ids('Cocktail Spritz'), ['cocktail_spritz']);
  assert.deepStrictEqual(ids('Cocktail Hugo'), ['cocktail_spritz']);
  assert.deepStrictEqual(ids('Cocktail Mojito'), ['mojito']);
  assert.deepStrictEqual(ids('Bar à cocktails'), ['cocktail_spritz']);
  assert.deepStrictEqual(ids('Cocktail dînatoire · Spritz à l’arrivée'), ['cocktail_proce', 'cocktail_spritz']);
});

test('cuisine-repartition-viande-poisson-perdue : « 21 viandes + 7 poissons + 2 végétariens » est respectée', () => {
  const attendu = r => { proche(r.P032, 0.7); proche(r.P029, 7 / 30); proche(r.P031, 2 / 30); };
  attendu(postesDe(fiche(['RESTAURATION', '30 menus Procé', 'Plat : 21 viandes (Suprême de volaille) + 7 poissons (Poisson de la criée) + 2 végétariens (Arancini)'], 30)).find(p => p.famille === 'plat').recettes);
  const f = fiche(['RESTAURATION', '30 menus Procé', '21 viandes + 7 poissons + 2 végétariens'], 30);
  assert.strictEqual(f.jours[0].prestations.length, 1, 'la répartition complète la ligne du menu');
  attendu(postesDe(f).find(p => p.famille === 'plat').recettes);
  const c = M.normaliserLectureClaude({ jours: [{ date: '2026-12-10', convives: 30, prestations: [{ libelle: 'Menu Procé', forfaits: ['menu_proce'], quantite: 30, choix: [{ code: 'P032' }, { code: 'P029' }, { code: 'P031' }], repartition: { viande: 21, poisson: 7, vegetarien: 2 } }] }] }, lire('x', 'y.pdf'), idx);
  attendu(postesDe(c).find(p => p.famille === 'plat').recettes);
});

test('cuisine-choix-client-entree-dessert-ignores : entrée et dessert choisis repris, glace non doublée', () => {
  const ps = postesDe(fiche(['RESTAURATION', '30 menus Procé', 'Entrée : Tartare de poisson & légumes croquants', "Plat : Souris d'agneau fondante aux épices", 'Dessert : Glace artisanale Jampi'], 30));
  assert.deepStrictEqual(ps.find(p => p.famille === 'entree').recettes, { P026: 1 });
  assert.deepStrictEqual(ps.find(p => p.famille === 'plat').recettes, { P036: 1 });
  assert.deepStrictEqual(ps.find(p => p.famille === 'dessert').recettes, { P054: 1 });
  assert.ok(!ps.some(p => p.ref && p.ref.code === 'P054'), 'pas de glace en plus du dessert');
  // un dessert de mignardises choisi = 3 mignardises
  const d = postesDe(fiche(['RESTAURATION', '30 menus Procé', 'Dessert : Assortiment de mignardises Honoré'], 30)).find(p => p.famille === 'dessert');
  assert.deepStrictEqual(d.recettes, { P051: 3 });
});

test('cuisine-15-pieces-plus-mignardises : « 15 pièces par personne dont 4 mignardises » = 11 salées + 4 sucrées', () => {
  const ps = postesDe(fiche(['RESTAURATION', '40 cocktails dînatoires', '15 pièces par personne dont 4 mignardises Honoré'], 40));
  assert.strictEqual(ps.find(p => p.famille === 'salees_cocktail').parConvive, 11);
  assert.strictEqual(ps.find(p => p.ref && p.ref.code === 'P051').parConvive, 4);
});

test('cuisine-bouteilles-par-personne : coupes, kir, demi-bouteille par personne, eau minérale', () => {
  assert.deepStrictEqual(ids("Champagne à l'arrivée (1 coupe par personne)"), ['coupe_champagne']);
  assert.ok(!ids('Apéritif : kir au muscadet').includes('bouteilles'));
  assert.deepStrictEqual(ids('Eau minérale en bouteille'), []);
  const b = besoinsDe(devis(['Vin blanc et rouge (1/2 bouteille par personne) 30,00 12,00 € 360,00 € 20,00%'], 30));
  assert.strictEqual(b.lignes.find(l => /Vin blanc/.test(l.produit)).qteBrute, 15);
  const champ = besoinsDe(devis(["Champagne à l'arrivée (1 coupe par personne) 40,00 9,00 € 360,00 € 20,00%"], 40));
  proche(ligne(champ, /^Champagne/).qte, 40 / 6);
  // ligne de devis au prix d'un verre : 30 verres = 5 bouteilles
  assert.strictEqual(besoinsDe(devis(['Muscadet AOC 30,00 4,50 € 135,00 € 20,00%'], 30)).lignes[0].qteBrute, 5);
  // la fiche « 29 bouteilles de champagne » reste comptée à l'unité (voir le test des boissons à l'unité)
});

test('cuisine-forfait-boissons-sans-alcool : « Forfait boissons sans alcool » ne commande pas d’alcool', () => {
  assert.deepStrictEqual(ids('Forfait boissons sans alcool'), ['forfait_sans_alcool']);
  assert.deepStrictEqual(ids('Forfaits boissons sans alcool'), ['forfait_sans_alcool']);
  assert.deepStrictEqual(ids('10 forfaits boissons x 9€ · 1 cocktail sans alcool + 2 boissons sans alcool ou boissons chaudes'), ['forfait_sans_alcool']);
  const b = besoinsDe(devis(['Forfait boissons sans alcool 30,00 6,00 € 180,00 € 20,00%'], 30));
  assert.ok(!b.lignes.some(l => /Crémant|Muscadet|Bière|Rouge/.test(l.produit)), b.lignes.map(l => l.produit).join(', '));
  assert.ok(ligne(b, /sans alcool Giffard/), 'le cocktail sans alcool commande ses ingrédients');
});

test('cuisine-plateau-fromages-50g : plateau de fromages vendu seul = 70 g/pers (50 g dans le cocktail convivial)', () => {
  assert.strictEqual(ligne(besoinsDe(devis(['Plateau de fromages Beillevaire 40,00 7,00 € 280,00 € 20,00%'], 40)), /Fromages/).qteBrute, 2800);
  assert.strictEqual(ligne(besoinsDe(devis(['Cocktail convivial 40,00 20,00 € 800,00 € 20,00%'], 40)), /Fromages/).qteBrute, 2000);
});

test('cuisine-produits-de-fond-traites-a-levenement : café et jus en réserve, jamais « en retard » à cause d’un événement', () => {
  const f = lire('CLIENT\nDate : Lundi 30 novembre 2026 Nombre : 30 personnes\nLibellé Qté PU HT Montant HT TVA\nForfait journée de travail 30,00 50,00 € 1500,00 € 20,00%\nTotal HT', 'Devis J.pdf');
  const cmd = M.calculerCommandes(besoinsDe(f, {}), idx, {}, { maintenant: new Date(2026, 10, 26, 10) });
  const fourche = cmd.bons.find(b => b.slug === 'la-fourche');
  assert.strictEqual(fourche.urgence, 'ok');
  assert.ok(fourche.livraisons[0].fond && fourche.livraisons[0].lignes[0].fond);
  assert.strictEqual(fourche.prochaineLimite, null);
  assert.ok(fourche.alertes.some(a => /réserve/.test(a)));
  const cime = cmd.bons.find(b => b.slug === 'cime');
  const cafe = cime.livraisons[0].lignes[0];
  // ~330 g de café pour 30 : moins d'un demi-seau de 8 kg → à prendre sur la réserve, rien à commander (pas un seau entier)
  assert.ok(cafe.fond && cafe.reserve, 'à prendre sur la réserve');
  assert.strictEqual(cafe.aCommander, 0);
  assert.strictEqual(cafe.colis, null);
  proche(cafe.aPrendreSurReserve, cafe.besoin, 'besoin brut montré');
  assert.ok(cime.alertes.some(a => /à prendre sur la réserve/.test(a)));
  assert.ok(!cime.alertes.some(a => /minimum/.test(a)));
  // la limite affichée n'est jamais déjà passée : la réserve couvre, le réassort part à la prochaine livraison possible
  assert.ok(cime.livraisons[0].limite >= new Date(2026, 10, 26, 10));
  // 500 convives : plus d'un demi-seau → un seau entier ; le stock saisi est déduit comme pour les autres produits
  const g = lire('CLIENT\nDate : Lundi 30 novembre 2026 Nombre : 500 personnes\nLibellé Qté PU HT Montant HT TVA\nForfait journée de travail 500,00 50,00 € 25000,00 € 20,00%\nTotal HT', 'Devis G.pdf');
  const gros = M.calculerCommandes(besoinsDe(g, {}), idx, {}, { maintenant: new Date(2026, 10, 26, 10) }).bons.find(b => b.slug === 'cime').livraisons[0].lignes[0];
  assert.strictEqual(gros.colis, 1, 'au seau entier');
  assert.strictEqual(gros.aCommander, 8000);
  const stock = {}; stock[gros.cleStock] = 2000;
  const apresStock = M.calculerCommandes(besoinsDe(g, {}), idx, stock, { maintenant: new Date(2026, 10, 26, 10) }).bons.find(b => b.slug === 'cime').livraisons[0].lignes[0];
  assert.strictEqual(apresStock.stock, 2000);
  assert.strictEqual(apresStock.aCommander, 0, 'reste moins d’un demi-seau : réserve');
  assert.ok(apresStock.reserve);
  // un bon sans date limite passe après ceux qui en ont une
  assert.ok(cmd.bons.findIndex(b => b.slug === 'la-fourche') > cmd.bons.findIndex(b => b.prochaineLimite));
});

test('cuisine-production-maison-en-bon-fournisseur : « Production maison » va à la mise en place, jamais en bon', () => {
  const f = devis(['Cocktail convivial 50,00 20,00 € 1000,00 € 20,00%', 'Forfait sans alcool 10,00 6,00 € 60,00 € 20,00%'], 50);
  const cmd = M.calculerCommandes(besoinsDe(f, {}), idx, {}, { maintenant: new Date(2026, 10, 26, 10) });
  assert.ok(!cmd.bons.some(b => b.slug === 'production-maison'));
  assert.ok(cmd.maison.some(l => /Cake/.test(l.produit)) && cmd.maison.some(l => /Tartinade/.test(l.produit)));
  assert.ok(cmd.bons.find(b => b.slug === 'vito').livraisons.some(l => l.lignes.some(x => /sans alcool Giffard/.test(x.produit))));
});

test('cuisine-aperitifs-mal-mappes : kir, kir pétillant, punch, mojito et champagne ont leurs ingrédients', () => {
  assert.deepStrictEqual(ids('Apéritif : punch'), ['punch']);
  assert.deepStrictEqual(ids('Apéritif : kir au muscadet'), ['kir']);
  assert.deepStrictEqual(ids('Kir pétillant'), ['kir_petillant']);
  assert.deepStrictEqual(ids('Mojito'), ['mojito']);
  const punch = besoinsDe(devis(['Apéritif : punch 40,00 5,00 € 200,00 € 20,00%'], 40));
  assert.ok(ligne(punch, /Rhum ambré/) && !ligne(punch, /^Crémant/));
  const kir = besoinsDe(devis(['Kir au muscadet 30,00 5,00 € 150,00 € 20,00%'], 30));
  assert.strictEqual(ligne(kir, /^Muscadet/).verres, 30);
  assert.ok(ligne(kir, /cassis/));
  const mojito = besoinsDe(devis(['Cocktail Mojito 40,00 8,00 € 320,00 € 20,00%'], 40));
  assert.ok(ligne(mojito, /Rhum blanc/) && ligne(mojito, /Menthe/) && ligne(mojito, /Citron vert/));
  assert.ok(!ligne(mojito, /Giffard/));
  const spritz = besoinsDe(devis(['Cocktail Spritz 30,00 8,00 € 240,00 € 20,00%'], 30));
  assert.strictEqual(ligne(spritz, /Bulles de l'Ouest/).base, 'bouteille');
  // un apéritif « au choix » parmi plusieurs reste un apéritif générique
  const auChoix = ids('1 apéritif au choix (kir, coupe de crémant, bière)');
  assert.ok(auChoix.includes('aperitif') && !auChoix.includes('kir'), auChoix.join(','));
});

test('cuisine-forfait-3-verres-plus-une-boisson : « 3 verres parmi crémant, vin, bière, sans alcool » = 3 boissons en tout', () => {
  const f = fiche(['RESTAURATION', '40 cocktails dînatoires', 'BOISSONS', '40 forfaits boissons : 3 verres parmi crémant, vin, bière artisanale, sans alcool'], 40);
  const b = besoinsDe(f);
  const verres = b.lignes.filter(l => l.type === 'bar').reduce((s, l) => s + (l.verres != null ? l.verres : 0), 0);
  proche(verres, 120, 'verres');
  assert.ok(!ligne(b, /Café/), 'pas de café dans un forfait de cocktail');
  assert.ok(ligne(b, /Breizh/), 'une part sans alcool');
  // « 3 verres d'alcool + 1 boisson sans alcool ou chaude » : 3 + 1
  const f2 = devis(["Forfaits boissons · 3 verres d'alcool + 1 boisson sans alcool ou boisson chaude 20,00 14,50 € 290,00 € 20,00%"], 20);
  const p2 = postesDe(f2).filter(p => p.forfait === 'forfait_boissons');
  assert.deepStrictEqual(p2.map(p => p.ref.boisson + ':' + p.parConvive).sort(), ['alcool:3', 'sans_alcool_ou_chaude:1']);
  assert.deepStrictEqual(ids('33 forfaits boissons · 3 verres parmi coupe de crémant, verre de vin, bière artisanale, boissons sans alcool'), ['forfait_boissons']);
});

test('cuisine-libelles-courants-non-lus : « forfait 3 verres », cocktail sans quantité, « pause de 12h »', () => {
  assert.deepStrictEqual(ids('Forfait 3 verres'), ['forfait_boissons']);
  assert.deepStrictEqual(ids('40 cocktails Procé et un forfait 3 verres'), ['cocktail_proce', 'forfait_boissons']);
  assert.deepStrictEqual(ids('Déjeuner (pause de 12h à 13h30)'), ['dejeuner_menu_chef']);
  assert.deepStrictEqual(ids("Demi-journée : Petit-déjeuner d'accueil (ou pause) + déjeuner complet."), ['demi_journee']);
  assert.deepStrictEqual(ids("Pause de l'après-midi"), ['pause_boisson']);
  const f = fiche(['RESTAURATION', 'Cocktail Procé (15 pièces)', 'BOISSONS', 'Forfait boissons 3 verres'], 40);
  const ps = f.jours[0].prestations;
  assert.deepStrictEqual(ps.map(p => p.forfaits), [['cocktail_proce'], ['forfait_boissons']]);
  assert.ok(postesDe(f).find(p => p.ref && p.ref.boisson === 'alcool').parConvive === 3);
  assert.ok(postesDe(f).every(p => p.convives === 40));
});

test('journée de travail : le cocktail déjeunatoire remplace le déjeuner assis (11 salées + 3 sucrées)', () => {
  const f = devis(["Forfait journée de travail · PDJ d'accueil (1 boisson chaude + 1 jus de pomme Bio + 2 mini viennoiseries) | Cocktail déjeunatoire debout | Une pause boisson 20,00 50,00 € 1000,00 € 20,00%"], 20);
  const ps = postesDe(f);
  assert.ok(!ps.some(p => p.famille === 'plat'), 'pas de déjeuner assis en plus du cocktail');
  assert.strictEqual(ps.find(p => p.famille === 'salees_cocktail').parConvive, 11);
  assert.strictEqual(ps.find(p => p.ref && p.ref.code === 'P051').parConvive, 3);
  assert.ok(ps.some(p => p.ref && p.ref.code === 'P055'), 'le petit-déjeuner reste');
  // un cocktail dînatoire le soir d'une journée ne remplace pas le déjeuner
  const soir = postesDe(devis(['Forfait journée de travail + cocktail dînatoire le soir 20,00 70,00 € 1400,00 € 20,00%'], 20));
  assert.ok(soir.some(p => p.famille === 'plat'));
  assert.strictEqual(soir.find(p => p.ref && p.ref.code === 'P051' && p.forfait === 'cocktail_proce').parConvive, 4);
});

/* ------------------------------------------------------------------ *
 * Second tour : régressions R1…R10 et corrections partielles
 * ------------------------------------------------------------------ */
test('R1 : « menu » seul n’est pas un repas assis (menu enfant, menu ci-joint, « Menu : » d’un cocktail)', () => {
  assert.deepStrictEqual(ids('11 menus enfant x 12€ - Dont un menu sans gluten · Poulet pané maison, grenailles + 1 glace + 1 jus de pomme BIO ou sirop'), ['menu_enfant']);
  assert.deepStrictEqual(ids('Menu enfant · 1 menu végétarien'), ['menu_enfant']);
  assert.deepStrictEqual(ids('Brunch (menu ci-joint)'), ['brunch']);
  assert.deepStrictEqual(ids('Menu cocktail : 11 pièces salées + 4 mignardises'), ['cocktail_proce']);
  assert.deepStrictEqual(ids('Menu végétarien'), []);
  // un menu qui cite ses plats reste un repas assis
  assert.deepStrictEqual(ids('44 menus x 25€ · Entrée : Œuf mollet mariné | Plat : Pastilla de volaille | Dessert : Crémet nantais'), ['dejeuner_menu_chef']);
  assert.deepStrictEqual(ids('Menu du jour'), ['dejeuner_menu_chef']);
  const f = devis(['Menu Procé 40,00 35,00 € 1 400,00 € 10,00%', 'Menus enfant - Dont un menu sans gluten 11,00 12,00 € 132,00 € 10,00%'], 51);
  const plats = postesDe(f).filter(p => p.famille === 'plat');
  assert.deepStrictEqual(plats.map(p => p.forfait + ':' + p.convives), ['menu_proce:40']);
  const c = postesDe(fiche(['RESTAURATION', '40 cocktails dînatoires', 'Menu : Crevette croustillante, Falafel, Nem de cochon'], 40));
  assert.ok(!c.some(p => p.famille === 'plat'), 'pas de dîner assis en plus du cocktail');
});

test('R2 : « 5 pièces salées + 2 sucrées » garde les 2 sucrées', () => {
  const ps = postesDe(fiche(['RESTAURATION', '20 forfaits apéritif 5 pièces salées + 2 sucrées'], 20));
  assert.strictEqual(ps.find(p => p.famille === 'salees_cocktail').parConvive, 5);
  assert.strictEqual(ps.find(p => p.ref && p.ref.code === 'P051').parConvive, 2);
  const ps2 = postesDe(devis(['Formule apéritive : 3 pièces salées + 2 sucrées 20,00 9,00 € 180,00 € 10,00%'], 20));
  assert.strictEqual(ps2.find(p => p.ref && p.ref.code === 'P051').parConvive, 2);
  const c = postesDe(fiche(['RESTAURATION', '30 cocktails dînatoires 11 pièces salées + 2 sucrées'], 30));
  assert.strictEqual(c.find(p => p.ref && p.ref.code === 'P051').parConvive, 2);
  // sans sucrées écrites : rien en plus
  assert.ok(!postesDe(fiche(['RESTAURATION', '30 menus Procé', "3 pièces salées à l'apéritif"], 30)).some(p => p.forfait === 'mises_en_bouche' && p.ref));
});

test('R3 : « 1 coupe à l’apéritif » est un apéritif (crémant)', () => {
  assert.deepStrictEqual(ids("17 forfaits boissons · 1 coupe à l'apéritif + 2 verres de vin + 1 boisson chaude ou sans alcool"), ['aperitif', 'soft_ou_chaude', 'verre_vin']);
  const f = devis(["Forfaits boissons : 1 coupe à l'apéritif + 2 verres de vin + 1 boisson chaude ou sans alcool 17,00 14,50 € 246,50 € 20,00%"], 17);
  assert.strictEqual(ligne(besoinsDe(f), /^Crémant/).verres, 17);
  // « pour l'apéritif » seul reste un contexte
  assert.ok(!ids("Pièces salées pour l'apéritif").includes('aperitif'));
});

test('R4 : « servi avec » n’efface pas ce qui est servi', () => {
  assert.deepStrictEqual(ids('Déjeuner entrée + plat + dessert servi avec un verre de vin'), ['dejeuner_menu_chef', 'verre_vin']);
  assert.deepStrictEqual(ids('Déjeuner assis servi avec café'), ['boisson_chaude', 'dejeuner_menu_chef']);
  // « servi avec le / les … » renvoie à une autre prestation (vrais documents) : pas de cocktail ni de pièces en plus
  assert.ok(!ids('26 verres de vin ou bière ou crémant ou sans alcool servi avec le cocktail déjeunatoire').includes('cocktail_proce'));
  assert.deepStrictEqual(ids('6 bouteilles de champagne x 40€ HT · Servi avec les pièces salées adultes à 17h30'), ['bouteilles']);
});

test('R5 : produits de fond regroupés sur une ligne de la semaine, seuil d’un demi-conditionnement, jamais en retard', () => {
  const evs = [];
  ['Lundi 7 décembre 2026', 'Mercredi 9 décembre 2026', 'Vendredi 11 décembre 2026'].forEach(d => {
    const f = lire('CLIENT\nDate : ' + d + ' Nombre : 20 personnes\nLibellé Qté PU HT Montant HT TVA\nForfait journée de travail 20,00 50,00 € 1 000,00 € 20,00%\nTotal HT', 'Devis ' + d + '.pdf');
    f.jours.forEach(j => evs.push({ fiche: f, jour: j, postes: M.developperJour(f, j, idx, {}) }));
  });
  const maintenant = new Date(2026, 11, 3, 10);
  const cmd = M.calculerCommandes(M.calculerBesoins(evs, idx, {}), idx, {}, { maintenant });
  const cime = cmd.bons.find(b => b.slug === 'cime');
  assert.strictEqual(cime.livraisons.length, 1, 'une seule livraison de café dans la semaine');
  const cafe = cime.livraisons[0].lignes;
  assert.strictEqual(cafe.length, 1, 'une seule ligne');
  assert.strictEqual(new Set(cafe[0].pour.map(x => x.date)).size, 3, 'les trois journées sur la même ligne');
  proche(cafe[0].besoinBrut, 600, 'besoin brut (3 × 20 convives × 10 g)');
  proche(cafe[0].aPrendreSurReserve, 630, 'avec la marge de 5 %');
  assert.strictEqual(cafe[0].aCommander, 0, 'pas 3 seaux de 8 kg pour 630 g');
  assert.ok(cafe[0].reserve && cafe[0].seuilReserve === 4000);
  assert.strictEqual(cime.livraisons[0].urgence, 'ok');
  assert.ok(cime.livraisons[0].limite >= maintenant, 'limite jamais déjà passée');
  assert.ok(cmd.bons.every(b => b.livraisons.every(l => !l.fond || l.urgence === 'ok')), 'jamais « retard » pour du fond');
  // le jus en BIB : un BIB entier dès un demi-BIB de besoin
  const jus = cmd.bons.find(b => b.slug === 'la-fourche').livraisons.find(l => l.fond).lignes[0];
  assert.ok(jus.besoin >= 0.5 && jus.aCommander === Math.ceil(jus.besoin - 1e-9) && !jus.reserve);
});

test('R6 / cuisine-forfait-3-verres : options « parmi / au choix » = N boissons en tout, « + 1 boisson » écrit en plus est gardé', () => {
  const parPers = lib => postesDe(devis([lib + ' 20,00 14,00 € 280,00 € 20,00%'], 20)).filter(p => p.type === 'fixe').reduce((s, p) => s + p.parConvive, 0);
  assert.strictEqual(parPers("Forfaits boissons · 2 verres d'alcool parmi coupe de crémant, verre de vin, bière ou sans alcool + 1 boisson chaude ou sans alcool"), 3);
  assert.strictEqual(parPers('Forfait boissons : 3 verres au choix : crémant, vin, bière ou sans alcool'), 3);
  assert.strictEqual(parPers('Forfait boissons : 3 verres parmi (crémant, vin, bière, sans alcool)'), 3);
  assert.strictEqual(parPers('Forfait boissons 3 verres parmi crémant, vin, bière, sans alcool'), 3);
  assert.strictEqual(parPers('Forfait boissons 3 verres + 1 boisson chaude'), 4);
});

test('R7 : le forfait boissons n’absorbe punch / mojito / spritz que s’ils sont au choix, jamais « 1 cocktail sans alcool »', () => {
  assert.deepStrictEqual(ids("80 forfaits boissons x 10€ · 2 verres d'alcool (dont Punch) + 1 boisson sans alcool"), ['forfait_boissons']);
  assert.deepStrictEqual(ids('40 forfaits boissons : 3 verres parmi crémant, vin, punch, sans alcool'), ['forfait_boissons']);
  assert.deepStrictEqual(ids("Forfait boissons 2 verres + punch à l'arrivée"), ['forfait_boissons', 'punch']);
  const ps = postesDe(devis(['48 forfaits boissons · 1 cocktail sans alcool + 3 boissons parmi Cola / Jus de pomme Bio / Eau plate ou gazeuse / Limonade / Sirop / Boisson chaude 48,00 8,00 € 384,00 € 20,00%'], 48));
  assert.ok(ps.some(p => p.forfait === 'mocktail'), 'les 48 cocktails sans alcool restent');
  assert.ok(!ps.some(p => p.ref && p.ref.boisson === 'alcool'), 'pas d’alcool dans un forfait sans alcool');
  assert.strictEqual(ps.find(p => p.ref && p.ref.boisson === 'soft').parConvive, 3);
});

test('R8 / moteur-fiche-sans-compte : une ligne en capitales qui est une pièce ou une formule n’est pas un sous-titre', () => {
  const f = fiche(['RESTAURATION', '30 cocktails dînatoires', 'CREVETTE CROUSTILLANTE', 'FALAFEL & YAOURT AUX HERBES', 'NEM DE COCHON'], 30);
  assert.deepStrictEqual(f.jours[0].prestations[0].choisis.map(c => c.code).sort(), ['P001', 'P007', 'P010']);
  const t = fiche(['RESTAURATION', 'COCKTAIL DÎNATOIRE PROCÉ', 'Crevette croustillante & sauce aigre douce'], 30).jours[0].prestations;
  assert.deepStrictEqual(t.map(p => p.forfaits), [['cocktail_proce']]);
  assert.deepStrictEqual(t[0].choisis.map(c => c.code), ['P001']);
  assert.deepStrictEqual(fiche(['RESTAURATION', 'BRUNCH', 'Viennoiseries, gaufres, huîtres'], 25).jours[0].prestations.map(p => p.forfaits), [['brunch']]);
  // un titre suivi de sa ligne chiffrée ne compte qu'une fois ; un sous-titre de la formule en cours reste un sous-titre
  assert.deepStrictEqual(fiche(['RESTAURATION', 'COCKTAIL', '40 cocktails dînatoires'], 40).jours[0].prestations.map(p => p.libelle), ['40 cocktails dînatoires']);
  const s = fiche(['RESTAURATION', '40 cocktails dînatoires', 'PIÈCES SALÉES', 'Crevette croustillante', 'PIÈCES SUCRÉES', 'Mignardises Honoré'], 40).jours[0].prestations;
  assert.strictEqual(s.length, 1, s.map(p => p.libelle).join(' | '));
  assert.ok(fiche(['DÉROULÉ', '12h accueil', 'MENU', '60 menus du mois'], 60).jours[0].prestations.some(p => p.quantite === 60));
});

test('R9 : « (apéritif) » sur une ligne de boissons sans alcool n’ajoute pas de crémant', () => {
  assert.deepStrictEqual(ids("3 boissons sans alcool (apéritif) · Choix sur place au tarif de l'établissement"), ['hors_cuisine', 'soft']);
  assert.ok(ids('Apéritif : kir au muscadet').includes('kir'));
});

test('R10 : « Salle 2 – samedi 12 décembre » est le 12 seulement', () => {
  assert.deepStrictEqual(M.datesDepuisTexte('Mariage – Salle 2 – samedi 12 décembre 2026', 2026), ['2026-12-12']);
  assert.deepStrictEqual(M.datesDepuisTexte('Option 1 - 5 décembre 2026', 2026), ['2026-12-05']);
  assert.deepStrictEqual(M.datesDepuisTexte('2 – 12 décembre 2026', 2026), ['2026-12-12']);
  assert.deepStrictEqual(M.datesDepuisTexte('lundi 7 – mardi 8 décembre 2026', 2026), ['2026-12-07', '2026-12-08']);
  assert.deepStrictEqual(M.datesDepuisTexte('Séminaire 4, 5 et 6 février 2027', 2026), ['2027-02-04', '2027-02-05', '2027-02-06']);
  const f = lire('CLIENT DUPONT\nMariage – Salle 2 – samedi 12 décembre 2026\nNombre : 80 personnes\nLibellé Qté PU HT Montant HT TVA\nMenu Procé 80,00 50,00 € 4 000,00 € 10,00%\nTotal HT 4 000,00 €', 'Devis Mariage Dupont.pdf');
  assert.deepStrictEqual(f.dates, ['2026-12-12']);
  assert.strictEqual(f.jours.reduce((s, j) => s + postesDe(f, j).filter(p => p.famille === 'plat').reduce((a, p) => a + p.convives, 0), 0), 80);
});

test('moteur-choix-nie (relecture Claude) : les pièces refusées restent écartées, champ « exclus » accepté', () => {
  const base = fiche(['RESTAURATION', '30 cocktails dînatoires', 'Pas de nem de cochon ni de poulet croustillant (convives ne mangeant pas de porc)'], 30);
  const rep = { jours: [{ date: '2026-12-10', convives: 30, prestations: [{ libelle: '30 cocktails dînatoires', quantite: 30, forfaits: ['cocktail_proce'], choix: [], repartition: { viande: 0, poisson: 0, vegetarien: 0 } }] }] };
  const f = M.normaliserLectureClaude(rep, base, idx);
  assert.deepStrictEqual(f.jours[0].prestations[0].exclus.sort(), ['P007', 'P008']);
  const r = postesDe(f).find(p => p.famille === 'salees_cocktail').recettes;
  assert.ok(!r.P007 && !r.P008, JSON.stringify(r));
  // champ « exclus » de Claude (codes du catalogue), même sans exclus dans la lecture locale
  rep.jours[0].prestations[0].exclus = ['P001', 'XXX'];
  const f2 = M.normaliserLectureClaude(rep, fiche(['RESTAURATION', '30 cocktails dînatoires'], 30), idx);
  assert.deepStrictEqual(f2.jours[0].prestations[0].exclus, ['P001']);
  assert.ok(!postesDe(f2).find(p => p.famille === 'salees_cocktail').recettes.P001);
});

test('moteur-delai-48h (heure fixe) : « avant 14h pour le lendemain », « J-1 avant 12h » = la veille à cette heure, jamais plus tard', () => {
  const lim = delai => { const f = { delai }; f.delaiHeures = M.parseDelai(delai); return M.heureLimite('2026-12-10', f, null).limite; };
  assert.deepStrictEqual(M.parseHeureLimite('Commande avant 14h pour livraison le lendemain'), { jours: 1, heure: 14, minutes: 0 });
  assert.strictEqual(M.parseDelai('avant 14h pour le lendemain'), 24);
  assert.strictEqual(M.parseDelai('J-1 avant 12h'), 24);
  assert.strictEqual(+lim('avant 14h pour le lendemain'), +new Date(2026, 11, 9, 14));
  assert.strictEqual(+lim('J-1 avant 12h'), +new Date(2026, 11, 9, 12));
  assert.strictEqual(+lim('la veille avant 12h'), +new Date(2026, 11, 9, 12));
  assert.strictEqual(+lim('avant-veille 10h'), +new Date(2026, 11, 8, 10));
  assert.strictEqual(+lim('avant 18h la veille'), +new Date(2026, 11, 9, 17), 'ramené aux heures de bureau, plus tôt');
  assert.strictEqual(+lim('48h'), +new Date(2026, 11, 8, 8));
  // heure limite saisie à part (onglet fournisseurs de l'appli) + délai en heures : la plus tôt des deux
  const i2 = M.indexer(ref, con, { fournisseurs: { cime: { nom: 'Cime', heureLimite: 'J-1 avant 12h' } } });
  assert.ok(M.heureLimite('2026-12-10', i2.fournisseurs.cime, null).limite <= new Date(2026, 11, 9, 12));
  const i3 = M.indexer({ fournisseurs: [], catalogue: [], composants: [], bar: [] }, { fournisseursInfos: { x: { nom: 'X', heureLimite: 'la veille avant 12h' } } }, {});
  assert.strictEqual(+M.heureLimite('2026-12-10', i3.fournisseurs.x, null).limite, +new Date(2026, 11, 9, 12));
});

test('option reference de lireDocument / datesDepuisTexte : Date, chaîne ISO ou horodatage', () => {
  const t = 'Brunch du nouvel an\nDate : 1er janvier Nombre : 20 personnes';
  for (const r of [new Date(2026, 11, 28), '2026-12-28', '2026-12-28T09:00:00', new Date(2026, 11, 28).getTime()]) {
    assert.deepStrictEqual(M.lireDocument(t, 'Devis Brunch.pdf', idx, { annee: 2026, reference: r }).dates, ['2027-01-01'], String(r));
    assert.deepStrictEqual(M.datesDepuisTexte('1er janvier', 2026, r), ['2027-01-01'], String(r));
  }
  // référence invalide : ignorée (aujourd'hui ou le nom de fichier servent de repère)
  assert.ok(Array.isArray(M.lireDocument(t, 'Devis Brunch.pdf', idx, { annee: 2026, reference: 'n/a' }).dates));
});
