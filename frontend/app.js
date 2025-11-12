const baseURL = "https://taash-multyplayer.onrender.com/api";
let currentUser = null;

// Socket.io client
let socket = null;

// Register
async function register() {
  const username = document.getElementById("reg-username").value;
  const password = document.getElementById("reg-password").value;

  const res = await fetch(`${baseURL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  alert(data.message);
}

// Login
async function login() {
  const username = document.getElementById("login-username").value;
  const password = document.getElementById("login-password").value;

  const res = await fetch(`${baseURL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (data.user) {
    currentUser = data.user;
    document.getElementById("user-name").innerText = currentUser.username;
    document.getElementById("auth").style.display = "none";
    document.getElementById("dashboard").style.display = "block";
    loadBalance();
  } else {
    alert(data.message);
  }
}

// Load balance
async function loadBalance() {
  const res = await fetch(`${baseURL}/wallet/balance/${currentUser.username}`);
  const data = await res.json();
  document.getElementById("user-coins").innerText = data.coins;
}

// Add coins
async function addCoins() {
  const amount = Number(document.getElementById("coin-amount").value);
  const res = await fetch(`${baseURL}/wallet/add-coins`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: currentUser.username, coins: amount })
  });
  const data = await res.json();
  alert(data.message);
  loadBalance();
}

// Deduct coins
async function deductCoins() {
  const amount = Number(document.getElementById("coin-amount").value);
  const res = await fetch(`${baseURL}/wallet/deduct-coins`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: currentUser.username, coins: amount })
  });
  const data = await res.json();
  alert(data.message);
  loadBalance();
}

// Join game room
function joinGame() {
  const room = document.getElementById("room-name").value;
  if (!socket) socket = io("https://taash-multyplayer.onrender.com");

  socket.emit("joinGame", room, currentUser.username);

  socket.on("playerJoined", (data) => {
    const log = document.getElementById("game-log");
    log.innerHTML += `<p>${data.username} joined the room!</p>`;
  });
}
