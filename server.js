// server.js (FULLY FIXED FOR YOUR PROJECT)
require("dotenv").config();

const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const fs = require("fs");

// Controllers & Models
const authController = require("./backend/controllers/authController");
const walletModel = require("./models/Wallet");     // ✅ FIXED PATH

// Express setup
const app = express();
app.use(cors());
app.use(express.json());

// MongoDB connect
mongoose
  .connect(process.env.MONGO_URI, {})
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log("❌ MongoDB Error:", err));

// Routes
app.post("/api/auth/register", authController.register);
app.post("/api/auth/login", authController.login);

// wallet route load (optional)
try {
  const walletRoutes = require("./routes/walletRoutes");
  app.use("/api/wallet", walletRoutes);
} catch (e) {
  console.log("⚠ walletRoutes skipped:", e.message);
}

// Serve frontend / public
if (fs.existsSync(path.join(__dirname, "frontend", "dist"))) {
  app.use(express.static(path.join(__dirname, "frontend", "dist")));
}
app.use(express.static(path.join(__dirname, "public")));

// GAME CONSTANTS
const SUITS = ["H", "D", "S", "C"];
const RANKS = ["J", "9", "A", "10", "K", "Q", "8", "7"];

const CARD_ORDER = { J: 8, 9: 7, A: 6, "10": 5, K: 4, Q: 3, 8: 2, 7: 1 };
const CARD_VALUES = { J: 3, 9: 2, A: 1, "10": 1, K: 0, Q: 0, 8: 0, 7: 0 };

function makeDeck() {
  const d = [];
  for (const s of SUITS)
    for (const r of RANKS)
      d.push({ suit: s, rank: r, id: r + s });
  return d;
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}
function getColor(s) {
  return s === "H" || s === "D" ? "RED" : "BLACK";
}
function hasPyar(h) {
  const q = h.filter(c => c.rank === "Q");
  const k = h.filter(c => c.rank === "K");
  for (const qq of q)
    for (const kk of k)
      if (getColor(qq.suit) === getColor(kk.suit))
        return getColor(qq.suit);
  return null;
}
function resolveTrick(trick, trump) {
  const lead = trick[0].card.suit;
  const trumpCards = trick.filter(t => t.card.suit === trump);
  const cand = trumpCards.length ? trumpCards : trick.filter(t => t.card.suit === lead);
  cand.sort((a, b) => CARD_ORDER[b.card.rank] - CARD_ORDER[a.card.rank]);
  return cand[0];
}

function calcPoints(cards, bonus = false) {
  let pts = 0;
  for (const c of cards)
    pts += CARD_VALUES[c.rank];
  if (bonus) pts += 1;
  return pts;
}

function applyPyarRule(match) {
  const bid = match.bid;
  const trumpColor = getColor(match.trumpSuit);

  const A = match.teams.declarer;
  const B = match.teams.opponent;

  let Apyar = [];
  let Bpyar = [];

  A.forEach(p => {
    const col = hasPyar(match.hands[p]);
    if (col) Apyar.push(col);
  });

  B.forEach(p => {
    const col = hasPyar(match.hands[p]);
    if (col) Bpyar.push(col);
  });

  let newBid = bid;

  if (Apyar.length === 1) {
    newBid = bid === 19 ? 16 : bid - 4;
  }

  if (Bpyar.includes(trumpColor)) {
    newBid += 4;
  }

  return { newBid, Apyar, Bpyar };
}

function makeBot() {
  return {
    id: "bot-" + crypto.randomBytes(3).toString("hex"),
    name: "Bot",
    isBot: true
  };
}

const rooms = {};
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

function findOpenRoom() {
  for (const c of Object.keys(rooms))
    if (rooms[c].status === "waiting" && rooms[c].players.length < 4)
      return c;
  return null;
}

function getSocket(id) {
  return io.sockets.sockets.get(id);
}

const AUTO_START_SECONDS = 6;

