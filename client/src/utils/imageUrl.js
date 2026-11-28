const SERVER_PORT = 3001;

function getServerBaseUrl() {
  const configured = (process.env.REACT_APP_SERVER_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:${SERVER_PORT}`;
  }
  return `http://localhost:${SERVER_PORT}`;
}

export function normalizeImageInput(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (/^www\./i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export function resolveImageUrl(url) {
  const trimmed = normalizeImageInput(url);
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:image/')) {
    return trimmed;
  }
  if (trimmed.startsWith('/uploads/')) {
    return `${getServerBaseUrl()}${trimmed}`;
  }
  return trimmed;
}

const preloadedUrls = new Set();

export function preloadImages(questions) {
  if (!questions) return;
  const list = Array.isArray(questions) ? questions : [questions];
  list.forEach((q) => {
    if (!q) return;
    const raw = q.imageUrl || q.image;
    if (!raw || typeof raw !== 'string') return;
    const resolved = resolveImageUrl(raw);
    if (resolved && !preloadedUrls.has(resolved)) {
      preloadedUrls.add(resolved);
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.src = resolved;
    }
  });
}

export function compressImage(file, maxWidth = 1200, maxHeight = 1200, quality = 0.85) {
  return new Promise((resolve) => {
    if (
      !file ||
      !file.type ||
      !file.type.startsWith('image/') ||
      file.type === 'image/gif' ||
      file.type === 'image/svg+xml' ||
      file.size < 150 * 1024
    ) {
      return resolve(file);
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width <= maxWidth && height <= maxHeight && file.size < 400 * 1024) {
            return resolve(file);
          }

          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            (blob) => {
              if (blob && blob.size < file.size) {
                const newName = file.name ? file.name.replace(/\.[^.]+$/, '.jpg') : 'compressed.jpg';
                const compressedFile = new File([blob], newName, {
                  type: 'image/jpeg',
                  lastModified: Date.now()
                });
                resolve(compressedFile);
              } else {
                resolve(file);
              }
            },
            'image/jpeg',
            quality
          );
        } catch (err) {
          console.warn('Image compression fallback:', err);
          resolve(file);
        }
      };
      img.onerror = () => resolve(file);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}
