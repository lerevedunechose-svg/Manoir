/*
 * Brigade de Procé — moteur de calcul des commandes cuisine.
 * Pur JavaScript, sans dépendance : utilisable dans le navigateur (window.Moteur)
 * et dans Node (require) pour les tests.
 *
 *  1. Référentiel  : lit le classeur « Fiches techniques cuisine » (Fournisseurs, Catalogue, Composants, Bar).
 *  2. Lecture      : transforme le texte d'un devis ou d'une fiche de fonction (FF) en événements.
 *  3. Forfaits     : reconnaît les formules du Manoir (journée de travail, cocktail Procé, brunch…).
 *  4. Menu du chef : développe chaque formule en postes, propose les pièces « au choix du chef ».
 *  5. Besoins      : grammages × convives × marge × coefficients appris → lignes par fournisseur.
 *  6. Commandes    : stock déduit, conditionnements, jours de livraison, heure limite de commande.
 *  7. Apprentissage: alias de libellés, habitudes du chef, coefficients issus du retour de service.
 */
(function (root, factory) {
  const M = factory();
  if (typeof module === 'object' && module.exports) module.exports = M;
  else root.Moteur = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Outils texte et nombres
   * ------------------------------------------------------------------ */
  function sansAccents(s) {
    return String(s == null ? '' : s)
      .replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/æ/g, 'ae').replace(/Æ/g, 'AE')
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  /** minuscules, sans accents, ponctuation → espaces (garde + % pour « entrée + plat »). */
  function norm(s) {
    return sansAccents(s).toLowerCase()
      .replace(/[’`´]/g, "'")
      .replace(/\\-/g, '-')
      .replace(/[^a-z0-9+%]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function slug(s) { return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function echapperRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  const MOTS_NOMBRES = {
    'un': 1, 'une': 1, 'deux': 2, 'trois': 3, 'quatre': 4, 'cinq': 5, 'six': 6, 'sept': 7, 'huit': 8,
    'neuf': 9, 'dix': 10, 'onze': 11, 'douze': 12, 'quinze': 15, 'vingt': 20,
  };
  /** « 1,5 » → 1.5 ; « une demi(e) » → 0.5 ; « 1/2 » → 0.5 ; « 1 1/2 » → 1.5 ; « 1 et demi » → 1.5 ; « 2 » → 2 ; sinon null. */
  function parseNombre(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    // les fractions se lisent sur le texte brut : norm() a déjà changé « / » en espace
    const brut = String(v);
    let fr = brut.match(/(\d+)\s+(\d+)\s*\/\s*(\d+)/);
    if (fr && +fr[3]) return +fr[1] + +fr[2] / +fr[3];
    fr = brut.match(/(\d+)\s*\/\s*(\d+)/);
    if (fr && +fr[2]) return +fr[1] / +fr[2];
    const t = norm(v);
    if (!t) return null;
    if (/\bdemie?s?\b/.test(t)) {
      const mots = t.split(/\bdemie?s?\b/)[0].trim().split(' ').filter(Boolean);
      let avant = mots.pop();
      const et = avant === 'et';
      if (et) avant = mots.pop();
      const n = avant == null ? null : (/^\d+$/.test(avant) ? +avant : (MOTS_NOMBRES[avant] != null ? MOTS_NOMBRES[avant] : null));
      if (et) return (n || 0) + 0.5; // « 1 et demi », « deux et demi »
      if (n == null || n === 1) return 0.5; // « une demi », « demie »
      return n * 0.5; // « trois demis » = 1,5
    }
    const num = String(v).replace(/[\s  ]/g, '').match(/-?\d+(?:[.,]\d+)?/);
    if (num) return parseFloat(num[0].replace(',', '.'));
    const mot = t.split(' ').find(w => MOTS_NOMBRES[w] != null);
    return mot ? MOTS_NOMBRES[mot] : null;
  }
  /** montant français « 1 543,60 » → 1543.6 */
  function parseMontant(s) {
    if (s == null) return null;
    const t = String(s).replace(/[\s  €]/g, '').replace(',', '.');
    const n = parseFloat(t);
    return isFinite(n) ? n : null;
  }
  function arrondi(n, d) { const p = Math.pow(10, d == null ? 2 : d); return Math.round(n * p) / p; }

  /* ------------------------------------------------------------------ *
   * Unités
   * ------------------------------------------------------------------ */
  const UNITES = {
    g: { famille: 'masse', facteur: 1, base: 'g' }, gr: { famille: 'masse', facteur: 1, base: 'g' },
    gramme: { famille: 'masse', facteur: 1, base: 'g' }, grammes: { famille: 'masse', facteur: 1, base: 'g' },
    kg: { famille: 'masse', facteur: 1000, base: 'g' }, kilo: { famille: 'masse', facteur: 1000, base: 'g' },
    kilos: { famille: 'masse', facteur: 1000, base: 'g' },
    kilogramme: { famille: 'masse', facteur: 1000, base: 'g' }, kilogrammes: { famille: 'masse', facteur: 1000, base: 'g' },
    ml: { famille: 'volume', facteur: 1, base: 'ml' }, cl: { famille: 'volume', facteur: 10, base: 'ml' },
    l: { famille: 'volume', facteur: 1000, base: 'ml' }, litre: { famille: 'volume', facteur: 1000, base: 'ml' },
    litres: { famille: 'volume', facteur: 1000, base: 'ml' },
  };
  /** Ramène une unité saisie à une unité de base : g, ml, ou une unité de comptage (pièce, botte, tranche…). */
  function unite(u) {
    const t = norm(u).replace(/s$/, '').replace(/^choux$/, 'chou');
    if (!t) return { famille: 'piece', facteur: 1, base: 'pièce' };
    if (UNITES[t]) return UNITES[t];
    if (UNITES[t + 's']) return UNITES[t + 's'];
    if (/^(piece|pce|pc|pax|unite|u|portion|part|verrine|cuillere|bol)$/.test(t)) return { famille: 'piece', facteur: 1, base: 'pièce' };
    if (/^(botte|tranche|sachet|tasse|bouteille|verre|chou|boite|barquette|plaque|pot)$/.test(t)) {
      const nom = { cuillere: 'cuillère', boite: 'boîte' }[t] || t;
      return { famille: 'compte:' + nom, facteur: 1, base: nom };
    }
    return { famille: 'compte:' + t, facteur: 1, base: t };
  }
  /** Affichage lisible : 1250 g → « 1,25 kg » ; 3 pièce → « 3 pièces ». */
  function formatQte(q, base) {
    if (q == null || !isFinite(q)) return '—';
    const fr = (n, d) => n.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
    if (base === 'g') return q >= 1000 ? fr(q / 1000, 2) + ' kg' : fr(Math.ceil(q), 0) + ' g';
    if (base === 'ml') return q >= 1000 ? fr(q / 1000, 2) + ' L' : (q >= 100 ? fr(q / 10, 0) + ' cl' : fr(Math.ceil(q), 0) + ' ml');
    const n = Math.abs(q - Math.round(q)) < 1e-9 ? fr(q, 0) : fr(q, 1);
    if (!base) return n;
    const pluriel = q > 1 && !/s$|x$|\s|\d/.test(base) ? base + 's' : base;
    return n + ' ' + pluriel;
  }

  /* ------------------------------------------------------------------ *
   * Dates
   * ------------------------------------------------------------------ */
  const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
  const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

  function iso(d) {
    const z = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }
  function deIso(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null;
  }
  function ajouterJours(d, n) { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function dateValide(a, m, j) {
    const d = new Date(a, m - 1, j, 12);
    return d.getFullYear() === a && d.getMonth() === m - 1 && d.getDate() === j ? d : null;
  }
  /** Semaine (lundi → dimanche) contenant la date. */
  function semaineDe(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
    const dec = (x.getDay() + 6) % 7;
    const lundi = ajouterJours(x, -dec);
    const dimanche = ajouterJours(lundi, 6);
    // numéro ISO
    const jeudi = ajouterJours(lundi, 3);
    const debutAnnee = new Date(jeudi.getFullYear(), 0, 4, 12);
    const num = 1 + Math.round(((jeudi - debutAnnee) / 864e5 - 3 + ((debutAnnee.getDay() + 6) % 7)) / 7);
    return { lundi, dimanche, numero: num, cle: jeudi.getFullYear() + '-S' + String(num).padStart(2, '0'), jours: [0, 1, 2, 3, 4, 5, 6].map(i => iso(ajouterJours(lundi, i))) };
  }
  function dansSemaine(dateIso, sem) { return sem.jours.indexOf(dateIso) >= 0; }
  function jourCourt(dateIso) {
    const d = deIso(dateIso); if (!d) return dateIso || '';
    return JOURS_COURTS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS_COURTS[d.getMonth()];
  }
  function jourLong(dateIso) {
    const d = deIso(dateIso); if (!d) return dateIso || '';
    const j = JOURS[d.getDay()];
    return j.charAt(0).toUpperCase() + j.slice(1) + ' ' + d.getDate() + ' ' + MOIS_COURTS[d.getMonth()].replace('.', '');
  }
  /** Codes JJMMAA (« 111226 », « 040227 + 050227 ») présents dans un nom de fichier. */
  function datesDepuisCodes(texte) {
    const res = [];
    const re = /(?:^|[^0-9])(\d{2})(\d{2})(\d{2})(?![0-9])/g;
    let m;
    while ((m = re.exec(String(texte || '')))) {
      const d = dateValide(2000 + +m[3], +m[2], +m[1]);
      if (d && d.getFullYear() >= 2015 && d.getFullYear() <= 2040) res.push(iso(d));
    }
    return Array.from(new Set(res));
  }
  const RE_NOM_JOUR = '(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)';
  /**
   * Année d'une date écrite sans année : le jour de semaine écrit (« vendredi 1er janvier ») départage
   * annee−1 / annee / annee+1 ; sinon, avec une date de référence (semaine affichée, ou aujourd'hui), la date
   * la plus proche de cette référence ; sinon l'année par défaut.
   */
  function resoudreAnnee(jour, mois, annee, nomJour, reference) {
    const cands = [annee, annee + 1, annee - 1].map(a => dateValide(a, mois, jour)).filter(Boolean);
    if (!cands.length) return null;
    if (nomJour) {
      const iJ = JOURS.indexOf(nomJour);
      const ok = cands.find(d => d.getDay() === iJ);
      if (ok) return ok;
    }
    if (reference) return cands.slice().sort((a, b) => Math.abs(a - reference) - Math.abs(b - reference))[0];
    return cands[0];
  }
  /**
   * Dates écrites en français dans un texte : « Vendredi 11 décembre 2026 », « 4 + 5 + 6 février 2027 »,
   * « 4, 5 et 6 février », « 4/5/6 février », « du 4 au 6 février », « mardi 1er et mercredi 2 décembre », « 03/12/2026 ».
   * reference (Date ou ISO, facultative) : sert à deviner l'année quand elle manque.
   */
  function datesDepuisTexte(texte, anneeParDefaut, reference) {
    // texte en minuscules sans accents, mais en gardant , / - + qui séparent les jours d'une liste
    const t = sansAccents(texte).toLowerCase().replace(/[’`´]/g, "'").replace(/\s+/g, ' ');
    const ref = reference ? (reference instanceof Date ? reference : deIso(reference)) : null;
    const res = [];
    const J = '(?:' + RE_NOM_JOUR + '\\.?\\s+)?';
    const N = '\\d{1,2}(?:er)?';
    const SEP = '\\s*(?:\\+|&|,|\\/|-|–|\\bet\\b|\\bau\\b|\\ba\\b)\\s*';
    // le nombre ne doit pas suivre une lettre ou un chiffre (« 8h30 - 1er décembre » ne donne pas le 30)
    const reMois = new RegExp('(^|[^0-9a-z/.])((?:' + J + N + SEP + ')*' + J + N + ')\\s+(' + MOIS.join('|') + ')(?:\\s+(\\d{4}))?', 'g');
    let m;
    while ((m = reMois.exec(t))) {
      const mois = MOIS.indexOf(m[3]) + 1;
      const anneeEcrite = m[4] ? +m[4] : null;
      const annee = anneeEcrite || anneeParDefaut || (ref ? ref.getFullYear() : null);
      if (!annee) continue;
      // lecture de la liste : nombres, séparateurs (une plage pour « au », « à », « - ») et jours de semaine
      const reTok = new RegExp('(' + RE_NOM_JOUR + ')|(\\d{1,2})(?:er)?|(\\+|&|,|\\/|-|–|\\bet\\b|\\bau\\b|\\ba\\b)', 'g');
      let k; let prec = null; let plage = false; let nomJour = null;
      const jours = [];
      while ((k = reTok.exec(m[2]))) {
        if (k[1]) { nomJour = k[1]; continue; }
        if (k[3]) { plage = /^(au|a|-|–)$/.test(k[3]); continue; }
        const j = +k[2];
        if (j < 1 || j > 31) { prec = null; nomJour = null; continue; }
        if (plage && prec != null && j > prec && j - prec <= 31) for (let x = prec + 1; x < j; x++) jours.push({ j: x, nomJour: null });
        jours.push({ j, nomJour });
        prec = j; plage = false; nomJour = null;
      }
      jours.forEach(x => {
        const d = anneeEcrite ? dateValide(anneeEcrite, mois, x.j) : resoudreAnnee(x.j, mois, annee, x.nomJour, ref);
        if (d) res.push(iso(d));
      });
    }
    const reNum = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g;
    while ((m = reNum.exec(String(texte || '')))) {
      const a = +m[3] < 100 ? 2000 + +m[3] : +m[3];
      const d = dateValide(a, +m[2], +m[1]); if (d) res.push(iso(d));
    }
    return Array.from(new Set(res));
  }

  /* ------------------------------------------------------------------ *
   * 1. Référentiel (classeur Excel)
   * ------------------------------------------------------------------ */
  function cellule(r, i) { const v = r && r[i]; return v == null ? '' : (typeof v === 'string' ? v.trim() : v); }
  function estExemple(r) { return (r || []).some(c => /EXEMPLE/i.test(String(c == null ? '' : c))); }
  function trouverEntete(rows, motCle) {
    const i = rows.findIndex(r => (r || []).some(c => norm(c).indexOf(motCle) === 0));
    return i < 0 ? 0 : i;
  }
  /** Délai de commande en heures : « 48 h » / « 48h » → 48 ; « la veille avant 12h » → 24 ; « 1-2j » → 48 ; « 4-7 jours » → 168 ; « 10 jours » → 240. */
  function parseDelai(s) {
    const t = norm(s); if (!t) return null;
    // « la veille avant 12 h » : le nombre est une heure de la journée, pas un délai
    if (/avant veille/.test(t)) return 48;
    if (/\bveille\b/.test(t)) return 24;
    const nums = (t.match(/\d+(?:[.,]\d+)?/g) || []).map(x => parseFloat(x.replace(',', '.')));
    if (!nums.length) return null;
    const n = Math.max.apply(null, nums);
    if (/\d\s*h(?![a-z])|heure/.test(t)) return n; // « 48h » n'a pas de frontière de mot entre 8 et h
    if (/semaine/.test(t)) return n * 168;
    return n * 24; // jours par défaut
  }
  const ABR_JOURS = { lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6, dim: 0 };
  const RE_JOUR_LIVR = '(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|lun|mar|mer|jeu|ven|sam|dim)\\.?';
  /**
   * Jours de livraison : « Mardi et vendredi » → [2,5] ; « Lun-Ven », « du mardi au samedi » → plages ;
   * « tous les jours sauf dimanche » → [1..6] ; « Quand besoin » → null (n'importe quel jour ouvré).
   */
  function parseJours(s) {
    // on garde le tiret : « Lundi-vendredi » est une plage
    const t = sansAccents(s).toLowerCase().replace(/[’`´]/g, "'").replace(/\s+/g, ' ').trim(); if (!t) return null;
    const num = x => ABR_JOURS[x.slice(0, 3)];
    const ens = new Set();
    if (/tous les jours|7\s*j|7 jours sur 7|quotidien/.test(t)) [0, 1, 2, 3, 4, 5, 6].forEach(x => ens.add(x));
    if (/en semaine|jours ouvres/.test(t)) [1, 2, 3, 4, 5].forEach(x => ens.add(x));
    // « sauf le lundi et le mardi » : retirés à la fin
    const sauf = new Set();
    let reste = t.replace(new RegExp('sauf\\s+((?:(?:le|les|et|ou|,)\\s*)*' + RE_JOUR_LIVR + '(?:\\s*(?:,|et|ou)\\s*(?:le\\s+)?' + RE_JOUR_LIVR + ')*)', 'g'), (tout, liste) => {
      (liste.match(new RegExp('\\b' + RE_JOUR_LIVR, 'g')) || []).forEach(x => sauf.add(num(x.replace('.', ''))));
      return ' ';
    });
    // plages « du mardi au samedi », « lun-ven », « lundi à vendredi »
    reste = reste.replace(new RegExp('\\b' + RE_JOUR_LIVR + '\\s*(?:-|–|au|a|jusqu\'au)\\s*' + RE_JOUR_LIVR + '(?![a-z])', 'g'), (tout, a, b) => {
      let x = num(a); const fin = num(b); let garde = 0;
      ens.add(x);
      while (x !== fin && garde++ < 7) { x = (x + 1) % 7; ens.add(x); }
      return ' ';
    });
    (reste.match(new RegExp('\\b' + RE_JOUR_LIVR + '(?![a-z])', 'g')) || []).forEach(x => ens.add(num(x.replace('.', ''))));
    if (sauf.size && !ens.size) [0, 1, 2, 3, 4, 5, 6].forEach(x => ens.add(x));
    sauf.forEach(x => ens.delete(x));
    const j = Array.from(ens).sort((a, b) => a - b);
    return j.length ? j : null;
  }
  /**
   * Conditionnement : « Plateau de 2 kg » → {qte:2000, base:'g'} ; « seau 8kg » → 8000 g ; « Carton de 6 x 1 kg » → 6000 g
   * (nombre: 6) ; « Bidon de 5 litres » → 5000 ml ; « Carton » → null.
   */
  function parseConditionnement(s) {
    const t = String(s || '');
    const m = t.replace(/,/g, '.').match(/(?:(\d+)\s*[x×*]\s*)?(\d+(?:\.\d+)?)\s*(kilogrammes?|kilos?|kg|grammes?|g|litres?|l|cl|ml|pi[eè]ces?|pcs?|bouteilles?|choux|unit[ée]s?)(?![a-zà-ÿ])/i);
    if (!m) return null;
    const u = unite(m[3]);
    const nombre = m[1] ? +m[1] : null;
    const unitaire = parseFloat(m[2]) * u.facteur;
    return { qte: (nombre || 1) * unitaire, base: u.base, famille: u.famille, libelle: t.trim(), nombre, unitaire };
  }

  function parseFournisseurs(rows) {
    const h = trouverEntete(rows, 'fournisseur');
    const parSlug = {};
    rows.slice(h + 1).forEach(r => {
      const nom = String(cellule(r, 0)); if (!nom || estExemple(r)) return;
      const f = {
        nom, livre: String(cellule(r, 1)), contact: String(cellule(r, 2)), jours: String(cellule(r, 3)),
        delai: String(cellule(r, 4)), conditionnement: String(cellule(r, 5)), minimum: String(cellule(r, 6)),
        remarques: String(cellule(r, 7)),
      };
      const k = slug(nom);
      if (!parSlug[k]) parSlug[k] = Object.assign({ slug: k }, f);
      else Object.keys(f).forEach(c => { if (!parSlug[k][c] && f[c]) parSlug[k][c] = f[c]; });
    });
    return Object.values(parSlug).map(f => Object.assign(f, {
      delaiHeures: parseDelai(f.delai), joursLivraison: parseJours(f.jours), conditionnementParse: parseConditionnement(f.conditionnement),
      minimumParse: parseConditionnement(f.minimum),
    }));
  }
  function parseFrequence(s) {
    const t = norm(s);
    if (!t) return '';
    if (/pas souvent|rare|demande/.test(t)) return 'rare';
    if (/^souv/.test(t)) return 'souvent';
    if (/^moy/.test(t)) return 'moyen';
    return t;
  }
  function parseCatalogue(rows) {
    const h = trouverEntete(rows, 'code');
    const out = [];
    const vus = {};
    rows.slice(h + 1).forEach(r => {
      const code = String(cellule(r, 0)).toUpperCase(); const nom = String(cellule(r, 1));
      if (!code || !nom || estExemple(r) || vus[code]) return;
      vus[code] = 1;
      const defaut = norm(cellule(r, 5));
      out.push({
        code, nom, categorie: String(cellule(r, 2)), unite: String(cellule(r, 3)).toLowerCase().trim(),
        frequence: parseFrequence(cellule(r, 4)), defautChef: /^oui/.test(defaut) ? true : (/^non/.test(defaut) ? false : null),
        remarques: String(cellule(r, 6)),
      });
    });
    return out;
  }
  function parseComposants(rows) {
    const h = trouverEntete(rows, 'code');
    const out = [];
    let code = '';
    rows.slice(h + 1).forEach((r, i) => {
      const c = String(cellule(r, 0)).toUpperCase();
      if (c) code = c;
      const ingredient = String(cellule(r, 2));
      if (!ingredient || estExemple(r) || !code) return;
      const brut = cellule(r, 3);
      let q = parseNombre(brut);
      let u = String(cellule(r, 4));
      // « une demi » saisi sur deux colonnes, ou unité absente mais « pièce/pax » dans le libellé
      if (!u && /piece|pax|par personne/.test(norm(ingredient + ' ' + brut))) u = 'pièce';
      const un = unite(u);
      const margeBrute = cellule(r, 6);
      let marge = parseNombre(margeBrute);
      // « 1% » ou « 5 » = un pourcentage ; une marge de 100 % ou plus n'a pas de sens (0,05 saisi en % reste 0,05)
      if (marge != null && (/%/.test(String(margeBrute)) || marge >= 1)) marge = marge / 100;
      out.push({
        ligne: h + 2 + i, code, ingredient: ingredient.replace(/\s+/g, ' ').trim(), qte: q, uniteSaisie: u || '', base: un.base,
        qteBase: q == null ? null : q * un.facteur, fournisseur: String(cellule(r, 5)), marge: marge,
        remarque: String(cellule(r, 7)), aPreciser: q == null || /preciser/.test(norm(cellule(r, 7))),
      });
    });
    return out;
  }
  function parseBar(rows) {
    const h = trouverEntete(rows, 'boisson');
    const out = []; const vus = {};
    rows.slice(h + 1).forEach(r => {
      const nom = String(cellule(r, 0)); if (!nom || estExemple(r) || vus[slug(nom)]) return;
      vus[slug(nom)] = 1;
      out.push({
        nom, categorie: String(cellule(r, 1)), fournisseur: String(cellule(r, 2)), conditionnement: String(cellule(r, 3)),
        verreCl: parseNombre(cellule(r, 4)), verresParBouteille: parseNombre(cellule(r, 5)), remarques: String(cellule(r, 6)),
      });
    });
    return out;
  }
  /** sheets : { Fournisseurs: rows[][], Catalogue: rows[][], Composants: rows[][], Bar: rows[][] } */
  function parseReferentiel(sheets, source) {
    const get = n => {
      const k = Object.keys(sheets).find(x => norm(x) === norm(n));
      return k ? sheets[k] : [];
    };
    return {
      source: source || '', importeLe: null,
      fournisseurs: parseFournisseurs(get('Fournisseurs')),
      catalogue: parseCatalogue(get('Catalogue')),
      composants: parseComposants(get('Composants')),
      bar: parseBar(get('Bar')),
    };
  }

  /* ------------------------------------------------------------------ *
   * Index de travail (référentiel + connaissances + apprentissages)
   * ------------------------------------------------------------------ */
  /**
   * ref : référentiel (Excel) ; con : connaissances (forfaits, choix, achats directs, bar…)
   * app : apprentissages partagés { alias, habitudes, coefficients, fournisseurs (infos web/édits), forfaits (ajouts) }
   */
  function indexer(ref, con, app) {
    app = app || {};
    const catalogue = {}; (ref.catalogue || []).forEach(p => { catalogue[p.code] = p; });
    const composants = {}; (ref.composants || []).forEach(c => { (composants[c.code] = composants[c.code] || []).push(c); });
    const fournisseurs = {};
    (ref.fournisseurs || []).forEach(f => { fournisseurs[f.slug] = Object.assign({}, f); });
    // infos connues hors Excel (recherche web, saisies dans l'appli) : l'Excel garde la priorité sauf champ vide
    const completer = (src, origine) => Object.keys(src || {}).forEach(k => {
      const s = src[k]; const sk = slug(s.nom || k);
      const f = fournisseurs[sk] || (fournisseurs[sk] = { slug: sk, nom: s.nom || k });
      ['livre', 'contact', 'jours', 'delai', 'conditionnement', 'minimum', 'site', 'sitePro', 'modeCommande', 'heureLimite', 'infoDelai'].forEach(c => {
        if (s[c] && (!f[c] || origine === 'app')) f[c] = s[c];
      });
      if (s.prix) f.prix = Object.assign({}, f.prix || {}, s.prix);
      if (s.majLe) f.majLe = s.majLe;
      if (s.source) f.sourceInfos = s.source;
    });
    completer(con && con.fournisseursInfos, 'con');
    completer(app.fournisseurs, 'app');
    Object.values(fournisseurs).forEach(f => {
      f.delaiHeures = parseDelai(f.delai);
      f.joursLivraison = parseJours(f.jours);
      f.conditionnementParse = parseConditionnement(f.conditionnement);
      f.minimumParse = parseConditionnement(f.minimum);
    });
    const bar = {};
    (con && con.barDefauts ? Object.keys(con.barDefauts) : []).forEach(n => { bar[slug(n)] = Object.assign({ nom: n }, con.barDefauts[n], { defaut: true }); });
    (ref.bar || []).forEach(b => {
      const k = slug(b.nom); const d = bar[k] || {};
      bar[k] = Object.assign({}, d, { nom: b.nom, categorie: b.categorie || d.categorie });
      ['fournisseur', 'conditionnement', 'verreCl', 'verresParBouteille'].forEach(c => { if (b[c]) bar[k][c] = b[c]; });
      // le verre (cl) de l'Excel compte : verres/bouteille = contenance / verre, sauf si l'Excel donne directement verres/bouteille
      if (b.verresParBouteille) bar[k].defaut = false;
      else if (b.verreCl) {
        const cond = parseConditionnement(b.conditionnement);
        const contenanceCl = cond && cond.base === 'ml' ? cond.unitaire / 10 : (d.contenanceCl || null);
        if (contenanceCl && contenanceCl >= b.verreCl) {
          bar[k].contenanceCl = contenanceCl;
          bar[k].verresParBouteille = Math.max(1, Math.floor(contenanceCl / b.verreCl + 1e-9));
          bar[k].defaut = false;
        }
      }
    });
    const forfaits = {};
    ((con && con.forfaits) || []).concat(app.forfaits || []).forEach(f => {
      forfaits[f.id] = Object.assign({}, forfaits[f.id] || {}, f);
    });
    return {
      ref, con: con || {}, app, catalogue, composants, fournisseurs, bar, forfaits,
      alias: app.alias || {}, habitudes: app.habitudes || {}, coefficients: app.coefficients || {},
    };
  }
  const MOTS_VIDES_FOURN = new Set(['la', 'le', 'les', 'de', 'du', 'des', 'l', 'd', 'et', 'chez', 'sarl', 'sas', 'ets']);
  /**
   * Fournisseur par nom : correspondance exacte, puis sur des mots entiers (« Beillevaire » → Fromagerie Pascal Beillevaire).
   * « Maison » / « fait maison » = production maison. Un nom qui désigne plusieurs fournisseurs (« Talensac ») reste inconnu
   * plutôt que d'envoyer la commande au premier trouvé.
   */
  function trouverFournisseur(idx, nom) {
    if (!nom) return null;
    const k = slug(nom);
    if (idx.fournisseurs[k]) return idx.fournisseurs[k];
    if (/^(fait-)?maison$|^production-maison$|^fait-maison$/.test(k)) return idx.fournisseurs[MAISON] || null;
    const mots = s => s.split('-').filter(w => w && !MOTS_VIDES_FOURN.has(w));
    const mk = mots(k); if (!mk.length) return null;
    const cands = Object.values(idx.fournisseurs).filter(f => {
      const mf = mots(f.slug); if (!mf.length) return false;
      return mk.every(w => mf.indexOf(w) >= 0) || mf.every(w => mk.indexOf(w) >= 0);
    });
    return cands.length === 1 ? cands[0] : null;
  }

  /* ------------------------------------------------------------------ *
   * 3. Reconnaissance des forfaits dans un libellé
   * ------------------------------------------------------------------ */
  // mot-clé nié (« pas de petits déjeuners ») ou simple contexte (« pendant le déjeuner ») : pas une prestation
  // la négation porte sur le mot-clé qui la suit (au plus un mot entre les deux), dans le même membre de phrase :
  // on coupe à la ponctuation (, ; · ( ) / + et « - » entre espaces), voir normAvecMembres()
  const NEGATIONS = /(?:^|\s)(pas de|pas d|sans|hors|aucun|aucune|non compris|non inclus|ni|pendant le|pendant la|pendant les|lors du|lors de|lors des|avant le|avant la|apres le|apres la|au cours du|durant le|durant la|au moment du|remplace le|remplace la|remplace les|remplacer le|remplacer la|remplacer les|a la place du|a la place de|a la place des|a la place d|en remplacement du|en remplacement de|en remplacement des|au lieu du|au lieu de|au lieu des|au lieu d|servi avec|servis avec|servie avec|servies avec)\s+(?:\S+\s+){0,1}$/;
  /**
   * Texte normalisé (comme norm) + pour chaque position, le début du membre de phrase qui la contient :
   * norm() efface la ponctuation, on la relit sur le texte brut pour ne pas étendre une négation au-delà d'une virgule.
   */
  function normAvecMembres(texte) {
    const marque = sansAccents(texte).toLowerCase()
      .replace(/[’`´]/g, "'").replace(/\\-/g, '-')
      .replace(/\s[-–—]\s|[,;·()\[\]/|\n]/g, ' ¦ ')
      .replace(/[^a-z0-9+%¦]+/g, ' ').replace(/\s+/g, ' ').trim();
    const mots = marque.split(' ').filter(Boolean);
    const sortie = []; const debuts = []; let pos = 0; let debutMembre = 0; let coupe = false;
    mots.forEach(w => {
      if (w === '¦' || w === '+') { coupe = true; if (w === '¦') return; }
      if (sortie.length) pos += 1; // espace
      if (coupe) { debutMembre = pos; coupe = false; }
      sortie.push(w); debuts.push({ pos, debutMembre });
      pos += w.length;
      if (w === '+') coupe = true;
    });
    return { t: sortie.join(' '), debuts };
  }
  /** Clé d'apprentissage d'un libellé : sans chiffres ni dates, pour que « Forfait 04/02 : … » serve aussi le 05/02. */
  function cleAlias(libelle) { return slug(String(libelle || '').replace(/\d+(?:[.,/:h]\d+)*/g, ' n ')).slice(0, 140); }

  const CACHE_MOTIFS = new Map();
  function regexMotif(motif) {
    if (CACHE_MOTIFS.has(motif)) return CACHE_MOTIFS.get(motif);
    let re = null;
    if (/^re:/.test(motif)) { try { re = new RegExp(motif.slice(3), 'g'); } catch (e) { re = null; } }
    else { const k = norm(motif); if (k) re = new RegExp('(?:^|[^a-z0-9])(' + echapperRegex(k) + ')(?=[^a-z0-9]|$)', 'g'); }
    if (CACHE_MOTIFS.size > 5000) CACHE_MOTIFS.clear();
    CACHE_MOTIFS.set(motif, re);
    return re;
  }
  /** Intervalles [a,b) des occurrences d'un motif (mots entiers ; « re:… » = expression régulière) dans t. */
  function occurrences(t, motif) {
    const out = [];
    if (!motif) return out;
    const expr = /^re:/.test(motif);
    const re = regexMotif(motif); if (!re) return out;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) {
      if (expr) out.push([m.index, m.index + m[0].length]);
      else { const a = m.index + m[0].length - m[1].length; out.push([a, a + m[1].length]); }
      if (m[0].length === 0) re.lastIndex++;
    }
    return out;
  }
  function motifPresent(t, motifs) { return (motifs || []).some(x => occurrences(t, x).length > 0); }

  /**
   * Retourne les forfaits présents dans un texte (libellé + détails), le plus spécifique d'abord.
   * Évite : les mots-clés niés (« pas de petits déjeuners »), les correspondances englobées dans une
   * correspondance plus longue (« cocktail sans alcool » ⊃ « cocktail »), et les sous-forfaits déjà inclus
   * dans une formule (journée de travail ⊃ petit-déjeuner + déjeuner + pause).
   */
  function detecterForfaits(texte, idx) {
    const nm = normAvecMembres(texte);
    const t = ' ' + nm.t + ' ';
    const membre = {}; nm.debuts.forEach(d => { membre[d.pos + 1] = d.debutMembre + 1; });
    const alias = idx.alias && idx.alias[cleAlias(texte)];
    if (alias && alias.forfaits && alias.forfaits.length) {
      return alias.forfaits.filter(id => idx.forfaits[id]).map(id => ({ id, via: 'alias', score: 1, debut: 0, fin: t.length }));
    }
    // une ligne qui décrit la salle (« Configuration des espaces · repas assis, nappage blanc ») n'est pas une prestation
    const libelleSeul = norm(String(texte || '').split(' · ')[0]);
    const estConfig = /^(configuration|location|privatisation|grande salle|petite salle|salle|salon|salons|personnel|espace|espaces|terrasse|vestiaire|mise a disposition|frais|droit de bouchon)\b/.test(libelleSeul);
    const trouves = [];
    Object.values(idx.forfaits).forEach(f => {
      // exclusions : n'écartent que les correspondances situées À L'INTÉRIEUR d'une occurrence de l'exclusion
      // (« cocktail » dans « cocktail sans alcool »), pas tout le texte ; exclusionsGlobales : présence n'importe où
      const zones = [];
      (f.exclusions || []).forEach(x => occurrences(t, x).forEach(z => zones.push(z)));
      if (motifPresent(t, f.exclusionsGlobales)) return;
      (f.motsCles || []).forEach(kw => {
        if (!/^re:/.test(kw) && !norm(kw)) return; // « re:… » : mot-clé en expression régulière sur le texte normalisé
        occurrences(t, kw).forEach(([debut, fin]) => {
          // fenêtre de négation : 30 caractères au plus, sans sortir du membre de phrase
          const dm = membre[debut] != null ? membre[debut] : 0;
          if (NEGATIONS.test(t.slice(Math.max(0, debut - 30, dm), debut))) return;
          if (zones.some(([a, b]) => debut >= a && fin <= b)) return;
          trouves.push({ id: f.id, debut, fin, longueur: fin - debut, via: 'mot-clé', motCle: kw });
        });
      });
    });
    if (estConfig) {
      const finLibelle = 1 + libelleSeul.length + 1;
      const alimentaires = trouves.filter(x => x.fin <= finLibelle && idx.forfaits[x.id] && !idx.forfaits[x.id].horsCuisine);
      // « Location + DEJ + 1 verre de vin » garde ses prestations ; « Configuration des espaces … » non
      if (!alimentaires.length || /^configuration|^(grande |petite )?salle|^salons?\b|^espaces?\b|^personnel/.test(libelleSeul)) {
        return idx.forfaits.hors_cuisine ? [{ id: 'hors_cuisine', via: 'mot-clé', score: 0.9, debut: 0, fin: 0 }] : [];
      }
    }
    // supprime les correspondances englobées par une correspondance plus longue d'un autre forfait
    const gardes = trouves.filter(a => !trouves.some(b => b !== a && b.id !== a.id && b.debut <= a.debut && b.fin >= a.fin && b.longueur > a.longueur));
    const parId = {};
    gardes.forEach(g => { if (!parId[g.id] || parId[g.id].longueur < g.longueur) parId[g.id] = g; });
    let ids = Object.keys(parId);
    // un forfait générique cède la place au détail explicite (« forfait boissons (1 verre de vin + 1 boisson chaude) »),
    // sauf quand le détail n'est qu'une liste d'options (« 3 verres parmi crémant, vin… ») : cedeASaufSi
    const bas = ' ' + sansAccents(texte).toLowerCase().replace(/[’`´]/g, "'").replace(/\s+/g, ' ') + ' ';
    // en chaîne (forfait boissons → apéritif → cocktail sans alcool), seul le maillon qui cède à un forfait stable s'efface
    const cede = id => {
      const f = idx.forfaits[id];
      if (f.cedeASaufSi && testeTexte(f.cedeASaufSi, bas)) return [];
      return (f.cedeA || []).filter(x => x !== id && ids.indexOf(x) >= 0);
    };
    for (let tour = 0; tour < 5; tour++) {
      const stables = ids.filter(id => !cede(id).length);
      const retires = ids.filter(id => cede(id).some(x => stables.indexOf(x) >= 0));
      if (!retires.length) break;
      ids = ids.filter(id => retires.indexOf(id) < 0);
    }
    // supprime les sous-forfaits inclus dans une formule présente. On descend seulement par « inclut »
    // (journée ⊃ petit-déjeuner ⊃ jus de pomme) ; « absorbe » ne s'applique qu'au forfait trouvé ou atteint par inclut,
    // sans descendre dans les forfaits absorbés (le cocktail convivial absorbe le cocktail Procé, pas le dîner que celui-ci absorberait).
    // Une absorption peut être conditionnelle : { id, saufSi: [motifs] } ne s'applique pas si l'un des motifs est présent,
    // { id, si: [motifs] } seulement si l'un d'eux l'est.
    const inclus = new Set();
    const visiter = (id, prof) => {
      const f = idx.forfaits[id]; if (!f || prof > 5) return;
      (f.absorbe || []).forEach(a => {
        if (a && typeof a === 'object') { if (!motifPresent(t, a.saufSi) && (!a.si || motifPresent(t, a.si))) inclus.add(a.id); } else inclus.add(a);
      });
      (f.inclut || []).forEach(x => { inclus.add(x); visiter(x, prof + 1); });
    };
    ids.forEach(id => visiter(id, 0));
    ids = ids.filter(id => !inclus.has(id));
    return ids.map(id => Object.assign({ score: Math.min(1, 0.5 + parId[id].longueur / 30) }, parId[id]))
      .sort((a, b) => a.debut - b.debut);
  }

  /* ------------------------------------------------------------------ *
   * 2. Lecture d'un devis ou d'une fiche de fonction
   * ------------------------------------------------------------------ */
  const RE_LIGNE_CHIFFREE = /(?:^|\s)(\d+(?:[.,]\d+)?)\s+(-?\d[\d\s  ]*[.,]\d{2})\s*€\s+(?:(\d+(?:[.,]\d+)?)\s*%\s+)?(-?\d[\d\s  ]*[.,]\d{2})\s*€(?:\s+(\d+(?:[.,]\d+)?)\s*%)?\s*$/;
  const RE_FIN_DEVIS = /^(devis gratuit|detail de la tva|total ht|reglement|bon pour accord|echeance|iban|conditions)/;
  const RE_ENTETE_TABLE = /^(libelle|designation|description)\b.*\b(qte|quantite)\b/;

  function lignesDeTexte(texte) {
    return String(texte || '').replace(/\r/g, '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }
  function convivesDepuisTexte(texte) {
    const t = norm(texte);
    let m = t.match(/(\d+)\s*adultes?\s*(?:\+|et)\s*(\d+)\s*(?:ados?|adolescents?|enfants?)(?:\s*=\s*(\d+))?/);
    if (m) return { convives: m[3] ? +m[3] : +m[1] + +m[2], adultes: +m[1], enfants: +m[2] };
    m = t.match(/nombre\s*(?:(?:de|d)\s*(?:personnes|convives|participants|couverts|invites))?\s*:?\s*(\d+)\s*(?:personnes|pers|adultes|convives|participants|pax|couverts|invites)?/);
    if (m) return { convives: +m[1] };
    m = t.match(/(\d+)\s*(?:personnes|pers\b|convives|participants|pax|couverts?\b|invites?\b)/);
    if (m) return { convives: +m[1] };
    return { convives: null };
  }
  /** Répartition utilisable : valeurs numériques > 0 seulement, somme > 0 ; sinon null. */
  function repartitionValide(rep) {
    if (!rep || typeof rep !== 'object') return null;
    const r = {};
    Object.keys(rep).forEach(k => { const v = +rep[k]; if (isFinite(v) && v > 0) r[k] = v; });
    return Object.keys(r).length ? r : null;
  }
  function repartitionDepuisTexte(texte) {
    const t = norm(texte); const r = {}; let m;
    const re = /(\d+)\s*(viandes?|poissons?|vegetariens?|vegetariennes?|vg|vegans?|vegetaliens?|halal)\b/g;
    while ((m = re.exec(t))) {
      const k = /^v(iande)/.test(m[2]) ? 'viande' : /^poisson/.test(m[2]) ? 'poisson' : /^halal/.test(m[2]) ? 'halal' : 'vegetarien';
      r[k] = (r[k] || 0) + +m[1];
    }
    return Object.keys(r).length ? r : null;
  }
  function horairesDepuisTexte(texte) {
    const m = String(texte || '').match(/horaires?\s*:?\s*([0-9]{1,2}\s*h\s*[0-9]{0,2}\s*(?:-|à|a)\s*[0-9]{1,2}\s*h\s*[0-9]{0,2})/i);
    return m ? m[1].replace(/\s+/g, '') : '';
  }
  function clientDepuisNomFichier(nom) {
    const base = String(nom || '').replace(/\.[a-z0-9]{2,5}$/i, '');
    const parts = base.split(/\s+-\s+/).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const dernier = parts[parts.length - 1];
      if (!/^\d{6}/.test(dernier)) return dernier.replace(/^\d{6}\s*(\+\s*\d{6}\s*)*/, '').trim();
    }
    return '';
  }
  /**
   * Devis ou fiche de fonction ? D'abord les marques de structure (nom de fichier, en-tête de tableau « Libellé … Qté »,
   * titres RESTAURATION / DÉROULÉ), ensuite seulement les indices textuels : une fiche qui cite « devis n° … total TTC »
   * reste une fiche.
   */
  function typeDocument(texte, nomFichier) {
    const t = norm(texte).slice(0, 4000); const n = norm(nomFichier);
    if (/^devis|\bdevis\b/.test(n)) return 'devis';
    const lignes = lignesDeTexte(texte).slice(0, 400);
    const ln = lignes.map(norm);
    if (ln.some(l => RE_ENTETE_TABLE.test(l))) return 'devis';
    const titresFiche = ln.some(l => l.length < 60 && /^(restauration|deroule|configuration des espaces|fiche evenement|fiche de fonction)\b/.test(l));
    if (titresFiche) return 'fiche_fonction';
    if (lignes.some(l => RE_LIGNE_CHIFFREE.test(l))) return 'devis'; // lignes « qté PU € montant € » du logiciel de facturation
    if (/^\d{6}\s/.test(n)) return 'fiche_fonction';
    if (/\bdevis\b.*\bn\b|date d emission|devis valable|total ttc/.test(t)) return 'devis';
    if (/restauration|deroule|configuration des espaces|fiche evenement|bon pour accord/.test(t)) return 'fiche_fonction';
    return 'autre';
  }

  /** Découpe un devis en prestations chiffrées (libellé + sous-puces + quantité + prix). */
  function prestationsDevis(lignes) {
    const items = []; const remarques = [];
    let enTable = false; let fini = false;
    let attente = [];
    const chiffresSeuls = lignes.some(l => RE_LIGNE_CHIFFREE.test(l) && l.replace(RE_LIGNE_CHIFFREE, '').trim() === '');
    const debutTable = lignes.findIndex(l => RE_ENTETE_TABLE.test(norm(l)));
    lignes.forEach((l, i) => {
      const n = norm(l);
      if (fini) return;
      if (debutTable >= 0 && i <= debutTable) { if (i === debutTable) enTable = true; return; }
      if (RE_FIN_DEVIS.test(n)) { fini = true; return; }
      if (debutTable < 0 && !enTable) enTable = true;
      const m = l.match(RE_LIGNE_CHIFFREE);
      const puce = /^(\\?[-•*–])\s*/.test(l);
      const propre = l.replace(/^(\\?[-•*–])\s*/, '');
      if (m) {
        const libelleLigne = l.slice(0, m.index + (m[0].startsWith(' ') ? 1 : 0)).trim();
        const blocs = attente.slice(); attente = [];
        const libelle = libelleLigne || (blocs.length ? blocs.shift() : '');
        items.push({
          libelle: libelle.replace(/^(\\?[-•*–])\s*/, ''), details: blocs.map(x => x.replace(/^(\\?[-•*–])\s*/, '')),
          quantite: parseMontant(m[1]), prixUnitaire: parseMontant(m[2]), remise: m[3] ? parseMontant(m[3]) : 0, montant: parseMontant(m[4]),
        });
        return;
      }
      const commentaire = /\d{1,2}\s*h\s*\d{0,2}\s*(?::|-|à|\/)|\/\/|\bfin\b|\barrivee\b|\bpaiement\b|\breglement\b|en dessous de/.test(n);
      if (!chiffresSeuls && puce && items.length && !commentaire) { items[items.length - 1].details.push(propre); return; }
      // prix en fin de ligne : une ligne qui commence par « ( » ou une minuscule continue le libellé précédent,
      // elle ne décrit pas la prestation suivante
      if (!chiffresSeuls && items.length && !commentaire && /^[(a-zà-ÿ]/.test(propre)) { items[items.length - 1].details.push(propre); return; }
      if (puce && commentaire) { remarques.push(propre); return; }
      attente.push(l);
    });
    attente.forEach(x => remarques.push(x.replace(/^(\\?[-•*–])\s*/, '')));
    return { items, remarques };
  }

  // ligne qui écarte des pièces (« Pas de nem de cochon ni de poulet croustillant », « Allergie : crevettes »)
  const RE_LIGNE_NEGATIVE = /^(pas de|pas d|sans|aucun|aucune|ni|hors(?! d oeuvre)|eviter|allergi|intoleran)/;
  const RE_TITRES_HORS_RESTO = /^(deroule|configuration|budget|horaires?|contacts?|evenement|nombre|infos?|informations|logistique|materiel|facturation|reglement|tarifs?|divers|technique|planning|deco|decoration)\b/;
  /** Titre court en majuscules (« MENU », « INFOS PRATIQUES ») : il change de section. */
  function estTitre(l) {
    const s = String(l || '').trim().replace(/\s*:$/, '');
    return s.length >= 3 && s.length <= 30 && !/\d/.test(s) && /[A-Z]{3}/.test(sansAccents(s)) && s === s.toUpperCase();
  }
  /** Découpe une fiche de fonction (FF) : lignes « 15 cocktails… », « 31 menus du mois… » dans RESTAURATION / BOISSONS. */
  function prestationsFiche(lignes, idx) {
    const items = []; const remarques = []; let section = ''; let nouvelleSection = false;
    const nouvelItem = (l, quantite) => {
      const it = { libelle: l, details: [], quantite };
      const codes = RE_LIGNE_NEGATIVE.test(norm(l)) ? [] : codesCatalogueDepuisTexte(l, idx);
      if (codes.length) it.choisis = codes.map(code => ({ code, texte: l }));
      items.push(it); nouvelleSection = false;
      return it;
    };
    lignes.forEach(l => {
      const n = norm(l);
      if (/^(restauration|boissons?|restauration et boissons|restauration & boissons)\b/.test(n) && n.length < 40) { section = 'resto'; nouvelleSection = true; return; }
      if (/^(deroule|configuration|budget|horaires|contact|evenement|nombre)\b/.test(n)) { section = n.split(' ')[0]; nouvelleSection = true; if (section !== 'deroule') return; }
      else if (estTitre(l)) {
        // un titre court en majuscules fait sortir du déroulé (« MENU » puis « 60 menus du mois ») ;
        // dans la restauration, un sous-titre (« SALÉ », « FROMAGES ») y reste, sauf titre clairement hors cuisine
        const resto = /menu|repas|cocktail|buffet|brunch|dejeuner|diner|pause|boisson|bar\b|dessert|aperitif|apero|restauration|traiteur|fromage|planche|vin\b|vins\b/.test(n);
        if (resto) section = 'resto';
        else if (section !== 'resto' || RE_TITRES_HORS_RESTO.test(n)) section = 'autre';
        nouvelleSection = true;
        return;
      }
      const sous = n.match(/^(\d+(?:[.,]\d+)?)\s+(pieces?|verrines?|bouchees?)\b/);
      if (sous && items.length && section !== 'deroule') {
        const dernier = items[items.length - 1];
        dernier.details.push(l);
        const nb = parseFloat(sous[1].replace(',', '.'));
        // qualificatif placé juste après « pièces » (« 12 pièces salées froides », « 6 pièces salées/sucrées »)
        const q = n.match(/^\S+\s+(?:pieces?|verrines?|bouchees?)\s*(\S+)?\s*(\S+)?/) || [];
        const est = (w, re) => !!w && re.test(w);
        const sale = est(q[1], /^salees?$/);
        const sucre = est(q[1], /^sucrees?$/) || (sale && est(q[2], /^sucrees?$/));
        const froidChaud = est(q[1], /^(froides?|chaudes?)$/) || (sale && est(q[2], /^(froides?|chaudes?)$/));
        if (sucre && !sale) return; // « 4 pièces sucrées » : lu par le contenu « mignardises » du forfait
        if (froidChaud) {
          // « 8 pièces froides » puis « 4 pièces chaudes » : elles s'additionnent
          dernier.cumulFroidChaud = (dernier.cumulFroidChaud || 0) + nb;
          dernier.nbParConvive = dernier.cumulFroidChaud; dernier.nbTotal = false;
        } else if (sale && !sucre) {
          dernier.nbParConvive = nb; dernier.nbTotal = false; dernier.cumulFroidChaud = 0;
        } else if (!dernier.nbParConvive || dernier.nbTotal) {
          // « 15 pièces par personne (dont 4 mignardises) » : total salé + sucré (Cocktail Procé = 15 = 11 salées + 4 sucrées) ;
          // les sucrées sont retirées au développement
          dernier.nbParConvive = nb; dernier.nbTotal = true;
        }
        return;
      }
      // toute ligne qui commence par une quantité est une prestation (« 6 Kirs pétillants x 6€ », « 3 AOC Côtes du Rhône… »),
      // sauf les mentions de régime ou de répartition (« 2 végétariens », « 21 viandes + 7 poissons ») qui complètent la ligne précédente
      const m = n.match(/^(\d+|x)\s+([a-z][a-z' ]*)/);
      const regime = m && /^(vegetarien|vegan|vegetalien|allergi|sans |enfant|bebe|personne|viande|poisson|halal|vg\b)/.test(m[2]);
      if (m && !regime && section !== 'deroule' && (section === 'resto' || /^(forfaits?|menus?|cocktails?|pdj|petits? dejeuners?|pauses?|brunchs?|plateaux?|planches?|mises? en bouche|portions?|verres?|bouteilles?|coupes?|gateaux?|pieces? montees?|repas|dejeuners?|diners?)\b/.test(m[2]))) {
        nouvelItem(l, m[1] === 'x' ? null : +m[1]);
        return;
      }
      if (section === 'resto') {
        const dernier = items[items.length - 1];
        if (RE_LIGNE_NEGATIVE.test(n)) {
          // « Pas de nem de cochon… » : ces pièces sont retirées des propositions, jamais comptées comme choisies
          if (dernier) {
            codesCatalogueDepuisTexte(l, idx, true).forEach(code => { (dernier.exclus = dernier.exclus || []).push(code); });
            dernier.details.push(l);
          }
          remarques.push(l);
          return;
        }
        // ligne sans quantité : nouvelle prestation (convives du jour) si rien n'est encore ouvert, ou en tête d'une nouvelle
        // section quand elle déclenche une formule (« BOISSONS / Forfait boissons 3 verres »)
        const formule = () => detecterForfaits(l, idx).some(x => idx.forfaits[x.id] && !idx.forfaits[x.id].horsCuisine);
        if (!dernier || (nouvelleSection && formule())) {
          if (!dernier && !formule() && /allerg|vegetarien|vegan|sans gluten|halal|regime/.test(n)) { remarques.push(l); return; }
          nouvelItem(l, null);
          return;
        }
        // pièce(s) explicitement choisie(s) ?
        codesCatalogueDepuisTexte(l, idx).forEach(code => (dernier.choisis = dernier.choisis || []).push({ code, texte: l }));
        dernier.details.push(l);
        return;
      }
      if (section === 'deroule' || /allerg|vegetarien|vegan|sans gluten|halal|regime/.test(n)) remarques.push(l);
    });
    return { items, remarques };
  }

  const MOTS_VIDES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'a', 'au', 'aux', 'd', 'l', '&', 'sauce', 'maison', 'mini']);
  // premiers mots trop généraux pour désigner une pièce à eux seuls (« 15 pièces », « assortiment de fromages »)
  const MOTS_GENERIQUES = new Set(['piece', 'assortiment', 'plateau', 'planche', 'verrine', 'toast', 'menu', 'puree', 'legume', 'poisson', 'poulet', 'volaille', 'tartare', 'tataki', 'veloute', 'croque', 'grand', 'portion', 'navette', 'brochette']);
  // mots significatifs, au singulier (« crevettes » = « crevette »)
  function jetons(s) { return norm(s).split(' ').filter(w => w.length > 1 && !MOTS_VIDES.has(w)).map(w => (w.length > 3 ? w.replace(/[sx]$/, '') : w)); }
  function premiersMots(idx) {
    if (idx._premiersMots) return idx._premiersMots;
    const c = {}; Object.values(idx.catalogue).forEach(p => { const w = jetons(p.nom)[0]; if (w) c[w] = (c[w] || 0) + 1; });
    Object.defineProperty(idx, '_premiersMots', { value: c, enumerable: false, configurable: true });
    return c;
  }
  /**
   * Retrouve une pièce du catalogue citée dans une ligne (« Crevette croustillante & sauce aigre-douce » → P001).
   * Accepte aussi la tête du nom : « Nem de cochon », « Souris d'agneau », ou un premier mot propre à une seule pièce (« Arancini »).
   */
  function codeCatalogueDepuisTexte(texte, idx) {
    const tj = new Set(jetons(texte)); if (tj.size === 0) return null;
    const premiers = premiersMots(idx);
    let meilleur = null; let score = 0;
    Object.values(idx.catalogue).forEach(p => {
      const pj = jetons(p.nom); if (!pj.length) return;
      const communs = pj.filter(w => tj.has(w)).length;
      let s = communs / pj.length;
      if (communs >= 2 && s >= 0.6) { /* correspondance large */ }
      else if (pj.length === 1 && communs === 1) s = s * 0.9;
      else if (pj.length >= 2 && tj.has(pj[0]) && tj.has(pj[1])) s = 0.6 + s / 10;
      else if (pj[0].length >= 6 && !MOTS_GENERIQUES.has(pj[0]) && premiers[pj[0]] === 1 && tj.has(pj[0])) s = 0.6 + s / 10;
      else return;
      if (s > score) { score = s; meilleur = p.code; }
    });
    return score >= 0.6 ? meilleur : null;
  }
  /**
   * Plusieurs pièces dans une ligne : « Plat : 21 viandes (Suprême de volaille) + 7 poissons (Poisson de la criée) »,
   * « Pas de nem de cochon ni de poulet croustillant ». Découpe par segments quand la ligne est une liste.
   */
  function codesCatalogueDepuisTexte(texte, idx, segmenter) {
    const codes = [];
    const ajouter = c => { if (c && codes.indexOf(c) < 0) codes.push(c); };
    const liste = segmenter || /\d+\s*(?:viandes?|poissons?|vegetarien|vg\b|vegan|halal)/.test(norm(texte));
    if (liste) String(texte || '').split(/[+;,|/]|\s(?:ni|ou|et)\s/i).forEach(seg => ajouter(codeCatalogueDepuisTexte(seg, idx)));
    if (!codes.length) ajouter(codeCatalogueDepuisTexte(texte, idx));
    return codes;
  }

  /**
   * Lit un document (texte brut extrait d'un PDF, d'un Word ou du Drive) et retourne une « fiche » :
   * { id, nomFichier, type, client, horaires, convives, dates[], jours:[{date, convives, prestations:[…]}], regimes, remarques[], lecture:'locale' }
   */
  function lireDocument(texte, nomFichier, idx, options) {
    options = options || {};
    const lignes = lignesDeTexte(texte);
    const type = typeDocument(texte, nomFichier);
    let dates = datesDepuisCodes(nomFichier);
    const anneeRef = dates.length ? +dates[0].slice(0, 4) : (options.annee || new Date().getFullYear());
    // date de référence pour une année absente (« Vendredi 1er janvier ») : options.reference (semaine affichée) si l'appli
    // la donne, sinon la date du nom de fichier, sinon aujourd'hui quand l'année demandée est proche
    let reference = options.reference ? (options.reference instanceof Date ? options.reference : deIso(options.reference)) : (dates.length ? deIso(dates[0]) : null);
    if (!reference) { const auj = new Date(); if (Math.abs(auj.getFullYear() - anneeRef) <= 1) reference = auj; }
    const enTete = lignes.slice(0, 30).join('\n');
    // dates administratives du devis (émission, validité, échéance) : jamais la date de l'événement
    const RE_DATE_ADMIN = /emission|validite|valable|echeance|edite le|edition|etabli le|date du devis|devis du|signature|bon pour accord/;
    const mEm = sansAccents(enTete).match(/(?:emission|date du devis|devis du|etabli le|edite le)[^0-9a-z]*([^\n]{0,40})/i);
    const emission = mEm ? (datesDepuisTexte(mEm[1], anneeRef, reference)[0] || null) : null;
    if (!dates.length) {
      // « Date : … » avec les deux-points juste après le mot : écarte « Date d'émission : », « Date de validité : »
      const reDate = /\bdates?\s*:\s*([^\n]*)/gi; let md; let trouve = null;
      while ((md = reDate.exec(enTete))) {
        const avant = norm(enTete.slice(Math.max(0, md.index - 25), md.index));
        if (!RE_DATE_ADMIN.test(avant)) { trouve = md[1]; break; }
      }
      dates = trouve ? datesDepuisTexte(trouve, anneeRef, reference) : [];
      if (!dates.length) dates = datesDepuisTexte(lignes.filter(l => !RE_DATE_ADMIN.test(norm(l))).join('\n').slice(0, 3000), anneeRef, reference).slice(0, 4);
      if (emission) dates = dates.filter(d => d >= emission);
    }
    const conv = convivesDepuisTexte(enTete) ;
    const conv2 = conv.convives ? conv : convivesDepuisTexte(lignes.join('\n'));
    const client = clientDepuisNomFichier(nomFichier) || (lignes[0] || '').slice(0, 60);
    const evenement = ((enTete.match(/[ée]v[ée]nement\s*:?\s*([^\n]*?)(?:\s+nombre\s*:|\s+contact\s*:|\s+dates?\s*:|$)/i) || [])[1] || '').trim();
    const { items, remarques } = type === 'fiche_fonction' ? prestationsFiche(lignes, idx) : prestationsDevis(lignes);
    const regimes = [];
    lignes.forEach(l => { if (/allerg|v[ée]g[ée]tarien|vegan|sans gluten|sans lactose|halal|r[ée]gime/i.test(l) && l.length < 200) regimes.push(l); });

    const fiche = {
      id: 'f-' + slug(nomFichier || client).slice(0, 40) + '-' + (dates[0] || 'sd'),
      nomFichier: nomFichier || '', type, client, evenement, horaires: horairesDepuisTexte(enTete),
      convives: conv2.convives, adultes: conv2.adultes || null, enfants: conv2.enfants || null,
      dates, regimes: Array.from(new Set(regimes)).slice(0, 6), remarques: remarques.slice(0, 12), lecture: 'locale',
      jours: [],
    };
    const prestations = items.map((it, i) => {
      const texteComplet = [it.libelle].concat(it.details || []).join(' · ');
      const dateLigne = (it.libelle.slice(0, 40).match(/(?:^|\s)(\d{2})\/(\d{2})(?!\/)(?=\s|:|$)/) || []);
      let date = null;
      if (dateLigne.length) {
        const cand = dates.find(d => d.slice(8, 10) === dateLigne[1] && d.slice(5, 7) === dateLigne[2]);
        date = cand || (dateValide(anneeRef, +dateLigne[2], +dateLigne[1]) ? iso(dateValide(anneeRef, +dateLigne[2], +dateLigne[1])) : null);
      }
      if (!date && dates.length > 1) {
        // « Déjeuner du jeudi 4 février » : date écrite en toutes lettres, si elle désigne un seul jour de l'événement
        const dl = datesDepuisTexte(it.libelle, anneeRef, reference).filter(d => dates.indexOf(d) >= 0);
        if (dl.length === 1) date = dl[0];
        else if (!dl.length) {
          // « Déjeuner du jeudi » : un seul jour de l'événement tombe ce jour-là
          const noms = Array.from(new Set(norm(it.libelle).match(/\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/g) || []));
          if (noms.length === 1) { const ds = dates.filter(d => JOURS[deIso(d).getDay()] === noms[0]); if (ds.length === 1) date = ds[0]; }
        }
      }
      const det = detecterForfaits(texteComplet, idx);
      const pu = it.prixUnitaire != null ? it.prixUnitaire : parseMontant((it.libelle.match(/\bx\s*(\d+(?:[.,]\d+)?)\s*€/i) || [])[1]);
      return {
        id: 'p' + i, libelle: it.libelle, details: it.details || [], quantite: it.quantite, montant: it.montant || null,
        prixUnitaire: pu != null ? pu : null,
        date, forfaits: det.map(d => d.id), confiance: det.length ? Math.max.apply(null, det.map(d => d.score)) : 0,
        via: det.length ? det[0].via : null, choisis: it.choisis || [], exclus: it.exclus || [], repartition: repartitionDepuisTexte(texteComplet),
        nbParConvive: it.nbParConvive || null, nbTotal: !!it.nbTotal,
        horsCuisine: det.length > 0 && det.every(d => idx.forfaits[d.id] && idx.forfaits[d.id].horsCuisine),
      };
    });
    // une prestation datée hors des dates de l'en-tête (« Forfait 05/02 » avec un seul code 040227) ajoute son jour
    const extra = prestations.filter(p => p.date && dates.indexOf(p.date) < 0 && !p.horsCuisine).map(p => p.date);
    if (extra.length) {
      dates = Array.from(new Set(dates.concat(extra))).sort();
      fiche.dates = dates;
      fiche.remarques.unshift('⚠ Prestation datée hors des dates de l’en-tête : jour(s) ajouté(s) ' + Array.from(new Set(extra)).map(jourCourt).join(', ') + '.');
    }
    const joursListe = dates.length ? dates : [null];
    joursListe.forEach(d => {
      const ps = prestations.filter(p => !p.date || p.date === d || !d).map(p => Object.assign({}, p, {
        appliqueATousLesJours: !p.date && joursListe.length > 1,
      }));
      // convivesLus : l'effectif lu dans le document, gardé quand le chef corrige les convives du jour (convivesForces)
      fiche.jours.push({ date: d, convives: fiche.convives, convivesLus: fiche.convives, prestations: ps });
    });
    // sans effectif lisible, une formule « par personne » vendue à l'unité (« Forfait mariage 1,00 ») ne commanderait rien
    if (!fiche.convives && prestations.some(p => !p.horsCuisine && p.forfaits.length && !(p.quantite >= 2) && p.forfaits.some(id => idx.forfaits[id] && !idx.forfaits[id].parUnite))) {
      fiche.remarques.unshift('⚠ Nombre de convives introuvable : saisissez-le pour le jour, sinon rien n’est commandé pour ces formules.');
    }
    return fiche;
  }

  /** Normalise la réponse JSON de Claude (même forme que lireDocument) en restant tolérant. */
  function normaliserLectureClaude(rep, base, idx) {
    if (!rep || typeof rep !== 'object') return base;
    const fiche = Object.assign({}, base, { lecture: 'claude' });
    if (rep.type_document) fiche.type = rep.type_document;
    if (rep.client) fiche.client = String(rep.client).slice(0, 80);
    if (rep.evenement) fiche.evenement = String(rep.evenement).slice(0, 120);
    if (rep.horaires) fiche.horaires = String(rep.horaires).slice(0, 40);
    if (Array.isArray(rep.regimes)) fiche.regimes = rep.regimes.map(String).slice(0, 8);
    else if (rep.regimes) fiche.regimes = [String(rep.regimes)];
    if (Array.isArray(rep.points_attention)) fiche.remarques = rep.points_attention.map(String).slice(0, 10);
    const jours = Array.isArray(rep.jours) ? rep.jours : [];
    if (jours.length) {
      fiche.jours = jours.filter(j => deIso(j.date)).map((j, ji) => ({
        date: iso(deIso(j.date)),
        convives: +j.convives > 0 ? Math.round(+j.convives) : base.convives,
        convivesLus: +j.convives > 0 ? Math.round(+j.convives) : base.convives,
        prestations: (Array.isArray(j.prestations) ? j.prestations : []).map((p, i) => {
          const ids = (Array.isArray(p.forfaits) ? p.forfaits : [p.forfait]).filter(x => x && idx.forfaits[x]);
          return {
            id: 'c' + ji + '-' + i, libelle: String(p.libelle || '').slice(0, 300), details: p.details ? [String(p.details).slice(0, 400)] : [],
            quantite: +p.quantite > 0 ? +p.quantite : null, date: iso(deIso(j.date)), forfaits: ids,
            confiance: typeof p.confiance === 'number' ? p.confiance : (ids.length ? 0.8 : 0), via: 'claude',
            choisis: (Array.isArray(p.choix) ? p.choix : []).filter(c => c && idx.catalogue[c.code]).map(c => ({ code: c.code, parConvive: +c.nombre_par_convive || null })),
            // le gabarit du prompt contient {viande:0,poisson:0,vegetarien:0} : une répartition nulle n'en est pas une
            repartition: repartitionValide(p.repartition),
            nbParConvive: +p.nombre_par_convive > 0 ? +p.nombre_par_convive : null,
            horsCuisine: ids.length > 0 && ids.every(id => idx.forfaits[id].horsCuisine),
          };
        }),
      }));
      fiche.dates = fiche.jours.map(j => j.date);
      const c = fiche.jours.map(j => j.convives).filter(Boolean);
      if (c.length) fiche.convives = Math.max.apply(null, c);
    }
    return fiche;
  }

  /* ------------------------------------------------------------------ *
   * 4. Menu du chef : postes et propositions
   * ------------------------------------------------------------------ */
  function moisDe(dateIso) { const d = deIso(dateIso); return d ? d.getMonth() + 1 : null; }
  function enSaison(p, choix, dateIso) {
    const m = moisDe(dateIso); if (!m || !choix || !choix.saison) return true;
    const mois = choix.saison[p.categorie]; return !mois || mois.indexOf(m) >= 0;
  }
  function piocheDe(choix, idx, dateIso) {
    let codes = choix.codes ? choix.codes.slice() : Object.values(idx.catalogue)
      .filter(p => (choix.categories || []).some(c => norm(p.categorie) === norm(c)))
      .map(p => p.code);
    codes = codes.filter(c => idx.catalogue[c] && (choix.exclure || []).indexOf(c) < 0 && enSaison(idx.catalogue[c], choix, dateIso));
    return codes;
  }
  /** Score d'une pièce pour la proposition du chef : sélection par défaut, fréquence, habitudes apprises, fiche technique renseignée. */
  function scorePiece(code, idx, familleChoix) {
    const p = idx.catalogue[code]; if (!p) return -99;
    let s = 0;
    if (p.defautChef === true) s += 3; else if (p.defautChef === false) s -= 1;
    if (p.frequence === 'souvent') s += 2; else if (p.frequence === 'moyen') s += 1; else if (p.frequence === 'rare') s -= 2;
    if ((idx.composants[code] || []).length || (idx.con.achatsDirects || {})[code]) s += 1.5;
    const h = (idx.habitudes[familleChoix] || {})[code] || (idx.habitudes.tout || {})[code] || 0;
    s += 2.5 * Math.log(1 + h);
    const stats = (idx.con.statsChoix || {})[code];
    if (stats) s += Math.min(2, Math.log(1 + stats));
    return s;
  }
  function sousFamille(p) { const m = norm(p.categorie).match(/(mer|ferme|jardin|estivale)/); return m ? m[1] : norm(p.categorie); }
  /** Choisit nbRecettes pièces variées (mer / ferme / jardin), au moins une végétarienne quand c'est possible. */
  function proposer(pioche, nbRecettes, idx, familleChoix, decalage) {
    const tri = pioche.slice().sort((a, b) => scorePiece(b, idx, familleChoix) - scorePiece(a, idx, familleChoix) || a.localeCompare(b));
    // « autre proposition » : fait tourner la liste en gardant les meilleures en tête de file
    if (decalage) { const k = decalage % Math.max(1, tri.length); tri.push.apply(tri, tri.splice(0, k)); }
    const pris = []; const parSF = {};
    const maxParSF = Math.max(1, Math.ceil(nbRecettes / 3) + (nbRecettes > 6 ? 1 : 0));
    const sfs = new Set(tri.map(c => sousFamille(idx.catalogue[c])));
    if (nbRecettes >= 3 && sfs.has('jardin')) {
      const vg = tri.find(c => sousFamille(idx.catalogue[c]) === 'jardin');
      if (vg) { pris.push(vg); parSF.jardin = 1; }
    }
    tri.forEach(c => {
      if (pris.length >= nbRecettes || pris.indexOf(c) >= 0) return;
      const sf = sousFamille(idx.catalogue[c]);
      if ((parSF[sf] || 0) >= maxParSF && sfs.size > 1) return;
      pris.push(c); parSF[sf] = (parSF[sf] || 0) + 1;
    });
    tri.forEach(c => { if (pris.length < nbRecettes && pris.indexOf(c) < 0) pris.push(c); });
    return pris;
  }
  /** Répartit N pièces par convive entre les recettes : 11 pièces / 8 recettes → 2,2,2,1,1,1,1,1. */
  function repartir(totalParConvive, codes) {
    const r = {}; if (!codes.length) return r;
    const base = Math.floor(totalParConvive / codes.length);
    let reste = Math.round((totalParConvive - base * codes.length) * 2) / 2;
    codes.forEach(c => { r[c] = base; });
    let i = 0;
    while (reste > 0 && i < 100) { const pas = reste >= 1 ? 1 : 0.5; r[codes[i % codes.length]] += pas; reste -= pas; i++; }
    Object.keys(r).forEach(c => { if (!r[c]) delete r[c]; });
    return r;
  }
  /**
   * Nombre « par personne » lu dans le texte (« 4 mises en bouche », « 2 verres de vin », « 11 pièces salées »).
   * Ignore le nombre placé en tête d'une ligne de fiche quand c'est la quantité de la ligne (« 30 mises en bouche » =
   * 30 convives, pas 30 pièces chacun) et les valeurs au-delà de max ; à défaut, la valeur par défaut du forfait.
   */
  function nbParPersonne(texte, motif, defaut, p, max) {
    const t = norm(texte);
    const re = new RegExp('(\\d+)\\s*(?:' + motif + ')', 'g');
    let m;
    while ((m = re.exec(t))) {
      if (m.index > 0 && /[0-9]/.test(t[m.index - 1])) continue;
      const n = +m[1];
      if (m.index === 0 && p && p.quantite != null && n === +p.quantite) continue;
      if (!(n > 0) || (max && n > max)) continue;
      return n;
    }
    return defaut;
  }
  /**
   * Bouteilles comptées à l'unité (forfait parUnite) : « 29 bouteilles de champagne » → 29 ;
   * « 1/2 bouteille par personne » × 30 → 15 ; ligne de devis → sa quantité (en verres si le prix unitaire est celui d'un verre).
   */
  function quantiteParUnite(p, jour) {
    const lib = norm(p.libelle);
    let m = lib.match(/^(\d+)\s*(?:bouteilles?|btl|blles?|magnums?|x)\b/);
    if (m) return +m[1];
    const bas = sansAccents([p.libelle].concat(p.details || []).join(' · ')).toLowerCase();
    m = bas.match(/(\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?|une demie?|demie?|une)[\s-]*(?:bouteilles?|btl)\s*(?:de [a-z' ]{0,30}?)?\s*(?:par|pour)\s*(\d+)?\s*(?:personnes?|pers\b|convives?|invites?)/);
    if (m) {
      const ratio = parseNombre(m[1]) / (m[2] ? +m[2] : 1);
      const gens = p.quantite >= 2 ? p.quantite : (jour.convives || 0);
      if (ratio > 0 && gens) return ratio * gens;
    }
    if (p.quantite) {
      // devis : 30 × 4,50 € = 30 verres, pas 30 bouteilles (6 verres par bouteille)
      if (p.prixUnitaire != null && p.prixUnitaire > 0 && p.prixUnitaire < 10 && !/bouteille|btl|magnum/.test(bas)) return p.quantite / 6;
      return p.quantite;
    }
    m = lib.match(/^(\d+)\s/);
    return m ? +m[1] : 1;
  }
  /** Convives effectifs d'une prestation : quantité du devis si c'est un forfait par personne, sinon convives du jour. */
  function convivesPrestation(p, jour, forfait, fiche) {
    if (p.quantiteForcee) return p.quantiteForcee;
    if (forfait && forfait.parUnite) return quantiteParUnite(p, jour); // « 29 bouteilles de champagne », pas les convives
    const lus = jour.convivesLus != null ? jour.convivesLus : (fiche && fiche.convives != null ? fiche.convives : null);
    const nbJours = fiche && Array.isArray(fiche.jours) ? fiche.jours.length : 1;
    let q = p.quantite;
    // ligne non datée d'un devis sur plusieurs jours (« Pause café (10 pers. x 3 jours) » = 30) : la quantité couvre tous
    // les jours quand le libellé le dit (« x 3 jours ») ou qu'elle vaut l'effectif × le nombre de jours ; sinon elle vaut
    // pour chaque jour (prudent : on commande trop plutôt que pas assez)
    if (q && p.appliqueATousLesJours && nbJours > 1 && lus && q >= 1.5 * lus) {
      const parJour = q / nbJours;
      const ditJours = /\b\d+\s*jours?\b/.test(norm(p.libelle));
      if (ditJours || (Math.abs(parJour - Math.round(parJour)) < 1e-9 && Math.abs(parJour - lus) <= 0.2 * lus)) q = Math.ceil(parJour - 1e-9);
    }
    if (jour.convivesForces && jour.convives) {
      // effectif corrigé par le chef : les lignes qui suivaient l'effectif lu prennent la nouvelle valeur, les autres
      // (« Menu enfant 5 », « Forfait sans alcool 10 ») sont mises à l'échelle
      if (forfait && forfait.parPersonne !== false && q && q >= 2 && lus && Math.round(q) !== lus) return Math.max(1, Math.round(q * jour.convives / lus));
      return jour.convives;
    }
    if (forfait && forfait.parPersonne !== false && q && q >= 2) return Math.round(q);
    return jour.convives || (q >= 2 ? Math.round(q) : 0);
  }
  function testeTexte(motif, bas) { try { return new RegExp(motif).test(bas); } catch (e) { return false; } }

  /**
   * Développe les prestations d'un jour en postes de production :
   *  - poste « fixe »  : {ref:{code|bar|achat|boisson}, parConvive, convives}
   *  - poste « choix » : {famille, pioche, parConvive, recettes:{code: nbParConvive}, explicite}
   */
  function developperJour(fiche, jour, idx, etat) {
    etat = etat || {};
    const postes = [];
    // une formule peut en remplacer une autre incluse dans la même ligne : « Forfait journée … cocktail déjeunatoire debout »
    // = le cocktail tient lieu de déjeuner assis (remplaceInclus : [{ id, si: [motifs] }])
    const remplacesDe = (p, texte) => {
      const t = ' ' + norm(texte) + ' '; const r = new Set();
      (p.forfaits || []).forEach(id => ((idx.forfaits[id] || {}).remplaceInclus || []).forEach(x => {
        if (typeof x === 'string') r.add(x); else if (x && (!x.si || motifPresent(t, x.si))) r.add(x.id);
      }));
      return r;
    };
    const ajouterContenu = (forfait, p, convives, texte, profondeur, origine, remplaces) => {
      if (!forfait || profondeur > 4) return;
      remplaces = remplaces || remplacesDe(p, texte);
      if (forfait.inclut) forfait.inclut.forEach(id => { if (!remplaces.has(id)) ajouterContenu(idx.forfaits[id], p, convives, texte, profondeur + 1, origine, remplaces); });
      const bas = sansAccents(texte).toLowerCase().replace(/[’`´]/g, "'");
      // valeur par défaut selon le contexte (« journée de travail » : cocktail déjeunatoire à 3 sucrées), puis nombre lu dans le texte
      const defautSelon = c => (c.qteSelonTexte || []).reduce((q, r) => (r && testeTexte(r.si, bas) ? r.qte : q), c.qte);
      const lireQte = c => (c.qteDepuisTexte ? nbParPersonne(texte, c.qteDepuisTexte, defautSelon(c), p, c.qteMax) : defautSelon(c));
      (forfait.contenu || []).forEach((c, ci) => {
        // variantes : « 3 verres parmi crémant, vin, bière, sans alcool » = 3 boissons en tout, pas 3 + 1
        if (c.siTexte && !testeTexte(c.siTexte, bas)) return;
        if (c.saufSiTexte && testeTexte(c.saufSiTexte, bas)) return;
        let parConvive = lireQte(c);
        // « 11 pièces salées » lu sur la fiche : seulement pour les pièces salées (jamais le plat d'un menu)
        if (p.nbParConvive && c.choix === 'salees_cocktail' && c.principal) {
          parConvive = p.nbParConvive;
          if (p.nbTotal) {
            // « 15 pièces par personne (dont 4 mignardises) » : le total comprend les sucrées du forfait
            const sucrees = (forfait.contenu || []).filter(x => x.sucre).reduce((s, x) => s + (lireQte(x) || 0), 0);
            parConvive = Math.max(1, p.nbParConvive - sucrees);
          }
        }
        const id = fiche.id + '|' + jour.date + '|' + p.id + '|' + forfait.id + '|' + ci;
        const base = { id, prestation: p.id, forfait: forfait.id, forfaitNom: forfait.nom, origine, convives, date: jour.date, fiche: fiche.id, client: fiche.client };
        if (!(convives > 0)) base.convivesInconnus = true;
        if (c.choix) {
          const def = (idx.con.choix || {})[c.choix] || { label: c.choix, categories: [] };
          const exclus = p.exclus || [];
          const pioche = piocheDe(def, idx, jour.date).filter(code => exclus.indexOf(code) < 0);
          // une pièce citée par le client reste choisie même hors saison, et même si le chef ne la propose pas d'office
          // (volaille halal) : seule la catégorie compte, et ce que le client a écarté (« pas de… »)
          const piocheChoix = piocheDe(Object.assign({}, def, { saison: null, exclure: [] }), idx, jour.date).filter(code => exclus.indexOf(code) < 0);
          let nbRecettes = c.recettes != null ? c.recettes : (def.recettes || 1);
          if (c.recettesDepuisTexte) nbRecettes = nbParPersonne(texte, c.recettesDepuisTexte, nbRecettes, p, c.qteMax);
          if (typeof nbRecettes === 'string') nbRecettes = Math.round(parConvive);
          const unites = def.portionsParCode || {};
          const avertissements = [];
          let recettes = null; let explicite = false;
          const choisis = (p.choisis || []).filter(x => piocheChoix.indexOf(x.code) >= 0);
          const rep = c.choix === 'plat' ? repartitionValide(p.repartition) : null;
          if (rep) {
            // répartition viande / poisson / végétarien d'abord : chaque type prend le plat cité de ce type, sinon une proposition ;
            // le total est l'effectif (« dont 2 végétariens » sur 40 : 38 plats du chef + 2 végétariens)
            const typeDe = idx.con.typePlats || {};
            const somme = Object.values(rep).reduce((s, n) => s + n, 0);
            const total = Math.max(somme, convives || 0);
            const utilises = [];
            const ajouterPlat = (code, n) => { recettes[code] = (recettes[code] || 0) + parConvive * n / total; if (utilises.indexOf(code) < 0) utilises.push(code); };
            const toutLeCatalogue = piocheChoix;
            recettes = {};
            Object.keys(rep).forEach(k => {
              const cite = choisis.find(x => typeDe[x.code] === k && utilises.indexOf(x.code) < 0);
              let cand = cite ? cite.code : proposer(pioche.filter(code => typeDe[code] === k), 1, idx, c.choix, 0)[0];
              // type absent de la pioche (halal exclu des propositions) : on le cherche dans tout le catalogue
              if (!cand) cand = proposer(toutLeCatalogue.filter(code => typeDe[code] === k), 1, idx, c.choix, 0)[0];
              if (!cand) {
                avertissements.push('Aucun plat « ' + k + ' » au catalogue : ' + rep[k] + ' portion(s) reportée(s) sur le plat du chef.');
                cand = proposer(pioche, 1, idx, c.choix, 0)[0];
              }
              if (cand) ajouterPlat(cand, rep[k]);
            });
            const reste = total - somme;
            if (reste > 0) {
              // le reste : plat cité non encore servi, sinon le type majoritaire déjà lu, sinon la proposition du chef hors types cités
              const cite = choisis.find(x => utilises.indexOf(x.code) < 0);
              const majoritaire = ['viande', 'poisson'].filter(k => rep[k]).sort((a, b) => rep[b] - rep[a])[0];
              const autre = cite ? cite.code
                : (majoritaire ? Object.keys(recettes).find(code => typeDe[code] === majoritaire) : null)
                || proposer(pioche.filter(code => !rep[typeDe[code]]), 1, idx, c.choix, etat.decalage || 0)[0]
                || proposer(pioche, 1, idx, c.choix, 0)[0];
              if (autre) ajouterPlat(autre, reste);
              explicite = 'partiel';
            } else explicite = true;
          }
          if (!recettes && choisis.length) {
            // pièces ou plats cités par le client (1 chacun, ou le nombre indiqué), pour toutes les familles (entrée, plat,
            // dessert, pièces) ; les « surprises du chef » complètent
            explicite = true; recettes = {};
            choisis.forEach(x => { recettes[x.code] = (recettes[x.code] || 0) + (x.parConvive ? x.parConvive / (unites[x.code] || 1) : 1); });
            const reste = parConvive - Object.values(recettes).reduce((s, n) => s + n, 0);
            if (reste > 0) {
              const autres = proposer(pioche.filter(code => !recettes[code]), Math.max(1, Math.ceil(reste)), idx, c.choix, etat.decalage || 0);
              const complement = repartir(reste, autres);
              Object.keys(complement).forEach(k => { recettes[k] = (recettes[k] || 0) + complement[k]; });
              explicite = 'partiel';
            } else if (reste < 0) {
              const f = parConvive / (parConvive - reste);
              Object.keys(recettes).forEach(k => { recettes[k] = recettes[k] * f; });
            }
          }
          if (!recettes) {
            const codes = proposer(pioche, Math.max(1, Math.min(nbRecettes, pioche.length)), idx, c.choix, etat.decalage || 0);
            recettes = repartir(parConvive, codes);
          }
          // desserts : 1 « unité » de dessert = 3 mignardises, 1 part de gâteau, 3 choux, 1 glace
          if (def.portionsParCode) Object.keys(recettes).forEach(k => { recettes[k] = recettes[k] * (def.portionsParCode[k] || 1); });
          const poste = Object.assign(base, {
            type: 'choix', famille: c.choix, label: (c.label || def.label || c.choix).replace('{n}', parConvive), pioche,
            parConvive, nbRecettes, recettes, explicite: !!explicite, partiel: explicite === 'partiel', valide: explicite === true, portionsParCode: def.portionsParCode || null,
          });
          if (avertissements.length) poste.avertissements = avertissements;
          postes.push(poste);
        } else {
          let ref = null; let label = '';
          if (c.code) { ref = { code: c.code }; label = (idx.catalogue[c.code] || {}).nom || c.code; }
          else if (c.bar) { ref = { bar: c.bar }; label = c.bar; }
          else if (c.boisson) { ref = { boisson: c.boisson }; label = (idx.con.boissons && idx.con.boissons[c.boisson] && idx.con.boissons[c.boisson].label) || c.boisson; }
          else if (c.achat && c.achat.produitDepuisLibelle) {
            const nom = String(p.libelle || '').replace(/^\s*\d+\s*(bouteilles?|btl|x)?\s*(de\s+)?/i, '').replace(/\s*x\s*\d+[.,]?\d*\s*€.*$/i, '').replace(/\s*[–-]\s*\d+[.,]?\d*\s*€.*$/, '').trim().slice(0, 90) || c.achat.produit;
            const nomPropre = nom.charAt(0).toUpperCase() + nom.slice(1);
            ref = { achat: Object.assign({}, c.achat, { produit: nomPropre }) }; label = nomPropre;
          }
          else if (c.achat) { ref = { achat: c.achat }; label = c.achat.produit; }
          if (!ref) return;
          if (c.boissonsDepuisTexte) {
            // « forfait 3 verres », « 2 verres de vin », « 2 coupes de crémant » (jamais le nombre de convives en tête de fiche)
            parConvive = nbParPersonne(texte, typeof c.boissonsDepuisTexte === 'string' ? c.boissonsDepuisTexte : 'verres?', parConvive, p, c.qteMax || 6);
          }
          postes.push(Object.assign(base, { type: 'fixe', ref, label: c.label || label, parConvive, unite: c.unite || null }));
        }
      });
    };
    // les options qui remplacent un choix (grand gâteau à la place des mignardises…) passent en dernier
    const taches = [];
    (jour.prestations || []).forEach(p => {
      if (p.ignoree) return;
      (p.forfaits || []).forEach(id => taches.push({ p, id }));
    });
    taches.sort((a, b) => ((idx.forfaits[a.id] || {}).remplaceChoix ? 1 : 0) - ((idx.forfaits[b.id] || {}).remplaceChoix ? 1 : 0));
    taches.forEach(({ p, id }) => {
      const texte = [p.libelle].concat(p.details || []).join(' · ');
      const f = idx.forfaits[id]; if (!f || f.horsCuisine) return;
      const convives = convivesPrestation(p, jour, f, fiche);
      if (f.remplaceChoix) {
        const cible = postes.slice().reverse().find(x => x.type === 'choix' && x.famille === f.remplaceChoix.famille && x.fiche === fiche.id && x.date === jour.date);
        if (cible) { cible.recettes = {}; cible.recettes[f.remplaceChoix.code] = cible.parConvive * (f.remplaceChoix.parUnite || 1); cible.explicite = true; cible.valide = true; cible.partiel = false; return; }
      }
      ajouterContenu(f, p, convives, texte, 0, id);
    });
    return postes;
  }

  /* ------------------------------------------------------------------ *
   * 5. Besoins : postes → ingrédients par fournisseur
   * ------------------------------------------------------------------ */
  const MAISON = 'production-maison';
  function delaiLivraison(fournisseurSlug, idx) {
    const r = (idx.con.livraisonJourJ || []);
    return r.indexOf(fournisseurSlug) >= 0 ? 0 : 1; // pains et pâtisseries le jour même, le reste la veille
  }
  /** Liste plate des portions : { code|bar|achat|boisson, portions, poste } */
  function portionsDesPostes(postes, idx) {
    const out = [];
    postes.forEach(p => {
      if (p.type === 'choix') {
        Object.keys(p.recettes || {}).forEach(code => {
          const n = p.recettes[code] * p.convives;
          if (n > 0) out.push({ ref: { code }, portions: n, poste: p });
        });
      } else if (p.ref) {
        const n = p.parConvive * p.convives;
        if (n > 0) out.push({ ref: p.ref, portions: n, poste: p });
      }
    });
    return out;
  }
  /** « déjà fait 2 par personnes » n'est pas un nom de produit : on reprend le nom de la pièce du catalogue. */
  function nomProduit(c, idx) {
    const t = norm(c.ingredient);
    if (/deja fai|par pers|par pax|par piece|\bpax\b/.test(t) || t.length < 3) {
      const p = idx.catalogue[c.code];
      const nom = p ? p.nom.replace(/\s*&.*$/, '') : c.ingredient;
      return nom + ' (prêt à cuire)';
    }
    return c.ingredient.charAt(0).toUpperCase() + c.ingredient.slice(1);
  }
  function cleProduit(fournisseurSlug, produit, base) { return fournisseurSlug + '::' + slug(produit) + '::' + base; }

  /**
   * evenements : [{fiche, jour, postes}] → { lignes:[…], nonModelises:[…], alertes:[…] }
   * Chaque ligne : { cle, fournisseur, fournisseurSlug, produit, base, qte, qteBrute, coef, dateBesoin, pour:[…], type }
   */
  function calculerBesoins(evenements, idx, options) {
    options = options || {};
    const margeDefaut = options.margeDefaut != null ? options.margeDefaut : 0.05;
    // le bar suit le réglage de marge de l'équipe (l'onglet Bar n'a pas de colonne marge)
    const margeBar = options.margeBar != null ? options.margeBar : margeDefaut;
    const lignes = {}; const nonModelises = {}; const alertes = [];
    const ajouter = (fourn, produit, base, qte, dateEvt, source, type, marge, fond) => {
      if (!(qte > 0)) return;
      const f = trouverFournisseur(idx, fourn);
      const fSlug = f ? f.slug : (fourn ? slug(fourn) : 'a-preciser');
      const fNom = f ? f.nom : (fourn || 'Fournisseur à préciser');
      // « Production maison » n'est pas un fournisseur : tout ce qui y renvoie (composant, achat, bar) va à la mise en place
      if (fSlug === MAISON) type = 'maison';
      const decal = type === 'maison' ? 0 : delaiLivraison(fSlug, idx);
      const dateBesoin = iso(ajouterJours(deIso(dateEvt), -decal));
      const cle = cleProduit(fSlug, produit, base) + (options.uneLivraison ? '' : '::' + dateBesoin);
      const coef = (idx.coefficients[slug(produit)] && idx.coefficients[slug(produit)].coef) || 1;
      const m = marge != null ? marge : margeDefaut;
      const l = lignes[cle] || (lignes[cle] = {
        cle, fournisseur: fNom, fournisseurSlug: fSlug, produit, produitSlug: slug(produit), base, qte: 0, qteBrute: 0, coef,
        dateBesoin, pour: [], type, connu: !!f, fond: !!fond,
      });
      if (options.uneLivraison && dateBesoin < l.dateBesoin) l.dateBesoin = dateBesoin;
      l.qteBrute += qte;
      l.qte += qte * (1 + m) * coef;
      const pr = l.pour.find(x => x.fiche === source.fiche && x.date === source.date && x.code === source.code);
      if (pr) pr.qte += qte; else l.pour.push({ fiche: source.fiche, client: source.client, date: source.date, code: source.code, qte });
    };
    evenements.forEach(ev => {
      portionsDesPostes(ev.postes, idx).forEach(({ ref, portions, poste }) => {
        const src = { fiche: poste.fiche, client: poste.client, date: poste.date, code: ref.code || ref.bar || ref.boisson || (ref.achat && ref.achat.produit) };
        if (ref.code) {
          const comps = (idx.composants[ref.code] || []).filter(c => c.qteBase != null && c.qteBase > 0);
          const direct = (idx.con.achatsDirects || {})[ref.code];
          if (comps.length) {
            comps.forEach(c => {
              const estMaison = slug(c.fournisseur) === MAISON;
              ajouter(c.fournisseur || '', nomProduit(c, idx), c.base, c.qteBase * portions, poste.date, src, estMaison ? 'maison' : 'ingredient', c.marge);
              if (!c.fournisseur) alertes.push({ type: 'fournisseur-manquant', code: ref.code, ingredient: c.ingredient });
            });
          } else if (direct) {
            const u = unite(direct.unite);
            ajouter(direct.fournisseur, direct.produit, u.base, (direct.qte || 1) * u.facteur * portions, poste.date, src, 'achat', direct.marge, direct.fond);
          } else {
            const k = ref.code;
            const nm = nonModelises[k] || (nonModelises[k] = { code: k, nom: (idx.catalogue[k] || {}).nom || k, portions: 0, pour: [] });
            nm.portions += portions; nm.pour.push({ client: poste.client, date: poste.date, portions });
          }
        } else if (ref.achat) {
          const u = unite(ref.achat.unite);
          ajouter(ref.achat.fournisseur, ref.achat.produit, u.base, (ref.achat.qte || 1) * u.facteur * portions, poste.date, src, 'achat', ref.achat.marge, ref.achat.fond);
        } else if (ref.bar || ref.boisson) {
          const verres = ventilerBoisson(ref, portions, idx, poste);
          verres.forEach(v => {
            const b = idx.bar[slug(v.bar)] || { nom: v.bar };
            if (b.parVerre) { // café en grammes, thé en sachets…
              const u = unite(b.uniteParVerre || 'g');
              ajouter(b.fournisseur || '', b.produit || b.nom, u.base, b.parVerre * u.facteur * v.verres, poste.date, src, 'bar', margeBar, b.fond);
            } else {
              ajouter(b.fournisseur || '', b.nom, 'verre', v.verres, poste.date, src, 'bar', margeBar, b.fond);
            }
          });
        }
      });
    });
    // conversion verres → bouteilles pour le bar
    Object.values(lignes).forEach(l => {
      if (l.base !== 'verre') return;
      const b = idx.bar[slug(l.produit)] || {};
      const vpb = b.verresParBouteille || (b.verreCl && b.contenanceCl ? Math.floor(b.contenanceCl / b.verreCl) : null);
      l.verres = l.qte;
      if (vpb) { l.qte = l.qte / vpb; l.base = (b.contenant || 'bouteille'); l.verresParBouteille = vpb; l.vpbDefaut = !!b.defaut; }
    });
    return { lignes: Object.values(lignes).sort((a, b) => a.fournisseur.localeCompare(b.fournisseur) || a.dateBesoin.localeCompare(b.dateBesoin) || a.produit.localeCompare(b.produit)), nonModelises: Object.values(nonModelises), alertes };
  }
  /** Ventile les boissons génériques (« boisson chaude », « verre de vin ») en références du bar. */
  function ventilerBoisson(ref, portions, idx, poste) {
    if (ref.bar) return [{ bar: ref.bar, verres: portions }];
    const def = (idx.con.boissons || {})[ref.boisson];
    if (!def) return [{ bar: ref.boisson, verres: portions }];
    const rep = (poste && poste.ventilation) || def.repartition || [];
    const total = rep.reduce((s, r) => s + r.part, 0) || 1;
    return rep.map(r => ({ bar: r.bar, verres: portions * r.part / total }));
  }

  /* ------------------------------------------------------------------ *
   * 6. Commandes : stock, conditionnement, livraison, heure limite
   * ------------------------------------------------------------------ */
  /** Dernier jour de livraison possible ≤ date voulue (si le fournisseur ne livre que certains jours). */
  function jourLivraison(dateVoulueIso, f) {
    let d = deIso(dateVoulueIso);
    const jours = f && f.joursLivraison;
    let garde = 0;
    while (jours && jours.length && jours.indexOf(d.getDay()) < 0 && garde < 7) { d = ajouterJours(d, -1); garde++; }
    if (!jours && d.getDay() === 0) d = ajouterJours(d, -1); // pas de livraison le dimanche par défaut
    return iso(d);
  }
  /** Heure limite de commande = livraison (8 h) − délai ; en l'absence de délai, 48 h par défaut (signalé). */
  function heureLimite(livraisonIso, f, maintenant) {
    const d = deIso(livraisonIso); d.setHours(8, 0, 0, 0);
    const delai = f && f.delaiHeures != null ? f.delaiHeures : 48;
    // calcul en jours de calendrier puis en heures : 8 h − 48 h reste 8 h, même au passage à l'heure d'été
    const limite = new Date(d.getTime());
    limite.setDate(limite.getDate() - Math.floor(delai / 24));
    limite.setMinutes(limite.getMinutes() - Math.round((delai % 24) * 60));
    // une commande se passe en journée : la nuit (avant 8 h) on ramène à 17 h la veille, le soir (après 17 h) à 17 h
    if (limite.getHours() < 8) { limite.setDate(limite.getDate() - 1); limite.setHours(17, 0, 0, 0); }
    else if (limite.getHours() > 17 || (limite.getHours() === 17 && limite.getMinutes() > 0)) limite.setHours(17, 0, 0, 0);
    if (limite.getDay() === 0) { limite.setDate(limite.getDate() - 1); limite.setHours(12, 0, 0, 0); }
    let urgence = 'ok';
    if (maintenant) {
      const h = (limite - maintenant) / 3600e3;
      urgence = h < 0 ? 'retard' : h < 24 ? 'aujourdhui' : h < 72 ? 'bientot' : 'ok';
    }
    return { limite, delaiConnu: !!(f && f.delaiHeures != null), urgence };
  }
  /**
   * besoins + stock → bons de commande par fournisseur.
   * stock : { [cleSansDate]: qteEnBase }  (clé fournisseur::produit::base, saisie dans l'inventaire express)
   */
  function calculerCommandes(besoins, idx, stock, options) {
    options = options || {};
    stock = stock || {};
    const restant = {}; Object.keys(stock).forEach(k => { restant[k] = +stock[k] || 0; });
    const parF = {};
    // fournisseurs à long délai (≥ 3 jours) : une seule livraison, la plus tôt de la semaine
    const plusTot = {};
    besoins.lignes.forEach(l => { if (l.type !== 'maison' && (!plusTot[l.fournisseurSlug] || l.dateBesoin < plusTot[l.fournisseurSlug])) plusTot[l.fournisseurSlug] = l.dateBesoin; });
    // 1er passage : regroupe par fournisseur, livraison et produit (on additionne avant d'arrondir)
    besoins.lignes.forEach(l => {
      if (l.type === 'maison') return;
      const f = idx.fournisseurs[l.fournisseurSlug] || null;
      const regroupe = options.uneLivraison || (f && f.delaiHeures != null && f.delaiHeures >= 72);
      const bon = parF[l.fournisseurSlug] || (parF[l.fournisseurSlug] = {
        slug: l.fournisseurSlug, nom: l.fournisseur, infos: f, livraisons: {}, alertes: [], estimation: 0, prixConnus: 0, lignes: 0,
      });
      const livraison = jourLivraison(regroupe ? plusTot[l.fournisseurSlug] : l.dateBesoin, f);
      const liv = bon.livraisons[livraison] || (bon.livraisons[livraison] = { date: livraison, lignes: [] });
      const cleStock = cleProduit(l.fournisseurSlug, l.produit, l.base);
      let x = liv.lignes.find(y => y.cleStock === cleStock);
      if (!x) {
        x = { cle: l.cle, cleStock, produit: l.produit, produitSlug: l.produitSlug, base: l.base, besoin: 0, besoinBrut: 0, coef: l.coef, pour: [], type: l.type,
          verres: l.verres != null ? 0 : null, verresParBouteille: l.verresParBouteille || null, vpbDefaut: l.vpbDefaut, fond: !!l.fond };
        liv.lignes.push(x);
      }
      x.besoin += l.qte; x.besoinBrut += l.qteBrute; x.pour = x.pour.concat(l.pour);
      if (l.verres != null) x.verres += l.verres;
    });
    // 2e passage : stock déduit (dans l'ordre des livraisons), conditionnement, coût
    Object.values(parF).forEach(bon => {
      const f = bon.infos;
      Object.keys(bon.livraisons).sort().forEach(d => bon.livraisons[d].lignes.forEach(x => {
        const dispo = restant[x.cleStock] || 0;
        const utilise = Math.min(dispo, x.besoin);
        restant[x.cleStock] = dispo - utilise;
        let aCommander = Math.max(0, x.besoin - utilise);
        // conditionnement par produit (prix relevés) s'il est dans l'unité de la ligne, sinon conditionnement général du fournisseur
        const prix = f && f.prix && f.prix[x.produitSlug];
        const cp = prix ? parseConditionnement(prix.conditionnement) : null;
        let cond = null;
        if (cp && cp.base === x.base) cond = cp;
        // « Carton de 12 x 33 cl » pour une ligne en bouteilles : 12 bouteilles par carton
        else if (cp && cp.nombre && x.base !== 'g' && x.base !== 'ml') cond = { qte: cp.nombre, base: x.base, famille: 'compte:' + x.base, libelle: cp.libelle };
        if (!cond && f && f.conditionnementParse && f.conditionnementParse.base === x.base) cond = f.conditionnementParse;
        // produit de fond (café, thé, jus en BIB) : au conditionnement entier, à défaut le minimum de commande (« seau 8kg »)
        if (!cond && x.fond && f && f.minimumParse && f.minimumParse.base === x.base) cond = f.minimumParse;
        let colis = null;
        if (cond && cond.qte > 0 && aCommander > 0) { colis = Math.ceil(aCommander / cond.qte - 1e-9); aCommander = colis * cond.qte; }
        else if (x.base !== 'g' && x.base !== 'ml') aCommander = Math.ceil(aCommander - 1e-9);
        let cout = null;
        if (prix && prix.prix != null && aCommander > 0) {
          const pu = unite(prix.unite || x.base);
          if (pu.base === x.base) cout = aCommander / pu.facteur * prix.prix;
          else if (colis && /colis|carton|seau|plateau|bib|sac|caisse|lot|barquette/.test(norm(prix.unite))) cout = colis * prix.prix;
        }
        if (cout != null) { bon.estimation += cout; bon.prixConnus++; }
        bon.lignes++;
        Object.assign(x, { stock: utilise, aCommander, colis, conditionnement: cond ? cond.libelle : '', cout });
      }));
    });
    const maintenant = options.maintenant || new Date();
    const bons = Object.values(parF).map(b => {
      b.livraisons = Object.values(b.livraisons).sort((x, y) => x.date.localeCompare(y.date)).map(liv => {
        const hl = heureLimite(liv.date, b.infos, maintenant);
        // produits de fond seuls (café, thé, jus en BIB) : réserve à vérifier, pas une urgence liée aux événements
        const fond = liv.lignes.length > 0 && liv.lignes.every(x => x.fond);
        return Object.assign(liv, { limite: hl.limite, delaiConnu: hl.delaiConnu, urgence: fond ? 'ok' : hl.urgence, fond, total: liv.lignes.filter(x => x.aCommander > 0).length });
      });
      const f = b.infos;
      if (!f) b.alertes.push('Fournisseur absent de l’onglet Fournisseurs du classeur.');
      else {
        if (f.delaiHeures == null) b.alertes.push('Délai de commande non renseigné : 48 h retenues par défaut.');
        if (!f.joursLivraison && !/besoin/.test(norm(f.jours))) b.alertes.push('Jours de livraison non renseignés.');
        if (f.minimumParse) {
          b.livraisons.forEach(liv => {
            const tot = liv.lignes.filter(x => x.base === f.minimumParse.base).reduce((s, x) => s + x.aCommander, 0);
            if (tot > 0 && tot < f.minimumParse.qte) b.alertes.push('Livraison du ' + jourCourt(liv.date) + ' sous le minimum de commande (' + f.minimum + ').');
          });
        }
      }
      if (b.livraisons.some(l => l.lignes.some(x => x.fond && x.aCommander > 0))) {
        b.alertes.push('Produits de fond (café, thé, jus…) : vérifier la réserve avant de commander ; ils se recommandent au conditionnement entier, sans urgence liée aux événements.');
      }
      b.prochaineLimite = b.livraisons.filter(l => !l.fond).reduce((m, l) => (!m || l.limite < m ? l.limite : m), null);
      b.urgence = b.livraisons.reduce((u, l) => ['retard', 'aujourdhui', 'bientot', 'ok'].indexOf(l.urgence) < ['retard', 'aujourdhui', 'bientot', 'ok'].indexOf(u) ? l.urgence : u, 'ok');
      return b;
    }).sort((a, b) => (a.prochaineLimite ? a.prochaineLimite.getTime() : Infinity) - (b.prochaineLimite ? b.prochaineLimite.getTime() : Infinity) || a.nom.localeCompare(b.nom));
    const maison = besoins.lignes.filter(l => l.type === 'maison');
    return { bons, maison, nonModelises: besoins.nonModelises, alertes: besoins.alertes };
  }

  /* ------------------------------------------------------------------ *
   * 7. Apprentissage
   * ------------------------------------------------------------------ */
  /** Retour de service : « manquait » / « juste » / « trop » → coefficient appliqué la prochaine fois. */
  function ajusterCoefficient(ancien, verdict, ecartPct) {
    const c = ancien && ancien.coef ? ancien.coef : 1;
    let nv = c;
    if (ecartPct != null && isFinite(ecartPct) && ecartPct !== 0) nv = c * (1 + ecartPct / 100 * 0.6);
    else if (verdict === 'manque') nv = c * 1.1;
    else if (verdict === 'trop') nv = c * 0.92;
    else if (verdict === 'juste') nv = c; // confirmé
    nv = Math.max(0.6, Math.min(1.6, nv));
    const hist = ((ancien && ancien.historique) || []).concat([{ verdict, ecartPct: ecartPct == null ? null : ecartPct }]).slice(-12);
    return { coef: arrondi(nv, 3), n: ((ancien && ancien.n) || 0) + 1, historique: hist };
  }
  /** Habitudes du chef : compte les pièces retenues par famille de choix, avec oubli progressif. */
  function majHabitudes(habitudes, postes) {
    const h = JSON.parse(JSON.stringify(habitudes || {}));
    Object.keys(h).forEach(f => Object.keys(h[f]).forEach(c => { h[f][c] = arrondi(h[f][c] * 0.9, 3); if (h[f][c] < 0.05) delete h[f][c]; }));
    postes.filter(p => p.type === 'choix').forEach(p => {
      const fam = h[p.famille] || (h[p.famille] = {});
      Object.keys(p.recettes || {}).forEach(c => { fam[c] = arrondi((fam[c] || 0) + 1, 3); });
    });
    return h;
  }

  return {
    // outils
    norm, slug, sansAccents, parseNombre, parseMontant, arrondi, unite, formatQte,
    iso, deIso, ajouterJours, semaineDe, dansSemaine, jourCourt, jourLong, datesDepuisCodes, datesDepuisTexte,
    // référentiel
    parseReferentiel, parseDelai, parseJours, parseConditionnement, indexer, trouverFournisseur,
    // lecture
    lireDocument, normaliserLectureClaude, detecterForfaits, cleAlias, typeDocument, codeCatalogueDepuisTexte,
    convivesDepuisTexte, repartitionDepuisTexte, clientDepuisNomFichier,
    // menu
    developperJour, proposer, repartir, piocheDe, scorePiece,
    // besoins / commandes
    calculerBesoins, calculerCommandes, jourLivraison, heureLimite, cleProduit, portionsDesPostes,
    // apprentissage
    ajusterCoefficient, majHabitudes,
  };
});
