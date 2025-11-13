// ✅ server.js (FINAL PRODUCTION READY)
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');

// --- Models ---
const Wallet = require('./models/Transaction'); // make sure file name is Transaction.js in /models/

// --- App Setup ---
const app = express();
app.use(cors());
app.use(express.json());

// ✅ Serve frontend (index.html, login, guest, table/)
app.use(express.static(path.join(__dirname, 'public')));

// --- MongoDB Connection ---
const mongoURI = "mongodb+srv://textilevikhyat_db_user:005WZZly6iIDC8KQ@tash-multyplayer.pntqggs.mongodb.net/tash_multiplayer_db?retryWrites=true&w=majority";

mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log("✅ MongoDB Connected");
    await ensureAdminWallet();
  })
  .catch(err => console.log("❌ MongoDB Error:", err));

// --- Ensure Admin Wallet Exists ---
async function ensureAdminWallet() {
  try {
    const existing = await Wallet.findOne({ isAdmin: true });
    if (!existing) {
      const admin = new Wallet({ username: 'admin', coins: 0, isAdmin: true });
      await admin.save();
      console.log('✅ Admin wallet created');
    } else {
      console.log('✅ Admin wallet exists');
    }
  } catch (err) {
    console.error('Admin init error:', err);
  }
}

// --- JWT SECRET ---
const JWT_SECRET = "your_jwt_secret_here";

// --- TEMP USER STORAGE (you can move to Mongo later) ---
const users = [];

// --- AUTH ROUTES ---
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ message: "Missing username/password" });

  const existing = users.find(u => u.username === username);
  if (existing)
    return res.status(400).json({ message: "Username already exists" });

  const hashed = await bcrypt.hash(password, 10);
  const newUser = { username, password: hashed };
  users.push(newUser);

  try {
    const wallet = new Wallet({ username });
    await wallet.save();
  } catch (err) {
    console.log('Wallet create error:', err.message);
  }

  res.json({ message: "Registered successfully" });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);
  if (!user) return res.status(400).json({ message: "User not found" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ message: "Invalid password" });

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "1d" });
  res.json({ token, username });
});

// --- WALLET ROUTES ---
app.get('/api/wallet', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ message: "No token" });
  try {
    const decoded = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    const wallet = await Wallet.findOne({ username: decoded.username });
    res.json({ coins: wallet?.coins || 0 });
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
});

// --- SOCKET.IO SETUP ---
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
io.serverState = { roomCreators: {}, rooms: {} };

io.on('connection', (socket) => {
  console.log('🟢 Player connected:', socket.id);

  // Join Room
  socket.on('joinRoom', ({ room, username }) => {
    if (!room) return socket.emit('errorMessage', { message: "Room missing" });
    socket.join(room);
    socket.data.username = username;

    if (!io.serverState.roomCreators[room])
      io.serverState.roomCreators[room] = socket.id;

    const sockets = Array.from(io.sockets.adapter.rooms.get(room) || []);
    const players = sockets.map(id => ({
      id,
      username: io.sockets.sockets.get(id).data.username
    }));

    io.to(room).emit('roomUpdate', {
      room,
      players,
      creatorId: io.serverState.roomCreators[room]
    });
  });

  // ✅ startBid
  socket.on('startBid', async (data) => {
    try {
      const { room, biddingTeam, bidAmount } = data;
      if (!room || !Array.isArray(biddingTeam) || !bidAmount)
        return socket.emit('errorMessage', { message: 'Invalid bid data' });

      const perPlayer = Number(bidAmount) / 2;
      const insufficient = [];
      const playerWallets = [];

      for (const uname of biddingTeam) {
        const w = await Wallet.findOne({ username: uname });
        if (!w) insufficient.push(uname + ' (no wallet)');
        else if (w.coins < perPlayer) insufficient.push(uname + ' (not enough coins)');
        else playerWallets.push(w);
      }

      if (insufficient.length > 0) {
        io.to(room).emit('logMessage', { message: `⚠️ Bid cancelled — insufficient coins: ${insufficient.join(', ')}` });
        return;
      }

      for (const w of playerWallets) {
        w.coins -= perPlayer;
        await w.save();
        io.to(room).emit('walletUpdate', { username: w.username, coins: w.coins });
      }

      io.serverState.rooms[room] = io.serverState.rooms[room] || {};
      io.serverState.rooms[room].currentBid = { biddingTeam, bidAmount };

      io.to(room).emit('bidStarted', { biddingTeam, bidAmount });
      console.log(`✅ Bid started: ${bidAmount} by ${biddingTeam.join(', ')}`);
    } catch (err) {
      console.error('startBid error', err);
    }
  });

  // ✅ resolveRound (Winners + Admin share)
  socket.on('resolveRound', async ({ room, winningTeam }) => {
    try {
      const roomState = io.serverState.rooms[room];
      if (!roomState?.currentBid) return;

      const { biddingTeam, bidAmount } = roomState.currentBid;
      const total = Number(bidAmount);
      const adminCut = total * 0.2;
      const winnerShare = total * 0.8;
      const perWinner = winnerShare / winningTeam.length;

      for (const uname of winningTeam) {
        let w = await Wallet.findOne({ username: uname });
        if (!w) w = new Wallet({ username: uname, coins: 0 });
        w.coins += perWinner;
        await w.save();
        io.to(room).emit('walletUpdate', { username: uname, coins: w.coins });
      }

      const admin = await Wallet.findOne({ isAdmin: true });
      if (admin) {
        admin.coins += adminCut;
        await admin.save();
      }

      io.serverState.rooms[room].currentBid = null;
      io.to(room).emit('roundResolved', { winningTeam, perWinner, adminCut });
      console.log(`🏁 Round resolved: ${winningTeam.join(', ')} won`);
    } catch (err) {
      console.error('resolveRound error', err);
    }
  });

  socket.on('disconnect', () => console.log('🔴 Player disconnected:', socket.id));
});

// --- FRONTEND ENTRYPOINT (index.html) ---
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🌍 Server running on port ${PORT}`));
