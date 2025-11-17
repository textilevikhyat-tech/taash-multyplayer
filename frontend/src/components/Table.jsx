import { useEffect, useState } from "react";
import io from "socket.io-client";

const socket = io("/", {
  transports: ["websocket"],
});

export default function Table() {

  const [status, setStatus] = useState("Connecting…");
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [myCards, setMyCards] = useState([]);

  useEffect(() => {
    socket.on("connect", () => {
      setStatus("Connected. Joining match…");

      socket.emit("quickJoin", { username: "Player" + Math.floor(Math.random()*9999) });
    });

    socket.on("joinedRoom", (code) => {
      setRoom(code);
      setStatus("Waiting for players…");
    });

    socket.on("roomUpdate", (list) => {
      setPlayers(list);
      if (list.length === 4) {
        setStatus("Match starting…");
      }
    });

    socket.on("dealPrivate", ({ cards }) => {
      setMyCards(cards);
      setStatus("Your cards received");
    });

    socket.on("matchStart", () => {
      setStatus("Match Started!");
    });

    return () => {
      socket.off("connect");
      socket.off("joinedRoom");
      socket.off("roomUpdate");
      socket.off("dealPrivate");
      socket.off("matchStart");
    };

  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h2>{status}</h2>

      <h3>Room Code: {room || "Loading…"}</h3>

      <h3>Players:</h3>
      {players.map(p => (
        <div key={p.id}>
          {p.name} {p.isBot ? "(Bot)" : ""}
        </div>
      ))}

      <h3>Your Cards:</h3>
      <div style={{ display: "flex", gap: 10 }}>
        {myCards.map(c => (
          <div key={c.id} style={{ padding: 10, border: "1px solid black" }}>
            {c.id}
          </div>
        ))}
      </div>
    </div>
  );
}
