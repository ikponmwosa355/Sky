/* ============================================================
   SKY — Real Friends + Real-time Chat (Firestore)
   Drop-in upgrade. Loads after index.html. Nothing else changes.
   ============================================================ */
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, updateDoc, setDoc,
  collection, addDoc, deleteDoc, query, where, orderBy,
  onSnapshot, serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyA4rBmei6dx51j7mxitmVbMtBYdfOVVlsw",
  authDomain: "david-e9185.firebaseapp.com",
  projectId: "david-e9185",
  storageBucket: "david-e9185.firebasestorage.app",
  messagingSenderId: "479556854966",
  appId: "1:479556854966:web:6576ca58aaf2640ac63217"
};

const app  = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

let me = null;                       // current user object
let unsubscribeChat = null;          // live chat listener
let unsubscribeRequests = null;      // live friend-request listener

/* ---------- Wait until the app's own auth is ready ---------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    me = null;
    if (unsubscribeChat) { unsubscribeChat(); unsubscribeChat = null; }
    if (unsubscribeRequests) { unsubscribeRequests(); unsubscribeRequests = null; }
    return;
  }
  me = user;
  window.currentFirebaseUser = user;

  // Load real friends from Firestore
  await refreshFriends();
  startFriendRequestsListener();

  // Re-render after friends load
  if (typeof renderFriends === "function") renderFriends();
  if (typeof renderChatFriends === "function") renderChatFriends();
  if (typeof renderCallFriends === "function") renderCallFriends();
});

/* ============================================================
   1) REAL FRIENDS LIST
   ============================================================ */
async function refreshFriends() {
  if (!me) return;
  try {
    const snap = await getDoc(doc(db, "skyUsers", me.uid));
    if (!snap.exists()) { window.friends = []; return; }
    const uids = snap.data().friends || [];
    const list = [];
    for (const uid of uids) {
      const f = await getDoc(doc(db, "skyUsers", uid));
      if (f.exists()) {
        const d = f.data();
        list.push({
          uid: uid,
          name: d.name || ((d.firstName||"") + " " + (d.lastName||"")).trim() || "Sky User",
          phone: d.phone || "",
          email: d.email || "",
          online: true,
          avatar: "👤"
        });
      }
    }
    window.friends = list;
  } catch (e) {
    console.error("refreshFriends:", e);
  }
}
window.refreshFriends = refreshFriends;

/* ============================================================
   2) REAL USER SEARCH (override the old searchUsers)
   ============================================================ */
window.searchUsers = async function () {
  const q = (document.getElementById("search").value || "").trim().toLowerCase();
  if (!q) { if (typeof showPage === "function") showPage("home"); return; }

  if (typeof showPage === "function") showPage("searchPage");
  document.getElementById("results").innerHTML = "<p>Searching…</p>";

  try {
    const all = await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js")
      .then(m => m.getDocs(collection(db, "skyUsers")));

    const found = [];
    all.forEach(d => {
      if (d.id === me.uid) return;
      const u = d.data();
      const name = (u.name || ((u.firstName||"") + " " + (u.lastName||""))).trim();
      const email = (u.email || "").toLowerCase();
      if (name.toLowerCase().includes(q) || email.includes(q)) {
        found.push({ uid: d.id, name, email: u.email || "" });
      }
    });

    const friendUids = (window.friends || []).map(f => f.uid);
    document.getElementById("results").innerHTML = found.length
      ? found.map(u => `
          <div class="card">
            <b>👤 ${escapeHTML(u.name)}</b><br>
            <small>${escapeHTML(u.email)}</small><br><br>
            ${friendUids.includes(u.uid)
              ? `<span style="color:green;">✓ Already friends</span>`
              : `<button class="btn" onclick="sendRealFriendRequest('${u.uid}')">👥 Add Friend</button>`}
          </div>`).join("")
      : "<p>No users found.</p>";
  } catch (e) {
    console.error(e);
    document.getElementById("results").innerHTML = "<p>Search failed.</p>";
  }
};

/* ============================================================
   3) REAL FRIEND REQUESTS
   ============================================================ */
window.sendRealFriendRequest = async function (targetUid) {
  if (!me || !targetUid || targetUid === me.uid) return;
  try {
    const existing = await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js")
      .then(m => m.getDocs(query(
        collection(db, "friendRequests"),
        where("fromUid", "==", me.uid),
        where("toUid", "==", targetUid),
        where("status", "==", "pending")
      )));
    if (!existing.empty) { alert("Request already sent."); return; }

    await addDoc(collection(db, "friendRequests"), {
      fromUid: me.uid,
      fromName: me.displayName || me.email || "Sky User",
      toUid: targetUid,
      status: "pending",
      createdAt: serverTimestamp()
    });
    alert("Friend request sent ✅");
  } catch (e) {
    console.error(e);
    alert("Could not send request: " + e.message);
  }
};

function startFriendRequestsListener() {
  if (!me) return;
  if (unsubscribeRequests) unsubscribeRequests();

  const q = query(
    collection(db, "friendRequests"),
    where("toUid", "==", me.uid),
    where("status", "==", "pending")
  );

  unsubscribeRequests = onSnapshot(q, (snap) => {
    const reqs = [];
    snap.forEach(d => reqs.push({ id: d.id, ...d.data() }));
    window.incomingRequests = reqs;
    if (typeof renderFriendRequests === "function") renderFriendRequests();
  }, (e) => console.error("requests listener:", e));
}

