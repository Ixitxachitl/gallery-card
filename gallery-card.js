console.log(`%cgallery-card\n%cVersion: ${'1.3.6'}`, 'color: rebeccapurple; font-weight: bold;', '');

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
      // Safety caps
      max_items: 1000,            // hard cap on items (0 = unlimited)
      page_size: 200,             // render thumbs in chunks
    };
  }

  constructor() {
    super();
    // Lightweight URL cache + tiny LRU + semaphore
    this._urlCache = new Map();  // media_content_id -> { url }
    this._urlLRU = [];
    this._urlCacheMax = 200;
    this._resolveSem = 6;        // concurrent resolves
    this._pendingResolves = 0;
  }

  setConfig(config) {
    if (!config.media_dir) throw new Error("Set media_dir (e.g. 'snapshots' or 'media_source/snapshots').");

    // Merge to avoid blowing away values on repeated setConfig calls
    this.config = { ...(this.config || {}), ...config };
    this.contentRoot = this._toContentId(this.config.media_dir);

    // First-time render
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this._render();
      this._cacheRefs();
      this._bindEvents();
    }

    // Apply visual toggles/vars on every config change
    this._applyVars();

    // Now it's safe to add attributes (HA has already created the element)
    if (!this.hasAttribute('tabindex')) this.setAttribute('tabindex', '-1');

    // If we already loaded once and the folder rules changed, reload current date
    if (this.loaded && this.datePicker?.value) {
      this.loadForSelectedDate();
    }
  }