// socket starts
io.on("connection", (socket) => {
  console.log("🟢 Connected:", socket.id);

  // QUICK JOIN
  socket.on("quickJoin", ({ username }) => {
    socket.data.username = username || "Guest" + Math.floor(Math.random() * 9999);

    let code = findOpenRoom();
    if (!code) {
      code = crypto.randomBytes(3).toString("hex").toUpperCase();
      rooms[code] = { players: [], status: "waiting", autoStartTimer: null };
    }

    if (!rooms[code].players.find(p => p.id === socket.id)) {
      rooms[code].players.push({
        id: socket.id,
        name: socket.data.username,
        isBot: false
      });
    }

    socket.join(code);
    io.to(code).emit("roomUpdate", rooms[code].players);

    // Start timer if not enough players
    if (rooms[code].autoStartTimer) clearTimeout(rooms[code].autoStartTimer);

    rooms[code].autoStartTimer = setTimeout(() => {
      while (rooms[code].players.length < 4)
        rooms[code].players.push(makeBot());

      startMatch(code);
    }, AUTO_START_SECONDS * 1000);

    socket.emit("joinedRoom", code);
  });

  // Create Room
  socket.on("createRoom", ({ roomCode, username }) => {
    roomCode = roomCode || crypto.randomBytes(3).toString("hex").toUpperCase();
    if (rooms[roomCode]) {
      socket.emit("errorMessage", "Room already exists");
      return;
    }

    socket.data.username = username || ("Guest" + Math.floor(Math.random() * 9999));

    rooms[roomCode] = { players: [], status: "waiting" };
    rooms[roomCode].players.push({
      id: socket.id,
      name: socket.data.username,
      isBot: false
    });

    socket.join(roomCode);
    io.to(roomCode).emit("roomUpdate", rooms[roomCode].players);
    socket.emit("roomCreated", roomCode);
  });

  // Join Room
  socket.on("joinRoom", ({ roomCode, username }) => {
    if (!rooms[roomCode]) {
      socket.emit("errorMessage", "Room not found");
      return;
    }

    socket.data.username = username || ("Guest" + Math.floor(Math.random() * 9999));

    rooms[roomCode].players.push({
      id: socket.id,
      name: socket.data.username,
      isBot: false
    });

    socket.join(roomCode);
    io.to(roomCode).emit("roomUpdate", rooms[roomCode].players);
    socket.emit("joinedRoom", roomCode);
  });

  // Start Game manually
  socket.on("startGame", (roomCode) => {
    if (!rooms[roomCode]) return;

    while (rooms[roomCode].players.length < 4)
      rooms[roomCode].players.push(makeBot());

    startMatch(roomCode);
  });

  // PLAY CARD
  socket.on("playCard", ({ roomCode, card }) => {
    const r = rooms[roomCode];
    if (!r || !r.match) return;

    const m = r.match;
    const pid = socket.id;
    const hand = m.hands[pid];

    const idx = hand.findIndex(x => x.id === card.id);
    if (idx === -1) return;

    const played = hand.splice(idx, 1)[0];

    m.currentTrick.push({ playerId: pid, card: played });

    io.to(roomCode).emit("cardPlayed", {
      playerId: pid,
      card: played
    });

    // trick resolve
    if (m.currentTrick.length === 4) {
      const win = resolveTrick(m.currentTrick, m.trumpSuit);
      m.trickHistory.push({ trick: [...m.currentTrick], winner: win.playerId });

      const team = m.teams.declarer.includes(win.playerId)
        ? "declarerTeamCards"
        : "opponentTeamCards";

      m.scores[team].push(...m.currentTrick.map(t => t.card));

      m.currentTrick = [];
      m.turnIndex = m.playerOrder.indexOf(win.playerId);

      io.to(roomCode).emit("trickWon", { winner: win.playerId });
    }

    const empty = Object.values(m.hands).every(h => h.length === 0);
    if (empty) {
      const lastWin = m.trickHistory[m.trickHistory.length - 1].winner;
      const decPts = calcPoints(m.scores.declarerTeamCards, m.teams.declarer.includes(lastWin));
      const oppPts = calcPoints(m.scores.opponentTeamCards, m.teams.opponent.includes(lastWin));

      io.to(roomCode).emit("matchEnd", { declarerPoints: decPts, opponentPoints: oppPts });

      r.status = "waiting";
      delete r.match;
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    for (const code of Object.keys(rooms)) {
      rooms[code].players = rooms[code].players.filter(p => p.id !== socket.id);
      io.to(code).emit("roomUpdate", rooms[code].players);
    }
  });
});

// Start Match Function
function startMatch(code) {
  const r = rooms[code];
  r.status = "playing";

  const deck = makeDeck();
  shuffle(deck);

  const hands = {};
  r.players.forEach(p => hands[p.id] = []);

  let i = 0;
  while (i < 32) {
    const pid = r.players[i % 4].id;
    hands[pid].push(deck[i]);
    i++;
  }

  const order = r.players.map(p => p.id);
  const teams = {
    declarer: [order[0], order[2]],
    opponent: [order[1], order[3]]
  };

  const match = {
    bid: 16,
    trumpSuit: "H",
    hands,
    playerOrder: order,
    turnIndex: 0,
    currentTrick: [],
    trickHistory: [],
    teams,
    scores: {
      declarerTeamCards: [],
      opponentTeamCards: []
    }
  };

  const pyar = applyPyarRule(match);
  match.bid = pyar.newBid;

  r.match = match;

  // send hands privately
  r.players.forEach(p => {
    if (!p.isBot) {
      const s = getSocket(p.id);
      if (s)
        s.emit("dealPrivate", {
          yourCards: hands[p.id],
          bid: match.bid,
          trumpSuit: match.trumpSuit
        });
    }
  });

  io.to(code).emit("matchStart", {
    players: r.players.map(p => ({ id: p.id, name: p.name })),
    bid: match.bid,
    trumpSuit: match.trumpSuit
  });
}

// Fallback
app.get("*", (req, res) => {
  if (fs.existsSync(path.join(__dirname, "frontend", "dist", "index.html"))) {
    return res.sendFile(path.join(__dirname, "frontend", "dist", "index.html"));
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
