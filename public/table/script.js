(() => {
  const socket = io();
  const coinsSpan = document.getElementById('coins');
  const playersList = document.getElementById('players-list');
  const statusText = document.getElementById('status-text');
  const handDiv = document.getElementById('hand');
  const flipSound = document.getElementById('flipSound');

  const createBtn = document.getElementById('create-room');
  const joinBtn = document.getElementById('join-room');
  const startBtn = document.getElementById('start-game');
  const bidBtn = document.getElementById('place-bid');
  const resolveBtn = document.getElementById('resolve-round');
  const leaveBtn = document.getElementById('leave-room');

  const params = new URLSearchParams(location.search);
  const guestParam = params.get('guest');
  const roomParam = params.get('room');
  const isGuestMode = params.get('guest') === 'true' || !!guestParam;

  let myName = localStorage.getItem('username') || (guestParam ? guestParam : null) || `Guest${Math.floor(Math.random()*10000)}`;
  if (!localStorage.getItem('username') && isGuestMode) localStorage.setItem('username', myName);

  // fullscreen & orientation lock first interaction
  document.body.addEventListener('click', async () => {
    try { if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); } catch(e){}
    try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch(e){}
  }, { once: true });

  async function loadWallet(){
    const token = localStorage.getItem('token');
    if (!token) { coinsSpan.textContent = 'Guest'; return; }
    try {
      const res = await fetch('/api/me/wallet', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const d = await res.json();
        coinsSpan.textContent = d.coins;
      } else coinsSpan.textContent = '0';
    } catch { coinsSpan.textContent = '0'; }
  }
  loadWallet();

  socket.on('connect', () => {
    if (roomParam) socket.emit('joinRoom', { roomCode: roomParam, username: myName });
  });

  socket.on('roomCreated', ({ roomCode }) => { statusText.textContent = `Room: ${roomCode}`; alert('Room: '+roomCode); });
  socket.on('joinedRoom', ({ roomCode }) => { statusText.textContent = `Joined ${roomCode}`; });
  socket.on('roomUpdate', ({ roomCode, players, creatorId }) => {
    playersList.innerHTML = '';
    players.forEach(p => { const el=document.createElement('div'); el.className='p'; el.innerText=p + (p===localStorage.getItem('username') ? ' (You)' : ''); playersList.appendChild(el); });
    statusText.textContent = `Players (${players.length}) in ${roomCode}`;
  });

  socket.on('gameStarted', ({ hands }) => {
    statusText.textContent = 'Game started';
    // pick our hand by socket id or username
    const myHand = hands[socket.id] || hands[myName] || (() => {
      for (const k in hands) {
        if (Array.isArray(hands[k]) && hands[k].length) return hands[k];
      }
      return [];
    })();
    renderHand(myHand || []);
  });

  socket.on('cardPlayed', ({ username, card }) => { statusText.textContent = `${username} played ${card}`; });
  socket.on('walletUpdate', ({ username, coins }) => {
    if (username === localStorage.getItem('username')) coinsSpan.textContent = coins;
    statusText.textContent = `${username} wallet: ${coins}`;
  });
  socket.on('bidStarted', ({ biddingTeam, bidAmount }) => { statusText.textContent = `Bid ${bidAmount} by ${biddingTeam.join(' & ')}`; });
  socket.on('roundResolved', ({ winningTeam, perWinner, adminCut }) => {
    statusText.textContent = `Round resolved. Winners: ${winningTeam.join(', ')} (+${perWinner} each). Admin +${adminCut}`;
    loadWallet();
  });
  socket.on('logMessage', ({ message }) => { statusText.textContent = message; });
  socket.on('errorMessage', ({ message }) => { alert('Error: '+message); });

  createBtn.onclick = () => {
    const code = prompt('Room code (blank = auto):');
    socket.emit('createRoom', { roomCode: code || undefined, username: myName });
  };
  joinBtn.onclick = () => {
    const code = prompt('Enter room code:');
    if (!code) return;
    socket.emit('joinRoom', { roomCode: code.toUpperCase(), username: myName });
  };
  startBtn.onclick = () => {
    const code = prompt('Enter room code to start:');
    if (!code) return;
    socket.emit('startGame', code.toUpperCase());
  };
  bidBtn.onclick = () => {
    const room = prompt('Room code:'); if (!room) return;
    const teamRaw = prompt('Enter bidding team (comma separated usernames):'); if (!teamRaw) return;
    const team = teamRaw.split(',').map(s => s.trim());
    const bid = prompt('Enter total bid amount:'); if (!bid || isNaN(bid)) return alert('Invalid bid');
    socket.emit('startBid', { roomCode: room.toUpperCase(), biddingTeam: team, bidAmount: Number(bid) });
  };
  resolveBtn.onclick = () => {
    const room = prompt('Room code:'); if (!room) return;
    const winnersRaw = prompt('Enter winning players (comma separated):'); if (!winnersRaw) return;
    const winners = winnersRaw.split(',').map(s => s.trim());
    socket.emit('resolveRound', { roomCode: room.toUpperCase(), winningTeam: winners });
  };
  leaveBtn.onclick = () => { location.href = '/'; };

  function renderHand(cards){
    handDiv.innerHTML = '';
    if (!cards || !cards.length) { handDiv.innerHTML = '<div style="opacity:.6">No cards</div>'; return; }
    cards.forEach(c => {
      const el = document.createElement('div');
      el.className = 'card';
      el.innerText = c;
      el.onclick = () => {
        const room = prompt('Enter room code to play in:'); if (!room) return;
        socket.emit('playCard', { roomCode: room.toUpperCase(), card: c });
        el.style.opacity = '0.4';
        try { flipSound.currentTime = 0; flipSound.play(); } catch(e){}
      };
      handDiv.appendChild(el);
    });
  }

})();
