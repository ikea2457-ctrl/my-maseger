let currentUser = localStorage.getItem('chat_username') || '';
let currentChat = 'global';
let unsubscribeListener = null;
let typingTimeout = null;

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

const servers = {
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
  ]
};

// ==========================================
// МОДУЛЬ ЗВУКА И ВИБРАЦИИ ВХОДЯЩЕГО ЗВОНКА
// ==========================================
const ringtone = {
  audio: new Audio('https://assets.mixkit.co/active_storage/sfx/1358/1358-preview.mp3'),
  vibrateInterval: null,
  
  play() {
    this.audio.loop = true;
    this.audio.currentTime = 0;
    this.audio.play().catch(e => console.log("Автовоспроизведение заблокировано браузером:", e));
    
    if ("vibrate" in navigator) {
      navigator.vibrate([1000, 1000]);
      this.vibrateInterval = setInterval(() => {
        navigator.vibrate([1000, 1000]);
      }, 2000);
    }
  },
  
  stop() {
    this.audio.pause();
    this.audio.currentTime = 0;
    if (this.vibrateInterval) {
      clearInterval(this.vibrateInterval);
      this.vibrateInterval = null;
    }
    if ("vibrate" in navigator) {
      navigator.vibrate(0);
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  if (currentUser) {
    showChat();
  }
});

function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission !== "granted") {
    Notification.requestPermission();
  }
}

function sendPushNotification(title, body) {
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
    new Notification(title, { body: body, icon: 'https://cdn-icons-png.flaticon.com/512/906/906377.png' });
  }
}

function login() {
  const input = document.getElementById('username-input');
  const val = input.value.trim();
  if (val) {
    currentUser = val;
    localStorage.setItem('chat_username', currentUser);
    showChat();
  }
}

function logout() {
  ringtone.stop();
  localStorage.removeItem('chat_username');
  location.reload();
}

function showChat() {
  document.getElementById('auth-screen').classList.remove('active');
  document.getElementById('chat-screen').classList.add('active');
  document.getElementById('drawer-username').innerText = currentUser;
  document.getElementById('user-avatar-letter').innerText = currentUser[0].toUpperCase();
  
  requestNotificationPermission();

  // ФИЧА 4: Обновление статуса Онлайн / Last Seen
  updateUserPresence();
  setInterval(updateUserPresence, 30000);

  listenForIncomingCalls();
  listenForTypingStatus();
  openGlobalChat();
}

