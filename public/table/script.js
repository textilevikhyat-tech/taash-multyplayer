// public/table/script.js
(() => {
  const socket = io();
  const params = new URLSearchParams(location.search);
  const roomParam = params.get('room');
  const guestName = sessionStorage.getItem('guestName');
  const storedUser = localStorage.getItem('username');
  const username = storedUser || guestName || ('Guest' + Math.floor(Math.random()*10000));
  if (!storedUser && !guestName) sessionStorage.setItem('guestName', username);

  const walletUserSpan = document.getElementById('wallet-user');
  const walletCoinsSpan = document.getElementById('wallet-coins');
  const playersDiv = document.getElementById('players');
  const statusDiv = document.getElementById('status');
  const handDiv = document.getElementById('hand');
  const rotateMsg = document.getElementById('rotateMsg');
  const flipSound = document.getElementById('flipSound');

  const createBtn = document.getElementById('createRoomBtn');
  const joinBtn = document.getElementById('joinRoomBtn');
  const startGameBtn = document.getElementById('startGameBtn');
  const startBidBtn = document.getElementById('startBidBtn');
  const resolveBtn = document.getElementById('resolveRoundBtn');
  const leaveBtn = document.getElementById('leaveBtn');

  let currentRoom = roomParam ? roomParam.toUpperCase() : null;

  walletUserSpan.textContent = username;
  updateWalletDisplay();

  async function tryFullscreenAndLandscape(){
    try { if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); } catch(e){}
    try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch(e){}
  }
  document.body.addEventListener('click', tryFullscreenAndLandscape, { once: true });

  function checkOrientation(){
    if (window.innerHeight > window.innerWidth){
      rotateMsg.style.display = 'flex';
    } else rotateMsg.style.display = 'none';
  }
  window.addEventListener('resize', checkOrientation);
  window.addEventListener('orientationchange', checkOrientation);
  checkOrientation();

  socket.on('connect', () => {
    if (currentRoom) {
      socket.emit('joinRoom', { roomCode: currentRoom, username });
    }
  });

  socket.on('roomCreated', ({ roomCode }) => {
    currentRoom = roomCode;
    statusDiv.textContent = `Room created: ${roomCode}`;
    alert('Room: ' + roomCode + ' (share with friend to join)');
  });

  socket.on('joinedRoom', ({ roomCode }) => {
    currentRoom = roomCode;
    statusDiv.textContent = `Joined ${roomCode}`;
  });

  socket.on('roomUpdate', ({ roomCode, players }) => {
    currentRoom = roomCode;
    playersDiv.innerHTML = '';
    players.forEach(p => {
      const el = document.createElement('div'); el.className='player'; el.textContent = p;
      if (p === username) el.textContent += ' (You)';
      playersDiv.appendChild(el);
    });
    statusDiv.textContent = `Players: ${players.length} in ${roomCode}`;
  });

  socket.on('gameStarted', ({ hands }) => {
    statusDiv.textContent = 'Game started — cards dealt';
    let myHand = hands[socket.id] || hands[username];
    if (!myHand) {
      for (const k in hands) { if (Array.isArray(hands[k]) && hands[k].length) { myHand = hands[k]; break; } }
    }
    renderHand(myHand || []);
  });

  socket.on('yourTurn', ({ message }) => {
    statusDiv.textContent = message || 'Your turn';
  });

  socket.on('walletUpdate', ({ username: who, coins }) => {
    if (who === walletUserSpan.textContent) walletCoinsSpan.textContent = coins;
    statusDiv.textContent = `${who} wallet updated: ${coins}`;
  });

  socket.on('bidStarted', ({ biddingTeam, bidAmount }) => {
    statusDiv.textContent = `Bid ${bidAmount} started by ${biddingTeam.join(', ')}`;
  });

  socket.on('roundResolved', ({ winningTeam, perWinner, adminCut }) => {
    statusDiv.textContent = `Round resolved. Winners: ${winningTeam.join(', ')} (+${perWinner})`;
    updateWalletDisplay();
  });

  socket.on('logMessage', ({ message }) => statusDiv.textContent = message);
  socket.on('errorMessage', ({ message }) => alert('Error: '+message));

  createBtn.onclick = () => {
    const code = prompt('Room code (blank = auto):') || undefined;
    socket.emit('createRoom', { roomCode: code, username });
  };

  joinBtn.onclick = () => {
    const code = prompt('Enter room code:');
    if (!code) return;
    socket.emit('joinRoom', { roomCode: code.toUpperCase(), username });
  };

  startGameBtn.onclick = () => {
    if (!currentRoom) return alert('Join or create a room first.');
    socket.emit('startGame', currentRoom);
  };

  startBidBtn.onclick = async () => {
    if (!currentRoom) return alert('Join or create a room first.');
    const teamRaw = prompt('Enter bidding team usernames (comma separated):', username);
    if (!teamRaw) return;
    const biddingTeam = teamRaw.split(',').map(s => s.trim()).filter(Boolean);
    const bidAmount = Number(prompt('Enter total bid amount (numeric):', '10'));
    if (!bidAmount || isNaN(bidAmount)) return alert('Invalid amount');
    socket.emit('startBid', { roomCode: currentRoom, biddingTeam, bidAmount });
  };

  resolveBtn.onclick = async () => {
    if (!currentRoom) return alert('Join or create a room first.');
    const winnersRaw = prompt('Enter winning team usernames (comma separated):');
    if (!winnersRaw) return;
    const winners = winnersRaw.split(',').map(s => s.trim()).filter(Boolean);
    socket.emit('resolveRound', { roomCode: currentRoom, winningTeam: winners });
  };

  leaveBtn.onclick = () => {
    location.href = '/';
  };

  function renderHand(cards){
    handDiv.innerHTML = '';
    if (!cards || !cards.length) { handDiv.innerHTML = '<div style="opacity:.6">No cards</div>'; return; }
    cards.forEach(c => {
      const el = document.createElement('div');
      el.className = 'card';
      el.innerText = c;
      el.onclick = () => {
        if (!currentRoom) return alert('Join a room first to play a card.');
        socket.emit('playCard', { roomCode: currentRoom, card: c });
        el.style.opacity = '0.4';
        try { flipSound.currentTime = 0; flipSound.play(); } catch(e){}
      };
      handDiv.appendChild(el);
    });
  }

  async function updateWalletDisplay(){
    try {
      const res = await fetch(`/api/wallet/${username}`);
      const d = await res.json();
      walletCoinsSpan.textContent = d.coins ?? 0;
    } catch (e) {
      walletCoinsSpan.textContent = '0';
    }
  }
})();
