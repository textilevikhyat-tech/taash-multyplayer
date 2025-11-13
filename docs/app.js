// ✅ app.js (Final Frontend Logic)
const socket = io("http://localhost:5000"); // change if deployed

let username = localStorage.getItem("username") || `Guest_${Math.floor(Math.random()*1000)}`;
let room = "global_room";
let myHand = [];
let myCoins = 0;

const handDiv = document.getElementById("hand");
const logDiv = document.getElementById("log");
const bidBtn = document.getElementById("startBidBtn");
const bidInput = document.getElementById("bidAmount");
const walletSpan = document.getElementById("wallet");

socket.emit("joinRoom", { room, username });

socket.on("roomUpdate", ({ players }) => {
  log(`👥 Players joined: ${players.map(p => p.username).join(", ")}`);
});

socket.on("gameStarted", ({ hands }) => {
  myHand = hands[socket.id] || [];
  renderHand();
  playSound("deal");
  log("🎮 Game started!");
});

socket.on("cardPlayed", ({ username, card }) => {
  log(`🃏 ${username} played ${card.rank}${card.suit}`);
  playSound("flip");
});

socket.on("bidStarted", ({ biddingTeam, bidAmount }) => {
  log(`💰 Bid started by ${biddingTeam.join(" & ")} for ${bidAmount} coins`);
  playSound("coin");
});

socket.on("walletUpdate", ({ username, coins }) => {
  if (username === localStorage.getItem("username")) {
    myCoins = coins;
    walletSpan.textContent = "Coins: " + coins;
  }
});

socket.on("errorMessage", ({ message }) => {
  log(`❌ ${message}`);
});

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

bidBtn.onclick = () => {
  const bidAmount = parseInt(bidInput.value);
  if (isNaN(bidAmount) || bidAmount <= 0) {
    log("⚠️ Invalid bid amount");
    return;
  }
  const team = prompt("Enter team players (comma separated)").split(",").map(s => s.trim());
  socket.emit("startBid", { room, biddingTeam: team, bidAmount });
};

function log(msg) {
  const p = document.createElement("p");
  p.innerHTML = msg;
  logDiv.appendChild(p);
  logDiv.scrollTop = logDiv.scrollHeight;
}

function playSound(type) {
  const soundMap = {
    flip: document.getElementById("flipSound"),
    deal: document.getElementById("dealSound"),
    coin: document.getElementById("coinSound")
  };
  soundMap[type]?.play();
}
