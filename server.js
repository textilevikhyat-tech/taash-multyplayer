// server.js
require("dotenv").config();

const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const fs = require("fs");

// Controllers
const authController = require("./backend/controllers/authController");

// Express setup
const app = express();
app.use(cors());
app.use(express.json());

// MongoDB connect (set MONGO_URI in .env)
mongoose
  .connect(process.env.MONGO_URI || "", { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log("❌ MongoDB Error:", err && err.message));

// Routes
app.post("/api/auth/register", authController.register);
app.post("/api/auth/login", authController.login);

// optional wallet routes
try {
  const walletRoutes = require("./routes/walletRoutes");
  app.use("/api/wallet", walletRoutes);
} catch (err) {
  console.log("⚠ walletRoutes skipped:", err.message);
}

// Serve frontend build or public
const DIST = path.join(__dirname, "frontend", "dist");
if (fs.existsSync(DIST)) app.use(express.static(DIST));
if (fs.existsSync(path.join(__dirname, "public"))) app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  if (fs.existsSync(path.join(DIST, "index.html"))) return res.sendFile(path.join(DIST, "index.html"));
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ----------------- Socket + Simple Game (quickJoin + bots + deal) -----------------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = {}; // in-memory rooms

function makeBot() {
  return { id: "bot-" + crypto.randomBytes(3).toString("hex"), name: "Bot", isBot: true };
}
function findOpenRoom() {
  for (const code in rooms) {
    if (rooms[code].status === "waiting" && rooms[code].players.length < 4) return code;
  }
  return null;
}
function makeDeck() {
  const SUITS = ["H","D","S","C"];
  const RANKS = ["J","9","A","10","K","Q","8","7"];
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ id: r + s, suit: s, rank: r });
  return d;
}
function shuffle(a) {
  for (let i = a.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

io.on("connection", socket => {
  console.log("🟢 Connected:", socket.id);

  // QUICK JOIN: try to put player into an open room; if none create room; auto-fill bots & deal
  socket.on("quickJoin", (payload = {}) => {
    const username = payload.username || ("Guest" + Math.floor(Math.random()*10000));
    socket.data.username = username;

    let code = findOpenRoom();
    if (!code) {
      code = crypto.randomBytes(3).toString("hex").toUpperCase();
      rooms[code] = { players: [], status: "waiting", autoStartTimer: null };
    }

    // Prevent duplicate
    if (!rooms[code].players.find(p => p.id === socket.id)) {
      rooms[code].players.push({ id: socket.id, name: username, socketId: socket.id, isBot: false });
    }
    socket.join(code);

    // Emit update to room
    io.to(code).emit("roomUpdate", rooms[code].players);
    socket.emit("joinedRoom", { room: code, players: rooms[code].players });

    // auto-fill bots & start after short timeout (so multiple humans can join)
    if (rooms[code].autoStartTimer) clearTimeout(rooms[code].autoStartTimer);
    rooms[code].autoStartTimer = setTimeout(() => {
      while (rooms[code].players.length < 4) rooms[code].players.push(makeBot());
      // start match (deal)
      rooms[code].status = "playing";
      const deck = makeDeck();
      shuffle(deck);
      const hands = {};
      rooms[code].players.forEach(p => hands[p.id] = []);
      let i = 0;
      while (i < 32) {
        const pid = rooms[code].players[i % 4].id;
        hands[pid].push(deck[i]);
        i++;
      }
      // send private deal to non-bots
      rooms[code].players.forEach(p => {
        if (!p.isBot) {
          const s = io.sockets.sockets.get(p.id);
          if (s) s.emit("dealPrivate", { cards: hands[p.id] });
        }
      });
      io.to(code).emit("matchStart", { players: rooms[code].players });
    }, 3000); // 3s
  });

  // createRoom (explicit)
  socket.on("createRoom", ({ roomCode, username } = {}) => {
    const name = username || ("Guest" + Math.floor(Math.random()*10000));
    const code = roomCode || crypto.randomBytes(3).toString("hex").toUpperCase();
    if (rooms[code]) return socket.emit("errorMessage", { message: "Room exists" });
    rooms[code] = { players: [], status: "waiting", autoStartTimer: null };
    rooms[code].players.push({ id: socket.id, name, socketId: socket.id, isBot: false });
    socket.join(code);
    socket.emit("roomCreated", { room: code });
    io.to(code).emit("roomUpdate", rooms[code].players);
  });

  // joinRoom (explicit)
  socket.on("joinRoom", ({ roomCode, username } = {}) => {
    const name = username || ("Guest" + Math.floor(Math.random()*10000));
    if (!rooms[roomCode]) return socket.emit("errorMessage", { message: "Room not found" });
    rooms[roomCode].players.push({ id: socket.id, name, socketId: socket.id, isBot: false });
    socket.join(roomCode);
    socket.emit("joinedRoom", { room: roomCode, players: rooms[roomCode].players });
    io.to(roomCode).emit("roomUpdate", rooms[roomCode].players);
  });

  socket.on("disconnect", () => {
    console.log("🔴 Disconnected:", socket.id);
    for (const code of Object.keys(rooms)) {
      rooms[code].players = rooms[code].players.filter(p => p.id !== socket.id);
      io.to(code).emit("roomUpdate", rooms[code].players);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log("🚀 Server running on port", PORT));