window.acceptRealFriendRequest = async function (requestId, fromUid) {
  if (!me) return;
  try {
    await updateDoc(doc(db, "skyUsers", me.uid),     { friends: arrayUnion(fromUid) });
    await updateDoc(doc(db, "skyUsers", fromUid),    { friends: arrayUnion(me.uid)   });
    await deleteDoc(doc(db, "friendRequests", requestId));

    await refreshFriends();
    if (typeof renderFriends === "function") renderFriends();
    if (typeof renderFriendRequests === "function") renderFriendRequests();
    if (typeof renderChatFriends === "function") renderChatFriends();
    if (typeof renderCallFriends === "function") renderCallFriends();
    alert("Friend added ✅");
  } catch (e) {
    console.error(e);
    alert("Accept failed: " + e.message);
  }
};

window.declineRealFriendRequest = async function (requestId) {
  try { await deleteDoc(doc(db, "friendRequests", requestId)); }
  catch (e) { console.error(e); }
};

/* Override the friend-requests UI */
window.renderFriendRequests = function () {
  const box = document.getElementById("friendRequests");
  if (!box) return;
  const reqs = window.incomingRequests || [];
  if (!reqs.length) { box.innerHTML = "<p>No pending friend requests.</p>"; return; }
  box.innerHTML = reqs.map(r => `
    <div class="card">
      <b>👤 ${escapeHTML(r.fromName)}</b><br>
      <button class="btn green" onclick="acceptRealFriendRequest('${r.id}','${r.fromUid}')">Accept</button>
      <button class="btn red"   onclick="declineRealFriendRequest('${r.id}')">Decline</button>
    </div>`).join("");
};

/* ============================================================
   4) REAL-TIME CHAT (override openFriendChat + sendChat)
   ============================================================ */
window.openFriendChat = async function (name) {
  const f = (window.friends || []).find(x => x.name === name);
  if (!f || !f.uid) { alert("You must be friends first."); return; }

  if (unsubscribeChat) { unsubscribeChat(); unsubscribeChat = null; }
  window.currentChat = name;

  document.getElementById("activeChatName").textContent   = name;
  document.getElementById("activeChatStatus").textContent = "● Online";
  document.getElementById("activeChatStatus").className   = "status online";
  document.getElementById("activeChatAvatar").textContent = f.avatar || "👤";

  const box = document.getElementById("chatMessages");
  box.innerHTML = `<div class="msg them">Loading messages…</div>`;
  if (typeof showPage === "function") showPage("messages");
  setTimeout(() => document.getElementById("chatInput").focus(), 100);

  const pairKey = [me.uid, f.uid].sort().join("_");
  const q = query(
    collection(db, "messages"),
    where("pair", "==", pairKey),
    orderBy("createdAt", "asc")
  );

  unsubscribeChat = onSnapshot(q, (snap) => {
    box.innerHTML = "";
    if (snap.empty) {
      box.innerHTML = `<div class="msg them">No messages yet. Say hi 👋</div>`;
      return;
    }
    snap.forEach(d => {
      const m = d.data();
      const mine = m.senderId === me.uid;
      const time = m.createdAt?.toDate?.().toLocaleTimeString?.() || "";
      box.insertAdjacentHTML("beforeend", `
        <div class="msg ${mine ? "me" : "them"}">
          ${escapeHTML(m.text || "")}
          <span class="msg-time">${escapeHTML(time)}</span>
        </div>`);
    });
    box.scrollTop = box.scrollHeight;
  }, (e) => {
    console.error("chat listener:", e);
    box.innerHTML = `<div class="msg them">Could not load: ${escapeHTML(e.message)}</div>`;
  });
};

window.sendChat = async function () {
  const name = window.currentChat;
  if (!name) { alert("Open a chat first."); return; }
  const f = (window.friends || []).find(x => x.name === name);
  if (!f || !f.uid) { alert("Friend not found."); return; }

  const input = document.getElementById("chatInput");
  const text = (input.value || "").trim();
  if (!text) return;

  try {
    await addDoc(collection(db, "messages"), {
      pair: [me.uid, f.uid].sort().join("_"),
      senderId: me.uid,
      senderName: me.displayName || me.email || "Sky User",
      receiverId: f.uid,
      receiverName: f.name,
      text: text,
      type: "text",
      createdAt: serverTimestamp()
    });
    input.value = "";
    input.focus();
  } catch (e) {
    console.error(e);
    alert("Send failed: " + e.message);
  }
};

/* Stop chat listener when leaving the chat page */
const _origShowPage = window.showPage;
window.showPage = function (id) {
  if (id !== "messages" && unsubscribeChat) { unsubscribeChat(); unsubscribeChat = null; }
  if (typeof _origShowPage === "function") return _origShowPage.apply(this, arguments);
};

/* Kick off once scripts are ready */
window.addEventListener("load", () => {
  if (window.refreshFriends) window.refreshFriends();
});

console.log("Sky real friends + chat loaded ✅");