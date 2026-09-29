const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "cafe.db");
const CSV_PATH = path.join(DATA_DIR, "menu.csv");

function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  let d = digits;
  if (d.length === 11 && d.startsWith("8")) d = "7" + d.slice(1);
  if (d.length === 10) d = "7" + d;
  if (d.length !== 11 || !d.startsWith("7")) return "";
  return "+" + d;
}

function parseCsv(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const nameIdx = header.indexOf("name");
  const catIdx = header.indexOf("category");
  const priceIdx = header.indexOf("price");
  const availIdx = header.indexOf("available");
  if (nameIdx < 0 || priceIdx < 0) {
    throw new Error("CSV: нужны колонки name и price (опционально category, available)");
  }
  const items = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",").map((c) => c.trim());
    const name = cols[nameIdx];
    const price = Number(cols[priceIdx]);
    if (!name || !Number.isFinite(price)) continue;
    const category = (cols[catIdx] || "drink").toLowerCase() === "dessert" ? "dessert" : "drink";
    const available = availIdx < 0 ? 1 : ["0", "false", "no", "нет"].includes(String(cols[availIdx]).toLowerCase()) ? 0 : 1;
    items.push({ name, category, price, available });
  }
  return items;
}

function openDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('guest','barista','admin')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('drink','dessert')),
      price INTEGER NOT NULL,
      available INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      pickup_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('new','ready','done')) DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
      qty INTEGER NOT NULL,
      name_snapshot TEXT NOT NULL,
      price_snapshot INTEGER NOT NULL
    );
  `);

  const seedUser = db.prepare(
    `INSERT OR IGNORE INTO users (phone, name, role) VALUES (?, ?, ?)`
  );
  seedUser.run("+79990000001", "Администратор", "admin");
  seedUser.run("+79990000002", "Бариста", "barista");

  const count = db.prepare("SELECT COUNT(*) AS n FROM menu_items").get().n;
  if (count === 0 && fs.existsSync(CSV_PATH)) {
    const items = parseCsv(fs.readFileSync(CSV_PATH, "utf8"));
    const insert = db.prepare(
      `INSERT INTO menu_items (name, category, price, available) VALUES (@name, @category, @price, @available)`
    );
    const tx = db.transaction((rows) => {
      for (const row of rows) insert.run(row);
    });
    tx(items);
  }

  return db;
}

module.exports = { openDb, parseCsv, normalizePhone, DB_PATH };
