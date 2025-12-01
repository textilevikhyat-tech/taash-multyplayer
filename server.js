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

/* ---- simple card utils ---- */
const SUITS = ['H','D','S','C'];
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
  const lead = trick[0].card.suit;
  const trumpPlayed = trick.filter(t=>t.card.suit===trump);
  const candidates = trumpPlayed.length ? trumpPlayed : trick.filter(t=>t.card.suit===lead);
  candidates.sort((a,b)=> CARD_ORDER[b.card.rank] - CARD_ORDER[a.card.rank]);
  return candidates[0]; // winner entry
}
function cardPoints(c){
  if(!c) return 0;
  if(c.rank === 'J') return 3;
  if(c.rank === '9') return 2;
  if(c.rank === 'A' || c.rank === '10') return 1;
  return 0;
}

/* ---- rooms & helper ---- */
const rooms = {};
function makeBot(){
  return { id: 'bot-'+crypto.randomBytes(3).toString('hex'), name: 'Bot', isBot:true, socketId: null };
}
function findOpenRoom(){
  for(const code of Object.keys(rooms)){
    const r = rooms[code];
    if(r.status==='waiting' && r.players.length < 4) return code;
  }
  return null;
}
function getSocket(id){ return io.sockets.sockets.get(id); }

/* ---- emit full game state helper ----
   gameState includes:
     - players (id,name,isBot)
     - handsSizes: { playerId: number } (so other clients see only sizes)
     - yourHand (sent privately via dealPrivate)
     - playedCards (current trick array)
     - scores (points collected)
     - currentTurnId, trump, matchId
*/
function emitGameState(roomCode){
  const r = rooms[roomCode];
  if(!r || !r.match) return;
  const m = r.match;
  const players = r.players.map(p => ({ id: p.id, name: p.name, isBot: !!p.isBot }));
  const handsSizes = {};
  for(const p of r.players) handsSizes[p.id] = (m.hands[p.id] || []).length;

  // compute scores per player (sum of cardPoints in scores arrays grouped by owner team)
  const scores = {};
  for(const p of r.players) scores[p.id] = 0;
  // m.scores stores trick cards in declarerTeamCards/opponentTeamCards arrays; we don't know owner per card
  // For simple per-player scoreboard we'll calculate team totals and assign evenly to team members for display
  const teamDec = m.teams.declarer;
  const teamOpp = m.teams.opponent;
  const decPoints = (m.scores.declarerTeamCards || []).reduce((s,c)=>s+cardPoints(c),0);
  const oppPoints = (m.scores.opponentTeamCards || []).reduce((s,c)=>s+cardPoints(c),0);
  // assign team totals evenly
  teamDec.forEach(id => scores[id] = Math.floor(decPoints / teamDec.length));
  teamOpp.forEach(id => scores[id] = Math.floor(oppPoints / teamOpp.length));

  const payload = {
    matchId: m.id,
    players,
    handsSizes,
    playedCards: m.currentTrick.map(t => ({ playerId: t.playerId, card: t.card })),
    scores,
    currentTurnId: m.playerOrder[m.turnIndex],
    trump: m.trump,
  };

  io.to(roomCode).emit('gameState', payload);

  // also emit players list separately
  io.to(roomCode).emit('roomPlayers', { players });
}

