/* Product detail page: reads ?p=<slug> from the URL, looks the product
   up in the catalog and renders the page. Every product gets three
   purchase options built from its base price:
     Single    -> 1x price
     Two Pack  -> 2x price, 10% off  (Most popular)
     Trio Pack -> 3x price, 15% off  (Best value)
   The same option table lives in server/pricing.js — the server is the
   authority at checkout, this one only drives the display. */

"use strict";

Promise.all([productsReady, currencyReady]).then(([products]) => {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("p") || "";
  const product = products.find(p => p.slug === slug) || null;

  const root = document.getElementById("productPage");

  if(!product){
    root.innerHTML = "";
    const missing = el("div", "empty-note",
      "Product not found. <a href='index.html'>Back to the shop</a>.");
    root.appendChild(missing);
    return;
  }

  document.title = product.name + " — Aura";

  const OPTIONS = [
    { key: "single", label: "Single",    packOf: 1, discount: 0    },
    { key: "two",    label: "Two Pack",  packOf: 2, discount: 0.10, tag: "Most popular", banner: "MOST POPULAR" },
    { key: "trio",   label: "Trio Pack", packOf: 3, discount: 0.15, tag: "Best value",   banner: "BEST VALUE" }
  ];
  OPTIONS.forEach(o => {
    o.fullPrice = product.price * o.packOf;
    o.price = Math.round(o.fullPrice * (1 - o.discount) * 100) / 100;
  });

  let selectedOption = OPTIONS[0];

  const benefits = product.benefits && product.benefits.length ? product.benefits : [
    "Made to fit the rest of your Aura setup",
    "Free 60-day returns, no questions asked",
    "Ships in plain recyclable packaging"
  ];

  const GALLERY_THUMBS = 6;

  /* ---------- Left column: gallery ---------- */
  const gallery = el("div", "product-gallery");

  const main = el("div", "gallery-main", PLACEHOLDER_ICON);
  const prev = el("button", "gallery-arrow prev", "‹");
  prev.type = "button"; prev.setAttribute("aria-label", "Previous image");
  const next = el("button", "gallery-arrow next", "›");
  next.type = "button"; next.setAttribute("aria-label", "Next image");
  main.appendChild(prev); main.appendChild(next);
  gallery.appendChild(main);

  const thumbs = el("div", "gallery-thumbs");
  const thumbEls = [];
  for(let i = 0; i < GALLERY_THUMBS; i++){
    const t = el("button", "gallery-thumb" + (i === 0 ? " active" : ""), PLACEHOLDER_ICON);
    t.type = "button";
    t.setAttribute("aria-label", "Image " + (i + 1));
    t.addEventListener("click", () => selectThumb(i));
    thumbs.appendChild(t);
    thumbEls.push(t);
  }
  gallery.appendChild(thumbs);

  let activeThumb = 0;
  function selectThumb(i){
    activeThumb = (i + GALLERY_THUMBS) % GALLERY_THUMBS;
    thumbEls.forEach((t, idx) => t.classList.toggle("active", idx === activeThumb));
    // Images are blank placeholders for now; when real photos exist,
    // this is where the main image swaps.
  }
  prev.addEventListener("click", () => selectThumb(activeThumb - 1));
  next.addEventListener("click", () => selectThumb(activeThumb + 1));

  const bestFor = el("div", "best-for-bar",
    "<strong>Best for:</strong> " + (product.category || "Everyday") + " · Aura essentials");
  gallery.appendChild(bestFor);

  /* ---------- Right column: details ---------- */
  const details = el("div", "product-details");

  const titleRow = el("div", "product-title-row");
  const h1 = el("h1", "product-title", product.name);
  titleRow.appendChild(h1);
  if(product.size){
    titleRow.appendChild(el("span", "product-size-chip", product.size));
  }
  details.appendChild(titleRow);

  const ratingRow = el("div", "product-rating card-rating",
    starsMarkup(product.rating, product.reviews) +
    '<span class="review-label">' + (product.reviews || 0) + " reviews</span>");
  details.appendChild(ratingRow);

  const setPill = el("div", "set-pill",
    ICONS.gift + " <strong>Build Your Own Set:</strong> save up to 20% + get 3 free gifts");
  details.appendChild(setPill);

  const benefitList = el("ul", "benefit-list");
  benefits.slice(0, 3).forEach(b => {
    benefitList.appendChild(el("li", "", "<span class='benefit-dot'>✦</span>" + b));
  });
  details.appendChild(benefitList);

  /* Purchase options */
  const optionsBox = el("div", "option-list");
  const optionEls = {};

  OPTIONS.forEach(o => {
    const wrap = el("div", "option-wrap");
    if(o.banner){
      wrap.appendChild(el("div", "option-banner", o.banner));
    }

    const row = el("button", "option-card" + (o === selectedOption ? " selected" : ""));
    row.type = "button";

    if(o.packOf > 1){
      const img = el("div", "option-img", PLACEHOLDER_ICON);
      row.appendChild(img);
    }

    const info = el("div", "option-info");
    info.appendChild(el("div", "option-label", o.label));
    if(o.tag) info.appendChild(el("div", "option-tag", o.tag));
    row.appendChild(info);

    const priceCol = el("div", "option-price-col");
    const priceLine = el("div", "option-price",
      fmtPrice(o.price) +
      (o.discount ? ' <s>' + fmtPrice(o.fullPrice) + '</s>' : ""));
    priceCol.appendChild(priceLine);
    if(o.discount){
      const chips = el("div", "option-chips");
      chips.appendChild(el("span", "chip", "Save " + Math.round(o.discount * 100) + "%"));
      chips.appendChild(el("span", "chip", "Free USA Shipping"));
      priceCol.appendChild(chips);
    }
    row.appendChild(priceCol);

    row.addEventListener("click", () => selectOption(o));
    wrap.appendChild(row);
    optionsBox.appendChild(wrap);
    optionEls[o.key] = row;
  });
  details.appendChild(optionsBox);

  const addBtn = el("button", "product-add-btn");
  addBtn.type = "button";
  addBtn.addEventListener("click", () => {
    const isSingle = selectedOption.packOf === 1;
    addToCart({
      slug: product.slug,
      option: selectedOption.key,
      name: isSingle ? product.name : product.name + " (" + selectedOption.label + ")",
      price: selectedOption.price
    });
    bumpCartButton();
    showToast("Added: " + product.name + (isSingle ? "" : " — " + selectedOption.label));
  });
  details.appendChild(addBtn);

  function selectOption(o){
    selectedOption = o;
    OPTIONS.forEach(opt => optionEls[opt.key].classList.toggle("selected", opt === o));
    addBtn.textContent = "Add to cart — " + fmtPrice(o.price);
  }
  selectOption(selectedOption);

  const setBox = el("div", "set-box",
    "<div class='set-box-title'>" + ICONS.gift + " <strong>Build Your Own Set</strong> " +
    "<span class='set-highlight'>Save up to 20% + 3 free gifts</span></div>" +
    "<small>Pick your routine, unlock up to 20% off, and get 3 free gifts at 4 items.</small>");
  details.appendChild(setBox);

  const perks = el("div", "perk-row");
  [
    [ICONS.box, "Free USA Shipping $30+"],
    [ICONS.globe, "Free International Shipping $100+"],
    [ICONS.returns, "60-Day Satisfaction Guarantee"]
  ].forEach(([icon, text]) => {
    const perk = el("div", "perk");
    perk.appendChild(el("div", "perk-icon", icon));
    perk.appendChild(el("div", "perk-text", text));
    perks.appendChild(perk);
  });
  details.appendChild(perks);

  root.innerHTML = "";
  root.appendChild(gallery);
  root.appendChild(details);
});
