const CACHE_NAME = 'truck-sharing-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/api/placeholder/320/200'
];

// 安裝Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

// 攔截請求並處理緩存
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // 如果找到匹配的緩存則返回
        if (response) {
          return response;
        }
        
        // 克隆請求，因為請求只能使用一次
        const fetchRequest = event.request.clone();
        
        // 對於非GET請求或不支持的URL，直接使用網絡請求
        if (
          fetchRequest.method !== 'GET' || 
          fetchRequest.url.includes('firebaseio.com') ||
          fetchRequest.url.includes('googleapis.com')
        ) {
          return fetch(fetchRequest);
        }
        
        // 請求網絡並緩存回應
        return fetch(fetchRequest).then(
          response => {
            // 檢查回應是否有效
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            
            // 克隆回應，因為回應也只能使用一次
            const responseToCache = response.clone();
            
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });
            
            return response;
          }
        );
      })
      .catch(() => {
        // 如果因網絡離線而失敗，可以在這裡返回自定義的離線頁面
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      })
  );
});

// 清理舊版本緩存
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
