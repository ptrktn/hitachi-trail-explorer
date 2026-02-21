if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js');
}

function parseGPX(gpxText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(gpxText, 'application/xml');
  const points = Array.from(xml.querySelectorAll('trkpt')).map(pt => ({
    lat: parseFloat(pt.getAttribute('lat')),
    lon: parseFloat(pt.getAttribute('lon'))
  }));
  return points;
}

function latLonToTile(lat, lon, zoom) {
  const x = Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
  const y = Math.floor(
    (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)
  );
  return { x, y };
}

function downloadTilesAround(lat, lon, zoom = 15, radius = 1) {
  const { x, y } = latLonToTile(lat, lon, zoom);
  const tiles = [];

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const tileX = x + dx;
      const tileY = y + dy;
      const url = `https://cyberjapandata.gsi.go.jp/xyz/std/${zoom}/${tileX}/${tileY}.png`;
      tiles.push(url);
    }
  }

  // FIXME: check cache first and only send uncached tiles to service worker
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'CACHE_FILES',
      files: tiles
    });
    // alert(`Caching ${tiles.length} map tiles...`);
  }
}

function getTilesFromGPXPoints(points, zoom, radius = 1) {
  const tileSet = new Set();

  for (const { lat, lon } of points) {
    const { x, y } = latLonToTile(lat, lon, zoom);
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        tileSet.add(`${zoom}/${x + dx}/${y + dy}`);
      }
    }
  }

  return Array.from(tileSet).map(t => `https://cyberjapandata.gsi.go.jp/xyz/std/${t}.png`);
}

function cacheTilesFromGPXOLD(gpxText, zoom = 15, radius = 1) {
  const points = parseGPX(gpxText);
  const tileURLs = getTilesFromGPXPoints(points, zoom, radius);
  
  console.log(`Identified ${tileURLs.length} unique tiles to cache from GPX track.`);
  console.log(tileURLs);

  // FIXME const uncachedTiles = tileURLs.filter(url => !caches.match(url));
  /// console.log(`Out of those, ${uncachedTiles.length} are not yet cached.`);
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'CACHE_FILES',
      files: tileURLs
    });
    // alert(`Caching ${tileURLs.length} tiles from GPX track...`);
  }
}

async function cacheTilesFromGPX0(gpxText, zoom = 15, radius = 1) {
  const points = parseGPX(gpxText);
  const tileURLs = getTilesFromGPXPoints(points, zoom, radius);

  const cache = await caches.open('static-v1');
  const uncached = [];

  for (const url of tileURLs) {
    const match = await cache.match(url);
    if (!match) {
      uncached.push(url);
    }
  }

  if (uncached.length > 0 && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'CACHE_FILES',
      files: uncached.slice(0, 2) // FIXME: only send two at a time for testing
    });
    // alert(`Caching ${uncached.length} new tiles from GPX track...`);
  } else {
    alert('All tiles already cached!');
  }
}

async function cacheTilesFromGPX(gpxText, zoom = 15, radius = 1, batchSize = 1, delayMs = 1000) {
  const points = parseGPX(gpxText);
  const tileURLs = getTilesFromGPXPoints(points, zoom, radius);

  const cache = await caches.open('static-v1');
  var uncached = [];

  for (const url of tileURLs) {
    const match = await cache.match(url);
    if (!match) {
      uncached.push(url);
    }
  }

  if (uncached.length === 0) {
    // alert('All tiles already cached!');
    return;
  }

  // uncached = uncached.slice(0, 2); // FIXME: limit for testing

  const batches = Math.ceil(uncached.length / batchSize);
  const time = Math.ceil(batches * delayMs / 1000);
  // alert(`Caching ${uncached.length} new tiles in ${batches} batches, estimated download time ${time} seconds.`);

  // Throttle: send in batches
  for (let i = 0; i < uncached.length; i += batchSize) {
    const batch = uncached.slice(i, i + batchSize);
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'CACHE_FILES',
        files: batch
      });
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  //alert('Tile caching complete!');
}



function handleGPXUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    cacheTilesFromGPX(reader.result);
  };
  reader.readAsText(file);
}

function getLocation() {
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude, longitude } = pos.coords;
      document.getElementById('location').textContent =
        `Latitude: ${latitude.toFixed(5)}, Longitude: ${longitude.toFixed(5)}`;

      downloadTilesAround(latitude, longitude, 16, 1);
      drawMap(latitude, longitude, 16, 1);
    }, err => {
      document.getElementById('location').textContent = `Error: ${err.message}`;
    });
  } else {
    // alert('Geolocation not supported');
  }
}

async function drawMap(lat, lon, zoom = 15, radius = 1) {
  const canvas = document.getElementById('mapCanvas');
  const ctx = canvas.getContext('2d');
  const tileSize = 256;

  const center = latLonToTile(lat, lon, zoom);
  const startX = center.x - radius;
  const startY = center.y - radius;

  for (let dx = 0; dx <= 2 * radius; dx++) {
    for (let dy = 0; dy <= 2 * radius; dy++) {
      const x = startX + dx;
      const y = startY + dy;
      const url = `https://cyberjapandata.gsi.go.jp/xyz/std/${zoom}/${x}/${y}.png`;

      try {
        const response = await caches.match(url);
        if (response) {
          const blob = await response.blob();
          const img = new Image();
          img.src = URL.createObjectURL(blob);
          await new Promise(resolve => {
            img.onload = () => {
              ctx.drawImage(img, dx * tileSize, dy * tileSize, tileSize, tileSize);
              resolve();
            };
          });
        } else {
          console.warn('Tile not cached:', url);
        }
      } catch (err) {
        console.error('Error loading tile:', url, err);
      }
    }
  }

  drawMarker(canvas, ctx);
  
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    navigator.storage.estimate().then(({ usage, quota }) => {
      console.log(`Using ${Math.round(usage / 1024)} KB of ${Math.round(quota / 1024)} KB`);
    });
  }

}

function drawMarker(canvas, ctx) {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = 20;

  ctx.strokeStyle = 'red';
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(centerX - radius, centerY);
  ctx.lineTo(centerX + radius, centerY);
  ctx.moveTo(centerX, centerY - radius);
  ctx.lineTo(centerX, centerY + radius);
  ctx.stroke();
}

async function showCache() {
  const cache = await caches.open('static-v1');
  const requests = await cache.keys();
  const list = document.getElementById('cacheList');
  const info = document.getElementById('cacheInfo');
  list.innerHTML = '';

  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const { usage, quota } = await navigator.storage.estimate();
    const pct = (usage / quota * 100).toFixed(1);
    info.textContent = `Cache usage: ${(usage / (1024*1024)).toFixed(1)} MB of ${(quota / (1024*1024)).toFixed(1)} MB (${pct}%)`;
  }

  for (const req of requests) {
    const li = document.createElement('li');
    li.textContent = req.url;
    list.appendChild(li);
  }
}

async function clearCache() {
  const confirmed = confirm('Clear all cached map tiles and images?');
  if (!confirmed) return;

  await caches.delete('static-v1');
  document.getElementById('cacheList').innerHTML = '';
  document.getElementById('cacheInfo').textContent = 'Cache cleared.';
}