/* ---- socket handlers ---- */
io.on('connection', socket=>{
  console.log('🟢 connected', socket.id);

  // QUICK JOIN
  socket.on('quickJoin', ({ username })=>{
    socket.data.username = username || ('Guest' + Math.floor(Math.random()*10000));
    let code = findOpenRoom();
    if(!code){
      code = crypto.randomBytes(3).toString('hex').toUpperCase();
      rooms[code] = { players: [], status: 'waiting', autoTimer: null };
    }
    const r = rooms[code];
    // prevent duplicate
    if(!r.players.find(p=>p.id===socket.id)){
      r.players.push({ id: socket.id, name: socket.data.username, isBot:false, socketId: socket.id });
      socket.join(code);
    }
    io.to(code).emit('roomUpdate', { room: code, players: r.players });

    if(r.players.length >= 4){
      startMatch(code);
      socket.emit('joinedRoom', { room: code, players: r.players });
      return;
    }
    if(r.autoTimer) clearTimeout(r.autoTimer);
    r.autoTimer = setTimeout(()=>{
      while(r.players.length < 4) r.players.push(makeBot());
      io.to(code).emit('roomUpdate', { room: code, players: r.players });
      startMatch(code);
    }, 3000);

    socket.emit('joinedRoom', { room: code, players: r.players });
  });

  socket.on('createRoom', ({ roomCode, username })=>{
    socket.data.username = username || socket.data.username || ('Guest' + Math.floor(Math.random()*10000));
    const code = (roomCode || crypto.randomBytes(3).toString('hex')).toUpperCase();
    if(rooms[code]) return socket.emit('errorMessage', { message: 'Room exists' });
    rooms[code] = { players: [], status:'waiting', autoTimer: null };
    rooms[code].players.push({ id: socket.id, name: socket.data.username, isBot:false, socketId: socket.id });
    socket.join(code);
    io.to(code).emit('roomCreated', { room: code, players: rooms[code].players });
  });

  socket.on('joinRoom', ({ roomCode, username })=>{
    socket.data.username = username || socket.data.username || ('Guest' + Math.floor(Math.random()*10000));
    if(!rooms[roomCode]) return socket.emit('errorMessage', { message: 'Room not found' });
    const r = rooms[roomCode];
    if(!r.players.find(p=>p.id===socket.id)){
      r.players.push({ id: socket.id, name: socket.data.username, isBot:false, socketId: socket.id });
      socket.join(roomCode);
    }
    io.to(roomCode).emit('roomUpdate', { room: roomCode, players: r.players });
    if(r.players.length >= 4) startMatch(roomCode);
    else {
      if(r.autoTimer) clearTimeout(r.autoTimer);
      r.autoTimer = setTimeout(()=>{
        while(r.players.length < 4) r.players.push(makeBot());
        io.to(roomCode).emit('roomUpdate', { room: roomCode, players: r.players });
        startMatch(roomCode);
      }, 3000);
    }
  });

  socket.on('startGame', roomCode=>{
    const r = rooms[roomCode];
    if(!r) return socket.emit('errorMessage', { message: 'Room not found' });
    while(r.players.length < 4) r.players.push(makeBot());
    startMatch(roomCode);
  });

  // playCard
  socket.on('playCard', ({ roomCode, card }, cb)=>{
    try{
      const r = rooms[roomCode];
      if(!r || !r.match) return cb && cb({ ok:false, msg:'No match' });
      const m = r.match;
      const playerId = socket.id;
      const hand = m.hands[playerId] || [];
      const cardId = typeof card === 'string' ? card : (card.id || (card.rank+card.suit));
      const idx = hand.findIndex(c => c.id === cardId);
      if(idx === -1) return cb && cb({ ok:false, msg:'Card not in hand' });
      const played = hand.splice(idx, 1)[0];
      m.currentTrick.push({ playerId, card: played });

      // emit cardPlayed immediately for UI
      io.to(roomCode).emit('cardPlayed', { username: socket.data.username || playerId, playerId, card: played });

      // if trick complete -> resolve
      if(m.currentTrick.length === m.playerOrder.length){
        const winnerEntry = resolveTrick(m.currentTrick, m.trump);
        const winnerId = winnerEntry.playerId;
        const teamKey = m.teams.declarer.includes(winnerId) ? 'declarerTeamCards' : 'opponentTeamCards';
        for(const t of m.currentTrick) m.scores[teamKey].push(t.card);
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
        // emit match end with team points
        const decPts = (m.scores.declarerTeamCards || []).reduce((s,c)=>s+cardPoints(c),0);
        const oppPts = (m.scores.opponentTeamCards || []).reduce((s,c)=>s+cardPoints(c),0);
        io.to(roomCode).emit('matchEnd', { declarerPoints: decPts, opponentPoints: oppPts });
        r.status = 'waiting';
        delete r.match;
      } else {
        // continue with bots if next players are bots
        setTimeout(()=> runBotTurns(roomCode), 200);
      }

      // broadcast updated gameState
      emitGameState(roomCode);

      return cb && cb({ ok:true });
    }catch(e){
      console.error('playCard error', e);
      return cb && cb({ ok:false, msg:'Server error' });
    }
  });

  socket.on('disconnect', ()=>{
    console.log('🔴 disconnected', socket.id);
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

/* ---- startMatch ---- */
function startMatch(roomCode){
  const r = rooms[roomCode];
  if(!r) return;
  if(r.autoTimer){ clearTimeout(r.autoTimer); r.autoTimer = null; }
  r.status = 'playing';
  while(r.players.length < 4) r.players.push(makeBot());

  const deck = makeDeck();
  shuffle(deck);

  const hands = {};
  for(const p of r.players) hands[p.id] = [];
  let idx = 0;
  while(deck.length && Object.values(hands).some(h=>h.length < 8)){
    const pid = r.players[idx % r.players.length].id;
    if(hands[pid].length < 8) hands[pid].push(deck.shift());
    idx++;
  }

  const playerOrder = r.players.map(p => p.id);
  const teams = { declarer: [playerOrder[0], playerOrder[2]], opponent: [playerOrder[1], playerOrder[3]] };
  const trump = (hands[playerOrder[0]] && hands[playerOrder[0]][0] && hands[playerOrder[0]][0].suit) || 'H';

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

  // send private hand to each real socket
  for(const p of r.players){
    if(!p.isBot && p.socketId){
      const s = getSocket(p.socketId);
      if(s) s.emit('dealPrivate', { cards: hands[p.id], matchId: match.id, trump });
    }
  }

  // broadcast game start and initial state
  emitGameState(roomCode);
  io.to(roomCode).emit('matchStart', { matchId: match.id, players: r.players, trump, hands: Object.fromEntries(r.players.map(p=>[p.id, (hands[p.id]||[]).map(c=>c.id)])) });

  // start bot play if first players are bots
  setTimeout(()=> runBotTurns(roomCode), 300);
}

/* ---- run bots ---- */
function runBotTurns(roomCode){
  const r = rooms[roomCode];
  if(!r || !r.match) return;
  const m = r.match;
  const currId = m.playerOrder[m.turnIndex];
  const p = r.players.find(x=>x.id===currId);
  if(p && p.isBot){
    // bot selects a valid card
    const hand = m.hands[currId];
    if(!hand || hand.length === 0){
      m.turnIndex = (m.turnIndex + 1) % m.playerOrder.length;
      return setTimeout(()=> runBotTurns(roomCode), 150);
    }
    const lead = m.currentTrick.length ? m.currentTrick[0].card.suit : null;
    let valid = hand;
    if(lead){
      const follow = hand.filter(c => c.suit === lead);
      if(follow.length) valid = follow;
    }
    const choice = valid[Math.floor(Math.random()*valid.length)];
    // remove
    const i = hand.findIndex(c => c.id === choice.id);
    if(i !== -1) hand.splice(i,1);
    m.currentTrick.push({ playerId: currId, card: choice });
    io.to(roomCode).emit('cardPlayed', { username: p.name, playerId: currId, card: choice });

    // resolve trick if complete
    if(m.currentTrick.length === m.playerOrder.length){
      const winnerEntry = resolveTrick(m.currentTrick, m.trump);
      const winnerId = winnerEntry.playerId;
      const teamKey = m.teams.declarer.includes(winnerId) ? 'declarerTeamCards' : 'opponentTeamCards';
      for(const t of m.currentTrick) m.scores[teamKey].push(t.card);
      m.trickHistory.push({ trick: m.currentTrick.slice(), winner: winnerId });
      m.currentTrick = [];
      m.turnIndex = m.playerOrder.indexOf(winnerId);
      io.to(roomCode).emit('trickWon', { winner: winnerId });
    } else {
      m.turnIndex = (m.turnIndex + 1) % m.playerOrder.length;
    }

    // emit updated state
    emitGameState(roomCode);

    // continue
    setTimeout(()=> runBotTurns(roomCode), 250);
  } else {
    // next is human — emit turnRequest so client UI can show "your turn"
    io.to(roomCode).emit('turnRequest', { playerId: currId });
  }
}

/* ---- static front serve fallback ---- */
const FE = path.join(__dirname, 'frontend', 'dist');
if(fs.existsSync(FE)) app.use(express.static(FE));
app.get('*', (req,res)=>{
  if(fs.existsSync(path.join(FE,'index.html'))) return res.sendFile(path.join(FE,'index.html'));
  return res.sendFile(path.join(__dirname,'public','index.html'));
});

server.listen(PORT, ()=> console.log('🚀 Server listening on', PORT));
