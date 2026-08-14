/* Landing page for the emailed discount link. Sends the token from the
   URL to the backend; on success the visitor goes back to the discount
   popup and presses Continue. */

"use strict";

(async function(){
  const title = document.getElementById("verifyTitle");
  const text = document.getElementById("verifyText");
  const icon = document.getElementById("verifyIcon");

  const token = new URLSearchParams(window.location.search).get("token") || "";

  try {
    const res = await fetch("/api/discount/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(data.error || "Verification failed.");

    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.5 2.5L16 9"/></svg>';
    title.textContent = "Email verified!";
    text.textContent = "Go back to the store and press Continue to unlock your 15% off.";
  } catch(e){
    title.textContent = "Link invalid or expired";
    text.textContent = "Links only last 10 minutes — request a new one from the discount popup.";
  }
})();
