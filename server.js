// server.js
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const Wallet = require('./models/Transaction');
const walletRoutes = require('./routes/walletRoutes');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// CONFIG (use env or replace string)
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/taash29";
const JWT_SECRET = process.env.JWT_SECRET || "change_this_jwt_secret";

// Connect Mongo
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('✅ MongoDB connected');
    // ensure admin wallet exists
    const admin = await Wallet.findOne({ isAdmin: true });
    if (!admin) {
      await new Wallet({ username: 'admin', coins: 0, isAdmin: true }).save();
      console.log('✅ Admin wallet created');
    } else {
      console.log('✅ Admin wallet exists');
    }
  })
  .catch(err => console.error('Mongo error:', err.message));

// optional route
app.use('/api/wallet', walletRoutes);

// simple auth endpoints (in-memory users for now)
const users = []; // { username, password(hashed) }

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Missing fields' });
    if (users.find(u => u.username === username)) return res.status(400).json({ message: 'Username exists' });

    const hashed = await bcrypt.hash(password, 10);
    users.push({ username, password: hashed });

    try { await Wallet.create({ username }); } catch(e){ /* ignore duplicate */ }

    return res.json({ message: 'Registered' });
  } catch (err) { return res.status(500).json({ message: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);
    if (!user) return res.status(400).json({ message: 'User not found' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ message: 'Invalid password' });
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1d' });
    return res.json({ token, username });
  } catch (err) { return res.status(500).json({ message: err.message }); }
});

// wallet endpoints used by frontend (token required)
app.get('/api/me/wallet', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ message: 'No token' });
  try {
    const decoded = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    const w = await Wallet.findOne({ username: decoded.username });
    return res.json({ username: decoded.username, coins: w?.coins ?? 0 });
  } catch (err) { return res.status(401).json({ message: 'Invalid token' }); }
});

// start server + socket
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// server state
io.serverState = io.serverState || { rooms: {} }; // rooms[roomCode] = { creatorId, currentBid, players: [username] }

