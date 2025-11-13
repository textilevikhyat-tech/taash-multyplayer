// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');

const authController = require('./backend/controllers/authController');
const walletRoutes = require('./backend/routes/walletRoutes');
const Wallet = require('./backend/models/Transaction');
const User = require('./backend/models/User');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/auth', authController);
app.use('/api/wallet', walletRoutes);

// Mongo
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('MONGO_URI not set in .env');
  process.exit(1);
}
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('✅ MongoDB Connected');
    // ensure admin wallet
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
    // create admin user if not exists
    const existingAdmin = await User.findOne({ username: adminUser });
    if (!existingAdmin) {
      const bcrypt = require('bcrypt');
      const h = await bcrypt.hash(adminPass, 10);
      await new User({ username: adminUser, passwordHash: h }).save();
      console.log('✅ Admin user created');
    }
    const adminWallet = await Wallet.findOne({ isAdmin: true });
    if (!adminWallet) {
      await new Wallet({ username: adminUser, coins: 0, isAdmin: true }).save();
      console.log('✅ Admin wallet created');
    }
  })
  .catch(err => {
    console.error('Mongo connect error:', err.message);
    process.exit(1);
  });

/**
 * Game state in memory:
 * rooms: {
 *   ROOMCODE: {
 *     players: [username],
 *     sockets: [socketId],
 *     creatorId,
 *     currentBid: { biddingTeam: [...], bidAmount },
 *     deck, hands: { socketId: [cards] },
 *     turnIndex
 *   }
 * }
 */
io.serverState = { rooms: {} };

