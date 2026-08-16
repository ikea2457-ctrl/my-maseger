let currentUser = localStorage.getItem('chat_username') || '';

// Авто-вход при старте
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
  loadMessages();
}

function toggleMenu() {
  document.getElementById('drawer').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('active');
}

function loadMessages() {
  db.collection('messages').orderBy('timestamp', 'asc')
    .onSnapshot(snapshot => {
      const container = document.getElementById('messages-container');
      container.innerHTML = '';
      snapshot.forEach(doc => {
        const data = doc.data();
        const isMe = data.author === currentUser;
        
        const msgDiv = document.createElement('div');
        msgDiv.className = `msg ${isMe ? 'outgoing' : 'incoming'}`;
        
        msgDiv.innerHTML = `
          ${!isMe ? `<div class="msg-author">${data.author || 'Аноним'}</div>` : ''}
          <div>${data.text}</div>
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
      text: text,
      author: currentUser,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    input.value = '';
  }
}

function handleKeyPress(e) {
  if (e.key === 'Enter') sendMessage();
}