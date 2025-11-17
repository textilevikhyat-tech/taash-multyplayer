require("dotenv").config();

const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

// Controllers
const authController = require("./backend/controllers/authController");

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Connect
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log("❌ MongoDB Error:", err));

// Routes
app.post("/api/auth/register", authController.register);
app.post("/api/auth/login", authController.login);

// Wallet Route
try {
  const walletRoutes = require("./routes/walletRoutes");
  app.use("/api/wallet", walletRoutes);
} catch (err) {
  console.log("⚠ walletRoutes skipped:", err.message);
}

// 🟢 STATIC FRONTEND SERVE (FIXED)
app.use(express.static(path.join(__dirname, "frontend", "dist")));

// fallback (React Router)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "dist", "index.html"));
});

// -------------------------
// SOCKET.IO + GAME LOGIC
// -------------------------

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = {};

function makeBot() {
  return {
    id: "bot-" + crypto.randomBytes(3).toString("hex"),
    name: "Bot",
    isBot: true
  };
}

function findOpenRoom() {
  for (const code in rooms) {
    if (rooms[code].status === "waiting" && rooms[code].players.length < 4)
      return code;
  }
  return null;
}

io.on("connection", (socket) => {
  console.log("🟢 Connected:", socket.id);

  // AUTO JOIN
  socket.on("quickJoin", ({ username }) => {
    username = username || "Guest" + Math.floor(Math.random() * 9999);
    socket.data.username = username;

    let room = findOpenRoom();
    if (!room) {
      room = crypto.randomBytes(3).toString("hex").toUpperCase();
      rooms[room] = { players: [], status: "waiting" };
    }

    rooms[room].players.push({
      id: socket.id,
      name: username,
      isBot: false
    });

    socket.join(room);

    io.to(room).emit("roomUpdate", rooms[room].players);

    // Auto-fill with Bots
    setTimeout(() => {
      if (rooms[room].players.length < 4) {
        while (rooms[room].players.length < 4) {
          rooms[room].players.push(makeBot());
        }
      }

      io.to(room).emit("gameStarted", {
        players: rooms[room].players
      });

      // SEND CARDS
      rooms[room].players.forEach((p) => {
        if (!p.isBot) {
          const sock = io.sockets.sockets.get(p.id);
          if (sock) {
            sock.emit("dealCards", ["A♠", "J♥", "9♦"]); // simple demo card dealing
          }
        }
      });
    }, 3000);

    socket.emit("joinedRoom", {
      room,
      players: rooms[room].players
    });
  });

  socket.on("disconnect", () => {
    Object.keys(rooms).forEach((code) => {
      rooms[code].players = rooms[code].players.filter(
        (p) => p.id !== socket.id
      );
      io.to(code).emit("roomUpdate", rooms[code].players);
    });
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
