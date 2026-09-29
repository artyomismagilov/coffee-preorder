const crypto = require("crypto");
const path = require("path");
const express = require("express");
const { openDb, parseCsv, normalizePhone } = require("./db");

const PORT = Number(process.env.PORT) || 3000;
const db = openDb();
const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

function getUserFromReq(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  return db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
    )
    .get(token);
}

function requireAuth(roles) {
  return (req, res, next) => {
    const user = getUserFromReq(req);
    if (!user) return res.status(401).json({ error: "Нужно войти по номеру телефона" });
    if (roles && !roles.includes(user.role)) {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    req.user = user;
    next();
  };
}

app.post("/api/login", (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const name = String(req.body.name || "").trim();
  if (!phone) {
    return res.status(400).json({ error: "Введите номер в формате +7XXXXXXXXXX" });
  }
  let user = db.prepare("SELECT * FROM users WHERE phone = ?").get(phone);
  if (!user) {
    if (name.length < 2) {
      return res.status(400).json({ error: "Для первого входа укажите имя" });
    }
    const info = db
      .prepare("INSERT INTO users (phone, name, role) VALUES (?, ?, 'guest')")
      .run(phone, name);
    user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  } else if (name.length >= 2 && user.role === "guest") {
    db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, user.id);
    user = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
  }
  const token = newToken();
  db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)").run(token, user.id);
  res.json({
    token,
    user: { id: user.id, phone: user.phone, name: user.name, role: user.role },
  });
});

app.get("/api/me", requireAuth(), (req, res) => {
  const u = req.user;
  res.json({ id: u.id, phone: u.phone, name: u.name, role: u.role });
});

app.get("/api/menu", requireAuth(), (req, res) => {
  const onlyAvailable = req.user.role === "guest";
  const rows = onlyAvailable
    ? db.prepare("SELECT * FROM menu_items WHERE available = 1 ORDER BY category, name").all()
    : db.prepare("SELECT * FROM menu_items ORDER BY category, name").all();
  res.json(rows);
});

app.post("/api/orders", requireAuth(["guest"]), (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const pickupAt = String(req.body.pickupAt || "");
  if (!items.length) return res.status(400).json({ error: "Добавьте позиции в заказ" });
  const pickup = new Date(pickupAt);
  if (Number.isNaN(pickup.getTime())) {
    return res.status(400).json({ error: "Укажите время выдачи" });
  }
  const now = Date.now();
  const diffMin = (pickup.getTime() - now) / 60000;
  if (diffMin < -1 || diffMin > 30) {
    return res.status(400).json({ error: "Время выдачи — от сейчас до 30 минут" });
  }

  const getItem = db.prepare("SELECT * FROM menu_items WHERE id = ? AND available = 1");
  const lines = [];
  for (const line of items) {
    const qty = Number(line.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
      return res.status(400).json({ error: "Некорректное количество" });
    }
    const menu = getItem.get(Number(line.id));
    if (!menu) return res.status(400).json({ error: "Товар недоступен" });
    lines.push({ menu, qty });
  }

  const insertOrder = db.prepare(
    `INSERT INTO orders (user_id, pickup_at, status) VALUES (?, ?, 'new')`
  );
  const insertLine = db.prepare(
    `INSERT INTO order_items (order_id, menu_item_id, qty, name_snapshot, price_snapshot)
     VALUES (?, ?, ?, ?, ?)`
  );
  const tx = db.transaction(() => {
    const info = insertOrder.run(req.user.id, pickup.toISOString());
    const orderId = info.lastInsertRowid;
    for (const { menu, qty } of lines) {
      insertLine.run(orderId, menu.id, qty, menu.name, menu.price);
    }
    return orderId;
  });
  const orderId = tx();
  res.status(201).json({ id: orderId });
});

app.get("/api/barista/orders", requireAuth(["barista", "admin"]), (req, res) => {
  const orders = db
    .prepare(
      `SELECT o.*, u.name AS guest_name, u.phone AS guest_phone
       FROM orders o JOIN users u ON u.id = o.user_id
       WHERE o.status != 'done'
       ORDER BY o.pickup_at ASC`
    )
    .all();
  const itemsStmt = db.prepare("SELECT * FROM order_items WHERE order_id = ?");
  const payload = orders.map((o) => ({
    ...o,
    items: itemsStmt.all(o.id),
  }));
  res.json(payload);
});

