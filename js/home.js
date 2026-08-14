/* Home page: renders the product grid. Clicking a card opens that
   product's detail page; the Add button still adds straight to cart. */

"use strict";

productsReady.then(products => {
  const container = document.getElementById("products");
  container.innerHTML = "";

  if(products.length === 0){
    container.appendChild(el("div", "empty-note", "No products yet. Add one in PRODUCTS in js/data.js."));
    return;
  }

  // Auto-sort: alphabetical by name, every time the page renders.
  const sorted = products.slice().sort((a, b) => a.name.localeCompare(b.name));

  sorted.forEach((p, i) => {
    const card = el("div", "card card-link");
    card.style.animationDelay = (i * 45) + "ms";

    const url = "product.html?p=" + p.slug;
    card.addEventListener("click", () => { window.location.href = url; });

    const image = el("div", "card-image", PLACEHOLDER_ICON);
    card.appendChild(image);

    const info = el("div", "card-info");
    info.appendChild(el("div", "card-rating", starsMarkup(p.rating, p.reviews)));
    info.appendChild(el("div", "card-name", p.name));

    const bottom = el("div", "card-bottom");
    bottom.appendChild(el("div", "card-price", fmtPrice(p.price)));

    const btn = el("button", "add-cart", "Add");
    btn.type = "button";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      addToCart({ slug: p.slug, option: "single", name: p.name, price: p.price });
      bumpCartButton();
      showToast("Added: " + p.name);
    });
    bottom.appendChild(btn);

    info.appendChild(bottom);
    card.appendChild(info);
    container.appendChild(card);
  });
});