_render() {
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
      height: var(--gc-thumb-h, 72px);
      width: auto; display:block;
      cursor:pointer; border:1px solid transparent; border-radius:3px;
      object-fit: contain;
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
    .preview-container {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      max-height: var(--gc-preview-max-h, 480px);
      overflow: hidden;
      /* also acts as flex item when horizontal */
      flex: 1 1 auto;
      min-width: 0;
    }
  
    .preview-slot {
      position:relative;
      width:100%;
      height:auto;
      display:flex;
      align-items:center;
      justify-content:center;
    }
  
    .preview-media {
      max-width: 100%;
      max-height: var(--gc-preview-max-h, 480px);
      width: auto; height: auto;
      object-fit: contain; display:block;
      border-radius: var(--ha-card-border-radius, 12px);
      background: var(--card-background-color);
    }
    .preview-media.image, .preview-media.video { cursor:zoom-in; }
  
    /* Empty placeholder */
    .preview-empty {
      width: 100%;
      height: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--secondary-text-color);
      opacity: 0.7;
      user-select: none;
      max-height: 100%;
    }
  
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
  
    /* Horizontal mode: thumbs column */
    :host([data-horizontal]) .thumb-row {
      flex-direction: column;
      width: var(--gc-sidebar-w, 120px);
      flex: 0 0 var(--gc-sidebar-w, 120px);
      overflow-y: auto;
      overflow-x: hidden;
      max-height: var(--gc-preview-max-h, 480px);
      padding: 0;
    }
  
    /* Horizontal: preview flexes and has a concrete height to scale against */
    :host([data-horizontal]) .preview-container {
      flex: 1 1 auto;
      min-width: 0;
      height: var(--gc-preview-max-h, 480px);
      max-height: var(--gc-preview-max-h, 480px);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    :host([data-horizontal]) .preview-slot {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    :host([data-horizontal]) .preview-media {
      max-width: 100%;
      max-height: var(--gc-preview-max-h, 480px);
    }
  
    /* Thumbs strip baseline height */
    .thumb-row {
      min-height: var(--gc-thumb-h, 72px);
      overflow-x: scroll;
    }
    :host([data-horizontal]) .thumb-row {
      max-height: var(--gc-preview-max-h, 480px);
      min-height: var(--gc-preview-max-h, 480px);
      overflow-y: scroll;
    }
  
    .content { scrollbar-gutter: stable both-edges; }
  
    .thumb-row:empty::before {
      content: 'No media for this date';
      display: inline-flex;
      align-items: center;
      height: var(--gc-thumb-h, 72px);
      padding: 0 8px;
      color: var(--secondary-text-color);
      opacity: 0.7;
    }
    
    :host([data-empty]) .nav-btn { 
      display: none; 
    }
    :host([data-single]) .nav-btn { 
      display: none; 
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
          <button class="nav-btn nav-prev" title="Previous" aria-label="Previous">&laquo; Prev</button>
          <div class="preview-slot"></div>
          <button class="nav-btn nav-next" title="Next" aria-label="Next">Next &raquo;</button>
        </div>
      </div>

      <div class="modal" role="dialog" aria-modal="true" aria-hidden="true">
        <div class="modal-content">
          <span class="modal-close" aria-label="Close">&times;</span>
          <div class="modal-media"></div>
          <div class="modal-caption"></div>
        </div>
      </div>
    </ha-card>
  `;
}

  _cacheRefs() {
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
  }

  _bindEvents() {
    if (this._eventsBound) return;
    this._eventsBound = true;

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
      if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        const idx = Number(fig.dataset.index);
        if (Number.isInteger(idx)) this.showItem(idx);
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
    let id = String(input || '').trim().replace(/\/+$/, '');
    if (!id) return '';
    if (id.startsWith('media-source://')) return id;
    if (id.startsWith('media_source/')) return `media-source://${id}`;
    return `media-source://media_source/${id}`;
  }

  _applyVars() {
    const c = this.config || {};
    const px = (v, def) => {
      const n = Number(v);
      return Number.isFinite(n) ? `${n}px` : `${def}px`;
    };
    this.style.setProperty('--gc-thumb-h', px(c.thumb_height, 72));
    this.style.setProperty('--gc-thumb-gap', px(c.thumb_gap, 1));
    this.style.setProperty('--gc-preview-max-h', px(c.preview_max_height, 480));
    this.toggleAttribute('data-caps-off', c.captions === false);
    this.toggleAttribute('data-badges-off', c.badges === false);
    this.style.setProperty('--gc-sidebar-w', px(c.sidebar_width ?? 146, 146));
    this.style.setProperty('--gc-layout-gap', px(c.layout_gap ?? 8, 8));
    this.toggleAttribute('data-horizontal', !!c.horizontal_layout);
  }

  set hass(hass) {
    if (!this.loaded) {
      this.loaded = true;
      this.hassInstance = hass;
      if (this.datePicker) this.datePicker.value = this._formatDateInput(new Date());
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
    const v = this.datePicker?.value;
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
    catch { return /^(.*)$/; }
  }

  async loadForSelectedDate() {
    const folder = this._folderFromDateInput();
    if (!folder) return;
    await this._loadFolder(folder);
  }

  // Pooled resolver with LRU cache
  async _resolveWithPool(media_content_id) {
    if (this._urlCache.has(media_content_id)) {
      return this._urlCache.get(media_content_id);
    }
    while (this._pendingResolves >= this._resolveSem) {
      await new Promise(r => setTimeout(r, 16));
    }
    this._pendingResolves++;
    try {
      const resolved = await this.hassInstance.callWS({
        type: "media_source/resolve_media",
        media_content_id
      });
      const entry = { url: resolved.url };
      this._urlCache.set(media_content_id, entry);
      this._urlLRU.push(media_content_id);
      if (this._urlLRU.length > this._urlCacheMax) {
        const evict = this._urlLRU.shift();
        this._urlCache.delete(evict);
      }
      return entry;
    } finally {
      this._pendingResolves--;
    }
  }

  async _loadFolder(folderName) {
    let resp;
    try {
      resp = await this.hassInstance.callWS({
        type: "media_source/browse_media",
        media_content_id: `${this.contentRoot}/${folderName}`
      });
    } catch (err) {
      console.warn('[gallery-card] browse_media failed:', err);
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

    const fileCaptionRe   = this._compileRe(this.config.file_pattern || '^(.*)$');
    const timeRe          = this._compileRe(this.config.file_time_regex || '(\\d{2}:\\d{2}:\\d{2})');

    // Parse only — do not resolve here
    const parsed = mediaItems.map((item) => {
      const isVideo = (item.media_content_type || '').startsWith('video/');
      // Prefer the actual filename from the media_content_id; fall back to title
      const fileFromId = (item.media_content_id.split('/').pop() || '').trim();
      const titleStr = (item.title && String(item.title).trim()) || '';
      const fullName = fileFromId || titleStr;
    
      const fileCaptionRe = this._compileRe(this.config.file_pattern || '^(.*)$');
      const capMatch = fullName.match(fileCaptionRe);
      const caption = (capMatch && capMatch[1]) ? capMatch[1] : (titleStr || fileFromId || '');
    
      // More permissive default: HH:MM:SS or HH_MM_SS or HH-MM-SS
      const timeRe = this._compileRe(this.config.file_time_regex || '(\\d{2}[:_\\-]\\d{2}[:_\\-]\\d{2})');
      const sortMatch = fullName.match(timeRe);
      const sortKey = (sortMatch && sortMatch[1]) ? sortMatch[1] : '';
    
      return {
        id: item.media_content_id,
        title: caption,
        isVideo,
        _original: fullName,
        _full: fullName,
        _sortKey: sortKey,
      };
    });

    const showImages = this.config.show_images !== false;
    const showVideos = this.config.show_videos !== false;
    const filtered = parsed.filter(it => it.isVideo ? showVideos : showImages);

    // Newest first: primary by extracted time key; fallback to filename/ID descending
    filtered.sort((a, b) => {
      const ak = a._sortKey || '';
      const bk = b._sortKey || '';
      const byTime = bk.localeCompare(ak);
      if (byTime !== 0) return byTime;
      return (b._full || '').localeCompare(a._full || '');
    });
    
    // default to newest (index 0 after sort)
    this.items = filtered; // or the 'bounded' slice if you keep max_items
    this.toggleAttribute('data-single', this.items.length === 1);
    this.currentIndex = this.items.length ? 0 : -1;

    this._renderThumbs(this.items);
    if (this.currentIndex >= 0) {
      this.showItem(this.currentIndex);
    } else {
      this._renderPreview(null);
    }
    this._highlightThumb(this.currentIndex);
    this._scrollThumbIntoView(this.currentIndex);
  }

  _cleanupMedia(container) {
    if (!container) return;
    container.querySelectorAll('video, img').forEach(el => {
      try { el.removeAttribute('src'); } catch {}
      try { el.load && el.load(); } catch {}
    });
    container.textContent = '';
  }

  _setupThumbObserver() {
    if (this._thumbObserver) return;
    const root = this.thumbRow;
    this._thumbObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const fig = e.target;
        this._thumbObserver.unobserve(fig);
        this._hydrateThumb(fig);
      }
    }, { root, rootMargin: '200px', threshold: 0.01 });
  }

  async _hydrateThumb(fig) {
    const idx = Number(fig.dataset.index);
    const item = this.items?.[idx];
    if (!item) return;

    const img = fig.querySelector('img');
    if (!img) return;

    try {
      const { url } = await this._resolveWithPool(item.id);

      if (!item.isVideo) {
        img.src = url;
        return;
      }

      // VIDEO THUMB: try to snapshot; if not possible, use time fragment
      await new Promise((resolve, reject) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;
        v.playsInline = true;
        v.crossOrigin = 'anonymous';
        v.src = url;

        const cleanup = () => { try { v.removeAttribute('src'); v.load(); } catch {} v.remove(); };

        v.addEventListener('loadeddata', async () => {
          try {
            const target = 0.1;
            try { v.currentTime = target; } catch {}
            await new Promise(res => { const ok = () => { v.removeEventListener('seeked', ok); res(); }; v.addEventListener('seeked', ok); });

            const w = 160;
            const naturalW = v.videoWidth || 160;
            const naturalH = v.videoHeight || (this.config.thumb_height || 72);
            const h = Math.max(1, Math.round(w * naturalH / Math.max(1, naturalW)));

            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const ctx = c.getContext('2d');
            ctx.drawImage(v, 0, 0, w, h);
            img.src = c.toDataURL('image/jpeg', 0.7);
            cleanup();
            resolve();
          } catch (err) {
            cleanup();
            reject(err);
          }
        }, { once: true });

        v.addEventListener('error', () => { cleanup(); reject(new Error('video load error')); }, { once: true });
        // attach off-DOM to avoid layout
        v.style.position = 'absolute'; v.style.left = '-99999px'; v.style.top = 'auto';
        this.shadowRoot.appendChild(v);
      });
    } catch {
      // Fallback: ask backend for a frame using a time fragment
      try { img.src = (await this._resolveWithPool(item.id)).url + '#t=0.1'; } catch {}
    }
  }

  _renderThumbs(items) {
    this._setupThumbObserver();
    this._cleanupMedia(this.thumbRow);
    this.thumbRow.innerHTML = '';
    this._renderThumbsChunked(0);
  }

  _idle(cb) {
    const ric = (typeof window !== 'undefined') && window.requestIdleCallback;
    if (typeof ric === 'function') {
      return ric(cb, { timeout: 50 });   // correct options object
    }
    return setTimeout(cb, 0);            // fallback
  }
  
  _renderThumbsChunked(start = 0) {
    const page = Number(this.config.page_size) || 200;
    const end = Math.min(start + page, this.items.length);
    const frag = document.createDocumentFragment();

    for (let i = start; i < end; i++) {
      const item = this.items[i];
      const fig = document.createElement('div');
      fig.className = 'thumb';
      fig.dataset.index = String(i);
      fig.title = item._original || item.title;

      // a11y
      fig.tabIndex = 0;
      fig.setAttribute('role', 'button');
      fig.setAttribute('aria-label', `${item.isVideo ? 'Video' : 'Image'}: ${item.title}`);

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      fig.appendChild(img);

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = item.isVideo ? '▶' : '🖼';
      fig.appendChild(badge);

      const cap = document.createElement('span');
      cap.className = 'thumb-cap';
      cap.textContent = item.title;
      fig.appendChild(cap);

      frag.appendChild(fig);
    }

    this.thumbRow.appendChild(frag);

    for (let i = start; i < end; i++) {
      const fig = this.thumbRow.querySelector(`.thumb[data-index="${i}"]`);
      if (fig) this._thumbObserver.observe(fig);
    }

    if (end < this.items.length) {
      this._idle(() => this._renderThumbsChunked(end));
    }
  }

  async _renderPreview(item) {
    this._cleanupMedia(this.previewSlot);
  
    if (!item) {
      this.setAttribute('data-empty', '');
      const empty = document.createElement('div');
      empty.className = 'preview-empty';
      empty.textContent = 'Nothing to show for this date';
      this.previewSlot.appendChild(empty);
      return;
    }
  
    this.removeAttribute('data-empty');

    try {
      const { url } = await this._resolveWithPool(item.id);

      let mediaEl, badgeText;
      if (item.isVideo) {
        mediaEl = document.createElement('video');
        mediaEl.src = url;                 // only one video alive here
        mediaEl.className = 'preview-media video';
        mediaEl.muted = true; mediaEl.playsInline = true; mediaEl.preload = 'metadata';
        mediaEl.addEventListener('click', () => this.openModal());
        badgeText = '▶';
      } else {
        mediaEl = document.createElement('img');
        mediaEl.src = url;
        mediaEl.className = 'preview-media image';
        mediaEl.loading = 'lazy';
        mediaEl.decoding = 'async';
        mediaEl.addEventListener('click', () => this.openModal());
        badgeText = '🖼';
      }
      this.previewSlot.appendChild(mediaEl);
  
      const badge = document.createElement('span');
      badge.className = 'preview-badge';
      badge.textContent = badgeText;
      this.previewSlot.appendChild(badge);
  
      const pcap = document.createElement('span');
      pcap.className = 'preview-cap';
      pcap.textContent = item.title || '';
      this.previewSlot.appendChild(pcap);
    } catch (e) {
      const err = document.createElement('div');
      err.className = 'preview-empty';
      err.textContent = 'Failed to load media';
      this.previewSlot.appendChild(err);
    }
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

  async openModal() {
    if (this.currentIndex == null || this.currentIndex < 0) return;
    const item = this.items[this.currentIndex];
    if (!item) return;

    this._lastFocus = document.activeElement;

    this._cleanupMedia(this.modalMedia);

    try {
      const { url } = await this._resolveWithPool(item.id);

      if (item.isVideo) {
        const v = document.createElement('video');
        v.src = url;
        v.controls = true;
        v.autoplay = true;
        v.playsInline = true;
        this.modalMedia.appendChild(v);
      } else {
        const img = document.createElement('img');
        img.src = url;
        img.decoding = 'async';
        this.modalMedia.appendChild(img);
      }
    } catch {}

    this.modalCaption.textContent = item.title || '';
    this.modal.classList.add('open');
    this.modal.setAttribute('aria-hidden', 'false');
    this.focus();
  }

  closeModal() {
    this.modal.classList.remove('open');
    this.modal.setAttribute('aria-hidden', 'true');
    this._cleanupMedia(this.modalMedia);
    if (this._lastFocus && typeof this._lastFocus.focus === 'function') {
      this._lastFocus.focus();
    } else {
      this.focus();
    }
  }

  getCardSize() { return 4; }
}

