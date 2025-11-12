async function login() {
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value.trim();

  if (!username || !password) {
    alert("Please enter both username and password");
    return;
  }

  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const data = await res.json();

  if (data.token) {
    localStorage.setItem("token", data.token);
    localStorage.setItem("username", data.username);
    token = data.token;
    username = data.username;

    document.getElementById("auth-message").textContent = "✅ Login successful! Redirecting...";
    
    // Show dashboard
    showDashboard();
    getWallet();

    setTimeout(() => {
      document.getElementById("auth").style.display = "none";
      document.getElementById("dashboard").style.display = "block";
    }, 800);
  } else {
    alert(data.message || "❌ Login failed. Try again.");
  }
}

// ✅ Show Dashboard function
function showDashboard() {
  const username = localStorage.getItem("username");
  document.getElementById("user-name").textContent = username || "Player";
  document.getElementById("auth").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
}

// ✅ Logout function
function logout() {
  localStorage.clear();
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("auth").style.display = "block";
  document.getElementById("auth-message").textContent = "";
}