app.patch("/api/barista/orders/:id", requireAuth(["barista", "admin"]), (req, res) => {
  const id = Number(req.params.id);
  const status = req.body.status;
  if (!["new", "ready", "done"].includes(status)) {
    return res.status(400).json({ error: "Неизвестный статус" });
  }
  const info = db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, id);
  if (!info.changes) return res.status(404).json({ error: "Заказ не найден" });
  res.json({ ok: true });
});

app.post("/api/admin/menu", requireAuth(["admin"]), (req, res) => {
  const name = String(req.body.name || "").trim();
  const category = req.body.category === "dessert" ? "dessert" : "drink";
  const price = Number(req.body.price);
  const available = req.body.available === false || req.body.available === 0 ? 0 : 1;
  if (name.length < 2 || !Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: "Укажите название и цену" });
  }
  const info = db
    .prepare(
      `INSERT INTO menu_items (name, category, price, available) VALUES (?, ?, ?, ?)`
    )
    .run(name, category, Math.round(price), available);
  res.status(201).json(db.prepare("SELECT * FROM menu_items WHERE id = ?").get(info.lastInsertRowid));
});

app.patch("/api/admin/menu/:id", requireAuth(["admin"]), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Товар не найден" });
  const name = req.body.name != null ? String(req.body.name).trim() : existing.name;
  const category =
    req.body.category != null
      ? req.body.category === "dessert"
        ? "dessert"
        : "drink"
      : existing.category;
  const price =
    req.body.price != null ? Math.round(Number(req.body.price)) : existing.price;
  const available =
    req.body.available != null
      ? req.body.available === false || req.body.available === 0
        ? 0
        : 1
      : existing.available;
  if (name.length < 2 || !Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: "Укажите название и цену" });
  }
  db.prepare(
    `UPDATE menu_items SET name = ?, category = ?, price = ?, available = ? WHERE id = ?`
  ).run(name, category, price, available, id);
  res.json(db.prepare("SELECT * FROM menu_items WHERE id = ?").get(id));
});

app.delete("/api/admin/menu/:id", requireAuth(["admin"]), (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare("DELETE FROM menu_items WHERE id = ?").run(id);
  if (!info.changes) return res.status(404).json({ error: "Товар не найден" });
  res.json({ ok: true });
});

app.post("/api/admin/import-csv", requireAuth(["admin"]), (req, res) => {
  const csv = String(req.body.csv || "");
  const mode = req.body.mode === "replace" ? "replace" : "append";
  let items;
  try {
    items = parseCsv(csv);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!items.length) return res.status(400).json({ error: "В CSV нет строк товаров" });
  const insert = db.prepare(
    `INSERT INTO menu_items (name, category, price, available) VALUES (@name, @category, @price, @available)`
  );
  const tx = db.transaction((rows) => {
    if (mode === "replace") db.prepare("DELETE FROM menu_items").run();
    for (const row of rows) insert.run(row);
  });
  tx(items);
  res.json({ imported: items.length, mode });
});

app.get("/api/admin/stats", requireAuth(["admin"]), (req, res) => {
  const range = req.query.range === "30d" ? "30d" : req.query.range === "today" ? "today" : "7d";
  let since;
  let bucket;
  if (range === "today") {
    since = "datetime('now', 'start of day')";
    bucket = "%Y-%m-%d %H:00";
  } else if (range === "30d") {
    since = "datetime('now', '-30 days')";
    bucket = "%Y-%m-%d";
  } else {
    since = "datetime('now', '-7 days')";
    bucket = "%Y-%m-%d";
  }
  const points = db
    .prepare(
      `SELECT strftime('${bucket}', created_at) AS t, COUNT(*) AS count
       FROM orders
       WHERE created_at >= ${since}
       GROUP BY t
       ORDER BY t`
    )
    .all();
  const totals = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM orders WHERE created_at >= ${since}) AS orders,
         (SELECT COALESCE(SUM(i.qty), 0) FROM order_items i
          JOIN orders o ON o.id = i.order_id
          WHERE o.created_at >= ${since}) AS items`
    )
    .get();
  res.json({ range, points, totals });
});

app.listen(PORT, () => {
  console.log(`Coffee preorder: http://localhost:${PORT}`);
});
