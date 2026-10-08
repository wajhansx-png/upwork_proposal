self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  let data = { title: "Donor Desk", body: "" };
  try {
    data = event.data ? event.data.json() : data;
  } catch {}
  const receipt = data.receiptId
    ? fetch("/api/push/receipt", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ kind: "received", receiptId: data.receiptId, taskId: data.taskId }) }).catch(() => undefined)
    : Promise.resolve();
  event.waitUntil(Promise.all([receipt, self.registration.showNotification(data.title, {
    body: data.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    requireInteraction: !!data.requireInteraction,
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || "/", receiptId: data.receiptId, taskId: data.taskId },
  })]));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const receipt = event.notification.data?.receiptId
    ? fetch("/api/push/receipt", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ kind: "opened", receiptId: event.notification.data.receiptId, taskId: event.notification.data.taskId }) }).catch(() => undefined)
    : Promise.resolve();
  event.waitUntil(
    Promise.all([receipt, self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => (list.length ? list[0].focus() : self.clients.openWindow(event.notification.data?.url || "/")))]),
  );
});
