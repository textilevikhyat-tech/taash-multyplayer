import React, { useState } from "react";

export default function Login({ onLogin, apiBase }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  async function login() {
    if (!username || !password) return alert("Enter both");
    const res = await fetch(`${apiBase}/api/auth/login`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      localStorage.setItem("token", data.token);
      localStorage.setItem("username", data.username);
      onLogin(data.username, data.token);
    } else {
      alert(data.message || "Login failed");
    }
  }

  async function register(){
    if (!username || !password) return alert("Enter both");
    const res = await fetch(`${apiBase}/api/auth/register`, {
      method:"POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ username, password })
    });
    const d = await res.json();
    alert(d.message || "Registered");
  }

  function guestPlay() {
    const g = "Guest" + Math.floor(Math.random()*10000);
    localStorage.setItem("username", g);
    onLogin(g, null);
  }

  return (
    <div className="login-wrap">
      <div className="card">
        <h2>29 Tash Club</h2>
        <input placeholder="username" value={username} onChange={e=>setUsername(e.target.value)} />
        <input placeholder="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
        <button onClick={login}>Login</button>
        <button onClick={register}>Register</button>
        <hr />
        <button onClick={guestPlay}>Play as Guest</button>
      </div>
    </div>
  );
}
