const express = require('express');
const cookieSession = require('cookie-session');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const archiver = require('archiver');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || 'local-link-passport-secret-change-me';

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DATA_FILE = path.join(DATA_DIR, 'properties.json');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ properties: [], nextId: 1, nextItemId: 1 }, null, 2));
}

function loadData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const CATEGORIES = [
  { key: 'hidden_services', label: 'Hidden Services', desc: 'Pipe & cable locations before walls closed', stage: 'Before lining/gib goes up' },
  { key: 'compliance', label: 'Compliance Documents', desc: 'CCC, producer statements, certificates', stage: 'As each certificate is issued' },
  { key: 'build_progress', label: 'Build Progress', desc: 'Photos through each stage', stage: 'Throughout the build' },
  { key: 'finishes_specs', label: 'Finishes & Specs', desc: 'Paint codes, product specifications', stage: 'As finishes are chosen/installed' },
  { key: 'appliances', label: 'Appliances & Warranties', desc: 'Manuals, models, warranty info', stage: 'On installation' },
  { key: 'contractors', label: 'Contractors', desc: 'Who built it, who to call', stage: 'Any time' },
  { key: 'history', label: 'Renovation & Maintenance History', desc: 'Ongoing updates after handover — renovations, servicing, repairs', stage: 'After handover, ongoing' },
];

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      let propertyId = req.params.id;
      if (!propertyId && req.params.token) {
        const data = loadData();
        const property = data.properties.find((p) => p.upload_token === req.params.token);
        propertyId = property ? property.id : 'unknown';
      }
      const dir = path.join(UPLOADS_DIR, propertyId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const unique = crypto.randomBytes(6).toString('hex');
      cb(null, `${Date.now()}-${unique}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 }, // 15MB per file, up to 20 at once
});

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/files', express.static(UPLOADS_DIR));
app.use(
  cookieSession({
    name: 'll_passport_session',
    secret: SESSION_SECRET,
    maxAge: 24 * 60 * 60 * 1000,
  })
);

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layout(title, body, publicView = false) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — Local Link Home Passport</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="wrap">
    <header class="topbar">
      <div class="brand">Local<span>Link</span> <span class="tag-label">Home Passport</span></div>
      ${!publicView && title !== 'Log in' ? '<a class="logout" href="/admin/logout">Log out</a>' : ''}
    </header>
    <main>${body}</main>
  </div>
</body>
</html>`;
}

function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  return res.redirect('/admin/login');
}

function ensureUploadToken(property, data) {
  if (!property.upload_token) {
    property.upload_token = crypto.randomBytes(16).toString('hex');
    saveData(data);
  }
  return property.upload_token;
}

function isImage(filename) {
  return /\.(jpe?g|png|gif|webp)$/i.test(filename);
}

function isAudio(filename) {
  return /\.(webm|mp3|m4a|wav|ogg|aac)$/i.test(filename);
}

// =====================================================
// PUBLIC — the property passport page (what the NFC tag points to)
// =====================================================
app.get('/p/:slug', (req, res) => {
  const data = loadData();
  const property = data.properties.find((p) => p.slug === req.params.slug);
  if (!property) {
    return res.status(404).send(
      layout('Not found', '<div class="card"><h1>Property not found</h1><p>This passport isn\'t set up yet.</p></div>', true)
    );
  }
  const uploadToken = ensureUploadToken(property, data);

  const sections = CATEGORIES.map((cat) => {
    const items = property.items.filter((i) => i.category === cat.key);
    if (items.length === 0) return '';
    const itemsHtml = items
      .map((item) => {
        if (item.type === 'file') {
          const url = `/files/${property.id}/${item.filename}`;
          if (isImage(item.filename)) {
            return `<div class="passport-item">
              <a href="${url}" target="_blank"><img src="${url}" alt="${escapeHtml(item.caption || '')}" class="passport-photo"></a>
              ${item.caption ? `<p class="caption">${escapeHtml(item.caption)}</p>` : ''}
            </div>`;
          }
          if (isAudio(item.filename)) {
            return `<div class="passport-item audio-item">
              ${item.caption ? `<p class="caption">🎙️ ${escapeHtml(item.caption)}</p>` : '<p class="caption">🎙️ Voice note</p>'}
              <audio controls src="${url}"></audio>
            </div>`;
          }
          return `<div class="passport-item file-item">
            <a href="${url}" target="_blank">📄 ${escapeHtml(item.caption || item.original_name)}</a>
          </div>`;
        }
        // text note item
        return `<div class="passport-item note-item">
          <strong>${escapeHtml(item.caption || '')}</strong>
          <p>${escapeHtml(item.note || '')}</p>
        </div>`;
      })
      .join('');
    return `<section class="passport-section">
      <h2>${cat.label}</h2>
      <p class="muted">${cat.desc}</p>
      <div class="passport-grid">${itemsHtml}</div>
    </section>`;
  }).join('');

  res.send(
    layout(
      property.address,
      `<div class="passport-header">
        <h1>${escapeHtml(property.address)}</h1>
        ${property.build_year ? `<p class="muted">Built ${escapeHtml(property.build_year)}</p>` : ''}
      </div>
      ${sections || '<p class="muted">No records added yet.</p>'}
      <div class="add-update-banner">
        <p>Renovated, serviced, or upgraded something? Keep this record current.</p>
        <a href="/u/${uploadToken}" class="btn">+ Add a photo or document</a>
      </div>`,
      true
    )
  );
});

