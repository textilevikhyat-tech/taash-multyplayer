// server.js (FINAL - ready)
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');

// models
const Wallet = require('./models/Transaction');

// app setup
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// mongo URI - replace/password encoded as needed
const mongoURI = "mongodb+srv://textilevikhyat_db_user:005WZZly6iIDC8KQ@tash-multyplayer.pntqggs.mongodb.net/tash_multiplayer_db?retryWrites=true&w=majority";

mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log("✅ MongoDB Connected");
    await ensureAdminWallet();
  })
  .catch(err => console.log("❌ MongoDB Connection Error:", err));

async function ensureAdminWallet() {
  try {
    const ex = await Wallet.findOne({ isAdmin: true });
    if (!ex) {
      const admin = new Wallet({ username: 'admin', coins: 0, isAdmin: true });
      await admin.save();
      console.log('✅ Admin wallet created');
    } else console.log('✅ Admin wallet exists');
  } catch (err) {
    console.error('Admin init error:', err.message);
  }
}

// JWT secret (change in production)
const JWT_SECRET = "super_secret_change_me";

// Simple in-memory users (replace with DB later)
const users = []; // { username, password(hashed) }

// AUTH routes
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: "Missing fields" });
  if (users.find(u => u.username === username)) return res.status(400).json({ message: "Username exists" });

  const hashed = await bcrypt.hash(password, 10);
  users.push({ username, password: hashed });
  try {
    await Wallet.create({ username });
  } catch (err) {
    // ignore duplicate wallet error
  }
  res.json({ message: "Registered" });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);
  if (!user) return res.status(400).json({ message: "User not found" });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ message: "Invalid password" });
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1d' });
  res.json({ token, username });
});

// Wallet endpoints
app.get('/api/wallet', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ message: "No token" });
  try {
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const w = await Wallet.findOne({ username: decoded.username });
    return res.json({ coins: w?.coins ?? 0 });
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
});

// server + socket
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// server state
io.serverState = io.serverState || { rooms: {} }; // rooms: { roomCode: { currentBid, creatorId } }

