// server.js
const mongoose = require('mongoose');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Models
const Wallet = require('./transaction');

// Express app
const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Connection
const mongoURI = "mongodb+srv://textilevikhyat_db_user:005WZZly6iIDC8KQ@tash-multyplayer.pntqggs.mongodb.net/tash_multiplayer_db?retryWrites=true&w=majority";

mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ MongoDB Connection Error:", err));

// JWT secret
const JWT_SECRET = "your_jwt_secret_here"; // Change this in production

// In-memory Users (or you can move to DB)
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

  // create wallet entry
  try {
    const wallet = new Wallet({ username });
    await wallet.save();
  } catch(err){ console.log(err.message) }

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
  } catch(err) { return res.status(401).json({ message: "Invalid token" }); }
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
  } catch(err) { return res.status(401).json({ message: "Invalid token" }); }
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
  } catch(err) { return res.status(401).json({ message: "Invalid token" }); }
});

// --- SOCKET.IO ---
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.serverState = io.serverState || { roomCreators: {} };

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

  socket.on('playCard', ({ room, card, username }) => {
    io.to(room).emit('cardPlayed', { username, card });
  });

  socket.on('disconnect', () => {
    console.log('🔴 Player disconnected:', socket.id);
  });
});

// --- DECK HELPERS ---
function createDeck() {
  const suits = ['♠','♥','♦','♣'];
  const ranks = ['9','10','J','Q','K','A'];
  const deck = [];
  suits.forEach(s => ranks.forEach(r => deck.push({ suit: s, rank: r })));
  return deck;
}
function shuffle(deck) {
  for(let i = deck.length-1; i>0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [deck[i],deck[j]]=[deck[j],deck[i]];
  }
  return deck;
}

app.get('/', (req,res)=>res.send("🚀 Server running"));

const PORT = process.env.PORT || 5000;
server.listen(PORT, ()=>console.log(`🌍 Server running on port ${PORT}`));
