import React, { useEffect, useState } from "react";
import io from "socket.io-client";

const socket = io("/", { transports: ["websocket"] });

// AUTO JOIN SYSTEM + AUTO BOT FILL + CARD DEALING BUILT-IN
export default function Table() {
  const [players, setPlayers] = useState([]);
  const [myCards, setMyCards] = useState([]);
  const [status, setStatus] = useState("Connecting...");

  useEffect(() => {
    // Step 1: Auto Join Room
    socket.emit("quickJoin");

    socket.on("joinedRoom", (roomData) => {
      setPlayers(roomData.players);
      setStatus("Waiting for players...");
    });

    // Step 2: Bots added
    socket.on("botAdded", (data) => {
      setPlayers(data.players);
    });

    // Step 3: Game starts automatically
    socket.on("gameStarted", (data) => {
      setStatus("Game Started");
      setPlayers(data.players);
    });

    // Step 4: Cards received
    socket.on("dealCards", (cards) => {
      setMyCards(cards);
    });

    return () => {
      socket.off("joinedRoom");
      socket.off("botAdded");
      socket.off("gameStarted");
      socket.off("dealCards");
    };
  }, []);

  return (
    <div className="table-container">
      <h1>🃏 Teen Patti Multiplayer</h1>
      <h3>{status}</h3>

      {/* Players */}
      <div className="players">
        {players.map((p, i) => (
          <div className="player-card" key={i}>
            <h3>{p.name}</h3>
            <p>{p.isBot ? "🤖 Bot" : "🧑 Player"}</p>
          </div>
        ))}
      </div>

      {/* My Cards */}
      <h2 style={{ marginTop: "30px" }}>Your Cards</h2>
      <div className="cards">
        {myCards.map((c, i) => (
          <div className="card" key={i}>
            {c}
          </div>
        ))}
      </div>
    </div>
  );
}
