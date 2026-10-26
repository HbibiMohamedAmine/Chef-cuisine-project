-- ============================================================================
--  Chef Cuisine Manager — Schéma SQLite (v1)
-- ----------------------------------------------------------------------------
--  Principes structurants :
--   * Le STOCK n'est jamais stocké directement : il est DÉRIVÉ de
--     `stock_movements` (source de vérité) via des vues.
--   * Aucune suppression physique des mouvements / opérations : annulation par
--     statut ou contre-écriture (triggers de protection).
--   * Les écritures multi-tables (réception, production, transfert, clôture)
--     sont enveloppées dans des transactions atomiques côté services.
--   * Montants en dinars tunisiens (REAL, arrondis à 3 décimales côté app).
-- ============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ---------------------------------------------------------------------------
--  PARAMÈTRES / RÉFÉRENTIELS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'general',
  label       TEXT,
  description TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kitchens (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  code      TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('centrale','transformation','personnel')),
  active    INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS units (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  code   TEXT NOT NULL UNIQUE,             -- kg, g, l, ml, unite, carton
  label  TEXT NOT NULL,
  family TEXT NOT NULL CHECK (family IN ('masse','volume','compte')),
  factor REAL NOT NULL DEFAULT 1,          -- facteur vers l'unité pivot
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE IF NOT EXISTS product_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  contact_name TEXT,
  phone        TEXT,
  email        TEXT,
  address      TEXT,
  tax_id       TEXT,                        -- matricule fiscal
  payment_terms TEXT,
  notes        TEXT,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  deleted_at   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
--  PRODUITS
-- ---------------------------------------------------------------------------
-- type :
--   matiere_premiere : achetée, transformée
--   semi_fini        : fabriquée (production / transformation)
--   fini             : plat vendu
--   ingredient_repas : ingrédient destiné aux repas du personnel
--   consommable      : emballage, produit de nettoyage…
--   perdu            : produit déclaré perdu/périmé (suivi spécifique)

CREATE TABLE IF NOT EXISTS products (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  category_id       INTEGER REFERENCES product_categories(id) ON DELETE RESTRICT,
  type              TEXT NOT NULL CHECK (type IN
                      ('matiere_premiere','semi_fini','fini','ingredient_repas','consommable','perdu')),
  unit              TEXT NOT NULL DEFAULT 'kg',
  purchase_price    REAL NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  unit_cost         REAL NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),  -- coût retenu (CMP)
  min_stock         REAL NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  supplier_id       INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  default_kitchen_id INTEGER REFERENCES kitchens(id) ON DELETE SET NULL,
  dlc               TEXT,                  -- date limite de consommation (YYYY-MM-DD)
  lot_number        TEXT,
  valuation_method  TEXT NOT NULL DEFAULT 'cmp' CHECK (valuation_method IN ('cmp','fifo')),
  is_sellable       INTEGER NOT NULL DEFAULT 0 CHECK (is_sellable IN (0,1)),
  sell_price_ht     REAL NOT NULL DEFAULT 0 CHECK (sell_price_ht >= 0),
  tax_rate          REAL NOT NULL DEFAULT 19 CHECK (tax_rate >= 0),
  notes             TEXT,
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  deleted_at        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_type    ON products(type);
CREATE INDEX IF NOT EXISTS idx_products_cat     ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_active  ON products(active, deleted_at);
CREATE INDEX IF NOT EXISTS idx_products_name    ON products(name);

-- ---------------------------------------------------------------------------
--  SEQUENCES DE NUMÉROTATION (document unique par type d'opération)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sequences (
  scope      TEXT PRIMARY KEY,   -- ex: 'transfer', 'loss', 'production'
  next_value INTEGER NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
--  ACHATS / RÉCEPTIONS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS purchases (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  number         TEXT NOT NULL UNIQUE,
  supplier_id    INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  order_date     TEXT NOT NULL,
  expected_date  TEXT,
  received_date  TEXT,
  status         TEXT NOT NULL DEFAULT 'brouillon'
                   CHECK (status IN ('brouillon','commandee','partielle','receptionnee','annulee')),
  invoice_number TEXT,
  invoice_date   TEXT,
  subtotal       REAL NOT NULL DEFAULT 0,
  discount       REAL NOT NULL DEFAULT 0,
  tax            REAL NOT NULL DEFAULT 0,
  total          REAL NOT NULL DEFAULT 0,
  paid_amount    REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'impayee'
                   CHECK (payment_status IN ('impayee','partielle','payee')),
  payment_method TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  validated_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date     ON purchases(order_date);
CREATE INDEX IF NOT EXISTS idx_purchases_status   ON purchases(status);

CREATE TABLE IF NOT EXISTS purchase_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id  INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty_ordered  REAL NOT NULL DEFAULT 0 CHECK (qty_ordered >= 0),
  qty_received REAL NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit         TEXT NOT NULL,
  unit_price   REAL NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  discount_pct REAL NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  line_total   REAL NOT NULL DEFAULT 0,
  lot_number   TEXT,
  dlc          TEXT
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product  ON purchase_items(product_id);

-- ---------------------------------------------------------------------------
--  MOUVEMENTS DE STOCK — SOURCE DE VÉRITÉ
-- ---------------------------------------------------------------------------
-- direction : 'in' (entrée) ou 'out' (sortie)
-- movement_type :
--   initial, reception, retour_fournisseur, production_entree, production_sortie,
--   transformation_sortie, transformation_entree, transfert_sortie,
--   transfert_entree, avarie, vente_sortie, ajustement_inventaire,
--   ajustement_manuel, contre_ecriture

CREATE TABLE IF NOT EXISTS stock_movements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at    TEXT NOT NULL,
  movement_type  TEXT NOT NULL,
  direction      TEXT NOT NULL CHECK (direction IN ('in','out')),
  kitchen_id     INTEGER NOT NULL REFERENCES kitchens(id) ON DELETE RESTRICT,
  product_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  lot_number     TEXT,
  qty            REAL NOT NULL CHECK (qty > 0),
  unit           TEXT NOT NULL,
  unit_cost      REAL NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  total_cost     REAL NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  source_table    TEXT,
  source_id       INTEGER,
  reason          TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  created_by      TEXT NOT NULL DEFAULT 'chef',
  reversed_by_id  INTEGER REFERENCES stock_movements(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_sm_product_kitchen ON stock_movements(product_id, kitchen_id);
CREATE INDEX IF NOT EXISTS idx_sm_date            ON stock_movements(occurred_at);
CREATE INDEX IF NOT EXISTS idx_sm_source          ON stock_movements(source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_sm_type            ON stock_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_sm_kitchen         ON stock_movements(kitchen_id);

-- Interdiction de suppression physique d'un mouvement de stock.
CREATE TRIGGER IF NOT EXISTS trg_sm_no_delete
BEFORE DELETE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'Suppression interdite : les mouvements de stock sont immuables (utilisez une contre-écriture).');
END;

-- Interdiction de mise à jour des quantités d'un mouvement existant.
CREATE TRIGGER IF NOT EXISTS trg_sm_no_update
BEFORE UPDATE OF qty, unit_cost, total_cost, direction, product_id, kitchen_id ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'Modification interdite : corrigez par une contre-écriture.');
END;

-- ---------------------------------------------------------------------------
--  STOCK DÉRIVÉ (vues)
-- ---------------------------------------------------------------------------

-- Stock par produit + cuisine (+ lot)
CREATE VIEW IF NOT EXISTS v_stock AS
SELECT
  m.kitchen_id,
  m.product_id,
  m.lot_number,
  ROUND(SUM(CASE WHEN m.direction = 'in' THEN m.qty ELSE -m.qty END), 4) AS qty
FROM stock_movements m
GROUP BY m.kitchen_id, m.product_id, m.lot_number;

-- Stock total par produit (toutes cuisines)
CREATE VIEW IF NOT EXISTS v_stock_product AS
SELECT
  m.product_id,
  ROUND(SUM(CASE WHEN m.direction = 'in' THEN m.qty ELSE -m.qty END), 4) AS qty
FROM stock_movements m
GROUP BY m.product_id;

-- Stock valorisé par produit + cuisine
CREATE VIEW IF NOT EXISTS v_stock_valued AS
SELECT
  s.kitchen_id,
  s.product_id,
  p.code,
  p.name,
  p.type,
  p.unit,
  p.unit_cost,
  p.min_stock,
  p.dlc,
  p.lot_number,
  s.lot_number AS lot,
  s.qty,
  ROUND(s.qty * p.unit_cost, 3) AS value
FROM v_stock s
JOIN products p ON p.id = s.product_id;

-- ---------------------------------------------------------------------------
--  INVENTAIRES PHYSIQUES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stock_counts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  number       TEXT NOT NULL UNIQUE,
  count_date   TEXT NOT NULL,
  kitchen_id   INTEGER NOT NULL REFERENCES kitchens(id) ON DELETE RESTRICT,
  status       TEXT NOT NULL DEFAULT 'brouillon'
                 CHECK (status IN ('brouillon','valide','annule')),
  notes        TEXT,
  total_variance_value REAL NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  validated_at TEXT
);

CREATE TABLE IF NOT EXISTS stock_count_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_count_id INTEGER NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  product_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  lot_number     TEXT,
  theoretical_qty REAL NOT NULL DEFAULT 0,
  physical_qty    REAL NOT NULL DEFAULT 0,
  unit_cost       REAL NOT NULL DEFAULT 0,
  variance_qty    REAL NOT NULL DEFAULT 0,
  variance_value  REAL NOT NULL DEFAULT 0,
  justification   TEXT
);

CREATE INDEX IF NOT EXISTS idx_sci_count   ON stock_count_items(stock_count_id);
CREATE INDEX IF NOT EXISTS idx_sci_product ON stock_count_items(product_id);

-- ---------------------------------------------------------------------------
--  RECETTES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS recipes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  output_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  portions        REAL NOT NULL DEFAULT 1 CHECK (portions > 0),
  selling_price_ht REAL NOT NULL DEFAULT 0 CHECK (selling_price_ht >= 0),
  tax_rate        REAL NOT NULL DEFAULT 19 CHECK (tax_rate >= 0),
  instructions    TEXT,
  notes           TEXT,
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  deleted_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipe_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id    INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty          REAL NOT NULL CHECK (qty > 0),
  unit         TEXT NOT NULL,
  unit_cost    REAL NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  line_cost    REAL NOT NULL DEFAULT 0 CHECK (line_cost >= 0),
  notes        TEXT
);

CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe  ON recipe_items(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_items_product ON recipe_items(product_id);

-- ---------------------------------------------------------------------------
--  PRODUCTIONS (cuisine centrale)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS productions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  number          TEXT NOT NULL UNIQUE,
  produced_at     TEXT NOT NULL,
  kitchen_id      INTEGER NOT NULL REFERENCES kitchens(id) ON DELETE RESTRICT,
  recipe_id       INTEGER REFERENCES recipes(id) ON DELETE RESTRICT,
  product_id      INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty_theoretical REAL NOT NULL DEFAULT 0,
  qty_produced    REAL NOT NULL DEFAULT 0 CHECK (qty_produced >= 0),
  unit            TEXT NOT NULL,
  portions        REAL NOT NULL DEFAULT 1,
  total_cost      REAL NOT NULL DEFAULT 0,
  unit_cost       REAL NOT NULL DEFAULT 0,
  loss_qty        REAL NOT NULL DEFAULT 0,
  loss_value      REAL NOT NULL DEFAULT 0,
  loss_included   INTEGER NOT NULL DEFAULT 1 CHECK (loss_included IN (0,1)),
  status          TEXT NOT NULL DEFAULT 'brouillon'
                    CHECK (status IN ('brouillon','valide','annule')),
  comment         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  validated_at    TEXT
);

