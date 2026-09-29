document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const error = document.getElementById("error");
  error.textContent = "";
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        phone: document.getElementById("phone").value,
        name: document.getElementById("name").value,
      }),
    });
    setSession(data.token, data.user);
    location.href = homeForRole(data.user.role);
  } catch (err) {
    error.textContent = err.message;
  }
});