// =====================================================
// BUILDER UPLOAD LINK — no login required, scoped to one property only
// This is the link you share with a builder so they can add photos/docs
// directly without needing your admin password.
// =====================================================
app.get('/u/:token', (req, res) => {
  const data = loadData();
  const property = data.properties.find((p) => p.upload_token === req.params.token);
  if (!property) {
    return res.status(404).send(
      layout('Not found', '<div class="card"><h1>Link not recognised</h1><p>Check the link is correct, or ask for a new one.</p></div>', true)
    );
  }

  const categoryButtons = CATEGORIES.map((cat) => {
    const count = property.items.filter((i) => i.category === cat.key).length;
    return `<div class="builder-cat">
      <div class="builder-cat-head">
        <div>
          <div class="builder-cat-title">${cat.label} ${count > 0 ? `<span class="count-badge">${count}</span>` : ''}</div>
          <div class="builder-cat-stage">📅 ${escapeHtml(cat.stage)}</div>
        </div>
      </div>
      <form method="POST" action="/u/${req.params.token}/upload" enctype="multipart/form-data" class="builder-upload-form">
        <input type="hidden" name="category" value="${cat.key}">
        <input type="file" name="files" multiple accept="image/*,application/pdf">
        <input type="text" name="caption" placeholder="What is this? (optional)">
        <button type="submit">Add to ${cat.label}</button>
        <span class="upload-status"></span>
      </form>
      <div class="voice-recorder" data-category="${cat.key}" data-upload-url="/u/${req.params.token}/upload">
        <button type="button" class="voice-record-btn">🎙️ Record a voice note</button>
        <div class="voice-recorder-active" style="display:none;">
          <span class="voice-timer">0:00</span>
          <button type="button" class="voice-stop-btn">⏹ Stop</button>
        </div>
        <div class="voice-preview" style="display:none;">
          <p class="voice-ready-msg">🎙️ Recording ready (<span class="voice-recorded-length"></span>) — add a caption if you like, then upload.</p>
          <input type="text" class="voice-caption" placeholder="What's this about? (optional)">
          <button type="button" class="voice-upload-btn">Add voice note</button>
          <button type="button" class="voice-discard-btn">Discard and re-record</button>
        </div>
        <span class="voice-status"></span>
      </div>
    </div>`;
  }).join('');

  res.send(
    layout(
      `Upload — ${property.address}`,
      `<div class="builder-header">
        <h1>${escapeHtml(property.address)}</h1>
        <p class="muted">Add photos and documents as you go. No login needed — just tap a category below and upload.</p>
      </div>
      <div class="builder-checklist card">
        <strong>Quick reminder — when to add what:</strong>
        <p class="muted small">Hidden Services photos need to happen before the walls close. Everything else can be added any time.</p>
      </div>
      ${categoryButtons}
      <script>
        const MAX_DIMENSION = 1800;
        const JPEG_QUALITY = 0.78;

        function compressImage(file) {
          return new Promise((resolve) => {
            if (!file.type.startsWith('image/') || file.type === 'image/gif') return resolve(file);
            const img = new Image();
            const reader = new FileReader();
            reader.onload = (e) => {
              img.onload = () => {
                let { width, height } = img;
                if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                  if (width > height) {
                    height = Math.round((height * MAX_DIMENSION) / width);
                    width = MAX_DIMENSION;
                  } else {
                    width = Math.round((width * MAX_DIMENSION) / height);
                    height = MAX_DIMENSION;
                  }
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                canvas.toBlob(
                  (blob) => {
                    if (!blob || blob.size >= file.size) return resolve(file);
                    resolve(new File([blob], file.name.replace(/\\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' }));
                  },
                  'image/jpeg',
                  JPEG_QUALITY
                );
              };
              img.onerror = () => resolve(file);
              img.src = e.target.result;
            };
            reader.onerror = () => resolve(file);
            reader.readAsDataURL(file);
          });
        }

        document.querySelectorAll('.builder-upload-form').forEach((form) => {
          form.addEventListener('submit', async (e) => {
            const fileInput = form.querySelector('input[type="file"]');
            if (!fileInput.files || fileInput.files.length === 0) {
              e.preventDefault();
              return; // nothing selected, don't submit an empty form
            }

            e.preventDefault();
            const statusEl = form.querySelector('.upload-status');
            const button = form.querySelector('button[type="submit"]');
            button.disabled = true;

            const originalFiles = Array.from(fileInput.files);
            const compressed = [];
            for (let i = 0; i < originalFiles.length; i++) {
              statusEl.textContent = \`Preparing \${i + 1} of \${originalFiles.length}…\`;
              compressed.push(await compressImage(originalFiles[i]));
            }

            statusEl.textContent = 'Uploading…';
            const formData = new FormData();
            formData.append('category', form.querySelector('input[name="category"]').value);
            formData.append('caption', form.querySelector('input[name="caption"]').value);
            compressed.forEach((f) => formData.append('files', f));

            try {
              const res = await fetch(form.action, { method: 'POST', body: formData });
              if (res.redirected || res.ok) {
                statusEl.textContent = 'Added ✓';
                window.location.reload();
              } else {
                statusEl.textContent = 'Failed — try again.';
                button.disabled = false;
              }
            } catch (err) {
              statusEl.textContent = 'Failed — check your connection.';
              button.disabled = false;
            }
          });
        });

        // Voice note recording
        document.querySelectorAll('.voice-recorder').forEach((box) => {
          let mediaRecorder = null;
          let chunks = [];
          let recordedBlob = null;
          let timerInterval = null;
          let seconds = 0;

          const recordBtn = box.querySelector('.voice-record-btn');
          const activeBox = box.querySelector('.voice-recorder-active');
          const stopBtn = box.querySelector('.voice-stop-btn');
          const timerEl = box.querySelector('.voice-timer');
          const previewBox = box.querySelector('.voice-preview');
          const audioPreview = box.querySelector('.voice-audio-preview');
          const captionInput = box.querySelector('.voice-caption');
          const uploadBtn = box.querySelector('.voice-upload-btn');
          const discardBtn = box.querySelector('.voice-discard-btn');
          const statusEl = box.querySelector('.voice-status');

          function formatTime(s) {
            const m = Math.floor(s / 60);
            const r = s % 60;
            return \`\${m}:\${r < 10 ? '0' : ''}\${r}\`;
          }

          recordBtn.addEventListener('click', async () => {
            if (!navigator.mediaDevices || !window.MediaRecorder) {
              statusEl.textContent = 'Voice recording is not supported on this browser.';
              return;
            }
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
              chunks = [];
              const candidates = ['audio/mp4', 'audio/webm', 'audio/ogg', 'audio/aac'];
              const supportedType = candidates.find((t) => window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(t));
              mediaRecorder = supportedType ? new MediaRecorder(stream, { mimeType: supportedType }) : new MediaRecorder(stream);
              mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
              mediaRecorder.onstop = () => {
                const actualType = mediaRecorder.mimeType || 'audio/webm';
                recordedBlob = new Blob(chunks, { type: actualType });
                box.dataset.audioType = actualType;
                audioPreview.src = URL.createObjectURL(recordedBlob);
                previewBox.style.display = 'flex';
                activeBox.style.display = 'none';
                recordBtn.style.display = 'none';
                stream.getTracks().forEach((t) => t.stop());
              };
              mediaRecorder.start();
              seconds = 0;
              timerEl.textContent = '0:00';
              timerInterval = setInterval(() => {
                seconds += 1;
                timerEl.textContent = formatTime(seconds);
              }, 1000);
              recordBtn.style.display = 'none';
              activeBox.style.display = 'flex';
              statusEl.textContent = '';
            } catch (err) {
              statusEl.textContent = 'Microphone access denied or unavailable.';
            }
          });

          stopBtn.addEventListener('click', () => {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
            clearInterval(timerInterval);
          });

          discardBtn.addEventListener('click', () => {
            recordedBlob = null;
            previewBox.style.display = 'none';
            recordBtn.style.display = 'inline-block';
            captionInput.value = '';
            statusEl.textContent = '';
          });

          uploadBtn.addEventListener('click', async () => {
            if (!recordedBlob) return;
            uploadBtn.disabled = true;
            statusEl.textContent = 'Uploading…';
            const formData = new FormData();
            formData.append('category', box.dataset.category);
            formData.append('caption', captionInput.value || 'Voice note');
            const audioType = box.dataset.audioType || 'audio/webm';
            const ext = audioType.includes('mp4') ? 'm4a' : audioType.includes('ogg') ? 'ogg' : audioType.includes('aac') ? 'aac' : 'webm';
            formData.append('files', new File([recordedBlob], \`voice-note-\${Date.now()}.\${ext}\`, { type: audioType }));

            try {
              const res = await fetch(box.dataset.uploadUrl, { method: 'POST', body: formData });
              if (res.redirected || res.ok) {
                statusEl.textContent = 'Added ✓';
                window.location.reload();
              } else {
                statusEl.textContent = 'Failed — try again.';
                uploadBtn.disabled = false;
              }
            } catch (err) {
              statusEl.textContent = 'Failed — check your connection.';
              uploadBtn.disabled = false;
            }
          });
        });
      </script>`,
      true
    )
  );
});

