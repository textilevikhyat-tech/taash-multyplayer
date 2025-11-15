// server.js (paste this in project root; matches your repo tree)
require("dotenv").config();

const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

// IMPORT models & routes (adjust if your filenames differ)
const User = require("./models/User");
const Wallet = require("./models/Transaction");
const authController = require("./backend/controllers/authController");
const walletRoutes = require("./routes/walletRoutes");

// Express app
const app = express();
app.use(cors());
app.use(express.json());

// Mongo connect
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log("❌ Mongo Error:", err && err.message));

// Auth & Wallet routes (existing controllers)
app.post("/api/auth/register", authController.register);
app.post("/api/auth/login", authController.login);
app.use("/api/wallet", walletRoutes);

// Serve static frontend (vite build output or public for tests)
app.use(express.static(path.join(__dirname, "frontend", "dist")));
app.use(express.static(path.join(__dirname, "public")));

// Game constants & helpers
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
  const qs = hand.filter((c) => c.rank === "Q");
  const ks = hand.filter((c) => c.rank === "K");
  for (const q of qs) for (const k of ks) if (getColor(q.suit) === getColor(k.suit)) return getColor(q.suit);
  return null;
}
function resolveTrick(trick, trumpSuit) {
  // trick: [{playerId, card}, ...], lead = trick[0].card.suit
  const leadSuit = trick[0].card.suit;
  const trumpPlayed = trick.filter((t) => t.card.suit === trumpSuit);
  const candidates = (trumpPlayed.length ? trumpPlayed : trick.filter((t) => t.card.suit === leadSuit));
  candidates.sort((a, b) => CARD_ORDER[b.card.rank] - CARD_ORDER[a.card.rank]);
  return candidates[0]; // winner entry
}
function calcPoints(cards, lastTrickBonus = false) {
  let pts = 0;
  for (const c of cards) pts += CARD_VALUES[c.rank] || 0;
  if (lastTrickBonus) pts += 1;
  return pts;
}

// Pyar rule apply (declarer team A and opponent B)
function applyPyarRule(match) {
  // match: { bid, trumpSuit, teams: {declarer: [ids], opponent: [ids]}, hands: {playerId: [cards]} }
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

  // Declarer Pyar: only if exactly one player in declarer team has pyar
  if (teamAPyar.length === 1) {
    if (declarerBid === 19) newBid = 16;
    else newBid = declarerBid - 4;
  }

  // Opponent pyar: if any opponent has pyar matching trump color -> +4
  if (teamBPyar.length >= 1) {
    const matchPyar = teamBPyar.find((p) => p.color === trumpColor);
    if (matchPyar) newBid = newBid + 4;
  }

  return { newBid, teamAPyar, teamBPyar };
}

// Simple bot creator (server-side bots)
function makeBot() {
  return { id: "bot-" + crypto.randomBytes(3).toString("hex"), name: "Bot", isBot: true, socketId: null };
}

// In-memory rooms map. Structure:
// rooms[roomCode] = {
//   players: [{ id, name, socketId, isBot, cards: [] }],
//   status: 'waiting'|'playing',
//   match: { bid, trumpSuit, hands, playerOrder, turnIndex, currentTrick, trickHistory, teams, scores }
// }
const rooms = {};

// Server + Socket.IO
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Utility: find open room with status waiting and slots < 4
function findOpenRoom() {
  for (const code of Object.keys(rooms)) {
    const r = rooms[code];
    if (r.status === "waiting" && r.players.length < 4) return code;
  }
  return null;
}

// Auto-start timeout (if you want automatic start after some seconds even with <4)
const AUTO_START_SECONDS = 6; // small for testing

