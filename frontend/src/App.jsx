import React, { useState } from "react";
import Login from "./components/Login";
import Table from "./components/Table";

export default function App(){
  const [user, setUser] = useState(() => {
    const username = localStorage.getItem("username");
    const token = localStorage.getItem("token");
    return username ? { username, token } : null;
  });

  return user ? <Table user={user} onLogout={() => { localStorage.clear(); setUser(null); }} /> : <Login onLogin={(u,t)=> { localStorage.setItem("username", u); if(t) localStorage.setItem("token", t); setUser({ username: u, token: t }); }} />;
}
