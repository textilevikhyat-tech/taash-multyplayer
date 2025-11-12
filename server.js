// server.js
const mongoose = require("mongoose");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

// ✅ Import Routes
const authRoutes = require("./backend/controllers/authController");
const walletRoutes = require("./routes/walletRoutes");

const app = express();

// ✅ CORS FIX (GitHub Pages + Backend)
app.use(
  cors({
    origin: [
      "https://textilevikhyat-tech.github.io", // ✅ Your frontend
      "https://taash-multyplayer.onrender.com", // ✅ Your backend
    ],
    methods: ["GET", "POST"],
    credentials: true,
  })
);

app.use(express.json());

// ✅ ROUTES
app.use("/api/auth", authRoutes);
app.use("/api/wallet", walletRoutes);

// ✅ MongoDB Connection
const mongoURI =
  "mongodb+srv://textilevikhyat_db_user:005WZZly6iIDC8KQ@tash-multyplayer.pntqggs.mongodb.net/tash_multiplayer_db?retryWrites=true&w=majority";

mongoose
  .connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log("❌ MongoDB Connection Error:", err));

// ✅ Server + Socket.io setup
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "https://textilevikhyat-tech.github.io",
      "https://taash-multyplayer.onrender.com",
    ],
  },
});

const PORT = process.env.PORT || 10000;

// ✅ Room/Game Logic
io.serverState = io.serverState || { roomCreators: {} };

io.on("connection", (socket) => {
  console.log("🟢 Player connected:", socket.id);

  socket.on("joinRoom", ({ room, username }) => {
    if (!room) return socket.emit("errorMessage", { message: "Room missing" });

    socket.join(room);
    socket.data.username = username || "Anonymous";

    if (!io.serverState.roomCreators[room]) {
      io.serverState.roomCreators[room] = socket.id;
    }

    const socketsInRoom = Array.from(io.sockets.adapter.rooms.get(room) || []);
    const players = socketsInRoom.map((id) => {
      const s = io.sockets.sockets.get(id);
      return { id, username: s?.data?.username || "Unknown" };
    });

    io.to(room).emit("roomUpdate", {
      players,
      room,
      creatorId: io.serverState.roomCreators[room],
    });
    console.log(`${socket.data.username} joined room ${room}`);
  });

  socket.on("startGame", (room) => {
    if (!room)
      return socket.emit("errorMessage", { message: "Room missing" });

    const creatorId = io.serverState.roomCreators[room];
    if (creatorId !== socket.id) {
      return socket.emit("errorMessage", {
        message: "Only the room creator can start the game.",
      });
    }

    const socketsInRoom = Array.from(io.sockets.adapter.rooms.get(room) || []);
    if (!socketsInRoom.length)
      return socket.emit("errorMessage", { message: "No players in room." });

    const deck = shuffle(createDeck());
    const maxPlayers = Math.min(4, socketsInRoom.length);
    const hands = {};

    for (let i = 0; i < maxPlayers; i++) {
      const playerId = socketsInRoom[i];
      hands[playerId] = deck.slice(i * 8, (i + 1) * 8);
    }

    io.to(room).emit("gameStarted", { hands });
    console.log(`🎮 Game started in room ${room}`);
  });

  socket.on("leaveRoom", (room) => {
    if (!room) return;
    socket.leave(room);

    const socketsInRoom = Array.from(io.sockets.adapter.rooms.get(room) || []);
    const players = socketsInRoom.map((id) => {
      const s = io.sockets.sockets.get(id);
      return { id, username: s?.data?.username || "Unknown" };
    });

    if (io.serverState.roomCreators[room] === socket.id) {
      io.serverState.roomCreators[room] = socketsInRoom[0];
    }

    io.to(room).emit("roomUpdate", {
      players,
      room,
      creatorId: io.serverState.roomCreators[room],
    });
    console.log(`👋 ${socket.id} left room ${room}`);
  });

  socket.on("disconnect", () => {
    console.log("🔴 Player disconnected:", socket.id);
  });
});

// ✅ Utility functions
function createDeck() {
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks = ["9", "10", "J", "Q", "K", "A"];
  const deck = [];
  for (const s of suits) {
    for (const r of ranks) {
      deck.push({ suit: s, rank: r, code: `${r}${s}` });
    }
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ✅ Root test route
app.get("/", (req, res) => res.send("🚀 Taash Multiplayer backend running"));

// ✅ Start Server
server.listen(PORT, () =>
  console.log(`🌍 Server running on port ${PORT}`)
);
