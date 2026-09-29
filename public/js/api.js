const TOKEN_KEY = "cafe_token";

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem("cafe_user", JSON.stringify(user));
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem("cafe_user") || "null");
  } catch {
    return null;
  }
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem("cafe_user");
  location.href = "/";
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const token = getToken();
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}

function money(n) {
  return new Intl.NumberFormat("ru-RU").format(n) + " ₽";
}

function homeForRole(role) {
  if (role === "admin") return "/admin.html";
  if (role === "barista") return "/barista.html";
  return "/guest.html";
}

function requireRole(allowed) {
  if (!getToken()) {
    location.href = "/";
    return null;
  }
  const user = getUser();
  if (!user || !allowed.includes(user.role)) {
    location.href = homeForRole(user && user.role);
    return null;
  }
  return user;
}
