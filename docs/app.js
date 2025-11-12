// ====== CONFIG ======
const API_BASE = "https://taash-multyplayer.onrender.com";
const socket = io(API_BASE);

let token = localStorage.getItem("token") || null;
let username = localStorage.getItem("username") || null;

const authSection = document.getElementById("auth");
const dashboard = document.getElementById("dashboard");
const userNameDisplay = document.getElementById("user-name");
const userCoinsDisplay = document.getElementById("user-coins");
const gameLog = document.getElementById("game-log");
const authMsg = document.getElementById("auth-message");

// ====== REGISTER ======
async function register() {
  const username = document.getElementById("reg-username").value.trim();
  const password = document.getElementById("reg-password").value.trim();
  if (!username || !password) return alert("Enter both fields");

  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  alert(data.message || "Registered successfully!");
}

// ====== LOGIN ======
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
      localStorage.setItem("token", data.token);
      localStorage.setItem("username", data.username);
      token = data.token;
      username = data.username;

      authMsg.textContent = "✅ Login successful! Redirecting...";
      authMsg.style.color = "green";

      setTimeout(() => {
        showDashboard();
        getWallet();
      }, 600);
    } else {
      authMsg.textContent = data.message || "❌ Login failed!";
      authMsg.style.color = "red";
    }
  } catch (err) {
    console.error("Login Error:", err);
    alert("⚠️ Server not reachable. Try again later.");
  }
}

// ====== SHOW DASHBOARD ======
function showDashboard() {
  const user = localStorage.getItem("username") || "Player";
  userNameDisplay.textContent = user;
  authSection.style.display = "none";
  dashboard.style.display = "block";
  console.log("✅ Dashboard shown for:", user);
}

// ====== GET WALLET ======
async function getWallet() {
  try {
    const res = await fetch(`${API_BASE}/api/wallet`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    userCoinsDisplay.textContent = data.coins || 0;
  } catch (err) {
    console.error("Wallet fetch error:", err);
  }
}

// ====== ADD COINS ======
async function addCoins() {
  const coins = parseInt(document.getElementById("coin-amount").value);
  if (!coins) return alert("Enter valid coin amount");

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

// ====== DEDUCT COINS ======
async function deductCoins() {
  const coins = parseInt(document.getElementById("coin-amount").value);
  if (!coins) return alert("Enter valid coin amount");

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

// ====== JOIN GAME ======
function joinGame() {
  const room = document.getElementById("room-name").value.trim();
  const username = localStorage.getItem("username");
  if (!room) return alert("Enter room name first");

  socket.emit("joinGame", room, username);
  logMessage(`🟢 You joined room: ${room}`);
}

// ====== SOCKET EVENTS ======
socket.on("connect", () => {
  console.log("✅ Connected to server:", socket.id);
});

socket.on("playerJoined", (data) => {
  logMessage(`👤 ${data.username} joined the room`);
});

// ====== LOG OUT ======
function logout() {
  localStorage.clear();
  dashboard.style.display = "none";
  authSection.style.display = "block";
  authMsg.textContent = "";
  console.log("🚪 Logged out successfully");
}

// ====== GAME LOG UI ======
function logMessage(msg) {
  const p = document.createElement("p");
  p.textContent = msg;
  gameLog.appendChild(p);
  gameLog.scrollTop = gameLog.scrollHeight;
}

// ====== AUTO LOGIN ======
if (token && username) {
  showDashboard();
  getWallet();
}
