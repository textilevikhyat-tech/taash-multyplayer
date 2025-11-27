import React, { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";

// connect to same origin
const socket = io("/", { transports: ["websocket"] });

const suitGlyph = {
  H: "♥",
  D: "♦",
  S: "♠",
  C: "♣"
};

function cardColor(suit){
  return (suit === 'H' || suit === 'D') ? 'suit-red' : 'suit-black';
}

export default function Table({ username }){
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [myCards, setMyCards] = useState([]);
  const [log, setLog] = useState([]);
  const [trump, setTrump] = useState(null);
  const joined = useRef(false);

  useEffect(()=>{
    socket.on('connect', ()=> {
      addLog('Connected to server');
      if(!joined.current){
        socket.emit('quickJoin', { username });
        joined.current = true;
      }
    });

    socket.on('joinedRoom', (d)=>{
      setRoom(d.room);
      setPlayers(d.players || []);
      addLog('Joined room ' + d.room);
    });

    socket.on('roomUpdate', ({ room: r, players: pls } = {})=>{
      if(typeof r === 'undefined' && Array.isArray(arguments[0])){
        const arg = arguments[0];
        setPlayers(arg.players || arg);
      } else {
        if(r) setRoom(r);
        if(pls) setPlayers(pls);
      }
      addLog('Room updated');
    });

    socket.on('dealPrivate', ({ cards, matchId, trump })=>{
      // cards might be objects; map to id string
      const list = (cards||[]).map(c => (typeof c === 'string' ? c : c.id));
      setMyCards(list);
      setTrump(trump);
      addLog('Cards dealt');
    });

    socket.on('matchStart', (d)=>{
      setTrump(d.trump || trump);
      addLog('Match started');
    });

    socket.on('cardPlayed', ({ username: who, card })=>{
      const id = typeof card === 'string' ? card : (card.id || (card.rank+card.suit));
      addLog(`${who} played ${id}`);
    });

    socket.on('trickWon', ({ winner })=>{
      addLog('Trick won by ' + winner);
    });

    socket.on('matchEnd', ({ declarerPoints, opponentPoints })=>{
      addLog(`Match ended — declarer: ${declarerPoints}, opponent: ${opponentPoints}`);
      setMyCards([]);
    });

    socket.on('errorMessage', ({ message })=>{
      addLog('Error: ' + message);
    });

    return ()=> socket.off();
  }, []);

  function addLog(txt){ setLog(l => [new Date().toLocaleTimeString() + " • " + txt, ...l].slice(0,80)); }

  function playCard(index){
    if(index < 0 || index >= myCards.length) return;
    const id = myCards[index];
    const rank = id.slice(0, id.length-1);
    const suit = id.slice(-1);
    socket.emit('playCard', { roomCode: room, card: { id, rank, suit } }, (res)=>{
      if(res && res.ok){
        setMyCards(prev => prev.filter((_,i)=>i!==index));
      } else {
        addLog('Play rejected: ' + (res && res.msg));
      }
    });
  }

  function createRoom(){
    const code = (Math.random().toString(36).slice(2,8)).toUpperCase();
    socket.emit('createRoom', { roomCode: code, username });
    addLog('Creating room ' + code);
  }
  function promptJoin(){
    const code = prompt('Enter room code:');
    if(code) socket.emit('joinRoom', { roomCode: code, username });
  }
  function startGame(){
    if(!room) return alert('Join or create a room first');
    socket.emit('startGame', room);
  }

  return (
    <div className="container">
      <div className="header">
        <div>
          <div className="title">Taash Multiplayer — Casino Style</div>
          <div className="small">User: <strong>{username}</strong> • Room: <strong>{room || "-"}</strong></div>
        </div>
        <div style={{display:'flex',gap:10}}>
          <button className="btn" onClick={createRoom}>Create</button>
          <button className="btn" onClick={promptJoin}>Join</button>
          <button className="btn" onClick={startGame}>Start</button>
        </div>
      </div>

      <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
        <div style={{flex:1}} className="panel">
          <div className="table-area">
            <div className="table-center">TABLE • TRUMP: <span style={{marginLeft:8,fontWeight:900}}>{trump || '-'}</span></div>
          </div>

          <div className="players-row">
            {Array.from({length:4}).map((_,i)=>{
              const p = players[i];
              return (
                <div key={i} className="player-box">
                  <div className="player-name">{p ? p.name : 'Waiting...'}</div>
                  <div className="player-sub">{p ? (p.isBot ? 'Bot' : 'Human') : ''}</div>
                </div>
              );
            })}
          </div>

          <div style={{marginTop:12}}>
            <h4>Your Hand</h4>
            <div className="cards">
              {myCards.length ? myCards.map((c, i) => {
                const rank = c.slice(0, c.length-1);
                const suit = c.slice(-1);
                return (
                  <div key={c+i} className="card" onClick={()=>playCard(i)}>
                    <div className={"top "+cardColor(suit)}>{rank}</div>
                    <div className={"center "+cardColor(suit)} style={{fontSize:28}}>{suitGlyph[suit]}</div>
                    <div className={"bottom "+cardColor(suit)} style={{textAlign:'right'}}>{rank}</div>
                  </div>
                );
              }) : <div className="small">No cards yet — wait for deal</div>}
            </div>
          </div>

          <div style={{marginTop:12}} className="log panel">
            <h4>Log</h4>
            <div className="log">
              {log.map((l,i)=><div key={i} className="small">{l}</div>)}
            </div>
          </div>
        </div>

        <div style={{width:320}} className="panel">
          <h4>Players</h4>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {players.length ? players.map(p=>
              <div key={p.id} style={{display:'flex',justifyContent:'space-between',padding:8,background:'rgba(255,255,255,0.02)',borderRadius:6}}>
                <div>{p.name}</div><div className="small">{p.isBot ? 'Bot' : 'Human'}</div>
              </div>
            ) : <div className="small">No players yet</div>}
          </div>

          <hr style={{margin:'12px 0',borderTop:'1px solid rgba(255,255,255,0.03)'}}/>

          <div className="small">Auto-fill bots in ~3s if seats empty. Click card to play. Bots play automatically.</div>
          <div style={{marginTop:10,display:'flex',gap:8}}>
            <button className="btn" onClick={()=>socket.emit('quickJoin',{username})}>Quick Join</button>
            <button className="btn" onClick={()=>socket.emit('startGame', room)}>Force Start</button>
          </div>
        </div>
      </div>
    </div>
  );
}
