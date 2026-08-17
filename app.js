// ==========================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ И ИНИЦИАЛИЗАЦИЯ
// ==========================================
let db = null;
let currentUser = null;
let currentChatId = 'global';
let activeTab = 'global';
let authMode = 'login';
let replyMessage = null;
let unsubscribeMessages = null;
let allLoadedChats = [];

// Медиа
let mediaRecorder = null;
let audioChunks = [];
let isRecordingVoice = false;
let isRecordingCircle = false;

// Дурак
let currentDurakGameId = null;
let durakUnsubscribe = null;

// Старт приложения после загрузки DOM
window.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  checkSavedUser();
});

function initFirebase() {
  try {
    if (typeof firebase !== 'undefined' && firebase.apps.length) {
      db = firebase.firestore();
      console.log("✅ Firebase Firestore успешно подключен");
    } else {
      console.error("❌ Firebase SDK не инициализирован. Проверь firebase-config.js!");
    }
  } catch (e) {
    console.error("❌ Ошибка инициализации БД:", e);
  }
}

function checkSavedUser() {
  const savedUser = localStorage.getItem('chat_user');
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      showChatScreen();
    } catch (e) {
      localStorage.removeItem('chat_user');
    }
  }
}

// ==========================================
// АВТОРИЗАЦИЯ И РЕГИСТРАЦИЯ
// ==========================================

window.toggleAuthMode = function(mode) {
  authMode = mode;
  document.getElementById('btn-show-login').classList.toggle('active', mode === 'login');
  document.getElementById('btn-show-reg').classList.toggle('active', mode === 'register');
  document.getElementById('reg-extra-fields').style.display = mode === 'register' ? 'block' : 'none';
  document.getElementById('auth-submit-btn').innerText = mode === 'login' ? 'Войти' : 'Зарегистрироваться';
};

window.handleAuth = async function() {
  console.log("🔘 Нажата кнопка авторизации...");

  if (!db) {
    if (typeof firebase !== 'undefined' && firebase.apps.length) {
      db = firebase.firestore();
    } else {
      alert("❌ База данных не подключена! Проверь подключение к инету и firebase-config.js");
      return;
    }
  }

  const usernameInput = document.getElementById('auth-username').value.trim();
  const passwordInput = document.getElementById('auth-password').value.trim();

  if (!usernameInput || !passwordInput) {
    alert("⚠️ Заполни логин и пароль!");
    return;
  }

  const username = usernameInput.toLowerCase();
  const submitBtn = document.getElementById('auth-submit-btn');
  submitBtn.disabled = true;
  submitBtn.innerText = 'Загрузка...';

  try {
    if (authMode === 'login') {
      const doc = await db.collection('users').doc(username).get();

      if (doc.exists) {
        const userData = doc.data();
        if (userData.password === passwordInput) {
          currentUser = userData;
          localStorage.setItem('chat_user', JSON.stringify(currentUser));
          showChatScreen();
        } else {
          alert("❌ Неверный пароль!");
        }
      } else {
        alert("❌ Пользователь не найден! Перейди во вкладку 'Регистрация'.");
      }
    } else {
      // Регистрация
      const doc = await db.collection('users').doc(username).get();
      if (doc.exists) {
        alert("⚠️ Этот логин уже занят!");
        submitBtn.disabled = false;
        submitBtn.innerText = 'Зарегистрироваться';
        return;
      }

      const displayName = document.getElementById('reg-display-name').value.trim() || usernameInput;
      const avatarEmoji = document.getElementById('reg-avatar-emoji').value.trim() || '🚀';
      let avatarUrl = '';

      const avatarFile = document.getElementById('reg-avatar-file').files[0];
      if (avatarFile) {
        avatarUrl = await convertFileToBase64(avatarFile);
      }

      const newUser = {
        username: username,
        password: passwordInput,
        displayName: displayName,
        avatarEmoji: avatarEmoji,
        avatarUrl: avatarUrl
      };

      await db.collection('users').doc(username).set(newUser);
      currentUser = newUser;
      localStorage.setItem('chat_user', JSON.stringify(currentUser));
      showChatScreen();
    }
  } catch (err) {
    console.error("❌ Ошибка авторизации:", err);
    alert(" Ошибка доступа к Firestore: " + err.message + "\n\nПроверь Rules в консоли Firebase!");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = authMode === 'login' ? 'Войти' : 'Зарегистрироваться';
  }
};