io.on('connection', (socket) => {
  console.log('🟢 connected', socket.id);

  socket.on('createRoom', ({ roomCode, username }) => {
    if (!roomCode) roomCode = Math.random().toString(36).slice(2,8).toUpperCase();
    socket.join(roomCode);
    socket.data.username = username || `Guest_${socket.id.slice(0,4)}`;
    io.serverState.rooms[roomCode] = io.serverState.rooms[roomCode] || {};
    io.serverState.rooms[roomCode].creatorId = io.serverState.rooms[roomCode].creatorId || socket.id;
    emitRoomUpdate(roomCode);
    socket.emit('roomCreated', { roomCode });
    console.log(`${socket.data.username} created/joined ${roomCode}`);
  });

  socket.on('joinRoom', ({ roomCode, username }) => {
    if (!roomCode) return socket.emit('errorMessage', { message: "Room code required" });
    socket.join(roomCode);
    socket.data.username = username || `Guest_${socket.id.slice(0,4)}`;
    io.serverState.rooms[roomCode] = io.serverState.rooms[roomCode] || {};
    io.serverState.rooms[roomCode].creatorId = io.serverState.rooms[roomCode].creatorId || socket.id;
    emitRoomUpdate(roomCode);
    socket.emit('joinedRoom', { roomCode });
    console.log(`${socket.data.username} joined ${roomCode}`);
  });

  socket.on('startGame', (roomCode) => {
    const sockets = Array.from(io.sockets.adapter.rooms.get(roomCode) || []);
    if (!sockets.length) return socket.emit('errorMessage', { message: "No players in room" });
    const deck = shuffle(createDeck());
    const maxPlayers = Math.min(4, sockets.length);
    const hands = {};
    for (let i=0;i<maxPlayers;i++){
      hands[sockets[i]] = deck.slice(i*8,(i+1)*8).map(c => `${c.rank}${c.suit}`);
    }
    io.to(roomCode).emit('gameStarted', { hands });
    console.log('Game started in', roomCode);
  });

  socket.on('playCard', ({ roomCode, card }) => {
    socket.to(roomCode).emit('cardPlayed', { username: socket.data.username, card });
  });

  // startBid - server verifies coins and deducts per-player share
  socket.on('startBid', async ({ roomCode, biddingTeam, bidAmount }) => {
    try {
      if (!roomCode || !Array.isArray(biddingTeam) || !bidAmount) {
        return socket.emit('errorMessage', { message: "Invalid bid data" });
      }
      const perPlayer = Number(bidAmount)/2;
      const insufficient = [];
      const playerWallets = [];
      for (const uname of biddingTeam) {
        const w = await Wallet.findOne({ username: uname });
        if (!w) insufficient.push(`${uname} (no wallet)`);
        else if (w.coins < perPlayer) insufficient.push(`${uname} (not enough)`);
        else playerWallets.push(w);
      }
      if (insufficient.length) {
        io.to(roomCode).emit('logMessage', { message: `Bid cancelled: ${insufficient.join(', ')}` });
        return;
      }
      for (const w of playerWallets) {
        w.coins -= perPlayer;
        await w.save();
        io.to(roomCode).emit('walletUpdate', { username: w.username, coins: w.coins });
      }
      io.serverState.rooms[roomCode] = io.serverState.rooms[roomCode] || {};
      io.serverState.rooms[roomCode].currentBid = { biddingTeam, bidAmount };
      io.to(roomCode).emit('bidStarted', { biddingTeam, bidAmount });
      console.log('Bid started', roomCode, bidAmount, biddingTeam);
    } catch (err) {
      console.error('startBid err', err);
      socket.emit('errorMessage', { message: "startBid failed" });
    }
  });

  // resolveRound - creator (or any) triggers resolution & payouts
  socket.on('resolveRound', async ({ roomCode, winningTeam }) => {
    try {
      const room = io.serverState.rooms[roomCode];
      if (!room || !room.currentBid) return socket.emit('errorMessage', { message: "No active bid" });
      const { bidAmount } = room.currentBid;
      const total = Number(bidAmount);
      const adminCut = total * 0.2;
      const winnerTotal = total * 0.8;
      const perWinner = winnerTotal / (winningTeam.length||1);

      for (const uname of winningTeam) {
        let w = await Wallet.findOne({ username: uname });
        if (!w) {
          w = new Wallet({ username: uname, coins: 0 });
        }
        w.coins += perWinner;
        await w.save();
        io.to(roomCode).emit('walletUpdate', { username: uname, coins: w.coins });
      }

      const adminW = await Wallet.findOne({ isAdmin: true });
      if (adminW) {
        adminW.coins += adminCut;
        await adminW.save();
      }

      io.serverState.rooms[roomCode].currentBid = null;
      io.to(roomCode).emit('roundResolved', { winningTeam, perWinner, adminCut });
      console.log('Round resolved', roomCode, winningTeam);
    } catch (err) {
      console.error('resolveRound err', err);
      socket.emit('errorMessage', { message: "resolve failed" });
    }
  });

  socket.on('disconnecting', () => {
    // optionally handle leave
  });

  function emitRoomUpdate(roomCode) {
    const sockets = Array.from(io.sockets.adapter.rooms.get(roomCode) || []);
    const players = sockets.map(id => ({ id, username: io.sockets.sockets.get(id).data.username }));
    io.to(roomCode).emit('roomUpdate', { roomCode, players, creatorId: io.serverState.rooms[roomCode]?.creatorId });
  }
});

// helpers - deck
function createDeck(){
  const suits = ['♠','♥','♦','♣'];
  const ranks = ['9','10','J','Q','K','A'];
  const deck=[];
  suits.forEach(s => ranks.forEach(r => deck.push({ suit: s, rank: r })));
  return deck;
}
function shuffle(deck){
  for(let i=deck.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [deck[i],deck[j]]=[deck[j],deck[i]];
  }
  return deck;
}

// serve index
app.get('/', (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));

// start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, ()=> console.log(`🌍 Server running on ${PORT}`));
