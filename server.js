const express = require('express');
const cookieSession = require('cookie-session');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
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
  { key: 'hidden_services', label: 'Hidden Services', desc: 'Pipe & cable locations before walls closed' },
  { key: 'compliance', label: 'Compliance Documents', desc: 'CCC, producer statements, certificates' },
  { key: 'build_progress', label: 'Build Progress', desc: 'Photos through each stage' },
  { key: 'finishes_specs', label: 'Finishes & Specs', desc: 'Paint codes, product specifications' },
  { key: 'appliances', label: 'Appliances & Warranties', desc: 'Manuals, models, warranty info' },
  { key: 'contractors', label: 'Contractors', desc: 'Who built it, who to call' },
  { key: 'history', label: 'Renovation & Maintenance History', desc: 'Ongoing updates after handover — renovations, servicing, repairs' },
];

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOADS_DIR, req.params.id);
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

function isImage(filename) {
  return /\.(jpe?g|png|gif|webp)$/i.test(filename);
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
      ${sections || '<p class="muted">No records added yet.</p>'}`,
      true
    )
  );
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
          <a href="/p/${escapeHtml(p.slug)}" target="_blank">View public page</a>
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
  res.send(renderPropertyForm());
});

app.post('/admin/properties', requireAuth, (req, res) => {
  const { slug, address, build_year } = req.body;
  const cleanSlug = (slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');

  if (!cleanSlug || !address) {
    return res.send(renderPropertyForm(null, 'Please fill in the address and link slug.'));
  }

  const data = loadData();
  if (data.properties.some((p) => p.slug === cleanSlug)) {
    return res.send(renderPropertyForm(null, `The link "/p/${cleanSlug}" is already taken. Choose another.`));
  }

  const newProperty = {
    id: String(data.nextId),
    slug: cleanSlug,
    address: address.trim(),
    build_year: (build_year || '').trim(),
    items: [],
    created_at: new Date().toISOString(),
  };
  data.properties.push(newProperty);
  data.nextId += 1;
  saveData(data);
  res.redirect(`/admin/properties/${newProperty.id}`);
});

function renderPropertyForm(property, error) {
  const isEdit = !!property;
  return layout(
    isEdit ? 'Edit property' : 'New property',
    `<div class="card narrow">
      <h1>${isEdit ? 'Edit property' : 'New property'}</h1>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      <form method="POST" action="/admin/properties">
        <label>Property address</label>
        <input type="text" name="address" placeholder="123 Example Street, Hastings" required>

        <label>Link slug</label>
        <input type="text" name="slug" placeholder="e.g. 123-example-street" required>
        <p class="hint">This becomes the URL you program onto the property's NFC plaque: <strong>yourdomain.com/p/[slug]</strong></p>

        <label>Build year <span class="muted">(optional)</span></label>
        <input type="text" name="build_year" placeholder="2026">

        <div class="form-actions">
          <button type="submit">Create property</button>
          <a href="/admin" class="cancel">Cancel</a>
        </div>
      </form>
    </div>`
  );
}

app.get('/admin/properties/:id', requireAuth, (req, res) => {
  const data = loadData();
  const property = data.properties.find((p) => p.id === req.params.id);
  if (!property) return res.redirect('/admin');

  const categoryBlocks = CATEGORIES.map((cat) => {
    const items = property.items.filter((i) => i.category === cat.key);
    const itemsHtml = items
      .map((item) => {
        const preview =
          item.type === 'file'
            ? isImage(item.filename)
              ? `<img src="/files/${property.id}/${item.filename}" class="thumb">`
              : `📄 ${escapeHtml(item.original_name)}`
            : `📝 ${escapeHtml(item.note || '')}`;
        return `<div class="manage-item">
          ${preview}
          <span class="muted">${escapeHtml(item.caption || '')}</span>
          <form method="POST" action="/admin/properties/${property.id}/items/${item.id}/delete" onsubmit="return confirm('Delete this record?');">
            <button type="submit" class="link-btn">Delete</button>
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
      </div>
    </div>`;
  }).join('');

  res.send(
    layout(
      property.address,
      `<div class="header-row">
        <h1>${escapeHtml(property.address)}</h1>
        <a href="/admin" class="cancel">← All properties</a>
      </div>
      <div class="card">
        <p class="muted">Public link: <strong>yourdomain.com/p/${escapeHtml(property.slug)}</strong> — <a href="/p/${escapeHtml(
        property.slug
      )}" target="_blank">view public page</a></p>
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

app.get('/', (req, res) => {
  res.redirect(req.session && req.session.loggedIn ? '/admin' : '/admin/login');
});

app.listen(PORT, () => {
  console.log(`Local Link Home Passport running on port ${PORT}`);
});
