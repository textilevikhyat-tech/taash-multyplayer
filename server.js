// server.js (fixed — replace your old server.js with this)
require("dotenv").config();

const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const fs = require("fs");

// Controllers & models
const authController = require("./backend/controllers/authController");
// Your model file may be named Transaction.js but export model 'Wallet' — we require the file.
// Adjust path if you renamed the file to Wallet.js
const walletModel = require("./models/Transaction"); // expects model with fields: { username, coins }

// Express
const app = express();
app.use(cors());
app.use(express.json());

// Mongo connect
mongoose
  .connect(process.env.MONGO_URI || "", { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log("❌ Mongo Error:", err && err.message));

// Routes
app.post("/api/auth/register", authController.register);
app.post("/api/auth/login", authController.login);
try {
  const walletRoutes = require("./routes/walletRoutes");
  app.use("/api/wallet", walletRoutes);
} catch (e) {
  console.log("No walletRoutes found or failed to load; continuing without mounting /api/wallet");
}

// Serve frontend
const frontendIndex = path.join(__dirname, "frontend", "dist", "index.html");
if (fs.existsSync(path.join(__dirname, "frontend", "dist"))) {
  app.use(express.static(path.join(__dirname, "frontend", "dist")));
}
if (fs.existsSync(path.join(__dirname, "public"))) {
  app.use(express.static(path.join(__dirname, "public")));
}

// --- GAME UTILITIES ---
const SUITS = ["H", "D", "S", "C"];
const RANKS = ["J", "9", "A", "10", "K", "Q", "8", "7"];
const CARD_ORDER = { J: 8, 9: 7, A: 6, "10": 5, K: 4, Q: 3, 8: 2, 7: 1 };
const CARD_VALUES = { J: 3, 9: 2, A: 1, "10": 1, K: 0, Q: 0, 8: 0, 7: 0 };

function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ suit: s, rank: r, id: r + s });
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
function hasPyar(hand) {
  if (!Array.isArray(hand)) return null;
  const qs = hand.filter((c) => c.rank === "Q");
  const ks = hand.filter((c) => c.rank === "K");
  for (const q of qs) for (const k of ks) if (getColor(q.suit) === getColor(k.suit)) return getColor(q.suit);
  return null;
}
function resolveTrick(trick, trumpSuit) {
  if (!trick || trick.length === 0) return null;
  const lead = trick[0].card.suit;
  const trumpPlayed = trick.filter((t) => t.card.suit === trumpSuit);
  const candidates = (trumpPlayed.length ? trumpPlayed : trick.filter((t) => t.card.suit === lead));
  candidates.sort((a, b) => CARD_ORDER[b.card.rank] - CARD_ORDER[a.card.rank]);
  return candidates[0]; // winner entry
}
function calcPoints(cards, lastTrickBonus = false) {
  let pts = 0;
  for (const c of cards) pts += CARD_VALUES[c.rank] || 0;
  if (lastTrickBonus) pts += 1;
  return pts;
}
function applyPyarRule(match) {
  const declarerBid = match.bid;
  const trumpColor = getColor(match.trumpSuit);
  const teamA = match.teams.declarer;
  const teamB = match.teams.opponent;

  let teamAPyar = [];
  let teamBPyar = [];
  for (const p of teamA) {
    const color = hasPyar(match.hands[p]);
    if (color) teamAPyar.push({ player: p, color });
  }
  for (const p of teamB) {
    const color = hasPyar(match.hands[p]);
    if (color) teamBPyar.push({ player: p, color });
  }

  let newBid = declarerBid;
  if (teamAPyar.length === 1) {
    if (declarerBid === 19) newBid = 16;
    else newBid = declarerBid - 4;
  }
  if (teamBPyar.length >= 1) {
    const matchPyar = teamBPyar.find((p) => p.color === trumpColor);
    if (matchPyar) newBid = newBid + 4;
  }
  return { newBid, teamAPyar, teamBPyar };
}

