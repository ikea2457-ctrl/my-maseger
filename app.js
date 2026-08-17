// ==========================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ И СОСТОЯНИЕ
// ==========================================
let currentUser = JSON.parse(localStorage.getItem('chat_user')) || null;
let currentChat = 'global';
let unsubscribeListener = null;
let groupCallListener = null;
let typingTimeout = null;
let authMode = 'login';
let replyingToMessage = null;
let allUsers = [];

// WebRTC / Звонки
let localStream = null;
let peerConnections = {};
let activeCallId = null;

// Голосовые сообщения
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

// Игра в Дурака
let currentDurakGameId = null;
let durakUnsubscribe = null;

const sendSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');
const servers = { iceServers: [{ urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }] };

// Инициализация при загрузке
document.addEventListener("DOMContentLoaded", () => {
  if (currentUser) {
    showChat();
  }
});

// Хеширование паролей (SHA-256)
async function hashPassword(password) {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ==========================================
// 1. АВТОРИЗАЦИЯ И РЕГИСТРАЦИЯ
// ==========================================
function toggleAuthMode(mode) {
  authMode = mode;
  document.getElementById('btn-show-login').classList.toggle('active', mode === 'login');
  document.getElementById('btn-show-reg').classList.toggle('active', mode === 'register');
  document.getElementById('reg-extra-fields').style.display = mode === 'register' ? 'block' : 'none';
  document.getElementById('auth-submit-btn').innerText = mode === 'login' ? 'Войти' : 'Зарегистрироваться';
}

async function handleAuth() {
  const username = document.getElementById('auth-username').value.trim().toLowerCase();
  const password = document.getElementById('auth-password').value.trim();
  if (!username || !password) return alert("Заполни логин и пароль!");

  const hashedPassword = await hashPassword(password);
  const userRef = db.collection('accounts').doc(username);

  if (authMode === 'register') {
    const doc = await userRef.get();
    if (doc.exists) return alert("Этот никнейм уже занят!");

    const displayName = document.getElementById('reg-display-name').value.trim() || username;
    const emojiAvatar = document.getElementById('reg-avatar-emoji').value.trim();
    const avatarFile = document.getElementById('reg-avatar-file').files[0];

    let avatarData = emojiAvatar || '👤';
    if (avatarFile) {
      avatarData = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.readAsDataURL(avatarFile);
      });
    }

    const userData = { username, password: hashedPassword, displayName, avatar: avatarData };
    await userRef.set(userData);
    currentUser = userData;
  } else {
    const doc = await userRef.get();
    if (!doc.exists) return alert("Пользователь не найден!");
    const data = doc.data();
    if (data.password !== hashedPassword) return alert("Неверный пароль!");
    currentUser = data;
  }

  localStorage.setItem('chat_user', JSON.stringify(currentUser));
  showChat();
}

function logout() {
  localStorage.removeItem('chat_user');
  location.reload();
}

// ==========================================
// 2. ИНТЕРФЕЙС И НАВИГАЦИЯ
// ==========================================
function showChat() {
  document.getElementById('auth-screen').classList.remove('active');
  document.getElementById('chat-screen').classList.add('active');
  document.getElementById('drawer-displayname').innerText = currentUser.displayName;
  document.getElementById('drawer-username').innerText = `@${currentUser.username}`;
  renderAvatar(currentUser.avatar, document.getElementById('drawer-avatar-box'));
  openGlobalChat();
  listenIncomingCalls();
}

