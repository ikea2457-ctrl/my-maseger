let currentUser = localStorage.getItem('chat_username') || '';
let currentChat = 'global';
let unsubscribeListener = null;

// Переменные WebRTC
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let activeCallId = null;

const servers = {
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
  ]
};

document.addEventListener("DOMContentLoaded", () => {
  if (currentUser) {
    showChat();
  }
});

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
  localStorage.removeItem('chat_username');
  location.reload();
}

function showChat() {
  document.getElementById('auth-screen').classList.remove('active');
  document.getElementById('chat-screen').classList.add('active');
  document.getElementById('drawer-username').innerText = currentUser;
  document.getElementById('user-avatar-letter').innerText = currentUser[0].toUpperCase();
  
  db.collection('users').doc(currentUser).set({
    name: currentUser,
    lastSeen: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  listenForIncomingCalls();
  openGlobalChat();
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
  document.getElementById('chat-subtitle').innerText = "все пользователи";
  document.getElementById('back-btn').style.display = 'none';
  document.getElementById('call-btn').style.display = 'none';
  document.getElementById('chats-list').style.display = 'none';
  document.getElementById('messages-container').style.display = 'flex';
  document.getElementById('input-area').style.display = 'flex';
  document.getElementById('tabs-bar').style.display = 'flex';
  loadMessages();
}

function openDirectChat(targetUser) {
  if (targetUser === currentUser) return;
  currentChat = targetUser;
  document.getElementById('chat-title').innerText = targetUser;
  document.getElementById('chat-subtitle').innerText = "Личные сообщения";
  document.getElementById('back-btn').style.display = 'block';
  document.getElementById('call-btn').style.display = 'block';
  document.getElementById('chats-list').style.display = 'none';
  document.getElementById('messages-container').style.display = 'flex';
  document.getElementById('input-area').style.display = 'flex';
  document.getElementById('tabs-bar').style.display = 'none';
  loadMessages();
}

function showDirectsList() {
  document.getElementById('chats-list').style.display = 'block';
  document.getElementById('messages-container').style.display = 'none';
  document.getElementById('input-area').style.display = 'none';

  db.collection('users').get().then(snapshot => {
    const list = document.getElementById('chats-list');
    list.innerHTML = '';
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
        list.appendChild(item);
      }
    });
  });
}

function getChatId() {
  if (currentChat === 'global') return 'global';
  return [currentUser, currentChat].sort().join('_');
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
            author: data.author || 'Аноним',
            text: data.text || '',
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
        
        msgDiv.innerHTML = `
          ${!isMe ? `<div class="msg-author" onclick="openDirectChat('${data.author}')">${data.author}</div>` : ''}
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <span>${data.text}</span>
            <button onclick="deleteMessage('${data.id}')" style="background:none; border:none; color:#e53935; cursor:pointer; font-size:12px; opacity:0.6;">🗑️</button>
          </div>
        `;
        container.appendChild(msgDiv);
      });
      
      container.scrollTop = container.scrollHeight;
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

// ---------------- WEBRTC ВИДЕОЗВОНКИ ----------------

async function setupMedia() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  remoteStream = new MediaStream();
  
  document.getElementById('local-video').srcObject = localStream;
  document.getElementById('remote-video').srcObject = remoteStream;
}

async function startCall() {
  if (currentChat === 'global') return;

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
    .where('offer.target', '==', currentUser)
    .onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added') {
          const callData = change.doc.data();
          if (callData.offer && callData.offer.status === 'pending') {
            activeCallId = change.doc.id;
            document.getElementById('caller-name').innerText = `Звонок от ${callData.offer.caller}`;
            document.getElementById('incoming-call-box').style.display = 'flex';
          }
        }
      });
    });
}

async function answerCall() {
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