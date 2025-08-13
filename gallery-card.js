window.customCards = window.customCards || [];
window.customCards.push({
  type: "gallery-card",
  name: "Gallery Card",
  description: "Date-filtered gallery from a media source with thumbnails and preview.",
  preview: false,
});

class GalleryCard extends HTMLElement {
  static async getConfigElement() {
    return document.createElement('gallery-card-editor');
  }
  static getStubConfig() {
    return {
      media_dir: '',
      folder_pattern: 'MM-DD-YY',
      file_pattern: '^(.+)$',              // caption regex (FULL filename incl. extension)
      file_time_regex: '(\\d{2}:\\d{2}:\\d{2})', // sort key regex (FULL filename)
      file_title_regex: '^(.+)$',          // fallback caption regex (basename only)
      thumb_height: 72,
      thumb_gap: 1,
      preview_max_height: 480,
      captions: true,
      badges: true,
      show_images: true,
      show_videos: true,
      horizontal_layout: false,   // thumbs left, preview right when true
      sidebar_width: 146,         // px, width of the left thumb column (horizontal layout)
      layout_gap: 8,              // px, gap between thumbs column and preview
    };
  }

  setConfig(config) {
    if (!config.media_dir) throw new Error("Set media_dir (e.g. 'snapshots' or 'media_source/snapshots').");
    this.config = config;
    this.contentRoot = this._toContentId(config.media_dir);
    this._applyVars();

    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }
        .card {
          background: var(--ha-card-background, var(--card-background-color, white));
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow, none);
          padding: var(--ha-card-padding, 16px);
          color: var(--primary-text-color);
        }

        .toolbar { display:flex; align-items:center; justify-content:space-between; margin-bottom:4px; }
        .date-picker { margin:0; }
        .refresh-btn { border:none; background:transparent; cursor:pointer; font-size:18px; line-height:1; padding:0 4px; opacity:.8; }
        .refresh-btn:hover { opacity:1; }

        /* Thumbs (tight, theme-friendly) */
        .thumb-row { display:flex; overflow-x:auto; gap:var(--gc-thumb-gap, 1px); padding:2px 0; }
        .thumb { position:relative; margin:0; padding:0; line-height:0; }
        .thumb img, .thumb video {
          height: var(--gc-thumb-h, 46px);
          width: auto; display:block;
          cursor:pointer; border:1px solid transparent; border-radius:3px;
          object-fit: contain; /* preserve aspect */
          background: var(--card-background-color);
        }
        .thumb.selected img, .thumb.selected video { border-color: var(--primary-color); }

        /* Type badge (thumb) */
        .badge {
          position:absolute; top:2px; right:2px;
          background:rgba(0,0,0,.65); color:#fff; font-size:10px; padding:2px 5px; border-radius:10px; line-height:1;
          pointer-events:none;
        }

        /* Caption overlay (thumb) */
        .thumb-cap {
          position:absolute; left:2px; bottom:2px; right:auto;
          max-width:80px;
          background:rgba(0,0,0,.55); color:#fff;
          font-size:9px; line-height:1.1;
          padding:1px 3px; border-radius:3px;
          overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
          pointer-events:none;
        }

        /* Preview */
        .preview-container { position:relative; display:flex; align-items:center; justify-content:center; }
        .preview-slot { position:relative; width:100%; display:flex; align-items:center; justify-content:center; }
        .preview-media {
          max-width: 100%;
          max-height: var(--gc-preview-max-h, 420px);
          width: auto; height: auto;
          object-fit: contain; display:block;
          border-radius: var(--ha-card-border-radius, 12px);
          background: var(--card-background-color);
        }
        .preview-media.image, .preview-media.video { cursor:zoom-in; }

        /* Badge + caption (preview) */
        .preview-badge {
          position:absolute; right:8px; bottom:8px;
          background:rgba(0,0,0,.65); color:#fff; font-size:12px; padding:3px 7px; border-radius:12px; line-height:1;
          z-index:2; pointer-events:none;
        }
        .preview-cap {
          position:absolute; left:8px; bottom:8px; right:60px;
          background:rgba(0,0,0,.55); color:#fff;
          font-size:12px; line-height:1.2;
          padding:3px 6px; border-radius:6px;
          overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
          z-index:2; pointer-events:none;
        }

        /* Prev/Next */
        .nav-btn {
          position:absolute; top:8px; padding:6px 10px; background:rgba(0,0,0,.55);
          color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:14px; line-height:1; user-select:none; z-index:3;
        }
        .nav-prev { left:8px; }
        .nav-next { right:8px; }

        /* Modal */
        .modal { display:none; position:fixed; z-index:9999; inset:0; background:rgba(0,0,0,.9); }
        .modal.open { display:block; }
        .modal-content { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); max-width:95vw; max-height:90vh; }
        .modal-media { position: relative; z-index: 1; }
        .modal-content img, .modal-content video { width:100%; height:auto; max-height:85vh; object-fit:contain; }
        .modal-caption { color:#ccc; text-align:center; margin-top:8px; font-size:14px; }
        .modal-close { position:absolute; z-index: 2; top:10px; right:14px; font-size:28px; color:#fff; cursor:pointer; user-select:none; pointer-events:auto; }

        /* Toggles */
        :host([data-caps-off]) .thumb-cap,
        :host([data-caps-off]) .preview-cap { display:none; }
        :host([data-badges-off]) .badge,
        :host([data-badges-off]) .preview-badge { display:none; }

        /* Content wrapper controls vertical vs horizontal layout */
        .content { display: block; }
        
        /* Horizontal: thumbs as a vertical sidebar, preview on the right */
        :host([data-horizontal]) .content {
          display: flex;
          gap: var(--gc-layout-gap, 8px);
          align-items: stretch;
        }
        
        /* Default thumbs row (vertical layout): horizontal strip */
        .thumb-row {
          display: flex;
          overflow-x: auto;
          gap: var(--gc-thumb-gap, 1px);
          padding: 2px 0;
        }
        
        /* Horizontal mode: make thumbs a vertical list/column */
        :host([data-horizontal]) .thumb-row {
          flex-direction: column;
          width: var(--gc-sidebar-w, 120px);
          flex: 0 0 var(--gc-sidebar-w, 120px);
          overflow-y: auto;
          overflow-x: hidden;
          max-height: var(--gc-preview-max-h, 420px); /* keep list height aligned with preview */
          padding: 0;                                   /* tighter */
        }
        
        /* Give the preview the remaining space in horizontal mode */
        :host([data-horizontal]) .preview-container {
          flex: 1 1 auto;
          min-width: 0; /* allow flexbox to shrink properly */
        }
      </style>

      <ha-card class="card">
        <div class="toolbar">
          <input type="date" class="date-picker" />
          <button class="refresh-btn" title="Refresh" aria-label="Refresh">↻</button>
        </div>

        <div class="content">
          <div class="thumb-row"></div>
        
          <div class="preview-container">
            <button class="nav-btn nav-prev" title="Previous">&laquo; Prev</button>
            <div class="preview-slot"></div>
            <button class="nav-btn nav-next" title="Next">Next &raquo;</button>
          </div>
        </div>

        <div class="modal" aria-hidden="true">
          <div class="modal-content">
            <span class="modal-close" aria-label="Close">&times;</span>
            <div class="modal-media"></div>
            <div class="modal-caption"></div>
          </div>
        </div>
      </ha-card>
    `;

    // refs
    this.datePicker = this.shadowRoot.querySelector('.date-picker');
    this.refreshBtn = this.shadowRoot.querySelector('.refresh-btn');
    this.thumbRow = this.shadowRoot.querySelector('.thumb-row');
    this.previewSlot = this.shadowRoot.querySelector('.preview-slot');
    this.prevBtn = this.shadowRoot.querySelector('.nav-prev');
    this.nextBtn = this.shadowRoot.querySelector('.nav-next');

    this.modal = this.shadowRoot.querySelector('.modal');
    this.modalMedia = this.shadowRoot.querySelector('.modal-media');
    this.modalCaption = this.shadowRoot.querySelector('.modal-caption');
    this.modalClose = this.shadowRoot.querySelector('.modal-close');

    // events
    this.prevBtn.addEventListener('click', () => this.changeItem(-1));
    this.nextBtn.addEventListener('click', () => this.changeItem(1));
    this.refreshBtn.addEventListener('click', () => this.loadForSelectedDate());
    this.datePicker.addEventListener('change', () => this.loadForSelectedDate());

    // Thumb click via delegation
    this.thumbRow.addEventListener('click', (e) => {
      const fig = e.target.closest('.thumb');
      if (!fig) return;
      const idx = Number(fig.dataset.index);
      if (!Number.isInteger(idx)) return;
      this.showItem(idx);
    });

    this.thumbRow.addEventListener('keydown', (e) => {
      const fig = e.target.closest('.thumb');
      if (!fig) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const idx = Number(fig.dataset.index);
        if (Number.isInteger(idx)) {
          this.showItem(idx);
        }
      }
    });
    
    // Modal close
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.closeModal(); // backdrop
    });
    this.modalClose.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeModal();
    });

    // Keyboard in modal
    this.shadowRoot.addEventListener('keydown', (e) => {
      if (!this.modal.classList.contains('open')) return;
      if (e.key === 'Escape') this.closeModal();
      if (e.key === 'ArrowLeft') this.changeItem(-1);
      if (e.key === 'ArrowRight') this.changeItem(1);
    });
  }

  _toContentId(input) {
    let id = input.trim().replace(/\/+$/, '');
    if (id.startsWith('media-source://')) return id;
    if (id.startsWith('media_source/')) return `media-source://${id}`;
    return `media-source://media_source/${id}`;
  }

  _applyVars() {
    const c = this.config || {};
    const px = (v, def) => (Number.isFinite(v) ? `${v}px` : `${def}px`);
    this.style.setProperty('--gc-thumb-h', px(c.thumb_height, 46));
    this.style.setProperty('--gc-thumb-gap', px(c.thumb_gap, 1));
    this.style.setProperty('--gc-preview-max-h', px(c.preview_max_height, 420));
    this.toggleAttribute('data-caps-off', c.captions === false);
    this.toggleAttribute('data-badges-off', c.badges === false);
    this.style.setProperty('--gc-sidebar-w', `${Number(this.config.sidebar_width ?? 120)}px`);
    this.style.setProperty('--gc-layout-gap', `${Number(this.config.layout_gap ?? 8)}px`);
    this.toggleAttribute('data-horizontal', !!this.config.horizontal_layout);
  }

  set hass(hass) {
    if (!this.loaded) {
      this.loaded = true;
      this.hassInstance = hass;
      this.datePicker.value = this._formatDateInput(new Date());
      this.loadForSelectedDate();
    }
  }

  _formatDateInput(dt) {
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth()+1).padStart(2,'0');
    const dd = String(dt.getDate()).padStart(2,'0');
    return `${yyyy}-${mm}-${dd}`;
  }

  _folderFromDateInput() {
    const v = this.datePicker.value;
    if (!v) return null;
    const [yyyy, mm, dd] = v.split('-').map(Number);
    const yy = String(yyyy % 100).padStart(2,'0');
    const pattern = (this.config.folder_pattern || 'MM-DD-YY');
    return pattern
      .replace(/YYYY/g, String(yyyy))
      .replace(/YY/g, yy)
      .replace(/MM/g, String(mm).padStart(2,'0'))
      .replace(/DD/g, String(dd).padStart(2,'0'));
  }

  _compileRe(str) {
    try { return new RegExp(str); }
    catch { return /^(.+)$/; }
  }

  async loadForSelectedDate() {
    const folder = this._folderFromDateInput();
    if (!folder) return;
    await this._loadFolder(folder);
  }

  async _loadFolder(folderName) {
    let resp;
    try {
      resp = await this.hassInstance.callWS({
        type: "media_source/browse_media",
        media_content_id: `${this.contentRoot}/${folderName}`
      });
    } catch {
      this._renderThumbs([]);
      this._renderPreview(null);
      this.items = [];
      this.currentIndex = -1;
      return;
    }

    const children = resp?.children ?? [];
    const mediaItems = children.filter(item => {
      const t = item.media_content_type || '';
      return t.startsWith('image/') || t.startsWith('video/');
    });

    const fileCaptionRe   = this._compileRe(this.config.file_pattern || '^(.+)$');
    const timeRe          = this._compileRe(this.config.file_time_regex || '(\\d{2}:\\d{2}:\\d{2})');
    const titleFallbackRe = this._compileRe(this.config.file_title_regex || '^(.+)$');

    const resolved = await Promise.all(
      mediaItems.map(async (item) => {
        const resolvedItem = await this.hassInstance.callWS({
          type: "media_source/resolve_media",
          media_content_id: item.media_content_id
        });

        const isVideo = (item.media_content_type || '').startsWith('video/');
        const fullName = (item.title && String(item.title)) ||
                         (item.media_content_id.split('/').pop() || '');
        const baseName = fullName.replace(/\.[^.]+$/, '');

        // Caption from FULL filename via file_pattern (group 1)
        let caption = fullName;
        const capMatch = fullName.match(fileCaptionRe);
        if (capMatch && capMatch[1]) caption = capMatch[1];
        else {
          // fallback: old behavior on basename
          const m = baseName.match(titleFallbackRe);
          if (m && m[1]) caption = m[1];
        }

        // Sort key from FULL filename via time regex (group 1)
        const sortMatch = fullName.match(timeRe);
        const sortKey = (sortMatch && sortMatch[1]) ? sortMatch[1] : '';

        return {
          url: resolvedItem.url,
          title: caption,
          isVideo,
          _original: fullName,
          _sortKey: sortKey
        };
      })
    );

    // Toggle filters (default both true)
    const showImages = this.config.show_images !== false;
    const showVideos = this.config.show_videos !== false;
    
    // Apply toggles
    const filtered = resolved.filter(it => it.isVideo ? showVideos : showImages);
    
    // Newest first by extracted key (e.g., HH:mm:ss)
    filtered.sort((a, b) => b._sortKey.localeCompare(a._sortKey));
    
    this.items = filtered;
    this.currentIndex = this.items.length ? 0 : -1;
    this._renderThumbs(this.items);
    this._renderPreview(this.items[this.currentIndex] || null);
    this._highlightThumb(this.currentIndex);
    this._scrollThumbIntoView(this.currentIndex);
  }

  _renderThumbs(items) {
    this.thumbRow.innerHTML = '';
    items.forEach((item, index) => {
      const fig = document.createElement('div');
      fig.className = 'thumb';
      fig.dataset.index = String(index);
      fig.title = item._original || item.title;

      // a11y
      fig.tabIndex = 0;
      fig.setAttribute('role', 'button');
      fig.setAttribute('aria-label', `${item.isVideo ? 'Video' : 'Image'}: ${item.title}`);
      
      if (item.isVideo) {
        const v = document.createElement('video');
        v.src = item.url + '#t=0.1';
        v.muted = true; v.playsInline = true; v.preload = 'metadata';
        fig.appendChild(v);
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = '▶';
        fig.appendChild(badge);
      } else {
        const img = document.createElement('img');
        img.src = item.url;
        fig.appendChild(img);
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = '🖼';
        fig.appendChild(badge);
      }

      const cap = document.createElement('span');
      cap.className = 'thumb-cap';
      cap.textContent = item.title;
      fig.appendChild(cap);

      this.thumbRow.appendChild(fig);
    });
  }

  _renderPreview(item) {
    this.previewSlot.innerHTML = '';
    if (!item) return;

    let badgeText = '';
    if (item.isVideo) {
      const v = document.createElement('video');
      v.src = item.url + '#t=0.1'; // still frame
      v.className = 'preview-media video';
      v.muted = true; v.playsInline = true; v.preload = 'metadata';
      v.addEventListener('click', () => this.openModal());
      this.previewSlot.appendChild(v);
      badgeText = '▶';
    } else {
      const img = document.createElement('img');
      img.src = item.url;
      img.className = 'preview-media image';
      img.addEventListener('click', () => this.openModal());
      this.previewSlot.appendChild(img);
      badgeText = '🖼';
    }

    const badge = document.createElement('span');
    badge.className = 'preview-badge';
    badge.textContent = badgeText;
    this.previewSlot.appendChild(badge);

    const pcap = document.createElement('span');
    pcap.className = 'preview-cap';
    pcap.textContent = item.title || '';
    this.previewSlot.appendChild(pcap);
  }

  _highlightThumb(index) {
    this.thumbRow.querySelectorAll('.thumb').forEach((el, i) => {
      el.classList.toggle('selected', i === index);
    });
  }

  _scrollThumbIntoView(index) {
    const el = this.thumbRow?.querySelector(`.thumb[data-index="${index}"]`);
    if (!el) return;
  
    const horizontal = this.hasAttribute('data-horizontal');
  
    // In horizontal layout, the thumb list scrolls VERTICALLY.
    // In vertical (default) layout, it scrolls HORIZONTALLY.
    const opts = horizontal
      ? { behavior: 'smooth', block: 'center', inline: 'nearest' }
      : { behavior: 'smooth', block: 'nearest', inline: 'center' };
  
    requestAnimationFrame(() => el.scrollIntoView(opts));
  }

  showItem(index) {
    if (!this.items || !this.items.length) return;
    const len = this.items.length;
    const clamped = ((index % len) + len) % len;
    this.currentIndex = clamped;
    this._renderPreview(this.items[this.currentIndex]);
    this._highlightThumb(this.currentIndex);
    this._scrollThumbIntoView(this.currentIndex);
  }

  changeItem(step) {
    if (!this.items || !this.items.length) return;
    this.showItem((this.currentIndex ?? 0) + step);
  }

  openModal() {
    if (this.currentIndex == null || this.currentIndex < 0) return;
    const item = this.items[this.currentIndex];
    if (!item) return;

    this.modalMedia.innerHTML = '';
    if (item.isVideo) {
      const v = document.createElement('video');
      v.src = item.url;
      v.controls = true;
      v.autoplay = true;
      v.playsInline = true;
      this.modalMedia.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.src = item.url;
      this.modalMedia.appendChild(img);
    }
    this.modalCaption.textContent = item.title || '';
    this.modal.classList.add('open');
    this.shadowRoot.host.focus?.();
  }

  closeModal() {
    this.modal.classList.remove('open');
    this.modalMedia.innerHTML = '';
  }

  getCardSize() { return 4; }
}

