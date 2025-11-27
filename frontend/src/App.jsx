import React, { useState, useEffect } from "react";
import Table from "./components/Table";
import Login from "./components/Login";

export default function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem("taashUser");
    return saved ? JSON.parse(saved) : null;
  });

  useEffect(() => {
    if (user) localStorage.setItem("taashUser", JSON.stringify(user));
  }, [user]);

  return user ? (
    <Table user={user} />
  ) : (
    <Login onLogin={(username, token) => setUser({ username, token })} />
  );
}