function updateUserPresence() {
  db.collection('users').doc(currentUser).set({
    name: currentUser,
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
  if (targetUser === currentUser) return;
  currentChat = targetUser;
  document.getElementById('chat-title').innerText = targetUser;
  document.getElementById('chat-subtitle').innerText = "загрузка статуса...";
  document.getElementById('back-btn').style.display = 'block';
  document.getElementById('call-btn').style.display = 'block';
  document.getElementById('chats-list').style.display = 'none';
  document.getElementById('messages-container').style.display = 'flex';
  document.getElementById('input-area').style.display = 'flex';
  document.getElementById('tabs-bar').style.display = 'none';
  
  // ФИЧА 4: Показ статуса онлайн собеседника
  db.collection('users').doc(targetUser).onSnapshot(doc => {
    if (doc.exists && doc.data().lastSeen) {
      const lastSeenMs = doc.data().lastSeen.toMillis();
      const diffSec = Math.floor((Date.now() - lastSeenMs) / 1000);
      document.getElementById('chat-subtitle').innerText = diffSec < 60 ? "онлайн" : `был(а) ${Math.floor(diffSec / 60)} мин. назад`;
    }
  });

  loadMessages();
  listenForTypingStatus();
}

// ==========================================
// ГРУППОВЫЕ ЧАТЫ
// ==========================================
async function createGroupChat() {
  const groupName = prompt("Введи название группы:");
  if (!groupName) return;

  try {
    const groupRef = await db.collection('groups').add({
      name: groupName,
      createdBy: currentUser,
      members: [currentUser],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    alert(`Группа "${groupName}" создана! ID: ${groupRef.id}`);
    showDirectsList();
  } catch (err) {
    alert("Ошибка создания группы: " + err.message);
  }
}

async function joinGroupChat() {
  const groupId = prompt("Введи ID группы для входа:");
  if (!groupId) return;

  try {
    const groupRef = db.collection('groups').doc(groupId);
    const doc = await groupRef.get();

    if (!doc.exists) {
      return alert("Группа с таким ID не найдена!");
    }

    await groupRef.update({
      members: firebase.firestore.FieldValue.arrayUnion(currentUser)
    });

    alert(`Ты успешно вошел в группу "${doc.data().name}"!`);
    showDirectsList();
  } catch (err) {
    alert("Ошибка входа в группу: " + err.message);
  }
}

function openGroupChat(groupId, groupName) {
  currentChat = `group_${groupId}`;
  document.getElementById('chat-title').innerText = `👥 ${groupName}`;
  document.getElementById('chat-subtitle').innerText = `ID: ${groupId}`;
  document.getElementById('back-btn').style.display = 'block';
  document.getElementById('call-btn').style.display = 'none';
  document.getElementById('chats-list').style.display = 'none';
  document.getElementById('messages-container').style.display = 'flex';
  document.getElementById('input-area').style.display = 'flex';
  document.getElementById('tabs-bar').style.display = 'none';
  loadMessages();
  listenForTypingStatus();
}

function showDirectsList() {
  document.getElementById('chats-list').style.display = 'block';
  document.getElementById('messages-container').style.display = 'none';
  document.getElementById('input-area').style.display = 'none';

  const list = document.getElementById('chats-list');
  list.innerHTML = `
    <div class="group-actions-bar">
      <button class="group-btn" onclick="createGroupChat()">+ Создать группу</button>
      <button class="group-btn" onclick="joinGroupChat()">Войти в группу</button>
    </div>
    <div id="groups-container"></div>
    <div id="users-container"></div>
  `;

  db.collection('groups').where('members', 'array-contains', currentUser).get().then(snapshot => {
    const groupsBox = document.getElementById('groups-container');
    snapshot.forEach(doc => {
      const group = doc.data();
      const item = document.createElement('div');
      item.className = 'chat-item';
      item.onclick = () => openGroupChat(doc.id, group.name);
      item.innerHTML = `
        <div class="chat-avatar">👥</div>
        <div class="chat-info">
          <div class="chat-name">${group.name}</div>
          <div class="chat-last-msg">Групповой чат</div>
        </div>
      `;
      groupsBox.appendChild(item);
    });
  });

  db.collection('users').get().then(snapshot => {
    const usersBox = document.getElementById('users-container');
    snapshot.forEach(doc => {
      const user = doc.data();
      if (user.name && user.name !== currentUser) {
        const item = document.createElement('div');
        item.className = 'chat-item';
        item.onclick = () => openDirectChat(user.name);
        item.innerHTML = `
          <div class="chat-avatar">${user.name[0].toUpperCase()}</div>
          <div class="chat-info">
            <div class="chat-name">${user.name}</div>
            <div class="chat-last-msg">Нажми, чтобы открыть ЛС</div>
          </div>
        `;
        usersBox.appendChild(item);
      }
    });
  });
}

function getChatId() {
  if (currentChat === 'global') return 'global';
  if (currentChat.startsWith('group_')) return currentChat;
  return [currentUser, currentChat].sort().join('_');
}

// ==========================================
// ФИЧА 3: Индикатор "Печатает..."
// ==========================================
function handleTyping() {
  const chatId = getChatId();
  db.collection('typing').doc(`${chatId}_${currentUser}`).set({
    user: currentUser,
    chatId: chatId,
    isTyping: true,
    timestamp: Date.now()
  });

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    db.collection('typing').doc(`${chatId}_${currentUser}`).set({ isTyping: false });
  }, 2000);
}

function listenForTypingStatus() {
  const chatId = getChatId();
  db.collection('typing').where('chatId', '==', chatId).onSnapshot(snapshot => {
    let typers = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.user !== currentUser && data.isTyping && (Date.now() - data.timestamp < 3000)) {
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

// ==========================================
// ФИЧА 1 & 5: Голосовые сообщения и Картинки
// ==========================================
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
            author: currentUser,
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

  if (file.size > 2 * 1024 * 1024) {
    return alert("Файл слишком большой! Выбери фото до 2MB.");
  }

  const reader = new FileReader();
  reader.onload = function(event) {
    db.collection('messages').add({
      chatId: getChatId(),
      image: event.target.result,
      author: currentUser,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
  };
  reader.readAsDataURL(file);
}

// ==========================================
// ФИЧА 2: Реакции на сообщения
// ==========================================
function addReaction(msgId, emoji) {
  const msgRef = db.collection('messages').doc(msgId);
  db.runTransaction(async transaction => {
    const doc = await transaction.get(msgRef);
    if (!doc.exists) return;
    
    let reactions = doc.data().reactions || {};
    if (!reactions[emoji]) reactions[emoji] = [];

    if (reactions[emoji].includes(currentUser)) {
      reactions[emoji] = reactions[emoji].filter(u => u !== currentUser);
    } else {
      reactions[emoji].push(currentUser);
    }

    transaction.update(msgRef, { reactions: reactions });
  });
}

function loadMessages() {
  if (unsubscribeListener) unsubscribeListener();

  const targetChatId = getChatId();
  let initialLoad = true;

  unsubscribeListener = db.collection('messages')
    .onSnapshot(snapshot => {
      const container = document.getElementById('messages-container');
      let messages = [];

      snapshot.docChanges().forEach(change => {
        if (change.type === 'added' && !initialLoad) {
          const data = change.doc.data();
          if (data.author !== currentUser && (data.chatId === targetChatId || (!data.chatId && targetChatId === 'global'))) {
            sendPushNotification(`Сообщение от ${data.author}`, data.text || "Медиафайл");
          }
        }
      });

      snapshot.forEach(doc => {
        const data = doc.data();
        const msgChatId = data.chatId || 'global';

        if (msgChatId === targetChatId) {
          messages.push({
            id: doc.id,
            author: data.author || 'Аноним',
            text: data.text || '',
            image: data.image || null,
            audio: data.audio || null,
            reactions: data.reactions || {},
            timestamp: data.timestamp ? data.timestamp.toMillis() : Date.now()
          });
        }
      });

      messages.sort((a, b) => a.timestamp - b.timestamp);

      container.innerHTML = '';
      messages.forEach(data => {
        const isMe = data.author === currentUser;
        const msgDiv = document.createElement('div');
        msgDiv.className = `msg ${isMe ? 'outgoing' : 'incoming'}`;
        
        // Формирование содержимого (Текст / Картинка / Голосовуха)
        let contentHtml = '';
        if (data.image) {
          contentHtml = `<img src="${data.image}" style="max-width:100%; border-radius:10px; margin-top:5px;">`;
        } else if (data.audio) {
          contentHtml = `<audio controls src="${data.audio}" style="max-width:200px; height:35px;"></audio>`;
        } else {
          contentHtml = `<span>${data.text}</span>`;
        }

        // Рендер Реакций
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
          ${!isMe ? `<div class="msg-author" onclick="openDirectChat('${data.author}')">${data.author}</div>` : ''}
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
            <div style="flex:1;">${contentHtml}</div>
            <button onclick="deleteMessage('${data.id}')" style="background:none; border:none; color:#e53935; cursor:pointer; font-size:12px; opacity:0.6;">🗑️</button>
          </div>
          ${reactionsHtml}
        `;
        container.appendChild(msgDiv);
      });
      
      container.scrollTop = container.scrollHeight;
      initialLoad = false;
    });
}

function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (text) {
    db.collection('messages').add({
      chatId: getChatId(),
      text: text,
      author: currentUser,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    input.value = '';
    db.collection('typing').doc(`${getChatId()}_${currentUser}`).set({ isTyping: false });
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
// WEBRTC ВИДЕОЗВОНКИ
// ==========================================
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
      const btn = document.getElementById('mic-btn');
      btn.innerText = isMicOn ? '🎤' : '🔇';
      btn.classList.toggle('off', !isMicOn);
    }
  }
}

function toggleCam() {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      isCamOn = !isCamOn;
      videoTrack.enabled = isCamOn;
      const btn = document.getElementById('cam-btn');
      btn.innerText = isCamOn ? '📷' : '🚫';
      btn.classList.toggle('off', !isCamOn);
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
    caller: currentUser,
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
    if (data?.status === 'ended') {
      hangUpLocally();
    }
  });

  answerCandidates.onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        peerConnection.addIceCandidate(candidate);
      }
    });
  });
}

function listenForIncomingCalls() {
  db.collection('calls')
    .where('offer.target', 'in', [currentUser, 'global'])
    .onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added') {
          const callData = change.doc.data();
          if (callData.offer && callData.offer.status === 'pending' && callData.offer.caller !== currentUser) {
            activeCallId = change.doc.id;
            document.getElementById('caller-name').innerText = `Входящий звонок от ${callData.offer.caller}`;
            document.getElementById('incoming-call-box').style.display = 'flex';
            sendPushNotification('Входящий звонок!', `Вам звонит ${callData.offer.caller}`);
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
    if (snapshot.data()?.status === 'ended') {
      hangUpLocally();
    }
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

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  if (peerConnection) {
    peerConnection.close();
  }
  peerConnection = null;
  activeCallId = null;
}