// helpers
function createDeck() {
  const suits = ['♠','♥','♦','♣'];
  const ranks = ['9','10','J','Q','K','A'];
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

io.on('connection', (socket) => {
  console.log('🟢 socket connected', socket.id);

  // create room
  socket.on('createRoom', ({ roomCode, username }) => {
    const code = roomCode && roomCode.trim() ? roomCode.trim().toUpperCase()
      : Math.random().toString(36).slice(2,8).toUpperCase();
    socket.join(code);
    socket.data.username = username;

    if (!io.serverState.rooms[code]) {
      io.serverState.rooms[code] = { players: [], sockets: [], creatorId: socket.id, currentBid: null, deck:null, hands:{}, turnIndex:0 };
    }
    if (!io.serverState.rooms[code].players.includes(username)) {
      io.serverState.rooms[code].players.push(username);
      io.serverState.rooms[code].sockets.push(socket.id);
    }
    io.to(code).emit('roomUpdate', { roomCode: code, players: io.serverState.rooms[code].players });
    socket.emit('roomCreated', { roomCode: code });
    console.log(`${username} created/joined ${code}`);
  });

  // join room
  socket.on('joinRoom', ({ roomCode, username }) => {
    const code = roomCode && roomCode.trim().toUpperCase();
    if (!code) { socket.emit('errorMessage', { message: 'Invalid room code' }); return; }
    socket.join(code);
    socket.data.username = username;
    if (!io.serverState.rooms[code]) {
      io.serverState.rooms[code] = { players: [], sockets: [], creatorId: socket.id, currentBid: null, deck:null, hands:{}, turnIndex:0 };
    }
    if (!io.serverState.rooms[code].players.includes(username)) {
      io.serverState.rooms[code].players.push(username);
      io.serverState.rooms[code].sockets.push(socket.id);
    } else {
      if (!io.serverState.rooms[code].sockets.includes(socket.id)) io.serverState.rooms[code].sockets.push(socket.id);
    }
    io.to(code).emit('roomUpdate', { roomCode: code, players: io.serverState.rooms[code].players });
    socket.emit('joinedRoom', { roomCode: code });
    console.log(`${username} joined ${code}`);
  });

  // startGame -> deal cards and set turn
  socket.on('startGame', (roomCode) => {
    const code = roomCode && roomCode.trim().toUpperCase();
    const room = io.serverState.rooms[code];
    if (!room) { socket.emit('errorMessage', { message: 'Room not found' }); return; }
    const socketsInRoom = Array.from(io.sockets.adapter.rooms.get(code) || []);
    const maxPlayers = Math.min(4, socketsInRoom.length);
    const deck = shuffle(createDeck());
    room.deck = deck;
    room.hands = {};
    for (let i=0;i<maxPlayers;i++){
      const sid = socketsInRoom[i];
      room.hands[sid] = deck.slice(i*8, (i+1)*8).map(c => `${c.rank}${c.suit}`);
    }
    room.turnIndex = 0;
    io.to(code).emit('gameStarted', { hands: room.hands });
    // notify first player their turn
    const firstSocket = socketsInRoom[room.turnIndex];
    if (firstSocket) io.to(firstSocket).emit('yourTurn', { message: 'Your turn to play' });
    console.log(`Game started in ${code}`);
  });

  // startBid with verification & deduction (split equally among biddingTeam)
  socket.on('startBid', async ({ roomCode, biddingTeam, bidAmount }) => {
    try {
      const code = roomCode && roomCode.trim().toUpperCase();
      const room = io.serverState.rooms[code];
      if (!room) { socket.emit('errorMessage', { message: 'Room not found' }); return; }
      if (!Array.isArray(biddingTeam) || !bidAmount) { socket.emit('errorMessage', { message: 'Invalid bid' }); return; }
      const perPlayer = Number(bidAmount) / biddingTeam.length;

      const insufficient = [];
      const wallets = [];
      for (const uname of biddingTeam) {
        const w = await Wallet.findOne({ username: uname });
        if (!w || w.coins < perPlayer) insufficient.push(uname);
        else wallets.push(w);
      }

      if (insufficient.length) {
        io.to(code).emit('logMessage', { message: `Bid cancelled: insufficient coins for ${insufficient.join(', ')}` });
        return;
      }

      // deduct per player
      for (const w of wallets) {
        w.coins -= perPlayer;
        await w.save();
        io.to(code).emit('walletUpdate', { username: w.username, coins: w.coins });
      }

      room.currentBid = { biddingTeam, bidAmount: Number(bidAmount) };
      io.to(code).emit('bidStarted', { biddingTeam, bidAmount: Number(bidAmount) });
      console.log(`Bid ${bidAmount} started in ${code} by ${biddingTeam.join(', ')}`);
    } catch (err) {
      console.error('startBid error', err.message);
      socket.emit('errorMessage', { message: 'startBid failed' });
    }
  });

  // playCard (simple broadcast, advances turn)
  socket.on('playCard', ({ roomCode, card }) => {
    const code = roomCode && roomCode.trim().toUpperCase();
    const room = io.serverState.rooms[code];
    if (!room) return;
    // broadcast card played
    io.to(code).emit('cardPlayed', { username: socket.data.username, card });
    // advance turn
    const socketsInRoom = Array.from(io.sockets.adapter.rooms.get(code) || []);
    room.turnIndex = (room.turnIndex + 1) % socketsInRoom.length;
    const nextSocket = socketsInRoom[room.turnIndex];
    if (nextSocket) io.to(nextSocket).emit('yourTurn', { message: 'Your turn' });
  });

  // resolveRound -> payout winners & admin 20%
  socket.on('resolveRound', async ({ roomCode, winningTeam }) => {
    try {
      const code = roomCode && roomCode.trim().toUpperCase();
      const room = io.serverState.rooms[code];
      if (!room || !room.currentBid) { socket.emit('errorMessage', { message: 'No active bid' }); return; }
      const { biddingTeam, bidAmount } = room.currentBid;
      const total = Number(bidAmount);
      const adminCut = total * 0.2;
      const winnerShareTotal = total * 0.8;
      const perWinner = winnerShareTotal / (winningTeam.length || 1);

      for (const uname of winningTeam) {
        let w = await Wallet.findOne({ username: uname });
        if (!w) { w = new Wallet({ username: uname, coins: 0 }); }
        w.coins += perWinner;
        await w.save();
        io.to(code).emit('walletUpdate', { username: w.username, coins: w.coins });
      }

      const admin = await Wallet.findOne({ isAdmin: true });
      if (admin) { admin.coins += adminCut; await admin.save(); io.to(code).emit('walletUpdate', { username: admin.username, coins: admin.coins }); }

      room.currentBid = null;
      io.to(code).emit('roundResolved', { winningTeam, perWinner, adminCut });
      console.log(`Round resolved in ${code}`);
    } catch (err) {
      console.error('resolveRound error', err.message);
      socket.emit('errorMessage', { message: 'resolveRound failed' });
    }
  });

  socket.on('disconnect', () => {
    console.log('🔴 socket disconnected', socket.id);
    // optional: remove from rooms sockets list; keep players by username for simplicity
  });
});

// serve index
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🌍 Server running on port ${PORT}`));
