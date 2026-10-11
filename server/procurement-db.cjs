"use strict";
// Procurement entities live in relational tables. Inventory remains in app_state.
function initialize(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS item_categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)));
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      contact TEXT NOT NULL, phone TEXT NOT NULL, note TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)));
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id),
      supplier_name TEXT NOT NULL, date TEXT NOT NULL, delivery_date TEXT NOT NULL,
      shipped INTEGER NOT NULL CHECK(shipped IN (0,1)), cancelled INTEGER NOT NULL CHECK(cancelled IN (0,1)), paid INTEGER NOT NULL CHECK(paid IN (0,1)),
      paid_date TEXT NOT NULL, reference TEXT NOT NULL, notes TEXT NOT NULL,
      created_at TEXT NOT NULL, actor_name TEXT NOT NULL, changes TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS purchase_order_lines (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES purchase_orders(id),
      item_id TEXT NOT NULL, item_name TEXT NOT NULL, unit TEXT NOT NULL,
      pack_size REAL NOT NULL CHECK(pack_size>0),
      quantity INTEGER NOT NULL CHECK(quantity>0), unit_cost INTEGER NOT NULL CHECK(unit_cost>=0),
      UNIQUE(order_id,item_id));
    CREATE INDEX IF NOT EXISTS purchase_supplier_date ON purchase_orders(supplier_id,date);
    CREATE INDEX IF NOT EXISTS purchase_line_order ON purchase_order_lines(order_id);
    INSERT OR IGNORE INTO item_categories(id,name,active) VALUES
      ('cat-service','시술 제품',1),('cat-care','관리 제품',1),('cat-sale','판매 제품',1);
    PRAGMA user_version=3;
  `);
}
function read(db) {
  const itemCategories = db
    .prepare("SELECT * FROM item_categories ORDER BY rowid")
    .all()
    .map((r) => ({ ...r, active: !!r.active }));
  const suppliers = db
    .prepare("SELECT * FROM suppliers ORDER BY rowid")
    .all()
    .map((r) => ({ ...r, active: !!r.active }));
  const lines = db
    .prepare("SELECT * FROM purchase_order_lines ORDER BY rowid")
    .all();
  const purchaseOrders = db
    .prepare("SELECT * FROM purchase_orders ORDER BY rowid")
    .all()
    .map((r) => ({
      id: r.id,
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      date: r.date,
      deliveryDate: r.delivery_date,
      shipped: !!r.shipped,
      cancelled: !!r.cancelled,
      paid: !!r.paid,
      paidDate: r.paid_date,
      reference: r.reference,
      notes: r.notes,
      createdAt: r.created_at,
      actorName: r.actor_name,
      changes: JSON.parse(r.changes),
      lines: lines
        .filter((l) => l.order_id === r.id)
        .map((l) => ({
          id: l.id,
          itemId: l.item_id,
          itemName: l.item_name,
          unit: l.unit,
          packSize: l.pack_size,
          quantity: l.quantity,
          unitCost: l.unit_cost,
        })),
    }));
  return { itemCategories, suppliers, purchaseOrders };
}
function write(db, data) {
  for (const c of data.itemCategories || [])
    db.prepare(
      "INSERT INTO item_categories VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=excluded.active",
    ).run(c.id, c.name, +c.active);
  for (const s of data.suppliers || [])
    db.prepare(
      "INSERT INTO suppliers VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,contact=excluded.contact,phone=excluded.phone,note=excluded.note,active=excluded.active",
    ).run(s.id, s.name, s.contact, s.phone, s.note, +s.active);
  for (const o of data.purchaseOrders || []) {
    db.prepare(
      `INSERT INTO purchase_orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET shipped=excluded.shipped,cancelled=excluded.cancelled,paid=excluded.paid,paid_date=excluded.paid_date,reference=excluded.reference,changes=excluded.changes`,
    ).run(
      o.id,
      o.supplierId,
      o.supplierName,
      o.date,
      o.deliveryDate,
      +o.shipped,
      +o.cancelled,
      +o.paid,
      o.paidDate,
      o.reference,
      o.notes,
      o.createdAt,
      o.actorName,
      JSON.stringify(o.changes),
    );
    for (const l of o.lines)
      db.prepare(
        "INSERT INTO purchase_order_lines VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
      ).run(
        l.id,
        o.id,
        l.itemId,
        l.itemName,
        l.unit,
        l.packSize,
        l.quantity,
        l.unitCost,
      );
  }
}
module.exports = { initialize, read, write };
