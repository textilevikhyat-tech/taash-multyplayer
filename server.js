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

// Models (ensure filenames/casing match)
const WalletModel = require("./models/Wallet");
const UserModel = require("./models/User");

// Express
const app = express();
app.use(cors());
app.use(express.json());

// Mongo connect
mongoose
  .connect(process.env.MONGO_URI || "", { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log("❌ MongoDB Error:", err && err.message));

// Auth routes
app.post("/api/auth/register", authController.register);
app.post("/api/auth/login", authController.login);

// Wallet routes
try {
  const walletRoutes = require("./routes/walletRoutes");
  app.use("/api/wallet", walletRoutes);
} catch (e) {
  console.log("⚠ walletRoutes not mounted:", e.message);
}

// Serve frontend build (if exists) or public
const FE_DIST = path.join(__dirname, "frontend", "dist");
if (fs.existsSync(FE_DIST)) app.use(express.static(FE_DIST));
if (fs.existsSync(path.join(__dirname, "public"))) app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  if (fs.existsSync(path.join(FE_DIST, "index.html"))) return res.sendFile(path.join(FE_DIST, "index.html"));
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ----------------- Socket.IO + Game -----------------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Game helpers
const SUITS = ["H","D","S","C"];
const RANKS = ["J","9","A","10","K","Q","8","7"];
function makeDeck(){
  const d = [];
  for(const s of SUITS) for(const r of RANKS) d.push({ id: r + s, suit: s, rank: r });
  return d;
}
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } }

const rooms = {}; // { roomCode: { players: [{id,name,socketId,isBot}], status, autoStartTimer, match } }

function makeBot(){
  return { id: "bot-" + crypto.randomBytes(3).toString("hex"), name: "Bot", isBot: true, socketId: null };
}
function findOpenRoom(){
  for(const code in rooms){
    const r = rooms[code];
    if(r.status === "waiting" && r.players.length < 4) return code;
  }
  return null;
}
function getSocket(id){ return io.sockets.sockets.get(id) || null; }

// Auto start delay (milliseconds)
const AUTO_START_MS = 3000;

io.on("connection", socket=>{
  console.log("🟢 Connected:", socket.id);

  // quick join (auto-match)
  socket.on("quickJoin", ({ username } = {})=>{
    socket.data.username = username || ("Guest" + Math.floor(Math.random()*10000));
    let code = findOpenRoom();
    if(!code){
      code = crypto.randomBytes(3).toString("hex").toUpperCase();
      rooms[code] = { players: [], status: "waiting", autoStartTimer: null };
    }

    // avoid duplicate
    if(!rooms[code].players.find(p => p.id === socket.id)){
      rooms[code].players.push({ id: socket.id, name: socket.data.username, socketId: socket.id, isBot: false });
    }
    socket.join(code);
    io.to(code).emit("roomUpdate", rooms[code].players);
    socket.emit("joinedRoom", { room: code, players: rooms[code].players });

    // reset timer
    if(rooms[code].autoStartTimer) clearTimeout(rooms[code].autoStartTimer);
    rooms[code].autoStartTimer = setTimeout(()=>{
      // fill bots
      while(rooms[code].players.length < 4) rooms[code].players.push(makeBot());
      // start match: deal 32 cards (8 each)
      rooms[code].status = "playing";
      const deck = makeDeck();
      shuffle(deck);
      const hands = {};
      rooms[code].players.forEach(p => hands[p.id] = []);
      let i=0;
      while(i < 32){
        const pid = rooms[code].players[i % 4].id;
        hands[pid].push(deck[i]);
        i++;
      }
      // deliver private deals
      rooms[code].players.forEach(p=>{
        if(!p.isBot && p.socketId){
          const s = getSocket(p.socketId);
          if(s) s.emit("dealPrivate", { cards: hands[p.id] });
        }
      });
      io.to(code).emit("matchStart", { players: rooms[code].players });
    }, AUTO_START_MS);
  });

  // explicit create room
  socket.on("createRoom", ({ roomCode, username } = {})=>{
    const name = username || ("Guest" + Math.floor(Math.random()*10000));
    const code = (roomCode || crypto.randomBytes(3).toString("hex").toUpperCase());
    if(rooms[code]) return socket.emit("errorMessage", { message: "Room already exists" });
    rooms[code] = { players: [], status: "waiting", autoStartTimer: null };
    rooms[code].players.push({ id: socket.id, name, socketId: socket.id, isBot: false });
    socket.join(code);
    socket.emit("roomCreated", { room: code });
    io.to(code).emit("roomUpdate", rooms[code].players);
  });

  // explicit join room
  socket.on("joinRoom", ({ roomCode, username } = {})=>{
    const name = username || ("Guest" + Math.floor(Math.random()*10000));
    if(!rooms[roomCode]) return socket.emit("errorMessage", { message: "Room not found" });
    rooms[roomCode].players.push({ id: socket.id, name, socketId: socket.id, isBot: false });
    socket.join(roomCode);
    socket.emit("joinedRoom", { room: roomCode, players: rooms[roomCode].players });
    io.to(roomCode).emit("roomUpdate", rooms[roomCode].players);
  });

  // disconnect cleanup
  socket.on("disconnect", ()=>{
    console.log("🔴 Disconnected:", socket.id);
    for(const code of Object.keys(rooms)){
      const r = rooms[code];
      r.players = r.players.filter(p => p.id !== socket.id);
      io.to(code).emit("roomUpdate", r.players);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, ()=> console.log("🚀 Server running on port", PORT));
