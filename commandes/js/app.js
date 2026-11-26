/*
 * La Brigade de Procé — interface.
 * Fonctionne seule dans un navigateur (mémoire locale) et s'enrichit dans Claude :
 *   db        → mémoire partagée de l'équipe (semaines, apprentissages, toques)
 *   sample    → Claude lit les fiches, analyse les retours de service, extrait les relevés fournisseurs
 *   mcp       → Google Drive : retrouve les devis et fiches de fonction de la semaine
 *   downloads → enregistre le PDF des bons de commande
 *   user      → qui est connecté (toques de la brigade)
 *   dictation → inventaire dicté à la voix
 */
(function () {
  'use strict';
  const M = window.Moteur;

  /* ------------------------------------------------------------------ *
   * Outils DOM
   * ------------------------------------------------------------------ */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  /** h('div', {class:'x', onclick}, enfants…) — texte toujours inséré en textContent. */
  function h(tag, attrs, ...enfants) {
    const e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(k => {
      const v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.keys(v).forEach(p => { if (p.indexOf('--') === 0) e.style.setProperty(p, v[p]); else e.style[p] = v[p]; });
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'html') { /* jamais utilisé avec des données */ }
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, String(v));
    });
    enfants.flat(Infinity).forEach(c => {
      if (c == null || c === false) return;
      e.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return e;
  }
  function vider(e) { e.replaceChildren(); return e; }
  let toastMinuteur = null;
  function toast(msg, cri) {
    const t = $('#toast');
    vider(t);
    if (cri) t.appendChild(h('span', { class: 'main-ecrite' }, cri));
    t.appendChild(document.createTextNode(msg));
    t.classList.add('visible');
    clearTimeout(toastMinuteur);
    toastMinuteur = setTimeout(() => t.classList.remove('visible'), 3600);
  }
  function lsGet(k, def) { try { const v = localStorage.getItem('brigade:' + k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function lsSet(k, v) { try { localStorage.setItem('brigade:' + k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }
  function anti(fn, ms) { let t = null; return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms); }; }
  /** Retire téléphones, e-mails et IBAN avant d'enregistrer du texte issu d'un document. */
  function nettoyer(s) {
    return String(s == null ? '' : s)
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[e-mail]')
      .replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/gi, m => (/\d{6}/.test(m.replace(/\s/g, '')) ? '[IBAN]' : m)) // IBAN d'abord
      .replace(/\b(?:BIC|SWIFT)\s*:?\s*[A-Z]{6}[A-Z0-9]{2,5}\b/gi, '[BIC]')
      .replace(/(?:(?:\+|00)33\s?(?:\(0\)\s?)?|\b0)[1-9](?:[\s.\/-]?\d{2}){4}/g, '[tél.]');
  }
  async function copier(texte, zone) {
    try { await navigator.clipboard.writeText(texte); toast('Copié dans le presse-papiers.', 'Oui chef !'); return true; } catch (e) {
      if (zone) { zone.focus(); zone.select(); }
      toast('Copie impossible ici : le texte est sélectionné, faites Ctrl+C.');
      return false;
    }
  }

  /* ------------------------------------------------------------------ *
   * Bibliothèques (chargées à la demande)
   * ------------------------------------------------------------------ */
  const LIBS = {
    pdf: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
    jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    jspdf: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
    autotable: 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js',
  };
  const chargements = {};
  function script(url) {
    if (!chargements[url]) chargements[url] = new Promise((ok, ko) => {
      const s = document.createElement('script'); s.src = url; s.onload = ok;
      s.onerror = () => { delete chargements[url]; ko(new Error('Bibliothèque non chargée : ' + url)); };
      document.head.appendChild(s);
    });
    return chargements[url];
  }

  /* ------------------------------------------------------------------ *
   * Extraction du texte des fichiers
   * ------------------------------------------------------------------ */
  async function texteDePdf(buf) {
    await script(LIBS.pdf); await script(LIBS.pdfWorker); // le worker tourne dans la page (cadre sans worker externe)
    const pdfjs = window.pdfjsLib;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true }).promise;
    const lignes = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const rangs = [];
      tc.items.forEach(it => {
        if (!it.str || !it.str.trim()) return;
        const y = it.transform[5]; const x = it.transform[4];
        let r = rangs.find(r => Math.abs(r.y - y) < 3);
        if (!r) { r = { y, items: [] }; rangs.push(r); }
        r.items.push({ x, str: it.str, w: it.width || 0 });
      });
      rangs.sort((a, b) => b.y - a.y).forEach(r => {
        r.items.sort((a, b) => a.x - b.x);
        let t = ''; let fin = null;
        r.items.forEach(it => { if (fin != null && it.x - fin > 1.5) t += ' '; t += it.str; fin = it.x + it.w; });
        lignes.push(t.replace(/\s+/g, ' ').trim());
      });
      lignes.push('');
    }
    return lignes.join('\n');
  }
  async function texteDeDocx(buf) {
    await script(LIBS.jszip);
    const zip = await window.JSZip.loadAsync(buf);
    const f = zip.file('word/document.xml'); if (!f) throw new Error('Document Word illisible');
    const xml = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    return Array.from(xml.getElementsByTagNameNS(W, 'p')).map(p => {
      let t = '';
      Array.from(p.getElementsByTagNameNS(W, '*')).forEach(n => {
        if (n.localName === 't') t += n.textContent; else if (n.localName === 'tab') t += ' '; else if (n.localName === 'br') t += '\n';
      });
      return t;
    }).join('\n');
  }
  async function lireClasseur(buf) {
    await script(LIBS.xlsx);
    const wb = window.XLSX.read(buf, { type: 'array' });
    const sheets = {};
    wb.SheetNames.forEach(n => { sheets[n] = window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }); });
    return sheets;
  }

  /* ------------------------------------------------------------------ *
   * État
   * ------------------------------------------------------------------ */
  const S = {
    ref: null, con: null, idx: null,
    app: { alias: {}, habitudes: {}, coefficients: {}, fournisseurs: {}, carnet: { notes: [] }, reglages: {}, referentiel: null, forfaits: [] },
    semaineDate: null, semaine: null, sem: null, calc: null,
    brigade: {}, moi: { id: 'local', nom: 'Moi' },
    caps: {}, textes: {}, lectures: {}, decalages: {}, vue: 'fiches', retourCle: null,
    chargement: false, lectureSeule: false, brouillonRetour: {}, genRendu: 0, renduEnAttente: false,
  };
  const semaineVide = cle => ({ cle, fiches: [], choix: {}, stock: {}, options: {}, pdf: null, retour: null });
  /** Les documents livrés par la mémoire partagée sont gelés : on travaille toujours sur une copie. */
  const copie = x => (x == null ? x : JSON.parse(JSON.stringify(x)));
  /** Cartes partagées (une entrée = une clé) : on écrit clé par clé, une suppression laisse une pierre tombale. */
  const CARTES = ['alias', 'coefficients', 'fournisseurs'];
  const sansTombes = o => { const r = {}; Object.keys(o || {}).forEach(k => { if (o[k] && !o[k]._supprime) r[k] = o[k]; }); return r; };

  /* ------------------------------------------------------------------ *
   * Mémoire : db partagée (Claude) ou navigateur
   *
   * Dans la mémoire partagée, une semaine = un document « semaines/<clé> » (choix du chef, stock, options,
   * PDF, retour) + une fiche par document « semaines/<clé>/fiches/<id> ». On n'écrit que ce qui a changé
   * (update clé par clé, set par fiche) : deux personnes qui travaillent en même temps ne s'écrasent pas.
   * ------------------------------------------------------------------ */
  const Memoire = {
    db: null, desab: [], chaines: {}, sale: null, minuteur: null, enVol: {}, existe: {}, recu: {},
    cleDoc: s => String(s).replace(/[^A-Za-z0-9_\-.~:@+]/g, '_').slice(0, 180) || 'x',

    /** Écritures d'un même document l'une après l'autre (règle de la mémoire partagée). */
    enchainer(chemin, op) {
      const p = (this.chaines[chemin] || Promise.resolve()).then(op).catch(e => this.erreur(e));
      this.chaines[chemin] = p;
      return p;
    },
    /** Écrit le dernier état connu ; les demandes rapprochées n'en font qu'une. */
    ecrireDernier(chemin, lire) {
      if (!this.db) return Promise.resolve();
      const etat = this.chaines['?' + chemin] || (this.chaines['?' + chemin] = { prevu: false });
      if (etat.prevu) return this.chaines[chemin];
      etat.prevu = true;
      return this.enchainer(chemin, () => { etat.prevu = false; return this.db.doc(chemin).set(copie(lire())); });
    },
    erreur(e) {
      console.warn(e);
      const code = e && e.code;
      if (code === 'invalid_argument' && S.caps.db) {
        if (!S.lectureSeule) { S.lectureSeule = true; toast('Vous êtes en lecture seule sur cette appli : demandez un accès Contributeur pour saisir.'); rendre(); }
      } else if (code === 'quota_exceeded') toast('Mémoire partagée pleine : supprimez d’anciennes semaines.');
      else toast('Enregistrement partagé impossible (' + (code || 'erreur') + ').');
    },

    async init(db) {
      this.db = db;
      if (!db) {
        ['alias', 'habitudes', 'coefficients', 'fournisseurs', 'carnet', 'reglages', 'referentiel'].forEach(k => { const v = lsGet('app:' + k, null); if (v) S.app[k] = v; });
        S.brigade = lsGet('brigade', {});
        return;
      }
      // la mémoire de l'équipe remplace tout ce qui venait de ce navigateur
      S.app = { alias: {}, habitudes: {}, coefficients: {}, fournisseurs: {}, carnet: { notes: [] }, reglages: {}, referentiel: null, forfaits: [] };
      S.brigade = {}; reindexer();
      const minuteur = setTimeout(() => toast('La mémoire de l’équipe ne répond pas encore : réessayez dans un instant.'), 10000);
      db.collection('apprentissage').onSnapshot(snap => {
        clearTimeout(minuteur);
        snap.docs.forEach(d => { if (d.exists) { const v = copie(d.data()); S.app[d.id] = CARTES.indexOf(d.id) >= 0 ? sansTombes(v) : v; } });
        reindexer(); rendreDouce();
      }, e => { clearTimeout(minuteur); console.warn('apprentissage', e); });
      db.collection('brigade').onSnapshot(snap => {
        snap.docs.forEach(d => { if (d.exists && !this.enVol['brigade/' + d.id]) S.brigade[d.id] = copie(d.data()); });
        majMoi(); if (S.vue === 'brigade') rendreDouce();
      }, e => console.warn('brigade', e));
    },

    /* ---------- semaine ---------- */
    ouvrirSemaine(cle) {
      this.desab.forEach(f => f()); this.desab = [];
      if (!this.db) { S.semaine = copie(lsGet('semaine:' + cle, null)) || semaineVide(cle); return; }
      S.semaine = semaineVide(cle);
      S.chargement = true; this.recu = { doc: false, fiches: false };
      const attente = setTimeout(() => {
        if (S.chargement) toast('La semaine partagée ne répond pas encore : les saisies restent bloquées jusqu’à son chargement.');
      }, 10000);
      const pret = () => { if (this.recu.doc && this.recu.fiches && S.chargement) { S.chargement = false; clearTimeout(attente); S.calc = null; rendreDouce(); } };
      this.desab.push(() => clearTimeout(attente));
      this.desab.push(this.db.doc('semaines/' + cle).onSnapshot(d => {
        if (!S.semaine || S.semaine.cle !== cle) return;
        this.existe[cle] = d.exists;
        const r = d.exists ? copie(d.data()) : {};
        const s = S.semaine;
        const choix = {}; Object.keys(r.choix || {}).forEach(k => { choix[k] = choixDepuisMemoire(r.choix[k]); });
        Object.keys(s.choix || {}).forEach(k => { if (this.protege('choix:' + k)) choix[k] = s.choix[k]; });
        s.choix = choix;
        const stock = Object.assign({}, r.stock || {});
        Object.keys(s.stock || {}).forEach(k => { if (this.protege('stock:' + k)) stock[k] = s.stock[k]; });
        Object.keys(stock).forEach(k => { if (!(stock[k] > 0)) delete stock[k]; });
        s.stock = stock;
        if (!this.protege('options')) s.options = r.options || {};
        if (!this.protege('pdf')) s.pdf = r.pdf || null;
        s.retour = r.retour || null;
        if (!d.metadata || !d.metadata.fromCache) this.recu.doc = true;
        S.calc = null; pret(); if (!S.chargement) rendreDouce();
      }, e => { this.erreurLecture(e); }));
      this.desab.push(this.db.collection('semaines/' + cle + '/fiches').onSnapshot(q => {
        if (!S.semaine || S.semaine.cle !== cle) return;
        const distantes = q.docs.filter(d => d.exists).map(d => copie(d.data()));
        const locales = S.semaine.fiches || [];
        const fiches = distantes.filter(f => !this.protege('fiche:' + f.id)).concat(locales.filter(f => this.protege('fiche:' + f.id)));
        // une fiche supprimée ici mais pas encore effacée là-bas ne revient pas
        S.semaine.fiches = fiches.filter(f => !(this.sale && this.sale.supprimees.has(f.id)) && !this.enVol['suppr:' + f.id])
          .sort((a, b) => String(a.ajouteLe || '').localeCompare(String(b.ajouteLe || '')));
        if (!q.metadata || !q.metadata.fromCache) this.recu.fiches = true;
        S.calc = null; pret(); if (!S.chargement) rendreDouce();
      }, e => { this.erreurLecture(e); }));
    },
    erreurLecture(e) {
      console.warn('semaine', e);
      S.chargement = false;
      if (e && e.code === 'revoked') { S.lectureSeule = true; }
      toast('Impossible de lire la semaine partagée (' + ((e && e.code) || 'erreur') + ').');
      rendreDouce();
    },
    /** Une clé est protégée tant que sa modification locale n'est pas enregistrée. */
    protege(k) { return !!((this.sale && this.sale.cles.has(k)) || this.enVol[k] > 0); },

    /** Compare avant / après une modification et note ce qui doit être écrit. */
    noter(avant, apres) {
      if (!this.db) { this.planifierLocal(); return; }
      if (!this.sale || this.sale.cle !== apres.cle) { this.vidanger(); this.sale = { cle: apres.cle, cles: new Set(), fiches: new Set(), supprimees: new Set() }; }
      const sale = this.sale;
      const ids = new Set((apres.fiches || []).map(f => f.id));
      (apres.fiches || []).forEach(f => { if (avant.fiches[f.id] !== JSON.stringify(f)) { sale.fiches.add(f.id); sale.supprimees.delete(f.id); sale.cles.add('fiche:' + f.id); } });
      Object.keys(avant.fiches).forEach(id => { if (!ids.has(id)) { sale.supprimees.add(id); sale.fiches.delete(id); sale.cles.add('fiche:' + id); } });
      Object.keys(Object.assign({}, avant.choix, apres.choix || {})).forEach(k => { if (avant.choix[k] !== JSON.stringify((apres.choix || {})[k])) sale.cles.add('choix:' + k); });
      Object.keys(Object.assign({}, avant.stock, apres.stock || {})).forEach(k => { if (avant.stock[k] !== (apres.stock || {})[k]) sale.cles.add('stock:' + k); });
      if (avant.options !== JSON.stringify(apres.options || {})) sale.cles.add('options');
      if (avant.pdf !== JSON.stringify(apres.pdf || null)) sale.cles.add('pdf');
      clearTimeout(this.minuteur);
      this.minuteur = setTimeout(() => this.vidanger(), 700);
    },
    planifierLocal() {
      clearTimeout(this.minuteur);
      this.minuteur = setTimeout(() => { if (S.semaine) lsSet('semaine:' + S.semaine.cle, S.semaine); }, 400);
    },
    /** Écrit tout de suite ce qui a changé (aussi appelé avant de changer de semaine). */
    vidanger() {
      clearTimeout(this.minuteur); this.minuteur = null;
      if (!this.db) { if (S.semaine) lsSet('semaine:' + S.semaine.cle, S.semaine); return; }
      const sale = this.sale; this.sale = null;
      if (!sale || !S.semaine || S.semaine.cle !== sale.cle) return;
      const s = S.semaine; const cle = sale.cle; const base = 'semaines/' + cle;
      const maj = {};
      sale.cles.forEach(k => {
        if (k.indexOf('choix:') === 0) { const c = k.slice(6); (maj.choix = maj.choix || {})[c] = choixVersMemoire(s.choix[c]); }
        else if (k.indexOf('stock:') === 0) { const c = k.slice(6); (maj.stock = maj.stock || {})[c] = s.stock[c] > 0 ? s.stock[c] : 0; }
        else if (k === 'options') maj.options = copie(s.options || {});
        else if (k === 'pdf') maj.pdf = copie(s.pdf);
      });
      const cles = Array.from(sale.cles).filter(k => k.indexOf('fiche:') !== 0);
      if (Object.keys(maj).length) {
        maj.maj = new Date().toISOString(); maj.majPar = S.moi.id;
        cles.forEach(k => { this.enVol[k] = (this.enVol[k] || 0) + 1; });
        this.enchainer(base, () => {
          if (this.existe[cle]) return this.db.doc(base).update(maj);
          this.existe[cle] = true;
          return this.db.doc(base).set(Object.assign({ cle }, maj));
        }).finally(() => { cles.forEach(k => { this.enVol[k]--; }); });
      }
      sale.fiches.forEach(id => {
        const f = s.fiches.find(x => x.id === id); if (!f) return;
        const doc = copie(f); const k = 'fiche:' + id;
        this.enVol[k] = (this.enVol[k] || 0) + 1;
        if (!this.existe[cle]) { this.existe[cle] = true; this.enchainer(base, () => this.db.doc(base).set({ cle, maj: new Date().toISOString() })); }
        this.enchainer(base + '/fiches/' + id, () => this.db.doc(base + '/fiches/' + id).set(doc)).finally(() => { this.enVol[k]--; });
      });
      sale.supprimees.forEach(id => {
        const k = 'fiche:' + id;
        this.enVol[k] = (this.enVol[k] || 0) + 1; this.enVol['suppr:' + id] = (this.enVol['suppr:' + id] || 0) + 1;
        this.enchainer(base + '/fiches/' + id, () => this.db.doc(base + '/fiches/' + id)['delete']()).finally(() => { this.enVol[k]--; this.enVol['suppr:' + id]--; });
      });
    },

    /* ---------- apprentissages, toques ---------- */
    /** Remplace tout un document d'apprentissage (habitudes, carnet, réglages, référentiel). */
    sauverApprentissage(nom, data) {
      S.app[nom] = copie(data);
      reindexer();
      if (!this.db) { lsSet('app:' + nom, S.app[nom]); rendreDouce(); return Promise.resolve(); }
      return this.ecrireDernier('apprentissage/' + nom, () => S.app[nom]);
    },
    /** Ajoute, modifie ou retire une entrée d'une carte partagée (alias, coefficients, fournisseurs). */
    sauverEntree(nom, cle, valeur) {
      const carte = Object.assign({}, S.app[nom] || {});
      if (valeur == null) delete carte[cle]; else carte[cle] = copie(valeur);
      S.app[nom] = carte;
      reindexer();
      if (!this.db) { lsSet('app:' + nom, carte); rendreDouce(); return Promise.resolve(); }
      const chemin = 'apprentissage/' + nom;
      const maj = {}; maj[cle] = valeur == null ? { _supprime: true, le: new Date().toISOString() } : copie(valeur);
      return this.enchainer(chemin, async () => {
        const ref = this.db.doc(chemin);
        try { await ref.update(maj); } catch (e) { if (e && e.code === 'invalid_argument' && !(await ref.get()).exists) await ref.set(maj); else throw e; }
      });
    },
    async listerSemaines(forcer) {
      if (!this.db) {
        const out = [];
        try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.indexOf('brigade:semaine:') === 0) out.push(JSON.parse(localStorage.getItem(k))); } } catch (e) { /* rien */ }
        return out;
      }
      if (!forcer && this.cacheSemaines && Date.now() - this.cacheSemaines.le < 60000) return this.cacheSemaines.liste;
      try {
        const q = await this.db.collection('semaines').get();
        const liste = q.docs.filter(d => d.exists).map(d => copie(d.data()));
        this.cacheSemaines = { le: Date.now(), liste };
        return liste;
      } catch (e) { return []; }
    },
    /** Enregistre le retour de service d'une semaine (sans toucher au reste du document). */
    async ecrireRetour(cle, retour) {
      if (!this.db) { const doc = copie(lsGet('semaine:' + cle, null)) || semaineVide(cle); doc.retour = retour; lsSet('semaine:' + cle, doc); return; }
      this.cacheSemaines = null;
      const ref = this.db.doc('semaines/' + cle);
      await this.enchainer('semaines/' + cle, async () => {
        try { await ref.update({ retour }); } catch (e) { if (e && e.code === 'invalid_argument' && !(await ref.get()).exists) await ref.set({ cle, retour }); else throw e; }
      });
    },
    points(action, n) {
      const id = this.cleDoc(S.moi.id);
      const b = Object.assign({ points: 0, actions: {} }, copie(S.brigade[id]) || {});
      b.actions = Object.assign({}, b.actions); b.points = (b.points || 0) + n; b.actions[action] = (b.actions[action] || 0) + 1; b.maj = new Date().toISOString();
      S.brigade[id] = b; majMoi();
      if (S.lectureSeule) return;
      if (!this.db) { lsSet('brigade', S.brigade); return; }
      const k = 'brigade/' + id;
      this.enVol[k] = (this.enVol[k] || 0) + 1;
      this.ecrireDernier(k, () => S.brigade[id]).finally(() => { this.enVol[k]--; });
    },
  };
  /** Les choix du chef sont stockés en liste (les objets imbriqués fusionneraient avec l'ancien choix). */
  function choixVersMemoire(c) { return c ? { recettes: Object.keys(c.recettes || {}).map(k => [k, c.recettes[k]]), valide: !!c.valide } : { recettes: [], valide: false }; }
  function choixDepuisMemoire(c) {
    if (!c) return c;
    const r = {}; (Array.isArray(c.recettes) ? c.recettes : Object.entries(c.recettes || {})).forEach(([k, v]) => { if (v > 0) r[k] = v; });
    return { recettes: r, valide: !!c.valide };
  }
  function empreinte(s) {
    const f = {}; (s.fiches || []).forEach(x => { f[x.id] = JSON.stringify(x); });
    const ch = {}; Object.keys(s.choix || {}).forEach(k => { ch[k] = JSON.stringify(s.choix[k]); });
    return { fiches: f, choix: ch, stock: Object.assign({}, s.stock || {}), options: JSON.stringify(s.options || {}), pdf: JSON.stringify(s.pdf || null) };
  }
  /** Toute modification de la semaine passe par ici : on vérifie qu'on peut écrire, puis on note ce qui change. */
  function modifier(fn, sansRendu) {
    if (S.lectureSeule) { toast('Lecture seule : demandez un accès Contributeur pour modifier la semaine.'); return false; }
    if (S.chargement) { toast('La semaine partagée se charge encore : un instant…'); return false; }
    const avant = empreinte(S.semaine);
    fn(S.semaine);
    S.calc = null;
    Memoire.noter(avant, S.semaine);
    if (!sansRendu) rendre();
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Index et calcul
   * ------------------------------------------------------------------ */
  function reindexer() {
    const ref = S.app.referentiel && S.app.referentiel.catalogue ? S.app.referentiel : S.ref;
    S.idx = M.indexer(ref, S.con, S.app);
    S.calc = null;
  }
  function reglage(k, def) { const r = S.app.reglages || {}; return r[k] != null ? r[k] : def; }
  function appliquerChoix(p) {
    const o = S.semaine.choix && S.semaine.choix[p.id];
    if (o && p.type === 'choix') { p.recettes = Object.assign({}, o.recettes); p.valide = !!o.valide; p.modifie = true; }
    return p;
  }
  function calculer() {
    if (S.calc) return S.calc;
    const sem = S.sem;
    const evenements = [];
    (S.semaine.fiches || []).forEach(f => (f.jours || []).forEach(j => {
      if (!j.date || !M.dansSemaine(j.date, sem)) return;
      const postes = M.developperJour(f, j, S.idx, { decalage: 0 }).map(appliquerChoix);
      evenements.push({ fiche: f, jour: j, postes });
    }));
    evenements.sort((a, b) => a.jour.date.localeCompare(b.jour.date) || a.fiche.client.localeCompare(b.fiche.client));
    const opt = { margeDefaut: reglage('marge', 5) / 100, uneLivraison: !!(S.semaine.options && S.semaine.options.uneLivraison) };
    const besoins = M.calculerBesoins(evenements, S.idx, opt);
    const commandes = M.calculerCommandes(besoins, S.idx, S.semaine.stock, { maintenant: new Date() });
    const convives = evenements.reduce((s, e) => s + (e.postes.length ? (e.jour.convives || Math.max.apply(null, e.postes.map(p => p.convives || 0))) : 0), 0);
    const pieces = evenements.reduce((s, e) => s + e.postes.filter(p => p.type === 'choix' && /salees|speciales|navettes/.test(p.famille))
      .reduce((t, p) => t + Object.values(p.recettes || {}).reduce((u, n) => u + n, 0) * p.convives, 0), 0);
    S.calc = { sem, evenements, besoins, commandes, convives, pieces };
    return S.calc;
  }

  /* ------------------------------------------------------------------ *
   * Capacités Claude
   * ------------------------------------------------------------------ */
  async function initCapacites() {
    const C = window.claude;
    if (!C || typeof C.use !== 'function') return;
    const noms = ['db', 'sample', 'mcp', 'downloads', 'user', 'dictation'];
    const res = await Promise.all(noms.map(n => C.use(n).catch(() => null)));
    noms.forEach((n, i) => { S.caps[n] = res[i]; });
    if (S.caps.user) {
      try {
        const id = await S.caps.user.id(); if (id) S.moi.id = id;
        const me = await S.caps.user.me(); if (me && me.name) S.moi.nom = me.name.split(' ')[0];
        // can('data.write') : false = lecture seule ; null = non précisé, on laisse saisir et un refus bascule en lecture seule
        const peut = S.caps.user.can ? await S.caps.user.can('data.write') : null;
        if (peut === false && S.caps.db) S.lectureSeule = true;
      } catch (e) { /* anonyme */ }
    }
    if (S.caps.dictation) brancherDictee(S.caps.dictation);
  }
  function messageErreurClaude(e) {
    const c = e && e.code;
    return ({
      not_granted: 'Claude n’est pas autorisé pour cette page : la lecture se fait sans lui.',
      sampling_disabled: 'Claude n’est pas disponible pour ce compte.',
      rate_limited: 'Claude est très sollicité : réessayez dans un moment.',
      session_expired: 'Reconnectez-vous à Claude pour continuer.',
      prompt_too_large: 'Document trop long pour Claude : lecture locale conservée.',
      invalid_json: 'Réponse de Claude illisible : réessayez.',
      refused: 'Claude n’a pas pu traiter ce document.',
    })[c] || 'Claude n’a pas répondu (' + (c || 'erreur') + ').';
  }
  function claudeIndisponible(e) { return e && /not_granted|sampling_disabled|not_declared|capability_disabled|capability_removed/.test(e.code || ''); }

  function resumeForfaits() {
    return Object.values(S.idx.forfaits).map(f => '- ' + f.id + ' : ' + f.nom + (f.description ? ' — ' + f.description : '') + (f.horsCuisine ? ' (ne concerne pas la cuisine)' : '')).join('\n');
  }
  function resumeCatalogue() {
    return Object.values(S.idx.catalogue).map(p => p.code + ' ' + p.nom + ' [' + p.categorie + ']').join('\n');
  }
  function resumeAlias(n) {
    return Object.keys(S.app.alias || {}).slice(-(n || 60)).map(k => {
      const a = S.app.alias[k]; return '- « ' + (a.libelle || k).slice(0, 120) + ' » → ' + (a.forfaits || []).join(', ');
    }).join('\n') || '(rien encore)';
  }
  function resumeCarnet(n) {
    return ((S.app.carnet && S.app.carnet.notes) || []).slice(-(n || 15)).map(x => '- ' + x.texte).join('\n') || '(vide)';
  }
  async function claudeLire(texte, nomFichier, forcer) {
    const sample = S.caps.sample; if (!sample) return null;
    const prompt = `Tu aides la cuisine du Manoir de Procé (Nantes : séminaires, cocktails, repas assis, brunchs) à préparer ses commandes fournisseurs.
Lis ce document (un devis client ou une fiche de fonction « FF ») et extrais ce que la cuisine doit produire, jour par jour.

FORMULES DU MANOIR (identifiants à utiliser dans "forfaits") :
${resumeForfaits()}

PIÈCES ET PLATS DU CATALOGUE (code, nom, catégorie) :
${resumeCatalogue()}

CE QUE L'ÉQUIPE T'A DÉJÀ APPRIS (libellé → formules) :
${resumeAlias(60)}

NOTES DU CARNET :
${resumeCarnet(15)}

RÈGLES
- Une entrée "prestations" par ligne de devis (ou par bloc de la fiche) qui concerne la nourriture ou les boissons ; une ligne de location ou de frais peut être donnée avec le forfait "hors_cuisine".
- "forfaits" : uniquement des identifiants de la liste ci-dessus ; une ligne peut en avoir plusieurs (ex. « Location + DEJ + 1 verre de vin + Pause » → dejeuner_menu_chef, verre_vin, pause_boisson).
- Une formule qui en inclut d'autres (journee_travail inclut petit-déjeuner, déjeuner et pause) ne doit pas être répétée par ses sous-parties.
- "quantite" : le nombre de personnes ou d'unités de la ligne. "convives" du jour : le nombre final de personnes (une fiche de fonction prime sur un devis).
- "choix" : seulement les pièces ou plats explicitement nommés dans le document, avec leur code catalogue ; "nombre_par_convive" si indiqué.
- "exclus" : codes catalogue des pièces que le client refuse (« pas de nem », « sans porc » → les pièces concernées) ; jamais dans "choix".
- "repartition" : nombres de plats viande / poisson / vegetarien si le document les donne.
- "nombre_par_convive" de la prestation : nombre de pièces salées par personne si précisé (ex. 11 pièces salées).
- "jours" : une entrée par date d'événement présente dans le document ou dans le nom du fichier (format AAAA-MM-JJ). Les codes JJMMAA du nom de fichier sont des dates.
- "regimes" : végétariens, allergies, sans gluten, enfants… tels qu'écrits. "points_attention" : ce que le chef doit savoir (choix en attente, nombre non définitif…).
- N'invente rien. Ne recopie ni téléphone, ni e-mail, ni IBAN.

Réponds uniquement en JSON :
{"type_document":"devis|fiche_fonction|autre","client":"","evenement":"","horaires":"","regimes":[""],"points_attention":[""],"jours":[{"date":"AAAA-MM-JJ","convives":0,"prestations":[{"libelle":"","details":"","quantite":0,"forfaits":["id"],"confiance":0.9,"choix":[],"exclus":[],"repartition":null,"nombre_par_convive":null}]}]}
Format d'un élément de "choix" : {"code":"<code catalogue>","nombre_par_convive":<nombre ou null>}. "repartition", quand le document la donne : {"viande":<n>,"poisson":<n>,"vegetarien":<n>}. Laisse les listes vides et null quand le document ne dit rien.

NOM DU FICHIER : ${nomFichier}
DOCUMENT :
<<<
${texte.slice(0, 16000)}
>>>`;
    // même réglage de cache à chaque appel ; « relire » force une nouvelle lecture
    return sample.json(prompt, { modelTier: 'default', cache: forcer ? { gcTime: 300000, refresh: true } : { gcTime: 300000 } });
  }

  /* ------------------------------------------------------------------ *
   * Fiches : ajout, lecture, apprentissage
   * ------------------------------------------------------------------ */
  function appliquerAlias(fiche) {
    (fiche.jours || []).forEach(j => (j.prestations || []).forEach(p => {
      const a = S.app.alias && S.app.alias[M.cleAlias([p.libelle].concat(p.details || []).join(' · '))];
      if (a && a.forfaits) { p.forfaits = a.forfaits.slice(); p.via = 'alias'; p.confiance = 1; p.horsCuisine = p.forfaits.length > 0 && p.forfaits.every(id => S.idx.forfaits[id] && S.idx.forfaits[id].horsCuisine); }
    }));
    return fiche;
  }
  function assainirFiche(f) {
    f.client = nettoyer(f.client).slice(0, 80);
    f.evenement = nettoyer(f.evenement || '').slice(0, 120);
    f.regimes = (f.regimes || []).map(nettoyer);
    f.remarques = (f.remarques || []).map(nettoyer);
    (f.jours || []).forEach(j => (j.prestations || []).forEach(p => { p.libelle = nettoyer(p.libelle); p.details = (p.details || []).map(nettoyer); }));
    return f;
  }
  function ajouterFiche(texte, nom, source, extra) {
    // la semaine affichée sert de repère pour une date écrite sans année (« Vendredi 1er janvier »)
    const f = assainirFiche(appliquerAlias(M.lireDocument(texte, nom, S.idx, { annee: S.sem.lundi.getFullYear(), reference: M.iso(S.sem.lundi) })));
    Object.assign(f, { source, ajouteLe: new Date().toISOString(), ajoutePar: S.moi.id }, extra || {});
    // même fichier déjà là : on remplace
    let id = f.id; let k = 2;
    while (S.semaine.fiches.some(x => x.id === id && x.nomFichier !== f.nomFichier)) id = f.id + '-' + k++;
    f.id = id;
    if (!modifier(s => { s.fiches = s.fiches.filter(x => !(x.nomFichier === f.nomFichier && f.nomFichier)).concat([f]); })) return null;
    S.textes[f.id] = texte;
    Memoire.points('fiche', 1);
    if (S.caps.sample && texte.trim().length > 40) relireAvecClaude(f.id);
    return f;
  }
  const fileClaude = []; let claudeActifs = 0;
  function relireAvecClaude(id, forcer) {
    if (fileClaude.some(x => x.id === id)) return;
    S.lectures[id] = 'attente'; rendreSiVue('fiches');
    fileClaude.push({ id, forcer: !!forcer, cle: S.semaine.cle }); pomperClaude();
  }
  /** Reporte sur la nouvelle lecture ce que l'équipe a corrigé à la main (formules, lignes ignorées, dates, convives). */
  function garderCorrections(base, nv) {
    const parLib = {};
    (base.jours || []).forEach(j => (j.prestations || []).forEach(p => { if (p.via === 'main' || p.ignoree) parLib[M.cleAlias(p.libelle)] = p; }));
    nv.jours.forEach(j => {
      const old = (base.jours || []).find(o => o.date === j.date);
      if (old && old.convivesForces) { j.convives = old.convives; j.convivesForces = true; }
      (j.prestations || []).forEach(p => {
        const o = parLib[M.cleAlias(p.libelle)];
        if (o) { p.forfaits = o.forfaits.slice(); p.via = o.via; p.ignoree = !!o.ignoree; p.horsCuisine = o.horsCuisine; p.confiance = 1; }
      });
    });
    // un jour daté à la main que Claude n'a pas retrouvé reste
    (base.jours || []).forEach(j => { if (j.date && !nv.jours.some(x => x.date === j.date) && (j.prestations || []).some(p => p.via === 'main')) nv.jours.push(j); });
    nv.dates = nv.jours.map(j => j.date).filter(Boolean);
    return nv;
  }
  function pomperClaude() {
    while (claudeActifs < 2 && fileClaude.length) {
      const tache = fileClaude.shift(); const id = tache.id; claudeActifs++;
      const fiche = S.semaine.cle === tache.cle && S.semaine.fiches.find(x => x.id === id);
      const texte = S.textes[id];
      if (!fiche || !texte) { claudeActifs--; delete S.lectures[id]; continue; }
      S.lectures[id] = 'en-cours'; rendreSiVue('fiches');
      claudeLire(texte, fiche.nomFichier || fiche.client, tache.forcer).then(rep => {
        const base = S.semaine.cle === tache.cle && S.semaine.fiches.find(x => x.id === id);
        if (!base) { delete S.lectures[id]; return; } // semaine changée ou fiche décrochée entre-temps
        const nv = garderCorrections(base, assainirFiche(appliquerAlias(M.normaliserLectureClaude(rep, base, S.idx))));
        if (modifier(s => { s.fiches = s.fiches.map(x => x.id === id ? nv : x); }, true)) S.lectures[id] = 'claude';
        else delete S.lectures[id];
      }).catch(e => {
        S.lectures[id] = 'erreur:' + messageErreurClaude(e);
        if (claudeIndisponible(e)) {
          S.caps.sample = null;
          fileClaude.forEach(t => { delete S.lectures[t.id]; }); fileClaude.length = 0;
          toast(messageErreurClaude(e));
        }
      }).finally(() => { claudeActifs--; rendreSiVue('fiches'); pomperClaude(); });
    }
  }
  async function deposerFichiers(liste) {
    const fichiers = Array.from(liste || []);
    if (!fichiers.length) return;
    let n = 0;
    for (const fic of fichiers) {
      const nom = fic.name || 'document';
      const ext = (nom.split('.').pop() || '').toLowerCase();
      try {
        const buf = await fic.arrayBuffer();
        if (ext === 'xlsx' || ext === 'xls') { await importerClasseur(buf, nom); continue; }
        let texte = '';
        if (ext === 'pdf') texte = await texteDePdf(buf);
        else if (ext === 'docx') texte = await texteDeDocx(buf);
        else if (ext === 'doc') { toast('Ancien format Word (.doc) : enregistrez-le en .docx ou en PDF.'); continue; }
        else texte = new TextDecoder('utf-8').decode(buf);
        if (!texte.trim()) { toast(nom + ' : aucun texte lisible (document scanné ?).'); continue; }
        ajouterFiche(texte, nom, 'fichier'); n++;
      } catch (e) {
        console.error(e);
        toast(nom + ' : lecture impossible (' + (e.message || e) + ').');
      }
    }
    if (n) toast(n + (n > 1 ? ' fiches accrochées au passe.' : ' fiche accrochée au passe.'), 'Oui chef !');
  }
  async function importerClasseur(buf, nom) {
    const sheets = await lireClasseur(buf);
    const ref = M.parseReferentiel(sheets, nom);
    if (!ref.catalogue.length) { toast('Ce classeur ne contient pas d’onglet Catalogue reconnu.'); return; }
    ref.importeLe = new Date().toISOString().slice(0, 10);
    fenetre('Mettre à jour les fiches techniques ?', [
      h('p', null, nom + ' contient ' + ref.fournisseurs.length + ' fournisseurs, ' + ref.catalogue.length + ' pièces et plats, ' + ref.composants.length + ' lignes de composants et ' + ref.bar.length + ' boissons.'),
      h('p', { class: 'note' }, 'Toute la brigade utilisera ces grammages pour les prochains calculs.'),
    ], [
      { texte: 'Remplacer le référentiel', action: async () => { await Memoire.sauverApprentissage('referentiel', ref); reindexer(); rendre(); toast('Fiches techniques à jour.', 'Oui chef !'); } },
    ]);
  }

  /* ------------------------------------------------------------------ *
   * Google Drive (connecteur de l'utilisateur)
   * ------------------------------------------------------------------ */
  const DRIVE = 'Google Drive';
  const TYPES_DRIVE = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'application/vnd.google-apps.document', 'text/plain'];
  function codesSemaine() { return S.sem.jours.map(d => d.slice(8, 10) + d.slice(5, 7) + d.slice(2, 4)); }
  async function chercherDrive() {
    const mcp = S.caps.mcp; if (!mcp) return;
    const q = '(' + codesSemaine().map(c => "title contains '" + c + "'").join(' or ') + ') and trashed = false and (' + TYPES_DRIVE.map(t => "mimeType = '" + t + "'").join(' or ') + ')';
    const btn = $('#btnDrive'); btn.disabled = true; btn.textContent = 'Recherche dans le Drive…';
    try {
      const res = await mcp.callTool(DRIVE, 'search_files', { query: q, pageSize: 60, excludeContentSnippets: true });
      const p = res.payload || {};
      // seulement des devis et fiches (PDF, Word, Google Docs) : jamais de tableur ni de présentation
      const fichiers = (Array.isArray(p.files) ? p.files : []).filter(f => TYPES_DRIVE.indexOf(f.mimeType) >= 0);
      choisirFichiersDrive(fichiers);
    } catch (e) {
      const msg = ({
        server_not_connected: 'Ajoutez le connecteur Google Drive dans claude.ai › Réglages › Connecteurs.',
        needs_reauth: 'Reconnectez Google Drive dans claude.ai › Réglages › Connecteurs.',
        not_in_manifest: 'L’accès au Drive n’a pas été autorisé pour cette page.',
        approval_required: 'L’accès au Drive attend votre accord dans Claude.',
        blocked_by_policy: 'Votre organisation bloque l’accès au Drive depuis cette page.',
        selection_required: 'Choisissez quel compte Google Drive utiliser dans Claude.',
      })[e && e.code] || 'Le Drive n’a pas répondu (' + ((e && e.code) || 'erreur') + ').';
      toast(msg);
    } finally { btn.disabled = false; btn.textContent = 'Chercher dans le Drive'; }
  }
  function choisirFichiersDrive(fichiers) {
    const deja = new Set(S.semaine.fiches.map(f => f.driveId).filter(Boolean));
    if (!fichiers.length) { toast('Aucun devis ni fiche de fonction daté de cette semaine dans le Drive.'); return; }
    // une fiche de fonction prime sur le devis du même événement
    const ffDe = new Set(fichiers.filter(f => !/^devis/i.test(f.title)).map(f => (M.datesDepuisCodes(f.title)[0] || '') + '|' + M.slug(M.clientDepuisNomFichier(f.title))));
    const cases = fichiers.map(f => {
      const estDevis = /^devis/i.test(f.title);
      const cle = (M.datesDepuisCodes(f.title)[0] || '') + '|' + M.slug(M.clientDepuisNomFichier(f.title));
      const coche = !deja.has(f.id) && !(estDevis && ffDe.has(cle));
      const inp = h('input', { type: 'checkbox', 'data-id': f.id, 'data-titre': f.title, checked: coche });
      return h('label', null, inp, h('span', null, f.title, h('small', null,
        (estDevis ? 'Devis' : 'Fiche de fonction / autre') + (deja.has(f.id) ? ' · déjà accrochée' : '') + (estDevis && ffDe.has(cle) ? ' · la fiche de fonction du même événement est prioritaire' : ''))));
    });
    fenetre('Fiches trouvées dans le Drive', [h('p', { class: 'note' }, 'Documents dont le nom contient une date de la semaine (JJMMAA).'), h('div', { class: 'liste-choix' }, cases)], [{
      texte: 'Accrocher la sélection', action: async (fen) => {
        const choisis = $$('input[type=checkbox]', fen).filter(i => i.checked).map(i => ({ id: i.getAttribute('data-id'), titre: i.getAttribute('data-titre') }));
        let n = 0;
        for (const c of choisis) {
          try {
            const r = await S.caps.mcp.callTool(DRIVE, 'read_file_content', { fileId: c.id });
            const p = r.payload; const texte = typeof p === 'string' ? p : (p && (p.fileContent || p.content || p.text)) || '';
            if (!texte.trim()) { toast(c.titre + ' : contenu vide.'); continue; }
            ajouterFiche(texte, c.titre, 'drive', { driveId: c.id }); n++;
          } catch (e) { toast(c.titre + ' : lecture Drive impossible (' + ((e && e.code) || 'erreur') + ').'); }
        }
        if (n) toast(n + ' fiche(s) du Drive accrochée(s).', 'Oui chef !');
      },
    }]);
  }

  /* ------------------------------------------------------------------ *
   * Fenêtre modale
   * ------------------------------------------------------------------ */
  function fenetre(titre, corps, boutons) {
    const zone = $('#fenetre');
    const fermer = () => { vider(zone); document.removeEventListener('keydown', echap); };
    const echap = e => { if (e.key === 'Escape') fermer(); };
    const fen = h('div', { class: 'fenetre', role: 'dialog', 'aria-modal': 'true', 'aria-label': titre }, h('h2', null, titre), corps);
    const actions = h('div', { class: 'actions', style: { justifyContent: 'flex-end' } },
      h('button', { class: 'btn fantome', type: 'button', onclick: fermer }, 'Annuler'),
      (boutons || []).map(b => h('button', {
        class: 'btn ' + (b.classe || ''), type: 'button', onclick: async (ev) => {
          const bt = ev.currentTarget; bt.disabled = true;
          try { const garder = await b.action(fen); if (!garder) fermer(); } finally { bt.disabled = false; }
        },
      }, b.texte)));
    fen.appendChild(actions);
    vider(zone).appendChild(h('div', { class: 'fenetre-fond', onclick: e => { if (e.target === e.currentTarget) fermer(); } }, fen));
    document.addEventListener('keydown', echap);
    const premier = fen.querySelector('input,textarea,select,button.btn:not(.fantome)'); if (premier) premier.focus();
    return fen;
  }

  /* ------------------------------------------------------------------ *
   * Rendu : bandeau, ardoise
   * ------------------------------------------------------------------ */
  function majSemaineLibelle() {
    const l = $('#semLibelle'); vider(l);
    l.appendChild(document.createTextNode(S.sem.lundi.getDate() + ' ' + M.jourCourt(M.iso(S.sem.lundi)).split(' ').pop() + ' → ' + M.jourCourt(M.iso(S.sem.dimanche)).replace(/^\S+ /, '')));
    l.appendChild(h('small', null, 'Semaine ' + S.sem.numero));
  }
  const GRADES = [[0, 'Commis'], [20, 'Demi-chef de partie'], [60, 'Chef de partie'], [150, 'Sous-chef'], [300, 'Chef de cuisine']];
  function grade(p) { let g = GRADES[0][1]; GRADES.forEach(([s, n]) => { if (p >= s) g = n; }); return g; }
  const BADGES = [
    ['pdf', 1, 'Premier bon envoyé'], ['fiche', 20, 'Pilier du passe'], ['apprendre', 5, 'Mémoire d’éléphant'],
    ['inventaire', 3, 'Roi de la chambre froide'], ['retour', 3, 'Fin palais'], ['fournisseur', 3, 'Chasseur de prix'], ['menu', 10, 'Bras droit du chef'],
  ];
  function majMoi() {
    const b = S.brigade[Memoire.cleDoc(S.moi.id)] || { points: 0 };
    vider($('#moiToques')).append(String(b.points || 0), h('span', { class: 'mot-toques' }, ' toques'));
    $('#moiNom').textContent = S.moi.nom;
  }
  function ardoise(c) {
    const a = $('#ardoise'); vider(a);
    const fiches = (S.semaine.fiches || []).length;
    const fourn = c.commandes.bons.filter(b => b.livraisons.some(l => l.total > 0)).length;
    const prochain = c.commandes.bons.filter(b => b.prochaineLimite).sort((x, y) => x.prochaineLimite - y.prochaineLimite)[0];
    const bloc = (v, l, cls) => h('div', { class: 'bloc ' + (cls || '') }, h('div', { class: 'valeur num' }, v), h('div', { class: 'label' }, l));
    a.append(
      bloc(String(c.evenements.length), c.evenements.length > 1 ? 'services' : 'service'),
      bloc(String(c.convives), 'convives'),
      bloc(String(Math.round(c.pieces)), 'pièces cocktail'),
      bloc(String(fourn), fourn > 1 ? 'fournisseurs' : 'fournisseur'),
      h('div', { class: 'bloc large' }, h('div', { class: 'label' }, 'Prochaine commande'),
        h('div', { class: 'prochaine' }, prochain ? prochain.nom + ' — avant ' + dateHeure(prochain.prochaineLimite) : (fiches ? 'rien à commander pour l’instant' : 'déposez les fiches de la semaine'))),
    );
  }
  function dateHeure(d) {
    if (!d) return '';
    const j = M.jourCourt(M.iso(d));
    return j + ' ' + d.getHours() + 'h' + (d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : '');
  }
  const LIB_URGENCE = { retard: ['urgent', 'En retard'], aujourdhui: ['urgent', 'Aujourd’hui'], bientot: ['attention', 'Bientôt'], ok: ['ok', 'Large'] };

  /* ------------------------------------------------------------------ *
   * Vue 1 : fiches
   * ------------------------------------------------------------------ */
  function nomForfait(id) { const f = S.idx.forfaits[id]; return f ? f.nom : id; }
  function selectForfaits(onChoix) {
    const sel = h('select', { class: 'ajout', 'aria-label': 'Ajouter une formule' }, h('option', { value: '' }, '+ formule…'));
    const familles = {};
    Object.values(S.idx.forfaits).forEach(f => { (familles[f.famille || 'Autres'] = familles[f.famille || 'Autres'] || []).push(f); });
    Object.keys(familles).forEach(fam => sel.appendChild(h('optgroup', { label: fam }, familles[fam].map(f => h('option', { value: f.id }, f.nom)))));
    sel.addEventListener('change', () => { if (sel.value) onChoix(sel.value); sel.value = ''; });
    return sel;
  }
  function apprendre(prestation, forfaits) {
    const texte = [prestation.libelle].concat(prestation.details || []).join(' · ');
    const cle = M.cleAlias(texte);
    const ancien = (S.app.alias || {})[cle];
    Memoire.sauverEntree('alias', cle, { forfaits: forfaits.slice(), libelle: prestation.libelle.slice(0, 160), par: S.moi.id, le: new Date().toISOString(), n: ((ancien && ancien.n) || 0) + 1 });
    Memoire.points('apprendre', 3);
  }
  function majPrestation(ficheId, presId, fn, apprentissage) {
    if (S.lectures[ficheId] === 'attente' || S.lectures[ficheId] === 'en-cours') { toast('Claude relit cette fiche : attendez la fin de sa lecture pour la corriger.'); return; }
    const ok = modifier(s => {
      const f = s.fiches.find(x => x.id === ficheId); if (!f) return;
      f.jours.forEach(j => j.prestations.forEach(p => { if (p.id === presId) fn(p); }));
    });
    if (ok && apprentissage) {
      const f = S.semaine.fiches.find(x => x.id === ficheId);
      const p = f && f.jours.flatMap(j => j.prestations).find(x => x.id === presId);
      if (p) { apprendre(p, p.forfaits); toast('Noté : la prochaine fois je reconnaîtrai cette ligne.', 'Merci chef !'); }
    }
  }
  function rendreFiches(c) {
    const zone = $('#listeFiches'); vider(zone);
    const actions = $('#actionsFiches'); vider(actions);
    $('#btnDrive').hidden = !S.caps.mcp;
    if ((S.semaine.fiches || []).length) {
      actions.append(
        h('a', { class: 'btn', href: '#menu' }, 'Passer au menu du chef →'),
        h('button', { class: 'btn fantome petit', type: 'button', onclick: () => fenetre('Décrocher toutes les fiches ?', [h('p', null, 'Les fiches, les choix du chef et l’inventaire de cette semaine seront effacés.')], [{ texte: 'Tout décrocher', action: () => modifier(s => { s.fiches = []; s.choix = {}; s.stock = {}; }) }]) }, 'Vider la semaine'),
      );
    }
    if (S.chargement) { zone.appendChild(h('div', { class: 'vide' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), h('p', null, 'Chargement de la semaine partagée…'))); return; }
    if (!(S.semaine.fiches || []).length) {
      zone.appendChild(h('div', { class: 'vide' },
        h('div', { class: 'main-ecrite' }, 'Le passe est vide.'),
        h('p', null, S.caps.mcp ? 'Cherchez les fiches de la semaine dans le Drive, ou glissez-les ci-dessus.' : 'Glissez les devis et fiches de fonction de la semaine ci-dessus.'),
        h('div', { class: 'actions', style: { justifyContent: 'center' } },
          S.caps.mcp ? h('button', { class: 'btn', type: 'button', onclick: chercherDrive }, 'Chercher dans le Drive') : null,
          h('button', { class: 'btn clair', type: 'button', onclick: chargerExemple }, 'Essayer avec deux fiches d’exemple'))));
      return;
    }
    const rail = h('div', { class: 'rail' });
    S.semaine.fiches.slice().sort((a, b) => ((a.dates || [])[0] || '9').localeCompare((b.dates || [])[0] || '9')).forEach(f => rail.appendChild(ticketFiche(f)));
    zone.appendChild(rail);
  }
  function ticketFiche(f) {
    const lecture = S.lectures[f.id] || f.lecture;
    let statut;
    if (lecture === 'attente' || lecture === 'en-cours') statut = h('span', { class: 'statut-lecture' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), 'Claude relit la fiche…');
    else if (lecture === 'claude') statut = h('span', { class: 'puce info' }, 'Lue par Claude');
    else if (String(lecture).indexOf('erreur:') === 0) statut = h('span', { class: 'puce attention', title: lecture.slice(7) }, 'Lecture locale');
    else statut = h('span', { class: 'puce neutre' }, 'Lecture locale');
    const typeLib = f.type === 'fiche_fonction' ? 'Fiche de fonction' : f.type === 'devis' ? 'Devis' : 'Document';
    const t = h('article', { class: 'ticket', 'aria-label': f.client },
      h('div', { class: 'ticket-tete' },
        h('div', { style: { minWidth: 0 } }, h('h3', null, f.client || 'Client à préciser'), h('div', { class: 'sous' }, [typeLib, f.evenement, f.horaires].filter(Boolean).join(' · '))),
        h('button', { class: 'btn fantome petit', type: 'button', 'aria-label': 'Décrocher la fiche', title: 'Décrocher', onclick: () => modifier(s => { s.fiches = s.fiches.filter(x => x.id !== f.id); }) }, '✕')),
      h('div', { class: 'puces', style: { marginTop: '6px' } }, statut,
        f.source === 'drive' ? h('span', { class: 'puce neutre' }, 'Drive') : null, f.exemple ? h('span', { class: 'puce attention' }, 'Exemple') : null,
        S.caps.sample && S.textes[f.id] && lecture !== 'en-cours' && lecture !== 'attente' ? h('button', { class: 'lien', type: 'button', onclick: () => relireAvecClaude(f.id, lecture === 'claude'), style: { fontSize: '.78rem' } }, lecture === 'claude' ? 'relire' : 'faire relire par Claude') : null),
      f.nomFichier ? h('div', { class: 'ligne-fichier' }, f.nomFichier) : null,
      (f.regimes || []).length ? h('div', { class: 'regimes', style: { marginTop: '8px' } }, f.regimes.slice(0, 3).join(' · ')) : null,
      h('hr'),
    );
    const jours = h('div', { class: 'jours' });
    (f.jours || []).forEach((j, ji) => {
      const dedans = j.date && M.dansSemaine(j.date, S.sem);
      const conv = h('input', { type: 'number', min: '0', step: '1', value: j.convives || '', 'aria-label': 'Convives', inputmode: 'numeric' });
      conv.addEventListener('change', () => modifier(s => { const x = s.fiches.find(y => y.id === f.id); if (x) { x.jours[ji].convives = +conv.value || null; x.jours[ji].convivesForces = true; } }));
      let dateEl;
      if (j.date) dateEl = h('span', null, M.jourLong(j.date));
      else {
        dateEl = h('input', { type: 'date', 'aria-label': 'Date du service', style: { fontFamily: 'var(--f-ticket)' } });
        dateEl.addEventListener('change', () => modifier(s => { const x = s.fiches.find(y => y.id === f.id); if (x && dateEl.value) { x.jours[ji].date = dateEl.value; x.dates = x.jours.map(k => k.date).filter(Boolean); } }));
      }
      const bloc = h('div', { class: 'jour' + (dedans || !j.date ? '' : ' hors') },
        h('div', { class: 'jour-tete' }, dateEl, conv, h('span', null, 'convives'), !j.date ? h('span', { class: 'puce urgent' }, 'date introuvable') : (!dedans ? h('span', { class: 'puce neutre' }, 'hors semaine') : null)));
      (j.prestations || []).forEach(p => bloc.appendChild(blocPrestation(f, p)));
      if (!(j.prestations || []).length) bloc.appendChild(h('div', { class: 'note' }, 'Aucune ligne lue. Ajoutez une formule :', ' ', selectForfaits(id => modifier(s => {
        const x = s.fiches.find(y => y.id === f.id); if (x) x.jours[ji].prestations.push({ id: 'm' + Date.now(), libelle: nomForfait(id), details: [], forfaits: [id], quantite: null, via: 'main', confiance: 1 });
      }))));
      jours.appendChild(bloc);
    });
    t.appendChild(jours);
    // les remarques ⚠ du moteur (date ajoutée, convives introuvables…) restent visibles ; les autres se replient
    (f.remarques || []).filter(r => /^\s*⚠/.test(r)).forEach(r => t.appendChild(h('div', { class: 'alerte', style: { marginTop: '6px' } }, r)));
    const autres = (f.remarques || []).filter(r => !/^\s*⚠/.test(r));
    if (autres.length) t.appendChild(h('details', { style: { marginTop: '10px' } }, h('summary', { class: 'note' }, 'Remarques du document'), h('ul', { class: 'note' }, autres.map(r => h('li', null, r)))));
    return t;
  }
  function blocPrestation(f, p) {
    const forfaitsCuisine = (p.forfaits || []).filter(id => S.idx.forfaits[id] && !S.idx.forfaits[id].horsCuisine);
    let etat = 'ok';
    if (p.ignoree) etat = 'hors-cuisine';
    else if (p.horsCuisine) etat = 'hors-cuisine';
    else if (!forfaitsCuisine.length) etat = 'inconnu';
    else if (p.via !== 'alias' && p.via !== 'main' && (p.confiance || 0) < 0.65) etat = 'doute';
    const puces = h('div', { class: 'puces' });
    (p.forfaits || []).forEach(id => {
      const hors = S.idx.forfaits[id] && S.idx.forfaits[id].horsCuisine;
      puces.appendChild(h('span', { class: 'puce ' + (hors ? 'neutre' : etat === 'doute' ? 'attention' : 'ok') }, nomForfait(id),
        h('button', { type: 'button', 'aria-label': 'Retirer ' + nomForfait(id), onclick: () => majPrestation(f.id, p.id, x => { x.forfaits = x.forfaits.filter(y => y !== id); x.via = 'main'; x.horsCuisine = x.forfaits.length > 0 && x.forfaits.every(k => S.idx.forfaits[k] && S.idx.forfaits[k].horsCuisine); }, true) }, '×')));
    });
    puces.appendChild(selectForfaits(id => majPrestation(f.id, p.id, x => { x.forfaits = Array.from(new Set((x.forfaits || []).concat([id]))); x.via = 'main'; x.ignoree = false; x.horsCuisine = x.forfaits.every(k => S.idx.forfaits[k] && S.idx.forfaits[k].horsCuisine); }, true)));
    if (etat === 'inconnu' && !p.ignoree) puces.appendChild(h('span', { class: 'puce urgent' }, 'Que contient cette ligne ?'));
    if (p.appliqueATousLesJours) puces.appendChild(h('span', { class: 'puce attention', title: 'Ligne sans date dans un devis de plusieurs jours' }, 'comptée chaque jour'));
    const qte = p.quantite && p.quantite >= 2 ? h('span', { class: 'note num' }, ' · ' + p.quantite + ' pers.') : null;
    return h('div', { class: 'prestation ' + etat },
      h('div', { class: 'lib' }, p.libelle || '(sans libellé)', qte),
      (p.details || []).length ? h('div', { class: 'det' }, p.details.join(' · ').slice(0, 260)) : null,
      puces,
      !p.horsCuisine ? h('div', null, h('button', { class: 'lien', type: 'button', style: { fontSize: '.75rem', color: 'var(--encre-2)' }, onclick: () => majPrestation(f.id, p.id, x => { x.ignoree = !x.ignoree; }) }, p.ignoree ? 'compter cette ligne' : 'ne pas compter cette ligne')) : null);
  }
  function chargerExemple() {
    const lundi = S.sem.lundi;
    const d = n => M.ajouterJours(lundi, n);
    const code = x => String(x.getDate()).padStart(2, '0') + String(x.getMonth() + 1).padStart(2, '0') + String(x.getFullYear()).slice(2);
    const mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    const jj = x => x.getDate() + ' ' + mois[x.getMonth()] + ' ' + x.getFullYear();
    const devis = `EXEMPLE SÉMINAIRE\n\nDate : ${jj(d(1))} Horaires : 8h30-17h30 Evénement : Réunion d'équipe Nombre : 18 personnes\n\nLibellé Qté PU HT Montant HT TVA\n\nForfait journée de travail comprenant\n\\- La location d'un salon (Vidéoprojecteur + wifi)\n\\- Le petit-déjeuner d'accueil (1 boisson chaude + 1 jus de pomme Bio + 2 mini viennoiseries pur beurre)\n\\- Le déjeuner complet (Entrée + plat + dessert)\n\\- Une pause boisson en matinée ou après-midi\n18,00 50,00 € 900,00 € 20,00%\nForfait boissons (1 verre de vin + 1 boisson chaude) pendant le déjeuner 18,00 6,50 € 117,00 € 20,00%\nFrais de dossier 1,00 20,00 € 20,00 € 20,00%\nDevis gratuit`;
    const ff = `${jj(d(3))} – EXEMPLE COCKTAIL\nEvénement : soirée d'entreprise\nNombre : 40 personnes\nHoraires : 19h-23h\nRESTAURATION\n40 cocktails Procé\n11 pièces salées :\nCrevette croustillante & sauce aigre douce\nRillettes de poissons en navette briochée\nFalafel & yaourt aux herbes\nMini-croque-monsieur\n4 pièces sucrées : assortiment de mignardises Honoré\nPlateau de fromages Beillevaire pour 40\nBOISSONS\n40 forfaits boissons : 3 verres parmi crémant, vin, bière artisanale\nAllergies : 2 végétariens, 1 sans gluten`;
    ajouterFiche(devis, 'Devis Manoir de Procé - ' + code(d(1)) + ' - EXEMPLE SÉMINAIRE.pdf', 'exemple', { exemple: true });
    ajouterFiche(ff, code(d(3)) + ' - EXEMPLE COCKTAIL.docx', 'exemple', { exemple: true });
  }

  /* ------------------------------------------------------------------ *
   * Vue 2 : menu du chef
   * ------------------------------------------------------------------ */
  function nomPiece(code) { const p = S.idx.catalogue[code]; return p ? p.nom : code; }
  function estModelise(code) { return (S.idx.composants[code] || []).some(c => c.qteBase > 0) || !!(S.idx.con.achatsDirects || {})[code]; }
  function majChoix(poste, recettes, valide) {
    modifier(s => { s.choix = s.choix || {}; s.choix[poste.id] = { recettes, valide: !!valide }; });
  }
  function rendreMenu(c) {
    const zone = $('#listeMenu'); vider(zone);
    if (!c.evenements.length) { zone.appendChild(videVers('Pas encore de service cette semaine.', 'Accrochez d’abord les fiches.', '#fiches', 'Aller aux fiches')); return; }
    const parJour = {};
    c.evenements.forEach(e => { (parJour[e.jour.date] = parJour[e.jour.date] || []).push(e); });
    Object.keys(parJour).sort().forEach(date => {
      const evs = parJour[date];
      const conv = evs.reduce((s, e) => s + (e.jour.convives || 0), 0);
      const j = h('section', { class: 'journee' }, h('h2', null, M.jourLong(date), h('small', null, evs.length + (evs.length > 1 ? ' services · ' : ' service · ') + conv + ' convives')));
      evs.forEach(e => j.appendChild(carteService(e)));
      zone.appendChild(j);
    });
    zone.appendChild(h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#inventaire' }, 'Passer à l’inventaire →')));
  }
  function carteService(e) {
    const s = h('article', { class: 'service' },
      h('div', { class: 'service-tete' }, h('h3', null, e.fiche.client), h('span', { class: 'note' }, [e.jour.convives ? e.jour.convives + ' convives' : null, e.fiche.horaires].filter(Boolean).join(' · '))));
    if ((e.fiche.regimes || []).length) s.appendChild(h('div', { class: 'regimes' }, e.fiche.regimes.slice(0, 3).join(' · ')));
    if (!e.postes.length) { s.appendChild(h('div', { class: 'note' }, 'Rien à produire pour ce service (location, frais…).')); return s; }
    if (e.postes.some(p => p.convivesInconnus)) s.appendChild(h('div', { class: 'alerte' }, '⚠ Nombre de convives introuvable : saisissez-le sur la fiche (étape 1), sinon rien n’est commandé pour ce service.'));
    const avert = Array.from(new Set(e.postes.flatMap(p => p.avertissements || [])));
    avert.forEach(a => s.appendChild(h('div', { class: 'alerte' }, '⚠ ', a)));
    const fixes = e.postes.filter(p => p.type === 'fixe');
    e.postes.filter(p => p.type === 'choix').forEach(p => s.appendChild(blocChoix(p)));
    if (fixes.length) {
      s.appendChild(h('div', { class: 'poste' }, h('div', { class: 'poste-tete' }, h('strong', null, 'Inclus d’office')),
        h('div', { class: 'fixes' }, fixes.map(p => h('span', null, p.label + ' ', h('b', null, '×' + M.arrondi(p.parConvive, 2)), '/pers')))));
    }
    return s;
  }
  function blocChoix(p) {
    const statut = p.valide ? h('span', { class: 'puce ok' }, p.explicite && !p.modifie ? 'Choisi sur la fiche' : 'Validé par le chef')
      : p.partiel ? h('span', { class: 'puce info' }, 'Fiche + surprises du chef') : h('span', { class: 'puce attention' }, 'Proposition');
    const total = Object.values(p.recettes || {}).reduce((s, n) => s + n, 0);
    const unite = p.portionsParCode ? '' : ' / pers';
    const ligne = h('div', { class: 'recettes' });
    Object.keys(p.recettes || {}).forEach(code => {
      const n = p.recettes[code];
      const pas = n % 1 ? 0.5 : (n >= 1 ? 1 : 0.5);
      const chg = delta => { const r = Object.assign({}, p.recettes); r[code] = Math.max(0, M.arrondi(n + delta, 2)); if (!r[code]) delete r[code]; majChoix(p, r, p.valide); };
      const absolu = Math.round(n * p.convives);
      ligne.appendChild(h('span', { class: 'recette' + (estModelise(code) ? '' : ' non-modelise'), title: nomPiece(code) + ' : ' + absolu + ' au total' + (estModelise(code) ? '' : ' — fiche technique à compléter') },
        h('button', { type: 'button', 'aria-label': 'Moins de ' + nomPiece(code), onclick: () => chg(-pas) }, '−'),
        h('span', { class: 'nom' }, nomPiece(code)),
        h('span', { class: 'qte num' }, n < 1 ? absolu + ' port.' : '×' + M.arrondi(n, 2)),
        h('button', { type: 'button', 'aria-label': 'Plus de ' + nomPiece(code), onclick: () => chg(pas) }, '+')));
    });
    const restants = (p.pioche || []).filter(c => !(p.recettes || {})[c]);
    if (restants.length) {
      const sel = h('select', { class: 'ajout', 'aria-label': 'Ajouter une pièce' }, h('option', { value: '' }, '+ ajouter…'), restants.map(c => h('option', { value: c }, nomPiece(c) + (estModelise(c) ? '' : ' *'))));
      sel.addEventListener('change', () => { if (!sel.value) return; const r = Object.assign({}, p.recettes); r[sel.value] = p.portionsParCode ? (p.portionsParCode[sel.value] || 1) * p.parConvive : 1; majChoix(p, r, p.valide); });
      ligne.appendChild(sel);
    }
    const autre = () => {
      S.decalages[p.id] = (S.decalages[p.id] || 0) + 1;
      const codes = M.proposer(p.pioche, Math.max(1, Object.keys(p.recettes || {}).length || p.nbRecettes), S.idx, p.famille, S.decalages[p.id]);
      let r = M.repartir(p.parConvive, codes);
      if (p.portionsParCode) Object.keys(r).forEach(k => { r[k] = r[k] * (p.portionsParCode[k] || 1); });
      majChoix(p, r, false);
    };
    return h('div', { class: 'poste' },
      h('div', { class: 'poste-tete' }, h('strong', null, p.label), h('span', { class: 'note num' }, M.arrondi(total, 2) + (p.portionsParCode ? ' portion(s)' : ' pièce(s)') + unite + ' · ' + p.convives + ' pers.'), statut),
      ligne,
      h('div', { class: 'actions' },
        !p.valide ? h('button', { class: 'btn petit', type: 'button', onclick: () => { majChoix(p, p.recettes, true); Memoire.points('menu', 2); toast('Validé.', 'Oui chef !'); } }, 'Valider') : h('button', { class: 'btn fantome petit', type: 'button', onclick: () => majChoix(p, p.recettes, false) }, 'Rouvrir'),
        !p.explicite || p.modifie ? h('button', { class: 'btn clair petit', type: 'button', onclick: autre }, 'Autre proposition') : null,
        !p.portionsParCode && Math.abs(total - p.parConvive) > 0.01 ? h('span', { class: 'puce attention' }, 'prévu : ' + p.parConvive + ' / pers') : null));
  }
  function videVers(titre, texte, lien, bouton) {
    return h('div', { class: 'vide' }, h('div', { class: 'main-ecrite' }, titre), h('p', null, texte), lien ? h('a', { class: 'btn clair', href: lien }, bouton) : null);
  }

  /* ------------------------------------------------------------------ *
   * Vue 3 : inventaire express
   * ------------------------------------------------------------------ */
  function uniteSaisie(base) { return base === 'g' ? { u: 'kg', f: 1000 } : base === 'ml' ? { u: 'L', f: 1000 } : { u: base, f: 1 }; }
  function lignesInventaire(c) {
    const parCle = {};
    c.besoins.lignes.filter(l => l.type !== 'maison').forEach(l => {
      const k = M.cleProduit(l.fournisseurSlug, l.produit, l.base);
      const x = parCle[k] || (parCle[k] = { cle: k, produit: l.produit, fournisseur: l.fournisseur, base: l.base, qte: 0 });
      x.qte += l.qte;
    });
    return Object.values(parCle).sort((a, b) => a.fournisseur.localeCompare(b.fournisseur) || a.produit.localeCompare(b.produit));
  }
  function rendreInventaire(c) {
    const zone = $('#listeInventaire'); vider(zone);
    const act = $('#actionsInventaire'); vider(act);
    const lignes = lignesInventaire(c);
    if (!lignes.length) { zone.appendChild(videVers('Rien à inventorier.', 'L’inventaire se remplit dès qu’il y a des services dans la semaine.', '#fiches', 'Aller aux fiches')); return; }
    if (S.caps.dictation && S.caps.sample && !Dictee.indispo) act.appendChild(boutonDictee());
    act.appendChild(h('button', { class: 'btn', type: 'button', onclick: () => { Memoire.points('inventaire', 2); toast('Inventaire enregistré.', 'Oui chef !'); location.hash = '#bons'; } }, 'Inventaire fait →'));
    const parF = {};
    lignes.forEach(l => { (parF[l.fournisseur] = parF[l.fournisseur] || []).push(l); });
    const grille = h('div', { class: 'grille' });
    Object.keys(parF).forEach(fn => {
      const tb = h('tbody');
      parF[fn].forEach(l => {
        const us = uniteSaisie(l.base);
        const val = S.semaine.stock && S.semaine.stock[l.cle];
        const inp = h('input', { id: 'stock-' + M.slug(l.cle), class: 'stock-input', type: 'number', min: '0', step: us.f > 1 ? '0.1' : '1', inputmode: 'decimal', value: val ? M.arrondi(val / us.f, 3) : '', 'aria-label': 'En stock : ' + l.produit + ' (' + us.u + ')', placeholder: '0' });
        // pas de nouveau rendu : on garde le focus pour enchaîner la saisie au clavier
        inp.addEventListener('change', () => modifier(s => { s.stock = s.stock || {}; const v = parseFloat(String(inp.value).replace(',', '.')); if (v > 0) s.stock[l.cle] = v * us.f; else delete s.stock[l.cle]; }, true));
        tb.appendChild(h('tr', null, h('td', null, l.produit), h('td', { class: 'qte' }, M.formatQte(l.qte, l.base)), h('td', { class: 'qte' }, inp, ' ', h('span', { class: 'note' }, us.u))));
      });
      grille.appendChild(h('div', { class: 'carte' }, h('h3', null, fn), h('div', { class: 'tableau-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Produit'), h('th', { class: 'qte' }, 'Besoin'), h('th', { class: 'qte' }, 'En stock'))), tb))));
    });
    zone.appendChild(grille);
  }
  /** Dictée : un seul abonnement pour toute la session ; l'inventaire dicté est interprété au retour à « idle ». */
  const Dictee = { d: null, texte: '', etat: 'idle', bouton: null, indispo: false };
  function brancherDictee(d) {
    Dictee.d = d;
    d.onFinal(({ text }) => { Dictee.texte += text; });
    d.onState(({ state, reason }) => {
      Dictee.etat = state;
      if (state === 'idle') {
        if (reason === 'unavailable' || reason === 'not_granted') { Dictee.indispo = true; toast('Dictée indisponible ici : saisissez l\u2019inventaire au clavier.'); }
        else if (reason === 'rate_limited') toast('Le micro est occupé : réessayez dans un instant.');
        else if (reason === 'upstream_error') toast('Le micro ou la reconnaissance vocale a échoué : réessayez.');
        const t = Dictee.texte.trim(); Dictee.texte = '';
        if (t) interpreterDictee(t);
      }
      majBoutonDictee();
    });
  }
  function majBoutonDictee() {
    const btn = Dictee.bouton; if (!btn || !btn.isConnected) return;
    btn.hidden = Dictee.indispo;
    btn.textContent = Dictee.etat === 'idle' ? 'Dicter l\u2019inventaire' : Dictee.etat === 'finishing' ? 'Je note…' : 'J\u2019écoute… (cliquez pour finir)';
  }
  function boutonDictee() {
    const btn = h('button', { class: 'btn clair', type: 'button', id: 'btnDictee' }, 'Dicter l\u2019inventaire');
    Dictee.bouton = btn; majBoutonDictee();
    btn.addEventListener('click', () => {
      if (Dictee.etat !== 'idle') { Dictee.d.stop().catch(() => {}); return; }
      Dictee.texte = '';
      Dictee.d.start().catch(e => { if (e && e.code === 'not_granted') { Dictee.indispo = true; majBoutonDictee(); toast('Micro refusé : saisissez l\u2019inventaire au clavier.'); } });
    });
    return btn;
  }
  async function interpreterDictee(texte) {
    if (!S.caps.sample) return;
    const lignes = lignesInventaire(calculer()); // lignes du moment, pas celles d'un ancien rendu
    if (!lignes.length) return;
    toast('Claude range l\u2019inventaire dicté…');
    try {
      const rep = await S.caps.sample.json(`Inventaire dicté en cuisine : « ${texte.slice(0, 2000)} ».
Produits à commander cette semaine (index, produit, unité de saisie) :
${lignes.map((l, i) => i + ' | ' + l.produit + ' | ' + uniteSaisie(l.base).u).join('\n')}
Associe chaque quantité dictée au bon produit et convertis-la dans l'unité de saisie. Ignore ce qui ne correspond à aucun produit.
Réponds uniquement en JSON : [{"index":0,"quantite":1.5}]`, { modelTier: 'quick', cache: false });
      let n = 0;
      modifier(s => {
        s.stock = s.stock || {};
        (Array.isArray(rep) ? rep : []).forEach(x => { const l = lignes[+x.index]; const q = +x.quantite; if (l && q > 0) { s.stock[l.cle] = q * uniteSaisie(l.base).f; n++; } });
      });
      toast(n + ' ligne(s) remplie(s) à la voix.', 'Oui chef !');
    } catch (e) { toast(messageErreurClaude(e)); }
  }

  /* ------------------------------------------------------------------ *
   * Vue 4 : bons de commande
   * ------------------------------------------------------------------ */
  function texteBon(b, liv) {
    const lignes = liv.lignes.filter(l => l.aCommander > 0).map(l => '- ' + l.produit + ' : ' + qteCommande(l));
    return 'Bonjour,\nVoici la commande du Manoir de Procé pour une livraison le ' + M.jourLong(liv.date).toLowerCase() + ' :\n' + lignes.join('\n') + '\nMerci beaucoup !\nLa cuisine du Manoir de Procé';
  }
  function qteCommande(l) {
    if (l.colis && l.conditionnement) return l.colis + ' × ' + l.conditionnement + ' (' + M.formatQte(l.aCommander, l.base) + ')';
    return M.formatQte(l.aCommander, l.base) + (l.verres ? ' (' + Math.round(l.verres) + ' verres)' : '');
  }
  function rendreBons(c) {
    const zone = $('#listeBons'); vider(zone);
    $('#optUneLivraison').checked = !!(S.semaine.options && S.semaine.options.uneLivraison);
    const cmd = c.commandes;
    if (!cmd.bons.length && !cmd.nonModelises.length) { zone.appendChild(videVers('Aucun bon pour l’instant.', 'Les bons apparaissent dès qu’une fiche de la semaine contient des formules reconnues.', '#fiches', 'Aller aux fiches')); return; }
    const deja = S.semaine.pdf;
    zone.appendChild(h('div', { class: 'sortir' },
      h('p', null, h('strong', null, cmd.bons.length + ' fournisseurs, ' + cmd.bons.reduce((s, b) => s + b.livraisons.length, 0) + ' livraisons. '),
        deja ? 'PDF déjà sorti le ' + new Date(deja.le).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) + '.' : 'Vérifiez les quantités, puis sortez le PDF pour la cuisine.'),
      h('button', { class: 'btn laiton gros', type: 'button', id: 'btnPdf', onclick: sortirPdf }, 'Sortir le PDF de la semaine')));
    const grille = h('div', { class: 'bons' });
    cmd.bons.forEach((b, i) => grille.appendChild(ticketBon(b, i)));
    zone.appendChild(grille);
    if (cmd.maison.length) {
      const parJ = {};
      cmd.maison.forEach(l => { (parJ[l.dateBesoin] = parJ[l.dateBesoin] || []).push(l); });
      zone.appendChild(h('div', { class: 'carte' }, h('h3', null, 'Mise en place maison'), h('p', { class: 'note' }, 'À préparer en cuisine, pas à commander.'),
        h('div', { class: 'tableau-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Pour le'), h('th', null, 'Préparation'), h('th', { class: 'qte' }, 'Quantité'))),
          h('tbody', null, Object.keys(parJ).sort().flatMap(d => parJ[d].map(l => h('tr', null, h('td', null, M.jourCourt(d)), h('td', null, l.produit), h('td', { class: 'qte' }, M.formatQte(l.qte, l.base))))))))));
    }
    if (cmd.nonModelises.length || cmd.alertes.length) {
      zone.appendChild(h('div', { class: 'carte' }, h('h3', null, 'À compléter dans les fiches techniques'),
        h('p', { class: 'note' }, 'Ces pièces n’ont pas encore de grammages dans le classeur : elles ne sont pas commandées. Complétez l’onglet Composants puis redéposez le classeur.'),
        h('ul', null, cmd.nonModelises.map(n => h('li', null, h('strong', null, n.code + ' ' + n.nom), ' — ' + M.arrondi(n.portions, 1) + ' portions (' + Array.from(new Set(n.pour.map(x => x.client))).join(', ') + ')')),
          Array.from(new Set(cmd.alertes.map(a => a.code + ' : ' + a.ingredient + ' sans fournisseur'))).map(t => h('li', null, t)))));
    }
  }
  function ticketBon(b, i) {
    const f = b.infos || {};
    const u = LIB_URGENCE[b.urgence] || LIB_URGENCE.ok;
    const t = h('article', { class: 'bon' + (S.semaine.pdf ? ' envoye' : ''), style: { '--retard': (i * 0.12) + 's' } },
      h('div', { class: 'tampon', 'aria-hidden': 'true' }, 'ENVOYÉ'),
      h('div', { class: 'bon-tete' }, h('h3', null, b.nom), f.livre ? h('div', { class: 'livre' }, f.livre) : null),
      h('div', { class: 'infos' },
        f.contact ? h('span', null, 'Contact : ', h('b', null, nettoyerContactAffiche(f.contact))) : null,
        f.jours ? h('span', null, 'Livre : ', h('b', null, f.jours)) : null,
        f.delai ? h('span', null, 'Délai : ', h('b', null, f.delai)) : null,
        f.minimum ? h('span', null, 'Minimum : ', h('b', null, f.minimum)) : null,
        f.sitePro || f.site ? h('a', { href: lienSur(f.sitePro || f.site), target: '_blank', rel: 'noopener' }, 'site') : null),
    );
    b.livraisons.forEach(liv => {
      const ul = LIB_URGENCE[liv.urgence] || u;
      const tb = h('tbody');
      liv.lignes.forEach(l => {
        const pour = l.pour.map(x => x.client + ' ' + M.jourCourt(x.date)).filter((v, k, a) => a.indexOf(v) === k).join(', ');
        tb.appendChild(h('tr', { class: l.aCommander > 0 ? '' : 'zero', title: 'Pour : ' + pour + (l.coef !== 1 ? ' · ajusté ×' + l.coef + ' par les retours de service' : '') },
          h('td', null, l.produit, l.coef !== 1 ? h('span', { class: 'note' }, ' ×' + l.coef) : null, l.vpbDefaut ? h('span', { class: 'note' }, ' (' + l.verresParBouteille + ' verres/bout.)') : null),
          h('td', { class: 'qte col-sec' }, M.formatQte(l.besoin, l.base)),
          h('td', { class: 'qte col-sec' }, l.stock > 0 ? '−' + M.formatQte(l.stock, l.base) : ''),
          h('td', { class: 'qte fort' }, l.aCommander > 0 ? qteCommande(l) : (l.fond && l.reserve ? 'sur la réserve' : 'en stock'))));
      });
      const texte = texteBon(b, liv);
      t.appendChild(h('div', { class: 'livraison' },
        h('div', { class: 'livraison-tete' }, h('span', null, 'Livraison ' + M.jourLong(liv.date).toLowerCase()),
          liv.fond ? h('span', { class: 'puce neutre', title: 'Café, thé, jus en BIB… : vérifiez la réserve avant de commander' }, 'produits de fond') : null,
          liv.reportee ? h('span', { class: 'puce attention', title: 'L’heure limite de la première livraison est passée : la réserve doit couvrir jusque-là' }, 'reportée') : null,
          h('span', { class: 'puce ' + ul[0], title: [liv.delaiConnu ? '' : 'délai par défaut : 48 h', liv.heureFixe ? 'heure limite du fournisseur' : ''].filter(Boolean).join(' · ') }, 'commander avant ' + dateHeure(liv.limite))),
        h('div', { class: 'tableau-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Produit'), h('th', { class: 'qte col-sec' }, 'Besoin'), h('th', { class: 'qte col-sec' }, 'Stock'), h('th', { class: 'qte' }, 'À commander'))), tb)),
        liv.total ? h('div', { class: 'actions' }, h('button', { class: 'btn fantome petit', type: 'button', onclick: () => copier(texte) }, 'Copier le message de commande')) : null));
    });
    if (b.estimation > 0) t.appendChild(h('div', { class: 'note', style: { marginTop: '8px' } }, 'Estimation : ' + b.estimation.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) + ' HT (' + b.prixConnus + ' prix relevés)'));
    b.alertes.forEach(a => t.appendChild(h('div', { class: 'alerte' }, '⚠ ', a)));
    return t;
  }
  function nettoyerContactAffiche(c) { return String(c || '').slice(0, 60); }
  function lienSur(u) { const s = String(u || ''); return /^https:\/\//.test(s) ? s : '#'; }
  async function sortirPdf() {
    const btn = $('#btnPdf'); if (btn) { btn.disabled = true; btn.textContent = 'Le PDF se prépare…'; }
    try {
      await script(LIBS.jspdf); await script(LIBS.autotable);
      const c = calculer();
      const doc = window.RapportBrigade.generer({
        jsPDF: window.jspdf.jsPDF, Moteur: M, sem: S.sem, calc: c, idx: S.idx, auteur: S.moi.nom, le: new Date(),
      });
      const blob = doc.output('blob');
      const nom = 'Commandes Manoir de Procé - semaine ' + S.sem.numero + ' (' + M.iso(S.sem.lundi) + ').pdf';
      let ok = false;
      if (S.caps.downloads) {
        try { await S.caps.downloads.save({ filename: nom, data: blob }); ok = true; } catch (e) {
          if (e && e.code === 'declined') toast('Enregistrement annulé.'); else toast('Enregistrement impossible ici (' + ((e && e.code) || 'erreur') + ').');
        }
      } else { doc.save(nom); ok = true; }
      if (ok) {
        const habitudes = M.majHabitudes(S.app.habitudes || {}, c.evenements.flatMap(e => e.postes));
        Memoire.sauverApprentissage('habitudes', habitudes);
        const services = c.evenements.map(e => ({ client: e.fiche.client, date: e.jour.date, convives: e.jour.convives || null }));
        modifier(s => { s.pdf = { le: new Date().toISOString(), par: S.moi.id, resume: resumeCommandes(c), services }; }, true);
        rendre();
        Memoire.points('pdf', 5);
        toast('Les bons sont partis.', 'Envoyez !');
      }
    } catch (e) { console.error(e); toast('Le PDF n’a pas pu être créé : ' + (e.message || e)); }
    finally { const b = $('#btnPdf'); if (b) { b.disabled = false; b.textContent = 'Sortir le PDF de la semaine'; } }
  }
  /** Ce qui a été commandé, gardé pour le retour de service. */
  function resumeCommandes(c) {
    const lignes = {};
    c.commandes.bons.forEach(b => b.livraisons.forEach(liv => liv.lignes.forEach(l => {
      const k = l.cleStock; const x = lignes[k] || (lignes[k] = { cle: k, produit: l.produit, fournisseur: b.nom, base: l.base, besoin: 0, commande: 0 });
      x.besoin += l.besoin; x.commande += l.aCommander;
    })));
    return Object.values(lignes);
  }

  /* ------------------------------------------------------------------ *
   * Vue 5 : retour de service
   * ------------------------------------------------------------------ */
  async function rendreRetour() {
    const g = ++S.genRendu;
    const semaines = (await Memoire.listerSemaines()).filter(s => s && s.pdf && s.pdf.resume && s.pdf.resume.length).sort((a, b) => b.cle.localeCompare(a.cle));
    if (g !== S.genRendu || S.vue !== 'retour') return; // un rendu plus récent a pris la main
    const zone = $('#listeRetour'); vider(zone);
    const act = $('#actionsRetour'); vider(act);
    if (!semaines.length) { zone.appendChild(videVers('Pas encore de semaine à débriefer.', 'Le retour de service s’ouvre pour chaque semaine dont le PDF a été sorti.', '#bons', 'Aller aux bons')); return; }
    if (!S.retourCle || !semaines.some(s => s.cle === S.retourCle)) S.retourCle = (semaines.find(s => s.cle < S.semaine.cle) || semaines[0]).cle;
    const sel = h('select', { class: 'ajout', id: 'retourSemaine', 'aria-label': 'Semaine à débriefer' }, semaines.map(s => h('option', { value: s.cle, selected: s.cle === S.retourCle }, 'Semaine ' + s.cle.split('-S')[1] + ' (' + s.cle.slice(0, 4) + ')' + (s.retour ? ' · faite' : ''))));
    sel.addEventListener('change', () => { S.retourCle = sel.value; rendreRetour(); });
    act.appendChild(sel);
    const doc = semaines.find(s => s.cle === S.retourCle);
    // le brouillon (verdicts et mot du chef pas encore enregistrés) survit aux nouveaux rendus
    const br = S.brouillonRetour[doc.cle] || (S.brouillonRetour[doc.cle] = { verdicts: copie((doc.retour && doc.retour.lignes) || {}), note: (doc.retour && doc.retour.note) || '' });
    const verdicts = br.verdicts;
    const parF = {};
    doc.pdf.resume.filter(l => l.commande > 0 || l.besoin > 0).forEach(l => { (parF[l.fournisseur] = parF[l.fournisseur] || []).push(l); });
    const grille = h('div', { class: 'grille' });
    Object.keys(parF).sort().forEach(fn => {
      const tb = h('tbody');
      parF[fn].forEach(l => {
        const v = verdicts[l.cle] || {};
        const groupe = h('div', { class: 'verdicts', role: 'group', 'aria-label': l.produit });
        [['manque', 'Il manquait'], ['juste', 'Juste'], ['trop', 'En trop']].forEach(([k, lib]) => {
          const b = h('button', { type: 'button', 'data-v': k, 'aria-pressed': v.verdict === k ? 'true' : 'false' }, lib);
          b.addEventListener('click', () => { verdicts[l.cle] = { verdict: k, produit: l.produit }; $$('button', groupe).forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); });
          groupe.appendChild(b);
        });
        tb.appendChild(h('tr', null, h('td', null, l.produit, h('div', { class: 'note' }, 'commandé ' + M.formatQte(l.commande, l.base))), h('td', null, groupe)));
      });
      grille.appendChild(h('div', { class: 'carte' }, h('h3', null, fn), h('div', { class: 'tableau-wrap' }, h('table', null, tb))));
    });
    const note = h('textarea', { id: 'retourNote', placeholder: 'Ce qui s’est passé : pièces qui ont plu, restes, ruptures, nombre réel de convives…' }, br.note);
    note.addEventListener('input', () => { br.note = note.value; });
    const bulle = h('div', { class: 'claude-bulle', hidden: true });
    if (S.analyseRetour && S.analyseRetour.cle === doc.cle) afficherAnalyse(bulle, S.analyseRetour, doc.cle);
    const dejaFait = !!doc.retour;
    zone.append(grille,
      h('div', { class: 'carte' }, h('label', { class: 'champ' }, 'Le mot du chef', note), bulle,
        dejaFait ? h('p', { class: 'note' }, 'Retour déjà enregistré le ' + new Date(doc.retour.le).toLocaleDateString('fr-FR') + ' : un nouvel envoi ne réajuste que les produits dont le verdict a changé.') : null,
        h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', id: 'btnRetour', onclick: async (ev) => {
          const bt = ev.currentTarget;
          if (S.lectureSeule) { toast('Lecture seule : demandez un accès Contributeur.'); return; }
          bt.disabled = true;
          try {
            const anciens = (doc.retour && doc.retour.lignes) || {};
            const retour = { lignes: copie(br.verdicts), note: br.note.slice(0, 2000), le: new Date().toISOString(), par: S.moi.id };
            await Memoire.ecrireRetour(doc.cle, retour); // d'abord la semaine : sans elle, on n'ajuste rien
            // un produit déjà jugé avec le même verdict n'est pas réajusté une seconde fois
            for (const k of Object.keys(retour.lignes)) {
              const v = retour.lignes[k];
              if (anciens[k] && anciens[k].verdict === v.verdict) continue;
              const pk = M.slug(v.produit);
              const nv = M.ajusterCoefficient((S.app.coefficients || {})[pk], v.verdict); nv.produit = v.produit;
              await Memoire.sauverEntree('coefficients', pk, nv);
            }
            doc.retour = retour; S.brouillonRetour[doc.cle] = null;
            if (doc.cle === S.semaine.cle) S.semaine.retour = retour;
            if (!dejaFait) Memoire.points('retour', 5);
            toast('Retour enregistré : les prochaines quantités en tiennent compte.', 'Merci chef !');
            if (S.caps.sample) analyserRetour(doc, retour.lignes, retour.note, bulle);
          } catch (e) { Memoire.erreur(e); } finally { bt.disabled = false; }
        } }, S.caps.sample ? 'Enregistrer et demander l’avis de Claude' : 'Enregistrer le retour'))));
  }
  async function analyserRetour(doc, verdicts, note, bulle) {
    bulle.hidden = false; bulle.textContent = 'Claude tire les leçons de la semaine…';
    try {
      const rep = await S.caps.sample.json(`Tu es le second du chef au Manoir de Procé. Voici le retour de service de la semaine ${doc.cle}.
Services de la semaine : ${servicesDe(doc).join(' ; ') || 'non précisés'}
Verdicts par produit : ${Object.values(verdicts).map(v => v.produit + ' = ' + v.verdict).join(' ; ') || 'aucun'}
Le mot du chef : « ${note || '—'} »
Ce que tu sais déjà (carnet) :
${resumeCarnet(20)}
Tire 1 à 4 enseignements courts et concrets pour les prochaines commandes (quantités, pièces qui plaisent, fournisseurs, organisation). N'invente rien.
Réponds uniquement en JSON : {"resume":"une phrase","notes":["enseignement 1"]}`, { modelTier: 'default', cache: false });
      const notes = (rep && Array.isArray(rep.notes) ? rep.notes : []).map(String).filter(Boolean).slice(0, 4);
      S.analyseRetour = { cle: doc.cle, resume: (rep && rep.resume) || '', notes };
      const cible = document.querySelector('#listeRetour .claude-bulle') || bulle;
      afficherAnalyse(cible, S.analyseRetour, doc.cle);
    } catch (e) { bulle.textContent = messageErreurClaude(e); }
  }
  /** Services d'une semaine : résumé gardé avec le PDF (mémoire partagée) ou fiches (mémoire locale). */
  function servicesDe(doc) {
    if (doc.pdf && Array.isArray(doc.pdf.services)) return doc.pdf.services.map(x => x.client + ' (' + x.date + ', ' + (x.convives || '?') + ' pers.)');
    return (doc.fiches || []).map(f => f.client + ' (' + (f.dates || []).join(', ') + ', ' + (f.convives || '?') + ' pers.)');
  }
  function afficherAnalyse(bulle, a, cle) {
    bulle.hidden = false;
    vider(bulle).append(h('strong', null, a.resume || 'Ce que je retiens :'), h('ul', null, a.notes.map(n => h('li', null, n))));
    if (a.notes.length && !a.retenu) {
      bulle.appendChild(h('button', { class: 'btn petit', type: 'button', onclick: async (e) => {
        const bt = e.currentTarget; bt.disabled = true; a.retenu = true;
        const carnet = { notes: ((S.app.carnet && S.app.carnet.notes) || []).concat(a.notes.map(t => ({ texte: t, le: new Date().toISOString(), semaine: cle, source: 'retour' }))).slice(-120) };
        await Memoire.sauverApprentissage('carnet', carnet); toast('Ajouté au carnet de Claude.', 'Oui chef !');
      } }, 'Retenir dans le carnet'));
    }
  }

  /* ------------------------------------------------------------------ *
   * Fournisseurs : fiches, relevés, mission Claude dans Chrome
   * ------------------------------------------------------------------ */
  function produitsSemaine(slug) {
    const c = calculer();
    const b = c.commandes.bons.find(x => x.slug === slug);
    return b ? Array.from(new Set(b.livraisons.flatMap(l => l.lignes.map(x => x.produit + ' — ' + qteCommande(x))))) : [];
  }
  function missionChrome(fournisseurs) {
    const blocs = fournisseurs.map(f => {
      const prods = produitsSemaine(f.slug);
      return `• ${f.nom}${f.livre ? ' (' + f.livre + ')' : ''}
  Site : ${f.sitePro || f.site || 'à trouver'}
  Produits de la semaine : ${prods.length ? prods.join(' ; ') : 'relever les produits habituels'}`;
    }).join('\n');
    return `Mission pour Claude dans Chrome — cuisine du Manoir de Procé (Nantes)

Va sur le site de chaque fournisseur ci-dessous (si une connexion à l'espace pro est demandée, demande-moi de me connecter, ne saisis aucun mot de passe). Pour chacun, relève :
- l'heure limite et le délai de commande, les jours de livraison, le minimum de commande ;
- pour chaque produit listé : la référence la plus proche, le prix unitaire HT, l'unité de prix, le conditionnement, la disponibilité.
Ne passe aucune commande et n'ajoute rien au panier.

${blocs}

Quand tu as fini, réponds uniquement avec ce JSON (un objet par fournisseur) :
{"releves":[{"fournisseur":"","site":"","delai_commande":"ex. 48 h","heure_limite":"ex. 12h la veille","jours_livraison":"ex. mardi et vendredi","minimum":"","produits":[{"produit":"nom tel que listé ci-dessus","reference":"","prix_ht":0,"unite_prix":"kg|pièce|carton…","conditionnement":"ex. carton de 2 kg","disponible":true,"url":""}]}]}`;
  }
  function fenetreMission(fournisseurs) {
    const texte = missionChrome(fournisseurs);
    const zone = h('textarea', { readonly: true, style: { minHeight: '220px' }, 'aria-label': 'Mission à copier' }, texte);
    fenetre('Mission pour Claude dans Chrome', [
      h('ol', { class: 'note' }, h('li', null, 'Copiez la mission.'), h('li', null, 'Ouvrez Claude dans Chrome (l’extension, dans votre navigateur où vos comptes fournisseurs sont ouverts) et collez-la.'), h('li', null, 'Quand Claude a fini, copiez sa réponse et collez-la dans « Coller un relevé ».')),
      h('label', { class: 'champ' }, 'Mission', zone),
    ], [{ texte: 'Copier la mission', action: async () => { await copier(texte, zone); return true; } }]);
  }
  function fenetreReleve() {
    const zone = h('textarea', { placeholder: 'Collez ici la réponse de Claude dans Chrome (JSON), ou le texte d’une page de tarifs.', style: { minHeight: '200px' } });
    fenetre('Coller un relevé fournisseur', [h('label', { class: 'champ' }, 'Relevé', zone)], [{ texte: 'Enregistrer le relevé', action: async () => {
      const t = zone.value.trim(); if (!t) return true;
      let data = null;
      try { const m = t.match(/\{[\s\S]*\}/); data = JSON.parse(m ? m[0] : t); } catch (e) { data = null; }
      if (!data && S.caps.sample) {
        try {
          data = await S.caps.sample.json(`Extrais les informations fournisseurs de ce texte copié depuis un site ou un mail de fournisseur de la cuisine du Manoir de Procé. Fournisseurs connus : ${Object.values(S.idx.fournisseurs).map(f => f.nom).join(', ')}.
Réponds uniquement en JSON : {"releves":[{"fournisseur":"","delai_commande":"","heure_limite":"","jours_livraison":"","minimum":"","produits":[{"produit":"","prix_ht":0,"unite_prix":"","conditionnement":""}]}]}
TEXTE :
${t.slice(0, 12000)}`, { modelTier: 'default' });
        } catch (e) { toast(messageErreurClaude(e)); return true; }
      }
      if (!data) { toast('Je ne reconnais pas ce relevé : collez le JSON renvoyé par Claude dans Chrome.'); return true; }
      const n = await enregistrerReleves(data); toast(n + ' fournisseur(s) mis à jour.', 'Merci chef !'); return false;
    } }]);
    zone.focus();
  }
  async function enregistrerReleves(data) {
    const releves = Array.isArray(data) ? data : (data.releves || [data]);
    const four = JSON.parse(JSON.stringify(S.app.fournisseurs || {}));
    const modifies = [];
    let n = 0;
    releves.forEach(r => {
      if (!r || !r.fournisseur) return;
      const f = M.trouverFournisseur(S.idx, r.fournisseur);
      const k = f ? f.slug : M.slug(r.fournisseur);
      const x = four[k] || { nom: f ? f.nom : String(r.fournisseur).slice(0, 80) };
      if (r.delai_commande) x.delai = String(r.delai_commande).slice(0, 60);
      if (r.heure_limite) x.heureLimite = String(r.heure_limite).slice(0, 60);
      if (r.jours_livraison) x.jours = String(r.jours_livraison).slice(0, 80);
      if (r.minimum) x.minimum = String(r.minimum).slice(0, 60);
      if (r.site && /^https:\/\//.test(r.site)) x.site = String(r.site).slice(0, 200);
      x.prix = x.prix || {};
      (r.produits || []).forEach(p => {
        if (!p || !p.produit) return;
        const nomProd = String(p.produit).split(' — ')[0].trim();
        x.prix[M.slug(nomProd)] = { produit: nomProd.slice(0, 100), reference: String(p.reference || '').slice(0, 80), prix: +p.prix_ht || null, unite: String(p.unite_prix || '').slice(0, 30), conditionnement: String(p.conditionnement || '').slice(0, 60), disponible: p.disponible !== false, le: new Date().toISOString().slice(0, 10) };
      });
      x.majLe = new Date().toISOString().slice(0, 10); x.source = 'Claude dans Chrome';
      four[k] = x; n++;
      modifies.push(k);
    });
    for (const k of modifies) await Memoire.sauverEntree('fournisseurs', k, four[k]);
    reindexer(); rendre();
    if (n) Memoire.points('fournisseur', 3);
    return n;
  }
  function rendreFournisseurs(c) {
    const zone = $('#listeFournisseurs'); vider(zone);
    const act = $('#actionsFournisseurs'); vider(act);
    const actifs = c.commandes.bons.map(b => S.idx.fournisseurs[b.slug]).filter(Boolean);
    act.append(
      actifs.length ? h('button', { class: 'btn', type: 'button', onclick: () => fenetreMission(actifs) }, 'Mission de la semaine pour Claude dans Chrome') : null,
      h('button', { class: 'btn clair', type: 'button', onclick: fenetreReleve }, 'Coller un relevé'));
    const tous = Object.values(S.idx.fournisseurs).filter(f => f.slug !== 'production-maison').sort((a, b) => (actifs.indexOf(b) >= 0) - (actifs.indexOf(a) >= 0) || a.nom.localeCompare(b.nom));
    const grille = h('div', { class: 'grille' });
    tous.forEach(f => {
      const prix = Object.values(f.prix || {});
      const actif = actifs.indexOf(f) >= 0;
      grille.appendChild(h('article', { class: 'carte' },
        h('div', { class: 'poste-tete' }, h('h3', null, f.nom), actif ? h('span', { class: 'puce ok' }, 'commande cette semaine') : null),
        f.livre ? h('div', { class: 'note' }, f.livre) : null,
        h('div', { class: 'infos note', style: { display: 'grid', gap: '2px' } },
          h('span', null, 'Contact : ', h('b', null, f.contact || 'à renseigner')),
          h('span', null, 'Jours de livraison : ', h('b', null, f.jours || 'à renseigner')),
          h('span', null, 'Délai de commande : ', h('b', null, f.delai || 'à renseigner (48 h par défaut)'), f.heureLimite ? ' · ' + f.heureLimite : ''),
          h('span', null, 'Conditionnement : ', h('b', null, f.conditionnement || '—'), f.minimum ? ' · minimum ' + f.minimum : ''),
          f.modeCommande ? h('span', null, 'Commande : ', f.modeCommande) : null,
          f.infoDelai ? h('span', null, 'Sur le site : ', f.infoDelai) : null),
        h('div', { class: 'actions' },
          f.site ? h('a', { class: 'btn fantome petit', href: lienSur(f.site), target: '_blank', rel: 'noopener' }, 'Site') : null,
          f.sitePro ? h('a', { class: 'btn fantome petit', href: lienSur(f.sitePro), target: '_blank', rel: 'noopener' }, 'Espace pro') : null,
          h('button', { class: 'btn clair petit', type: 'button', onclick: () => fenetreMission([f]) }, 'Mission Chrome'),
          h('button', { class: 'btn fantome petit', type: 'button', onclick: () => modifierFournisseur(f) }, 'Modifier')),
        prix.length ? h('details', null, h('summary', { class: 'note' }, prix.length + ' prix relevés' + (f.majLe ? ' le ' + f.majLe : '')),
          h('div', { class: 'tableau-wrap' }, h('table', null, h('tbody', null, prix.map(p => h('tr', null, h('td', null, p.produit), h('td', { class: 'qte' }, p.prix != null ? p.prix.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) + ' / ' + (p.unite || '?') : '—'), h('td', { class: 'note' }, p.conditionnement || ''))))))) : null,
        f.sourceInfos ? h('div', { class: 'note' }, 'Infos : ' + f.sourceInfos) : null));
    });
    zone.appendChild(grille);
  }
  function modifierFournisseur(f) {
    const champs = [['contact', 'Contact (tél. ou mail)'], ['jours', 'Jours de livraison'], ['delai', 'Délai de commande (ex. 48 h)'], ['heureLimite', 'Heure limite (ex. 12h la veille)'], ['conditionnement', 'Conditionnement (ex. plateau de 2 kg)'], ['minimum', 'Minimum de commande'], ['site', 'Site (https://…)'], ['sitePro', 'Espace pro (https://…)']];
    const inputs = {};
    fenetre('Modifier ' + f.nom, [h('div', { class: 'deux' }, champs.map(([k, l]) => { inputs[k] = h('input', { value: f[k] || '', id: 'f-' + k }); return h('label', { class: 'champ' }, l, inputs[k]); })),
      h('p', { class: 'note' }, 'Ces informations complètent l’onglet Fournisseurs du classeur ; pensez à les reporter dans l’Excel.')], [{
      texte: 'Enregistrer', action: async () => {
        const four = JSON.parse(JSON.stringify(S.app.fournisseurs || {}));
        const x = four[f.slug] || { nom: f.nom };
        champs.forEach(([k]) => { const v = inputs[k].value.trim(); if (/^site/.test(k) && v && !/^https:\/\//.test(v)) return; x[k] = v; });
        x.majLe = new Date().toISOString().slice(0, 10); x.source = 'saisie dans l’appli';
        await Memoire.sauverEntree('fournisseurs', f.slug, x); rendre(); toast('Fournisseur à jour.', 'Oui chef !');
      },
    }]);
  }

  /* ------------------------------------------------------------------ *
   * Carnet de Claude
   * ------------------------------------------------------------------ */
  function rendreCarnet() {
    const zone = $('#listeCarnet'); vider(zone);
    const act = $('#actionsCarnet'); vider(act);
    if (S.caps.sample) act.appendChild(h('button', { class: 'btn', type: 'button', onclick: fairePoint, disabled: !!(S.pointClaude && S.pointClaude.enCours) }, 'Faire le point avec Claude'));
    const point = bullePoint(); if (point) zone.appendChild(point);
    const alias = S.app.alias || {}; const coefs = S.app.coefficients || {}; const hab = S.app.habitudes || {};
    const notes = (S.app.carnet && S.app.carnet.notes) || [];
    const grille = h('div', { class: 'grille' });
    // notes
    grille.appendChild(h('div', { class: 'carte' }, h('h3', null, 'Mes notes'),
      notes.length ? h('ul', null, notes.slice().reverse().slice(0, 30).map(n => h('li', null, n.texte, ' ', h('span', { class: 'note' }, (n.semaine || n.le || '').slice(0, 10)), ' ',
        // on relit le carnet au moment du clic et on retire la note par son horodatage, pas par sa position
        h('button', { class: 'lien', type: 'button', onclick: () => { const all = ((S.app.carnet && S.app.carnet.notes) || []).filter(x => !(x.le === n.le && x.texte === n.texte)); Memoire.sauverApprentissage('carnet', { notes: all }); } }, 'oublier'))))
        : h('p', { class: 'note' }, 'Vide pour l’instant. Les notes arrivent avec les retours de service et les points avec Claude.'),
      ajoutNote()));
    // libellés appris
    const cles = Object.keys(alias).sort((a, b) => (alias[b].le || '').localeCompare(alias[a].le || ''));
    grille.appendChild(h('div', { class: 'carte' }, h('h3', null, 'Libellés appris (' + cles.length + ')'),
      cles.length ? h('ul', null, cles.slice(0, 40).map(k => h('li', null, '« ' + (alias[k].libelle || k) + ' » → ', h('strong', null, (alias[k].forfaits || []).map(nomForfait).join(', ') || 'rien pour la cuisine'), ' ',
        h('button', { class: 'lien', type: 'button', onclick: () => Memoire.sauverEntree('alias', k, null) }, 'oublier'))))
        : h('p', { class: 'note' }, 'Quand vous corrigez une formule sur une fiche, je retiens le libellé ici.')));
    // habitudes du chef
    const familles = Object.keys(hab);
    grille.appendChild(h('div', { class: 'carte' }, h('h3', null, 'Habitudes du chef'),
      familles.length ? familles.map(fam => {
        const top = Object.keys(hab[fam]).sort((a, b) => hab[fam][b] - hab[fam][a]).slice(0, 6);
        return h('div', null, h('div', { class: 'etape' }, ((S.idx.con.choix || {})[fam] || {}).label || fam), h('div', { class: 'puces' }, top.map(c => h('span', { class: 'puce' }, nomPiece(c), ' · ' + M.arrondi(hab[fam][c], 1)))));
      }) : h('p', { class: 'note' }, 'Chaque PDF sorti m’apprend les pièces que le chef retient : elles remontent dans mes propositions.')));
    // coefficients
    const ajustes = Object.keys(coefs).filter(k => coefs[k].coef !== 1);
    grille.appendChild(h('div', { class: 'carte' }, h('h3', null, 'Quantités ajustées'),
      ajustes.length ? h('table', null, h('tbody', null, ajustes.map(k => h('tr', null, h('td', null, coefs[k].produit || k), h('td', { class: 'qte' }, (coefs[k].coef > 1 ? '+' : '') + Math.round((coefs[k].coef - 1) * 100) + ' %'), h('td', null, h('button', { class: 'lien', type: 'button', onclick: () => Memoire.sauverEntree('coefficients', k, null) }, 'remettre à zéro'))))))
        : h('p', { class: 'note' }, 'Les retours de service (il manquait, en trop) ajustent ici les quantités des prochaines commandes.')));
    // activité connue
    const act2 = S.con.activite;
    if (act2 && act2.parMois) {
      const mois = Object.keys(act2.parMois).sort();
      const max = Math.max.apply(null, mois.map(m => act2.parMois[m])) || 1;
      grille.appendChild(h('div', { class: 'carte' }, h('h3', null, 'Ce que je sais de votre activité'),
        act2.resume ? h('p', { class: 'note' }, act2.resume) : null,
        h('div', { class: 'barres', role: 'img', 'aria-label': 'Événements par mois' }, mois.slice(-12).map(m => h('div', { style: { height: Math.max(3, act2.parMois[m] / max * 100) + '%' }, title: m + ' : ' + act2.parMois[m] + ' événements' }, h('span', null, m.slice(5))))),
        h('div', { style: { height: '14px' } }),
        (act2.faits || []).length ? h('ul', { class: 'note' }, act2.faits.map(x => h('li', null, x))) : null));
    }
    // réglages
    const marge = h('input', { type: 'number', min: '0', max: '50', step: '1', value: reglage('marge', 5), id: 'regMarge' });
    marge.addEventListener('change', () => { Memoire.sauverApprentissage('reglages', Object.assign({}, S.app.reglages, { marge: Math.max(0, Math.min(50, +marge.value || 0)) })); S.calc = null; });
    const xl = h('input', { type: 'file', accept: '.xlsx,.xls', class: 'cache', id: 'regXlsx' });
    xl.addEventListener('change', () => deposerFichiers(xl.files));
    const refActif = S.app.referentiel && S.app.referentiel.catalogue ? S.app.referentiel : S.ref;
    grille.appendChild(h('div', { class: 'carte' }, h('h3', null, 'Réglages de la brigade'),
      h('label', { class: 'champ' }, 'Marge de sécurité par défaut (%) — quand le classeur n’en donne pas', marge),
      h('div', { class: 'note' }, 'Fiches techniques : ' + (refActif.source || 'classeur') + (refActif.importeLe ? ' (importé le ' + refActif.importeLe + ')' : '') + ' — ' + refActif.composants.length + ' lignes de composants.'),
      h('label', { class: 'btn clair petit', for: 'regXlsx' }, 'Importer le classeur à jour'), xl));
    zone.appendChild(grille);
  }
  function ajoutNote() {
    const inp = h('input', { class: 'ligne-saisie', placeholder: 'Apprendre quelque chose à Claude…', id: 'noteCarnet', 'aria-label': 'Nouvelle note pour Claude' });
    const f = h('form', { class: 'actions' }, inp, h('button', { class: 'btn petit', type: 'submit' }, 'Noter'));
    f.addEventListener('submit', e => {
      e.preventDefault(); const t = inp.value.trim(); if (!t) return;
      const notes = ((S.app.carnet && S.app.carnet.notes) || []).concat([{ texte: nettoyer(t).slice(0, 300), le: new Date().toISOString(), source: 'brigade', par: S.moi.id }]).slice(-120);
      Memoire.sauverApprentissage('carnet', { notes }); Memoire.points('apprendre', 1); inp.value = '';
    });
    return f;
  }
  /** Le point de Claude est gardé dans l'état : il survit aux nouveaux rendus du carnet. */
  function bullePoint() {
    const p = S.pointClaude; if (!p) return null;
    if (p.enCours) return h('div', { class: 'claude-bulle' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), ' Claude relit le carnet et la semaine…');
    if (p.erreur) return h('div', { class: 'claude-bulle' }, p.erreur);
    return h('div', { class: 'claude-bulle' }, h('strong', null, p.resume || 'Le point de Claude'),
      p.notes.length ? h('ul', null, p.notes.map(n => h('li', null, n))) : null,
      p.af.length ? h('div', null, h('div', { class: 'etape' }, 'À faire'), h('ul', null, p.af.map(n => h('li', null, n)))) : null,
      p.notes.length && !p.retenu ? h('button', { class: 'btn petit', type: 'button', onclick: async (e) => {
        const bt = e.currentTarget; bt.disabled = true; p.retenu = true;
        const carnet = { notes: ((S.app.carnet && S.app.carnet.notes) || []).concat(p.notes.map(t => ({ texte: t, le: new Date().toISOString(), source: 'point' }))).slice(-120) };
        await Memoire.sauverApprentissage('carnet', carnet); toast('Retenu.', 'Oui chef !');
      } }, 'Retenir ces notes') : null);
  }
  async function fairePoint() {
    if (S.pointClaude && S.pointClaude.enCours) return;
    const c = calculer();
    S.pointClaude = { enCours: true }; rendreSiVue('carnet');
    try {
      const semaines = (await Memoire.listerSemaines()).filter(s => s.pdf).slice(-8);
      const rep = await S.caps.sample.json(`Tu es le second du chef du Manoir de Procé. Fais le point sur ce que l'appli de commandes a appris et propose des améliorations concrètes.
Semaines passées (services, retours) :
${semaines.map(s => s.cle + ' : ' + servicesDe(s).join(', ') + (s.retour ? ' | retour : ' + Object.values(s.retour.lignes || {}).map(v => v.produit + ' ' + v.verdict).join(', ') + ' | ' + (s.retour.note || '') : '')).join('\n') || 'aucune'}
Semaine en cours : ${c.evenements.map(e => e.fiche.client + ' ' + e.jour.date + ' ' + e.jour.convives + 'p').join(', ') || 'vide'}
Pièces non modélisées cette semaine : ${c.commandes.nonModelises.map(n => n.code + ' ' + n.nom).join(', ') || 'aucune'}
Quantités ajustées : ${Object.values(S.app.coefficients || {}).map(x => (x.produit || '') + ' ×' + x.coef).join(', ') || 'aucune'}
Carnet :
${resumeCarnet(30)}
Réponds uniquement en JSON : {"resume":"2 phrases","notes":["enseignement durable à garder"],"a_faire":["action concrète pour l'équipe, ex. compléter la fiche technique de P024"]}`, { modelTier: 'default', cache: false });
      S.pointClaude = { resume: String((rep && rep.resume) || ''), notes: ((rep && rep.notes) || []).map(String).slice(0, 5), af: ((rep && rep.a_faire) || []).map(String).slice(0, 6) };
    } catch (e) { S.pointClaude = { erreur: messageErreurClaude(e) }; }
    rendreSiVue('carnet');
  }

  /* ------------------------------------------------------------------ *
   * Brigade
   * ------------------------------------------------------------------ */
  async function rendreBrigade() {
    const g = ++S.genRendu;
    const ids = Object.keys(S.brigade).sort((a, b) => (S.brigade[b].points || 0) - (S.brigade[a].points || 0));
    let profils = {};
    if (S.caps.user && ids.length) { try { profils = await S.caps.user.profiles(ids) || {}; } catch (e) { profils = {}; } }
    if (g !== S.genRendu || S.vue !== 'brigade') return; // un rendu plus récent a pris la main
    const zone = $('#listeBrigade'); vider(zone);
    const moiCle = Memoire.cleDoc(S.moi.id);
    const liste = h('div', { class: 'classement' });
    if (!ids.length) liste.appendChild(videVers('Personne n’a encore de toque.', 'Déposez une fiche pour gagner la première.', '#fiches', 'Aller aux fiches'));
    ids.forEach((id, i) => {
      const b = S.brigade[id];
      const nom = (profils[id] && profils[id].name) || (id === moiCle ? S.moi.nom : 'Membre de la brigade');
      const badges = BADGES.filter(([a, n]) => ((b.actions || {})[a] || 0) >= n).map(x => x[2]);
      liste.appendChild(h('div', { class: 'membre' }, h('div', { class: 'rang' }, String(i + 1)),
        h('div', null, h('strong', null, nom + (id === moiCle ? ' (moi)' : '')), h('div', { class: 'grade' }, grade(b.points || 0)), badges.length ? h('div', { class: 'badges' }, badges.map(x => h('span', { class: 'puce info' }, x))) : null),
        h('div', { class: 'pts num' }, String(b.points || 0), h('div', { class: 'note' }, 'toques'))));
    });
    zone.append(liste, h('div', { class: 'carte' }, h('h3', null, 'Comment gagner des toques'),
      h('table', null, h('tbody', null, [['Déposer une fiche', 1], ['Valider un poste du menu', 2], ['Faire l’inventaire', 2], ['Apprendre un libellé à Claude', 3], ['Relever les prix d’un fournisseur', 3], ['Sortir le PDF de la semaine', 5], ['Faire le retour de service', 5]]
        .map(([a, n]) => h('tr', null, h('td', null, a), h('td', { class: 'qte' }, '+' + n))))),
      h('p', { class: 'note' }, 'Grades : ' + GRADES.map(g => g[1] + ' (' + g[0] + ')').join(' · '))));
  }

  /* ------------------------------------------------------------------ *
   * Navigation et rendu
   * ------------------------------------------------------------------ */
  const VUES = ['fiches', 'menu', 'inventaire', 'bons', 'retour', 'fournisseurs', 'carnet', 'brigade'];
  function vueCourante() { const v = (location.hash || '').replace('#', ''); return VUES.indexOf(v) >= 0 ? v : 'fiches'; }
  function rendreSiVue(v) { if (S.vue === v) rendreDouce(); }
  /**
   * Rendu venu d'ailleurs (mémoire partagée, minuterie) : si quelqu'un saisit dans la page, on attend que le
   * curseur quitte la page (focusout vers l'extérieur) ; un clic sur un bouton de la page n'est jamais perdu.
   */
  function rendreDouce() {
    const a = document.activeElement;
    if (a && a.closest && a.closest('#app, #fenetre') && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { S.renduEnAttente = true; return; }
    rendre();
  }
  document.addEventListener('focusout', e => {
    if (!S.renduEnAttente) return;
    const vers = e.relatedTarget;
    if (vers && vers.closest && vers.closest('#app, #fenetre')) return; // le curseur reste dans la page
    setTimeout(() => { if (S.renduEnAttente) rendreDouce(); }, 0);
  });
  function rendre() {
    if (!S.idx || !S.semaine) return;
    S.renduEnAttente = false;
    const focus = document.activeElement && document.activeElement.id; // remis en place après le rendu
    rendreVue();
    if (focus) { const el = document.getElementById(focus); if (el && el !== document.activeElement && el.closest('#app')) el.focus(); }
  }
  function rendreVue() {
    if (S.lectureSeule && !$('#bandeauLecture')) $('#app').prepend(h('div', { id: 'bandeauLecture', class: 'claude-bulle', role: 'status' }, 'Lecture seule : vous voyez la semaine de l’équipe mais vos changements ne sont pas enregistrés. Demandez un accès Contributeur à la personne qui a partagé l’appli.'));
    S.vue = vueCourante();
    $$('.onglets a').forEach(a => { if (a.getAttribute('data-vue') === S.vue) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $$('.vue').forEach(v => { v.hidden = v.getAttribute('data-vue') !== S.vue; });
    const c = calculer();
    try {
      if (S.vue === 'fiches') { ardoise(c); rendreFiches(c); }
      else if (S.vue === 'menu') rendreMenu(c);
      else if (S.vue === 'inventaire') rendreInventaire(c);
      else if (S.vue === 'bons') rendreBons(c);
      else if (S.vue === 'retour') rendreRetour();
      else if (S.vue === 'fournisseurs') rendreFournisseurs(c);
      else if (S.vue === 'carnet') rendreCarnet();
      else if (S.vue === 'brigade') rendreBrigade();
    } catch (e) { console.error(e); toast('Affichage incomplet : ' + (e.message || e)); }
  }
  function allerSemaine(date) {
    Memoire.vidanger(); // ce qui a changé sur l'ancienne semaine part avant d'ouvrir la nouvelle
    S.semaineDate = date; S.sem = M.semaineDe(date);
    lsSet('semaine', M.iso(S.sem.lundi));
    majSemaineLibelle();
    Memoire.ouvrirSemaine(S.sem.cle);
    S.calc = null; rendre();
  }

  async function demarrer() {
    try {
      const [ref, con] = await Promise.all([fetch('data/referentiel.json').then(r => r.json()), fetch('data/connaissances.json').then(r => r.json())]);
      S.ref = ref; S.con = con;
    } catch (e) {
      vider($('#app')).appendChild(videVers('Données introuvables.', 'Les fichiers data/referentiel.json et data/connaissances.json doivent accompagner la page.'));
      return;
    }
    reindexer();
    // semaine : celle mémorisée, sinon la semaine prochaine (on commande en fin de semaine pour la suivante)
    const memo = M.deIso(lsGet('semaine', ''));
    const auj = new Date();
    const defaut = M.ajouterJours(auj, auj.getDay() >= 4 || auj.getDay() === 0 ? 7 : 0);
    S.sem = M.semaineDe(memo || defaut);
    const dansClaude = !!(window.claude && typeof window.claude.use === 'function');
    if (!dansClaude) await Memoire.init(null);
    allerSemaine(memo || defaut);
    // dans Claude, on attend de savoir si la mémoire partagée répond avant d'autoriser la saisie
    if (dansClaude) { S.chargement = true; rendre(); }
    majMoi();
    // capacités Claude : arrivent après le premier rendu
    initCapacites().then(async () => {
      if (S.caps.db) { await Memoire.init(S.caps.db); allerSemaine(S.semaineDate); }
      else if (dansClaude) { await Memoire.init(null); S.chargement = false; allerSemaine(S.semaineDate); }
      majMoi(); rendre();
    });
    // les heures limites vieillissent : on recalcule chaque minute et au retour sur l'onglet
    const rafraichir = () => { if (document.visibilityState === 'visible') { S.calc = null; rendreDouce(); } };
    setInterval(rafraichir, 60000);
    document.addEventListener('visibilitychange', rafraichir);
  }

  /* ------------------------------------------------------------------ *
   * Événements globaux
   * ------------------------------------------------------------------ */
  window.addEventListener('hashchange', rendre);
  $('#semPrec').addEventListener('click', () => allerSemaine(M.ajouterJours(S.sem.lundi, -7)));
  $('#semSuiv').addEventListener('click', () => allerSemaine(M.ajouterJours(S.sem.lundi, 7)));
  $('#moi').addEventListener('click', () => { location.hash = '#brigade'; });
  $('#fichiers').addEventListener('change', e => { deposerFichiers(e.target.files); e.target.value = ''; });
  $('#btnDrive').addEventListener('click', chercherDrive);
  $('#btnColler').addEventListener('click', () => {
    const zone = h('textarea', { placeholder: 'Collez le texte d’un devis ou d’une fiche de fonction…', style: { minHeight: '220px' } });
    const nom = h('input', { placeholder: 'ex. Devis Manoir de Procé - 111226 - CLIENT', id: 'nomColle' });
    fenetre('Coller un document', [h('label', { class: 'champ' }, 'Nom (avec la date JJMMAA si possible)', nom), h('label', { class: 'champ' }, 'Texte', zone)],
      [{ texte: 'Accrocher', action: () => { if (zone.value.trim()) { ajouterFiche(zone.value, nom.value.trim() || 'Texte collé', 'texte'); toast('Fiche accrochée.', 'Oui chef !'); } } }]);
  });
  $('#btnToutValider').addEventListener('click', () => {
    const c = calculer();
    modifier(s => { s.choix = s.choix || {}; c.evenements.forEach(e => e.postes.filter(p => p.type === 'choix').forEach(p => { s.choix[p.id] = { recettes: p.recettes, valide: true }; })); });
    Memoire.points('menu', 2); toast('Menu de la semaine validé.', 'Oui chef !');
  });
  $('#optUneLivraison').addEventListener('change', e => modifier(s => { s.options = Object.assign({}, s.options, { uneLivraison: e.target.checked }); }));
  const passe = $('#passe');
  ['dragenter', 'dragover'].forEach(t => document.addEventListener(t, e => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0) { e.preventDefault(); passe.classList.add('survol'); } }));
  ['dragleave', 'drop'].forEach(t => document.addEventListener(t, e => { if (t === 'dragleave' && e.relatedTarget) return; passe.classList.remove('survol'); }));
  document.addEventListener('drop', e => {
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    if (S.vue !== 'fiches') location.hash = '#fiches';
    deposerFichiers(e.dataTransfer.files);
  });
  // un relevé JSON collé n'importe où sur la page Fournisseurs
  document.addEventListener('paste', e => {
    if (S.vue !== 'fournisseurs' || (e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) return;
    const t = e.clipboardData && e.clipboardData.getData('text');
    if (t && /"releves"/.test(t)) { try { const m = t.match(/\{[\s\S]*\}/); enregistrerReleves(JSON.parse(m[0])).then(n => toast(n + ' fournisseur(s) mis à jour.', 'Merci chef !')); } catch (err) { toast('Relevé illisible.'); } }
  });

  window.Brigade = { S, calculer, rendre, Memoire }; // accès pour le débogage
  demarrer();
})();
