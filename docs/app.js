const baseURL = "https://taash-multyplayer.onrender.com/api";
const socket = io("https://taash-multyplayer.onrender.com");

let currentUser = null;

function updateCoins() {
  if (currentUser) document.getElementById("user-coins").innerText = currentUser.coins;
}

// Register
async function register() {
  const username = document.getElementById("reg-username").value;
  const password = document.getElementById("reg-password").value;
  if (!username || !password) return alert("Enter username & password");

  try {
    const res = await fetch(`${baseURL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    alert(res.ok ? "Registered! Login now." : data.message);
  } catch (err) { alert("Server error: " + err.message); }
}

// Login
async function login() {
  const username = document.getElementById("login-username").value;
  const password = document.getElementById("login-password").value;
  if (!username || !password) return alert("Enter username & password");

  try {
    const res = await fetch(`${baseURL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok) {
      currentUser = data.user;
      document.getElementById("user-name").innerText = currentUser.username;
      document.getElementById("dashboard").style.display = "block";
      document.getElementById("auth").style.display = "none";
      updateCoins();
    } else alert(data.message);
  } catch (err) { alert("Server error: " + err.message); }
}

// Wallet
async function addCoins() {
  const amount = parseInt(document.getElementById("coin-amount").value);
  if (!amount) return alert("Enter amount");
  try {
    const res = await fetch(`${baseURL}/wallet/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: currentUser._id, coins: amount })
    });
    const data = await res.json();
    if (res.ok) { currentUser.coins = data.user.coins; updateCoins(); alert("Coins added!"); }
    else alert(data.message);
  } catch (err) { alert(err.message); }
}

async function deductCoins() {
  const amount = parseInt(document.getElementById("coin-amount").value);
  if (!amount) return alert("Enter amount");
  try {
    const res = await fetch(`${baseURL}/wallet/deduct`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: currentUser._id, coins: amount })
    });
    const data = await res.json();
    if (res.ok) { currentUser.coins = data.user.coins; updateCoins(); alert("Coins deducted!"); }
    else alert(data.message);
  } catch (err) { alert(err.message); }
}

// Game Room
function joinGame() {
  const room = document.getElementById("room-name").value;
  if (!room) return alert("Enter room name");
  socket.emit("joinGame", room, currentUser.username);

  socket.on("playerJoined", (data) => {
    const log = document.getElementById("game-log");
    const p = document.createElement("p");
    p.innerText = `${data.username} joined room ${room}`;
    log.appendChild(p);
  });
}
