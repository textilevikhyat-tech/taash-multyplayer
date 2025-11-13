// server.js (FINAL - includes startBid, resolveRound, admin init)
const mongoose = require('mongoose');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Models
const Wallet = require('./transaction'); // ensure transaction.js exists (model with isAdmin flag)

// Express app
const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Connection
const mongoURI = "mongodb+srv://textilevikhyat_db_user:005WZZly6iIDC8KQ@tash-multyplayer.pntqggs.mongodb.net/tash_multiplayer_db?retryWrites=true&w=majority";

mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log("✅ MongoDB Connected");
    await ensureAdminWallet();
  })
  .catch(err => console.log("❌ MongoDB Connection Error:", err));

// Ensure admin wallet exists (create if missing)
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
const JWT_SECRET = "your_jwt_secret_here"; // Change in production

// In-memory Users (temporary — you can move to DB later)
const users = [];

// --- AUTH ROUTES (simple in-memory users) ---
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

  // ✅ startBid (with coin-check & deduct)
  socket.on('startBid', async (data) => {
    try {
      const { room, biddingTeam, bidAmount } = data;
      if (!room || !Array.isArray(biddingTeam) || !bidAmount) {
        socket.emit('errorMessage', { message: 'Invalid startBid data' });
        return;
      }

      const perPlayer = Number(bidAmount) / 2;

      // Step 1: Check each player's wallet
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
          message: `Bid rejected! These players don't have enough coins: ${insufficient.join(', ')}`
        });
        io.to(room).emit('logMessage', {
          message: `⚠️ Bid cancelled — insufficient coins for: ${insufficient.join(', ')}`
        });
        return;
      }

      // Step 2: Deduct per player
      for (const w of playerWallets) {
        w.coins -= perPlayer;
        await w.save();
        io.to(room).emit('walletUpdate', { username: w.username, coins: w.coins });
      }

      // Step 3: Save active bid
      io.serverState.rooms[room] = io.serverState.rooms[room] || {};
      io.serverState.rooms[room].currentBid = { biddingTeam, bidAmount };

      // Notify
      io.to(room).emit('bidStarted', { biddingTeam, bidAmount });
      console.log(`✅ Bid started in ${room}: ${bidAmount} by ${biddingTeam.join(', ')}`);
    } catch (err) {
      console.error('startBid error', err);
      socket.emit('errorMessage', { message: 'Failed to start bid' });
    }
  });

  // ✅ resolveRound (payouts + admin cut)
  socket.on('resolveRound', async (data) => {
    try {
      const { room, winningTeam } = data;
      if (!room || !Array.isArray(winningTeam)) {
        socket.emit('errorMessage', { message: 'Invalid resolveRound data' });
        return;
      }

      const roomState = io.serverState.rooms[room];
      if (!roomState || !roomState.currentBid) {
        socket.emit('errorMessage', { message: 'No active bid for this room' });
        return;
      }

      const { biddingTeam, bidAmount } = roomState.currentBid;
      const totalBid = Number(bidAmount);
      const adminCut = totalBid * 0.2; // 20%
      const winnerShareTotal = totalBid * 0.8; // 80%
      const perWinner = winnerShareTotal / (winningTeam.length || 1);

      // Credit winners
      for (const uname of winningTeam) {
        const w = await Wallet.findOne({ username: uname });
        if (!w) {
          // if wallet missing, create one (safe-guard)
          const nw = new Wallet({ username: uname });
          nw.coins += perWinner;
          await nw.save();
          io.to(room).emit('walletUpdate', { username: nw.username, coins: nw.coins });
        } else {
          w.coins += perWinner;
          await w.save();
          io.to(room).emit('walletUpdate', { username: w.username, coins: w.coins });
        }
      }

      // Credit admin
      const adminWallet = await Wallet.findOne({ isAdmin: true });
      if (adminWallet) {
        adminWallet.coins += adminCut;
        await adminWallet.save();
        // notify admin (and also room maybe)
        io.to(room).emit('walletUpdate', { username: adminWallet.username, coins: adminWallet.coins });
      } else {
        console.warn('Admin wallet not found for payout');
      }

      // Clear current bid
      io.serverState.rooms[room].currentBid = null;

      // Emit roundResolved with details
      io.to(room).emit('roundResolved', { winningTeam, perWinner, adminCut });
      console.log(`🏁 Round resolved in ${room}. Winners: ${winningTeam.join(', ')}. Each winner +${perWinner}. Admin +${adminCut}`);
    } catch (err) {
      console.error('resolveRound error', err);
      socket.emit('errorMessage', { message: 'Failed to resolve round' });
    }
  });

  // --- GAME START ---
  socket.on('startGame', (room) => {
    const state = io.serverState;
    if (state.roomCreators[room] !== socket.id) {
      socket.emit('errorMessage', { message: "Only creator can start the game" });
      return;
    }

    const sockets = Array.from(io.sockets.adapter.rooms.get(room) || []);
    const maxPlayers = Math.min(4, sockets.length);

    const deck = shuffle(createDeck());
    const hands = {};
    for (let i = 0; i < maxPlayers; i++) {
      hands[sockets[i]] = deck.slice(i * 8, (i + 1) * 8);
    }

    io.to(room).emit('gameStarted', { hands });
  });

  // --- PLAY CARD ---
  socket.on('playCard', ({ room, card, username }) => {
    io.to(room).emit('cardPlayed', { username, card });
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

app.get('/', (req, res) => res.send("🚀 Server running"));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🌍 Server running on port ${PORT}`));