app.post('/u/:token/upload', upload.array('files', 20), (req, res) => {
  const data = loadData();
  const property = data.properties.find((p) => p.upload_token === req.params.token);
  if (!property || !req.files || req.files.length === 0) return res.redirect('back');

  const sharedCaption = (req.body.caption || '').trim();
  req.files.forEach((file) => {
    property.items.push({
      id: String(data.nextItemId),
      type: 'file',
      category: req.body.category,
      filename: file.filename,
      original_name: file.originalname,
      caption: sharedCaption,
      uploaded_at: new Date().toISOString(),
      added_by: 'builder_link',
    });
    data.nextItemId += 1;
  });
  saveData(data);
  res.redirect(`/u/${req.params.token}`);
});

// =====================================================
// ADMIN
// =====================================================
app.get('/admin/login', (req, res) => {
  const error = req.query.error ? '<p class="error">Incorrect password.</p>' : '';
  res.send(
    layout(
      'Log in',
      `<div class="card narrow">
        <h1>Home Passport Admin</h1>
        ${error}
        <form method="POST" action="/admin/login">
          <label>Password</label>
          <input type="password" name="password" required autofocus>
          <button type="submit">Log in</button>
        </form>
      </div>`
    )
  );
});

app.post('/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.loggedIn = true;
    return res.redirect('/admin');
  }
  res.redirect('/admin/login?error=1');
});