function renderAvatar(avatarData, targetElement) {
  if (!targetElement) return;
  if (avatarData && avatarData.startsWith('data:image')) {
    targetElement.innerHTML = `<img src="${avatarData}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
  } else {
    targetElement.innerText = avatarData || '👤';
  }
}

function toggleMenu() {
  document.getElementById('drawer').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('active');
}

function switchTab(tab) {
  document.getElementById('tab-global').classList.toggle('active', tab === 'global');
  document.getElementById('tab-directs').classList.toggle('active', tab === 'directs');
  if (tab === 'global') openGlobalChat();
  else showDirectsList();
}

function openGlobalChat() {
  currentChat = 'global';
  document.getElementById('chat-title').innerText = "Общий Чат 🌐";
  document.getElementById('chat-subtitle').innerText = "онлайн";
  document.getElementById('back-btn').style.display = 'none';
  document.getElementById('chats-list').style.display = 'none';
  document.getElementById('messages-container').style.display = 'flex';
  document.getElementById('input-area').style.display = 'flex';
  document.getElementById('tabs-bar').style.display = 'flex';
  renderChatHeaderAvatar('🌐');
  loadMessages();
  listenGroupCalls();
}

function showDirectsList() {
  document.getElementById('chats-list').style.display = 'block';
  document.getElementById('messages-container').style.display = 'none';
  document.getElementById('input-area').style.display = 'none';
  loadUsersList();
}

// УМНАЯ ЛИЧКА: уникальный ID комнаты и загрузка только активных диалогов
function getChatId() {
  if (currentChat === 'global') return 'global';
  return [currentUser.username, currentChat].sort().join('_');
}

async function loadUsersList() {
  const container = document.getElementById('users-container');
  container.innerHTML = '<div style="padding:15px; color:var(--text-muted);">Загрузка диалогов...</div>';

  try {
    const snapshot = await db.collection('messages').get();
    const activeInteractions = new Set();

    snapshot.forEach(doc => {
      const data = doc.data();
      const chatId = data.chatId || 'global';

      if (chatId !== 'global' && chatId.includes(currentUser.username)) {
        const parts = chatId.split('_');
        const partner = parts.find(u => u !== currentUser.username);
        if (partner) {
          activeInteractions.add(partner);
        }
      }
    });

    if (activeInteractions.size === 0) {
      container.innerHTML = '<div style="padding:15px; color:var(--text-muted); text-align:center;">У тебя пока нет личных сообщений.<br>Используй поиск, чтобы найти юзера и написать первым!</div>';
      allUsers = [];
      return;
    }

    const accountsSnapshot = await db.collection('accounts').get();
    allUsers = [];

    accountsSnapshot.forEach(doc => {
      if (activeInteractions.has(doc.id)) {
        allUsers.push(doc.data());
      }
    });

    renderUsersContainer(allUsers);
  } catch (err) {
    console.error("Ошибка загрузки ЛС:", err);
    container.innerHTML = '<div style="padding:15px; color:red;">Ошибка загрузки диалогов</div>';
  }
}

function openDirectChat(targetUser) {
  if (targetUser === currentUser.username) return;
  currentChat = targetUser;
  document.getElementById('back-btn').style.display = 'block';
  document.getElementById('chats-list').style.display = 'none';
  document.getElementById('messages-container').style.display = 'flex';
  document.getElementById('input-area').style.display = 'flex';
  document.getElementById('tabs-bar').style.display = 'none';
  
  const targetObj = allUsers.find(u => u.username === targetUser);
  document.getElementById('chat-title').innerText = targetObj ? targetObj.displayName : targetUser;
  document.getElementById('chat-subtitle').innerText = `@${targetUser}`;
  renderChatHeaderAvatar(targetObj ? targetObj.avatar : '👤');

  loadMessages();
}

function renderChatHeaderAvatar(avatar) {
  const el = document.getElementById('chat-header-avatar');
  renderAvatar(avatar, el);
}

function renderUsersContainer(users) {
  const container = document.getElementById('users-container');
  container.innerHTML = '';
  users.forEach(u => {
    const item = document.createElement('div');
    item.className = 'user-item';
    item.style.cssText = 'display:flex; align-items:center; gap:12px; padding:12px 15px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.05);';
    
    const avBox = document.createElement('div');
    avBox.className = 'avatar-box';
    avBox.style.cssText = 'width:40px; height:40px; border-radius:50%; background:#242f3d; display:flex; align-items:center; justify-content:center; font-size:18px;';
    renderAvatar(u.avatar, avBox);

    const info = document.createElement('div');
    info.innerHTML = `<div style="font-weight:bold;">${u.displayName}</div><div style="font-size:12px; color:var(--text-muted);">@${u.username}</div>`;

    item.appendChild(avBox);
    item.appendChild(info);
    item.onclick = () => openDirectChat(u.username);
    container.appendChild(item);
  });
}

function filterUsersList() {
  const q = document.getElementById('user-search-input').value.toLowerCase();
  const filtered = allUsers.filter(u => u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q));
  renderUsersContainer(filtered);
}

// ==========================================
// 3. ЧАТ И СООБЩЕНИЯ (ОБЩИЙ + УМНАЯ ЛС)
// ==========================================
function loadMessages() {
  if (unsubscribeListener) unsubscribeListener();
  const targetChatId = getChatId();

  unsubscribeListener = db.collection('messages')
    .onSnapshot(snapshot => {
      const container = document.getElementById('messages-container');
      let messages = [];

      snapshot.forEach(doc => {
        const data = doc.data();
        if ((data.chatId || 'global') === targetChatId) {
          messages.push({ id: doc.id, ...data });
        }
      });

      messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

      container.innerHTML = '';
      messages.forEach(data => {
        const isMe = data.author === currentUser.username;
        const msgDiv = document.createElement('div');
        msgDiv.className = `msg ${isMe ? 'outgoing' : 'incoming'}`;
        
        let content = '';

        if (data.replyTo) {
          content += `<div style="background:rgba(0,0,0,0.2); padding:4px 8px; border-left:3px solid var(--accent-color); margin-bottom:5px; font-size:12px; border-radius:4px;">
            <b>${data.replyTo.author}:</b> ${data.replyTo.text}
          </div>`;
        }

        if (data.image) {
          content += `<img src="${data.image}" style="max-width:100%; border-radius:8px; margin-bottom:5px;">`;
        }
        if (data.audio) {
          content += `<audio src="${data.audio}" controls style="max-width:200px; height:35px;"></audio>`;
        }
        if (data.text) {
          content += `<div>${data.text}</div>`;
        }

        if (data.isDurakInvite) {
          content += `
            <div style="text-align:center; padding: 8px; background:rgba(0,0,0,0.2); border-radius:8px; margin-top:5px;">
              <b style="font-size:15px;">🃏 Игра в Дурака (${data.deckSize} карт)</b><br>
              <button class="btn primary" style="margin-top:8px; width:100%;" onclick="joinDurakGame('${data.gameId}')">Принять вызов</button>
            </div>
          `;
        }

        msgDiv.innerHTML = `
          ${!isMe ? `<div class="msg-author" onclick="replyTo('${data.author}', '${data.text || 'медиа'}')">${data.displayName || data.author}</div>` : ''}
          ${content}
        `;

        msgDiv.ondblclick = () => replyTo(data.displayName || data.author, data.text || 'Медиа-файл');
        container.appendChild(msgDiv);
      });

      container.scrollTop = container.scrollHeight;
    });
}

function sendMessage(extraData = {}) {
  const input = document.getElementById('message-input');
  const text = input.value.trim();

  if (text || extraData.image || extraData.audio || extraData.isDurakInvite) {
    const payload = {
      chatId: getChatId(),
      text: text,
      author: currentUser.username,
      displayName: currentUser.displayName,
      avatar: currentUser.avatar,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      ...extraData
    };

    if (replyingToMessage) {
      payload.replyTo = replyingToMessage;
      cancelReply();
    }

    db.collection('messages').add(payload);
    sendSound.play().catch(() => {});
    input.value = '';
  }
}

function handleKeyPress(e) {
  if (e.key === 'Enter') sendMessage();
}

function replyTo(author, text) {
  replyingToMessage = { author, text };
  document.getElementById('reply-preview-text').innerText = `Ответ на ${author}: ${text}`;
  document.getElementById('reply-preview').style.display = 'flex';
}

function cancelReply() {
  replyingToMessage = null;
  document.getElementById('reply-preview').style.display = 'none';
}

function sendImage(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    sendMessage({ image: ev.target.result });
  };
  reader.readAsDataURL(file);
}

// Поиск по сообщениям
function toggleSearch() {
  const bar = document.getElementById('search-bar');
  bar.style.display = bar.style.display === 'none' ? 'block' : 'none';
}

function searchMessages() {
  const q = document.getElementById('search-input').value.toLowerCase();
  const msgs = document.querySelectorAll('.messages-container .msg');
  msgs.forEach(m => {
    const t = m.innerText.toLowerCase();
    m.style.display = t.includes(q) ? 'block' : 'none';
  });
}

// Индикатор печати
function handleTyping() {
  db.collection('typing').doc(getChatId()).set({
    [currentUser.username]: true
  }, { merge: true });

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    db.collection('typing').doc(getChatId()).set({
      [currentUser.username]: false
    }, { merge: true });
  }, 2000);
}

// ==========================================
// 4. ГОЛОСОВЫЕ СООБЩЕНИЯ
// ==========================================
async function toggleVoiceRecord() {
  const voiceBtn = document.getElementById('voice-btn');
  if (!isRecording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = ev => sendMessage({ audio: ev.target.result });
        reader.readAsDataURL(audioBlob);
      };

      mediaRecorder.start();
      isRecording = true;
      voiceBtn.innerText = '🔴';
    } catch (e) {
      alert("Нет доступа к микрофону!");
    }
  } else {
    mediaRecorder.stop();
    isRecording = false;
    voiceBtn.innerText = '🎙️';
  }
}

// ==========================================
// 5. РЕДАКТИРОВАНИЕ ПРОФИЛЯ
// ==========================================
function openProfileModal() {
  document.getElementById('edit-display-name').value = currentUser.displayName;
  document.getElementById('edit-avatar-emoji').value = currentUser.avatar.startsWith('data:') ? '' : currentUser.avatar;
  document.getElementById('profile-modal').classList.add('active');
  toggleMenu();
}

function closeProfileModal() {
  document.getElementById('profile-modal').classList.remove('active');
}

async function saveProfileChanges() {
  const newName = document.getElementById('edit-display-name').value.trim() || currentUser.displayName;
  const newEmoji = document.getElementById('edit-avatar-emoji').value.trim();
  const newFile = document.getElementById('edit-avatar-file').files[0];

  let newAvatar = currentUser.avatar;
  if (newEmoji) newAvatar = newEmoji;
  if (newFile) {
    newAvatar = await new Promise(res => {
      const r = new FileReader();
      r.onload = ev => res(ev.target.result);
      r.readAsDataURL(newFile);
    });
  }

  currentUser.displayName = newName;
  currentUser.avatar = newAvatar;

  await db.collection('accounts').doc(currentUser.username).update({
    displayName: newName,
    avatar: newAvatar
  });

  localStorage.setItem('chat_user', JSON.stringify(currentUser));
  document.getElementById('drawer-displayname').innerText = newName;
  renderAvatar(newAvatar, document.getElementById('drawer-avatar-box'));
  closeProfileModal();
}

// ==========================================
// 6. WebRTC И ЗВОНКИ
// ==========================================
function listenIncomingCalls() {
  db.collection('calls').where('target', '==', currentUser.username)
    .where('status', '==', 'calling')
    .onSnapshot(snap => {
      snap.forEach(doc => {
        const call = doc.data();
        activeCallId = doc.id;
        document.getElementById('caller-name').innerText = `Звонит: ${call.callerDisplayName || call.caller}`;
        document.getElementById('incoming-call-box').style.display = 'flex';
      });
    });
}

async function startOrJoinGroupCall() {
  document.getElementById('call-modal').classList.add('active');
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  document.getElementById('local-video').srcObject = localStream;
}

function toggleMic() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;
    document.getElementById('mic-btn').innerText = audioTrack.enabled ? '🎤' : '🔇';
  }
}

function toggleCam() {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    videoTrack.enabled = !videoTrack.enabled;
    document.getElementById('cam-btn').innerText = videoTrack.enabled ? '📷' : '🚫';
  }
}

function hangUpGroupCall() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
  }
  document.getElementById('call-modal').classList.remove('active');
}

function answerCall() {
  document.getElementById('incoming-call-box').style.display = 'none';
  startOrJoinGroupCall();
}

function rejectCall() {
  if (activeCallId) {
    db.collection('calls').doc(activeCallId).update({ status: 'rejected' });
  }
  document.getElementById('incoming-call-box').style.display = 'none';
}

function listenGroupCalls() {}

// ==========================================
// 7. ИГРА В ДУРАКА (54 / 108 карт)
// ==========================================
function openDurakInviteModal() {
  if (currentChat === 'global') {
    return alert("Выберите соперника в личных сообщениях, чтобы пригласить его в игру!");
  }
  document.getElementById('durak-modal').classList.add('active');
  document.getElementById('durak-setup').style.display = 'block';
  document.getElementById('durak-table').style.display = 'none';
}

function closeDurakModal() {
  document.getElementById('durak-modal').classList.remove('active');
  if (durakUnsubscribe) durakUnsubscribe();
}

async function createDurakGame() {
  const deckSize = parseInt(document.querySelector('input[name="deck-size"]:checked').value);
  const deck = generateDeck(deckSize);
  const trumpCard = deck.pop();

  const p1Hand = deck.splice(0, 6);
  const p2Hand = deck.splice(0, 6);

  const gameRef = await db.collection('durak_games').add({
    player1: currentUser.username,
    player2: currentChat,
    deck: deck,
    trump: trumpCard,
    p1Hand: p1Hand,
    p2Hand: p2Hand,
    board: [],
    attacker: currentUser.username,
    defender: currentChat,
    status: 'active'
  });

  sendMessage({ isDurakInvite: true, gameId: gameRef.id, deckSize: deckSize });
  alert("Приглашение отправлено!");
  closeDurakModal();
}

function generateDeck(size) {
  const suits = ['♠', '♥', '♦', '♣'];
  const values = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  let deck = [];

  const copies = size === 108 ? 2 : 1;
  for (let c = 0; c < copies; c++) {
    for (let s of suits) {
      for (let v of values) {
        deck.push({ suit: s, value: v, isRed: s === '♥' || s === '♦' });
      }
    }
    deck.push({ suit: '🃏', value: 'JOKER', isRed: true });
    deck.push({ suit: '🃏', value: 'JOKER', isRed: false });
  }

  return deck.sort(() => Math.random() - 0.5);
}

function joinDurakGame(gameId) {
  currentDurakGameId = gameId;
  document.getElementById('durak-modal').classList.add('active');
  document.getElementById('durak-setup').style.display = 'none';
  document.getElementById('durak-table').style.display = 'flex';

  listenDurakGame();
}

function listenDurakGame() {
  if (durakUnsubscribe) durakUnsubscribe();

  durakUnsubscribe = db.collection('durak_games').doc(currentDurakGameId).onSnapshot(doc => {
    if (!doc.exists) return;
    const game = doc.data();
    renderDurakBoard(game);
  });
}

function renderDurakBoard(game) {
  const isP1 = currentUser.username === game.player1;
  const myHand = isP1 ? game.p1Hand : game.p2Hand;
  const oppHand = isP1 ? game.p2Hand : game.p1Hand;

  document.getElementById('durak-trump-info').innerText = `Козырь: ${game.trump.value} ${game.trump.suit}`;
  document.getElementById('durak-deck-count').innerText = `Карт в колоде: ${game.deck.length}`;
  document.getElementById('durak-turn-info').innerText = `Ходит: @${game.attacker}`;

  const oppBox = document.getElementById('durak-opponent-hand');
  oppBox.innerHTML = '';
  oppHand.forEach(() => {
    const card = document.createElement('div');
    card.className = 'card back';
    oppBox.appendChild(card);
  });

  const myBox = document.getElementById('durak-my-hand');
  myBox.innerHTML = '';
  myHand.forEach((cardData, idx) => {
    const card = createCardElement(cardData);
    card.onclick = () => playCard(cardData, idx, game);
    myBox.appendChild(card);
  });

  const boardBox = document.getElementById('durak-board');
  boardBox.innerHTML = '';
  game.board.forEach(pair => {
    const pairDiv = document.createElement('div');
    pairDiv.className = 'card-pair';
    pairDiv.appendChild(createCardElement(pair.attack));
    if (pair.defend) {
      const def = createCardElement(pair.defend);
      def.classList.add('defend-card');
      pairDiv.appendChild(def);
    }
    boardBox.appendChild(pairDiv);
  });
}

function createCardElement(data) {
  const card = document.createElement('div');
  card.className = `card ${data.isRed ? 'red' : ''}`;
  card.innerHTML = `<div>${data.value}</div><div style="font-size:20px; text-align:center;">${data.suit}</div>`;
  return card;
}

async function playCard(card, index, game) {
  const isAttacker = currentUser.username === game.attacker;
  const isP1 = currentUser.username === game.player1;

  if (isAttacker) {
    game.board.push({ attack: card, defend: null });
    if (isP1) game.p1Hand.splice(index, 1);
    else game.p2Hand.splice(index, 1);
  } else {
    const undefIndex = game.board.findIndex(p => !p.defend);
    if (undefIndex !== -1) {
      game.board[undefIndex].defend = card;
      if (isP1) game.p1Hand.splice(index, 1);
      else game.p2Hand.splice(index, 1);
    }
  }

  await db.collection('durak_games').doc(currentDurakGameId).update(game);
}

async function handleDurakAction() {
  const gameRef = db.collection('durak_games').doc(currentDurakGameId);
  const doc = await gameRef.get();
  let game = doc.data();

  const isAttacker = currentUser.username === game.attacker;

  if (isAttacker) {
    game.board = [];
    const temp = game.attacker;
    game.attacker = game.defender;
    game.defender = temp;
  } else {
    const isP1 = currentUser.username === game.player1;
    game.board.forEach(p => {
      if (p.attack) (isP1 ? game.p1Hand : game.p2Hand).push(p.attack);
      if (p.defend) (isP1 ? game.p1Hand : game.p2Hand).push(p.defend);
    });
    game.board = [];
  }

  await gameRef.update(game);
}