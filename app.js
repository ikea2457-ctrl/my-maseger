let currentUser = localStorage.getItem("chat_username") || "";

const authScreen = document.getElementById("auth-screen");
const chatScreen = document.getElementById("chat-screen");
const nicknameInput = document.getElementById("nickname-input");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const messagesContainer = document.getElementById("messages-container");

// Автоматический вход, если ник сохранён
if (currentUser) {
    showChat();
}

loginBtn.addEventListener("click", () => {
    const nick = nicknameInput.value.trim();
    if (nick) {
        currentUser = nick;
        localStorage.setItem("chat_username", currentUser);
        showChat();
    }
});

logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("chat_username");
    currentUser = "";
    chatScreen.classList.add("hidden");
    authScreen.classList.remove("hidden");
});

function showChat() {
    authScreen.classList.add("hidden");
    chatScreen.classList.remove("hidden");
    loadMessages();
}

// Отправка сообщений
function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !currentUser) return;

    db.collection("messages").add({
        user: currentUser,
        text: text,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        messageInput.value = "";
    }).catch(err => {
        console.error("Ошибка отправки:", err);
    });
}

sendBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendMessage();
});

// Загрузка сообщений в реальном времени
function loadMessages() {
    db.collection("messages")
        .orderBy("timestamp", "asc")
        .onSnapshot(snapshot => {
            messagesContainer.innerHTML = "";
            snapshot.forEach(doc => {
                const data = doc.data();
                renderMessage(data);
            });
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        });
}

function renderMessage(data) {
    const isMy = data.user === currentUser;
    const msgDiv = document.createElement("div");
    msgDiv.className = `msg ${isMy ? "my" : "other"}`;

    if (!isMy) {
        const authorDiv = document.createElement("div");
        authorDiv.className = "msg-author";
        authorDiv.textContent = data.user || "Аноним";
        msgDiv.appendChild(authorDiv);
    }

    const textDiv = document.createElement("div");
    textDiv.textContent = data.text;
    msgDiv.appendChild(textDiv);

    messagesContainer.appendChild(msgDiv);
}