app.get('/admin/logout', (req, res) => {
  req.session = null;
  res.redirect('/admin/login');
});

app.get('/admin', requireAuth, (req, res) => {
  const data = loadData();
  const rows = data.properties
    .map(
      (p) => `
      <tr>
        <td><strong>${escapeHtml(p.address)}</strong><br><span class="muted">/p/${escapeHtml(p.slug)}</span></td>
        <td>${p.items.length}</td>
        <td class="actions">
          <a href="/admin/properties/${p.id}">Manage</a>
          <a href="/admin/properties/${p.id}/edit-info">Edit</a>
          <a href="/p/${escapeHtml(p.slug)}" target="_blank">View public page</a>
          <a href="/admin/properties/${p.id}/delete-confirm" class="danger-link">Delete</a>
        </td>
      </tr>`
    )
    .join('');

  res.send(
    layout(
      'Dashboard',
      `<div class="header-row">
        <h1>Properties</h1>
        <a class="btn" href="/admin/properties/new">+ New property</a>
      </div>
      <div class="card">
        ${
          data.properties.length === 0
            ? '<p class="muted">No properties yet. Create your first one to build its passport.</p>'
            : `<table>
                <thead><tr><th>Property</th><th>Records</th><th></th></tr></thead>
                <tbody>${rows}</tbody>
              </table>`
        }
      </div>`
    )
  );
});

app.get('/admin/properties/new', requireAuth, (req, res) => {
  res.send(renderPropertyForm(null, null, `${req.protocol}://${req.get('host')}`));
});

