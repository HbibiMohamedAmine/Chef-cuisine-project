# Chef Cuisine Manager

Logiciel de gestion intégrée pour **un restaurant en Tunisie**, utilisé par **un seul utilisateur** : le chef cuisinier.
Interface 100 % française, devise **dinar tunisien (DT, 3 décimales)**.

> ⚠️ **Ce n'est pas un logiciel comptable certifié ni un système fiscal homologué.**
> Les indicateurs de marge et de résultat sont des outils de pilotage, jamais des bénéfices nets fiscaux.
> Les paramètres comptables et sociaux doivent être **validés par votre comptable** (écran *Paramètres comptables à valider*).

---

## 1. Stack et architecture

| Couche | Technologie |
|---|---|
| Frontend | React 18 + TypeScript + Tailwind CSS + Recharts |
| Backend | Node.js 22 + Express 5 |
| Base de données | **SQLite** (`better-sqlite3`) — fichier local, transactions ACID |
| Exports | PDF (PDFKit) + Excel (ExcelJS) + CSV |
| Empaquetage Windows | Electron (dossier `electron/`) |
| Tests | `node --test` — **41 tests** (formules + intégration) |

### Principe « local-first »
Aucun appel réseau sortant, aucune police externe, aucun CDN. Tout fonctionne **hors ligne**.
Le serveur écoute en local et sert l'API (`/api`) + l'application compilée (`dist/`).

### Séparation stricte des responsabilités
```
shared/formulas.js      ← TOUTES les formules métier (pur, testable, sans I/O)
server/services/*.js    ← logique métier + transactions (aucun calcul dans les routes)
server/routes/api.js    ← exposition HTTP uniquement (validation + appel service)
src/pages/*.tsx         ← présentation (aucun calcul métier)
src/components/ui.tsx   ← bibliothèque de composants (style shadcn/ui)
```

Les composants React **n'effectuent aucun calcul métier** : ils affichent le résultat des services
ou de `shared/formulas.js` (uniquement pour les aperçus instantanés, comme le simulateur).

---

## 2. Démarrage

```bash
npm install          # dépendances
npm run build        # compile le frontend dans dist/
npm start            # démarre sur http://localhost:3000
```

**Première connexion** : identifiant `chef`, mot de passe `chef1234`
→ à changer immédiatement (Paramètres → Sécurité). Le mot de passe est stocké en **hash scrypt**, jamais en clair.

Scripts utiles :

```bash
npm test             # 41 tests unitaires + intégration
npm run db:reset     # réinitialise la base et les données de référence
npm run backup       # sauvegarde manuelle en ligne de commande
```

---

## 3. Modules livrés

| # | Module | Écran | Statut |
|---|---|---|---|
| 1 | Tableau de bord + alertes configurables | `/` | ✅ |
| 2 | Produits, catégories, stocks, inventaires | `/produits`, `/stock` | ✅ |
| 3 | Fournisseurs, achats, réceptions, comparaison de prix | `/fournisseurs`, `/achats` | ✅ |
| 4 | Recettes et coût de revient (recalcul auto) | `/recettes` | ✅ |
| 5 | Trois cuisines distinctes | transverse | ✅ |
| 6 | Production cuisine centrale | `/production` | ✅ |
| 7 | Transformation, rendements, pertes normales/anormales | `/transformations` | ✅ |
| 8 | Cuisine du personnel (hors ventes) | `/cuisine-personnel` | ✅ |
| 9 | Transferts internes (brouillon/validé/annulé) | `/transferts` | ✅ |
| 10 | Avaries et pertes (anti-double comptage) | `/avaries` | ✅ |
| 11 | Ventes HT/TVA/TTC, rapprochement stock | `/ventes` | ✅ |
| 12 | Caisse, clôture journalière, écarts justifiés | `/caisse` | ✅ |
| 13 | Dépenses hors matières | `/depenses` | ✅ |
| 14 | Personnel, présences, paie paramétrable | `/personnel`, `/paie` | ✅ |
| 15 | Rapports mensuels, comparaisons, clôture/réouverture | `/rapports`, `/cloture` | ✅ |
| 16 | Simulateur & analyse de dépassement | `/analyses` | ✅ |
| 17 | Sécurité, audit, sauvegarde/restauration, intégrité | `/journal`, `/sauvegardes` | ✅ |

---

## 4. Formules implémentées (fichier `shared/formulas.js`)

