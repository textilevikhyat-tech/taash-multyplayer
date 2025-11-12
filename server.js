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
// Special characters in password must be URL-encoded (%40 for @)
const mongoURI = "mongodb+srv://textilevikhyat_db_user:bittuboss%409560@tash-multyplayer.pntqggs.mongodb.net/tash_multiplayer_db?retryWrites=true&w=majority";

mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ MongoDB Connection Error:", err));

// Socket.io setup
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 5000;

io.on('connection', (socket) => {
  console.log('🟢 New player connected:', socket.id);

  socket.on('joinGame', (room, username) => {
    socket.join(room);
    io.to(room).emit('playerJoined', { username });
    console.log(`${username} joined room ${room}`);
  });

  socket.on('disconnect', () => {
    console.log('🔴 Player disconnected:', socket.id);
  });
});

app.get('/', (req, res) => res.send('🚀 Server is running successfully!'));

server.listen(PORT, () => console.log(`🌍 Server running on port ${PORT}`));
