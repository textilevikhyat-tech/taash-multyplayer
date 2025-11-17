// frontend/src/components/Table.jsx
import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";

const socket = io("/", { transports: ["websocket"] });

export default function Table() {
  const [status, setStatus] = useState("Connecting...");
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [myCards, setMyCards] = useState([]);

  useEffect(() => {
    socket.on("connect", () => {
      setStatus("Connected. Quick joining...");
      socket.emit("quickJoin", {}); // quick join — server auto-fills bots and deals
    });

    socket.on("joinedRoom", (d) => {
      setRoom(d.room);
      setPlayers(d.players || []);
      setStatus("Joined " + d.room);
    });

    socket.on("roomUpdate", (list) => {
      setPlayers(list || []);
    });

    socket.on("dealPrivate", ({ cards }) => {
      const display = cards.map((c) => (typeof c === "string" ? c : (c.id || JSON.stringify(c))));
      setMyCards(display);
      setStatus("Cards dealt");
    });

    socket.on("matchStart", () => setStatus("Match started"));
    socket.on("errorMessage", ({ message }) => alert(message));
    socket.on("disconnect", () => setStatus("Disconnected"));

    return () => socket.off();
  }, []);

  return (
    <div style={{ padding: 18, fontFamily: "Arial, sans-serif", color: "#fff", background: "#092" }}>
      <h1>29 Tash Multiplayer</h1>
      <div>Status: {status}</div>
      <div>Room: {room || "-"}</div>

      <h3>Players</h3>
      <div style={{ display: "flex", gap: 12 }}>
        {players.map((p) => (
          <div key={p.id} style={{ background: "rgba(255,255,255,0.08)", padding: 10, borderRadius: 8 }}>
            <div>{p.name}</div>
            <div style={{ fontSize: 12 }}>{p.isBot ? "🤖 Bot" : "👤 Player"}</div>
          </div>
        ))}
      </div>

      <h3>Your Hand</h3>
      <div style={{ display: "flex", gap: 8 }}>
        {myCards.map((c, i) => (
          <div key={i} style={{ width: 70, height: 100, background: "#fff", color: "#000", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold" }}>
            {c}
          </div>
        ))}
      </div>
    </div>
  );
}
