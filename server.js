// server.js (FINAL - with /public static frontend)
const mongoose = require('mongoose');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');

// Models
const Wallet = require('./transaction'); // Ensure transaction.js exists (wallet schema with isAdmin flag)

// Express app
const app = express();
app.use(cors());
app.use(express.json());

// ✅ Serve static frontend (like index.html, game UI)
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
const mongoURI = "mongodb+srv://textilevikhyat_db_user:005WZZly6iIDC8KQ@tash-multyplayer.pntqggs.mongodb.net/tash_multiplayer_db?retryWrites=true&w=majority";

mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log("✅ MongoDB Connected");
    await ensureAdminWallet();
  })
  .catch(err => console.log("❌ MongoDB Connection Error:", err));

// Ensure admin wallet exists
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

// JWT secret
const JWT_SECRET = "your_jwt_secret_here"; // change for production

// In-memory Users
const users = [];

// --- AUTH ROUTES ---
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: "Missing username/password" });

  const existing = users.find(u => u.username === username);
  if (existing) return res.status(400).json({ message: "Username already exists" });

  const hashed = await bcrypt.hash(password, 10);
  const newUser = { username, password: hashed };
  users.push(newUser);

  try {
    const wallet = new Wallet({ username });
    await wallet.save();
  } catch (err) { console.log('wallet create:', err.message); }

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
  const token = auth.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const wallet = await Wallet.findOne({ username: decoded.username });
    return res.json({ coins: wallet?.coins || 0 });
  } catch (err) { return res.status(401).json({ message: "Invalid token" }); }
});

app.post('/api/wallet/add', async (req, res) => {
  const { coins } = req.body;
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ message: "No token" });
  const token = auth.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const wallet = await Wallet.findOne({ username: decoded.username });
    wallet.coins += coins;
    await wallet.save();
    return res.json({ coins: wallet.coins });
  } catch (err) { return res.status(401).json({ message: "Invalid token" }); }
});

app.post('/api/wallet/deduct', async (req, res) => {
  const { coins } = req.body;
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ message: "No token" });
  const token = auth.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const wallet = await Wallet.findOne({ username: decoded.username });
    wallet.coins = Math.max(wallet.coins - coins, 0);
    await wallet.save();
    return res.json({ coins: wallet.coins });
  } catch (err) { return res.status(401).json({ message: "Invalid token" }); }
});

// --- SOCKET.IO SETUP ---
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.serverState = io.serverState || { roomCreators: {}, rooms: {} };

io.on('connection', (socket) => {
  console.log('🟢 Player connected:', socket.id);

  socket.on('joinRoom', ({ room, username }) => {
    if (!room) return socket.emit('errorMessage', { message: "Room name missing" });
    socket.join(room);
    socket.data.username = username;

    const state = io.serverState;
    if (!state.roomCreators[room]) state.roomCreators[room] = socket.id;

    const sockets = Array.from(io.sockets.adapter.rooms.get(room) || []);
    const players = sockets.map(id => ({ id, username: io.sockets.sockets.get(id).data.username }));

    io.to(room).emit('roomUpdate', { room, players, creatorId: state.roomCreators[room] });
  });

  // ✅ startBid
  socket.on('startBid', async (data) => {
    try {
      const { room, biddingTeam, bidAmount } = data;
      if (!room || !Array.isArray(biddingTeam) || !bidAmount) {
        socket.emit('errorMessage', { message: 'Invalid startBid data' });
        return;
      }

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
        socket.emit('errorMessage', {
          message: `Bid rejected! Insufficient coins: ${insufficient.join(', ')}`
        });
        io.to(room).emit('logMessage', {
          message: `⚠️ Bid cancelled — insufficient coins: ${insufficient.join(', ')}`
        });
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
      console.log(`✅ Bid started in ${room}: ${bidAmount} by ${biddingTeam.join(', ')}`);
    } catch (err) {
      console.error('startBid error', err);
      socket.emit('errorMessage', { message: 'Failed to start bid' });
    }
  });

  // ✅ resolveRound
  socket.on('resolveRound', async (data) => {
    try {
      const { room, winningTeam } = data;
      const roomState = io.serverState.rooms[room];
      if (!roomState || !roomState.currentBid) return;

      const { biddingTeam, bidAmount } = roomState.currentBid;
      const totalBid = Number(bidAmount);
      const adminCut = totalBid * 0.2;
      const winnerShareTotal = totalBid * 0.8;
      const perWinner = winnerShareTotal / (winningTeam.length || 1);

      for (const uname of winningTeam) {
        const w = await Wallet.findOne({ username: uname });
        if (!w) {
          const nw = new Wallet({ username: uname, coins: perWinner });
          await nw.save();
          io.to(room).emit('walletUpdate', { username: uname, coins: perWinner });
        } else {
          w.coins += perWinner;
          await w.save();
          io.to(room).emit('walletUpdate', { username: w.username, coins: w.coins });
        }
      }

      const adminWallet = await Wallet.findOne({ isAdmin: true });
      if (adminWallet) {
        adminWallet.coins += adminCut;
        await adminWallet.save();
      }

      io.serverState.rooms[room].currentBid = null;
      io.to(room).emit('roundResolved', { winningTeam, perWinner, adminCut });
      console.log(`🏁 Round resolved in ${room}. Winners: ${winningTeam.join(', ')}`);
    } catch (err) {
      console.error('resolveRound error', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('🔴 Player disconnected:', socket.id);
  });
});

// --- DECK HELPERS ---
function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  suits.forEach(s => ranks.forEach(r => deck.push({ suit: s, rank: r })));
  return deck;
}
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🌍 Server running on port ${PORT}`));
