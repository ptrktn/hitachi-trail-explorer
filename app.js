if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js');
}

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
let tileOrigin = { x: 0, y: 0 };
const zoom = 15;  // Fixed zoom level for simplicity
let tilesWide = 3;
let tilesHigh = 3;
const tileSize = 256;

let markerLat = 0;
let markerLon = 0;
let lastAccuracy = 0;
let isDragging = false;
let dragStart = { x: 0, y: 0 };
const canvas = document.getElementById('mapCanvas');
const ctx = canvas.getContext('2d');
canvas.width = tilesWide * tileSize;
canvas.height = tilesHigh * tileSize;

/*
window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  drawMap(tileOrigin.x, tileOrigin.y, zoom, tilesWide, tilesHigh, markerLat, markerLon, lastAccuracy);
});
*/

function handleTilePan(dx, dy) {
  const threshold = 64; // Minimum drag distance to trigger pan
  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx > threshold) tileOrigin.x -= 1; // pan west
    else if (dx < -threshold) tileOrigin.x += 1; // pan east
  } else {
    if (dy > threshold) tileOrigin.y -= 1; // pan north
    else if (dy < -threshold) tileOrigin.y += 1; // pan south
  }

  drawMap(tileOrigin.x, tileOrigin.y, zoom, tilesWide, tilesHigh, markerLat, markerLon, lastAccuracy);
}

canvas.addEventListener("mousedown", (e) => {
  isDragging = true;
  dragStart.x = e.offsetX;
  dragStart.y = e.offsetY;
});

canvas.addEventListener("mouseup", (e) => {
  if (!isDragging) return;
  isDragging = false;
  handleTilePan(e.offsetX - dragStart.x, e.offsetY - dragStart.y);
});

canvas.addEventListener("touchstart", (e) => {
  if (e.touches.length !== 1) return;
  isDragging = true;
  const touch = e.touches[0];
  dragStart.x = touch.clientX;
  dragStart.y = touch.clientY;
});

canvas.addEventListener("touchend", (e) => {
  if (!isDragging) return;
  isDragging = false;
  const touch = e.changedTouches[0];
  handleTilePan(touch.clientX - dragStart.x, touch.clientY - dragStart.y);
});

function tileToLatLon(x, y, zoom) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, zoom);
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  const lon = (x / Math.pow(2, zoom)) * 360 - 180;
  return { lat, lon };
}

function getTileOrigin(lat, lon, zoom, tilesWide, tilesHigh) {
  const center = latLonToTile(lat, lon, zoom);
  return {
    x: Math.floor(center.x - tilesWide / 2),
    y: Math.floor(center.y - tilesHigh / 2)
  };
}

function centerOn(lat, lon) {
  downloadTilesAround(lat, lon, zoom, 1);
  const center = latLonToTile(lat, lon, zoom);
  tileOrigin.x = center.x - Math.trunc(tilesWide / 2);
  tileOrigin.y = center.y - Math.trunc(tilesHigh / 2);
  drawMap(tileOrigin.x, tileOrigin.y, zoom, tilesWide, tilesHigh, markerLat, markerLon, lastAccuracy);
}

function parseGPX(gpxText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(gpxText, 'application/xml');
  const points = Array.from(xml.querySelectorAll('trkpt')).map(pt => ({
    lat: parseFloat(pt.getAttribute('lat')),
    lon: parseFloat(pt.getAttribute('lon'))
  }));
  
  console.log(`Parsed ${points.length} points from GPX`);

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
    console.log(`Caching ${tiles.length} map tiles...`);
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
    console.log('All tiles already cached!');
    return;
  }

  const batches = Math.ceil(uncached.length / batchSize);
  const time = Math.ceil(batches * delayMs / 1000);
  console.log(`Caching ${uncached.length} new tiles in ${batches} batches, estimated download time ${time} seconds.`);

  // Throttle: send in batches
  for (let i = 0; i < uncached.length; i += batchSize) {
    const batch = uncached.slice(i, i + batchSize);
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg.active) {
        console.log(batch);
        reg.active.postMessage({
          type: 'CACHE_FILES',
          files: batch
        });
      }
    } catch (err) {
      console.error('Service worker not available:', err);
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  console.log('Tile caching completed!');
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
  const locationEl = document.getElementById('location');
  const canvas = document.getElementById('mapCanvas');
  const ctx = canvas.getContext('2d');
  const button = document.getElementById('locationButton');

  locationEl.textContent = 'Getting location...';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  button.disabled = true;

  if (!('geolocation' in navigator)) {
    locationEl.textContent = 'Geolocation not supported.';
    button.disabled = false;
    return;
  }

  const watchId = navigator.geolocation.watchPosition(
    pos => {
      const { latitude, longitude, accuracy } = pos.coords;
      locationEl.textContent = `Latitude: ${latitude.toFixed(5)}, Longitude: ${longitude.toFixed(5)}, Accuracy: ${Math.round(accuracy)}m`;

      // Update map
      // downloadTilesAround(latitude, longitude, 15, 1);
      lastAccuracy = accuracy;
      markerLat = latitude;
      markerLon = longitude;
      centerOn(latitude, longitude);
      // drawMap(latitude, longitude, 15, 1, accuracy);

      // Stop tracking if accuracy is good enough
      if (!isMobile || accuracy <= 25) {
        navigator.geolocation.clearWatch(watchId);
        locationEl.textContent += ' ✅';
        button.disabled = false;
      }
    },
    err => {
      locationEl.textContent = `Error: ${err.message}`;
      button.disabled = false;
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 60000
    }
  );
}

