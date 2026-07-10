// Self-service registration (spec §III.6a). Posts a request; server auto-approves
// verified auto-approve domains, else marks pending for admin approval.
const btn = document.getElementById("ra-submit");
const msg = document.getElementById("ra-msg");

btn?.addEventListener("click", async () => {
  btn.disabled = true;
  try {
    const justification = (document.getElementById("just").value || "").slice(0, 500);
    const r = await fetch("/api/access-requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ justification }),
    });
    const data = await r.json().catch(() => ({}));
    if (data.status === "active") {
      msg.textContent = "Approved — you now have access. Redirecting…";
      setTimeout(() => (window.location.href = "/"), 1200);
    } else if (data.status === "pending") {
      msg.textContent = "Request submitted. You'll get access once an admin approves it.";
    } else {
      msg.textContent = "Could not submit the request. Please try again.";
      btn.disabled = false;
    }
  } catch {
    msg.textContent = "Network error. Please try again.";
    btn.disabled = false;
  }
});
