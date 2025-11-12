async function login() {
  const user = document.getElementById("login-username").value.trim();
  const pass = document.getElementById("login-password").value.trim();

  if (!user || !pass) {
    alert("Please enter both username and password");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user, password: pass }),
    });

    const data = await res.json();

    if (data.token) {
      // ✅ Store session
      localStorage.setItem("token", data.token);
      localStorage.setItem("username", data.username);
      token = data.token;
      username = data.username;

      document.getElementById("auth-message").textContent =
        "✅ Login successful! Redirecting...";

      // ✅ Hide auth + show dashboard
      setTimeout(() => {
        showDashboard();
        getWallet();
      }, 500);
    } else {
      alert(data.message || "❌ Login failed. Try again.");
    }
  } catch (err) {
    console.error("Login Error:", err);
    alert("⚠️ Server not reachable. Try again later.");
  }
}

// ✅ SHOW DASHBOARD
function showDashboard() {
  const user = localStorage.getItem("username") || "Player";
  document.getElementById("user-name").textContent = user;
  document.getElementById("auth").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  console.log("✅ Dashboard shown for:", user);
}

// ✅ LOGOUT
function logout() {
  localStorage.clear();
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("auth").style.display = "block";
  document.getElementById("auth-message").textContent = "";
  console.log("🚪 Logged out successfully");
}
