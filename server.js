const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const Wallet = require("./models/Wallet");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const MONGO_URI = "mongodb+srv://textilevikhyat_db_user:005WZZly6iIDC8KQ@tash-multyplayer.pntqggs.mongodb.net/tash_multiplayer_db?retryWrites=true&w=majority";

mongoose
  .connect(MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB Connected");
    await ensureAdminWallet();
  })
  .catch((err) => console.error("❌ MongoDB Error:", err));

async function ensureAdminWallet() {
  const exist = await Wallet.findOne({ isAdmin: true });
  if (!exist) {
    const admin = new Wallet({ username: "admin", coins: 0, isAdmin: true });
    await admin.save();
    console.log("✅ Admin wallet created");
  }
}

const JWT_SECRET = "secret_key";
const users = [];

app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ message: "Missing credentials" });

  const exist = users.find((u) => u.username === username);
  if (exist) return res.status(400).json({ message: "User exists" });

  const hash = await bcrypt.hash(password, 10);
  users.push({ username, password: hash });
  await new Wallet({ username, coins: 100 }).save();
  res.json({ message: "Registered!" });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const user = users.find((u) => u.username === username);
  if (!user) return res.status(400).json({ message: "User not found" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ message: "Wrong password" });

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "1d" });
  res.json({ token, username });
});

app.get("/api/wallet/:username", async (req, res) => {
  const wallet = await Wallet.findOne({ username: req.params.username });
  res.json({ coins: wallet?.coins || 0 });
});

io.serverState = { rooms: {} };

io.on("connection", (socket) => {
  console.log("🟢 Connected:", socket.id);

  socket.on("joinRoom", ({ username, room }) => {
    socket.join(room);
    socket.data.username = username;
    const players = Array.from(io.sockets.adapter.rooms.get(room) || []).map(
      (id) => ({ id, username: io.sockets.sockets.get(id).data.username })
    );
    io.to(room).emit("roomUpdate", { players });
  });

  socket.on("startBid", ({ room, team, bidAmount }) => {
    io.to(room).emit("bidStarted", { team, bidAmount });
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log(`🌍 Server running on http://localhost:${PORT}`)
);
