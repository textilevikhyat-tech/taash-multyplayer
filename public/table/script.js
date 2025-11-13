const socket = io();
const cardDeck = document.getElementById("card-deck");
const cardSound = document.getElementById("cardSound");
const statusText = document.getElementById("status");

function dealCards() {
  statusText.textContent = "Dealing Cards...";
  cardDeck.innerHTML = "";

  for (let i = 0; i < 8; i++) {
    const card = document.createElement("div");
    card.classList.add("card");
    cardDeck.appendChild(card);

    setTimeout(() => {
      card.classList.add("flip");
      cardSound.play();
    }, i * 300);
  }

  setTimeout(() => {
    statusText.textContent = "Cards Dealt! Let's Play 🎮";
  }, 3500);
}

// Avatar change system
document.getElementById("myAvatar").addEventListener("click", async () => {
  const file = await selectFile();
  if (file) {
    const url = URL.createObjectURL(file);
    document.getElementById("myAvatar").src = url;
  }
});

function selectFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => resolve(e.target.files[0]);
    input.click();
  });
}

// On page load, set name
const params = new URLSearchParams(window.location.search);
const guestName = params.get("guest");
const username = localStorage.getItem("username") || guestName || "Player";

document.getElementById("myName").textContent = username;
