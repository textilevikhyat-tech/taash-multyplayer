import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";

const socket = io("/", { transports: ["websocket"] });

export default function Table({ user }) {
  const [status, setStatus] = useState("Connecting...");
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [myCards, setMyCards] = useState([]);

  useEffect(()=>{
    socket.on("connect", ()=>{
      setStatus("Connected — quick joining");
      socket.emit("quickJoin", { username: user ? user.username : undefined });
    });

    socket.on("joinedRoom", (d)=>{
      setRoom(d.room);
      setPlayers(d.players || []);
      setStatus("Joined room " + d.room);
    });

    socket.on("roomUpdate", (list)=>{
      setPlayers(list || []);
    });

    socket.on("dealPrivate", ({ cards })=>{
      const display = (cards || []).map(c => (typeof c === "string" ? c : (c.id || JSON.stringify(c))));
      setMyCards(display);
      setStatus("Cards dealt");
    });

    socket.on("matchStart", ()=> setStatus("Match started"));
    socket.on("errorMessage", ({ message })=> alert(message));
    socket.on("disconnect", ()=> setStatus("Disconnected"));

    return () => socket.off();
  }, [user]);

  return (
    <div className="container">
      <div className="header">
        <h1>29 Tash Multiplayer</h1>
        <div>{status}</div>
      </div>

      <div style={{marginTop:18}}>
        <strong>Room:</strong> {room || "-"}
      </div>

      <div className="players">
        {players.map(p => (
          <div key={p.id} className="player">
            <div>{p.name}</div>
            <div style={{fontSize:12}}>{p.isBot ? "🤖 Bot" : "👤 Player"}</div>
          </div>
        ))}
      </div>

      <h3 style={{marginTop:18}}>Your Hand</h3>
      <div className="cards">
        {myCards.map((c,i)=> <div key={i} className="card">{c}</div>)}
      </div>
    </div>
  );
}
