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
        onLogin(d.username, d.token);
      } else alert(d.message || "Login failed");
    } catch(e){ alert("Network error"); }
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
    onLogin(g, null);
  }

  return (
    <div className="login-wrap">
      <div className="login-card panel">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div>
            <div style={{fontSize:18,fontWeight:800}}>29 Tash Club</div>
            <div className="small">Play with bots or online players</div>
          </div>
          <div className="chip">29</div>
        </div>

        <input className="input" placeholder="username" value={username} onChange={e=>setUsername(e.target.value)} />
        <input className="input" placeholder="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />

        <div style={{display:"flex",justifyContent:"space-between",marginTop:12}}>
          <button className="btn" onClick={login}>Login</button>
          <button className="btn secondary" onClick={register}>Register</button>
        </div>

        <hr style={{border:"none",borderTop:"1px solid rgba(255,255,255,0.04)",margin:"12px 0"}} />

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div className="small">Quick play as guest</div>
            <div className="small">Auto-match with bots or players</div>
          </div>
          <button className="btn gold" onClick={guest}>Play Now</button>
        </div>
      </div>
    </div>
  );
}
