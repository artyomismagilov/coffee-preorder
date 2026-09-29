const user = requireRole(["guest"]);
if (!user) throw new Error("redirect");

document.getElementById("who").textContent = user.name + " · " + user.phone;
document.getElementById("logout").onclick = logout;

const cart = new Map();
const categoryLabel = { drink: "Напиток", dessert: "Десерт" };

function fillPickup() {
  const sel = document.getElementById("pickup");
  sel.innerHTML = "";
  const now = new Date();
  const rounded = new Date(now);
  rounded.setSeconds(0, 0);
  const m = rounded.getMinutes();
  rounded.setMinutes(m + (5 - (m % 5)) % 5);
  for (let i = 0; i <= 30; i += 5) {
    const t = new Date(rounded.getTime() + i * 60000);
    if (t.getTime() - now.getTime() > 30 * 60000) break;
    if (t < now && i > 0) continue;
    const opt = document.createElement("option");
    opt.value = t.toISOString();
    opt.textContent = t.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    sel.appendChild(opt);
  }
}

function renderCart() {
  const el = document.getElementById("cart");
  el.innerHTML = "";
  let sum = 0;
  if (!cart.size) {
    el.innerHTML = "<p class='muted'>Пока пусто</p>";
  }
  for (const item of cart.values()) {
    sum += item.price * item.qty;
    const row = document.createElement("div");
    row.className = "cart-line";
    row.innerHTML = `<span>${item.name} × ${item.qty}</span><span>${money(item.price * item.qty)}</span>`;
    const rm = document.createElement("button");
    rm.className = "secondary";
    rm.textContent = "−";
    rm.onclick = () => {
      item.qty -= 1;
      if (item.qty <= 0) cart.delete(item.id);
      renderCart();
    };
    row.appendChild(rm);
    el.appendChild(row);
  }
  document.getElementById("total").textContent = money(sum);
}

function addToCart(item) {
  const cur = cart.get(item.id) || { ...item, qty: 0 };
  cur.qty += 1;
  cart.set(item.id, cur);
  renderCart();
}

async function loadMenu() {
  const items = await api("/api/menu");
  const grid = document.getElementById("menu");
  grid.innerHTML = "";
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "item";
    card.innerHTML = `
      <span class="tag">${categoryLabel[item.category] || item.category}</span>
      <h3>${item.name}</h3>
      <div class="price">${money(item.price)}</div>
    `;
    const btn = document.createElement("button");
    btn.textContent = "В заказ";
    btn.onclick = () => addToCart(item);
    card.appendChild(btn);
    grid.appendChild(card);
  }
}

document.getElementById("submit").onclick = async () => {
  const error = document.getElementById("error");
  error.textContent = "";
  try {
    const items = [...cart.values()].map((i) => ({ id: i.id, qty: i.qty }));
    await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        items,
        pickupAt: document.getElementById("pickup").value,
      }),
    });
    cart.clear();
    renderCart();
    fillPickup();
    error.style.color = "var(--ok)";
    error.textContent = "Заказ принят. Оплата на кассе при выдаче.";
    setTimeout(() => {
      error.style.color = "";
      error.textContent = "";
    }, 4000);
  } catch (err) {
    error.style.color = "";
    error.textContent = err.message;
  }
};

fillPickup();
renderCart();
loadMenu().catch((err) => {
  document.getElementById("error").textContent = err.message;
});
