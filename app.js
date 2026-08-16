let currentUser = localStorage.getItem('chat_username') || '';
let currentChat = 'global';
let unsubscribeListener = null;

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
  
  // Сохраняем пользователя в список
  db.collection('users').doc(currentUser).set({
    name: currentUser,
    lastSeen: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

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

// Загрузка сообщений (поддерживает и старые, и новые записи)
function loadMessages() {
  if (unsubscribeListener) unsubscribeListener();

  const targetChatId = getChatId();

  unsubscribeListener = db.collection('messages')
    .onSnapshot(snapshot => {
      const container = document.getElementById('messages-container');
      
      let messages = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        const msgChatId = data.chatId || 'global'; // Если chatId нет — считаем, что это общий чат

        if (msgChatId === targetChatId) {
          messages.push({
            id: doc.id,
            author: data.author || 'Аноним',
            text: data.text || '',
            timestamp: data.timestamp ? data.timestamp.toMillis() : Date.now()
          });
        }
      });

      // Сортировка от старых к новым
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