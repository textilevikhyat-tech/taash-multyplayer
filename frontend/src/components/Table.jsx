import React, { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";

const socket = io("/", { transports: ["websocket"] });

export default function Table({ user, onLogout }) {
  const [status, setStatus] = useState("Connecting...");
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [myCards, setMyCards] = useState([]);
  const [log, setLog] = useState([]);
  const didQuickJoin = useRef(false);

  useEffect(()=> {
    socket.on("connect", ()=> {
      setStatus("Connected");
      if(!didQuickJoin.current){
        socket.emit("quickJoin", { username: user.username });
        didQuickJoin.current = true;
        addLog("Quick-join sent");
      }
    });

    socket.on("joinedRoom", (d) => {
      setRoom(d.room);
      setPlayers(d.players || []);
      addLog(`Joined room ${d.room}`);
    });

    socket.on("roomCreated", ({ room }) => {
      setRoom(room);
      addLog(`Room created: ${room}`);
    });

    socket.on("roomUpdate", (list) => {
      setPlayers(list || []);
      addLog(`Room updated (${(list||[]).length} players)`);
    });

    socket.on("dealPrivate", ({ cards }) => {
      // cards could be objects {id,suit,rank}
      const flat = (cards || []).map(c => (typeof c === "string" ? c : `${c.rank}${c.suit}`));
      setMyCards(flat);
      addLog("Cards dealt to you");
    });

    socket.on("matchStart", (d) => {
      addLog("Match started");
    });

    socket.on("cardPlayed", ({ username, card }) => {
      addLog(`${username} played ${card.rank ? (card.rank+card.suit) : card}`);
    });

    socket.on("errorMessage", ({ message }) => {
      addLog("Error: " + message);
      alert(message);
    });

    socket.on("disconnect", ()=> setStatus("Disconnected"));

    return () => socket.off();
  }, []);

  function addLog(t){
    setLog(l => [ `${new Date().toLocaleTimeString()} — ${t}`, ...l].slice(0,80));
  }

  function createRoom(){
    const code = (Math.random().toString(36).slice(2,8)).toUpperCase();
    socket.emit("createRoom", { roomCode: code, username: user.username });
  }

  function joinRoom(){
    const code = prompt("Enter room code:");
    if(!code) return;
    socket.emit("joinRoom", { roomCode: code, username: user.username });
  }

  function startGame(){
    if(!room) return alert("Join or create a room first");
    socket.emit("startGame", room);
  }

  function playCard(cardIdx){
    const c = myCards[cardIdx];
    if(!c) return;
    // send card id string; server expects object or id - both handled
    socket.emit("playCard", { roomCode: room, card: { id: c, rank: c.slice(0,-1), suit: c.slice(-1) } });
    // locally remove
    setMyCards(cards => cards.filter((_,i)=>i!==cardIdx));
  }

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <div className="logo">29</div>
          <div>
            <div className="title">Taash Casino — 29 Multiplayer</div>
            <div className="small">Welcome, <strong>{user.username}</strong></div>
          </div>
        </div>

        <div className="top-actions">
          <div className="chips center"> <div className="chip">29</div> </div>
          <div style={{textAlign:"right"}}>
            <div className="small">Room: <strong>{room || "-"}</strong></div>
            <div style={{marginTop:6}}>
              <button className="btn" onClick={createRoom}>Create</button>
              <button className="btn secondary" onClick={joinRoom}>Join</button>
              <button className="btn gold" onClick={startGame}>Start</button>
              <button className="btn secondary" onClick={()=>{ onLogout(); }}>Logout</button>
            </div>
          </div>
        </div>
      </div>

      <div className="table-area">
        <div>
          <div className="table-card panel">
            <div className="table-stage center">
              <div className="table-green">
                <div style={{color:"#fff", fontWeight:800, fontSize:20}}>TAASH TABLE</div>
              </div>
            </div>

            <div className="players-row" style={{marginTop:12}}>
              {players.concat(Array.from({length: Math.max(0,4 - players.length)})).slice(0,4).map((p,idx)=> {
                if(!p) return <div key={idx} className="player-box panel small center">Waiting...</div>;
                return (
                  <div key={p.id} className="player-box">
                    <div className="player-name">{p.name}</div>
                    <div className="player-sub">{p.isBot ? "🤖 Bot" : "👤 Player"}</div>
                  </div>
                );
              })}
            </div>

            <div className="hand-area">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div><strong>Your Hand</strong></div>
                <div className="small">Tap a card to play</div>
              </div>

              <div className="cards" style={{marginTop:12}}>
                {myCards.length ? myCards.map((c,i)=>(
                  <div key={i} className="card" onClick={()=>playCard(i)}>
                    <div className="rank">{c.slice(0,-1)}</div>
                    <div className="suit">{c.slice(-1)}</div>
                  </div>
                )) : <div className="small">No cards yet — waiting for deal...</div>}
              </div>
            </div>

            <div style={{marginTop:12}} className="log panel">
              {log.map((l,i)=> <div key={i} className="log-item">{l}</div>)}
            </div>
          </div>
        </div>

        <div className="right-col">
          <div className="panel">
            <h3>Room Players</h3>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:8}}>
              {players.length ? players.map(p => (
                <div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:8,background:"rgba(255,255,255,0.01)",borderRadius:8}}>
                  <div>
                    <div style={{fontWeight:700}}>{p.name}</div>
                    <div className="small">{p.isBot ? "Bot" : "Human"}</div>
                  </div>
                  <div className="small">Seat</div>
                </div>
              )) : <div className="small">No players yet</div>}
            </div>

            <hr style={{border:"none",borderTop:"1px solid rgba(255,255,255,0.04)",margin:"12px 0"}} />

            <div>
              <button className="btn" onClick={()=>socket.emit("quickJoin", { username: user.username })}>Quick Join</button>
              <button className="btn secondary" onClick={()=>socket.emit("startGame", room)}>Force Start</button>
            </div>
          </div>

          <div className="panel" style={{marginTop:12}}>
            <h4>Game Info</h4>
            <div className="small">Casino style UI • Bots auto-fill seats • Private deals via socket</div>
          </div>
        </div>
      </div>
    </div>
  );
}
