// server.js
const mongoose = require('mongoose');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Routes import
const authRoutes = require('./backend/controllers/authController');
const walletRoutes = require('./routes/walletRoutes');

const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);

// MongoDB Connection
// If password has special chars, URL-encode them (e.g. @ -> %40)
const mongoURI = "mongodb+srv://textilevikhyat_db_user:005WZZly6iIDC8KQ@tash-multyplayer.pntqggs.mongodb.net/tash_multiplayer_db?retryWrites=true&w=majority";

mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ MongoDB Connection Error:", err));

// HTTP + Socket.io setup
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 5000;

/**
 * In-memory server state.
 * - roomCreators: { [roomName]: socketId }
 *
 * Note: This is volatile (resets when server restarts). For production, persist to DB/Redis.
 */
io.serverState = io.serverState || { roomCreators: {} };

// --- socket / game logic ---
io.on('connection', (socket) => {
  console.log('🟢 New player connected:', socket.id);

  // Player joins a room (expects { room, username } from client)
  socket.on('joinRoom', ({ room, username }) => {
    if (!room) return socket.emit('errorMessage', { message: 'Room missing' });

    socket.join(room);
    socket.data.username = username || 'Anonymous';

    // set creator if none
    const serverState = io.serverState;
    if (!serverState.roomCreators[room]) {
      serverState.roomCreators[room] = socket.id;
    }

    // build players list
    const socketsInRoom = Array.from(io.sockets.adapter.rooms.get(room) || []);
    const players = socketsInRoom.map(id => {
      const s = io.sockets.sockets.get(id);
      return { id, username: s?.data?.username || 'Unknown' };
    });

    // notify room of update
    io.to(room).emit('roomUpdate', { players, room, creatorId: serverState.roomCreators[room] });
    console.log(`${socket.data.username} joined room ${room}`);
  });

  // Start game (only creator should call this)
  socket.on('startGame', (room) => {
    if (!room) return socket.emit('errorMessage', { message: 'Room missing' });

    const serverState = io.serverState;
    const creatorId = serverState.roomCreators[room];
    if (creatorId !== socket.id) {
      socket.emit('errorMessage', { message: 'Only room creator can start the game.' });
      return;
    }

    const socketsInRoom = Array.from(io.sockets.adapter.rooms.get(room) || []);
    if (!socketsInRoom.length) {
      socket.emit('errorMessage', { message: 'No players in room.' });
      return;
    }

    // create and shuffle deck
    const deck = shuffle(createDeck());

    // deal 8 cards each up to 4 players
    const maxPlayers = Math.min(4, socketsInRoom.length);
    const hands = {};
    for (let i = 0; i < maxPlayers; i++) {
      const playerId = socketsInRoom[i];
      hands[playerId] = deck.slice(i * 8, (i + 1) * 8);
    }

    io.to(room).emit('gameStarted', { hands });
    console.log(`Game started in room ${room}. Hands dealt to ${maxPlayers} players.`);
  });

  // Player leaves room explicitly
  socket.on('leaveRoom', (room) => {
    if (!room) return;
    socket.leave(room);

    // update players list for that room
    const socketsInRoom = Array.from(io.sockets.adapter.rooms.get(room) || []);
    const players = socketsInRoom.map(id => {
      const s = io.sockets.sockets.get(id);
      return { id, username: s?.data?.username || 'Unknown' };
    });

    // if creator left, reassign creator (first socket) or delete
    const serverState = io.serverState;
    if (serverState.roomCreators[room] === socket.id) {
      serverState.roomCreators[room] = socketsInRoom.length ? socketsInRoom[0] : undefined;
    }

    io.to(room).emit('roomUpdate', { players, room, creatorId: serverState.roomCreators[room] });
    console.log(`${socket.id} left room ${room}`);
  });

  // On disconnect, update any rooms the socket was part of
  socket.on('disconnect', () => {
    const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
    const serverState = io.serverState;

    rooms.forEach(room => {
      // remove socket from room and update players list
      const socketsInRoom = Array.from(io.sockets.adapter.rooms.get(room) || []);
      const players = socketsInRoom.map(id => {
        const s = io.sockets.sockets.get(id);
        return { id, username: s?.data?.username || 'Unknown' };
      });

      // if disconnecting socket was creator, reassign
      if (serverState.roomCreators[room] === socket.id) {
        serverState.roomCreators[room] = socketsInRoom.length ? socketsInRoom[0] : undefined;
      }

      io.to(room).emit('roomUpdate', { players, room, creatorId: serverState.roomCreators[room] });
    });

    console.log('🔴 Player disconnected:', socket.id);
  });
});

// Utility functions (deck)
function createDeck() {
  // Using 24-card deck (9,10,J,Q,K,A) x 4 suits - common in 29 variants
  const suits = ['♠','♥','♦','♣'];
  const ranks = ['9','10','J','Q','K','A'];
  const deck = [];
  for (const s of suits) {
    for (const r of ranks) {
      deck.push({ suit: s, rank: r, code: `${r}${s}` });
    }
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

app.get('/', (req, res) => res.send('🚀 Server is running successfully!'));

server.listen(PORT, () => console.log(`🌍 Server running on port ${PORT}`));