if (!customElements.get('gallery-card')) {
  customElements.define('gallery-card', GalleryCard);
}

/* ===== Visual Editor (HA-native ha-form) ===== */
class GalleryCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...(this._config || {}), ...(config || {}) };
    this._ensureRendered();
    this._updateFormData();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  get _default() {
    return {
      media_dir: '',
      folder_pattern: 'MM-DD-YY',
      file_pattern: '^(.*)$',
      file_time_regex: '(\\d{2}:\\d{2}:\\d{2})',
      thumb_height: 72,
      thumb_gap: 1,
      preview_max_height: 480,
      captions: true,
      badges: true,
      show_images: true,
      show_videos: true,
      horizontal_layout: false,
      sidebar_width: 146,
      layout_gap: 8,
      max_items: 1000,
      page_size: 200,
    };
  }

  get _schema() {
    return [
      { name: 'media_dir', selector: { text: {} } },
      {
        name: 'folder_pattern',
        selector: { text: {} },
        help: 'Tokens: YYYY, YY, MM, DD (e.g., YYYY/MM/DD, MM-DD-YY)',
      },
      { name: 'file_pattern', selector: { text: {} }, help: 'Caption regex on FULL filename incl. extension; uses capture group 1.' },
      { name: 'file_time_regex', selector: { text: {} }, help: 'Sorting regex on FULL filename; capture group 1 is the descending sort key.' },

      { name: 'thumb_height', selector: { number: { min: 24, max: 160, mode: 'box' } } },
      { name: 'thumb_gap', selector: { number: { min: 0, max: 16, mode: 'box' } } },
      { name: 'preview_max_height', selector: { number: { min: 200, max: 1200, step: 10, mode: 'box' } } },

      { name: 'captions', selector: { boolean: {} } },
      { name: 'badges', selector: { boolean: {} } },

      { name: 'show_images', selector: { boolean: {} } },
      { name: 'show_videos', selector: { boolean: {} } },

      { name: 'horizontal_layout', selector: { boolean: {} }, help: 'Thumbs on the left, preview on the right.' },
      { name: 'sidebar_width', selector: { number: { min: 80, max: 400, mode: 'box' } } },
      { name: 'layout_gap', selector: { number: { min: 0, max: 32, mode: 'box' } } },

      { name: 'max_items', selector: { number: { min: 0, max: 100000, mode: 'box' } }, help: 'Hard cap on items to load (0 = unlimited).'},
      { name: 'page_size', selector: { number: { min: 20, max: 1000, mode: 'box' } }, help: 'Thumbs rendered per chunk for smoother performance.'},
    ];
  }

  _ensureRendered() {
    if (this._rendered) return;
    this._rendered = true;

    const style = document.createElement('style');
    style.textContent = `
      :host { display: block; padding: 8px 0; }
      ha-form { --mdc-text-field-fill-color: var(--card-background-color); }
    `;

    const form = document.createElement('ha-form');
    form.addEventListener('value-changed', (ev) => {
      const newConfig = ev.detail.value || {};
      this._config = { ...this._config, ...newConfig };
      this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config } }));
    });

    form.computeLabel = (schema) => {
      const map = {
        media_dir: 'Media directory',
        folder_pattern: 'Folder pattern (date → folder)',
        file_pattern: 'Caption regex (full filename)',
        file_time_regex: 'Sort key regex (full filename)',
        thumb_height: 'Thumbnail height (px)',
        thumb_gap: 'Thumbnail gap (px)',
        preview_max_height: 'Preview max height (px)',
        captions: 'Show captions',
        badges: 'Show type badges (🖼 / ▶)',
        show_images: 'Show pictures (images)',
        show_videos: 'Show videos',
        horizontal_layout: 'Horizontal layout (thumbs left)',
        sidebar_width: 'Sidebar width (px)',
        layout_gap: 'Layout gap (px)',
        max_items: 'Max items',
        page_size: 'Thumbs per chunk',
      };
      return map[schema.name] || schema.name;
    };
    form.computeHelper = (schema) => schema.help || undefined;

    this._form = form;
    this.append(style, form);
  }

  _updateFormData() {
    if (!this._form) return;
    const data = { ...this._default, ...(this._config || {}) };
    this._form.hass = this._hass;
    this._form.schema = this._schema;
    this._form.data = data;
  }
}
if (!customElements.get('gallery-card-editor')) {
  customElements.define('gallery-card-editor', GalleryCardEditor);
}
