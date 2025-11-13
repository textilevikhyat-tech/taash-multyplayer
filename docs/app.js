const API_BASE = "https://taash-multyplayer.onrender.com"; // backend URL
const socket = io(API_BASE);

let token = localStorage.getItem("token") || null;
let username = localStorage.getItem("username") || null;

// Selectors
const authSection = document.getElementById("auth");
const dashboard = document.getElementById("dashboard");
const userNameDisplay = document.getElementById("user-name");
const userCoinsDisplay = document.getElementById("user-coins");
const gameLog = document.getElementById("game-log");

// --- REGISTER ---
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

// --- LOGIN ---
async function login() {
  const usernameInput = document.getElementById("login-username").value.trim();
  const passwordInput = document.getElementById("login-password").value.trim();
  if (!usernameInput || !passwordInput) return alert("Enter both fields");

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
      document.getElementById("auth-message").textContent = "✅ Login successful! Redirecting...";
      showDashboard();
      getWallet();
    } else alert(data.message || "Login failed");
  } catch(err){ alert("Server not reachable"); console.error(err);}
}

// --- DASHBOARD ---
function showDashboard() {
  authSection.style.display = "none";
  dashboard.style.display = "block";
  userNameDisplay.textContent = username;
}

// --- LOGOUT ---
function logout() {
  localStorage.clear();
  authSection.style.display = "block";
  dashboard.style.display = "none";
  document.getElementById("auth-message").textContent = "";
}

// --- WALLET ---
async function getWallet() {
  try {
    const res = await fetch(`${API_BASE}/api/wallet`, { headers: { Authorization: `Bearer ${token}` }});
    const data = await res.json();
    userCoinsDisplay.textContent = data.coins || 0;
  } catch { userCoinsDisplay.textContent = 0; }
}
async function addCoins() {
  const coins = parseInt(document.getElementById("coin-amount").value);
  if (!coins) return alert("Enter amount");
  await fetch(`${API_BASE}/api/wallet/add`, {
    method:"POST",
    headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}` },
    body: JSON.stringify({ coins })
  });
  getWallet();
}
async function deductCoins() {
  const coins = parseInt(document.getElementById("coin-amount").value);
  if (!coins) return alert("Enter amount");
  await fetch(`${API_BASE}/api/wallet/deduct`, {
    method:"POST",
    headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}` },
    body: JSON.stringify({ coins })
  });
  getWallet();
}

// --- GAME ROOM ---
function joinGame() {
  const room = document.getElementById("room-name").value.trim();
  if (!room) return alert("Enter room name");
  socket.emit("joinRoom", { room, username });
  logMessage(`🟢 You joined room: ${room}`);
}
function startGame() {
  const room = document.getElementById("room-name").value.trim();
  if (!room) return alert("Enter room name");
  socket.emit("startGame", room);
}

// --- LOG ---
function logMessage(msg){
  const p = document.createElement("p");
  p.textContent = msg;
  gameLog.appendChild(p);
}

// --- SOCKET EVENTS ---
socket.on("connect", () => console.log("Connected:", socket.id));

socket.on("roomUpdate", (data) => {
  logMessage(`👥 Room: ${data.room} — Players: ${data.players.map(p=>p.username).join(", ")}`);
});

socket.on("gameStarted", (data) => {
  logMessage("🎮 Game started! Cards have been dealt.");
  const hands = data.hands || {};
  let myHand = hands[socket.id] || hands[username] || [];
  renderHand(myHand);
});

socket.on("cardPlayed", ({ username, card }) => {
  logMessage(`🃏 ${username} played ${card.rank}${card.suit}`);
});

// --- CARD RENDERING ---
function renderCardElement(card){
  let rank = card.rank ?? null;
  let suit = card.suit ?? null;
  if (!rank || !suit) {
    if(typeof card==='string'){ suit=card.slice(-1); rank=card.slice(0,card.length-1);}
    else { rank=card.code||'?'; suit=''; }
  }
  const el = document.createElement('div');
  el.className = 'card playable';
  const rankSpan=document.createElement('span');
  rankSpan.className='rank'; rankSpan.innerText=rank;
  const suitSpan=document.createElement('span');
  suitSpan.className='suit'; suitSpan.innerText=suit;
  if(suit==='♥'||suit==='♦') suitSpan.classList.add('red'); else suitSpan.classList.add('black');
  el.appendChild(rankSpan); el.appendChild(suitSpan);

  el.addEventListener('click',()=>{
    const room=document.getElementById("room-name").value.trim();
    if(!room) return alert("No room joined!");
    logMessage(`🃏 You played ${rank}${suit}`);
    socket.emit("playCard",{ room, card:{rank,suit}, username });
    el.style.opacity="0.5";
  });
  return el;
}

function renderHand(cardsArray){
  const handEl=document.getElementById("hand");
  if(!handEl) return;
  handEl.innerHTML='';
  cardsArray.forEach(c=>handEl.appendChild(renderCardElement(c)));
}

// --- AUTO LOGIN ---
if(token && username){
  showDashboard();
  getWallet();
}