customElements.define('gallery-card', GalleryCard);

/* ===== Visual Editor (no Lit dependency) ===== */
class GalleryCardEditor extends HTMLElement {
  setConfig(config) { this._config = { ...config }; this._render(); }
  set hass(hass) { this._hass = hass; }
  get _default() {
    return {
      media_dir: '',
      folder_pattern: 'MM-DD-YY',
      file_pattern: '^(.+)$',
      file_time_regex: '(\\d{2}:\\d{2}:\\d{2})',
      file_title_regex: '^(.+)$',
      thumb_height: 46,
      thumb_gap: 1,
      preview_max_height: 420,
      captions: true,
      badges: true,
      show_images: true,
      show_videos: true,
      horizontal_layout: false,   // thumbs left, preview right when true
      sidebar_width: 146,         // px, width of the left thumb column (horizontal layout)
      layout_gap: 8,              // px, gap between thumbs column and preview
    };
  }

  _render() {
    const c = { ...this._default, ...(this._config || {}) };
    this.innerHTML = `
      <style>
        .row { display:flex; gap:12px; align-items:center; margin:8px 0; }
        .row > label { width: 260px; color: var(--primary-text-color); }
        input[type="text"], input[type="number"] {
          width: 260px; padding: 6px; border-radius: 6px; border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
        }
        input[type="checkbox"] { transform: scale(1.2); }
        .help { font-size: 12px; color: var(--secondary-text-color); margin-left: 260px; margin-top: -6px; }
      </style>

      <div class="row">
        <label>Media directory</label>
        <input id="media_dir" type="text" placeholder="media_source/snapshots" value="${c.media_dir}">
      </div>

      <div class="row">
        <label>Folder pattern (date → folder)</label>
        <input id="folder_pattern" type="text" placeholder="MM-DD-YY" value="${c.folder_pattern}">
      </div>
      <div class="help">Tokens: YYYY, YY, MM, DD (e.g., YYYY/MM/DD, MM-DD-YY)</div>

      <div class="row">
        <label>Caption regex (FULL filename incl. extension)</label>
        <input id="file_pattern" type="text" placeholder="^(.+)$" value="${c.file_pattern}">
      </div>

      <div class="row">
        <label>Sort key regex (FULL filename)</label>
        <input id="file_time_regex" type="text" placeholder="(\\d{2}:\\d{2}:\\d{2})" value="${c.file_time_regex}">
      </div>

      <div class="row">
        <label>Fallback caption regex (basename)</label>
        <input id="file_title_regex" type="text" placeholder="^(.+)$" value="${c.file_title_regex}">
      </div>
      <div class="help">If caption regex fails, first capture from basename is used.</div>

      <div class="row">
        <label>Thumbnail height (px)</label>
        <input id="thumb_height" type="number" min="24" max="160" step="1" value="${Number(c.thumb_height)}">
      </div>

      <div class="row">
        <label>Thumbnail gap (px)</label>
        <input id="thumb_gap" type="number" min="0" max="16" step="1" value="${Number(c.thumb_gap)}">
      </div>

      <div class="row">
        <label>Preview max height (px)</label>
        <input id="preview_max_height" type="number" min="200" max="1200" step="10" value="${Number(c.preview_max_height)}">
      </div>

      <div class="row">
        <label>Show captions</label>
        <input id="captions" type="checkbox" ${c.captions ? 'checked' : ''}>
      </div>

      <div class="row">
        <label>Show type badges (🖼 / ▶)</label>
        <input id="badges" type="checkbox" ${c.badges ? 'checked' : ''}>
      </div>

      <div class="row">
        <label>Show pictures (images)</label>
        <input id="show_images" type="checkbox" ${c.show_images ? 'checked' : ''}>
      </div>
      
      <div class="row">
        <label>Show videos</label>
        <input id="show_videos" type="checkbox" ${c.show_videos ? 'checked' : ''}>
      </div>

      <div class="row">
        <label>Horizontal layout (thumbs left)</label>
        <input id="horizontal_layout" type="checkbox" ${c.horizontal_layout ? 'checked' : ''}>
      </div>
      
      <div class="row">
        <label>Sidebar width (px)</label>
        <input id="sidebar_width" type="number" min="80" max="400" step="1" value="${Number(c.sidebar_width)}">
      </div>
      
      <div class="row">
        <label>Layout gap (px)</label>
        <input id="layout_gap" type="number" min="0" max="32" step="1" value="${Number(c.layout_gap)}">
      </div>
    `;

    this._bind('#media_dir', v => this._update('media_dir', v));
    this._bind('#folder_pattern', v => this._update('folder_pattern', v));
    this._bind('#file_pattern', v => this._update('file_pattern', v));
    this._bind('#file_time_regex', v => this._update('file_time_regex', v));
    this._bind('#file_title_regex', v => this._update('file_title_regex', v));
    this._bindNumber('#thumb_height', v => this._update('thumb_height', v));
    this._bindNumber('#thumb_gap', v => this._update('thumb_gap', v));
    this._bindNumber('#preview_max_height', v => this._update('preview_max_height', v));
    this._bindBool('#captions', v => this._update('captions', v));
    this._bindBool('#badges', v => this._update('badges', v));
    this._bindBool('#show_images', v => this._update('show_images', v));
    this._bindBool('#show_videos', v => this._update('show_videos', v));
    this._bindBool('#horizontal_layout', v => this._update('horizontal_layout', v));
    this._bindNumber('#sidebar_width', v => this._update('sidebar_width', v));
    this._bindNumber('#layout_gap', v => this._update('layout_gap', v));
  }

  _bind(sel, cb) { this.querySelector(sel)?.addEventListener('input', (e) => cb(e.target.value)); }
  _bindNumber(sel, cb) { this.querySelector(sel)?.addEventListener('change', (e) => cb(Number(e.target.value))); }
  _bindBool(sel, cb) { this.querySelector(sel)?.addEventListener('change', (e) => cb(e.target.checked)); }

  _update(key, value) {
    this._config = { ...(this._config || {}), [key]: value };
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config } }));
  }
}
customElements.define('gallery-card-editor', GalleryCardEditor);