io.on("connection", (socket) => {
  console.log("🟢 Connected:", socket.id);

  // Quick join: user wants random match
  socket.on("quickJoin", ({ username, preferredBid, preferredTrump }) => {
    let code = findOpenRoom();
    if (!code) {
      // create room
      code = crypto.randomBytes(3).toString("hex");
      rooms[code] = { players: [], status: "waiting", createdAt: Date.now(), autoStartTimer: null };
    }
    // join room
    const player = { id: socket.id, name: username || "Guest", socketId: socket.id, isBot: false };
    rooms[code].players.push(player);
    socket.join(code);
    io.to(code).emit("roomUpdate", { code, players: rooms[code].players });

    // If room has 4 players, start immediately.
    if (rooms[code].players.length >= 4) {
      startMatch(code, { bid: preferredBid || 16, trumpSuit: preferredTrump || "H" });
      return;
    }

    // If not 4 yet, set/refresh auto-start timer to fill bots after timeout
    if (rooms[code].autoStartTimer) clearTimeout(rooms[code].autoStartTimer);
    rooms[code].autoStartTimer = setTimeout(() => {
      // fill remaining with bots
      while (rooms[code].players.length < 4) {
        const b = makeBot();
        // bot has no socketId
        rooms[code].players.push(b);
      }
      startMatch(code, { bid: preferredBid || 16, trumpSuit: preferredTrump || "H" });
    }, AUTO_START_SECONDS * 1000);
  });

  // Allow client to explicitly request starting (for lobby host concept)
  socket.on("startNow", ({ roomCode, bid, trumpSuit }) => {
    if (!rooms[roomCode]) return socket.emit("error", "Room not found");
    // fill bots if needed
    while (rooms[roomCode].players.length < 4) rooms[roomCode].players.push(makeBot());
    startMatch(roomCode, { bid: bid || 16, trumpSuit: trumpSuit || "H" });
  });

  // play card event from client
  socket.on("playCard", ({ roomCode, playerId, cardId }, cb) => {
    const r = rooms[roomCode];
    if (!r || !r.match) return cb && cb({ ok: false, msg: "No active match" });
    const m = r.match;
    const expectedPlayerId = m.playerOrder[m.turnIndex];
    if (playerId !== expectedPlayerId) return cb && cb({ ok: false, msg: "Not your turn" });

    const hand = m.hands[playerId] || [];
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx === -1) return cb && cb({ ok: false, msg: "Card not in hand" });

    const card = hand.splice(idx, 1)[0];
    m.currentTrick.push({ playerId, card });
    io.to(roomCode).emit("cardPlayed", { playerId, card });

    // advance turn
    m.turnIndex = (m.turnIndex + 1) % m.playerOrder.length;

    // if trick complete
    if (m.currentTrick.length === m.playerOrder.length) {
      const winnerEntry = resolveTrick(m.currentTrick, m.trumpSuit);
      m.trickHistory.push({ trick: m.currentTrick.slice(), winner: winnerEntry.playerId });
      // assign cards to team piles
      const winnerTeam = m.teams.declarer.includes(winnerEntry.playerId) ? "declarerTeamCards" : "opponentTeamCards";
      for (const t of m.currentTrick) m.scores[winnerTeam].push(t.card);

      // set next turn to winner
      m.turnIndex = m.playerOrder.indexOf(winnerEntry.playerId);
      io.to(roomCode).emit("trickWon", { winner: winnerEntry.playerId, trick: m.trickHistory[m.trickHistory.length - 1] });
      m.currentTrick = [];
    }

    // if all hands empty -> finish
    const allEmpty = Object.values(m.hands).every((h) => h.length === 0);
    if (allEmpty) {
      const lastWinner = m.trickHistory.length ? m.trickHistory[m.trickHistory.length - 1].winner : null;
      const declarerPoints = calcPoints(m.scores.declarerTeamCards, lastWinner && m.teams.declarer.includes(lastWinner));
      const opponentPoints = calcPoints(m.scores.opponentTeamCards, lastWinner && m.teams.opponent.includes(lastWinner));
      io.to(roomCode).emit("matchEnd", { declarerPoints, opponentPoints });
      // cleanup room match but keep room for rejoin
      r.status = "waiting";
      delete r.match;
      return cb && cb({ ok: true });
    }

    // if next is bot, trigger bot actions after small delay
    setTimeout(() => runBotTurns(roomCode), 350);
    cb && cb({ ok: true });
  });

  // show pyar (player asks to show)
  socket.on("showPyar", ({ roomCode, playerId }, cb) => {
    const r = rooms[roomCode];
    if (!r || !r.match) return cb && cb({ ok: false, msg: "No active match" });
    const m = r.match;
    const hand = m.hands[playerId] || [];
    const pyarColor = hasPyar(hand);
    if (!pyarColor) return cb && cb({ ok: false, msg: "No pyar" });
    const before = m.bid;
    const result = applyPyarRule(m);
    m.bid = result.newBid;
    io.to(roomCode).emit("pyarActivated", { by: playerId, pyarColor, oldBid: before, newBid: m.bid, teamAPyar: result.teamAPyar, teamBPyar: result.teamBPyar });
    cb && cb({ ok: true, newBid: m.bid });
  });

  socket.on("disconnect", () => {
    console.log("🔴 Disconnected:", socket.id);
    // remove player from any rooms
    for (const code of Object.keys(rooms)) {
      const r = rooms[code];
      const idx = r.players.findIndex((p) => p.id === socket.id);
      if (idx !== -1) {
        r.players.splice(idx, 1);
        io.to(code).emit("roomUpdate", { code, players: r.players });
        // if match ongoing, mark player disconnected but don't immediately end match
      }
    }
  });
});

