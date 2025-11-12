const API_BASE = "https://taash-multyplayer.onrender.com"; // backend
const socket = io(API_BASE);

let token = localStorage.getItem("token") || null;
let username = localStorage.getItem("username") || null;

// --- Helper selectors
const authSection = document.getElementById("auth");
const dashboard = document.getElementById("dashboard");
const userNameDisplay = document.getElementById("user-name");
const userCoinsDisplay = document.getElementById("user-coins");
const gameLog = document.getElementById("game-log");

// ✅ REGISTER
async function register() {
  const username = document.getElementById("reg-username").value.trim();
  const password = document.getElementById("reg-password").value.trim();
  if (!username || !password) return alert("Enter username and password");

  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  alert(data.message || "Registered successfully!");
}

// ✅ LOGIN
async function login() {
  const usernameInput = document.getElementById("login-username").value.trim();
  const passwordInput = document.getElementById("login-password").value.trim();

  if (!usernameInput || !passwordInput) {
    alert("Please enter both fields");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: usernameInput, password: passwordInput }),
    });

    const data = await res.json();

    if (data.token) {
      localStorage.setItem("token", data.token);
      localStorage.setItem("username", data.username);
      token = data.token;
      username = data.username;

      document.getElementById("auth-message").textContent =
        "✅ Login successful! Redirecting...";
      showDashboard();
      getWallet();
    } else {
      alert(data.message || "Login failed");
    }
  } catch (err) {
    console.error("Login error:", err);
    alert("Server not reachable. Try again later.");
  }
}

// ✅ DASHBOARD DISPLAY
function showDashboard() {
  authSection.style.display = "none";
  dashboard.style.display = "block";
  userNameDisplay.textContent = localStorage.getItem("username");
}

// ✅ LOGOUT
function logout() {
  localStorage.clear();
  authSection.style.display = "block";
  dashboard.style.display = "none";
  document.getElementById("auth-message").textContent = "";
}

// ✅ WALLET FETCH
async function getWallet() {
  try {
    const res = await fetch(`${API_BASE}/api/wallet`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    userCoinsDisplay.textContent = data.coins || 0;
  } catch {
    userCoinsDisplay.textContent = "0";
  }
}

// ✅ ADD COINS
async function addCoins() {
  const coins = parseInt(document.getElementById("coin-amount").value);
  if (!coins) return alert("Enter amount");
  await fetch(`${API_BASE}/api/wallet/add`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ coins }),
  });
  getWallet();
}

// ✅ DEDUCT COINS
async function deductCoins() {
  const coins = parseInt(document.getElementById("coin-amount").value);
  if (!coins) return alert("Enter amount");
  await fetch(`${API_BASE}/api/wallet/deduct`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ coins }),
  });
  getWallet();
}

// ✅ JOIN GAME
function joinGame() {
  const room = document.getElementById("room-name").value.trim();
  const user = localStorage.getItem("username");
  if (!room) return alert("Enter room name");
  socket.emit("joinRoom", { room, username: user });
  logMessage(`🟢 You joined room: ${room}`);
}

// ✅ START GAME
function startGame() {
  const room = document.getElementById("room-name").value.trim();
  if (!room) return alert("Enter room name");
  socket.emit("startGame", room);
}

// ✅ SOCKET EVENTS
socket.on("connect", () => console.log("Connected:", socket.id));

socket.on("roomUpdate", (data) => {
  logMessage(
    `👥 Room: ${data.room} — Players: ${data.players
      .map((p) => p.username)
      .join(", ")}`
  );
});

socket.on("gameStarted", (data) => {
  logMessage("🎮 Game started! Cards have been dealt.");
  console.log(data.hands);
});

socket.on("errorMessage", (msg) => {
  alert("⚠️ " + msg.message);
});

// ✅ LOG HELPER
function logMessage(msg) {
  const p = document.createElement("p");
  p.textContent = msg;
  gameLog.appendChild(p);
}

// ✅ AUTO LOGIN
if (token && username) {
  showDashboard();
  getWallet();
}
