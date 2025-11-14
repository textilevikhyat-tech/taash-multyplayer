import React, { useEffect, useState } from "react";

export default function Table({ user, apiBase, socket }) {
  const [room, setRoom] = useState("");
  const [currentRoom, setCurrentRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [hand, setHand] = useState([]);
  const [coins, setCoins] = useState(0);
  const [log, setLog] = useState([]);

  useEffect(() => {
    // wallet fetch if logged
    if (user?.token) fetchWallet();

    socket.on("roomUpdate", ({ room: r, players }) => {
      setCurrentRoom(r);
      setPlayers(players.map(p=>p.username || p));
      addLog(`Room ${r} updated: ${players.map(p=>p.username||p).join(", ")}`);
    });

    socket.on("roomCreated", ({ roomCode }) => {
      setCurrentRoom(roomCode);
      addLog(`Created ${roomCode}`);
    });

    socket.on("joinedRoom", ({ roomCode }) => {
      setCurrentRoom(roomCode);
      addLog(`Joined ${roomCode}`);
    });

    socket.on("gameStarted", ({ hands }) => {
      // hands keyed by socket id or username; try to find ours by username
      const myHand = hands[socket.id] || hands[user.username] || Object.values(hands)[0] || [];
      setHand(myHand);
      addLog("Game started, cards dealt");
    });

    socket.on("walletUpdate", ({ username, coins }) => {
      addLog(`${username} wallet updated: ${coins}`);
      if (username === user.username) setCoins(coins);
    });

    socket.on("bidStarted", ({ biddingTeam, bidAmount }) => {
      addLog(`Bid ${bidAmount} started by ${biddingTeam.join(", ")}`);
    });

    socket.on("roundResolved", ({ winningTeam, perWinner, adminCut }) => {
      addLog(`Round resolved. Winners: ${winningTeam.join(", ")} (+${perWinner})`);
      fetchWallet();
    });

    socket.on("cardPlayed", ({ username, card }) => {
      addLog(`${username} played ${card}`);
    });

    socket.on("errorMessage", ({ message }) => {
      addLog(`Error: ${message}`);
      alert(message);
    });

    return () => { socket.off(); };
  }, []);

  function addLog(txt){ setLog(l => [txt, ...l].slice(0,50)); }

  async function fetchWallet(){
    if (!user?.token) return;
    try {
      const res = await fetch(`${apiBase}/api/wallet`, { headers: { Authorization: `Bearer ${user.token}` }});
      const d = await res.json();
      setCoins(d.coins ?? 0);
    } catch (e) {
      console.error(e);
    }
  }

  function createRoom(){
    const code = (Math.random().toString(36).slice(2,8)).toUpperCase();
    setRoom(code);
    socket.emit("createRoom", { roomCode: code, username: user.username });
  }

  function joinRoom(){
    if (!room) return alert("Enter room code");
    socket.emit("joinRoom", { roomCode: room, username: user.username });
  }

  function startGame(){
    if (!currentRoom) return alert("Join a room");
    socket.emit("startGame", currentRoom);
  }

  function startBid(){
    if (!currentRoom) return alert("Join a room");
    const t = prompt("Enter bidding team usernames comma separated (2 usernames):", user.username);
    if (!t) return;
    const arr = t.split(",").map(s=>s.trim()).filter(Boolean);
    const amt = Number(prompt("Enter total bid amount (number):", "10"));
    if (!amt) return;
    socket.emit("startBid", { roomCode: currentRoom, biddingTeam: arr, bidAmount: amt });
  }

  function resolveRound(){
    if (!currentRoom) return alert("Join a room");
    const winnersRaw = prompt("Enter winning team usernames comma separated:");
    if (!winnersRaw) return;
    const winners = winnersRaw.split(",").map(s=>s.trim()).filter(Boolean);
    socket.emit("resolveRound", { roomCode: currentRoom, winningTeam: winners });
  }

  function playCard(c){
    if (!currentRoom) return alert("Join a room");
    socket.emit("playCard", { roomCode: currentRoom, card: c });
    setHand(h => h.filter(x => x !== c));
  }

  return (
    <div className="table-wrap">
      <header className="topbar">
        <div>Welcome: {user.username}</div>
        <div>Coins: {coins}</div>
        <div>Room: {currentRoom || "-"}</div>
      </header>

      <section className="controls">
        <input placeholder="Room code" value={room} onChange={e=>setRoom(e.target.value)} />
        <button onClick={createRoom}>Create</button>
        <button onClick={joinRoom}>Join</button>
        <button onClick={startGame}>Start Game</button>
        <button onClick={startBid}>Start Bid</button>
        <button onClick={resolveRound}>Resolve Round</button>
      </section>

      <section className="players">
        <h3>Players</h3>
        <div>{players.map(p=> <div key={p} className="player">{p}</div>)}</div>
      </section>

      <section className="hand">
        <h3>Your Hand</h3>
        <div className="hand-cards">
          {hand.map(c => <div key={c} className="card" onClick={()=>playCard(c)}>{c}</div>)}
        </div>
      </section>

      <section className="log">
        <h4>Log</h4>
        <div>{log.map((l,i)=><div key={i}>{l}</div>)}</div>
      </section>
    </div>
  );
}
