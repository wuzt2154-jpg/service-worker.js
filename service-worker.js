/* SAME PLACE: push-only service worker, no fetch interception. */

const DB = 'sp-push-device-state';
const STORE = 'identity';

function identity(write) {
  return new Promise(resolve => {
    const request = indexedDB.open(DB, 1);

    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE);

    request.onerror = () => resolve(null);

    request.onsuccess = () => {
      const db = request.result;

      const tx = db.transaction(
        STORE,
        write === undefined ? 'readonly' : 'readwrite'
      );

      const os = tx.objectStore(STORE);

      const r = write === undefined
        ? os.get('user')
        : os.put(write, 'user');

      r.onsuccess = () =>
        resolve(write === undefined ? r.result : write);

      r.onerror = () => resolve(null);

      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    };
  });
}

self.addEventListener('message', event => {
  if (event.data?.kind === 'SP_IDENTITY') {
    event.waitUntil?.(
      identity(event.data.user_id || null)
    );
  }
});

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let d = {};

    try {
      d = event.data?.json() || {};
    } catch {}

    if (
      !d.receiver_id ||
      !d.message_id ||
      !d.sender_id ||
      !d.space_id
    ) return;

    const bound = await identity();

    if (!bound || bound !== d.receiver_id) return;

    const record = {
      id: d.message_id,
      sender_id: d.sender_id,
      receiver_id: d.receiver_id,
      space_id: d.space_id,
      media_type: d.media_type || null
    };

    const visible = (
      await clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      })
    ).filter(c => c.visibilityState === 'visible');

    for (const client of visible) {
      const handled = await new Promise(resolve => {
        const ch = new MessageChannel();

        const timer = setTimeout(
          () => resolve(false),
          750
        );

        ch.port1.onmessage = e => {
          clearTimeout(timer);
          resolve(e.data?.handled === true);
        };

        try {
          client.postMessage(
            {
              kind: 'SP_PUSH_FOREGROUND',
              record
            },
            [ch.port2]
          );
        } catch {
          clearTimeout(timer);
          resolve(false);
        }
      });

      if (handled) return;
    }

    const target = new URL(self.registration.scope);

    target.searchParams.set(
      'space_id',
      d.space_id
    );

    target.searchParams.set(
      'dm',
      d.sender_id
    );

    await self.registration.showNotification(
      '同场 SAME PLACE',
      {
        body: String(
          d.body || '你收到了一条新私聊消息'
        ).slice(0, 130),

        icon: './icon.svg',
        badge: './icon.svg',

        tag: 'sp-dm-' + d.message_id,

        data: {
          url: target.href,
          receiver_id: d.receiver_id
        },

        renotify: false
      }
    );
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const url =
    event.notification.data?.url ||
    self.registration.scope;

  event.waitUntil((async () => {
    const windows = await clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    for (const w of windows) {
      if (w.url.startsWith(self.registration.scope)) {
        if ('navigate' in w) {
          await w.navigate(url);
        }

        return w.focus();
      }
    }

    return clients.openWindow(url);
  })());
});
