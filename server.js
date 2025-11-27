// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 5000;

/* ----------------- simple card utils ----------------- */
const SUITS = ['H','D','S','C']; // H=Hearts, D=Diamonds, S=Spades, C=Clubs
const RANKS = ['J','9','A','10','K','Q','8','7'];
const CARD_ORDER = { J:8, 9:7, A:6, "10":5, K:4, Q:3, 8:2, 7:1 };

function makeDeck(){
  const d = [];
  for(const s of SUITS) for(const r of RANKS) d.push({ id: r + s, rank: r, suit: s });
  return d;
}
function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
}
function resolveTrick(trick, trump){
  // trick: [{playerId, card}] ; trump like 'H'
  const lead = trick[0].card.suit;
  const trumpPlayed = trick.filter(t=>t.card.suit===trump);
  const candidates = trumpPlayed.length ? trumpPlayed : trick.filter(t=>t.card.suit===lead);
  candidates.sort((a,b)=> CARD_ORDER[b.card.rank] - CARD_ORDER[a.card.rank]);
  return candidates[0]; // winner entry
}

/* ----------------- in-memory rooms -----------------
   We'll keep a single "auto" room per server to simplify:
   roomCode -> { players:[{id,name,isBot,socketId}], status, match }
*/
const rooms = {}; // many rooms possible
function makeBot(){
  return { id: 'bot-'+crypto.randomBytes(3).toString('hex'), name: 'Bot', isBot:true, socketId: null };
}
function findOpenRoom(){
  for(const code of Object.keys(rooms)){
    const r = rooms[code];
    if(r.status==='waiting' && r.players.length<4) return code;
  }
  return null;
}

