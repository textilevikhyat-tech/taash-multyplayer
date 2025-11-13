const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Models
const User = require('./models/User'); // create models/User.js
const Wallet = require('./models/Wallet'); // create models/Wallet.js

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 5000;
const JWT_SECRET = "supersecretkey123"; // change in production

// ---------------- MONGODB ----------------
const mongoURI = "mongodb+srv://textilevikhyat_db_user:005WZZly6iIDC8KQ@tash-multyplayer.pntqggs.mongodb.net/tash_multiplayer_db?retryWrites=true&w=majority";
mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=>console.log("✅ MongoDB Connected"))
  .catch(err=>console.log("❌ MongoDB Error:", err));

// ---------------- MODELS ----------------
// User + Wallet schemas
// create models/User.js
// create models/Wallet.js

// ---------------- AUTH ROUTES ----------------
app.post('/api/auth/register', async(req,res)=>{
  const {username,password}=req.body;
  if(!username||!password) return res.status(400).json({message:"Missing fields"});
  try{
    const exists = await User.findOne({username});
    if(exists) return res.status(400).json({message:"Username exists"});
    const hash = await bcrypt.hash(password,10);
    const user = new User({username,password:hash});
    await user.save();
    await Wallet.create({username,coins:100});
    res.status(201).json({message:"User registered", username:user.username});
  }catch(e){res.status(500).json({message:e.message})}
});

app.post('/api/auth/login', async(req,res)=>{
  const {username,password}=req.body;
  if(!username||!password) return res.status(400).json({message:"Missing fields"});
  try{
    const user = await User.findOne({username});
    if(!user) return res.status(400).json({message:"User not found"});
    const match = await bcrypt.compare(password,user.password);
    if(!match) return res.status(400).json({message:"Invalid password"});
    const token = jwt.sign({username:user.username},JWT_SECRET,{expiresIn:"1d"});
    res.json({token, username:user.username});
  }catch(e){res.status(500).json({message:e.message})}
});

// ---------------- WALLET ROUTES ----------------
const authMiddleware = (req,res,next)=>{
  const auth = req.headers.authorization;
  if(!auth) return res.status(401).json({message:"No token"});
  const token = auth.split(" ")[1];
  try{
    const payload = jwt.verify(token,JWT_SECRET);
    req.user = payload;
    next();
  }catch(e){return res.status(401).json({message:"Invalid token"})}
};

app.get('/api/wallet', authMiddleware, async(req,res)=>{
  const wallet = await Wallet.findOne({username:req.user.username});
  res.json({coins: wallet?.coins || 0});
});

app.post('/api/wallet/add', authMiddleware, async(req,res)=>{
  const {coins}=req.body;
  if(!coins) return res.status(400).json({message:"Missing coins"});
  const wallet = await Wallet.findOne({username:req.user.username});
  wallet.coins += coins;
  await wallet.save();
  res.json({coins:wallet.coins});
});

app.post('/api/wallet/deduct', authMiddleware, async(req,res)=>{
  const {coins}=req.body;
  if(!coins) return res.status(400).json({message:"Missing coins"});
  const wallet = await Wallet.findOne({username:req.user.username});
  wallet.coins -= coins;
  if(wallet.coins<0) wallet.coins=0;
  await wallet.save();
  res.json({coins:wallet.coins});
});

// ---------------- SOCKET.IO ----------------
io.serverState = io.serverState||{rooms:{}};

io.on('connection', socket=>{
  console.log("🟢 Player connected:", socket.id);

  socket.on('createRoom',({room,username})=>{
    if(!room) return;
    socket.join(room);
    io.serverState.rooms[room]={creator:socket.id,players:[{id:socket.id,username}]};
    io.to(room).emit('roomUpdate', io.serverState.rooms[room]);
  });

  socket.on('joinRoom',({room,username})=>{
    if(!room) return;
    socket.join(room);
    const r = io.serverState.rooms[room]||{players:[]};
    r.players.push({id:socket.id,username});
    io.serverState.rooms[room]=r;
    io.to(room).emit('roomUpdate',r);
  });

  socket.on('leaveRoom',room=>{
    socket.leave(room);
    const r = io.serverState.rooms[room];
    if(!r) return;
    r.players = r.players.filter(p=>p.id!==socket.id);
    if(r.creator===socket.id && r.players.length) r.creator=r.players[0].id;
    io.to(room).emit('roomUpdate',r);
  });

  socket.on('startGame', room=>{
    const r = io.serverState.rooms[room];
    if(!r) return;
    if(r.creator!==socket.id) return socket.emit('errorMessage',{message:"Only creator can start"});
    const deck = createDeck(); shuffle(deck);
    const hands = {};
    r.players.forEach((p,i)=>{
      hands[p.username]=deck.slice(i*8,(i+1)*8);
    });
    io.to(room).emit('gameStarted',{hands});
  });

  socket.on('placeBid',({room,username,amount})=>{
    const r = io.serverState.rooms[room];
    if(!r.bids) r.bids=[];
    r.bids.push({username,amount});
    const highest = r.bids.reduce((acc,b)=>b.amount>acc.amount?b:acc,{amount:0});
    r.highestBidder = highest.username; r.highestBid=highest.amount;
    io.to(room).emit('bidUpdate',{bidsArray:r.bids,highestBidder:r.highestBidder,highestBid:r.highestBid});
  });

  socket.on('playCard',({room,card,username})=>{
    io.to(room).emit('cardPlayed',{card,username});
  });

  socket.on('disconnect',()=>{
    Object.keys(io.serverState.rooms).forEach(room=>{
      const r = io.serverState.rooms[room];
      if(!r) return;
      r.players = r.players.filter(p=>p.id!==socket.id);
      if(r.creator===socket.id && r.players.length) r.creator=r.players[0]?.id;
      io.to(room).emit('roomUpdate',r);
    });
    console.log("🔴 Player disconnected", socket.id);
  });
});

// ---------- DECK ----------
function createDeck(){
  const suits=['♠','♥','♦','♣'], ranks=['9','10','J','Q','K','A'];
  const deck=[];
  suits.forEach(s=>ranks.forEach(r=>deck.push({rank:r,suit:s,code:r+s})));
  return deck;
}
function shuffle(deck){
  for(let i=deck.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [deck[i],deck[j]]=[deck[j],deck[i]];
  }
  return deck;
}

// ---------- START SERVER ----------
server.listen(PORT,()=>console.log(`🌍 Server running on ${PORT}`));