app.post('/admin/properties', requireAuth, (req, res) => {
  const { slug, address, build_year } = req.body;
  const cleanSlug = (slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const liveOrigin = `${req.protocol}://${req.get('host')}`;

  if (!cleanSlug || !address) {
    return res.send(renderPropertyForm(null, 'Please fill in the address and link slug.', liveOrigin));
  }

  const data = loadData();
  if (data.properties.some((p) => p.slug === cleanSlug)) {
    return res.send(renderPropertyForm(null, `The link "/p/${cleanSlug}" is already taken. Choose another.`, liveOrigin));
  }

  const newProperty = {
    id: String(data.nextId),
    slug: cleanSlug,
    address: address.trim(),
    build_year: (build_year || '').trim(),
    upload_token: crypto.randomBytes(16).toString('hex'),
    items: [],
    created_at: new Date().toISOString(),
  };
  data.properties.push(newProperty);
  data.nextId += 1;
  saveData(data);
  res.redirect(`/admin/properties/${newProperty.id}`);
});

function renderPropertyForm(property, error, liveOrigin) {
  const isEdit = !!property;
  const domainDisplay = liveOrigin || 'yourdomain.com';
  return layout(
    isEdit ? 'Edit property' : 'New property',
    `<div class="card narrow">
      <h1>${isEdit ? 'Edit property' : 'New property'}</h1>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      <form method="POST" action="${isEdit ? `/admin/properties/${property.id}/edit-info` : '/admin/properties'}">
        <label>Property address</label>
        <input type="text" name="address" placeholder="123 Example Street, Hastings" value="${isEdit ? escapeHtml(property.address) : ''}" required>

        <label>Link slug ${isEdit ? '<span class="muted">(cannot be changed)</span>' : ''}</label>
        ${
          isEdit
            ? `<input type="text" value="${escapeHtml(property.slug)}" disabled>`
            : `<input type="text" name="slug" placeholder="e.g. 123-example-street" required>`
        }
        <p class="hint">This becomes the URL you program onto the property's NFC plaque: <strong>${domainDisplay}/p/${
          isEdit ? escapeHtml(property.slug) : '[slug]'
        }</strong></p>

        <label>Build year <span class="muted">(optional)</span></label>
        <input type="text" name="build_year" placeholder="2026" value="${isEdit ? escapeHtml(property.build_year || '') : ''}">

        <div class="form-actions">
          <button type="submit">${isEdit ? 'Save changes' : 'Create property'}</button>
          <a href="${isEdit ? `/admin/properties/${property.id}` : '/admin'}" class="cancel">Cancel</a>
        </div>
      </form>
    </div>`
  );
}

app.get('/admin/properties/:id/edit-info', requireAuth, (req, res) => {
  const data = loadData();
  const property = data.properties.find((p) => p.id === req.params.id);
  if (!property) return res.redirect('/admin');
  res.send(renderPropertyForm(property, null, `${req.protocol}://${req.get('host')}`));
});

app.post('/admin/properties/:id/edit-info', requireAuth, (req, res) => {
  const data = loadData();
  const property = data.properties.find((p) => p.id === req.params.id);
  if (!property) return res.redirect('/admin');

  const { address, build_year } = req.body;
  if (!address || !address.trim()) {
    return res.send(renderPropertyForm(property, 'Address is required.', `${req.protocol}://${req.get('host')}`));
  }
  property.address = address.trim();
  property.build_year = (build_year || '').trim();
  saveData(data);
  res.redirect(`/admin/properties/${property.id}`);
});

app.get('/admin/properties/:id/delete-confirm', requireAuth, (req, res) => {
  const data = loadData();
  const property = data.properties.find((p) => p.id === req.params.id);
  if (!property) return res.redirect('/admin');
  res.send(
    layout(
      'Delete property',
      `<div class="card narrow center">
        <h1>Delete this property?</h1>
        <p class="muted">This permanently deletes <strong>${escapeHtml(property.address)}</strong> and everything uploaded to it — ${
        property.items.length
      } record(s). This can't be undone.</p>
        <form method="POST" action="/admin/properties/${property.id}/delete">
          <div class="form-actions">
            <button type="submit" style="background:#b0392f;">Yes, delete permanently</button>
            <a href="/admin/properties/${property.id}" class="cancel">Cancel</a>
          </div>
        </form>
      </div>`
    )
  );
});

app.post('/admin/properties/:id/delete', requireAuth, (req, res) => {
  const data = loadData();
  const property = data.properties.find((p) => p.id === req.params.id);
  if (property) {
    const dir = path.join(UPLOADS_DIR, property.id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    data.properties = data.properties.filter((p) => p.id !== property.id);
    saveData(data);
  }
  res.redirect('/admin');
});

app.get('/admin/properties/:id/export', requireAuth, (req, res) => {
  const data = loadData();
  const property = data.properties.find((p) => p.id === req.params.id);
  if (!property) return res.redirect('/admin');

  const zipName = `${property.slug}-passport-export.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('Export error:', err);
    if (!res.headersSent) res.status(500).send('Export failed.');
  });
  archive.pipe(res);

  // Build a readable summary as the first thing in the zip
  let summary = `LOCAL LINK HOME PASSPORT — EXPORT\n`;
  summary += `Property: ${property.address}\n`;
  summary += `Build year: ${property.build_year || 'not set'}\n`;
  summary += `Exported: ${new Date().toISOString()}\n`;
  summary += `Total records: ${property.items.length}\n`;
  summary += `${'='.repeat(60)}\n\n`;

  CATEGORIES.forEach((cat) => {
    const items = property.items.filter((i) => i.category === cat.key);
    if (items.length === 0) return;
    summary += `${cat.label.toUpperCase()} (${items.length})\n`;
    items.forEach((item) => {
      if (item.type === 'file') {
        summary += `  - FILE: ${item.original_name}${item.caption ? ` — "${item.caption}"` : ''} (see /${sanitizeFolder(cat.label)}/ folder)\n`;
      } else {
        summary += `  - NOTE: ${item.caption || '(untitled)'} — ${item.note || ''}\n`;
      }
    });
    summary += `\n`;
  });

  archive.append(summary, { name: 'SUMMARY.txt' });

  // Add each uploaded file into a folder named after its category
  property.items.forEach((item) => {
    if (item.type === 'file') {
      const filePath = path.join(UPLOADS_DIR, property.id, item.filename);
      if (fs.existsSync(filePath)) {
        const cat = CATEGORIES.find((c) => c.key === item.category);
        const folder = sanitizeFolder(cat ? cat.label : item.category);
        archive.file(filePath, { name: `${folder}/${item.original_name}` });
      }
    }
  });

  archive.finalize();
});

function sanitizeFolder(label) {
  return label.replace(/[^a-zA-Z0-9 &-]/g, '').trim();
}

app.get('/admin/properties/:id', requireAuth, (req, res) => {
  const data = loadData();
  const property = data.properties.find((p) => p.id === req.params.id);
  if (!property) return res.redirect('/admin');
  const uploadToken = ensureUploadToken(property, data);
  const liveOrigin = `${req.protocol}://${req.get('host')}`;

  const categoryBlocks = CATEGORIES.map((cat) => {
    const items = property.items.filter((i) => i.category === cat.key);
    const itemsHtml = items
      .map((item) => {
        const preview =
          item.type === 'file'
            ? isImage(item.filename)
              ? `<img src="/files/${property.id}/${item.filename}" class="thumb">`
              : isAudio(item.filename)
              ? `🎙️ ${escapeHtml(item.caption || 'Voice note')}`
              : `📄 ${escapeHtml(item.original_name)}`
            : `📝 ${escapeHtml(item.note || '')}`;
        return `<div class="manage-item" data-item-id="${item.id}">
          <div class="manage-item-view">
            ${preview}
            <span class="muted item-caption-display">${escapeHtml(item.caption || '')}</span>
            ${item.type === 'note' ? `<span class="muted item-note-display" style="display:none;">${escapeHtml(item.note || '')}</span>` : ''}
            <button type="button" class="link-btn edit-caption-btn">Edit</button>
            <form method="POST" action="/admin/properties/${property.id}/items/${item.id}/delete" onsubmit="return confirm('Delete this record?');">
              <button type="submit" class="link-btn">Delete</button>
            </form>
          </div>
          <form class="manage-item-edit-form" style="display:none;" data-action="/admin/properties/${property.id}/items/${item.id}/edit-caption">
            <input type="text" class="edit-caption-input" placeholder="Caption" value="${escapeHtml(item.caption || '')}">
            ${item.type === 'note' ? `<textarea class="edit-note-input" placeholder="Note text" rows="2">${escapeHtml(item.note || '')}</textarea>` : ''}
            <div class="edit-form-actions">
              <button type="button" class="save-caption-btn">Save</button>
              <button type="button" class="cancel-caption-btn">Cancel</button>
            </div>
          </form>
        </div>`;
      })
      .join('');

    return `<div class="category-block">
      <h3>${cat.label} <span class="muted">(${items.length})</span></h3>
      <div class="manage-items">${itemsHtml || '<p class="muted small">Nothing added yet</p>'}</div>

      <div class="add-forms">
        <form method="POST" action="/admin/properties/${property.id}/upload" enctype="multipart/form-data" class="inline-form upload-form">
          <input type="hidden" name="category" value="${cat.key}">
          <input type="file" name="files" multiple required accept="image/*,application/pdf">
          <input type="text" name="caption" placeholder="Caption (optional, applied to all)">
          <button type="submit">Upload file(s)</button>
          <span class="upload-status"></span>
        </form>
        <form method="POST" action="/admin/properties/${property.id}/note" class="inline-form">
          <input type="hidden" name="category" value="${cat.key}">
          <input type="text" name="caption" placeholder="Title">
          <input type="text" name="note" placeholder="Note text">
          <button type="submit">Add text note</button>
        </form>
        <div class="voice-recorder" data-category="${cat.key}" data-upload-url="/admin/properties/${property.id}/upload">
          <button type="button" class="voice-record-btn">🎙️ Record a voice note</button>
          <div class="voice-recorder-active" style="display:none;">
            <span class="voice-timer">0:00</span>
            <button type="button" class="voice-stop-btn">⏹ Stop</button>
          </div>
          <div class="voice-preview" style="display:none;">
            <audio controls class="voice-audio-preview"></audio>
            <input type="text" class="voice-caption" placeholder="What's this about? (optional)">
            <button type="button" class="voice-upload-btn">Add voice note</button>
            <button type="button" class="voice-discard-btn">Discard</button>
          </div>
          <span class="voice-status"></span>
        </div>
      </div>
    </div>`;
  }).join('');

  res.send(
    layout(
      property.address,
      `<div class="header-row">
        <h1>${escapeHtml(property.address)}</h1>
        <div>
          <a href="/admin/properties/${property.id}/export" class="cancel">Download all records (.zip)</a>
          &nbsp;·&nbsp;
          <a href="/admin/properties/${property.id}/edit-info" class="cancel">Edit details</a>
          &nbsp;·&nbsp;
          <a href="/admin" class="cancel">← All properties</a>
        </div>
      </div>
      <div class="card">
        <p class="muted">Public link: <strong>${liveOrigin}/p/${escapeHtml(property.slug)}</strong> — <a href="/p/${escapeHtml(
        property.slug
      )}" target="_blank">view public page</a></p>
      </div>
      <div class="card builder-link-card">
        <p class="muted"><strong>Builder upload link</strong> — send this to your builder. No password needed, and it only lets them add records to this one property.</p>
        <div class="link-copy-row">
          <input type="text" readonly value="${liveOrigin}/u/${uploadToken}" onclick="this.select()">
          <a href="/u/${uploadToken}" target="_blank" class="btn">Open</a>
        </div>
      </div>
      ${categoryBlocks}
      <script>
        // Compress photos in the browser before upload, so a full phone photo
        // (often 8-15MB) becomes a much smaller file before it ever leaves the device.
        // PDFs and non-image files are sent through unchanged.
        const MAX_DIMENSION = 1800; // longest side, in pixels
        const JPEG_QUALITY = 0.78;

        function compressImage(file) {
          return new Promise((resolve) => {
            if (!file.type.startsWith('image/') || file.type === 'image/gif') {
              return resolve(file); // don't touch non-images or gifs
            }
            const img = new Image();
            const reader = new FileReader();
            reader.onload = (e) => {
              img.onload = () => {
                let { width, height } = img;
                if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                  if (width > height) {
                    height = Math.round((height * MAX_DIMENSION) / width);
                    width = MAX_DIMENSION;
                  } else {
                    width = Math.round((width * MAX_DIMENSION) / height);
                    height = MAX_DIMENSION;
                  }
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                canvas.toBlob(
                  (blob) => {
                    if (!blob || blob.size >= file.size) {
                      return resolve(file); // compression didn't help, use original
                    }
                    resolve(new File([blob], file.name.replace(/\\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' }));
                  },
                  'image/jpeg',
                  JPEG_QUALITY
                );
              };
              img.onerror = () => resolve(file);
              img.src = e.target.result;
            };
            reader.onerror = () => resolve(file);
            reader.readAsDataURL(file);
          });
        }

        document.querySelectorAll('.upload-form').forEach((form) => {
          form.addEventListener('submit', async (e) => {
            const fileInput = form.querySelector('input[type="file"]');
            if (!fileInput.files || fileInput.files.length === 0) return; // let normal validation handle it

            e.preventDefault();
            const statusEl = form.querySelector('.upload-status');
            const button = form.querySelector('button[type="submit"]');
            button.disabled = true;

            const originalFiles = Array.from(fileInput.files);
            const compressed = [];
            for (let i = 0; i < originalFiles.length; i++) {
              statusEl.textContent = \`Preparing \${i + 1} of \${originalFiles.length}…\`;
              compressed.push(await compressImage(originalFiles[i]));
            }

            statusEl.textContent = 'Uploading…';
            const formData = new FormData();
            formData.append('category', form.querySelector('input[name="category"]').value);
            formData.append('caption', form.querySelector('input[name="caption"]').value);
            compressed.forEach((f) => formData.append('files', f));

            try {
              const res = await fetch(form.action, { method: 'POST', body: formData });
              if (res.redirected || res.ok) {
                window.location.reload();
              } else {
                statusEl.textContent = 'Upload failed — try again.';
                button.disabled = false;
              }
            } catch (err) {
              statusEl.textContent = 'Upload failed — check your connection.';
              button.disabled = false;
            }
          });
        });

        // Inline caption/note editing
        document.querySelectorAll('.manage-item').forEach((itemBox) => {
          const viewBox = itemBox.querySelector('.manage-item-view');
          const editForm = itemBox.querySelector('.manage-item-edit-form');
          const editBtn = itemBox.querySelector('.edit-caption-btn');
          const saveBtn = itemBox.querySelector('.save-caption-btn');
          const cancelBtn = itemBox.querySelector('.cancel-caption-btn');
          const captionInput = itemBox.querySelector('.edit-caption-input');
          const noteInput = itemBox.querySelector('.edit-note-input');
          const captionDisplay = itemBox.querySelector('.item-caption-display');
          const noteDisplay = itemBox.querySelector('.item-note-display');

          editBtn.addEventListener('click', () => {
            viewBox.style.display = 'none';
            editForm.style.display = 'flex';
            captionInput.focus();
          });

          cancelBtn.addEventListener('click', () => {
            captionInput.value = captionDisplay.textContent;
            if (noteInput && noteDisplay) noteInput.value = noteDisplay.textContent;
            editForm.style.display = 'none';
            viewBox.style.display = 'flex';
          });

          saveBtn.addEventListener('click', async () => {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving…';
            const formData = new URLSearchParams();
            formData.append('caption', captionInput.value);
            if (noteInput) formData.append('note', noteInput.value);

            try {
              const res = await fetch(editForm.dataset.action, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData.toString(),
              });
              if (res.ok) {
                const result = await res.json();
                captionDisplay.textContent = result.caption || '';
                if (noteDisplay && result.note !== null) noteDisplay.textContent = result.note;
                editForm.style.display = 'none';
                viewBox.style.display = 'flex';
              } else {
                alert('Could not save — please try again.');
              }
            } catch (err) {
              alert('Could not save — check your connection.');
            }
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
          });
        });

        // Voice note recording
        document.querySelectorAll('.voice-recorder').forEach((box) => {
          let mediaRecorder = null;
          let chunks = [];
          let recordedBlob = null;
          let timerInterval = null;
          let seconds = 0;

          const recordBtn = box.querySelector('.voice-record-btn');
          const activeBox = box.querySelector('.voice-recorder-active');
          const stopBtn = box.querySelector('.voice-stop-btn');
          const timerEl = box.querySelector('.voice-timer');
          const previewBox = box.querySelector('.voice-preview');
          const audioPreview = box.querySelector('.voice-audio-preview');
          const captionInput = box.querySelector('.voice-caption');
          const uploadBtn = box.querySelector('.voice-upload-btn');
          const discardBtn = box.querySelector('.voice-discard-btn');
          const voiceStatusEl = box.querySelector('.voice-status');

          function formatTime(s) {
            const m = Math.floor(s / 60);
            const r = s % 60;
            return \`\${m}:\${r < 10 ? '0' : ''}\${r}\`;
          }

          recordBtn.addEventListener('click', async () => {
            if (!navigator.mediaDevices || !window.MediaRecorder) {
              voiceStatusEl.textContent = 'Voice recording is not supported on this browser.';
              return;
            }
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
              chunks = [];
              const candidates = ['audio/mp4', 'audio/webm', 'audio/ogg', 'audio/aac'];
              const supportedType = candidates.find((t) => window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(t));
              mediaRecorder = supportedType ? new MediaRecorder(stream, { mimeType: supportedType }) : new MediaRecorder(stream);
              mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
              mediaRecorder.onstop = () => {
                const actualType = mediaRecorder.mimeType || 'audio/webm';
                recordedBlob = new Blob(chunks, { type: actualType });
                box.dataset.audioType = actualType;
                audioPreview.src = URL.createObjectURL(recordedBlob);
                previewBox.style.display = 'flex';
                activeBox.style.display = 'none';
                recordBtn.style.display = 'none';
                stream.getTracks().forEach((t) => t.stop());
              };
              mediaRecorder.start();
              seconds = 0;
              timerEl.textContent = '0:00';
              timerInterval = setInterval(() => {
                seconds += 1;
                timerEl.textContent = formatTime(seconds);
              }, 1000);
              recordBtn.style.display = 'none';
              activeBox.style.display = 'flex';
              voiceStatusEl.textContent = '';
            } catch (err) {
              voiceStatusEl.textContent = 'Microphone access denied or unavailable.';
            }
          });

          stopBtn.addEventListener('click', () => {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
            clearInterval(timerInterval);
          });

          discardBtn.addEventListener('click', () => {
            recordedBlob = null;
            previewBox.style.display = 'none';
            recordBtn.style.display = 'inline-block';
            captionInput.value = '';
            voiceStatusEl.textContent = '';
          });

          uploadBtn.addEventListener('click', async () => {
            if (!recordedBlob) return;
            uploadBtn.disabled = true;
            voiceStatusEl.textContent = 'Uploading…';
            const formData = new FormData();
            formData.append('category', box.dataset.category);
            formData.append('caption', captionInput.value || 'Voice note');
            const audioType = box.dataset.audioType || 'audio/webm';
            const ext = audioType.includes('mp4') ? 'm4a' : audioType.includes('ogg') ? 'ogg' : audioType.includes('aac') ? 'aac' : 'webm';
            formData.append('files', new File([recordedBlob], \`voice-note-\${Date.now()}.\${ext}\`, { type: audioType }));

            try {
              const res = await fetch(box.dataset.uploadUrl, { method: 'POST', body: formData });
              if (res.redirected || res.ok) {
                voiceStatusEl.textContent = 'Added ✓';
                window.location.reload();
              } else {
                voiceStatusEl.textContent = 'Failed — try again.';
                uploadBtn.disabled = false;
              }
            } catch (err) {
              voiceStatusEl.textContent = 'Failed — check your connection.';
              uploadBtn.disabled = false;
            }
          });
        });
      </script>`
    )
  );
});

app.post('/admin/properties/:id/upload', requireAuth, upload.array('files', 20), (req, res) => {
  const data = loadData();
  const property = data.properties.find((p) => p.id === req.params.id);
  if (!property || !req.files || req.files.length === 0) return res.redirect('/admin');

  const sharedCaption = (req.body.caption || '').trim();

  req.files.forEach((file) => {
    property.items.push({
      id: String(data.nextItemId),
      type: 'file',
      category: req.body.category,
      filename: file.filename,
      original_name: file.originalname,
      caption: sharedCaption,
      uploaded_at: new Date().toISOString(),
    });
    data.nextItemId += 1;
  });

  saveData(data);
  res.redirect(`/admin/properties/${property.id}`);
});

app.post('/admin/properties/:id/note', requireAuth, (req, res) => {
  const data = loadData();
  const property = data.properties.find((p) => p.id === req.params.id);
  if (!property) return res.redirect('/admin');

  if ((req.body.note || '').trim()) {
    property.items.push({
      id: String(data.nextItemId),
      type: 'note',
      category: req.body.category,
      caption: (req.body.caption || '').trim(),
      note: (req.body.note || '').trim(),
      uploaded_at: new Date().toISOString(),
    });
    data.nextItemId += 1;
    saveData(data);
  }
  res.redirect(`/admin/properties/${property.id}`);
});

app.post('/admin/properties/:id/items/:itemId/delete', requireAuth, (req, res) => {
  const data = loadData();
  const property = data.properties.find((p) => p.id === req.params.id);
  if (property) {
    const item = property.items.find((i) => i.id === req.params.itemId);
    if (item && item.type === 'file') {
      const filePath = path.join(UPLOADS_DIR, property.id, item.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    property.items = property.items.filter((i) => i.id !== req.params.itemId);
    saveData(data);
  }
  res.redirect(`/admin/properties/${property.id}`);
});

app.post('/admin/properties/:id/items/:itemId/edit-caption', requireAuth, (req, res) => {
  const data = loadData();
  const property = data.properties.find((p) => p.id === req.params.id);
  if (!property) return res.status(404).json({ error: 'Property not found' });
  const item = property.items.find((i) => i.id === req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Record not found' });

  item.caption = (req.body.caption || '').trim();
  if (item.type === 'note' && typeof req.body.note === 'string') {
    item.note = req.body.note.trim();
  }
  saveData(data);
  res.json({ ok: true, caption: item.caption, note: item.note || null });
});

app.get('/', (req, res) => {
  res.redirect(req.session && req.session.loggedIn ? '/admin' : '/admin/login');
});

// Catches upload errors (file too big, too many files, etc.) so they show
// a friendly message and a way back, instead of a raw crash/stack trace.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    let message = 'Upload failed.';
    if (err.code === 'LIMIT_FILE_SIZE') message = 'One of those files is too large — the limit is 15MB per file.';
    if (err.code === 'LIMIT_FILE_COUNT') message = 'Too many files at once — the limit is 20 files per upload.';
    return res.status(400).send(
      layout(
        'Upload error',
        `<div class="card narrow center">
          <h1>Upload didn't go through</h1>
          <p class="error">${escapeHtml(message)}</p>
          <p class="hint">Go back and try again with fewer or smaller files.</p>
        </div>`,
        true
      )
    );
  }
  console.error(err);
  res.status(500).send(
    layout(
      'Something went wrong',
      `<div class="card narrow center">
        <h1>Something went wrong</h1>
        <p class="hint">Please go back and try again.</p>
      </div>`,
      true
    )
  );
});

app.listen(PORT, () => {
  console.log(`Local Link Home Passport running on port ${PORT}`);
});