/* ---------------- Socket handling ---------------- */
io.on('connection', socket => {
  console.log('🟢 connected', socket.id);

  // Quick join: auto-match into a waiting room (or create)
  socket.on('quickJoin', ({ username }) => {
    socket.data.username = username || ('Guest'+Math.floor(Math.random()*10000));
    let code = findOpenRoom();
    if(!code){
      code = crypto.randomBytes(3).toString('hex');
      rooms[code] = { players: [], status: 'waiting', autoTimer: null };
    }

    const r = rooms[code];
    // avoid duplicate same socket
    if(!r.players.find(p=>p.id===socket.id)){
      r.players.push({ id: socket.id, name: socket.data.username, isBot:false, socketId: socket.id });
      socket.join(code);
    }

    // emit update
    io.to(code).emit('roomUpdate', { room: code, players: r.players });

    // if 4 players start immediately, else set auto-fill timer
    if(r.players.length >= 4){
      startMatch(code);
      return socket.emit('joinedRoom', { room: code, players: r.players });
    }
    // clear existing timer
    if(r.autoTimer) clearTimeout(r.autoTimer);
    r.autoTimer = setTimeout(()=>{
      // fill bots
      while(r.players.length < 4) r.players.push(makeBot());
      io.to(code).emit('roomUpdate', { room: code, players: r.players });
      startMatch(code);
    }, 3000); // 3 seconds to allow other humans to join

    socket.emit('joinedRoom', { room: code, players: r.players });
  });

  // explicit create/join optionally supported
  socket.on('createRoom', ({ roomCode, username })=>{
    socket.data.username = username || socket.data.username || ('Guest'+Math.floor(Math.random()*10000));
    const code = (roomCode || crypto.randomBytes(3).toString('hex')).toUpperCase();
    if(rooms[code]) return socket.emit('errorMessage', { message: 'Room exists' });
    rooms[code] = { players: [], status:'waiting', autoTimer: null };
    rooms[code].players.push({ id: socket.id, name: socket.data.username, isBot:false, socketId: socket.id });
    socket.join(code);
    io.to(code).emit('roomCreated', { room: code, players: rooms[code].players });
  });

  socket.on('joinRoom', ({ roomCode, username })=>{
    socket.data.username = username || socket.data.username || ('Guest'+Math.floor(Math.random()*10000));
    const code = roomCode;
    if(!rooms[code]) return socket.emit('errorMessage', { message: 'Room not found' });
    const r = rooms[code];
    if(!r.players.find(p=>p.id===socket.id)){
      r.players.push({ id: socket.id, name: socket.data.username, isBot:false, socketId: socket.id});
      socket.join(code);
    }
    io.to(code).emit('roomUpdate', { room: code, players: r.players });
    if(r.players.length >= 4){
      startMatch(code);
    } else {
      // auto-fill later
      if(r.autoTimer) clearTimeout(r.autoTimer);
      r.autoTimer = setTimeout(()=>{
        while(r.players.length < 4) r.players.push(makeBot());
        io.to(code).emit('roomUpdate', { room: code, players: r.players });
        startMatch(code);
      }, 3000);
    }
  });

  // startGame explicit (fills bots and starts)
  socket.on('startGame', roomCode =>{
    const r = rooms[roomCode];
    if(!r) return socket.emit('errorMessage', { message: 'Room not found' });
    while(r.players.length < 4) r.players.push(makeBot());
    startMatch(roomCode);
  });

  // client plays a card
  socket.on('playCard', ({ roomCode, card }, cb) => {
    try {
      const r = rooms[roomCode];
      if(!r || !r.match) return cb && cb({ ok:false, msg: 'No match' });
      const m = r.match;
      const playerId = socket.id;
      // find player's hand
      const hand = m.hands[playerId] || [];
      // card may be id string or object {id,rank,suit}
      const cardId = typeof card === 'string' ? card : (card.id || (card.rank+card.suit));
      const idx = hand.findIndex(c => c.id === cardId);
      if(idx === -1){
        return cb && cb({ ok:false, msg:'Card not in hand' });
      }
      const played = hand.splice(idx,1)[0];
      m.currentTrick.push({ playerId, card: played });
      io.to(roomCode).emit('cardPlayed', { username: socket.data.username || playerId, card: played });

      // advance: if trick complete
      if(m.currentTrick.length === m.playerOrder.length){
        const winnerEntry = resolveTrick(m.currentTrick, m.trump);
        const winnerId = winnerEntry.playerId;
        // assign trick cards to winner team arrays
        const team = m.teams.declarer.includes(winnerId) ? 'declarerTeamCards' : 'opponentTeamCards';
        for(const t of m.currentTrick) m.scores[team].push(t.card);
        m.trickHistory.push({ trick: m.currentTrick.slice(), winner: winnerId });
        m.currentTrick = [];
        m.turnIndex = m.playerOrder.indexOf(winnerId);
        io.to(roomCode).emit('trickWon', { winner: winnerId });
      } else {
        m.turnIndex = (m.turnIndex + 1) % m.playerOrder.length;
      }

      // if all hands empty -> match end
      const allEmpty = Object.values(m.hands).every(h => Array.isArray(h) ? h.length === 0 : true);
      if(allEmpty){
        // compute simple points (by card ranks points: J=3,9=2,A=1,10=1)
        const points = pts => pts.reduce((s,c)=>{
          if(c.rank==='J') return s+3;
          if(c.rank==='9') return s+2;
          if(c.rank==='A' || c.rank==='10') return s+1;
          return s;
        },0);
        const decPts = points(m.scores.declarerTeamCards);
        const oppPts = points(m.scores.opponentTeamCards);
        io.to(roomCode).emit('matchEnd', { declarerPoints: decPts, opponentPoints: oppPts });
        r.status = 'waiting';
        delete r.match;
      } else {
        // trigger bots if next players bots
        setTimeout(()=> runBotTurns(roomCode), 250);
      }

      cb && cb({ ok:true });
    } catch(e){
      console.error('playCard error', e);
      cb && cb({ ok:false, msg:'server error' });
    }
  });

  socket.on('disconnect', ()=>{
    console.log('🔴 disconnected', socket.id);
    // remove from rooms
    for(const code of Object.keys(rooms)){
      const r = rooms[code];
      const idx = r.players.findIndex(p=>p.id===socket.id);
      if(idx !== -1){
        r.players.splice(idx,1);
        io.to(code).emit('roomUpdate', { room: code, players: r.players });
      }
    }
  });
});

