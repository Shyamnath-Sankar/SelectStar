/**
 * Demo database seeder (Node-compatible, uses better-sqlite3).
 *
 * Creates a sample e-commerce SQLite database with realistic data so the
 * platform is fully explorable out of the box. Run with:
 *   node scripts/seed-demo.js
 *
 * The DB path defaults to "db/demo.db" but can be overridden with DEMO_DB_PATH.
 */
const Database = require("better-sqlite3");
const { randomInt } = require("crypto");
const { mkdirSync } = require("fs");
const { dirname } = require("path");

const DB_PATH = process.env.DEMO_DB_PATH || "db/demo.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");

const pick = (arr) => arr[randomInt(arr.length)];

// ---- Schema -------------------------------------------------------------
db.exec(`
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS regions;

CREATE TABLE regions (id INTEGER PRIMARY KEY, name TEXT NOT NULL, country TEXT NOT NULL);
CREATE TABLE customers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  region_id INTEGER NOT NULL, signup_date TEXT NOT NULL, is_vip INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (region_id) REFERENCES regions(id)
);
CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, parent_id INTEGER);
CREATE TABLE products (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, category_id INTEGER NOT NULL,
  price REAL NOT NULL, cost REAL NOT NULL, stock INTEGER NOT NULL DEFAULT 0,
  discontinued INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);
CREATE TABLE orders (
  id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL, order_date TEXT NOT NULL,
  status TEXT NOT NULL, total REAL NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL, unit_price REAL NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_date ON orders(order_date);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
CREATE INDEX idx_products_category ON products(category_id);
`);

// ---- Regions ------------------------------------------------------------
const regions = [
  ["North America","USA"],["North America","Canada"],["Europe","UK"],["Europe","Germany"],
  ["Europe","France"],["Asia Pacific","Japan"],["Asia Pacific","Singapore"],["Latin America","Brazil"],
];
const insertRegion = db.prepare("INSERT INTO regions (id, name, country) VALUES (?, ?, ?)");
regions.forEach((r, i) => insertRegion.run(i + 1, r[0], r[1]));

// ---- Categories ---------------------------------------------------------
const categories = [
  ["Electronics",null],["Audio",1],["Wearables",1],["Home",null],["Kitchen",4],
  ["Furniture",4],["Office",null],["Stationery",7],["Books",null],
];
const insertCat = db.prepare("INSERT INTO categories (id, name, parent_id) VALUES (?, ?, ?)");
categories.forEach((c, i) => insertCat.run(i + 1, c[0], c[1] ?? null));

// ---- Products -----------------------------------------------------------
const productTemplates = {
  Audio: [["Wireless Headphones",199.99,88],["Bluetooth Speaker",79.99,34],["Studio Monitor",349.0,180],["USB Microphone",129.0,52]],
  Wearables: [["Fitness Tracker",99.0,38],["Smartwatch Pro",299.0,140],["GPS Watch",449.0,210]],
  Kitchen: [["Espresso Machine",599.0,280],["Air Fryer",129.99,58],["Blender",89.0,41],["Knife Set",149.0,62]],
  Furniture: [["Ergonomic Chair",449.0,190],["Standing Desk",599.0,260],["Bookshelf",179.0,80]],
  Stationery: [["Notebook Pack",24.99,9],["Premium Pen",49.0,18],["Desk Organizer",39.0,14]],
  Books: [["Data Engineering 101",45.0,16],["SQL Mastery",38.0,12],["ML Foundations",52.0,20]],
};
const insertProduct = db.prepare("INSERT INTO products (id, name, category_id, price, cost, stock, discontinued) VALUES (?, ?, ?, ?, ?, ?, ?)");
const products = [];
let pid = 1;
for (const [cat, items] of Object.entries(productTemplates)) {
  const catId = categories.findIndex((c) => c[0] === cat) + 1;
  for (const [name, price, cost] of items) {
    const stock = randomInt(0, 400);
    const disc = randomInt(0, 20) === 0 ? 1 : 0;
    insertProduct.run(pid, name, catId, price, cost, stock, disc);
    products.push({ id: pid, name, price, cost, catId });
    pid++;
  }
}

// ---- Customers ----------------------------------------------------------
const firstNames = ["Ava","Liam","Noah","Emma","Olivia","Lucas","Mia","Ethan","Sophia","Mason","Aria","Leo","Zoe","Kai","Nora","Jin","Yuki","Priya","Omar","Elena","Diego","Hana","Tariq","Greta"];
const lastNames = ["Chen","Patel","Garcia","Kim","Nguyen","Silva","Muller","Rossi","Tanaka","Singh","Costa","Lopez","Wang","Khan","Novak","Adeyemi"];
const insertCust = db.prepare("INSERT INTO customers (id, name, email, region_id, signup_date, is_vip) VALUES (?, ?, ?, ?, ?, ?)");
const customerIds = [];
for (let i = 1; i <= 240; i++) {
  const name = `${pick(firstNames)} ${pick(lastNames)}`;
  const email = `${name.toLowerCase().replace(/[^a-z]/g, "")}${i}@example.com`;
  const regionId = randomInt(1, regions.length + 1);
  const daysAgo = randomInt(0, 1100);
  const d = new Date(); d.setDate(d.getDate() - daysAgo);
  const isVip = randomInt(0, 5) === 0 ? 1 : 0;
  insertCust.run(i, name, email, regionId, d.toISOString().slice(0, 10), isVip);
  customerIds.push(i);
}

// ---- Orders + items -----------------------------------------------------
const statuses = ["pending","shipped","delivered","cancelled","refunded"];
const insertOrder = db.prepare("INSERT INTO orders (id, customer_id, order_date, status, total) VALUES (?, ?, ?, ?, ?)");
const insertItem = db.prepare("INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?)");
let orderId = 1, itemId = 1;
for (let i = 0; i < 3200; i++) {
  const custId = pick(customerIds);
  const daysAgo = randomInt(0, 730);
  const d = new Date(); d.setDate(d.getDate() - daysAgo);
  const itemCount = randomInt(1, 5);
  let total = 0;
  const items = [];
  for (let j = 0; j < itemCount; j++) {
    const p = pick(products);
    const qty = randomInt(1, 4);
    total += p.price * qty;
    items.push({ p, qty });
  }
  insertOrder.run(orderId, custId, d.toISOString().slice(0, 10), pick(statuses), Math.round(total * 100) / 100);
  for (const { p, qty } of items) { insertItem.run(itemId, orderId, p.id, qty, p.price); itemId++; }
  orderId++;
}

const stats = {
  regions: db.prepare("SELECT COUNT(*) c FROM regions").get().c,
  customers: db.prepare("SELECT COUNT(*) c FROM customers").get().c,
  categories: db.prepare("SELECT COUNT(*) c FROM categories").get().c,
  products: db.prepare("SELECT COUNT(*) c FROM products").get().c,
  orders: db.prepare("SELECT COUNT(*) c FROM orders").get().c,
  items: db.prepare("SELECT COUNT(*) c FROM order_items").get().c,
};
db.close();
console.log("Demo database seeded at", DB_PATH);
console.log(JSON.stringify(stats, null, 2));
