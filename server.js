// server.js (paste into project root — replaces old server.js)
require("dotenv").config();

const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const fs = require("fs");

// Your project models / controllers (adjust names only if your files differ)
const authController = require("./backend/controllers/authController");
const walletModel = require("./models/Transaction"); // expect a Transaction or Wallet model
// NOTE: User model not strictly needed in this server file; authController handles register/login

const app = express();
app.use(cors());
app.use(express.json());

// Connect Mongo (ensure MONGO_URI is set in Render / env)
mongoose
  .connect(process.env.MONGO_URI || "", { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log("❌ Mongo Error:", err && err.message));

// Routes (reuse your existing controllers)
app.post("/api/auth/register", authController.register);
app.post("/api/auth/login", authController.login);
// if you have wallet routes separately, keep them (they are in /routes/walletRoutes.js)
try {
  const walletRoutes = require("./routes/walletRoutes");
  app.use("/api/wallet", walletRoutes);
} catch (e) {
  console.log("No walletRoutes found or failed to load; continuing without mounting /api/wallet");
}

// Serve frontend: prefer Vite build in frontend/dist, fallback to public/index.html
const frontendIndex = path.join(__dirname, "frontend", "dist", "index.html");
if (fs.existsSync(path.join(__dirname, "frontend", "dist"))) {
  app.use(express.static(path.join(__dirname, "frontend", "dist")));
}
if (fs.existsSync(path.join(__dirname, "public"))) {
  app.use(express.static(path.join(__dirname, "public")));
}

// --- GAME LOGIC UTILITIES ---
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

// Pyar rule (declarer team = teamA, opponents = teamB)
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

// Simple server-side bot factory
function makeBot(nameSuffix) {
  return { id: "bot-" + crypto.randomBytes(3).toString("hex"), name: "Bot" + (nameSuffix || ""), isBot: true, socketId: null };
}

// Rooms in-memory
// roomCode -> { players: [{id, name, socketId, isBot}], status, autoStartTimer, createdAt, match }
// match object set when playing
const rooms = {};

// Server + Socket.IO
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// helper: find open waiting room with <4 players
function findOpenRoom() {
  for (const code of Object.keys(rooms)) {
    const r = rooms[code];
    if (r.status === "waiting" && r.players.length < 4) return code;
  }
  return null;
}

// helper: get socket by id
function getSocket(id) {
  return io.sockets.sockets.get(id) || null;
}

// Auto-start seconds (after first join) - adjust as needed
const AUTO_START_SECONDS = 6;

io.on("connection", (socket) => {
  console.log("🟢 socket connected:", socket.id);

  // quickJoin (random matchmaking)
  socket.on("quickJoin", ({ username, preferredBid, preferredTrump }) => {
    try {
      let code = findOpenRoom();
      if (!code) {
        code = crypto.randomBytes(3).toString("hex");
        rooms[code] = { players: [], status: "waiting", createdAt: Date.now(), autoStartTimer: null };
      }
      const player = { id: socket.id, name: username || "Guest", socketId: socket.id, isBot: false };
      rooms[code].players.push(player);
      socket.join(code);
      io.to(code).emit("roomUpdate", { room: code, players: rooms[code].players });

      // if 4 players -> start immediately
      if (rooms[code].players.length >= 4) {
        startMatch(code, { bid: preferredBid || 16, trumpSuit: preferredTrump || "H" });
        return;
      }

      // set auto-start timer to fill bots and start
      if (rooms[code].autoStartTimer) clearTimeout(rooms[code].autoStartTimer);
      rooms[code].autoStartTimer = setTimeout(() => {
        while (rooms[code].players.length < 4) rooms[code].players.push(makeBot());
        startMatch(code, { bid: preferredBid || 16, trumpSuit: preferredTrump || "H" });
      }, AUTO_START_SECONDS * 1000);

      // ack
      socket.emit("joinedRoom", { roomCode: code });
    } catch (e) {
      console.error(e);
      socket.emit("errorMessage", { message: "Quick join failed" });
    }
  });

  // createRoom (explicit)
  socket.on("createRoom", ({ roomCode, username }) => {
    try {
      if (!roomCode) roomCode = (crypto.randomBytes(3).toString("hex")).toUpperCase();
      if (rooms[roomCode]) return socket.emit("errorMessage", { message: "Room already exists" });
      rooms[roomCode] = { players: [], status: "waiting", createdAt: Date.now(), autoStartTimer: null };
      const player = { id: socket.id, name: username || "Guest", socketId: socket.id, isBot: false };
      rooms[roomCode].players.push(player);
      socket.join(roomCode);
      io.to(roomCode).emit("roomCreated", { roomCode });
      io.to(roomCode).emit("roomUpdate", { room: roomCode, players: rooms[roomCode].players });
    } catch (e) {
      socket.emit("errorMessage", { message: "Create room failed" });
    }
  });

  // joinRoom (explicit)
  socket.on("joinRoom", ({ roomCode, username }) => {
    try {
      if (!rooms[roomCode]) return socket.emit("errorMessage", { message: "Room not found" });
      const player = { id: socket.id, name: username || "Guest", socketId: socket.id, isBot: false };
      rooms[roomCode].players.push(player);
      socket.join(roomCode);
      io.to(roomCode).emit("joinedRoom", { roomCode });
      io.to(roomCode).emit("roomUpdate", { room: roomCode, players: rooms[roomCode].players });
    } catch (e) {
      socket.emit("errorMessage", { message: "Join failed" });
    }
  });

  // startGame (explicit)
  socket.on("startGame", (roomCode) => {
    try {
      if (!rooms[roomCode]) return socket.emit("errorMessage", { message: "Room not found" });
      // fill bots if needed
      while (rooms[roomCode].players.length < 4) rooms[roomCode].players.push(makeBot());
      startMatch(roomCode, { bid: 16, trumpSuit: "H" });
    } catch (e) {
      socket.emit("errorMessage", { message: "Start game failed" });
    }
  });

  // startBid (from Table.jsx)
  socket.on("startBid", ({ roomCode, biddingTeam, bidAmount }) => {
    if (!rooms[roomCode] || !rooms[roomCode].match) return socket.emit("errorMessage", { message: "No active match for bidding" });
    io.to(roomCode).emit("bidStarted", { biddingTeam, bidAmount });
  });

  // resolveRound (from Table.jsx) — compute points & emit update (and optionally update DB wallet)
  socket.on("resolveRound", async ({ roomCode, winningTeam }) => {
    try {
      const r = rooms[roomCode];
      if (!r || !r.match) return socket.emit("errorMessage", { message: "No active match" });
      const m = r.match;
      // simple reward distribution: compute points per winner from cards
      const lastWinner = m.trickHistory.length ? m.trickHistory[m.trickHistory.length - 1].winner : null;
      const declarerPoints = calcPoints(m.scores.declarerTeamCards, lastWinner && m.teams.declarer.includes(lastWinner));
      const opponentPoints = calcPoints(m.scores.opponentTeamCards, lastWinner && m.teams.opponent.includes(lastWinner));

      // determine which side won (example: compare declared bid to declarerPoints)
      // For now, accept 'winningTeam' param as array of usernames who won, and give each +10 coins
      let perWinner = 10;
      for (const username of winningTeam) {
        try {
          // Try to update wallet collection loosely if exists
          if (walletModel && walletModel.findOneAndUpdate) {
            await walletModel.findOneAndUpdate({ user: username }, { $inc: { balance: perWinner } }, { upsert: true, new: true });
            // emit wallet update (attempt to fetch)
            const w = await walletModel.findOne({ user: username });
            io.to(roomCode).emit("walletUpdate", { username, coins: w ? w.balance : perWinner });
          } else {
            io.to(roomCode).emit("walletUpdate", { username, coins: perWinner });
          }
        } catch (e) {
          console.log("wallet update failed", e.message);
        }
      }

      io.to(roomCode).emit("roundResolved", { winningTeam, perWinner, adminCut: 0 });
      // End match cleanup
      r.status = "waiting";
      delete r.match;
    } catch (e) {
      socket.emit("errorMessage", { message: "resolveRound failed" });
    }
  });

  // playCard (from Table.jsx)
  socket.on("playCard", ({ roomCode, card }, cb) => {
    try {
      const r = rooms[roomCode];
      if (!r || !r.match) return cb && cb({ ok: false, msg: "No active match" });
      const m = r.match;
      const playerId = socket.id;
      // find the handing array for this player
      const hand = m.hands[playerId] || m.hands[socket.id] || m.hands[socket.handKey] || m.hands[playerId];
      // There are multiple ways front sends data; for simplicity assume Table.jsx sent card string and server trusts it
      // push to current trick
      m.currentTrick.push({ playerId: playerId, card: card });
      io.to(roomCode).emit("cardPlayed", { username: socket.data && socket.data.username ? socket.data.username : playerId, card: card });

      // advance turn
      m.turnIndex = (m.turnIndex + 1) % m.playerOrder.length;

      // if trick complete, resolve
      if (m.currentTrick.length === m.playerOrder.length) {
        const winner = resolveTrick(m.currentTrick, m.trumpSuit);
        m.trickHistory.push({ trick: m.currentTrick.slice(), winner: winner.playerId });
        const winnerTeam = m.teams.declarer.includes(winner.playerId) ? "declarerTeamCards" : "opponentTeamCards";
        for (const t of m.currentTrick) m.scores[winnerTeam].push(t.card);
        m.currentTrick = [];
        m.turnIndex = m.playerOrder.indexOf(winner.playerId);
        io.to(roomCode).emit("trickWon", { winner: winner.playerId, trick: m.trickHistory[m.trickHistory.length - 1] });
      }

      // if all cards played -> match end
      const allEmpty = Object.values(m.hands).every((h) => Array.isArray(h) ? h.length === 0 : true);
      if (allEmpty) {
        const lastWinner = m.trickHistory.length ? m.trickHistory[m.trickHistory.length - 1].winner : null;
        const declarerPoints = calcPoints(m.scores.declarerTeamCards, lastWinner && m.teams.declarer.includes(lastWinner));
        const opponentPoints = calcPoints(m.scores.opponentTeamCards, lastWinner && m.teams.opponent.includes(lastWinner));
        io.to(roomCode).emit("matchEnd", { declarerPoints, opponentPoints });
        r.status = "waiting";
        delete r.match;
      } else {
        // if next is bot, trigger server-run bots
        setTimeout(() => runBotTurns(roomCode), 300);
      }

      return cb && cb({ ok: true });
    } catch (e) {
      console.error(e);
      return cb && cb({ ok: false, msg: "playCard failed" });
    }
  });

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
    // remove from any room players list, do not auto-destroy room
    for (const code of Object.keys(rooms)) {
      const r = rooms[code];
      const idx = r.players.findIndex((p) => p.id === socket.id);
      if (idx !== -1) {
        r.players.splice(idx, 1);
        io.to(code).emit("roomUpdate", { room: code, players: r.players });
        // if a match was running, we currently leave match running with bot replacements possible
      }
    }
  });
});

