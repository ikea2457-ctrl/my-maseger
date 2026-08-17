let currentUser = JSON.parse(localStorage.getItem('chat_user')) || null;
let currentChat = 'global';
let unsubscribeListener = null;
let groupCallListener = null;
let typingTimeout = null;
let authMode = 'login';
let replyingToMessage = null;
let allUsers = [];

// Переменные WebRTC & Групповых звонков
let localStream = null;
let peerConnections = {}; // Map: username -> RTCPeerConnection
let activeCallId = null;
let isMicOn = true;
let isCamOn = true;

// Переменные Записи Голосовых
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

const sendSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');

const servers = {
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
  ]
};

async function hashPassword(password) {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const ringtone = {
  audio: new Audio('https://assets.mixkit.co/active_storage/sfx/1358/1358-preview.mp3'),
  vibrateInterval: null,
  play() {
    this.audio.loop = true;
    this.audio.currentTime = 0;
    this.audio.play().catch(e => console.log(e));
    if ("vibrate" in navigator) {
      navigator.vibrate([1000, 1000]);
      this.vibrateInterval = setInterval(() => navigator.vibrate([1000, 1000]), 2000);
    }
  },
  stop() {
    this.audio.pause();
    this.audio.currentTime = 0;
    if (this.vibrateInterval) clearInterval(this.vibrateInterval);
    if ("vibrate" in navigator) navigator.vibrate(0);
  }
};

document.addEventListener("DOMContentLoaded", () => {
  if (currentUser) {
    showChat();
  }
});

// ==========================================
// ПУШ-УВЕДОМЛЕНИЯ
// ==========================================
async function initPushNotifications() {
  if ('serviceWorker' in navigator && 'Notification' in window) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      console.log('Service Worker зареган!', reg);
      
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        console.log('Разрешение на пуши получено.');
      }
    } catch (e) {
      console.log('Ошибка инициализации пушей:', e);
    }
  }
}

function triggerPushNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, {
          body: body,
          icon: 'https://cdn-icons-png.flaticon.com/512/906/906377.png'
        });
      });
    } else {
      new Notification(title, { body: body });
    }
  }
}

// ==========================================
// АВТОРИЗАЦИЯ И ПРОФИЛЬ
// ==========================================
function toggleAuthMode(mode) {
  authMode = mode;
  document.getElementById('btn-show-login').style.background = mode === 'login' ? '#5288c1' : '#334455';
  document.getElementById('btn-show-reg').style.background = mode === 'register' ? '#5288c1' : '#334455';
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
      if (avatarFile.size > 1 * 1024 * 1024) return alert("Аватарка слишком большая! До 1 МБ.");
      avatarData = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.readAsDataURL(avatarFile);
      });
    }

    const userData = {
      username: username,
      password: hashedPassword,
      displayName: displayName,
      avatar: avatarData,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    await userRef.set(userData);
    currentUser = userData;
    localStorage.setItem('chat_user', JSON.stringify(currentUser));
    showChat();

  } else {
    const doc = await userRef.get();
    if (!doc.exists) return alert("Пользователь не найден!");

    const data = doc.data();
    if (data.password !== hashedPassword) return alert("Неверный пароль!");

    currentUser = data;
    localStorage.setItem('chat_user', JSON.stringify(currentUser));
    showChat();
  }
}

function logout() {
  ringtone.stop();
  localStorage.removeItem('chat_user');
  location.reload();
}

