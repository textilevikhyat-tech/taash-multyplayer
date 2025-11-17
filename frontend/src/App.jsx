import React, { useState } from "react";
import Table from "./components/Table";
import Login from "./components/Login";

export default function App(){
  const [user, setUser] = useState(() => {
    const username = localStorage.getItem("username");
    const token = localStorage.getItem("token");
    return token && username ? { username, token } : null;
  });

  return user ? <Table user={user} /> : <Login onLogin={(u,t)=> setUser({ username:u, token:t })} />;
}
