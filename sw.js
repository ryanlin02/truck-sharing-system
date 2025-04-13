const CACHE_NAME = 'truck-sharing-cache-v2';
const DYNAMIC_CACHE = 'truck-dynamic-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/api/placeholder/320/200',
  '/manifest.json'
];

// 安裝Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting()) // 確保新SW立即激活
  );
});

// 激活新的Service Worker
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME, DYNAMIC_CACHE];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // 控制所有客戶端
  );
});

// 攔截請求並處理緩存
self.addEventListener('fetch', event => {
  // 跳過不應緩存的請求
  if (
    event.request.method !== 'GET' || 
    event.request.url.includes('firebaseio.com') ||
    event.request.url.includes('googleapis.com') ||
    event.request.url.includes('firebasestorage.googleapis.com')
  ) {
    return event.respondWith(fetch(event.request).catch(() => {
      return caches.match('/index.html');
    }));
  }

  // 對HTML導航請求使用網絡優先策略
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          return caches.open(DYNAMIC_CACHE)
            .then(cache => {
              cache.put(event.request, response.clone());
              return response;
            });
        })
        .catch(() => {
          return caches.match('/index.html')
            .then(response => {
              return response || caches.match(event.request);
            });
        })
    );
    return;
  }

  // 對API請求使用緩存優先，然後在背景更新
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      caches.match(event.request)
        .then(response => {
          const fetchPromise = fetch(event.request)
            .then(networkResponse => {
              // 更新緩存
              caches.open(DYNAMIC_CACHE)
                .then(cache => {
                  cache.put(event.request, networkResponse.clone());
                });
              return networkResponse;
            });
          // 立即返回緩存的回應，同時更新緩存
          return response || fetchPromise;
        })
    );
    return;
  }

  // 對其他資源使用緩存優先策略
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        
        return fetch(event.request)
          .then(fetchResponse => {
            // 檢查回應是否有效
            if (!fetchResponse || fetchResponse.status !== 200) {
              return fetchResponse;
            }
            
            return caches.open(DYNAMIC_CACHE)
              .then(cache => {
                cache.put(event.request, fetchResponse.clone());
                return fetchResponse;
              });
          })
          .catch(error => {
            // 如果是圖片請求失敗，返回預設圖片
            if (event.request.url.match(/\.(jpg|jpeg|png|gif|bmp|webp)$/)) {
              return caches.match('/api/placeholder/320/200');
            }
            throw error;
          });
      })
  );
});

// 處理推送通知
self.addEventListener('push', event => {
  if (!event.data) return;
  
  const data = event.data.json();
  
  const options = {
    body: data.body || '有新消息',
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    data: {
      url: data.url || '/'
    }
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || '大貨車資訊系統', options)
  );
});

// 點擊通知時的處理
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  if (event.notification.data && event.notification.data.url) {
    event.waitUntil(
      clients.openWindow(event.notification.data.url)
    );
  }
});

// 後台同步功能
self.addEventListener('sync', event => {
  if (event.tag === 'sync-trucks') {
    event.waitUntil(syncTrucks());
  }
});

// 同步待提交的車輛數據
function syncTrucks() {
  return idbKeyval.get('unsyncedTrucks')
    .then(trucks => {
      if (!trucks || !trucks.length) return;
      
      return Promise.all(trucks.map(truck => {
        // 這裡需要實作向Firebase同步數據的邏輯
        // 由於無法直接訪問Firebase，此處省略實際實現
        return fetch('/api/trucks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(truck)
        })
        .then(response => {
          if (response.ok) {
            // 同步成功後從IDB中刪除已同步的項目
            return idbKeyval.get('unsyncedTrucks')
              .then(currentTrucks => {
                return idbKeyval.set('unsyncedTrucks', 
                  currentTrucks.filter(t => t.id !== truck.id)
                );
              });
          }
        });
      }));
    });
}

// 簡易IndexedDB API (idb-keyval)
const idbKeyval = (() => {
  const dbName = 'truck-sharing-idb';
  const storeName = 'keyval-store';
  let dbPromise;
  
  function getDB() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const openreq = indexedDB.open(dbName, 1);
        openreq.onerror = () => reject(openreq.error);
        openreq.onsuccess = () => resolve(openreq.result);
        openreq.onupgradeneeded = () => {
          openreq.result.createObjectStore(storeName);
        };
      });
    }
    return dbPromise;
  }
  
  return {
    get(key) {
      return getDB().then(db => {
        return new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      });
    },
    set(key, value) {
      return getDB().then(db => {
        return new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          const req = store.put(value, key);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      });
    },
    delete(key) {
      return getDB().then(db => {
        return new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          const req = store.delete(key);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      });
    }
  };
})();
