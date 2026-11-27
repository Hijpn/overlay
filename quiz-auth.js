"use strict";

const quizFirebaseConfig = {
  apiKey: "AIzaSyDWRpiRnU8o9HN1AEtNg1wgoUb_BbYxdgs",
  authDomain: "sky-stations.firebaseapp.com",
  databaseURL: "https://sky-stations-default-rtdb.firebaseio.com",
  projectId: "sky-stations",
  appId: "1:179325598047:web:8e4ae3c1ef3da5a8b21eea"
};

function startQuizAuthentication(onAuthorized, onLocked) {
  const form = document.getElementById("quiz-form");
  const signInButton = document.getElementById("quiz-sign-in");
  const signOutButton = document.getElementById("quiz-sign-out");
  const message = document.getElementById("quiz-auth-message");
  let started = false;
  let generation = 0;

  function lock(text) {
    form.hidden = true;
    message.textContent = text;
    onLocked(text);
  }

  if (typeof firebase === "undefined" || typeof firebase.auth !== "function") {
    lock("Firebase authentication could not load. Check your connection.");
    return;
  }

  firebase.initializeApp(quizFirebaseConfig);
  const auth = firebase.auth();
  const database = firebase.database();

  signInButton.addEventListener("click", function () {
    signInButton.disabled = true;
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    auth.signInWithPopup(provider).catch(function (error) {
      console.error("Quiz sign-in failed:", error);
      lock("Could not sign in: " + error.message);
    }).finally(function () {
      signInButton.disabled = false;
    });
  });
  signOutButton.addEventListener("click", function () {
    signOutButton.disabled = true;
    auth.signOut().catch(function (error) {
      console.error("Quiz sign-out failed:", error);
      message.textContent = "Could not sign out: " + error.message;
    }).finally(function () {
      signOutButton.disabled = false;
    });
  });

  auth.onAuthStateChanged(function (user) {
    const attempt = ++generation;
    signInButton.hidden = !!user;
    signOutButton.hidden = !user;
    if (!user) {
      lock("Sign in with the authorized Google account to control the quiz.");
      if (started) window.location.reload();
      return;
    }

    lock("Checking access...");
    database.ref("quizControlAccess").once("value").then(function () {
      if (attempt !== generation) return;
      if (!started) {
        started = true;
        onAuthorized(database);
      }
      form.hidden = false;
      message.textContent = "Signed in. Quiz control access is authorized.";
    }).catch(function (error) {
      if (attempt !== generation) return;
      console.error("Quiz control access check failed:", error);
      lock("Quiz access denied or unavailable. Check your account and Firebase rules.");
    });
  }, function (error) {
    console.error("Quiz authentication listener failed:", error);
    lock("Could not verify sign-in: " + error.message);
  });
}