/* ----------------- startMatch and bots -------------- */
function startMatch(roomCode){
  const r = rooms[roomCode];
  if(!r) return;
  if(r.autoTimer){ clearTimeout(r.autoTimer); r.autoTimer = null; }
  r.status = 'playing';

  // ensure 4 players
  while(r.players.length < 4) r.players.push(makeBot());

  // build deck and deal 8 each
  const deck = makeDeck();
  shuffle(deck);
  const hands = {};
  for(const p of r.players) hands[p.id] = [];
  let idx = 0;
  while(deck.length && Object.values(hands).some(h=>h.length<8)){
    const pid = r.players[idx % r.players.length].id;
    if(hands[pid].length < 8) hands[pid].push(deck.shift());
    idx++;
  }
  // player order and teams
  const playerOrder = r.players.map(p=>p.id);
  const teams = { declarer: [playerOrder[0], playerOrder[2]], opponent: [playerOrder[1], playerOrder[3]] };

  // simple default trump (first player's first card suit) or random
  const trump = (hands[playerOrder[0]][0] && hands[playerOrder[0]][0].suit) || 'H';

  const match = {
    id: crypto.randomBytes(6).toString('hex'),
    hands,
    playerOrder,
    turnIndex: 0,
    currentTrick: [],
    trickHistory: [],
    teams,
    trump,
    scores: { declarerTeamCards: [], opponentTeamCards: [] }
  };
  r.match = match;

  // send private deals
  for(const p of r.players){
    if(!p.isBot && p.socketId){
      const s = io.sockets.sockets.get(p.socketId);
      if(s){
        s.emit('dealPrivate', { cards: hands[p.id], matchId: match.id, trump });
      }
    }
  }

  // emit matchStart + hands for debugging (hands keyed by id and by name)
  const handsPayload = {};
  for(const p of r.players){
    handsPayload[p.id] = (hands[p.id] || []).map(c=>c.id);
    handsPayload[p.name] = handsPayload[p.id];
  }
  io.to(roomCode).emit('matchStart', { matchId: match.id, players: r.players, trump, hands: handsPayload });

  // if first players are bots — let them act
  setTimeout(()=> runBotTurns(roomCode), 300);
}

/* run bots until next human turn */
function runBotTurns(roomCode){
  const r = rooms[roomCode];
  if(!r || !r.match) return;
  const m = r.match;
  const currId = m.playerOrder[m.turnIndex];
  const p = r.players.find(x=>x.id===currId);
  if(p && p.isBot){
    // choose a valid card (follow suit if possible)
    const hand = m.hands[currId];
    if(!hand || hand.length===0){
      m.turnIndex = (m.turnIndex + 1) % m.playerOrder.length;
      return setTimeout(()=> runBotTurns(roomCode), 150);
    }
    const leadSuit = m.currentTrick.length ? m.currentTrick[0].card.suit : null;
    let valid = hand;
    if(leadSuit){
      const follow = hand.filter(c=>c.suit===leadSuit);
      if(follow.length) valid = follow;
    }
    const choice = valid[Math.floor(Math.random()*valid.length)];
    // remove from hand
    const i = hand.findIndex(c=>c.id===choice.id);
    if(i!==-1) hand.splice(i,1);
    m.currentTrick.push({ playerId: currId, card: choice });
    io.to(roomCode).emit('cardPlayed', { username: p.name, card: choice });
    // advance
    if(m.currentTrick.length === m.playerOrder.length){
      const winnerEntry = resolveTrick(m.currentTrick, m.trump);
      const winnerId = winnerEntry.playerId;
      const team = m.teams.declarer.includes(winnerId) ? 'declarerTeamCards' : 'opponentTeamCards';
      for(const t of m.currentTrick) m.scores[team].push(t.card);
      m.trickHistory.push({ trick: m.currentTrick.slice(), winner: winnerId });
      m.currentTrick = [];
      m.turnIndex = m.playerOrder.indexOf(winnerId);
      io.to(roomCode).emit('trickWon', { winner: winnerId });
    } else {
      m.turnIndex = (m.turnIndex + 1) % m.playerOrder.length;
    }

    // continue short delay
    setTimeout(()=> runBotTurns(roomCode), 250);
  } else {
    // next is human — emit turnRequest if you want
    io.to(roomCode).emit('turnRequest', { playerId: currId });
  }
}

/* serve frontend build if exists */
const FE = path.join(__dirname, 'frontend', 'dist');
if(fs.existsSync(FE)) app.use(express.static(FE));
app.get('*', (req,res)=>{
  if(fs.existsSync(path.join(FE,'index.html'))) return res.sendFile(path.join(FE,'index.html'));
  res.status(200).send('Taash server running');
});

server.listen(PORT, ()=> console.log('🚀 Server listening on', PORT));
