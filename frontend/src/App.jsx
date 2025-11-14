import React, { useState, useEffect } from "react";
import io from "socket.io-client";
import Login from "./components/Login";
import Table from "./components/Table";

const API_BASE = ""; // empty = same origin; if backend is hosted at other origin, put full URL e.g. https://taash-multyplayer.onrender.com

const socket = io(API_BASE);

export const SocketContext = React.createContext(socket);

export default function App() {
  const [user, setUser] = useState(() => {
    const username = localStorage.getItem("username");
    const token = localStorage.getItem("token");
    return token && username ? { username, token } : null;
  });

  useEffect(() => {
    // attempt auto wallet fetch if logged
  }, [user]);

  return (
    <SocketContext.Provider value={socket}>
      {!user ? (
        <Login onLogin={(u, t) => setUser({ username: u, token: t })} apiBase={API_BASE} />
      ) : (
        <Table user={user} apiBase={API_BASE} socket={socket} />
      )}
    </SocketContext.Provider>
  );
}