// START MATCH implementation (deal, teams, pyar apply)
function startMatch(roomCode, { bid = 16, trumpSuit = "H" } = {}) {
  const r = rooms[roomCode];
  if (!r) return;
  if (r.autoStartTimer) { clearTimeout(r.autoStartTimer); r.autoStartTimer = null; }
  r.status = "playing";
  // ensure 4 players
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

  // Apply Pyar rule before start
  const pyarRes = applyPyarRule(match);
  match.bid = pyarRes.newBid;

  r.match = match;

  // emit deal to players — format: hands keyed by both socket id and username (Table.jsx checks socket.id or username)
  const handsPayload = {};
  for (const p of r.players) {
    handsPayload[p.id] = hands[p.id] || [];
    handsPayload[p.name] = hands[p.id] || [];
    // if real player, send private deal event to that socket
    if (!p.isBot && p.socketId) {
      const s = getSocket(p.socketId);
      if (s) s.emit("dealPrivate", { yourCards: hands[p.id], matchId: match.id, bid: match.bid, trumpSuit: match.trumpSuit });
    }
  }

  io.to(roomCode).emit("matchStart", { matchId: match.id, players: r.players.map((x) => ({ id: x.id, name: x.name, isBot: !!x.isBot })), bid: match.bid, trumpSuit: match.trumpSuit });
  io.to(roomCode).emit("gameStarted", { hands: handsPayload, matchId: match.id, bid: match.bid, trumpSuit: match.trumpSuit });

  // trigger bots if first players are bots
  setTimeout(() => runBotTurns(roomCode), 400);
}

// Run bot turns until human turn encountered
function runBotTurns(roomCode) {
  const r = rooms[roomCode];
  if (!r || !r.match) return;
  const m = r.match;
  const currentId = m.playerOrder[m.turnIndex];
  const pObj = r.players.find((p) => p.id === currentId);
  if (pObj && pObj.isBot) {
    // bot plays
    setTimeout(() => {
      botPlay(roomCode, currentId);
      // continue recursion
      runBotTurns(roomCode);
    }, 300 + Math.floor(Math.random() * 400));
  } else {
    io.to(roomCode).emit("turnRequest", { playerId: currentId });
  }
}

// Bot play: follow suit if possible else random
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
  // remove chosen card
  const idx = hand.findIndex((c) => c.id === choice.id);
  if (idx !== -1) hand.splice(idx, 1);
  m.currentTrick.push({ playerId: botId, card: choice });
  io.to(roomCode).emit("cardPlayed", { username: r.players.find(x=>x.id===botId).name, card: choice });

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

  // check end
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

// Serve index fallback
app.get("*", (req, res) => {
  if (fs.existsSync(frontendIndex)) return res.sendFile(frontendIndex);
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log("🚀 Server running on port", PORT));