window.logout = function() {
  localStorage.removeItem('chat_user');
  location.reload();
};

function showChatScreen() {
  document.getElementById('auth-screen').classList.remove('active');
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('chat-screen').style.display = 'flex';
  updateDrawerUI();
  switchTab('global');
}

// ==========================================
// ИНТЕРФЕЙС И НАВИГАЦИЯ
// ==========================================

window.toggleMenu = function() {
  document.getElementById('drawer').classList.toggle('active');
  document.getElementById('overlay').classList.toggle('active');
};

function updateDrawerUI() {
  document.getElementById('drawer-displayname').innerText = currentUser.displayName;
  document.getElementById('drawer-username').innerText = `@${currentUser.username}`;
  renderAvatar(currentUser, document.getElementById('drawer-avatar-box'));
}

function renderAvatar(userObj, targetElement) {
  targetElement.innerHTML = '';
  if (userObj.avatarUrl) {
    const img = document.createElement('img');
    img.src = userObj.avatarUrl;
    targetElement.appendChild(img);
  } else {
    targetElement.innerText = userObj.avatarEmoji || '👤';
  }
}

window.switchTab = function(tab) {
  activeTab = tab;
  document.getElementById('tab-global').classList.toggle('active', tab === 'global');
  document.getElementById('tab-directs').classList.toggle('active', tab === 'directs');

  const chatsList = document.getElementById('chats-list');
  const messagesContainer = document.getElementById('messages-container');
  const inputArea = document.getElementById('input-area');
  const backBtn = document.getElementById('back-btn');

  if (tab === 'global') {
    chatsList.style.display = 'none';
    messagesContainer.style.display = 'flex';
    inputArea.style.display = 'flex';
    backBtn.style.display = 'none';
    document.getElementById('chat-title').innerText = 'Общий Чат 🌐';
    renderAvatar({ avatarEmoji: '🌐' }, document.getElementById('chat-header-avatar'));
    listenMessages('global');
  } else if (tab === 'directs') {
    chatsList.style.display = 'block';
    messagesContainer.style.display = 'none';
    inputArea.style.display = 'none';
    backBtn.style.display = 'none';
    document.getElementById('chat-title').innerText = 'Личные сообщения';
    loadDirectsList();
  }
};

// ==========================================
// ЛИЧНЫЕ СООБЩЕНИЯ (ДИАЛОГИ)
// ==========================================

async function loadDirectsList() {
  const container = document.getElementById('users-container');
  container.innerHTML = '<div style="padding:15px; text-align:center; color:#888">Загрузка диалогов...</div>';

  try {
    const snapshot = await db.collection('messages').get();
    const chatsMap = new Map();

    snapshot.forEach(doc => {
      const data = doc.data();
      const chatId = data.chatId || 'global';

      if (chatId !== 'global' && chatId.includes(currentUser.username)) {
        const parts = chatId.split('_');
        const partner = parts.find(u => u !== currentUser.username);

        if (partner) {
          const existing = chatsMap.get(partner);
          const msgTime = data.timestamp ? data.timestamp.seconds : 0;

          if (!existing || msgTime > existing.time) {
            chatsMap.set(partner, {
              lastMsg: data.text || (data.imageUrl ? '📷 Фото' : data.audioUrl ? '🎙️ Голосовое' : data.circleUrl ? '📹 Видео' : 'Сообщение'),
              time: msgTime
            });
          }
        }
      }
    });

    if (chatsMap.size === 0) {
      container.innerHTML = '<div style="padding:20px; text-align:center; color:#888">У вас пока нет диалогов.<br>Введи логин в поиске выше, чтобы написать первым!</div>';
      allLoadedChats = [];
      return;
    }

    const accountsSnapshot = await db.collection('users').get();
    allLoadedChats = [];

    accountsSnapshot.forEach(doc => {
      if (chatsMap.has(doc.id)) {
        const userData = doc.data();
        const chatMetaData = chatsMap.get(doc.id);
        allLoadedChats.push({
          ...userData,
          lastMsg: chatMetaData.lastMsg,
          time: chatMetaData.time
        });
      }
    });

    allLoadedChats.sort((a, b) => b.time - a.time);
    renderUsersList(allLoadedChats);
  } catch (e) {
    console.error("❌ Ошибка загрузки ЛС:", e);
  }
}

