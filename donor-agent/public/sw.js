self.addEventListener("push", (event) => {
  let data = { title: "Donor Desk", body: "" };
  try {
    data = event.data ? event.data.json() : data;
  } catch {}
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "/icon.svg", tag: "donor-desk" }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((list) => (list.length ? list[0].focus() : self.clients.openWindow("/"))),
  );
});
