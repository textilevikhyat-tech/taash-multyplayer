require("dotenv").config();

const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

// MODELS
const User = require("./models/User");
const Wallet = require("./models/Transaction");

// ROUTES (FIXED)
const authController = require("./backend/controllers/authController");
const walletRoutes = require("./routes/walletRoutes");

// EXPRESS APP
const app = express();
app.use(cors());
app.use(express.json());

// MONGO CONNECT
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log("❌ Mongo Error:", err));

// AUTH ROUTES
app.post("/api/auth/register", authController.register);
app.post("/api/auth/login", authController.login);

// WALLET ROUTES
app.use("/api/wallet", walletRoutes);

// STATIC FRONTEND (VITE BUILD)
app.use(express.static(path.join(__dirname, "frontend", "dist")));

// SERVER + SOCKET
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// GAME STATE
let rooms = {}; // room => { players, deck, turn, tableCards, scores }

// SOCKET CONNECTION
io.on("connection", (socket) => {
  console.log("🟢 Connected:", socket.id);

  // Join Room
  socket.on("joinRoom", ({ room, username }) => {
    socket.join(room);
    socket.data.username = username;

    if (!rooms[room]) {
      rooms[room] = { players: [] };
    }

    rooms[room].players.push({
      id: socket.id,
      username,
    });

    io.to(room).emit("roomUpdate", rooms[room].players);
  });

  socket.on("disconnect", () => {
    console.log("🔴 Disconnected:", socket.id);

    // Clean room
    for (const room of Object.keys(rooms)) {
      rooms[room].players = rooms[room].players.filter(
        (p) => p.id !== socket.id
      );

      io.to(room).emit("roomUpdate", rooms[room].players);

      if (rooms[room].players.length === 0) {
        delete rooms[room];
      }
    }
  });
});

// SEND INDEX FOR ANY ROUTE
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "dist", "index.html"));
});

// START SERVER
server.listen(process.env.PORT || 5000, () =>
  console.log("🚀 Server running on port", process.env.PORT || 5000)
);
