const firebaseConfig = {
  apiKey: "AIzaSyBY-r3ZA7b4nhEN_Xy86Uz8_lwlVnyrhoM", // Вставь сюда свой настоящий apiKey
  authDomain: "appp-c5632.firebaseapp.com",
  projectId: "appp-c5632",
  storageBucket: "appp-c5632.firebasestorage.app",
  messagingSenderId: "36769601467",
  appId: "1:36769601467:web:67b0956db8cbb9cf93569e"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();