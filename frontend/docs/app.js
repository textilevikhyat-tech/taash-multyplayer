const baseURL = "https://taash-multyplayer.onrender.com/api";
let socket = null;
let currentUser = null;

// Register
async function register() {
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;

    const res = await fetch(`${baseURL}/auth/register`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username, password})
    });
    const data = await res.json();
    alert(data.message);
}

// Login
async function login() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    const res = await fetch(`${baseURL}/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username, password})
    });
    const data = await res.json();
    if (res.status === 200) {
        currentUser = data.user;
        document.getElementById('auth').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
        document.getElementById('user-name').innerText = currentUser.username;
        document.getElementById('user-coins').innerText = currentUser.coins;
    } else {
        alert(data.message);
    }
}

// Wallet
async function addCoins() {
    const coins = parseInt(document.getElementById('coin-amount').value);
    if (!coins || !currentUser) return;

    const res = await fetch(`${baseURL}/wallet/add`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({userId: currentUser._id, coins})
    });
    const data = await res.json();
    alert(data.message);
    currentUser.coins = data.coins;
    document.getElementById('user-coins').innerText = currentUser.coins;
}

async function deductCoins() {
    const coins = parseInt(document.getElementById('coin-amount').value);
    if (!coins || !currentUser) return;

    const res = await fetch(`${baseURL}/wallet/deduct`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({userId: currentUser._id, coins})
    });
    const data = await res.json();
    alert(data.message);
    currentUser.coins = data.coins;
    document.getElementById('user-coins').innerText = currentUser.coins;
}

// Game Room
function joinGame() {
    const room = document.getElementById('room-name').value;
    if (!room || !currentUser) return;

    if (!socket) socket = io("https://taash-multyplayer.onrender.com");

    socket.emit('joinGame', room, currentUser.username);

    socket.on('playerJoined', (data) => {
        const log = document.getElementById('game-log');
        log.innerHTML += `<p>${data.username} joined the room!</p>`;
    });
}