function renderAvatar(avatarData, targetElement) {
  if (avatarData && avatarData.startsWith('data:image')) {
    targetElement.innerHTML = `<img src="${avatarData}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
  } else {
    targetElement.innerText = avatarData || '👤';
  }
}

function openProfileModal() {
  document.getElementById('edit-display-name').value = currentUser.displayName;
  document.getElementById('profile-modal').classList.add('active');
}

function closeProfileModal() {
  document.getElementById('profile-modal').classList.remove('active');
}

async function saveProfileChanges() {
  const newName = document.getElementById('edit-display-name').value.trim();
  const emojiAvatar = document.getElementById('edit-avatar-emoji').value.trim();
  const avatarFile = document.getElementById('edit-avatar-file').files[0];

  if (!newName) return alert("Никнейм не может быть пустым!");

  let newAvatar = currentUser.avatar;

  if (emojiAvatar) {
    newAvatar = emojiAvatar;
  } else if (avatarFile) {
    if (avatarFile.size > 1 * 1024 * 1024) return alert("Аватарка слишком большая! До 1 МБ.");
    newAvatar = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.readAsDataURL(avatarFile);
    });
  }

  currentUser.displayName = newName;
  currentUser.avatar = newAvatar;
  localStorage.setItem('chat_user', JSON.stringify(currentUser));

  await db.collection('accounts').doc(currentUser.username).update({
    displayName: newName,
    avatar: newAvatar
  });

  updateUserPresence();
  showChat();
  closeProfileModal();
}

function showChat() {
  document.getElementById('auth-screen').classList.remove('active');
  document.getElementById('chat-screen').classList.add('active');
  
  document.getElementById('drawer-displayname').innerText = currentUser.displayName;
  document.getElementById('drawer-username').innerText = `@${currentUser.username}`;
  renderAvatar(currentUser.avatar, document.getElementById('drawer-avatar-box'));

  updateUserPresence();
  setInterval(updateUserPresence, 30000);

  initPushNotifications();
  listenForIncomingCalls();
  openGlobalChat();
}

function updateUserPresence() {
  db.collection('users').doc(currentUser.username).set({
    name: currentUser.username,
    displayName: currentUser.displayName,
    avatar: currentUser.avatar,
    lastSeen: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

function toggleMenu() {
  document.getElementById('drawer').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('active');
}

function switchTab(tab) {
  document.getElementById('tab-global').classList.toggle('active', tab === 'global');
  document.getElementById('tab-directs').classList.toggle('active', tab === 'directs');

  if (tab === 'global') {
    openGlobalChat();
  } else {
    showDirectsList();
  }
}

function openGlobalChat() {
  currentChat = 'global';
  document.getElementById('chat-title').innerText = "Общий Чат 🌐";
  document.getElementById('chat-subtitle').innerText = "онлайн";
  document.getElementById('chat-header-avatar').innerText = "🌐";
  document.getElementById('back-btn').style.display = 'none';
  document.getElementById('call-btn').style.display = 'block';
  document.getElementById('chats-list').style.display = 'none';
  document.getElementById('messages-container').style.display = 'flex';
  document.getElementById('input-area').style.display = 'flex';
  document.getElementById('tabs-bar').style.display = 'flex';

  loadMessages();
  listenForTypingStatus();
  listenForGroupCalls();
}

function openDirectChat(targetUser) {
  if (targetUser === currentUser.username) return;
  currentChat = targetUser;
  document.getElementById('back-btn').style.display = 'block';
  document.getElementById('call-btn').style.display = 'block';
  document.getElementById('chats-list').style.display = 'none';
  document.getElementById('messages-container').style.display = 'flex';
  document.getElementById('input-area').style.display = 'flex';
  document.getElementById('tabs-bar').style.display = 'none';

  db.collection('users').doc(targetUser).onSnapshot(doc => {
    if (doc.exists) {
      const data = doc.data();
      document.getElementById('chat-title').innerText = data.displayName || data.name;
      renderAvatar(data.avatar, document.getElementById('chat-header-avatar'));

      if (data.lastSeen) {
        const lastSeenMs = data.lastSeen.toMillis();
        const diffSec = Math.floor((Date.now() - lastSeenMs) / 1000);
        document.getElementById('chat-subtitle').innerText = diffSec < 60 ? "онлайн" : `был(а) ${Math.floor(diffSec / 60)} мин. назад`;
      }
    }
  });

  loadMessages();
  listenForTypingStatus();
  listenForGroupCalls();
}

function getChatId() {
  if (currentChat === 'global') return 'global';
  if (currentChat.startsWith('group_')) return currentChat;
  return [currentUser.username, currentChat].sort().join('_');
}

// ==========================================
// СПИСОК ДИАЛОГОВ И ПОИСК
// ==========================================
async function showDirectsList() {
  document.getElementById('chats-list').style.display = 'block';
  document.getElementById('messages-container').style.display = 'none';
  document.getElementById('input-area').style.display = 'none';

  const snapshot = await db.collection('users').get();
  allUsers = [];
  snapshot.forEach(doc => {
    if (doc.id !== currentUser.username) {
      allUsers.push(doc.data());
    }
  });

  const msgSnap = await db.collection('messages').get();
  const activeDialogs = new Set();
  
  msgSnap.forEach(doc => {
    const data = doc.data();
    if (data.chatId && data.chatId.includes(currentUser.username)) {
      const parts = data.chatId.split('_');
      const partner = parts.find(p => p !== currentUser.username);
      if (partner) activeDialogs.add(partner);
    }
  });

  renderUsersList(allUsers.filter(u => activeDialogs.has(u.name)));
}

function filterUsersList() {
  const query = document.getElementById('user-search-input').value.toLowerCase().trim();
  if (!query) {
    showDirectsList();
    return;
  }
  const filtered = allUsers.filter(u => 
    u.name.toLowerCase().includes(query) || 
    (u.displayName && u.displayName.toLowerCase().includes(query))
  );
  renderUsersList(filtered);
}

function renderUsersList(users) {
  const usersBox = document.getElementById('users-container');
  usersBox.innerHTML = '';

  if (users.length === 0) {
    usersBox.innerHTML = '<div style="color:#aaa; text-align:center; padding:20px; font-size:13px;">Диалогов нет. Воспользуйся поиском выше!</div>';
    return;
  }

  users.forEach(user => {
    const item = document.createElement('div');
    item.className = 'chat-item';
    item.onclick = () => openDirectChat(user.name);
    item.innerHTML = `
      <div class="chat-avatar" id="list-avatar-${user.name}"></div>
      <div class="chat-info">
        <div class="chat-name">${user.displayName || user.name}</div>
        <div class="chat-last-msg">@${user.name}</div>
      </div>
    `;
    usersBox.appendChild(item);
    renderAvatar(user.avatar, document.getElementById(`list-avatar-${user.name}`));
  });
}

// ==========================================
// СООБЩЕНИЯ И ФУНКЦИИ ЧАТА
// ==========================================
function setReply(msgId, author, text) {
  replyingToMessage = { id: msgId, author, text };
  document.getElementById('reply-preview-text').innerText = `Ответ на ${author}: ${text.substring(0, 30)}...`;
  document.getElementById('reply-preview').style.display = 'flex';
}

function cancelReply() {
  replyingToMessage = null;
  document.getElementById('reply-preview').style.display = 'none';
}

function toggleSearch() {
  const bar = document.getElementById('search-bar');
  bar.style.display = bar.style.display === 'none' ? 'block' : 'none';
}

function searchMessages() {
  const query = document.getElementById('search-input').value.toLowerCase();
  const msgs = document.querySelectorAll('.msg');
  msgs.forEach(m => {
    const text = m.innerText.toLowerCase();
    m.style.display = text.includes(query) ? 'flex' : 'none';
  });
}

function handleTyping() {
  const chatId = getChatId();
  db.collection('typing').doc(`${chatId}_${currentUser.username}`).set({
    user: currentUser.displayName,
    chatId: chatId,
    isTyping: true,
    timestamp: Date.now()
  });

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    db.collection('typing').doc(`${chatId}_${currentUser.username}`).set({ isTyping: false });
  }, 2000);
}

function listenForTypingStatus() {
  const chatId = getChatId();
  db.collection('typing').where('chatId', '==', chatId).onSnapshot(snapshot => {
    let typers = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.user !== currentUser.displayName && data.isTyping && (Date.now() - data.timestamp < 3000)) {
        typers.push(data.user);
      }
    });
    const subtitle = document.getElementById('chat-subtitle');
    if (typers.length > 0) {
      subtitle.innerText = `${typers.join(', ')} печатает...`;
      subtitle.style.color = '#5288c1';
    } else if (currentChat === 'global') {
      subtitle.innerText = "онлайн";
      subtitle.style.color = '#6c7883';
    }
  });
}

async function toggleVoiceRecord() {
  const btn = document.getElementById('voice-btn');
  if (!isRecording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          db.collection('messages').add({
            chatId: getChatId(),
            audio: reader.result,
            author: currentUser.username,
            displayName: currentUser.displayName,
            avatar: currentUser.avatar,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
          });
        };
      };

      mediaRecorder.start();
      isRecording = true;
      btn.innerText = '🔴';
    } catch (err) {
      alert("Нет доступа к микрофону!");
    }
  } else {
    mediaRecorder.stop();
    isRecording = false;
    btn.innerText = '🎙️';
  }
}

function sendImage(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) return alert("Выбери фото до 2MB.");

  const reader = new FileReader();
  reader.onload = function(event) {
    db.collection('messages').add({
      chatId: getChatId(),
      image: event.target.result,
      author: currentUser.username,
      displayName: currentUser.displayName,
      avatar: currentUser.avatar,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
  };
  reader.readAsDataURL(file);
}

function addReaction(msgId, emoji) {
  const msgRef = db.collection('messages').doc(msgId);
  db.runTransaction(async transaction => {
    const doc = await transaction.get(msgRef);
    if (!doc.exists) return;
    let reactions = doc.data().reactions || {};
    if (!reactions[emoji]) reactions[emoji] = [];

    if (reactions[emoji].includes(currentUser.username)) {
      reactions[emoji] = reactions[emoji].filter(u => u !== currentUser.username);
    } else {
      reactions[emoji].push(currentUser.username);
    }

    transaction.update(msgRef, { reactions: reactions });
  });
}

function loadMessages() {
  if (unsubscribeListener) unsubscribeListener();

  const targetChatId = getChatId();

  unsubscribeListener = db.collection('messages')
    .onSnapshot(snapshot => {
      const container = document.getElementById('messages-container');
      let messages = [];

      snapshot.forEach(doc => {
        const data = doc.data();
        const msgChatId = data.chatId || 'global';

        if (msgChatId === targetChatId) {
          messages.push({
            id: doc.id,
            author: data.author,
            displayName: data.displayName || data.author,
            avatar: data.avatar || '👤',
            text: data.text || '',
            image: data.image || null,
            audio: data.audio || null,
            replyTo: data.replyTo || null,
            reactions: data.reactions || {},
            timestamp: data.timestamp ? data.timestamp.toMillis() : Date.now()
          });
        }
      });

      messages.sort((a, b) => a.timestamp - b.timestamp);

      // Проверка на свежие сообщения для пуш уведомлений
      if (messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.author !== currentUser.username && (Date.now() - lastMsg.timestamp < 3000)) {
          triggerPushNotification(`Сообщение от ${lastMsg.displayName}`, lastMsg.text || 'Отправил(а) медиафайл');
        }
      }

      container.innerHTML = '';
      messages.forEach(data => {
        const isMe = data.author === currentUser.username;
        const msgDiv = document.createElement('div');
        msgDiv.className = `msg ${isMe ? 'outgoing' : 'incoming'}`;
        
        let replyHtml = '';
        if (data.replyTo) {
          replyHtml = `<div style="background:#1b2734; border-left:2px solid #5288c1; padding:2px 5px; font-size:10px; margin-bottom:4px; opacity:0.8;"><b>${data.replyTo.author}</b>: ${data.replyTo.text}</div>`;
        }

        let contentHtml = '';
        if (data.image) {
          contentHtml = `<img src="${data.image}" style="max-width:100%; border-radius:10px; margin-top:5px;">`;
        } else if (data.audio) {
          contentHtml = `<audio controls src="${data.audio}" style="max-width:200px; height:35px;"></audio>`;
        } else {
          contentHtml = `<span>${data.text}</span>`;
        }

        let reactionsHtml = '<div style="display:flex; gap:4px; margin-top:4px;">';
        ['👍', '❤️', '🔥', '💩'].forEach(emoji => {
          const count = data.reactions[emoji] ? data.reactions[emoji].length : 0;
          reactionsHtml += `
            <button onclick="addReaction('${data.id}', '${emoji}')" style="background:#242f3d; border:none; border-radius:8px; padding:2px 5px; color:#fff; font-size:11px; cursor:pointer;">
              ${emoji} ${count > 0 ? count : ''}
            </button>
          `;
        });
        reactionsHtml += '</div>';

        msgDiv.innerHTML = `
          ${!isMe ? `<div style="display:flex; align-items:center; gap:5px; margin-bottom:3px;">
                      <span style="width:20px; height:20px; display:inline-block;" id="avatar-${data.id}"></span>
                      <div class="msg-author" onclick="openDirectChat('${data.author}')">${data.displayName}</div>
                     </div>` : ''}
          ${replyHtml}
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
            <div style="flex:1;">${contentHtml}</div>
            <button onclick="setReply('${data.id}', '${data.displayName}', '${data.text || 'Медиа'}')" style="background:none; border:none; color:#5288c1; cursor:pointer; font-size:11px;">↩️</button>
            ${isMe ? `<button onclick="deleteMessage('${data.id}')" style="background:none; border:none; color:#e53935; cursor:pointer; font-size:11px; opacity:0.6;">🗑️</button>` : ''}
          </div>
          ${reactionsHtml}
        `;
        container.appendChild(msgDiv);

        if (!isMe) {
          const avatarContainer = document.getElementById(`avatar-${data.id}`);
          if (avatarContainer) renderAvatar(data.avatar, avatarContainer);
        }
      });
      
      container.scrollTop = container.scrollHeight;
    });
}

function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (text) {
    const msgData = {
      chatId: getChatId(),
      text: text,
      author: currentUser.username,
      displayName: currentUser.displayName,
      avatar: currentUser.avatar,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (replyingToMessage) {
      msgData.replyTo = replyingToMessage;
    }

    db.collection('messages').add(msgData);
    sendSound.play().catch(() => {});
    
    input.value = '';
    cancelReply();
    db.collection('typing').doc(`${getChatId()}_${currentUser.username}`).set({ isTyping: false });
  }
}

function deleteMessage(id) {
  if (confirm("Удалить сообщение?")) {
    db.collection('messages').doc(id).delete();
  }
}

function handleKeyPress(e) {
  if (e.key === 'Enter') sendMessage();
}

// ==========================================
// ГРУППОВЫЕ ЗВОНКИ И WEBRTC
// ==========================================
async function setupMedia() {
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('local-video').srcObject = localStream;
  }
}

function toggleMic() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      isMicOn = !isMicOn;
      audioTrack.enabled = isMicOn;
      document.getElementById('mic-btn').innerText = isMicOn ? '🎤' : '🔇';
    }
  }
}

function toggleCam() {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      isCamOn = !isCamOn;
      videoTrack.enabled = isCamOn;
      document.getElementById('cam-btn').innerText = isCamOn ? '📷' : '🚫';
    }
  }
}

function listenForGroupCalls() {
  const chatId = getChatId();
  if (groupCallListener) groupCallListener();

  groupCallListener = db.collection('group_calls').doc(chatId).onSnapshot(doc => {
    const banner = document.getElementById('group-call-banner');
    if (doc.exists && doc.data().active) {
      const participants = doc.data().participants || [];
      document.getElementById('group-call-count').innerText = `Участников: ${participants.length}`;
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  });
}

async function startOrJoinGroupCall() {
  const chatId = getChatId();
  await setupMedia();
  document.getElementById('call-modal').classList.add('active');

  const callRef = db.collection('group_calls').doc(chatId);
  const doc = await callRef.get();

  if (!doc.exists || !doc.data().active) {
    await callRef.set({
      active: true,
      chatId: chatId,
      startedBy: currentUser.username,
      participants: [currentUser.username]
    });
  } else {
    await callRef.update({
      participants: firebase.firestore.FieldValue.arrayUnion(currentUser.username)
    });
  }

  activeCallId = chatId;
  
  // Уведомляем участника/группу о звонке
  if (currentChat !== 'global') {
    db.collection('calls').add({
      offer: {
        caller: currentUser.username,
        target: currentChat,
        status: 'pending'
      }
    });
  }

  // Слушаем список участников звонка
  callRef.onSnapshot(async snapshot => {
    if (!snapshot.exists) return;
    const data = snapshot.data();
    if (!data.active) {
      hangUpLocally();
      return;
    }

    const participants = data.participants || [];
    participants.forEach(user => {
      if (user !== currentUser.username && !peerConnections[user]) {
        connectToUser(user, chatId);
      }
    });
  });
}

async function connectToUser(targetUser, chatId) {
  const pc = new RTCPeerConnection(servers);
  peerConnections[targetUser] = pc;

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.ontrack = event => {
    let remoteVideo = document.getElementById(`video-${targetUser}`);
    if (!remoteVideo) {
      remoteVideo = document.createElement('video');
      remoteVideo.id = `video-${targetUser}`;
      remoteVideo.autoplay = true;
      remoteVideo.playsInline = true;
      document.getElementById('video-grid').appendChild(remoteVideo);
    }
    remoteVideo.srcObject = event.streams[0];
  };

  const signalRef = db.collection('group_calls').doc(chatId)
    .collection('signals').doc(`${currentUser.username}_${targetUser}`);

  pc.onicecandidate = event => {
    if (event.candidate) {
      signalRef.collection('candidates').add(event.candidate.toJSON());
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await signalRef.set({ offer: offer, from: currentUser.username, to: targetUser });

  signalRef.onSnapshot(async snap => {
    const data = snap.data();
    if (data && data.answer && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
  });

  signalRef.collection('candidates').onSnapshot(snap => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
      }
    });
  });
}

function listenForIncomingCalls() {
  db.collection('calls')
    .where('offer.target', 'in', [currentUser.username, 'global'])
    .onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added') {
          const callData = change.doc.data();
          if (callData.offer && callData.offer.status === 'pending' && callData.offer.caller !== currentUser.username) {
            triggerPushNotification('Входящий звонок!', `Звонит ${callData.offer.caller}`);
            document.getElementById('caller-name').innerText = `Звонок от ${callData.offer.caller}`;
            document.getElementById('incoming-call-box').style.display = 'flex';
            ringtone.play();
          }
        }
      });
    });
}

async function answerCall() {
  ringtone.stop();
  document.getElementById('incoming-call-box').style.display = 'none';
  startOrJoinGroupCall();
}

function rejectCall() {
  ringtone.stop();
  document.getElementById('incoming-call-box').style.display = 'none';
}

async function hangUpGroupCall() {
  if (activeCallId) {
    const callRef = db.collection('group_calls').doc(activeCallId);
    const doc = await callRef.get();

    if (doc.exists) {
      const participants = (doc.data().participants || []).filter(u => u !== currentUser.username);
      if (participants.length === 0) {
        await callRef.update({ active: false, participants: [] });
      } else {
        await callRef.update({ participants: participants });
      }
    }
  }
  hangUpLocally();
}

function hangUpLocally() {
  ringtone.stop();
  document.getElementById('call-modal').classList.remove('active');
  document.getElementById('incoming-call-box').style.display = 'none';

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  Object.keys(peerConnections).forEach(user => {
    peerConnections[user].close();
    const vid = document.getElementById(`video-${user}`);
    if (vid) vid.remove();
  });

  peerConnections = {};
  activeCallId = null;
}