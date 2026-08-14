"use strict";

/* Coming-soon countdown with a split-flap (paper card) flip.

   ─────────────────────────────────────────────
   SET YOUR LAUNCH DATE HERE
   Format: "YYYY-MM-DDTHH:MM:SS" followed by the timezone offset.
   Examples:
     "2026-09-01T18:00:00+02:00"  -> 6pm Swedish summer time
     "2026-09-01T18:00:00Z"       -> 6pm UTC
   ───────────────────────────────────────────── */
const LAUNCH_DATE = "2026-09-01T18:00:00+02:00";

// Where the "Enter the store" button goes once the countdown ends.
const STORE_URL = "index.html";

const TARGET = new Date(LAUNCH_DATE).getTime();
const clock = document.getElementById("flipClock");

const UNITS = [
  { key: "days",    label: "Days" },
  { key: "hours",   label: "Hours" },
  { key: "minutes", label: "Minutes" },
  { key: "seconds", label: "Seconds" }
];

// Tracks the digit currently shown in each card so we only animate the
// ones that actually change.
const cards = {}; // key -> [cardEl, cardEl]

function buildCard(){
  const card = document.createElement("div");
  card.className = "flip-card";
  card.innerHTML =
    '<div class="flip-half top"><span>0</span></div>' +
    '<div class="flip-half bottom"><span>0</span></div>';
  card._value = "0";
  return card;
}

function buildClock(){
  clock.innerHTML = "";
  UNITS.forEach((unit, i) => {
    const group = document.createElement("div");
    group.className = "flip-group";

    const digits = document.createElement("div");
    digits.className = "flip-digits";
    const pair = [buildCard(), buildCard()];
    pair.forEach(c => digits.appendChild(c));
    cards[unit.key] = pair;

    const label = document.createElement("div");
    label.className = "flip-label";
    label.textContent = unit.label;

    group.appendChild(digits);
    group.appendChild(label);
    clock.appendChild(group);

    if(i < UNITS.length - 1){
      const colon = document.createElement("div");
      colon.className = "flip-colon";
      colon.textContent = ":";
      clock.appendChild(colon);
    }
  });
}

// Swaps a single card to `next`, animating the fold if it changed.
function setCard(card, next){
  if(card._value === next) return;
  const prev = card._value;
  card._value = next;

  // The static halves already show the new number underneath; the two
  // animated leaves fold the old top away and drop the new bottom in.
  card.querySelector(".flip-half.top span").textContent = next;
  const bottomStatic = card.querySelector(".flip-half.bottom span");

  const fold = document.createElement("div");
  fold.className = "flip-leaf fold";
  fold.innerHTML = "<span>" + prev + "</span>";

  const unfold = document.createElement("div");
  unfold.className = "flip-leaf unfold";
  unfold.innerHTML = "<span>" + next + "</span>";

  card.appendChild(fold);
  card.appendChild(unfold);

  // Keep the old digit on the lower static half until the new leaf
  // covers it, otherwise the number changes before the paper lands.
  setTimeout(() => { bottomStatic.textContent = next; }, 270);
  setTimeout(() => { fold.remove(); unfold.remove(); }, 620);
}

function setUnit(key, value){
  const text = String(Math.max(0, value)).padStart(2, "0").slice(-2);
  const pair = cards[key];
  setCard(pair[0], text[0]);
  setCard(pair[1], text[1]);
}

function showLive(){
  document.querySelector(".launch-eyebrow").remove();
  clock.outerHTML =
    '<div class="launch-live">' +
      "<h1>We're live</h1>" +
      '<a class="launch-enter" href="' + STORE_URL + '">Enter the store</a>' +
    "</div>";
  const tagline = document.querySelector(".launch-tagline");
  if(tagline) tagline.textContent = "Thanks for waiting.";
}

function tick(){
  const remaining = TARGET - Date.now();
  if(!Number.isFinite(TARGET)){
    document.querySelector(".launch-tagline").textContent =
      "Set LAUNCH_DATE at the top of js/launch.js.";
    return true;
  }
  if(remaining <= 0){
    UNITS.forEach(u => setUnit(u.key, 0));
    setTimeout(showLive, 700);
    return true; // stop ticking
  }
  const totalSeconds = Math.floor(remaining / 1000);
  setUnit("days",    Math.floor(totalSeconds / 86400));
  setUnit("hours",   Math.floor(totalSeconds / 3600) % 24);
  setUnit("minutes", Math.floor(totalSeconds / 60) % 60);
  setUnit("seconds", totalSeconds % 60);
  return false;
}

buildClock();
if(!tick()){
  const timer = setInterval(() => { if(tick()) clearInterval(timer); }, 1000);
}
