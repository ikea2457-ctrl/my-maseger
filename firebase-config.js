const firebaseConfig = {
  apiKey: "AIzaSyBY-r3ZA7b4nhEN_Xy86Uz8_lwlVnyrhoM", // Вставь сюда свой настоящий apiKey
  authDomain: "my-maseger.firebaseapp.com",
  projectId: "my-maseger",
  storageBucket: "my-maseger.appspot.com",
  messagingSenderId: "1093153406240",
  appId: "1:1093153406240:web:86f66345d8ef6a63507119"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();