CREATE TABLE IF NOT EXISTS production_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  production_id  INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  product_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty_theoretical REAL NOT NULL DEFAULT 0,
  qty_actual      REAL NOT NULL DEFAULT 0,
  unit            TEXT NOT NULL,
  unit_cost       REAL NOT NULL DEFAULT 0,
  total_cost      REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_prod_date     ON productions(produced_at);
CREATE INDEX IF NOT EXISTS idx_prod_status   ON productions(status);
CREATE INDEX IF NOT EXISTS idx_prod_items    ON production_items(production_id);

-- ---------------------------------------------------------------------------
--  TRANSFORMATIONS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS transformations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  number           TEXT NOT NULL UNIQUE,
  occurred_at      TEXT NOT NULL,
  kitchen_id       INTEGER NOT NULL REFERENCES kitchens(id) ON DELETE RESTRICT,
  source_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  target_product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
  lot_number       TEXT,
  initial_weight   REAL NOT NULL CHECK (initial_weight > 0),
  initial_cost     REAL NOT NULL DEFAULT 0 CHECK (initial_cost >= 0),
  final_weight     REAL NOT NULL DEFAULT 0 CHECK (final_weight >= 0),
  portions         REAL NOT NULL DEFAULT 1 CHECK (portions > 0),
  avg_portion_weight REAL NOT NULL DEFAULT 0,
  loss_weight      REAL NOT NULL DEFAULT 0,
  loss_pct         REAL NOT NULL DEFAULT 0,
  yield_pct        REAL NOT NULL DEFAULT 0,
  loss_threshold_pct REAL NOT NULL DEFAULT 0,
  loss_type        TEXT NOT NULL DEFAULT 'normale' CHECK (loss_type IN ('normale','anormale')),
  reason           TEXT,
  unit_cost_final  REAL NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'brouillon'
                     CHECK (status IN ('brouillon','valide','annule')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  validated_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_transf_date   ON transformations(occurred_at);
CREATE INDEX IF NOT EXISTS idx_transf_status ON transformations(status);

-- ---------------------------------------------------------------------------
--  TRANSFERTS INTERNES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS transfers (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  number             TEXT NOT NULL UNIQUE,
  occurred_at        TEXT NOT NULL,
  source_kitchen_id  INTEGER NOT NULL REFERENCES kitchens(id) ON DELETE RESTRICT,
  dest_kitchen_id    INTEGER NOT NULL REFERENCES kitchens(id) ON DELETE RESTRICT,
  product_id         INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  lot_number         TEXT,
  qty                REAL NOT NULL CHECK (qty > 0),
  unit               TEXT NOT NULL,
  unit_cost          REAL NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  total_cost         REAL NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  reason             TEXT,
  status             TEXT NOT NULL DEFAULT 'brouillon'
                       CHECK (status IN ('brouillon','valide','annule')),
  force_negative     INTEGER NOT NULL DEFAULT 0 CHECK (force_negative IN (0,1)),
  force_justification TEXT,
  cancel_reason      TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  validated_at       TEXT,
  cancelled_at       TEXT,
  CHECK (source_kitchen_id <> dest_kitchen_id)
);

CREATE INDEX IF NOT EXISTS idx_transfers_date   ON transfers(occurred_at);
CREATE INDEX IF NOT EXISTS idx_transfers_status ON transfers(status);
CREATE INDEX IF NOT EXISTS idx_transfers_src    ON transfers(source_kitchen_id);
CREATE INDEX IF NOT EXISTS idx_transfers_dst    ON transfers(dest_kitchen_id);

CREATE TRIGGER IF NOT EXISTS trg_transfers_no_delete
BEFORE DELETE ON transfers
BEGIN
  SELECT RAISE(ABORT, 'Suppression interdite : annulez le transfert (statut « annulé »).');
END;

-- ---------------------------------------------------------------------------
--  AVARIES / PERTES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS losses (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  number            TEXT NOT NULL UNIQUE,
  occurred_at       TEXT NOT NULL,
  kitchen_id        INTEGER NOT NULL REFERENCES kitchens(id) ON DELETE RESTRICT,
  product_id        INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  lot_number        TEXT,
  qty               REAL NOT NULL CHECK (qty > 0),
  unit              TEXT NOT NULL,
  unit_cost         REAL NOT NULL DEFAULT 0,
  total_cost        REAL NOT NULL DEFAULT 0,
  loss_type         TEXT NOT NULL,
  reason            TEXT,
  comment           TEXT,
  photo_path        TEXT,
  already_in_consumption INTEGER NOT NULL DEFAULT 1 CHECK (already_in_consumption IN (0,1)),
  status            TEXT NOT NULL DEFAULT 'brouillon'
                      CHECK (status IN ('brouillon','valide','annule')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  validated_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_losses_date   ON losses(occurred_at);
CREATE INDEX IF NOT EXISTS idx_losses_status ON losses(status);
CREATE INDEX IF NOT EXISTS idx_losses_type   ON losses(loss_type);

CREATE TRIGGER IF NOT EXISTS trg_losses_no_delete
BEFORE DELETE ON losses
BEGIN
  SELECT RAISE(ABORT, 'Suppression interdite : annulez l’avarie (statut « annulé »).');
END;

-- Catalogue des motifs d'avarie (configurable)
CREATE TABLE IF NOT EXISTS loss_types (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  code   TEXT NOT NULL UNIQUE,
  label  TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

-- ---------------------------------------------------------------------------
--  VENTES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sales (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  number        TEXT NOT NULL UNIQUE,
  occurred_at   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'valide'
                  CHECK (status IN ('brouillon','valide','annule')),
  subtotal_ht   REAL NOT NULL DEFAULT 0,
  discount      REAL NOT NULL DEFAULT 0,
  tax           REAL NOT NULL DEFAULT 0,
  total_ttc     REAL NOT NULL DEFAULT 0,
  cost_total    REAL NOT NULL DEFAULT 0,
  payment_method TEXT,
  channel       TEXT DEFAULT 'sur_place',
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  validated_at  TEXT,
  cancelled_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_sales_date   ON sales(occurred_at);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);

CREATE TABLE IF NOT EXISTS sale_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id       INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty           REAL NOT NULL CHECK (qty > 0),
  unit_price_ht REAL NOT NULL DEFAULT 0,
  discount_pct  REAL NOT NULL DEFAULT 0,
  tax_rate      REAL NOT NULL DEFAULT 19,
  line_ht       REAL NOT NULL DEFAULT 0,
  line_tax      REAL NOT NULL DEFAULT 0,
  line_ttc      REAL NOT NULL DEFAULT 0,
  unit_cost     REAL NOT NULL DEFAULT 0,
  line_cost     REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale    ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

CREATE TRIGGER IF NOT EXISTS trg_sales_no_delete
BEFORE DELETE ON sales
BEGIN
  SELECT RAISE(ABORT, 'Suppression interdite : annulez la vente (contre-écriture).');
END;

-- ---------------------------------------------------------------------------
--  CAISSE
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cash_movements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at    TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('encaissement','decaissement','remboursement','ajustement')),
  category       TEXT,
  amount         REAL NOT NULL CHECK (amount >= 0),
  payment_method TEXT NOT NULL DEFAULT 'espece',
  reference      TEXT,
  description    TEXT,
  source_table   TEXT,
  source_id      INTEGER,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cash_date ON cash_movements(occurred_at);

CREATE TABLE IF NOT EXISTS cash_closings (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  closing_date       TEXT NOT NULL UNIQUE,
  opening_balance    REAL NOT NULL DEFAULT 0,
  total_in           REAL NOT NULL DEFAULT 0,
  total_out          REAL NOT NULL DEFAULT 0,
  theoretical_balance REAL NOT NULL DEFAULT 0,
  counted_balance    REAL NOT NULL DEFAULT 0,
  variance           REAL NOT NULL DEFAULT 0,
  justification      TEXT,
  status             TEXT NOT NULL DEFAULT 'cloturee' CHECK (status IN ('cloturee','reouverte')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  reopened_at        TEXT,
  reopen_reason      TEXT
);

-- ---------------------------------------------------------------------------
--  DÉPENSES HORS MATIÈRES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS expenses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  number         TEXT NOT NULL UNIQUE,
  expense_date   TEXT NOT NULL,
  category       TEXT NOT NULL,
  amount         REAL NOT NULL CHECK (amount >= 0),
  payment_method TEXT NOT NULL DEFAULT 'espece',
  beneficiary    TEXT,
  reference      TEXT,
  notes          TEXT,
  cash_movement_id INTEGER REFERENCES cash_movements(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_cat  ON expenses(category);

-- ---------------------------------------------------------------------------
--  PERSONNEL & PAIE
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS employees (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  function      TEXT,
  hire_date     TEXT,
  end_date      TEXT,
  base_salary   REAL NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
  contract_type TEXT DEFAULT 'CDI',
  phone         TEXT,
  cin           TEXT,
  cnss_number   TEXT,
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  deleted_at    TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id    INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  att_date       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'present'
                   CHECK (status IN ('present','absent','retard','conge','ferie','maladie')),
  hours_normal   REAL NOT NULL DEFAULT 0,
  hours_overtime REAL NOT NULL DEFAULT 0,
  late_minutes   INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  UNIQUE (employee_id, att_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(att_date);

CREATE TABLE IF NOT EXISTS payroll_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  period        TEXT NOT NULL,                 -- YYYY-MM
  base_salary   REAL NOT NULL DEFAULT 0,
  hours_normal  REAL NOT NULL DEFAULT 0,
  hours_overtime REAL NOT NULL DEFAULT 0,
  overtime_amount REAL NOT NULL DEFAULT 0,
  primes        REAL NOT NULL DEFAULT 0,
  gross         REAL NOT NULL DEFAULT 0,
  cnss_employee REAL NOT NULL DEFAULT 0,
  cnss_employer REAL NOT NULL DEFAULT 0,
  irpp          REAL NOT NULL DEFAULT 0,
  advances      REAL NOT NULL DEFAULT 0,
  retenues      REAL NOT NULL DEFAULT 0,
  net           REAL NOT NULL DEFAULT 0,
  total_employer_cost REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'brouillon'
                  CHECK (status IN ('brouillon','valide','exporte')),
  details_json  TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  validated_at  TEXT,
  UNIQUE (employee_id, period)
);

-- ---------------------------------------------------------------------------
--  CLÔTURES MENSUELLES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS monthly_closings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  period            TEXT NOT NULL UNIQUE,      -- YYYY-MM
  status            TEXT NOT NULL DEFAULT 'cloture' CHECK (status IN ('cloture','reouvert')),
  closed_at         TEXT NOT NULL DEFAULT (datetime('now')),
  reopened_at       TEXT,
  reopen_reason     TEXT,
  opening_stock_value REAL NOT NULL DEFAULT 0,
  closing_stock_value REAL NOT NULL DEFAULT 0,
  purchases_received  REAL NOT NULL DEFAULT 0,
  consumption         REAL NOT NULL DEFAULT 0,
  losses_not_included REAL NOT NULL DEFAULT 0,
  retained_cost       REAL NOT NULL DEFAULT 0,
  revenue_ht          REAL NOT NULL DEFAULT 0,
  ratio_pct           REAL NOT NULL DEFAULT 0,
  objective_pct       REAL NOT NULL DEFAULT 30,
  margin_before_charges REAL NOT NULL DEFAULT 0,
  other_expenses      REAL NOT NULL DEFAULT 0,
  details_json        TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS monthly_closing_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  period      TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('cloture','reouverture')),
  reason      TEXT,
  snapshot_json TEXT,
  performed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
--  AUDIT, SAUVEGARDES, ERREURS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  actor       TEXT NOT NULL DEFAULT 'chef',
  action      TEXT NOT NULL,             -- create, update, validate, cancel, delete, login, ...
  entity      TEXT NOT NULL,             -- transfer, purchase, settings, ...
  entity_id   TEXT,
  summary     TEXT,
  payload_json TEXT,
  severity    TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  ip          TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_date   ON audit_logs(occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);

CREATE TABLE IF NOT EXISTS backups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  file_name  TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256     TEXT,
  kind       TEXT NOT NULL DEFAULT 'manuel' CHECK (kind IN ('manuel','auto','pre_restauration')),
  status     TEXT NOT NULL DEFAULT 'ok',
  notes      TEXT
);

-- Sessions d'authentification (utilisateur unique : le chef)
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  last_seen   TEXT,
  ip          TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS app_errors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  context     TEXT,
  message     TEXT NOT NULL,
  stack       TEXT
);

-- ---------------------------------------------------------------------------
--  GARDE-FOUS GÉNÉRAUX
-- ---------------------------------------------------------------------------

-- Une seule clôture par période (contrainte UNIQUE déjà posée).
-- Un produit ne peut pas avoir un code vide.
CREATE TRIGGER IF NOT EXISTS trg_products_code_not_empty
BEFORE INSERT ON products
WHEN NEW.code IS NULL OR TRIM(NEW.code) = ''
BEGIN
  SELECT RAISE(ABORT, 'Le code produit est obligatoire.');
END;

-- Un transfert validé ne peut pas être supprimé ni modifié sur ses montants.
CREATE TRIGGER IF NOT EXISTS trg_transfers_no_update_validated
BEFORE UPDATE OF qty, unit_cost, total_cost ON transfers
WHEN OLD.status = 'valide' AND NEW.status = 'valide'
BEGIN
  SELECT RAISE(ABORT, 'Un transfert validé ne peut pas être modifié (corrigez par une nouvelle opération).');
END;

-- Une avarie validée ne peut pas être modifiée sur ses montants.
CREATE TRIGGER IF NOT EXISTS trg_losses_no_update_validated
BEFORE UPDATE OF qty, unit_cost, total_cost ON losses
WHEN OLD.status = 'valide' AND NEW.status = 'valide'
BEGIN
  SELECT RAISE(ABORT, 'Une avarie validée ne peut pas être modifiée (corrigez par une nouvelle opération).');
END;
