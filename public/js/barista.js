const user = requireRole(["barista", "admin"]);
if (!user) throw new Error("redirect");

document.getElementById("who").textContent = user.name + " · " + user.phone;
document.getElementById("logout").onclick = logout;

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

async function load() {
  const error = document.getElementById("error");
  try {
    const orders = await api("/api/barista/orders");
    const list = document.getElementById("list");
    list.innerHTML = orders.length ? "" : "<p class='muted'>Пока нет активных заказов</p>";
    for (const o of orders) {
      const el = document.createElement("article");
      el.className = "order" + (o.status === "ready" ? " ready" : "");
      const lines = o.items.map((i) => `${i.name_snapshot} × ${i.qty}`).join(", ");
      el.innerHTML = `
        <h3>${o.guest_name}</h3>
        <p>${o.guest_phone}</p>
        <p>${lines}</p>
        <p><strong>Выдача:</strong> ${fmtTime(o.pickup_at)} · статус: ${o.status === "new" ? "новый" : "готов"}</p>
      `;
      const row = document.createElement("div");
      row.className = "row";
      if (o.status === "new") {
        const ready = document.createElement("button");
        ready.textContent = "Готов";
        ready.onclick = () => update(o.id, "ready");
        row.appendChild(ready);
      }
      const done = document.createElement("button");
      done.className = "secondary";
      done.textContent = "Выдан";
      done.onclick = () => update(o.id, "done");
      row.appendChild(done);
      el.appendChild(row);
      list.appendChild(el);
    }
    error.textContent = "";
  } catch (err) {
    error.textContent = err.message;
  }
}

async function update(id, status) {
  await api("/api/barista/orders/" + id, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  load();
}

load();
setInterval(load, 5000);
