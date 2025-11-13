const API_BASE = "https://taash-multyplayer.onrender.com"; // your backend URL
const socket = io(API_BASE);

let token = localStorage.getItem("token") || null;
let username = localStorage.getItem("username") || null;
let currentRoom = null;

const authSection = document.getElementById("auth");
const dashboard = document.getElementById("dashboard");
const userNameDisplay = document.getElementById("user-name");
const userCoinsDisplay = document.getElementById("user-coins");
const gameLog = document.getElementById("game-log");
const roomInfo = document.getElementById("room-info");
const bidsLog = document.getElementById("bids-log");
const biddingBox = document.getElementById("bidding");

// ---------- AUTH ----------
async function register() {
  const u = document.getElementById("reg-username").value.trim();
  const p = document.getElementById("reg-password").value.trim();
  if (!u || !p) return alert("Enter username and password");
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({username:u,password:p})
  });
  const data = await res.json();
  alert(data.message || "Registered");
}

async function login() {
  const u = document.getElementById("login-username").value.trim();
  const p = document.getElementById("login-password").value.trim();
  if (!u || !p) return alert("Enter both fields");
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({username:u,password:p})
  });
  const data = await res.json();
  if (data.token) {
    localStorage.setItem("token", data.token);
    localStorage.setItem("username", data.username);
    token = data.token;
    username = data.username;
    showDashboard();
    getWallet();
    log(`✅ Logged in as ${username}`);
  } else alert(data.message || "Login failed");
}

function logout() {
  localStorage.clear();
  token = null; username = null; currentRoom = null;
  dashboard.style.display="none";
  authSection.style.display="block";
  roomInfo.innerHTML="";
  log("Logged out");
}

function showDashboard() {
  authSection.style.display="none";
  dashboard.style.display="block";
  userNameDisplay.textContent = username;
}

// ---------- WALLET ----------
async function getWallet() {
  try {
    const res = await fetch(`${API_BASE}/api/wallet`, { headers:{Authorization:`Bearer ${token}`} });
    const data = await res.json();
    userCoinsDisplay.textContent = data.coins ?? 0;
  } catch { userCoinsDisplay.textContent = "0"; }
}

async function addCoins() {
  const amt = parseInt(document.getElementById("coin-amount").value);
  if (!amt) return alert("Enter amount");
  await fetch(`${API_BASE}/api/wallet/add`, {
    method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}` },
    body: JSON.stringify({coins:amt})
  });
  getWallet();
}

async function deductCoins() {
  const amt = parseInt(document.getElementById("coin-amount").value);
  if (!amt) return alert("Enter amount");
  await fetch(`${API_BASE}/api/wallet/deduct`, {
    method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}` },
    body: JSON.stringify({coins:amt})
  });
  getWallet();
}

// ---------- ROOMS ----------
function createRoom() {
  const room = document.getElementById("room-name").value.trim();
  if(!room) return alert("Enter room name");
  socket.emit("createRoom",{room,username});
}

function joinRoom() {
  const room = document.getElementById("room-name").value.trim();
  if(!room) return alert("Enter room name");
  socket.emit("joinRoom",{room,username});
  currentRoom = room;
}

function leaveRoom() {
  if(!currentRoom) return;
  socket.emit("leaveRoom",currentRoom);
  currentRoom=null;
  roomInfo.innerHTML="";
  biddingBox.style.display="none";
}

function startGame() {
  if(!currentRoom) return alert("Join a room first");
  socket.emit("startGame",currentRoom);
}

// ---------- SOCKET ----------
socket.on("connect",()=>log(`Socket connected: ${socket.id}`));

socket.on("roomCreated",data=>log(`Room created: ${data.room}`));
socket.on("roomUpdate",data=>{
  currentRoom=data.room;
  roomInfo.innerHTML=`<b>Room:</b> ${data.room} — Players: ${data.players.map(p=>p.username).join(", ")}`;
  log(`Players: ${data.players.map(p=>p.username).join(", ")}`);
});

socket.on("gameStarted",data=>{
  log("🎮 Game started — cards dealt");
  biddingBox.style.display="block"; bidsLog.innerHTML="";
  const hands = data.hands||data;
  let myHand = hands[username]||hands[socket.id]||[];
  renderHand(myHand);
});

socket.on("bidUpdate",info=>{
  bidsLog.innerHTML="";
  info.bidsArray.forEach(b=>{
    const p=document.createElement("p");
    p.innerText=`${b.username}: ₹${b.amount}`;
    bidsLog.appendChild(p);
  });
  if(info.highestBidder) log(`🔔 Highest: ${info.highestBidder} - ₹${info.highestBid}`);
});

socket.on("cardPlayed",data=>{
  log(`${data.username} played ${data.card.rank}${data.card.suit}`);
});

socket.on("errorMessage",err=>alert("Error: "+(err.message||JSON.stringify(err))));

// ---------- LOG & HAND ----------
function log(msg){
  const p=document.createElement("p"); p.textContent=msg;
  gameLog.appendChild(p); gameLog.scrollTop=gameLog.scrollHeight;
}

function renderCardElement(card){
  let rank=card.rank??null; let suit=card.suit??null;
  if(!rank||!suit){
    if(typeof card==="string"){ const s=card.slice(-1); const r=card.slice(0,card.length-1); rank=r; suit=s;}
    else { rank=card.code||"?"; suit="";}
  }
  const el=document.createElement("div"); el.className="card playable";
  const rspan=document.createElement("div"); rspan.className="rank"; rspan.innerText=rank;
  const sspan=document.createElement("div"); sspan.className="suit"; sspan.innerText=suit;
  if(suit==="♥"||suit==="♦") sspan.classList.add("red"); else sspan.classList.add("black");
  el.appendChild(rspan); el.appendChild(sspan);

  el.addEventListener("click",()=>{
    if(!currentRoom) return alert("Join a room first");
    log(`🃏 You played ${rank}${suit}`);
    socket.emit("playCard",{room:currentRoom,card:{rank,suit},username});
    el.style.opacity="0.5";
  });
  return el;
}

function renderHand(cards){
  const handEl=document.getElementById("hand"); handEl.innerHTML="";
  (cards||[]).forEach(c=>handEl.appendChild(renderCardElement(c)));
}

// ---------- BIDDING ----------
function placeBid(){
  const amt=parseInt(document.getElementById("bid-amount").value);
  if(!currentRoom) return alert("Join a room first");
  if(!amt||amt<=0) return alert("Enter valid bid");
  socket.emit("placeBid",{room:currentRoom,username,amount:amt});
}

// ---------- AUTO LOGIN ----------
window.onload=()=>{
  if(token && username){ showDashboard(); getWallet();}
};
