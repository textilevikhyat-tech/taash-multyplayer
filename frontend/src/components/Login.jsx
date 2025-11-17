import React, { useState } from "react";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  async function login(){
    if(!username || !password) return alert("Enter both");
    try {
      const res = await fetch("/api/auth/login", {
        method:"POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ username, password })
      });
      const d = await res.json();
      if(res.ok && d.token){
        localStorage.setItem("token", d.token);
        localStorage.setItem("username", d.username);
        onLogin(d.username, d.token);
      } else alert(d.message || "Login failed");
    } catch (e) { alert("Network error"); }
  }

  async function register(){
    if(!username || !password) return alert("Enter both");
    const res = await fetch("/api/auth/register", {
      method:"POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ username, password })
    });
    const d = await res.json();
    alert(d.message || "Registered");
  }

  function guest(){
    const g = "Guest" + Math.floor(Math.random()*10000);
    localStorage.setItem("username", g);
    onLogin(g, null);
  }

  return (
    <div className="login-wrap">
      <div className="cardbox">
        <h2>29 Tash Club</h2>
        <input placeholder="username" value={username} onChange={e=>setUsername(e.target.value)} />
        <input placeholder="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
        <div style={{marginTop:8}}>
          <button onClick={login}>Login</button>
          <button onClick={register}>Register</button>
        </div>
        <hr />
        <button onClick={guest}>Play as Guest</button>
      </div>
    </div>
  );
}
