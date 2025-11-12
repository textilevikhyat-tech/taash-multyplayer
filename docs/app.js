// app.js

const API_BASE = "https://taash-multyplayer.onrender.com/api";

let currentUser = null;
let token = null; // Optional: if using JWT later

// ---------------------- REGISTER ----------------------
async function register() {
  const username = document.getElementById("reg-username").value;
  const password = document.getElementById("reg-password").value;

  if (!username || !password) return alert("Enter username & password");

  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();
    if (res.ok) {
      alert("Registered successfully! Please login.");
      document.getElementById("reg-username").value = "";
      document.getElementById("reg-password").value = "";
    } else {
      alert(data.message);
    }
  } catch (err) {
    console.error(err);
    alert("Server error");
  }
}

// ---------------------- LOGIN ----------------------
async function login() {
  const username = document.getElementById("login-username").value;
  const password = document.getElementById("login-password").value;

  if (!username || !password) return alert("Enter username & password");

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();
    if (res.ok) {
      currentUser = data.user;
      token = "dummy"; // Optional JWT
      showDashboard();
      updateCoins();
    } else {
      alert(data.message);
    }
  } catch (err) {
    console.error(err);
    alert("Server error");
  }
}

// ---------------------- DASHBOARD ----------------------
function showDashboard() {
  document.getElementById("auth").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  document.getElementById("user-name").innerText = currentUser.username;
}

// ---------------------- UPDATE COINS ----------------------
function updateCoins() {
  document.getElementById("user-coins").innerText = currentUser.coins;
}

// ---------------------- ADD COINS ----------------------
async function addCoins() {
  const amount = parseInt(document.getElementById("coin-amount").value);
  if (!amount || amount <= 0) return alert("Enter valid amount");

  try {
    const res = await fetch(`${API_BASE}/wallet/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: currentUser._id, coins: amount }),
    });

    const data = await res.json();
    if (res.ok) {
      currentUser.coins += amount;
      updateCoins();
      alert("Coins added!");
    } else alert(data.message);
  } catch (err) {
    console.error(err);
    alert("Server error");
  }
}

// ---------------------- DEDUCT COINS ----------------------
async function deductCoins() {
  const amount = parseInt(document.getElementById("coin-amount").value);
  if (!amount || amount <= 0) return alert("Enter valid amount");
  if (currentUser.coins < amount) return alert("Not enough coins");

  try {
    const res = await fetch(`${API_BASE}/wallet/deduct`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: currentUser._id, coins: amount }),
    });

    const data = await res.json();
    if (res.ok) {
      currentUser.coins -= amount;
      updateCoins();
      alert("Coins deducted!");
    } else alert(data.message);
  } catch (err) {
    console.error(err);
    alert("Server error");
  }
}

// ---------------------- SOCKET.IO ----------------------
const socket = io("https://taash-multyplayer.onrender.com");

function joinGame() {
  const room = document.getElementById("room-name").value;
  if (!room) return alert("Enter room name");

  socket.emit("joinGame", room, currentUser.username);

  socket.on("playerJoined", ({ username }) => {
    const log = document.getElementById("game-log");
    log.innerHTML += `<p>${username} joined the room!</p>`;
  });
}
