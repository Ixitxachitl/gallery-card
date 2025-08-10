# HACS Gallery Card

A modern, Home Assistant–styled gallery card with a **thumbnail strip + large preview**, **image & video support**, **modal pop‑out**, and a **date picker** that maps to folders (e.g., `MM-DD-YY`). Captions and sorting are fully configurable via **regex on the full filename including extension**.
<img width="702" height="528" alt="image" src="https://github.com/Ixitxachitl/gallery-card/blob/main/images/preview.png?raw=true" />
&#x20;  &#x20;

---

## Features

* ⚡️ Fast thumbnail strip with **tight spacing** and current‑thumb **auto scroll‑into‑view**
* 🖼️/▶️ **Images & video** in the same gallery (video opens in modal; preview shows still)
* 🗓️ **Date picker → folder pattern** (e.g., `MM-DD-YY`, `YYYY/MM/DD`)
* 🔎 **Captions & sort keys via regex on full filename** (incl. extension)
* 🧩 **Visual Editor** support (no YAML required, but YAML works too)
* 🎨 **Native Home Assistant Dashboards styling** (rounded corners, theme colors, shadows)

---

## Installation

### HACS (Custom repository)

1. Open **HACS →** ⋯ menu → **Custom repositories**.
2. **Repository URL:** `https://github.com/Ixitxachitl/gallery-card`
   **Category / Type:** **Frontend** → **Add**.
3. In HACS, find **Gallery Card** → **Install**.
4. If resources are not auto‑added, go to **Settings → Dashboards → Resources → Add resource** and add:
   **URL:** `/hacsfiles/gallery-card/gallery-card.js`
   **Type:** `Dashboard`.

### Manual

1. Download `gallery-card.js` from **Releases**.
2. Place it in `/config/www/gallery-card.js`.
3. Go to **Settings → Dashboards → Resources → Add resource**:
   **URL:** `/local/gallery-card.js`
   **Type:** `Dashboard`.

---

## Usage

Add a card in **Dashboards** (Visual Editor or YAML). Minimal example:

```yaml
type: custom:gallery-card
media_dir: media_source/snapshots
```

### Full example

```yaml
type: custom:gallery-card
media_dir: media_source/snapshots
folder_pattern: MM-DD-YY
file_pattern: ^(\d{2}:\d{2}:\d{2})_.*\.[^.]+$
file_time_regex: (\d{2}:\d{2}:\d{2})
file_title_regex: ^(.+)$
thumb_height: 72
thumb_gap: 1
preview_max_height: 480
captions: true
badges: true
```

> **Tip:** The date picker selects a day; the card builds the folder path using `folder_pattern`. So a selected date of **2025‑08‑07** with `MM‑DD‑YY` maps to folder `08‑07‑25` under your `media_dir`.

---

## Options (also available in the Visual Editor)

| Option               | Type      | Default               | Description                                                                                                                                                                                       |
| -------------------- | --------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `media_dir`          | string    | — *(required)*        | A Home Assistant **Media Source** root or subfolder. Examples: `media_source/snapshots`, `media_source/cameras/FrontDoor`. (Automatically normalized to `media-source://media_source/...`.)       |
| `folder_pattern`     | string    | `MM-DD-YY`            | How to convert the selected date into a folder path. Tokens: `YYYY`, `YY`, `MM`, `DD`. Supports nested paths like `YYYY/MM/DD`.                                                                   |
| `file_pattern`       | regex str | `^(.+)$`              | **Caption regex** applied to the **full filename including extension**. Caption uses **capture group 1**. Example to show only time: `^(\d{2}:\d{2}:\d{2})` or `^(\d{2}:\d{2}:\d{2})_.*\.[^.]+$`. |
| `file_time_regex`    | regex str | `(\d{2}:\d{2}:\d{2})` | **Sorting regex** applied to the **full filename**. The **first capture group** becomes the sort key (descending). Works with `HH:mm:ss` or similar.                                              |
| `file_title_regex`   | regex str | `^(.+)$`              | **Fallback caption** applied to the basename (no extension) if `file_pattern` doesn’t match. Uses capture group 1.                                                                                |
| `thumb_height`       | number    | `72`                  | Thumbnail height in pixels (keeps aspect ratio; no stretch).                                                                                                                                      |
| `thumb_gap`          | number    | `1`                   | Horizontal gap (px) between thumbnails.                                                                                                                                                           |
| `preview_max_height` | number    | `480`                 | Max height (px) of the preview media (keeps aspect ratio).                                                                                                                                        |
| `captions`           | boolean   | `true`                | Show captions (thumb overlay + preview overlay).                                                                                                                                                  |
| `badges`             | boolean   | `true`                | Show 🖼 / ▶ badges on thumbnails and preview.                                                                                                                                                     |

---

## Media directory setup

This card reads from **Local Media** (Home Assistant **Media Source**). Define your folders in `configuration.yaml` if you haven’t already:

```yaml
homeassistant:
  media_dirs:
    snapshots: /media/Snapshots
```

Then use `media_dir: media_source/snapshots` in the card config.
Your folder structure should contain subfolders matching your `folder_pattern` (e.g., `08-07-25`) with media named like `05:53:24_08-07-25.jpg` or `.mp4`.

---

## Regex cheat sheet

* **Time (start of filename):**
  `^(\d{2}:\d{2}:\d{2})`
* **Time (anywhere), keep only the time:**
  `^.*?(\d{2}:\d{2}:\d{2}).*$`
* **Everything before first underscore:**
  `^([^_]+)`
* **Entire filename incl. extension:**
  `^(.+)$`

> The card uses **capture group 1** for both caption and sort key (where applicable).

---