// Start a match: deal cards, assign teams, set match object on room
function startMatch(roomCode, { bid = 16, trumpSuit = "H" } = {}) {
  const r = rooms[roomCode];
  if (!r) return;
  // clear autoStartTimer if set
  if (r.autoStartTimer) { clearTimeout(r.autoStartTimer); r.autoStartTimer = null; }

  r.status = "playing";
  // ensure 4 players (if some are missing fill with bots)
  while (r.players.length < 4) r.players.push(makeBot());

  // create deck and deal 8 cards each
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

  // prepare match object
  const playerOrder = r.players.map((p) => p.id);
  const teams = { declarer: [playerOrder[0], playerOrder[2]], opponent: [playerOrder[1], playerOrder[3]] };
  const match = {
    id: crypto.randomBytes(6).toString("hex"),
    bid,
    trumpSuit,
    hands,
    playerOrder,
    turnIndex: 0, // start with playerOrder[0]
    currentTrick: [],
    trickHistory: [],
    teams,
    scores: { declarerTeamCards: [], opponentTeamCards: [] },
  };

  // apply pyar rule BEFORE starting (if declarer team has exact one pyar)
  const pyarRes = applyPyarRule(match);
  match.bid = pyarRes.newBid;

  r.match = match;

  // send private hands to real sockets
  for (const p of r.players) {
    if (!p.isBot && p.socketId) {
      const sock = getSocketById(p.socketId);
      if (sock) sock.emit("dealPrivate", { yourCards: match.hands[p.id], matchId: match.id, bid: match.bid, trumpSuit: match.trumpSuit });
    }
  }

  // broadcast match start (public info)
  io.to(roomCode).emit("matchStart", { matchId: match.id, players: r.players.map((x) => ({ id: x.id, name: x.name, isBot: !!x.isBot })), bid: match.bid, trumpSuit: match.trumpSuit });

  // trigger bots if first players are bots
  setTimeout(() => runBotTurns(roomCode), 400);
}

// utility: get socket by id (if connected)
function getSocketById(id) {
  try {
    return io.sockets.sockets.get(id) || null;
  } catch (e) {
    return null;
  }
}

// run bot turns until a human turn is reached
function runBotTurns(roomCode) {
  const r = rooms[roomCode];
  if (!r || !r.match) return;
  const m = r.match;
  const currentId = m.playerOrder[m.turnIndex];
  const playerObj = r.players.find((p) => p.id === currentId);

  if (playerObj && playerObj.isBot) {
    // bot plays after short delay
    setTimeout(() => {
      botPlay(roomCode, currentId);
      // after bot played, check if match finished
      if (!r.match) return;
      // recursively continue
      runBotTurns(roomCode);
    }, 400 + Math.floor(Math.random() * 600));
  } else {
    // human turn - emit turn request
    io.to(roomCode).emit("turnRequest", { playerId: currentId });
  }
}

// bot play logic: follow suit if possible else random
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
  // choose random from valid
  const choice = valid[Math.floor(Math.random() * valid.length)];
  // remove card
  const idx = hand.findIndex((c) => c.id === choice.id);
  if (idx !== -1) hand.splice(idx, 1);
  m.currentTrick.push({ playerId: botId, card: choice });
  io.to(roomCode).emit("cardPlayed", { playerId: botId, card: choice });

  // advance turn
  m.turnIndex = (m.turnIndex + 1) % m.playerOrder.length;

  // if trick complete
  if (m.currentTrick.length === m.playerOrder.length) {
    const winnerEntry = resolveTrick(m.currentTrick, m.trumpSuit);
    m.trickHistory.push({ trick: m.currentTrick.slice(), winner: winnerEntry.playerId });
    const winnerTeam = m.teams.declarer.includes(winnerEntry.playerId) ? "declarerTeamCards" : "opponentTeamCards";
    for (const t of m.currentTrick) m.scores[winnerTeam].push(t.card);
    m.turnIndex = m.playerOrder.indexOf(winnerEntry.playerId);
    io.to(roomCode).emit("trickWon", { winner: winnerEntry.playerId, trick: m.trickHistory[m.trickHistory.length - 1] });
    m.currentTrick = [];
  }

  // check match finish
  const allEmpty = Object.values(m.hands).every((h) => h.length === 0);
  if (allEmpty) {
    const lastWinner = m.trickHistory.length ? m.trickHistory[m.trickHistory.length - 1].winner : null;
    const declarerPoints = calcPoints(m.scores.declarerTeamCards, lastWinner && m.teams.declarer.includes(lastWinner));
    const opponentPoints = calcPoints(m.scores.opponentTeamCards, lastWinner && m.teams.opponent.includes(lastWinner));
    io.to(roomCode).emit("matchEnd", { declarerPoints, opponentPoints });
    r.status = "waiting";
    delete r.match;
  }
}

// For any route, send index (SPA)
app.get("*", (req, res) => {
  const indexPath = path.join(__dirname, "frontend", "dist", "index.html");
  if (require("fs").existsSync(indexPath)) return res.sendFile(indexPath);
  // fallback to public index
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

// start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log("🚀 Server running on port", PORT));
