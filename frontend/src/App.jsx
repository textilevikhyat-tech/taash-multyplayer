// frontend/src/App.jsx
import React, { useState, useEffect } from "react";
import Login from "./components/Login";
import Table from "./components/Table";

export default function App(){
  const [user, setUser] = useState(()=> {
    const s = localStorage.getItem("taashUser");
    return s ? JSON.parse(s) : null;
  });
  useEffect(()=> { if(user) localStorage.setItem("taashUser", JSON.stringify(user)); }, [user]);
  return user ? <Table username={user.username} /> : <Login onLogin={(username)=> setUser({ username })} />;
}