function makeBot(nameSuffix) {
  return { id: "bot-" + crypto.randomBytes(3).toString("hex"), name: "Bot" + (nameSuffix || ""), isBot: true, socketId: null };
}

const rooms = {};
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

function findOpenRoom() {
  for (const code of Object.keys(rooms)) {
    const r = rooms[code];
    if (r.status === "waiting" && r.players.length < 4) return code;
  }
  return null;
}
function getSocket(id) {
  return io.sockets.sockets.get(id) || null;
}
const AUTO_START_SECONDS = 6;

io.on("connection", (socket) => {
  console.log("🟢 socket connected:", socket.id);

  // ----------------- quickJoin -----------------
  socket.on("quickJoin", ({ username, preferredBid, preferredTrump }) => {
    try {
      // set socket username for later emits
      socket.data.username = username || ("Guest" + Math.floor(Math.random() * 10000));

      let code = findOpenRoom();
      if (!code) {
        code = crypto.randomBytes(3).toString("hex");
        rooms[code] = { players: [], status: "waiting", createdAt: Date.now(), autoStartTimer: null };
      }

      // prevent duplicate joins from same socket id (defensive)
      if (!rooms[code].players.find((p) => p.id === socket.id)) {
        const player = { id: socket.id, name: socket.data.username, socketId: socket.id, isBot: false };
        rooms[code].players.push(player);
      }

      socket.join(code);
      io.to(code).emit("roomUpdate", { room: code, players: rooms[code].players });

      if (rooms[code].players.length >= 4) {
        startMatch(code, { bid: preferredBid || 16, trumpSuit: preferredTrump || "H" });
        return;
      }

      if (rooms[code].autoStartTimer) clearTimeout(rooms[code].autoStartTimer);
      rooms[code].autoStartTimer = setTimeout(() => {
        while (rooms[code].players.length < 4) rooms[code].players.push(makeBot());
        startMatch(code, { bid: preferredBid || 16, trumpSuit: preferredTrump || "H" });
      }, AUTO_START_SECONDS * 1000);

      socket.emit("joinedRoom", { roomCode: code });
    } catch (e) {
      console.error(e);
      socket.emit("errorMessage", { message: "Quick join failed" });
    }
  });

  // ----------------- createRoom -----------------
  socket.on("createRoom", ({ roomCode, username }) => {
    try {
      socket.data.username = username || socket.data.username || ("Guest" + Math.floor(Math.random() * 10000));
      if (!roomCode) roomCode = crypto.randomBytes(3).toString("hex").toUpperCase();
      if (rooms[roomCode]) return socket.emit("errorMessage", { message: "Room already exists" });
      rooms[roomCode] = { players: [], status: "waiting", createdAt: Date.now(), autoStartTimer: null };
      const player = { id: socket.id, name: socket.data.username, socketId: socket.id, isBot: false };
      rooms[roomCode].players.push(player);
      socket.join(roomCode);
      io.to(roomCode).emit("roomCreated", { roomCode });
      io.to(roomCode).emit("roomUpdate", { room: roomCode, players: rooms[roomCode].players });
    } catch (e) {
      socket.emit("errorMessage", { message: "Create room failed" });
    }
  });

  // ----------------- joinRoom -----------------
  socket.on("joinRoom", ({ roomCode, username }) => {
    try {
      socket.data.username = username || socket.data.username || ("Guest" + Math.floor(Math.random() * 10000));
      if (!rooms[roomCode]) return socket.emit("errorMessage", { message: "Room not found" });
      if (!rooms[roomCode].players.find((p) => p.id === socket.id)) {
        const player = { id: socket.id, name: socket.data.username, socketId: socket.id, isBot: false };
        rooms[roomCode].players.push(player);
      }
      socket.join(roomCode);
      io.to(roomCode).emit("joinedRoom", { roomCode });
      io.to(roomCode).emit("roomUpdate", { room: roomCode, players: rooms[roomCode].players });
    } catch (e) {
      socket.emit("errorMessage", { message: "Join failed" });
    }
  });

  // ----------------- startGame -----------------
  socket.on("startGame", (roomCode) => {
    try {
      if (!rooms[roomCode]) return socket.emit("errorMessage", { message: "Room not found" });
      while (rooms[roomCode].players.length < 4) rooms[roomCode].players.push(makeBot());
      startMatch(roomCode, { bid: 16, trumpSuit: "H" });
    } catch (e) {
      socket.emit("errorMessage", { message: "Start game failed" });
    }
  });

  socket.on("startBid", ({ roomCode, biddingTeam, bidAmount }) => {
    if (!rooms[roomCode] || !rooms[roomCode].match) return socket.emit("errorMessage", { message: "No active match for bidding" });
    io.to(roomCode).emit("bidStarted", { biddingTeam, bidAmount });
  });

  socket.on("resolveRound", async ({ roomCode, winningTeam }) => {
    try {
      const r = rooms[roomCode];
      if (!r || !r.match) return socket.emit("errorMessage", { message: "No active match" });
      // simple reward distribution
      let perWinner = 10;
      for (const username of winningTeam) {
        try {
          // update based on username & coins fields (match your model)
          if (walletModel && walletModel.findOneAndUpdate) {
            await walletModel.findOneAndUpdate({ username }, { $inc: { coins: perWinner } }, { upsert: true, new: true });
            const w = await walletModel.findOne({ username });
            io.to(roomCode).emit("walletUpdate", { username, coins: w ? w.coins : perWinner });
          } else {
            io.to(roomCode).emit("walletUpdate", { username, coins: perWinner });
          }
        } catch (e) {
          console.log("wallet update failed", e.message);
        }
      }
      io.to(roomCode).emit("roundResolved", { winningTeam, perWinner, adminCut: 0 });
      r.status = "waiting";
      delete r.match;
    } catch (e) {
      socket.emit("errorMessage", { message: "resolveRound failed" });
    }
  });

  // ----------------- playCard -----------------
  socket.on("playCard", ({ roomCode, card }, cb) => {
    try {
      const r = rooms[roomCode];
      if (!r || !r.match) return cb && cb({ ok: false, msg: "No active match" });
      const m = r.match;
      const playerId = socket.id;

      // defensive: ensure hand exists
      const playerHand = Array.isArray(m.hands[playerId]) ? m.hands[playerId] : null;
      if (!playerHand) return cb && cb({ ok: false, msg: "No hand for player" });

      // find card in player's hand and remove it
      const idx = playerHand.findIndex((c) => c.id === (card.id || card)); // card may be object or id string
      let playedCard;
      if (idx !== -1) {
        playedCard = playerHand.splice(idx, 1)[0];
      } else {
        // if frontend sent full object, try match by id property
        if (card && card.id) {
          playedCard = card;
          // also try to remove by id if present in hand
          const ridx = playerHand.findIndex((c) => c.id === card.id);
          if (ridx !== -1) playerHand.splice(ridx, 1);
        } else {
          return cb && cb({ ok: false, msg: "Card not found in hand" });
        }
      }

      m.currentTrick.push({ playerId, card: playedCard });
      io.to(roomCode).emit("cardPlayed", { username: socket.data && socket.data.username ? socket.data.username : playerId, card: playedCard });

      // advance turn
      m.turnIndex = (m.turnIndex + 1) % m.playerOrder.length;

      // resolve trick if complete
      if (m.currentTrick.length === m.playerOrder.length) {
        const winner = resolveTrick(m.currentTrick, m.trumpSuit);
        m.trickHistory.push({ trick: m.currentTrick.slice(), winner: winner.playerId });
        const winnerTeam = m.teams.declarer.includes(winner.playerId) ? "declarerTeamCards" : "opponentTeamCards";
        for (const t of m.currentTrick) m.scores[winnerTeam].push(t.card);
        m.currentTrick = [];
        m.turnIndex = m.playerOrder.indexOf(winner.playerId);
        io.to(roomCode).emit("trickWon", { winner: winner.playerId, trick: m.trickHistory[m.trickHistory.length - 1] });
      }

      // check all empty
      const allEmpty = Object.values(m.hands).every((h) => Array.isArray(h) ? h.length === 0 : true);
      if (allEmpty) {
        const lastWinner = m.trickHistory.length ? m.trickHistory[m.trickHistory.length - 1].winner : null;
        const declarerPoints = calcPoints(m.scores.declarerTeamCards, lastWinner && m.teams.declarer.includes(lastWinner));
        const opponentPoints = calcPoints(m.scores.opponentTeamCards, lastWinner && m.teams.opponent.includes(lastWinner));
        io.to(roomCode).emit("matchEnd", { declarerPoints, opponentPoints });
        r.status = "waiting";
        delete r.match;
      } else {
        setTimeout(() => runBotTurns(roomCode), 300);
      }

      return cb && cb({ ok: true });
    } catch (e) {
      console.error(e);
      return cb && cb({ ok: false, msg: "playCard failed" });
    }
  });

  // ----------------- showPyar -----------------
  socket.on("showPyar", ({ roomCode }, cb) => {
    try {
      const r = rooms[roomCode];
      if (!r || !r.match) return cb && cb({ ok: false, msg: "No match" });
      const m = r.match;
      const pyarColor = hasPyar(m.hands[socket.id] || []);
      if (!pyarColor) return cb && cb({ ok: false, msg: "No pyar" });
      const before = m.bid;
      const res = applyPyarRule(m);
      m.bid = res.newBid;
      io.to(roomCode).emit("pyarActivated", { by: socket.data.username || socket.id, pyarColor, oldBid: before, newBid: m.bid, teamAPyar: res.teamAPyar, teamBPyar: res.teamBPyar });
      return cb && cb({ ok: true, newBid: m.bid });
    } catch (e) {
      return cb && cb({ ok: false, msg: "showPyar failed" });
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 socket disconnected:", socket.id);
    for (const code of Object.keys(rooms)) {
      const r = rooms[code];
      const idx = r.players.findIndex((p) => p.id === socket.id);
      if (idx !== -1) {
        r.players.splice(idx, 1);
        io.to(code).emit("roomUpdate", { room: code, players: r.players });
      }
    }
  });
});

// START MATCH
function startMatch(roomCode, { bid = 16, trumpSuit = "H" } = {}) {
  const r = rooms[roomCode];
  if (!r) return;
  if (r.autoStartTimer) { clearTimeout(r.autoStartTimer); r.autoStartTimer = null; }
  r.status = "playing";
  while (r.players.length < 4) r.players.push(makeBot());

  const deck = makeDeck();
  shuffle(deck);

  const hands = {};
  for (const p of r.players) hands[p.id] = [];

  let idx = 0;
  while (deck.length && Object.values(hands).some((h) => h.length < 8)) {
    const pid = r.players[idx % r.players.length].id;
    if (hands[pid].length < 8) hands[pid].push(deck.shift());
    idx++;
  }

  const playerOrder = r.players.map((p) => p.id);
  const teams = { declarer: [playerOrder[0], playerOrder[2]], opponent: [playerOrder[1], playerOrder[3]] };

  const match = {
    id: crypto.randomBytes(6).toString("hex"),
    bid,
    trumpSuit,
    hands,
    playerOrder,
    turnIndex: 0,
    currentTrick: [],
    trickHistory: [],
    teams,
    scores: { declarerTeamCards: [], opponentTeamCards: [] },
  };

  // apply pyar
  const pyarRes = applyPyarRule(match);
  match.bid = pyarRes.newBid;
  r.match = match;

  // prepare hands payload keyed by socket id and username
  const handsPayload = {};
  for (const p of r.players) {
    handsPayload[p.id] = hands[p.id] || [];
    handsPayload[p.name] = hands[p.id] || [];
    if (!p.isBot && p.socketId) {
      const s = getSocket(p.socketId);
      if (s) s.emit("dealPrivate", { yourCards: hands[p.id], matchId: match.id, bid: match.bid, trumpSuit: match.trumpSuit });
    }
  }

  io.to(roomCode).emit("matchStart", { matchId: match.id, players: r.players.map((x) => ({ id: x.id, name: x.name, isBot: !!x.isBot })), bid: match.bid, trumpSuit: match.trumpSuit });
  io.to(roomCode).emit("gameStarted", { hands: handsPayload, matchId: match.id, bid: match.bid, trumpSuit: match.trumpSuit });

  setTimeout(() => runBotTurns(roomCode), 400);
}

function runBotTurns(roomCode) {
  const r = rooms[roomCode];
  if (!r || !r.match) return;
  const m = r.match;
  const currentId = m.playerOrder[m.turnIndex];
  const pObj = r.players.find((p) => p.id === currentId);
  if (pObj && pObj.isBot) {
    setTimeout(() => {
      botPlay(roomCode, currentId);
      runBotTurns(roomCode);
    }, 300 + Math.floor(Math.random() * 400));
  } else {
    io.to(roomCode).emit("turnRequest", { playerId: currentId });
  }
}

function botPlay(roomCode, botId) {
  const r = rooms[roomCode];
  if (!r || !r.match) return;
  const m = r.match;
  const hand = m.hands[botId];
  if (!hand || hand.length === 0) return;
  const leadSuit = m.currentTrick.length ? m.currentTrick[0].card.suit : null;
  let valid = hand;
  if (leadSuit) {
    const follow = hand.filter((c) => c.suit === leadSuit);
    if (follow.length) valid = follow;
  }
  const choice = valid[Math.floor(Math.random() * valid.length)];
  const idx = hand.findIndex((c) => c.id === choice.id);
  if (idx !== -1) hand.splice(idx, 1);
  m.currentTrick.push({ playerId: botId, card: choice });
  io.to(roomCode).emit("cardPlayed", { username: r.players.find(x => x.id === botId).name, card: choice });

  m.turnIndex = (m.turnIndex + 1) % m.playerOrder.length;

  if (m.currentTrick.length === m.playerOrder.length) {
    const winner = resolveTrick(m.currentTrick, m.trumpSuit);
    m.trickHistory.push({ trick: m.currentTrick.slice(), winner: winner.playerId });
    const winnerTeam = m.teams.declarer.includes(winner.playerId) ? "declarerTeamCards" : "opponentTeamCards";
    for (const t of m.currentTrick) m.scores[winnerTeam].push(t.card);
    m.currentTrick = [];
    m.turnIndex = m.playerOrder.indexOf(winner.playerId);
    io.to(roomCode).emit("trickWon", { winner: winner.playerId, trick: m.trickHistory[m.trickHistory.length - 1] });
  }

  const allEmpty = Object.values(m.hands).every((h) => Array.isArray(h) ? h.length === 0 : true);
  if (allEmpty) {
    const lastWinner = m.trickHistory.length ? m.trickHistory[m.trickHistory.length - 1].winner : null;
    const declarerPoints = calcPoints(m.scores.declarerTeamCards, lastWinner && m.teams.declarer.includes(lastWinner));
    const opponentPoints = calcPoints(m.scores.opponentTeamCards, lastWinner && m.teams.opponent.includes(lastWinner));
    io.to(roomCode).emit("matchEnd", { declarerPoints, opponentPoints });
    r.status = "waiting";
    delete r.match;
  }
}

// fallback index
app.get("*", (req, res) => {
  if (fs.existsSync(frontendIndex)) return res.sendFile(frontendIndex);
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log("🚀 Server running on port", PORT));