| Formule | Fonction |
|---|---|
| Coût recette = Σ coûts ingrédients | `recipeTotalCost()` |
| Coût/portion = coût recette ÷ portions | `costPerPortion()` |
| Ratio plat % = (coût/portion ÷ prix HT/portion) × 100 | `dishCostRatio()` |
| Rendement % = (poids final ÷ poids initial) × 100 | `yieldPct()` |
| Taux de perte % = ((initial − final) ÷ initial) × 100 | `lossPct()` |
| Poids moyen/portion = poids final ÷ portions | `avgPortionWeight()` |
| Consommation valorisée = ouverture + achats − retours + ajustements − clôture | `valuedConsumption()` |
| Coût matière retenu = consommation + pertes **non déjà incluses** | `retainedMaterialCost()` |
| Ratio global % = (coût retenu ÷ CA HT) × 100 | `globalMaterialRatio()` |
| Coût maximal autorisé = CA HT × objectif | `maxAllowedCost()` |
| Marge restante = CA HT − coût retenu | `marginBeforeOtherCharges()` |
| Dépassement DT = max(0, retenu − max) ; écart en points | `overrunAmount()`, `ratioGapPoints()` |

### Test de référence (vérifié par test automatisé)
CA HT 100 000 · consommation 24 000 · avaries non incluses 4 000
→ **coût retenu 28 000 · ratio 28 % · objectif 30 % · coût max 30 000 · marge 72 000 DT**

---

## 5. Règles anti-double comptage — implémentation

