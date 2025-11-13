// ✅ app.js (Final Ready to Paste)
const socket = io("http://localhost:5000"); // change URL if deployed

let username = localStorage.getItem("username") || `Guest_${Math.floor(Math.random() * 1000)}`;
let room = "global_room";
let myHand = [];
let myCoins = 0;

// --- UI ELEMENTS ---
const gameArea = document.getElementById("gameArea");
const handDiv = document.getElementById("hand");
const logDiv = document.getElementById("log");
const bidBtn = document.getElementById("startBidBtn");
const bidAmountInput = document.getElementById("bidAmount");
const walletSpan = document.getElementById("wallet");

// --- JOIN ROOM ---
socket.emit("joinRoom", { room, username });

// --- EVENT HANDLERS ---
socket.on("roomUpdate", ({ players }) => {
  log(`👥 Players: ${players.map(p => p.username).join(", ")}`);
});

socket.on("gameStarted", ({ hands }) => {
  myHand = hands[socket.id] || [];
  renderHand();
  playSound("card-deal");
  log("🎮 Game started!");
});

socket.on("cardPlayed", ({ username, card }) => {
  log(`🃏 ${username} played ${card.rank}${card.suit}`);
  playSound("card-flip");
});

socket.on("bidStarted", ({ biddingTeam, bidAmount }) => {
  log(`💰 Bid started by ${biddingTeam.join(" & ")} for ${bidAmount} coins`);
  playSound("bid-start");
});

socket.on("walletUpdate", ({ username, coins }) => {
  if (username === localStorage.getItem("username")) {
    myCoins = coins;
    walletSpan.textContent = coins;
  }
  log(`💵 ${username}'s wallet updated: ${coins}`);
});

socket.on("errorMessage", ({ message }) => {
  log(`❌ ${message}`);
});

// --- UI FUNCTIONS ---
function renderHand() {
  handDiv.innerHTML = "";
  myHand.forEach(card => {
    const c = document.createElement("div");
    c.classList.add("card");
    c.innerHTML = `<span>${card.rank}</span><span>${card.suit}</span>`;
    c.onclick = () => playCard(card);
    handDiv.appendChild(c);
  });
}

function playCard(card) {
  socket.emit("playCard", { room, username, card });
  myHand = myHand.filter(c => !(c.rank === card.rank && c.suit === card.suit));
  renderHand();
}

// --- START BID ---
bidBtn.onclick = () => {
  const bidAmount = parseInt(bidAmountInput.value);
  if (isNaN(bidAmount) || bidAmount <= 0) {
    log("⚠️ Invalid bid amount");
    return;
  }
  const team = prompt("Enter team players (comma separated)").split(",").map(s => s.trim());
  socket.emit("startBid", { room, biddingTeam: team, bidAmount });
};

// --- HELPERS ---
function log(msg) {
  const p = document.createElement("p");
  p.innerHTML = msg;
  logDiv.appendChild(p);
  logDiv.scrollTop = logDiv.scrollHeight;
}

function playSound(type) {
  const sounds = {
    "card-deal": "https://cdn.pixabay.com/download/audio/2022/03/15/audio_8ac2a62be3.mp3?filename=card-deal-1.mp3",
    "card-flip": "https://cdn.pixabay.com/download/audio/2022/03/15/audio_f7a7f0b7b6.mp3?filename=card-flip.mp3",
    "bid-start": "https://cdn.pixabay.com/download/audio/2022/03/15/audio_0ebc25287a.mp3?filename=coin-drop.mp3"
  };
  const audio = new Audio(sounds[type]);
  audio.play();
}
