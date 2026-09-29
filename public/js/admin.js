const user = requireRole(["admin"]);
if (!user) throw new Error("redirect");

document.getElementById("who").textContent = user.name + " · " + user.phone;
document.getElementById("logout").onclick = logout;

let chart;
let currentRange = "7d";

async function loadStats(range = currentRange) {
  currentRange = range;
  const data = await api("/api/admin/stats?range=" + encodeURIComponent(range));
  document.getElementById("totals").textContent =
    `Заказов: ${data.totals.orders}, позиций: ${data.totals.items}`;
  const labels = data.points.map((p) => p.t);
  const values = data.points.map((p) => p.count);
  const ctx = document.getElementById("chart");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Заказы",
          data: values,
          borderColor: "#c4783a",
          backgroundColor: "rgba(196, 120, 58, 0.18)",
          fill: true,
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function catLabel(c) {
  return c === "dessert" ? "Десерт" : "Напиток";
}

async function loadMenu() {
  const items = await api("/api/menu");
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = "";
  for (const item of items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input data-f="name" value="${item.name.replaceAll('"', "&quot;")}" /></td>
      <td>
        <select data-f="category">
          <option value="drink" ${item.category === "drink" ? "selected" : ""}>Напиток</option>
          <option value="dessert" ${item.category === "dessert" ? "selected" : ""}>Десерт</option>
        </select>
      </td>
      <td><input data-f="price" type="number" min="0" value="${item.price}" /></td>
      <td><input data-f="available" type="checkbox" ${item.available ? "checked" : ""} /></td>
    `;
    const td = document.createElement("td");
    const save = document.createElement("button");
    save.textContent = "Сохранить";
    save.onclick = async () => {
      const err = document.getElementById("menu-error");
      try {
        await api("/api/admin/menu/" + item.id, {
          method: "PATCH",
          body: JSON.stringify({
            name: tr.querySelector('[data-f="name"]').value,
            category: tr.querySelector('[data-f="category"]').value,
            price: Number(tr.querySelector('[data-f="price"]').value),
            available: tr.querySelector('[data-f="available"]').checked,
          }),
        });
        err.textContent = "";
        loadMenu();
      } catch (e) {
        err.textContent = e.message;
      }
    };
    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "Удалить";
    del.onclick = async () => {
      if (!confirm("Удалить товар?")) return;
      await api("/api/admin/menu/" + item.id, { method: "DELETE" });
      loadMenu();
    };
    td.append(save, del);
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

document.getElementById("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("add-error");
  err.textContent = "";
  try {
    await api("/api/admin/menu", {
      method: "POST",
      body: JSON.stringify({
        name: document.getElementById("name").value,
        category: document.getElementById("category").value,
        price: Number(document.getElementById("price").value),
        available: true,
      }),
    });
    e.target.reset();
    loadMenu();
  } catch (ex) {
    err.textContent = ex.message;
  }
});

async function importCsv(mode) {
  const err = document.getElementById("csv-error");
  err.textContent = "";
  const file = document.getElementById("csv").files[0];
  if (!file) {
    err.textContent = "Выберите CSV-файл";
    return;
  }
  const csv = await file.text();
  try {
    const res = await api("/api/admin/import-csv", {
      method: "POST",
      body: JSON.stringify({ csv, mode }),
    });
    err.style.color = "var(--ok)";
    err.textContent = "Импортировано: " + res.imported;
    loadMenu();
  } catch (ex) {
    err.style.color = "";
    err.textContent = ex.message;
  }
}

document.getElementById("import-append").onclick = () => importCsv("append");
document.getElementById("import-replace").onclick = () => importCsv("replace");
for (const btn of document.querySelectorAll("[data-range]")) {
  btn.onclick = () => loadStats(btn.dataset.range).catch((e) => alert(e.message));
}

loadStats().catch((e) => alert(e.message));
loadMenu().catch((e) => {
  document.getElementById("menu-error").textContent = e.message;
});
