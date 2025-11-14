require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require("path");
const mongoose = require('mongoose');
const cors = require('cors');
const { Server } = require('socket.io');

// Models
const User = require('./backend/models/User');
const Wallet = require('./backend/models/Transaction');

// Controllers
const authController = require('./backend/controllers/authController');
const walletRoutes = require('./backend/routes/walletRoutes');

// App
const app = express();
app.use(cors());
app.use(express.json());

// Static frontend
app.use(express.static(path.join(__dirname, "public")));

// Database
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ DB Error:", err));

// Auth Routes
app.post("/api/auth/register", authController.register);
app.post("/api/auth/login", authController.login);

// Wallet Routes
app.use("/api/wallet", walletRoutes);

// Server + Socket
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Game Memory
io.serverState = { rooms: {} };

// Socket
io.on("connection", socket => {
  console.log("🟢 Connected:", socket.id);

  socket.on("joinRoom", ({ room, username }) => {
    socket.join(room);
    socket.data.username = username;

    const players = Array.from(io.sockets.adapter.rooms.get(room) || [])
      .map(id => ({
        id,
        username: io.sockets.sockets.get(id).data.username
      }));

    io.to(room).emit("roomUpdate", { room, players });
  });

  socket.on("disconnect", () => {
    console.log("🔴 Disconnected:", socket.id);
  });
});

// Root
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start
server.listen(process.env.PORT || 5000, () =>
  console.log("🚀 Server Running...")
);
