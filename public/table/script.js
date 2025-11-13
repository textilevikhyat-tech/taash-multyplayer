document.addEventListener("DOMContentLoaded", async () => {
  const walletSpan = document.getElementById("coins");
  const statusText = document.getElementById("status-text");
  const startBtn = document.getElementById("start-btn");
  const bidBtn = document.getElementById("bid-btn");
  const exitBtn = document.getElementById("exit-btn");

  // 🧩 Fullscreen mode on first interaction
  document.body.addEventListener("click", async () => {
    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else if (document.documentElement.webkitRequestFullscreen) {
        await document.documentElement.webkitRequestFullscreen();
      }
    } catch (err) {
      console.log("⚠️ Fullscreen not supported:", err);
    }
  });

  // 🧩 Try to lock orientation
  if (screen.orientation && screen.orientation.lock) {
    try {
      await screen.orientation.lock("landscape");
      console.log("✅ Landscape locked");
    } catch {
      console.log("⚠️ Orientation lock not available");
    }
  }

  // 🧩 Load wallet coins
  const token = localStorage.getItem("token");
  if (token) {
    try {
      const res = await fetch("/api/wallet", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data && data.coins !== undefined) {
        walletSpan.textContent = data.coins;
      }
    } catch (err) {
      console.log("Wallet fetch failed:", err);
    }
  }

  // 🎮 Button Actions
  startBtn.addEventListener("click", () => {
    statusText.textContent = "Game Started! Waiting for moves...";
    startBtn.disabled = true;
  });

  bidBtn.addEventListener("click", () => {
    const bid = prompt("Enter your bid amount:");
    if (bid && !isNaN(bid)) {
      statusText.textContent = `Bid placed: ${bid} coins`;
    }
  });

  exitBtn.addEventListener("click", () => {
    if (confirm("Exit game?")) {
      window.location.href = "/index.html";
    }
  });
});
