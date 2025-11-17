import React, { useEffect, useState } from "react";

/**
 * Robust Table.jsx:
 * - waits for socket connect
 * - registers listeners once
 * - emits quickJoin automatically on connect (guest or logged user)
 * - handles gameStarted / dealPrivate
 * - auto-plays first card when "autoPlay" true (for testing)
 */

export default function Table({ user, apiBase, socket }) {
  const [room, setRoom] = useState("");
  const [currentRoom, setCurrentRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [hand, setHand] = useState([]);
  const [coins, setCoins] = useState(0);
  const [log, setLog] = useState([]);
  const [connected, setConnected] = useState(false);

  // set this true to let client auto-play its first card for testing
  const autoPlay = false;

  function addLog(txt) {
    setLog((l) => [new Date().toLocaleTimeString() + " — " + txt, ...l].slice(0, 80));
  }

  // Initialize listeners once
  useEffect(() => {
    if (!socket) return;

    const onConnect = () => {
      setConnected(true);
      addLog("Socket connected: " + socket.id);
      // emit quickJoin (will be accepted by server)
      const username = (user && user.username) || ("Guest" + Math.floor(Math.random() * 9999));
      socket.emit("quickJoin", { username });
      addLog("Sent quickJoin as " + username);
    };

    const onRoomUpdate = ({ room: r, players }) => {
      setCurrentRoom(r);
      setPlayers(players.map((p) => p.name || p.username || p));
      addLog(`roomUpdate: ${r} — players: ${players.map((p) => p.name || p.username || p).join(", ")}`);
    };

    const onJoinedRoom = ({ roomCode }) => {
      setCurrentRoom(roomCode);
      addLog("joinedRoom " + roomCode);
    };

    const onMatchStart = (payload) => {
      addLog("matchStart: " + JSON.stringify(payload.players.map(p=>p.name||p)));
    };

    const onGameStarted = ({ hands, matchId, bid, trumpSuit }) => {
      // hands keyed by socket.id and username per server logic
      const myHand = hands[socket.id] || (user && hands[user.username]) || Object.values(hands).find(h=>Array.isArray(h)) || [];
      setHand(myHand);
      addLog(`gameStarted (match ${matchId}) — received ${myHand.length} cards. bid=${bid} trump=${trumpSuit}`);

      // optional: auto-play first card for testing if enabled
      if (autoPlay && myHand.length > 0) {
        setTimeout(() => {
          const card = myHand[0];
          playCard(card);
        }, 800);
      }
    };

    const onDealPrivate = ({ yourCards, matchId, bid, trumpSuit }) => {
      // server may also emit private deal
      setHand(yourCards || []);
      addLog(`Received private hand (${(yourCards||[]).length} cards) match ${matchId}`);
      if (autoPlay && (yourCards || []).length > 0) {
        setTimeout(() => playCard(yourCards[0]), 700);
      }
    };

    const onTurnRequest = ({ playerId }) => {
      addLog("Turn request for " + playerId);
      // if it's this client
      if (playerId === socket.id && autoPlay) {
        // auto play after 500ms
        setTimeout(() => {
          if (hand.length > 0) playCard(hand[0]);
        }, 500);
      }
    };

    const onCardPlayed = ({ username, card }) => {
      addLog(`${username || "?"} played ${card?.id || card?.rank + card?.suit || card}`);
    };

    const onTrickWon = ({ winner, trick }) => {
      addLog(`Trick won by ${winner}`);
    };

    const onMatchEnd = (res) => {
      addLog(`Match ended: declarer=${res.declarerPoints} opponent=${res.opponentPoints}`);
    };

    const onWalletUpdate = ({ username, coins }) => {
      addLog(`Wallet ${username} = ${coins}`);
      if (username === user?.username) setCoins(coins);
    };

    const onError = ({ message }) => {
      addLog("Server error: " + message);
      // optionally show alert
    };

    // register
    socket.on("connect", onConnect);
    socket.on("roomUpdate", onRoomUpdate);
    socket.on("joinedRoom", onJoinedRoom);
    socket.on("matchStart", onMatchStart);
    socket.on("gameStarted", onGameStarted);
    socket.on("dealPrivate", onDealPrivate);
    socket.on("turnRequest", onTurnRequest);
    socket.on("cardPlayed", onCardPlayed);
    socket.on("trickWon", onTrickWon);
    socket.on("matchEnd", onMatchEnd);
    socket.on("walletUpdate", onWalletUpdate);
    socket.on("errorMessage", onError);

    // cleanup
    return () => {
      socket.off("connect", onConnect);
      socket.off("roomUpdate", onRoomUpdate);
      socket.off("joinedRoom", onJoinedRoom);
      socket.off("matchStart", onMatchStart);
      socket.off("gameStarted", onGameStarted);
      socket.off("dealPrivate", onDealPrivate);
      socket.off("turnRequest", onTurnRequest);
      socket.off("cardPlayed", onCardPlayed);
      socket.off("trickWon", onTrickWon);
      socket.off("matchEnd", onMatchEnd);
      socket.off("walletUpdate", onWalletUpdate);
      socket.off("errorMessage", onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, user, hand]);

  // wallet fetch (optional)
  useEffect(() => {
    if (!user?.token) return;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/wallet`, { headers: { Authorization: `Bearer ${user.token}` }});
        const d = await res.json();
        setCoins(d.coins ?? 0);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [user, apiBase]);

  function createRoom() {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    socket.emit("createRoom", { roomCode: code, username: user?.username || null });
    addLog("createRoom " + code);
  }

  function joinRoom() {
    if (!room) return alert("Enter room code");
    socket.emit("joinRoom", { roomCode: room, username: user?.username || null });
    addLog("joinRoom " + room);
  }

  function startGame() {
    if (!currentRoom) return alert("Join a room");
    socket.emit("startGame", currentRoom);
    addLog("startGame " + currentRoom);
  }

  function startBid() {
    if (!currentRoom) return alert("Join a room");
    const arr = [user?.username || "Guest"];
    socket.emit("startBid", { roomCode: currentRoom, biddingTeam: arr, bidAmount: 16 });
    addLog("startBid by " + arr.join(", "));
  }

  function resolveRound() {
    if (!currentRoom) return alert("Join a room");
    socket.emit("resolveRound", { roomCode: currentRoom, winningTeam: [user?.username || "Guest"] });
    addLog("resolveRound");
  }

  function playCard(c) {
    if (!currentRoom) {
      addLog("playCard blocked: not in room");
      return;
    }
    // ensure sending object with id property (server expects card.id)
    const payload = (typeof c === "string" || typeof c === "number") ? { id: c } : c;
    socket.emit("playCard", { roomCode: currentRoom, card: payload }, (res) => {
      if (res && res.ok) {
        addLog("Played card " + (payload.id || JSON.stringify(payload)));
        // optimistically remove from hand by id
        setHand((h) => h.filter((x) => (x.id || x) !== (payload.id || payload)));
      } else {
        addLog("playCard failed: " + (res && res.msg));
      }
    });
  }

  return (
    <div className="table-wrap">
      <header className="topbar">
        <div>Welcome: {user?.username || "Guest"}</div>
        <div>Coins: {coins}</div>
        <div>Room: {currentRoom || "-"}</div>
        <div>Socket: {connected ? "Connected" : "Disconnected"}</div>
      </header>

      <section className="controls">
        <input placeholder="Room code" value={room} onChange={(e) => setRoom(e.target.value)} />
        <button onClick={createRoom}>Create</button>
        <button onClick={joinRoom}>Join</button>
        <button onClick={startGame}>Start Game</button>
        <button onClick={startBid}>Start Bid</button>
        <button onClick={resolveRound}>Resolve Round</button>
        <button onClick={() => { socket.emit("quickJoin", { username: user?.username || ("Guest"+Math.floor(Math.random()*10000)) }); addLog("Manual quickJoin emitted"); }}>Quick Play</button>
      </section>

      <section className="players">
        <h3>Players</h3>
        <div>{players.map((p) => <div key={p} className="player">{p}</div>)}</div>
      </section>

      <section className="hand">
        <h3>Your Hand</h3>
        <div className="hand-cards">
          {hand.map((c) => (
            <div key={c.id || JSON.stringify(c)} className="card" onClick={() => playCard(c)}>
              {c.rank ? `${c.rank}${c.suit}` : (c.id || JSON.stringify(c))}
            </div>
          ))}
        </div>
      </section>

      <section className="log">
        <h4>Log</h4>
        <div style={{ maxHeight: 240, overflow: 'auto' }}>{log.map((l, i) => <div key={i}>{l}</div>)}</div>
      </section>
    </div>
  );
}
