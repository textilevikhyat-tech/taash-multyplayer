import React, { useState } from "react";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!username) return alert("Enter username");
    onLogin(username, Math.random().toString(36).substring(2, 10));
  };

  return (
    <div className="login-container">
      <h2>Enter Username</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <button type="submit">Play</button>
      </form>
    </div>
  );
}
