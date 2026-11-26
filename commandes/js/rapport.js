/*
 * La Brigade de Procé — PDF de la semaine (jsPDF + autotable).
 * 1. Couverture : services de la semaine et récapitulatif par fournisseur (heure limite de commande).
 * 2. Un bon par fournisseur : livraisons, cases à cocher, besoin / stock / à commander.
 * 3. Fiche de production : pièces et plats à produire par service.
 * 4. Mise en place maison, puis ce qui reste à compléter dans les fiches techniques.
 */
(function (root) {
  'use strict';
  const VERT = [47, 74, 58];
  const LAITON = [176, 141, 87];
  const ENCRE = [31, 42, 36];
  const GRIS = [100, 110, 104];
  const PALE = [236, 240, 233];

  /** Les polices standard du PDF ne connaissent que le jeu Windows-1252 : on remplace le reste. */
  function t(s) {
    return String(s == null ? '' : s)
      .replace(/[→⟶]/g, '->').replace(/[−–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
      .replace(/ | /g, ' ').replace(/…/g, '...').replace(/[✓✔]/g, 'v')
      .replace(/[^\u0000-ÿ€œŒšŠžŽŸƒ‚„†‡ˆ‰‹›•˜™]/g, '');
  }
  function heure(d) { return d ? d.getHours() + 'h' + (d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : '') : ''; }

  function generer(o) {
    const M = o.Moteur; const c = o.calc; const sem = o.sem;
    const doc = new o.jsPDF({ unit: 'mm', format: 'a4' });
    const L = 210; const marge = 14;
    const auto = (opts) => doc.autoTable(Object.assign({
      margin: { left: marge, right: marge, top: 18, bottom: 16 },
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.8, textColor: ENCRE, lineColor: [210, 214, 205], lineWidth: 0.2, overflow: 'linebreak' },
      headStyles: { fillColor: VERT, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: [249, 248, 243] },
      theme: 'grid',
    }, opts));
    const bandeau = (titre, sous) => {
      doc.setFillColor.apply(doc, VERT); doc.rect(0, 0, L, 26, 'F');
      doc.setFillColor.apply(doc, LAITON); doc.rect(0, 26, L, 1.6, 'F');
      doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text(t(titre), marge, 13);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.text(t(sous || ''), marge, 20.5);
      doc.setTextColor.apply(doc, ENCRE);
      return 36;
    };
    const titreSection = (y, texte) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor.apply(doc, VERT); doc.text(t(texte), marge, y);
      doc.setTextColor.apply(doc, ENCRE); doc.setFont('helvetica', 'normal');
      return y + 3;
    };
    const periode = 'Semaine ' + sem.numero + ' · du ' + M.jourLong(M.iso(sem.lundi)).toLowerCase() + ' au ' + M.jourLong(M.iso(sem.dimanche)).toLowerCase() + ' ' + sem.dimanche.getFullYear();

    /* ---------- 1. Couverture ---------- */
    let y = bandeau('Manoir de Procé - commandes de la cuisine', periode);
    doc.setFontSize(9); doc.setTextColor.apply(doc, GRIS);
    doc.text(t('Préparé par ' + (o.auteur || 'la brigade') + ' le ' + o.le.toLocaleDateString('fr-FR') + ' à ' + heure(o.le) + ' · ' + c.evenements.length + ' services · ' + c.convives + ' convives'), marge, y);
    doc.setTextColor.apply(doc, ENCRE);
    y = titreSection(y + 9, 'Les services de la semaine');
    auto({
      startY: y,
      head: [['Jour', 'Client', 'Formules', 'Conv.', 'Régimes / remarques']],
      body: c.evenements.map(e => {
        const formules = Array.from(new Set(e.jour.prestations.filter(p => !p.horsCuisine && !p.ignoree).flatMap(p => (p.forfaits || []).map(id => (o.idx.forfaits[id] || {}).nom || id).filter(n => !/Hors cuisine/.test(n)))));
        return [t(M.jourCourt(e.jour.date)), t(e.fiche.client), t(formules.join(', ')), String(e.jour.convives || ''), t((e.fiche.regimes || []).join(' · ').slice(0, 140))];
      }),
      columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 38, fontStyle: 'bold' }, 3: { cellWidth: 12, halign: 'right' }, 4: { cellWidth: 48 } },
    });
    y = doc.lastAutoTable.finalY + 10;
    y = titreSection(y, 'À commander');
    auto({
      startY: y,
      head: [['Fournisseur', 'Livraison(s)', 'Commander avant', 'Lignes', 'Estimation HT']],
      body: c.commandes.bons.map(b => [
        t(b.nom), t(b.livraisons.map(l => M.jourCourt(l.date)).join(', ')),
        t(b.livraisons.map(l => M.jourCourt(M.iso(l.limite)) + ' ' + heure(l.limite) + (l.delaiConnu ? '' : ' (délai ?)')).join(', ')),
        String(b.livraisons.reduce((s, l) => s + l.total, 0)),
        b.estimation > 0 ? t(b.estimation.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })) : '-',
      ]),
      columnStyles: { 0: { fontStyle: 'bold' }, 3: { halign: 'right', cellWidth: 16 }, 4: { halign: 'right', cellWidth: 28 } },
    });

    /* ---------- 2. Un bon par fournisseur ---------- */
    c.commandes.bons.forEach(b => {
      doc.addPage();
      const f = b.infos || {};
      let yy = bandeau('Bon de commande - ' + b.nom, f.livre || '');
      const infos = [
        f.contact ? 'Contact : ' + f.contact : null, f.jours ? 'Livre : ' + f.jours : null,
        f.delai ? 'Délai : ' + f.delai : 'Délai non renseigné (48 h retenues)', f.conditionnement ? 'Conditionnement : ' + f.conditionnement : null,
        f.minimum ? 'Minimum : ' + f.minimum : null, f.sitePro || f.site ? 'Site : ' + (f.sitePro || f.site) : null,
      ].filter(Boolean);
      doc.setFontSize(9); doc.setTextColor.apply(doc, GRIS);
      const lignesInfos = doc.splitTextToSize(t(infos.join('   ·   ')), L - 2 * marge);
      doc.text(lignesInfos, marge, yy); yy += lignesInfos.length * 4 + 4;
      doc.setTextColor.apply(doc, ENCRE);
      b.livraisons.forEach(liv => {
        if (yy > 250) { doc.addPage(); yy = 20; }
        doc.setFillColor.apply(doc, PALE); doc.roundedRect(marge, yy - 4.5, L - 2 * marge, 7.5, 1.2, 1.2, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
        doc.text(t('Livraison ' + M.jourLong(liv.date).toLowerCase()), marge + 2, yy + 0.5);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
        const lim = 'Commander avant ' + M.jourCourt(M.iso(liv.limite)) + ' ' + heure(liv.limite);
        doc.setTextColor.apply(doc, liv.urgence === 'retard' || liv.urgence === 'aujourdhui' ? [184, 67, 42] : ENCRE);
        doc.text(t(lim), L - marge - 2, yy + 0.5, { align: 'right' });
        doc.setTextColor.apply(doc, ENCRE);
        auto({
          startY: yy + 5,
          head: [['', 'Produit', 'Besoin', 'Stock', 'A commander', 'Pour']],
          body: liv.lignes.map(l => [
            '', t(l.produit + (l.coef !== 1 ? ' (x' + l.coef + ')' : '')), t(M.formatQte(l.besoin, l.base)), l.stock > 0 ? t('-' + M.formatQte(l.stock, l.base)) : '',
            l.aCommander > 0 ? t(l.colis && l.conditionnement ? l.colis + ' x ' + l.conditionnement : M.formatQte(l.aCommander, l.base) + (l.verres ? ' (' + Math.round(l.verres) + ' verres)' : '')) : 'en stock',
            t(Array.from(new Set(l.pour.map(x => x.client))).join(', ')),
          ]),
          columnStyles: { 0: { cellWidth: 7 }, 1: { cellWidth: 55 }, 2: { halign: 'right', cellWidth: 22 }, 3: { halign: 'right', cellWidth: 18 }, 4: { halign: 'right', fontStyle: 'bold', cellWidth: 34 }, 5: { fontSize: 7.5, textColor: GRIS } },
          didDrawCell: d => {
            if (d.section === 'body' && d.column.index === 0) {
              doc.setDrawColor.apply(doc, VERT); doc.setLineWidth(0.35);
              doc.rect(d.cell.x + 1.8, d.cell.y + d.cell.height / 2 - 1.7, 3.4, 3.4);
            }
          },
        });
        yy = doc.lastAutoTable.finalY + 9;
      });
      if (b.alertes.length) {
        doc.setFontSize(8.5); doc.setTextColor(168, 103, 11);
        b.alertes.forEach(a => { if (yy > 280) { doc.addPage(); yy = 20; } doc.text(t('! ' + a), marge, yy); yy += 4.5; });
        doc.setTextColor.apply(doc, ENCRE);
      }
    });

    /* ---------- 3. Fiche de production ---------- */
    doc.addPage();
    let yp = bandeau('Fiche de production', 'Ce que la cuisine produit, service par service');
    const corps = [];
    c.evenements.forEach(e => {
      const lignes = [];
      e.postes.forEach(p => {
        if (p.type === 'choix') Object.keys(p.recettes || {}).forEach(code => lignes.push([(o.idx.catalogue[code] || {}).nom || code, Math.round(p.recettes[code] * p.convives * 10) / 10]));
        else if (p.ref && p.ref.code) lignes.push([p.label, Math.round(p.parConvive * p.convives * 10) / 10]);
      });
      if (!lignes.length) return;
      corps.push([{ content: t(M.jourCourt(e.jour.date) + ' - ' + e.fiche.client + ' - ' + (e.jour.convives || '?') + ' convives' + (e.fiche.horaires ? ' - ' + e.fiche.horaires : '')), colSpan: 3, styles: { fillColor: PALE, fontStyle: 'bold' } }]);
      if ((e.fiche.regimes || []).length) corps.push([{ content: t('Régimes : ' + e.fiche.regimes.join(' · ')), colSpan: 3, styles: { textColor: [184, 67, 42], fontSize: 8.5 } }]);
      lignes.forEach(([nom, n]) => corps.push(['', t(nom), String(n).replace('.', ',')]));
    });
    if (corps.length) {
      auto({ startY: yp, head: [['', 'Pièce ou plat', 'Portions']], body: corps, columnStyles: { 0: { cellWidth: 7 }, 2: { halign: 'right', cellWidth: 24, fontStyle: 'bold' } } });
      yp = doc.lastAutoTable.finalY + 10;
    } else { doc.setFontSize(10); doc.text('Rien à produire cette semaine.', marge, yp); yp += 10; }

    /* ---------- 4. Mise en place maison et à compléter ---------- */
    if (c.commandes.maison.length) {
      if (yp > 230) { doc.addPage(); yp = 20; }
      yp = titreSection(yp, 'Mise en place maison');
      auto({ startY: yp, head: [['Pour le', 'Préparation', 'Quantité']], body: c.commandes.maison.map(l => [t(M.jourCourt(l.dateBesoin)), t(l.produit), t(M.formatQte(l.qte, l.base))]), columnStyles: { 0: { cellWidth: 26 }, 2: { halign: 'right', cellWidth: 30 } } });
      yp = doc.lastAutoTable.finalY + 10;
    }
    if (c.commandes.nonModelises.length) {
      if (yp > 230) { doc.addPage(); yp = 20; }
      yp = titreSection(yp, 'Non commandé : fiches techniques à compléter');
      auto({ startY: yp, head: [['Code', 'Pièce ou plat', 'Portions', 'Pour']], body: c.commandes.nonModelises.map(n => [n.code, t(n.nom), String(Math.round(n.portions * 10) / 10).replace('.', ','), t(Array.from(new Set(n.pour.map(x => x.client))).join(', '))]), headStyles: { fillColor: [168, 103, 11] }, columnStyles: { 0: { cellWidth: 14 }, 2: { halign: 'right', cellWidth: 20 } } });
    }

    /* ---------- pieds de page ---------- */
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor.apply(doc, GRIS);
      doc.text(t('La Brigade de Procé · ' + periode), marge, 290);
      doc.text(i + ' / ' + n, L - marge, 290, { align: 'right' });
    }
    return doc;
  }

  root.RapportBrigade = { generer, t };
  if (typeof module === 'object' && module.exports) module.exports = root.RapportBrigade;
})(typeof self !== 'undefined' ? self : this);