| # | Règle | Mise en œuvre concrète |
|---|---|---|
| 1-2 | Transfert ≠ achat ≠ consommation | Les transferts ne créent que 2 mouvements internes (`transfert_sortie` / `transfert_entree`), même coût unitaire des deux côtés. Aucune ligne d'achat, aucun impact sur le CA. |
| 3 | Production : pas de « ingrédients + produit fini » | **Périmètre matières** (`matiere_premiere`, `ingredient_repas`, `consommable`) vs **périmètre fabriqué** (`semi_fini`, `fini`, `perdu`). Le solde matière est calculé **uniquement** sur le premier. Le coût du produit fabriqué n'est jamais rajouté. |
| 4 | Avarie déjà incluse non doublée | Champ `losses.already_in_consumption`. Seules les avaries à `0` alimentent `lossesNotIncluded` du ratio. |
| 5 | Repas du personnel ≠ ventes | Table `kitchens` dédiée, mouvement `consommation_repas`. Aucune ligne dans `sales`. Le paramètre `staff_meals_in_ratio` (défaut **false**) **retire** ce coût du ratio — il ne l'ajoute jamais. |
| 6 | Toute correction justifiée et tracée | `adjustStock()` exige un motif et journalise avant/après. Triggers SQL interdisant `DELETE`/`UPDATE` sur `stock_movements`. |
| 7 | Coûts cohérents source/destination | Coût unitaire unique écrit dans les deux mouvements de transfert. |
| 8 | Ratio calculé sur le CA HT de la même période | `computePeriod(from, to)` utilise `revenueHt(from, to)` sur les ventes **validées**. |
| 9 | Périodes clôturées traçables | `monthly_closings` + `monthly_closing_logs` + audit `critical` à chaque réouverture. |
| 10 | Drill-down | `explainPost()` renvoie les opérations détaillées de chaque poste (achats, retours, ajustements, avaries, stock d'ouverture/clôture, ventes). |

### ⚠️ Correctif comptable important (détecté par les tests E2E)
Un **stock initial** saisi **pendant** la période (création d'un produit avec quantité de départ) n'est
ni un achat fournisseur ni un stock d'ouverture. Sans terme dédié, la formule
`ouverture + achats − clôture` produisait une **consommation négative** (ratio aberrant).

Correction apportée : `initialStockValue()` ajoute ce terme comme une injection de valeur.
Vérifié : consommation **−116 → +84 DT**, ratio **−241 % → 175 %** sur le jeu de test.

---

## 6. Modèle de données (34 tables)

`settings`, `kitchens`, `units`, `product_categories`, `products`, `suppliers`, `purchases`,
`purchase_items`, `stock_movements`, `stock_counts`, `stock_count_items`, `sequences`, `recipes`,
`recipe_items`, `productions`, `production_items`, `transformations`, `transfers`, `losses`,
`loss_types`, `sales`, `sale_items`, `cash_movements`, `cash_closings`, `expenses`, `employees`,
`attendance`, `payroll_records`, `monthly_closings`, `monthly_closing_logs`, `audit_logs`,
`backups`, `app_errors`, `sessions`.

### Le stock est **dérivé**, jamais stocké
`stock_movements` est l'unique source de vérité. Les vues `v_stock`, `v_stock_product`,
`v_stock_valued` recalculent les quantités. **Aucun `UPDATE products SET qty = …`** n'existe.

**Triggers de protection** : suppression et modification des quantités sont **impossibles**
(`trg_sm_no_delete`, `trg_sm_no_update`) → correction obligatoire par contre-écriture.

---

## 7. Sécurité et fiabilité

- **Authentification** : utilisateur unique, mot de passe hashé scrypt (N=16384), sessions en base,
  cookie `HttpOnly`, limitation des tentatives (5 essais / 5 minutes).
- **Journal d'audit** : ajout seul, sévérités `info / warning / critical` (clôtures, réouvertures, restaurations).
- **Sauvegardes** : `VACUUM INTO` (copie cohérente même base ouverte) + manifeste SHA-256.
  Restauration impossible sans saisir `RESTAURER` ; sauvegarde `pre_restauration` automatique.
- **Sauvegarde auto** : déclenchée à la première requête après l'heure paramétrée (compatible sans tâche planifiée).
- **Intégrité** : `PRAGMA integrity_check`, `foreign_key_check`, stocks négatifs (tolérés **uniquement**
  s'ils sont couverts par un transfert forcé justifié), mouvements orphelins, transferts validés incomplets.
- **Reprise après arrêt brutal** : `journal_mode = WAL` + `synchronous = NORMAL`, arrêt propre sur SIGINT/SIGTERM.
- **Soft delete** : produits, fournisseurs, recettes, employés → archivage, jamais de suppression physique.
- **Atomicité** : réception, production, transformation, transfert, vente, inventaire, clôture sont enveloppés
  dans `transaction()` (`BEGIN IMMEDIATE` → `ROLLBACK` complet en cas d'erreur).

---

## 8. Tests (41 / 41 ✅)

```bash
npm test
```

**Couverture** :
- 19 tests de formules pures (dont le test de référence obligatoire et le test du riz)
- 22 tests d'intégration sur base SQLite réelle, un par critère d'acceptation :
  création produit/unicité, réception → stock, production atomique, transformation 10 kg → 7,5 kg,
  **test du riz 50 kg / 10 kg**, transfert > stock bloqué, avarie → stock + rapport,
  avarie déjà incluse non doublée, repas personnel ≠ ventes, clôture cohérente,
  réouverture tracée, sauvegarde/restauration, ventes HT/TVA/TTC, recalcul de recette,
  inventaire justifié, rollback atomique.

---

## 9. Empaquetage Windows (Electron)

Le dossier `electron/` contient le processus principal. Pour l'activer :

```bash
npm run build
npx electron electron/main.cjs
```

Le processus principal :
1. fixe `CCM_DB_PATH` vers `%APPDATA%/chef-cuisine-manager/chef-cuisine.db`
   (jamais dans le dossier d'installation, qui est en lecture seule),
2. démarre le serveur Express sur un port libre en `127.0.0.1`,
3. ouvre une `BrowserWindow` sur l'application.

Aucune réécriture du code applicatif n'est nécessaire : le serveur ignore s'il est lancé par Electron ou par Node.

---

## 10. Limites connues et travail restant

**Limites assumées**
- Application **mono-poste** : pas de synchronisation multi-machines (par conception, local-first).
- Pas de gestion multi-utilisateurs ni de rôles (exigence : un seul administrateur).
- Le plan comptable normalisé et les journaux comptables officiels ne sont **pas** produits.
- La valorisation FIFO est implémentée (`fifoStockValue()`) mais le mode par défaut reste le CMP,
  et l'interface n'expose pas encore de comparaison CMP/FIFO côte à côte.

**Pistes d'évolution**
- Import CSV de factures fournisseurs pour accélérer la saisie.
- Comparaison visuelle CMP vs FIFO sur un mois.
- Notifications système Windows (échéances DLC) via l'intégration Electron.
- Signature numérique des sauvegardes pour archivage légal.

---

## 11. Points à valider avec votre comptable

Écran dédié : **`/parametres-comptables`**. Les 10 points listés (méthode de valorisation,
repas du personnel, traitement des avaries, définition du CA HT, TVA, cotisations sociales,
exports comptables, transferts internes, écarts d'inventaire, nature du logiciel) y sont
détaillés avec, pour chacun : la question à poser, le comportement actuel du logiciel,
la conséquence d'un mauvais paramétrage et l'écran de modification.
