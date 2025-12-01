// frontend/src/components/Table.jsx
import React, { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";

const socket = io("/", { transports: ["websocket"] });

const suitGlyph = { H: "♥", D: "♦", S: "♠", C: "♣" };
function cardColor(s){ return (s === 'H' || s === 'D') ? 'suit-red' : 'suit-black'; }

export default function Table({ username }) {
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [handsSizes, setHandsSizes] = useState({});
  const [myCards, setMyCards] = useState([]); // array of card objects {id,rank,suit}
  const [playedCards, setPlayedCards] = useState([]); // { playerId, card }
  const [scores, setScores] = useState({});
  const [currentTurnId, setCurrentTurnId] = useState(null);
  const [trump, setTrump] = useState(null);
  const [log, setLog] = useState([]);
  const joined = useRef(false);
  const mySocketId = useRef(null);

  useEffect(() => {
    socket.on("connect", () => {
      mySocketId.current = socket.id;
      setConnected(true);
      addLog("Connected to server: " + socket.id);
      // Quick join automatically once per mount
      if (!joined.current) {
        socket.emit("quickJoin", { username });
        joined.current = true;
      }
    });

    socket.on("joinedRoom", (d) => {
      setRoom(d.room);
      setPlayers(d.players || []);
      addLog(`Joined room ${d.room}`);
    });

    socket.on("roomUpdate", ({ room: r, players: pls }) => {
      if (r) setRoom(r);
      if (pls) setPlayers(pls);
      else if (Array.isArray(arguments[0])) setPlayers(arguments[0]);
      addLog("Room updated");
    });

    socket.on("roomPlayers", ({ players: pls }) => {
      if (pls) setPlayers(pls);
    });

    socket.on("dealPrivate", ({ cards, matchId, trump: t }) => {
      // cards may be objects; normalize to objects
      const normalized = (cards || []).map(c => (typeof c === 'string' ? { id: c, rank: c.slice(0, -1), suit: c.slice(-1) } : c));
      setMyCards(normalized);
      setTrump(t || null);
      addLog("You received private hand");
    });

    socket.on("gameState", (st) => {
      if (!st) return;
      setPlayedCards(st.playedCards || []);
      setHandsSizes(st.handsSizes || {});
      setScores(st.scores || {});
      setCurrentTurnId(st.currentTurnId || null);
      setTrump(st.trump || null);
      addLog("Game state updated");
    });

    socket.on("cardPlayed", ({ username: who, playerId, card }) => {
      addLog(`${who || playerId} played ${card.id || (card.rank + card.suit)}`);
    });

    socket.on("trickWon", ({ winner }) => {
      addLog("Trick won by " + winner);
    });

    socket.on("matchStart", (d) => {
      setTrump(d.trump || null);
      addLog("Match started");
    });

    socket.on("matchEnd", (d) => {
      addLog(`Match ended — declarer: ${d.declarerPoints}, opponent: ${d.opponentPoints}`);
      setMyCards([]);
    });

    socket.on("turnRequest", ({ playerId }) => {
      addLog(`Turn request for ${playerId}`);
    });

    socket.on("errorMessage", ({ message }) => {
      addLog("Error: " + message);
      alert(message);
    });

    return () => socket.off();
  }, []);

  function addLog(txt){ setLog(l => [new Date().toLocaleTimeString() + " • " + txt, ...l].slice(0,80)); }

  function playCard(index){
    if(index < 0 || index >= myCards.length) return;
    const c = myCards[index];
    socket.emit('playCard', { roomCode: room, card: c }, (res) => {
      if(res && res.ok){
        setMyCards(prev => prev.filter((_,i)=>i!==index));
        addLog('Played ' + c.id);
      } else {
        addLog('Play rejected: ' + (res && res.msg));
        if(res && res.msg) alert(res.msg);
      }
    });
  }

  function createRoom(){
    const code = (Math.random().toString(36).slice(2,8)).toUpperCase();
    socket.emit('createRoom', { roomCode: code, username });
    setRoom(code);
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
  function quickJoin(){ socket.emit('quickJoin', { username }); addLog('QuickJoin'); }

  return (
    <div style={{ padding: 12, color: "#ffffff", fontFamily: "Arial, sans-serif" }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div>
          <h2 style={{margin:0}}>Taash Multiplayer — Casino Style</h2>
          <div style={{fontSize:13}}>User: <b>{username}</b> • Room: <b>{room || "-"}</b></div>
        </div>
        <div style={{display:'flex', gap:8}}>
          <button onClick={createRoom}>Create</button>
          <button onClick={promptJoin}>Join</button>
          <button onClick={startGame}>Start</button>
          <button onClick={quickJoin}>Quick Join</button>
        </div>
      </div>

      <div style={{display:'flex', gap:12}}>
        <div style={{flex:1, background:'#0b0b0b', padding:12, borderRadius:8}}>
          <div style={{height:140, border:'1px dashed rgba(255,255,255,0.06)', borderRadius:6, padding:8, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column'}}>
            <div>TABLE CENTER</div>
            <div style={{marginTop:8}}>TRUMP: <b>{trump || "-"}</b></div>
            <div style={{marginTop:8}}>Current turn: <b>{currentTurnId === mySocketId.current ? "YOU" : (currentTurnId || "-")}</b></div>

            <div style={{marginTop:12, display:'flex', gap:8, flexWrap:'wrap', justifyContent:'center'}}>
              {playedCards.length ? playedCards.map((p,i)=> {
                const card = p.card;
                const id = card.id || (card.rank + card.suit);
                return (
                  <div key={i} style={{padding:6, border:'1px solid rgba(255,255,255,0.06)', borderRadius:6, minWidth:58, textAlign:'center'}}>
                    <div style={{fontSize:12}}>{p.playerId === mySocketId.current ? "You" : p.playerId}</div>
                    <div style={{fontSize:18}} className={cardColor(card.suit)}>{card.rank}{suitGlyph[card.suit]}</div>
                  </div>
                );
              }) : <div className="small">No cards on table</div>}
            </div>
          </div>

          <div style={{marginTop:12}}>
            <h4>Your Hand</h4>
            <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
              {myCards.length ? myCards.map((c,i)=>(
                <div key={c.id+i} onClick={()=>playCard(i)} style={{cursor:'pointer', padding:8, borderRadius:6, background:'#111', minWidth:60, textAlign:'center'}}>
                  <div style={{fontSize:14}} className={cardColor(c.suit)}>{c.rank}</div>
                  <div style={{fontSize:28}} className={cardColor(c.suit)}>{suitGlyph[c.suit]}</div>
                </div>
              )) : <div>No cards yet — wait for deal</div>}
            </div>
          </div>

          <div style={{marginTop:12}}>
            <h4>Log</h4>
            <div style={{maxHeight:200, overflowY:'auto', background:'#050505', padding:8, borderRadius:6}}>
              {log.map((l,i)=> <div key={i} style={{fontSize:12, opacity:0.9}}>{l}</div>)}
            </div>
          </div>
        </div>

        <div style={{width:320}}>
          <div style={{background:'#0b0b0b', padding:12, borderRadius:8}}>
            <h4>Players & Scores</h4>
            <div style={{display:'flex', flexDirection:'column', gap:8}}>
              {players.length ? players.map(p => (
                <div key={p.id} style={{display:'flex', justifyContent:'space-between', padding:8, background:'rgba(255,255,255,0.02)', borderRadius:6}}>
                  <div>
                    <div style={{fontWeight:700}}>{p.name}{p.isBot ? " (Bot)" : ""}</div>
                    <div style={{fontSize:12, opacity:0.8}}>Cards: {handsSizes[p.id] ?? "-"}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontWeight:800}}>{scores[p.id] ?? 0}</div>
                    <div style={{fontSize:11, opacity:0.8}}>{p.id === mySocketId.current ? "You" : p.id.slice(0,6)}</div>
                  </div>
                </div>
              )) : <div>No players yet</div>}
            </div>

            <div style={{marginTop:12}}>
              <button onClick={()=>socket.emit('startGame', room)}>Force Start</button>
              <div style={{fontSize:12, opacity:0.8, marginTop:8}}>Auto-fill bots in a few seconds if seats empty.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
