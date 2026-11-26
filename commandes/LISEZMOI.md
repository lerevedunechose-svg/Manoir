# La Brigade de Procé — commandes cuisine

Mini-application de la cuisine du Manoir de Procé : on y dépose les **devis** et les **fiches de fonction** de la semaine, et elle sort un **PDF des bons de commande par fournisseur** (quantités, livraisons, heure limite pour commander), en s'appuyant sur le classeur *Fiches techniques cuisine*.

Elle est pensée pour être utilisée **dans Claude** (lien d'artefact partagé à l'équipe) : Claude y lit les fiches, l'équipe partage la même mémoire, et l'appli apprend de chaque semaine. Ouverte hors de Claude, elle fonctionne quand même (lecture locale des fiches, mémoire du navigateur, pas d'IA).

## Le déroulé d'une semaine

| Étape | Écran | Ce qui se passe |
|---|---|---|
| 1 | **Les fiches** | Glisser les devis (PDF du logiciel de facturation) et les fiches de fonction (Word/PDF), ou *Chercher dans le Drive* : l'appli retrouve les documents dont le nom contient une date de la semaine (`JJMMAA`). Chaque document devient un bon accroché au passe : jours, convives, formules reconnues. Une ligne mal comprise se corrige d'un clic, et l'appli retient la correction. |
| 2 | **Menu du chef** | Pour chaque service, les postes « au choix du chef » (11 pièces salées, entrée/plat/dessert, mises en bouche…) sont proposés : variés (mer/ferme/jardin, au moins une pièce végétarienne), de saison (recettes estivales de juin à septembre), et classés selon les habitudes du chef. On ajuste, on valide. |
| 3 | **Inventaire express** | On tape ce qui reste en chambre froide et en réserve (ou on le dicte) ; c'est déduit des commandes. |
| 4 | **Bons de commande** | Un bon par fournisseur et par livraison : besoin, stock, à commander (arrondi au conditionnement), heure limite (jours de livraison et délai du fournisseur). Bouton *Sortir le PDF*, et *Copier le message de commande* pour un SMS ou un mail. |
| 5 | **Retour de service** | Après la semaine : *il manquait / juste / en trop* par produit, et le mot du chef. Les quantités des semaines suivantes sont ajustées, et Claude en tire des notes pour son carnet. |

Écrans annexes : **Fournisseurs** (délais, prix relevés, *mission Claude dans Chrome*), **Carnet de Claude** (tout ce qui a été appris, réglages, import du classeur), **La brigade** (toques et grades de l'équipe).

## Comment les quantités sont calculées

```
portions = convives × pièces par personne (formule du devis, ou choix du chef)
besoin   = portions × grammage pour 1 pièce (onglet Composants) × (1 + marge) × ajustement appris
à commander = besoin − stock saisi, arrondi au conditionnement (ou à l'unité)
livraison   = la veille du service (le jour même pour Emma et Honoré),
              ramenée au dernier jour de livraison du fournisseur ;
              une seule livraison par semaine pour les fournisseurs à délai ≥ 3 jours
heure limite = livraison 8 h − délai de commande (48 h si non renseigné, signalé)
```

- Les pièces sans grammages dans le classeur ne sont **pas** commandées : elles apparaissent dans *À compléter* (écran Bons et dernière page du PDF).
- Quelques produits s'achètent tout faits (mignardises Honoré, pièces montées Emma, glaces Jampi, fromages Beillevaire, charcuterie de Talensac) : ils sont commandés directement (`data/connaissances.json` › `achatsDirects`).
- Boissons : les verres prévus (forfait 3 verres, verre de vin, boisson chaude…) sont répartis entre crémant, vins, bière, softs, café, puis convertis en bouteilles avec l'onglet *Bar* (« verres par bouteille ») ; à défaut, 6 verres par bouteille de 75 cl, signalé. Les bouteilles commandées par le client (« 3 AOC Côtes du Rhône… ») partent à la cave sous leur nom.
- Produits de fond (café Cime, thé, chocolat, jus en BIB, sirop) : une seule ligne par semaine. Sans inventaire saisi et sous un demi-conditionnement, ils sont « sur la réserve » ; si l'inventaire ne couvre pas le besoin, le manque est commandé. Une livraison qui arriverait après le service passe en URGENT.
- Ce que le moteur ne sait pas trancher est signalé par un ⚠ sur la fiche (titre de formule non compté, date ajoutée, convives introuvables) ou sur le menu du chef (plat halal absent du catalogue…).

## Travail à plusieurs

Dans Claude, chaque fiche est enregistrée à part, et les choix du chef et l'inventaire ligne par ligne : deux personnes peuvent travailler sur la même semaine sans s'écraser. Les saisies sont bloquées quelques secondes, le temps que la semaine partagée se charge. Une personne qui n'a qu'un accès en lecture voit un bandeau « Lecture seule » : il lui faut l'accès *Contributeur* (menu Partager de l'appli) pour saisir.

Avant d'être enregistrés, les textes des documents sont débarrassés des téléphones, e-mails et IBAN.

## Ce que Claude apprend, et où c'est rangé

Dans Claude, tout est partagé par l'équipe (mémoire de l'artefact) :

