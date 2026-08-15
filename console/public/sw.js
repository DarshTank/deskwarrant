/* DeskWarrant service worker — web push only (build plan §7). */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "DeskWarrant", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "DeskWarrant";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.eventId || undefined,
    data: { deviceId: payload.deviceId || null },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const deviceId = event.notification.data && event.notification.data.deviceId;
  const target = deviceId ? `/devices/${deviceId}` : "/devices";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(target) && "focus" in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
