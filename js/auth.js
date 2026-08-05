// Google sign-in only (build-plan Phase 4, 2026-08-05, direct instruction:
// "apple login we can do later, email login not needed"). Thin wrapper
// around Firebase Auth's own functions — boot.js is the only caller that
// needs to reason about auth state; everything else just reacts to
// whichever screen boot.js decides to mount.

import { auth } from "./firebase.js";
import { GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } from "firebase/auth";

const googleProvider = new GoogleAuthProvider();

// Popup is the default (no page navigation, best UX) — but real browsers
// often block it (popup blockers, some in-app/embedded webviews), and it
// silently hangs rather than rejecting in some of those cases rather than
// throwing immediately. Falls back to a full-page redirect on the
// specific errors that mean "a popup genuinely couldn't open" — NOT on
// auth/popup-closed-by-user, which means the person deliberately backed
// out and shouldn't be bounced into a redirect they didn't ask for.
function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider).catch((err) => {
    if (err?.code === "auth/popup-blocked" || err?.code === "auth/operation-not-supported-in-this-environment") {
      return signInWithRedirect(auth, googleProvider);
    }
    throw err;
  });
}

// Completes a signInWithRedirect() round trip — call once at boot, before
// (or alongside) the onAuthChange listener. A no-op promise resolving to
// null if this load isn't the return leg of a redirect.
function completeRedirectSignIn() {
  return getRedirectResult(auth);
}

function signOutUser() {
  return signOut(auth);
}

// Fires once with the current state (from cached persistence or a fresh
// check) and again on any real sign-in/sign-out — the one place boot.js
// needs to hook to decide what to show.
function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

function getCurrentUser() {
  return auth.currentUser;
}

export { signInWithGoogle, completeRedirectSignIn, signOutUser, onAuthChange, getCurrentUser };