function renderUsersList(users) {
  const container = document.getElementById('users-container');
  container.innerHTML = '';

  users.forEach(u => {
    const item = document.createElement('div');
    item.className = 'chat-item';

    const avBox = document.createElement('div');
    avBox.className = 'avatar-box';
    renderAvatar(u, avBox);

    const timeStr = u.time ? new Date(u.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    item.innerHTML = `
      <div class="chat-item-info">
        <div class="chat-item-top">
          <span class="chat-item-name">${u.displayName}</span>
          <span class="chat-item-time">${timeStr}</span>
        </div>
        <div class="chat-item-lastmsg">${u.lastMsg || `@${u.username}`}</div>
      </div>
    `;

    item.prepend(avBox);
    item.onclick = () => openDirectChat(u);
    container.appendChild(item);
  });
}

window.filterUsersList = async function() {
  const query = document.getElementById('user-search-input').value.trim().toLowerCase();

  if (!query) {
    renderUsersList(allLoadedChats);
    return;
  }

  const snapshot = await db.collection('users').get();
  const searchResults = [];

  snapshot.forEach(doc => {
    const u = doc.data();
    if (u.username !== currentUser.username && (u.username.toLowerCase().includes(query) || u.displayName.toLowerCase().includes(query))) {
      searchResults.push({
        ...u,
        lastMsg: `@${u.username}`
      });
    }
  });

  renderUsersList(searchResults);
};

function openDirectChat(partnerUser) {
  const chatId = [currentUser.username, partnerUser.username].sort().join('_');
  document.getElementById('chats-list').style.display = 'none';
  document.getElementById('messages-container').style.display = 'flex';
  document.getElementById('input-area').style.display = 'flex';
  document.getElementById('back-btn').style.display = 'block';

  document.getElementById('chat-title').innerText = partnerUser.displayName;
  renderAvatar(partnerUser, document.getElementById('chat-header-avatar'));

  listenMessages(chatId);
}

// ==========================================
// ЛОГИКА ЧАТА И СООБЩЕНИЙ
// ==========================================

function listenMessages(chatId) {
  currentChatId = chatId;
  const container = document.getElementById('messages-container');
  container.innerHTML = '';

  if (unsubscribeMessages) unsubscribeMessages();

  unsubscribeMessages = db.collection('messages')
    .where('chatId', '==', chatId)
    .orderBy('timestamp', 'asc')
    .onSnapshot(snapshot => {
      container.innerHTML = '';
      snapshot.forEach(doc => {
        renderMessageItem(doc.data(), doc.id);
      });
      container.scrollTop = container.scrollHeight;
    }, err => console.error("❌ Ошибка получения сообщений:", err));
}

function renderMessageItem(msg, id) {
  const container = document.getElementById('messages-container');
  const div = document.createElement('div');
  div.className = `message ${msg.sender === currentUser.username ? 'my' : ''}`;

  let contentHtml = `<div class="msg-author">${msg.senderName || msg.sender}</div>`;

  if (msg.replyToText) {
    contentHtml += `<div style="border-left:2px solid #fff; padding-left:6px; margin-bottom:4px; font-size:12px; opacity:0.8;">${msg.replyToText}</div>`;
  }

  if (msg.text) contentHtml += `<div>${escapeHtml(msg.text)}</div>`;
  if (msg.imageUrl) contentHtml += `<img src="${msg.imageUrl}" class="msg-img">`;
  if (msg.audioUrl) contentHtml += `<audio src="${msg.audioUrl}" controls style="max-width:100%; margin-top:4px;"></audio>`;
  if (msg.circleUrl) contentHtml += `<video src="${msg.circleUrl}" class="circle-video" controls autoplay loop muted></video>`;

  div.innerHTML = contentHtml;
  div.ondblclick = () => setReply(msg);
  container.appendChild(div);
}

window.sendMessage = async function(extraData = {}) {
  const input = document.getElementById('message-input');
  const text = input.value.trim();

  if (!text && !extraData.imageUrl && !extraData.audioUrl && !extraData.circleUrl) return;

  const msgPayload = {
    chatId: currentChatId,
    sender: currentUser.username,
    senderName: currentUser.displayName,
    text: text,
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    ...extraData
  };

  if (replyMessage) {
    msgPayload.replyToText = `${replyMessage.sender}: ${replyMessage.text || 'Вложение'}`;
    cancelReply();
  }

  await db.collection('messages').add(msgPayload);
  input.value = '';
};

window.handleKeyPress = function(e) {
  if (e.key === 'Enter') window.sendMessage();
};

function setReply(msg) {
  replyMessage = msg;
  document.getElementById('reply-preview-text').innerText = `Ответ для ${msg.sender}: ${msg.text || 'Вложение'}`;
  document.getElementById('reply-preview').style.display = 'flex';
}

window.cancelReply = function() {
  replyMessage = null;
  document.getElementById('reply-preview').style.display = 'none';
};

window.toggleSearch = function() {
  const sb = document.getElementById('search-bar');
  sb.style.display = sb.style.display === 'none' ? 'block' : 'none';
};

window.searchMessages = function() {
  const q = document.getElementById('search-input').value.toLowerCase();
  const msgs = document.querySelectorAll('.message');
  msgs.forEach(m => {
    m.style.display = m.innerText.toLowerCase().includes(q) ? 'block' : 'none';
  });
};

window.handleTyping = function() {};

// ==========================================
// МЕДИА (ГОЛОСОВЫЕ / КРУЖОЧКИ / ФОТО)
// ==========================================

window.sendImage = async function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const base64 = await convertFileToBase64(file);
  window.sendMessage({ imageUrl: base64 });
};

function convertFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

window.toggleVoiceRecord = async function() {
  const btn = document.getElementById('voice-btn');
  if (!isRecordingVoice) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const base64 = await convertBlobToBase64(blob);
        window.sendMessage({ audioUrl: base64 });
      };
      mediaRecorder.start();
      isRecordingVoice = true;
      btn.style.color = '#ff4d4d';
    } catch (e) {
      alert("⚠️ Нет доступа к микрофону!");
    }
  } else {
    mediaRecorder.stop();
    isRecordingVoice = false;
    btn.style.color = '#fff';
  }
};

window.toggleCircleRecord = async function() {
  const btn = document.getElementById('circle-btn');
  if (!isRecordingCircle) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunks, { type: 'video/webm' });
        const base64 = await convertBlobToBase64(blob);
        window.sendMessage({ circleUrl: base64 });
      };
      mediaRecorder.start();
      isRecordingCircle = true;
      btn.style.color = '#ff4d4d';
    } catch (e) {
      alert("⚠️ Нет доступа к камере!");
    }
  } else {
    mediaRecorder.stop();
    isRecordingCircle = false;
    btn.style.color = '#fff';
  }
};

function convertBlobToBase64(blob) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// ==========================================
// НАСТРОЙКИ ПРОФИЛЯ
// ==========================================

window.openProfileModal = function() {
  window.toggleMenu();
  document.getElementById('edit-display-name').value = currentUser.displayName;
  document.getElementById('edit-avatar-emoji').value = currentUser.avatarEmoji || '';
  document.getElementById('profile-modal').classList.add('active');
};

window.closeProfileModal = function() {
  document.getElementById('profile-modal').classList.remove('active');
};

window.saveProfileChanges = async function() {
  const newName = document.getElementById('edit-display-name').value.trim();
  const newEmoji = document.getElementById('edit-avatar-emoji').value.trim();
  const file = document.getElementById('edit-avatar-file').files[0];

  if (newName) currentUser.displayName = newName;
  if (newEmoji) currentUser.avatarEmoji = newEmoji;
  if (file) currentUser.avatarUrl = await convertFileToBase64(file);

  await db.collection('users').doc(currentUser.username).update(currentUser);
  localStorage.setItem('chat_user', JSON.stringify(currentUser));

  updateDrawerUI();
  window.closeProfileModal();
};

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
  });
}