io.on('connection', (socket) => {
  console.log('🟢 socket connected', socket.id);

  // createRoom / joinRoom
  socket.on('createRoom', ({ roomCode, username }) => {
    const code = (roomCode && roomCode.trim()) || Math.random().toString(36).slice(2,8).toUpperCase();
    socket.join(code);
    socket.data.username = username || `Guest${socket.id.slice(0,4)}`;
    io.serverState.rooms[code] = io.serverState.rooms[code] || { creatorId: socket.id, players: [] };
    if (!io.serverState.rooms[code].players.includes(socket.data.username)) {
      io.serverState.rooms[code].players.push(socket.data.username);
    }
    io.to(code).emit('roomUpdate', { roomCode: code, players: io.serverState.rooms[code].players, creatorId: io.serverState.rooms[code].creatorId });
    socket.emit('roomCreated', { roomCode: code });
    console.log(`${socket.data.username} created/joined ${code}`);
  });

  socket.on('joinRoom', ({ roomCode, username }) => {
    if (!roomCode) { socket.emit('errorMessage', { message: 'roomCode required' }); return; }
    const code = roomCode.trim().toUpperCase();
    socket.join(code);
    socket.data.username = username || `Guest${socket.id.slice(0,4)}`;
    io.serverState.rooms[code] = io.serverState.rooms[code] || { creatorId: socket.id, players: [] };
    if (!io.serverState.rooms[code].players.includes(socket.data.username)) {
      io.serverState.rooms[code].players.push(socket.data.username);
    }
    io.to(code).emit('roomUpdate', { roomCode: code, players: io.serverState.rooms[code].players, creatorId: io.serverState.rooms[code].creatorId });
    socket.emit('joinedRoom', { roomCode: code });
    console.log(`${socket.data.username} joined ${code}`);
  });

  // startGame: deal cards (24-card deck; 8 cards each max 4 players)
  socket.on('startGame', (roomCode) => {
    const code = (roomCode || '').trim().toUpperCase();
    if (!io.serverState.rooms[code]) { socket.emit('errorMessage', { message: 'Room not found' }); return; }
    const sockets = Array.from(io.sockets.adapter.rooms.get(code) || []);
    const maxPlayers = Math.min(4, sockets.length);
    const deck = shuffle(createDeck());
    const hands = {};
    for (let i = 0; i < maxPlayers; i++) {
      const sid = sockets[i];
      const hand = deck.slice(i*8, (i+1)*8).map(c => `${c.rank}${c.suit}`);
      hands[sid] = hand;
    }
    io.to(code).emit('gameStarted', { hands });
    console.log(`Game started in ${code}`);
  });

  // playCard
  socket.on('playCard', ({ roomCode, card }) => {
    const code = (roomCode || '').trim().toUpperCase();
    socket.to(code).emit('cardPlayed', { username: socket.data.username, card });
  });

  // startBid: biddingTeam = [username1, username2], bidAmount number
  socket.on('startBid', async ({ roomCode, biddingTeam, bidAmount }) => {
    try {
      const code = (roomCode || '').trim().toUpperCase();
      if (!io.serverState.rooms[code]) { socket.emit('errorMessage', { message: 'Room not found' }); return; }
      if (!Array.isArray(biddingTeam) || !bidAmount) { socket.emit('errorMessage', { message: 'Invalid bid data' }); return; }
      const perPlayer = Number(bidAmount) / 2;

      // check wallets
      const insufficient = [];
      const wallets = [];
      for (const uname of biddingTeam) {
        const w = await Wallet.findOne({ username: uname });
        if (!w) insufficient.push(`${uname} (no wallet)`);
        else if (w.coins < perPlayer) insufficient.push(`${uname} (insufficient)`);
        else wallets.push(w);
      }
      if (insufficient.length) {
        io.to(code).emit('logMessage', { message: `Bid cancelled: ${insufficient.join(', ')}` });
        return;
      }

      // deduct
      for (const w of wallets) {
        w.coins -= perPlayer;
        await w.save();
        io.to(code).emit('walletUpdate', { username: w.username, coins: w.coins });
      }

      io.serverState.rooms[code].currentBid = { biddingTeam, bidAmount };
      io.to(code).emit('bidStarted', { biddingTeam, bidAmount });
      console.log(`Bid ${bidAmount} started in ${code} by ${biddingTeam.join(', ')}`);
    } catch (err) {
      console.error('startBid error', err.message);
      socket.emit('errorMessage', { message: 'startBid failed' });
    }
  });

  // resolveRound: winningTeam = [user1,user2]
  socket.on('resolveRound', async ({ roomCode, winningTeam }) => {
    try {
      const code = (roomCode || '').trim().toUpperCase();
      const room = io.serverState.rooms[code];
      if (!room || !room.currentBid) { socket.emit('errorMessage', { message: 'No active bid' }); return; }
      const { biddingTeam, bidAmount } = room.currentBid;
      const total = Number(bidAmount);
      const adminCut = total * 0.2;
      const winnerTotal = total * 0.8;
      const perWinner = winnerTotal / (winningTeam.length || 1);

      // credit winners
      for (const uname of winningTeam) {
        let w = await Wallet.findOne({ username: uname });
        if (!w) {
          w = new Wallet({ username: uname, coins: 0 });
        }
        w.coins += perWinner;
        await w.save();
        io.to(code).emit('walletUpdate', { username: w.username, coins: w.coins });
      }

      // admin
      const admin = await Wallet.findOne({ isAdmin: true });
      if (admin) { admin.coins += adminCut; await admin.save(); }

      io.serverState.rooms[code].currentBid = null;
      io.to(code).emit('roundResolved', { winningTeam, perWinner, adminCut });
      console.log(`Round resolved in ${code}. Winners: ${winningTeam.join(', ')}`);
    } catch (err) {
      console.error('resolveRound error', err.message);
      socket.emit('errorMessage', { message: 'resolveRound failed' });
    }
  });

  socket.on('disconnect', () => {
    // optional: remove user from any room arrays
    console.log('🔴 socket disconnected', socket.id);
  });

});

// helpers
function createDeck(){
  const suits = ['♠','♥','♦','♣'];
  const ranks = ['9','10','J','Q','K','A'];
  const deck = [];
  suits.forEach(s => ranks.forEach(r => deck.push({ suit: s, rank: r })));
  return deck;
}
function shuffle(deck){
  for (let i = deck.length -1; i>0; i--){
    const j = Math.floor(Math.random() * (i+1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🌍 Server running on port ${PORT}`));
