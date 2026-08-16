let currentUser = JSON.parse(localStorage.getItem('chat_user')) || null;
let currentChat = 'global';
let unsubscribeListener = null;
let typingTimeout = null;
let authMode = 'login';
let replyingToMessage = null;
let allUsers = [];

// Переменные WebRTC & Медиа
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let activeCallId = null;
let isMicOn = true;
let isCamOn = true;

// Переменные для Записи Голосовых
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

// ==========================================
// СМЕНА НИКА И АВАТАРКИ
// ==========================================
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

  listenForIncomingCalls();
  listenForTypingStatus();
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
}

function getChatId() {
  if (currentChat === 'global') return 'global';
  if (currentChat.startsWith('group_')) return currentChat;
  return [currentUser.username, currentChat].sort().join('_');
}

// ==========================================
// УМНЫЙ СПИСОК ДИАЛОГОВ И ПОИСК ЮЗЕРОВ
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

  // Получаем уникальных пользователей с кем уже были переписки
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

// WebRTC Звонки
async function setupMedia() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  remoteStream = new MediaStream();
  document.getElementById('local-video').srcObject = localStream;
  
  let remoteVideo = document.getElementById('remote-video');
  if (!remoteVideo) {
    remoteVideo = document.createElement('video');
    remoteVideo.id = 'remote-video';
    remoteVideo.autoplay = true;
    remoteVideo.playsInline = true;
    document.getElementById('video-grid').appendChild(remoteVideo);
  }
  remoteVideo.srcObject = remoteStream;
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

async function startCall() {
  await setupMedia();
  document.getElementById('call-modal').classList.add('active');

  peerConnection = new RTCPeerConnection(servers);
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  peerConnection.ontrack = event => {
    event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
  };

  const callDoc = db.collection('calls').doc();
  const offerCandidates = callDoc.collection('offerCandidates');
  const answerCandidates = callDoc.collection('answerCandidates');

  activeCallId = callDoc.id;

  peerConnection.onicecandidate = event => {
    if (event.candidate) offerCandidates.add(event.candidate.toJSON());
  };

  const offerDescription = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
    caller: currentUser.username,
    target: currentChat,
    status: 'pending'
  };

  await callDoc.set({ offer });

  callDoc.onSnapshot(snapshot => {
    const data = snapshot.data();
    if (peerConnection && !peerConnection.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      peerConnection.setRemoteDescription(answerDescription);
    }
    if (data?.status === 'ended') hangUpLocally();
  });

  answerCandidates.onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
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
            activeCallId = change.doc.id;
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

  await setupMedia();
  document.getElementById('call-modal').classList.add('active');

  const callDoc = db.collection('calls').doc(activeCallId);
  const answerCandidates = callDoc.collection('answerCandidates');
  const offerCandidates = callDoc.collection('offerCandidates');

  peerConnection = new RTCPeerConnection(servers);
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  peerConnection.ontrack = event => {
    event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
  };

  peerConnection.onicecandidate = event => {
    if (event.candidate) answerCandidates.add(event.candidate.toJSON());
  };

  const callData = (await callDoc.get()).data();
  await peerConnection.setRemoteDescription(new RTCSessionDescription(callData.offer));

  const answerDescription = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answerDescription);

  await callDoc.update({
    answer: { type: answerDescription.type, sdp: answerDescription.sdp },
    'offer.status': 'accepted'
  });

  offerCandidates.onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
      }
    });
  });

  callDoc.onSnapshot(snapshot => {
    if (snapshot.data()?.status === 'ended') hangUpLocally();
  });
}

function rejectCall() {
  ringtone.stop();
  document.getElementById('incoming-call-box').style.display = 'none';
  if (activeCallId) {
    db.collection('calls').doc(activeCallId).update({ 'offer.status': 'rejected' });
  }
}

function hangUp() {
  if (activeCallId) {
    db.collection('calls').doc(activeCallId).update({ status: 'ended' });
  }
  hangUpLocally();
}

function hangUpLocally() {
  ringtone.stop();
  document.getElementById('call-modal').classList.remove('active');
  document.getElementById('incoming-call-box').style.display = 'none';

  if (localStream) localStream.getTracks().forEach(track => track.stop());
  if (peerConnection) peerConnection.close();
  peerConnection = null;
  activeCallId = null;
}