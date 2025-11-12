// frontend/docs/app.js

const API_BASE = "https://taash-multyplayer.onrender.com"; // Backend URL
const socket = io(API_BASE); // Socket.io connection

let token = localStorage.getItem("token") || null;
let username = localStorage.getItem("username") || null;

const authSection = document.getElementById("auth");
const dashboard = document.getElementById("dashboard");
const userNameDisplay = document.getElementById("user-name");
const userCoinsDisplay = document.getElementById("user-coins");
const gameLog = document.getElementById("game-log");

// ✅ REGISTER
async function register() {
  const username = document.getElementById("reg-username").value;
  const password = document.getElementById("reg-password").value;

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
  const username = document.getElementById("login-username").value;
  const password = document.getElementById("login-password").value;

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
    userNameDisplay.textContent = data.username;
    showDashboard();
    getWallet();
  } else {
    alert(data.message || "Login failed");
  }
}

// ✅ SHOW DASHBOARD
function showDashboard() {
  authSection.style.display = "none";
  dashboard.style.display = "block";
}

// ✅ GET WALLET
async function getWallet() {
  const res = await fetch(`${API_BASE}/api/wallet`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  userCoinsDisplay.textContent = data.coins || 0;
}

// ✅ ADD COINS
async function addCoins() {
  const coins = parseInt(document.getElementById("coin-amount").value);
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

// ✅ JOIN GAME ROOM
function joinGame() {
  const room = document.getElementById("room-name").value;
  const username = localStorage.getItem("username");

  if (!room) return alert("Enter room name");

  socket.emit("joinGame", room, username);
  logMessage(`🟢 Joined room: ${room}`);
}

// ✅ LISTEN FOR EVENTS
socket.on("connect", () => {
  console.log("✅ Connected to server:", socket.id);
});

socket.on("playerJoined", (data) => {
  logMessage(`👤 ${data.username} joined the room`);
});

// ✅ LOG MESSAGE FUNCTION
function logMessage(msg) {
  const p = document.createElement("p");
  p.textContent = msg;
  gameLog.appendChild(p);
}

// ✅ AUTO-LOGIN CHECK
if (token && username) {
  showDashboard();
  userNameDisplay.textContent = username;
  getWallet();
}