// ==========================================
// МОДУЛЬ: ДУРАК ОНЛАЙН
// ==========================================

window.openDurakInviteModal = function() {
  document.getElementById('durak-modal').classList.add('active');
};

window.closeDurakModal = function() {
  document.getElementById('durak-modal').classList.remove('active');
  if (durakUnsubscribe) durakUnsubscribe();
};

window.createDurakGame = async function() {
  const deckSize = parseInt(document.querySelector('input[name="deck-size"]:checked').value);
  const suits = ['♠', '♥', '♦', '♣'];
  const values54 = ['6','7','8','9','10','J','Q','K','A'];

  let deck = [];
  suits.forEach(s => {
    values54.forEach(v => {
      deck.push({ suit: s, value: v, isRed: s === '♥' || s === '♦' });
    });
  });

  if (deckSize === 108) deck = [...deck, ...deck];
  deck.sort(() => Math.random() - 0.5);

  const trump = deck[deck.length - 1];
  const p1Hand = deck.splice(0, 6);

  const gameData = {
    host: currentUser.username,
    guest: null,
    deck: deck,
    trump: trump,
    board: [],
    turn: currentUser.username,
    hands: {
      [currentUser.username]: p1Hand
    },
    status: 'waiting'
  };

  const docRef = await db.collection('durak_games').add(gameData);
  currentDurakGameId = docRef.id;

  window.sendMessage({ text: `🃏 Игра в Дурака создана! ID: ${currentDurakGameId}` });
  listenDurakGame(currentDurakGameId);
};

function listenDurakGame(gameId) {
  document.getElementById('durak-setup').style.display = 'none';
  document.getElementById('durak-table').style.display = 'block';

  durakUnsubscribe = db.collection('durak_games').doc(gameId).onSnapshot(doc => {
    if (!doc.exists) return;
    const g = doc.data();
    renderDurakTable(g);
  });
}

function renderDurakTable(g) {
  document.getElementById('durak-trump-info').innerText = `Козырь: ${g.trump.suit} ${g.trump.value}`;
  document.getElementById('durak-deck-count').innerText = `Карт в колоде: ${g.deck.length}`;
  document.getElementById('durak-turn-info').innerText = `Ход: ${g.turn}`;

  const myHand = g.hands[currentUser.username] || [];
  const myHandContainer = document.getElementById('durak-my-hand');
  myHandContainer.innerHTML = '';

  myHand.forEach((card, index) => {
    const cardEl = document.createElement('div');
    cardEl.className = `durak-card ${card.isRed ? 'red' : ''}`;
    cardEl.innerText = `${card.value}\n${card.suit}`;
    cardEl.onclick = () => playDurakCard(g, index);
    myHandContainer.appendChild(cardEl);
  });

  const boardContainer = document.getElementById('durak-board');
  boardContainer.innerHTML = '';
  g.board.forEach(c => {
    const cardEl = document.createElement('div');
    cardEl.className = `durak-card ${c.isRed ? 'red' : ''}`;
    cardEl.innerText = `${c.value}\n${c.suit}`;
    boardContainer.appendChild(cardEl);
  });
}

async function playDurakCard(game, cardIndex) {
  if (game.turn !== currentUser.username) return alert("Сейчас не твой ход!");

  const myHand = game.hands[currentUser.username];
  const card = myHand.splice(cardIndex, 1)[0];
  game.board.push(card);

  await db.collection('durak_games').doc(currentDurakGameId).update({
    board: game.board,
    [`hands.${currentUser.username}`]: myHand
  });
}

window.handleDurakAction = function() {};

// ==========================================
// МОДУЛЬ: ЗВОНКИ
// ==========================================

window.startOrJoinGroupCall = function() {
  document.getElementById('call-modal').classList.add('active');
  navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
    document.getElementById('local-video').srcObject = stream;
  }).catch(() => alert("⚠️ Нет доступа к камере/микрофону"));
};

window.hangUpGroupCall = function() {
  document.getElementById('call-modal').classList.remove('active');
  const video = document.getElementById('local-video');
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
  }
};

window.toggleMic = function() {};
window.toggleCam = function() {};
window.answerCall = function() {};
window.rejectCall = function() {};