| Mémoire | Alimentée par | Sert à |
|---|---|---|
| Libellés appris | une formule corrigée sur une fiche | reconnaître ce libellé la fois suivante (et guider Claude quand il lit) |
| Habitudes du chef | chaque PDF sorti | classer les pièces proposées au menu du chef |
| Quantités ajustées | le retour de service | multiplier les grammages du produit (entre −40 % et +60 %) |
| Carnet de Claude | les analyses de retour, *Faire le point*, les notes de l'équipe | donner du contexte à Claude à chaque lecture de fiche |
| Fournisseurs | *Modifier*, les relevés de Claude dans Chrome | délais, jours, conditionnements et prix (estimation du coût des bons) |
| Fiches techniques | le classeur déposé sur la page | remplacer les grammages de `data/referentiel.json` |
| Pièces les plus choisies | l'analyse de 529 devis et fiches de fonction (2024-2027) | classer la proposition du chef dès le premier jour (`connaissances.json` › `statsChoix`) |
| Activité du Manoir | la même analyse | événements par mois et faits clés, dans le Carnet de Claude (`connaissances.json` › `activite`) |

Le moteur est vérifié par 81 tests (`tests/moteur.test.js`) et, sur les 529 documents analysés, reconnaît 92 % des lignes cuisine sans l'aide de Claude.

## Claude dans Chrome

Écran **Fournisseurs** › *Mission de la semaine pour Claude dans Chrome* : la mission (sites des fournisseurs, produits et quantités de la semaine, format de réponse) se copie et se colle dans l'extension Claude dans Chrome, dans votre navigateur où vos comptes pros sont ouverts. Claude y relève délais, jours de livraison et prix, sans rien commander. Sa réponse (JSON) se colle dans *Coller un relevé* : les fiches fournisseurs et les estimations de coût se mettent à jour.

## Fichiers

```
index.html                 la page (styles et écrans)
js/moteur.js               le moteur de calcul, sans dépendance (testé dans Node)
js/app.js                  l'interface et les capacités Claude (mémoire, Claude, Drive, téléchargement)
js/rapport.js              le PDF de la semaine
data/referentiel.json      le classeur Fiches techniques converti (fournisseurs, catalogue, composants, bar)
data/connaissances.json    les formules du Manoir (brochures 2026-2027), choix du chef, achats directs, boissons
outils/excel-vers-json.js  reconvertit le classeur : node outils/excel-vers-json.js "Fiches techniques.xlsx"
tests/moteur.test.js       tests du moteur : node --test commandes/tests/moteur.test.js
```

## Mettre à jour

- **Grammages, fournisseurs, bar** : compléter le classeur *Fiches techniques cuisine*, puis le glisser sur la page (ou *Carnet de Claude › Importer le classeur à jour*). Priorité donnée par la Notice du classeur : les vingt pièces cocktail et les six plats les plus fréquents.
- **Une nouvelle formule commerciale** : l'ajouter dans `data/connaissances.json` (`forfaits` : mots-clés, contenu par personne), ou simplement corriger les fiches dans l'appli : la correction est retenue.
