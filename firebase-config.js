const firebaseConfig = {
  apiKey: "AIzaSyBY-r3ZA7b4nhEN_Xy86Uz8_lwlVnyrhoM",
  authDomain: "appp-c5632.firebaseapp.com",
  projectId: "appp-c5632",
  storageBucket: "appp-c5632.firebasestorage.app",
  messagingSenderId: "36769601467",
  appId: "1:36769601467:web:67b0956db8cbb9cf93569e"
};

// Инициализация
if (typeof firebase !== 'undefined') {
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  // Объявляем global db для app.js
  window.db = firebase.firestore();
} else {
  console.error("SDK Firebase не загружен в index.html!");
}