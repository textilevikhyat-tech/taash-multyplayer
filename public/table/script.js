// public/table/script.js
(() => {
  const socket = io();

  const coinsSpan = document.getElementById('coins');
  const playersList = document.getElementById('players-list');
  const statusText = document.getElementById('status-text');
  const handDiv = document.getElementById('hand');

  // buttons
  const createBtn = document.getElementById('create-room');
  const joinBtn = document.getElementById('join-room');
  const startBtn = document.getElementById('start-game');
  const bidBtn = document.getElementById('place-bid');
  const resolveBtn = document.getElementById('resolve-round');
  const leaveBtn = document.getElementById('leave-room');

  // get params
  const params = new URLSearchParams(location.search);
  const guestParam = params.get('guest');
  const roomParam = params.get('room');
  const isGuestMode = params.get('guest') === 'true' || !!guestParam;

  let myName = localStorage.getItem('username') || (guestParam ? guestParam : null) || `Guest${Math.floor(Math.random()*10000)}`;
  if (!localStorage.getItem('username') && isGuestMode) {
    localStorage.setItem('username', myName);
  }

  // try fullscreen & landscape lock on first interaction
  document.body.addEventListener('click', async () => {
    if (document.fullscreenElement == null) {
      try { await document.documentElement.requestFullscreen(); } catch(e){}
    }
    if (screen.orientation && screen.orientation.lock) {
      try { await screen.orientation.lock('landscape'); } catch(e){}
    }
  }, { once: true });

  // fetch wallet if logged in
  async function loadWallet(){
    const token = localStorage.getItem('token');
    if (!token) {
      coinsSpan.textContent = 'Guest';
      return;
    }
    try {
      const res = await fetch('/api/wallet', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const d = await res.json();
        coinsSpan.textContent = d.coins;
      } else {
        coinsSpan.textContent = '0';
      }
    } catch (e) { coinsSpan.textContent = '0'; }
  }
  loadWallet();

  // socket events
  socket.on('connect', () => {
    console.log('connected', socket.id);
    // auto join room if room param exists
    if (roomParam) {
      socket.emit('joinRoom', { roomCode: roomParam, username: myName });
      statusText.textContent = `Joined room ${roomParam}`;
    }
  });

  socket.on('roomCreated', ({ roomCode }) => {
    statusText.textContent = `Room Created: ${roomCode}`;
    alert('Room Created: ' + roomCode + '\nShare with friends to join.');
  });

  socket.on('joinedRoom', ({ roomCode }) => {
    statusText.textContent = `Joined Room: ${roomCode}`;
  });

  socket.on('roomUpdate', ({ roomCode, players, creatorId }) => {
    playersList.innerHTML = '';
    players.forEach(p => {
      const el = document.createElement('div');
      el.className = 'p';
      el.innerText = p.username + (p.id===creatorId ? ' (Host)' : '');
      playersList.appendChild(el);
    });
    statusText.textContent = `Players: ${players.length} in ${roomCode}`;
  });

  socket.on('gameStarted', ({ hands }) => {
    console.log('gameStarted', hands);
    // hands keyed by socket id; try to find our socket id key
    const myHand = hands[socket.id] || hands[myName] || (()=>{ // try by username
      for (const k in hands) {
        if (hands[k].includes && hands[k].some(c => typeof c === 'string')) return hands[k];
      }
      return [];
    })();
    renderHand(myHand || []);
    statusText.textContent = 'Game started — play your cards!';
  });

  socket.on('cardPlayed', ({ username, card }) => {
    statusText.textContent = `${username} played ${card}`;
  });

  socket.on('walletUpdate', ({ username, coins }) => {
    // update wallet display if it's the current user
    if (username === localStorage.getItem('username')) coinsSpan.textContent = coins;
    // also show log
    statusText.textContent = `${username} wallet: ${coins}`;
  });

  socket.on('bidStarted', ({ biddingTeam, bidAmount }) => {
    statusText.textContent = `Bid ${bidAmount} started by ${biddingTeam.join(' & ')}`;
  });

  socket.on('roundResolved', ({ winningTeam, perWinner, adminCut }) => {
    statusText.textContent = `Round resolved. Winners: ${winningTeam.join(', ')} (+${perWinner} each). Admin +${adminCut}`;
    loadWallet();
  });

  socket.on('logMessage', ({ message }) => {
    statusText.textContent = message;
  });

  socket.on('errorMessage', ({ message }) => {
    alert('Error: ' + message);
  });

  // UI actions
  createBtn.onclick = () => {
    const code = prompt('Enter room code (leave blank to auto-generate):');
    socket.emit('createRoom', { roomCode: code || undefined, username: myName });
  };

  joinBtn.onclick = () => {
    const code = prompt('Enter room code to join:');
    if (!code) return;
    socket.emit('joinRoom', { roomCode: code.toUpperCase(), username: myName });
  };

  startBtn.onclick = () => {
    const room = prompt('Enter room code for starting game:');
    if (!room) return;
    socket.emit('startGame', room.toUpperCase());
  };

  bidBtn.onclick = async () => {
    const room = prompt('Room code:');
    if (!room) return;
    const teamRaw = prompt('Enter bidding team members comma separated (e.g. sonu,monu):');
    if (!teamRaw) return;
    const team = teamRaw.split(',').map(s => s.trim());
    const bid = prompt('Enter total bid amount (e.g. 10):');
    if (!bid || isNaN(bid)) return alert('Invalid bid');
    socket.emit('startBid', { roomCode: room.toUpperCase(), biddingTeam: team, bidAmount: Number(bid) });
  };

  resolveBtn.onclick = () => {
    const room = prompt('Room code:');
    if (!room) return;
    const winnersRaw = prompt('Enter winning team members comma separated:');
    if (!winnersRaw) return;
    const winners = winnersRaw.split(',').map(s => s.trim());
    socket.emit('resolveRound', { roomCode: room.toUpperCase(), winningTeam: winners });
  };

  leaveBtn.onclick = () => {
    location.href = '/';
  };

  // helper render hand
  function renderHand(cards) {
    handDiv.innerHTML = '';
    if (!cards || !cards.length) {
      handDiv.innerHTML = '<div style="opacity:.6">No cards</div>';
      return;
    }
    cards.forEach(c => {
      const el = document.createElement('div');
      el.className = 'card';
      el.textContent = c;
      el.onclick = () => {
        // play card
        const room = prompt('Enter room code to play in:');
        if (!room) return;
        socket.emit('playCard', { roomCode: room.toUpperCase(), card: c });
        el.style.opacity = '0.4';
      };
      handDiv.appendChild(el);
    });
  }

})();
