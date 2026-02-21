const MAX_IMAGES = 7;

const uploadForm = document.getElementById('upload-form');
const imagesInput = document.getElementById('images');
const uploadHint = document.getElementById('upload-hint');

if (uploadForm && imagesInput) {
  imagesInput.addEventListener('change', () => {
    const n = imagesInput.files?.length ?? 0;
    if (n > MAX_IMAGES) {
      uploadHint.textContent = `Please select at most ${MAX_IMAGES} images (you selected ${n}).`;
      uploadHint.style.color = '#c00';
      imagesInput.value = '';
    } else if (n > 0) {
      uploadHint.textContent = `${n} image(s) selected.`;
      uploadHint.style.color = '';
    } else {
      uploadHint.textContent = '';
    }
  });

  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = imagesInput.files?.length ?? 0;
    if (n === 0) {
      uploadHint.textContent = 'Please select at least one image.';
      uploadHint.style.color = '#c00';
      return;
    }
    if (n > MAX_IMAGES) {
      uploadHint.textContent = `Maximum ${MAX_IMAGES} images allowed.`;
      uploadHint.style.color = '#c00';
      return;
    }

    const resultsEl = document.getElementById('upload-results');
    if (resultsEl) resultsEl.innerHTML = '';
    uploadHint.textContent = 'Processing…';
    uploadHint.style.color = '';

    const formData = new FormData();
    for (const file of imagesInput.files) {
      formData.append('images', file);
    }

    try {
      const res = await fetch('/upload', {
        method: 'POST',
        body: formData,
      });

      const contentType = res.headers.get('Content-Type') || '';
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        uploadHint.textContent = 'Error: ' + (data.error || res.statusText);
        uploadHint.style.color = '#c00';
        return;
      }

      if (!contentType.startsWith('multipart/mixed')) {
        uploadHint.textContent = 'Unexpected response from server.';
        uploadHint.style.color = '#c00';
        return;
      }

      const boundaryMatch = contentType.match(/boundary=([^;\s]+)/);
      const boundary = boundaryMatch ? boundaryMatch[1].trim() : null;
      if (!boundary) {
        uploadHint.textContent = 'Invalid multipart response.';
        uploadHint.style.color = '#c00';
        return;
      }

      const buf = await res.arrayBuffer();
      const parts = parseMultipartMixed(buf, boundary);
      uploadHint.textContent = parts.length ? `Done. ${parts.length} image(s) with background removed.` : 'No images returned.';
      uploadHint.style.color = '';

      if (resultsEl && parts.length) {
        const list = document.createElement('div');
        list.style.display = 'flex';
        list.style.flexWrap = 'wrap';
        list.style.gap = '1rem';
        list.style.marginTop = '1rem';
        for (const part of parts) {
          const card = document.createElement('div');
          card.style.flex = '1 1 200px';
          const img = document.createElement('img');
          img.src = URL.createObjectURL(part.blob);
          img.alt = part.filename;
          img.style.maxWidth = '100%';
          img.style.height = 'auto';
          img.style.display = 'block';
          const a = document.createElement('a');
          a.href = img.src;
          a.download = part.filename;
          a.textContent = 'Download ' + part.filename;
          a.style.display = 'inline-block';
          a.style.marginTop = '0.25rem';
          card.appendChild(img);
          card.appendChild(a);
          list.appendChild(card);
        }
        resultsEl.appendChild(list);
      }
      imagesInput.value = '';
    } catch (err) {
      uploadHint.textContent = 'Error: ' + err.message;
      uploadHint.style.color = '#c00';
    }
  });

  function parseMultipartMixed(arrayBuffer, boundary) {
    const parts = [];
    const bytes = new Uint8Array(arrayBuffer);
    const boundaryBytes = new TextEncoder().encode('\r\n--' + boundary);
    const endBoundaryBytes = new TextEncoder().encode('\r\n--' + boundary + '--');
    const doubleCrlf = new TextEncoder().encode('\r\n\r\n');

    function indexOf(haystack, needle, start) {
      const n = needle.length;
      if (n === 0) return start;
      for (let i = start; i <= haystack.length - n; i++) {
        let match = true;
        for (let j = 0; j < n; j++) {
          if (haystack[i + j] !== needle[j]) {
            match = false;
            break;
          }
        }
        if (match) return i;
      }
      return -1;
    }

    let pos = 0;
    const startBoundary = new TextEncoder().encode('--' + boundary + '\r\n');
    const first = indexOf(bytes, startBoundary, 0);
    if (first === -1) return parts;
    pos = first + startBoundary.length;

    while (pos < bytes.length) {
      const nextBound = indexOf(bytes, boundaryBytes, pos);
      const endBound = indexOf(bytes, endBoundaryBytes, pos);
      const partEnd = nextBound === -1 ? endBound : (endBound === -1 ? nextBound : Math.min(nextBound, endBound));
      if (partEnd === -1) break;

      const headerBlock = bytes.subarray(pos, partEnd);
      const crlfIdx = indexOf(headerBlock, doubleCrlf, 0);
      if (crlfIdx === -1) {
        pos = partEnd + boundaryBytes.length;
        continue;
      }
      const headerBytes = headerBlock.subarray(0, crlfIdx);
      const bodyStart = pos + crlfIdx + doubleCrlf.length;
      const bodyEnd = partEnd;
      let body = bytes.subarray(bodyStart, bodyEnd);
      if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a) {
        body = body.subarray(0, body.length - 2);
      }

      const headerText = new TextDecoder().decode(headerBytes);
      const filenameMatch = headerText.match(/filename="([^"]*)"/);
      const filename = filenameMatch ? filenameMatch[1] : 'image.png';

      parts.push({
        filename,
        blob: new Blob([body], { type: 'image/png' }),
      });

      if (endBound !== -1 && partEnd === endBound) break;
      pos = partEnd + boundaryBytes.length;
    }
    return parts;
  }
}

const form = document.getElementById('users-form');
const statusEl = document.getElementById('status');
const listEl = document.getElementById('user-list');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  statusEl.textContent = 'Loading…';
  listEl.innerHTML = '';

  try {
    // Same origin via Caddy: /trpc/* is proxied to the app
    const res = await fetch('/trpc/userList');
    const json = await res.json();

    if (!res.ok) {
      statusEl.textContent = 'Error: ' + (json.error?.message || res.statusText);
      return;
    }

    const users = json.result?.data ?? [];
    statusEl.textContent = users.length ? '' : 'No users.';

    for (const u of users) {
      const li = document.createElement('li');
      li.textContent = [u.id, u.name ?? '—', u.email].join(' · ');
      listEl.appendChild(li);
    }
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
  }
});