async function drawMap(tileOriginX, tileOriginY, zoom = 15, tilesWide = 3, tilesHigh = 3, markerLat = null, markerLon = null, accuracy = 0) {
  const canvas = document.getElementById('mapCanvas');
  const ctx = canvas.getContext('2d');

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let dx = 0; dx < tilesWide; dx++) {
    for (let dy = 0; dy < tilesHigh; dy++) {
      const x = tileOriginX + dx;
      const y = tileOriginY + dy;
      const url = `https://cyberjapandata.gsi.go.jp/xyz/std/${zoom}/${x}/${y}.png`;

      try {
        const response = await caches.match(url);
        if (response) {
          const blob = await response.blob();
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.src = URL.createObjectURL(blob);
          await new Promise(resolve => {
            img.onload = () => {
              ctx.drawImage(img, dx * tileSize, dy * tileSize, tileSize, tileSize);
              // 🧱 Draw tile boundary 
              ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)'; 
              ctx.lineWidth = 1; 
              ctx.strokeRect(dx * tileSize, dy * tileSize, tileSize, tileSize); 
              // Optional: label tile coordinates 
              ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'; 
              ctx.font = '12px sans-serif'; 
              ctx.fillText(`(${x}, ${y})`, dx * tileSize + 4, dy * tileSize + 14);
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

  // Draw marker if coordinates are provided
  if (markerLat !== null && markerLon !== null) {
    drawMarker(canvas, ctx, markerLat, markerLon, zoom, tileOriginX, tileOriginY, tileSize, accuracy);
  }

  if ('storage' in navigator && 'estimate' in navigator.storage) {
    navigator.storage.estimate().then(({ usage, quota }) => {
      console.log(`Using ${Math.round(usage / 1024)} KB of ${Math.round(quota / 1024)} KB`);
    });
  }
}

function latLonToTileFloat(lat, lon, zoom) {
  const scale = Math.pow(2, zoom);
  const x = ((lon + 180) / 360) * scale;
  const y = ((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2) * scale;
  return { x, y };
}

function drawMarker(canvas, ctx, lat, lon, zoom, startTileX, startTileY, tileSize, accuracy = 0) {
  const tileCoords = latLonToTileFloat(lat, lon, zoom);
  const pixelX = (tileCoords.x - startTileX) * tileSize;
  const pixelY = (tileCoords.y - startTileY) * tileSize;

  // Convert accuracy in meters to pixels at current zoom
  const metersPerPixel = (40075016.686 * Math.cos(lat * Math.PI / 180)) / (Math.pow(2, zoom) * tileSize);
  const radiusPixels = accuracy / metersPerPixel;

  // Draw accuracy circle
  if (accuracy > 5) {
    ctx.beginPath();
    ctx.arc(pixelX, pixelY, radiusPixels, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(0, 0, 255, 0.1)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Draw crosshair marker
  const crossRadius = 20;
  ctx.strokeStyle = 'red';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pixelX - crossRadius, pixelY);
  ctx.lineTo(pixelX + crossRadius, pixelY);
  ctx.moveTo(pixelX, pixelY - crossRadius);
  ctx.lineTo(pixelX, pixelY + crossRadius);
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

