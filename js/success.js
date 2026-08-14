/* Payment success page: Stripe sends the customer back here with a
   session_id in the URL. We ask our own backend to verify the session
   with Stripe (never trusting the URL alone), then clear the cart and
   show the confirmed order. */

"use strict";

(async function(){
  const title = document.getElementById("successTitle");
  const text = document.getElementById("successText");
  const icon = document.getElementById("successIcon");

  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("session_id");

  if(!sessionId){
    title.textContent = "Nothing to confirm";
    text.textContent = "This page only has content right after a checkout.";
    return;
  }

  try {
    const order = await apiConfirm(sessionId);
    if(order.status === "paid"){
      clearCart();
      icon.innerHTML = ICONS.check;
      title.textContent = "Thank you! Order #" + order.orderId + " is confirmed.";
      text.textContent = "We've received your payment of " + fmtPrice(order.subtotal) +
        ". A receipt is on its way to your email.";
    } else {
      title.textContent = "Payment not completed";
      text.textContent = "Order #" + order.orderId + " hasn't been paid yet. " +
        "Your cart is untouched — you can try checking out again.";
    }
  } catch(e){
    title.textContent = "Couldn't verify the payment";
    text.textContent = e.message + " — if you were charged, contact support with this code: " + sessionId;
  }
})();
