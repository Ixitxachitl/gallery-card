# HACS Gallery Card

A modern, Home Assistant–styled gallery card with a **thumbnail strip + large preview**, **image & video support**, **modal pop‑out**, **date picker**, and an optional **horizontal layout** where thumbnails are stacked vertically on the left with the preview on the right. Captions and sorting are fully configurable via **regex on the full filename including extension**.

<img width="702" height="528" alt="image" src="https://github.com/Ixitxachitl/gallery-card/blob/main/images/preview.png?raw=true" />

---

## Features

* ⚡️ Fast thumbnail strip with **tight spacing** and current‑thumb **auto scroll‑into‑view**
* 🖼️/▶️ **Images & video** in the same gallery (video opens in modal; preview shows still)
* 🎛 **Show/Hide images & videos** independently (`show_images`, `show_videos`)
* 🗓️ **Date picker → folder pattern** (e.g., `MM-DD-YY`, `YYYY/MM/DD`)
* 🔎 **Captions & sort keys via regex on full filename** (incl. extension)
* 📐 **Horizontal layout option** (`horizontal_layout`) with **sidebar width** and **gap** controls
* 🧩 **Visual Editor** support (no YAML required, but YAML works too)
* 🎨 **Native Home Assistant Dashboards styling**

---

## Installation

### HACS (Custom repository)

1. **HACS →** ⋯ menu → **Custom repositories**.
2. **Repository URL:** `https://github.com/Ixitxachitl/gallery-card`
   **Category / Type:** **Frontend** → **Add**.
3. Find **Gallery Card** in HACS → **Install**.
4. If resources are not auto‑added, manually add:
   **URL:** `/hacsfiles/gallery-card/gallery-card.js`
   **Type:** `Dashboard`.

### Manual

1. Download `gallery-card.js` from **Releases**.
2. Place in `/config/www/gallery-card.js`.
3. Add resource:
   **URL:** `/local/gallery-card.js`
   **Type:** `Dashboard`.

---

## Usage

Minimal example:

```yaml
type: custom:gallery-card
media_dir: media_source/snapshots
```

Full example (with horizontal layout & toggles):

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
show_images: true
show_videos: true
horizontal_layout: true
sidebar_width: 146
layout_gap: 8
```

> **Tip:** `horizontal_layout: true` stacks thumbnails vertically on the left and shows the preview on the right. `sidebar_width` (px) sets the left column width; `layout_gap` (px) sets the gap between the sidebar and preview.

---

## Options (also available in the Visual Editor)

> **Defaults shown here are the card's runtime defaults when a value is omitted.**

| Option               | Type      | Default               | Description                                                                                                                     |
| -------------------- | --------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `media_dir`          | string    | — *(required)*        | A Home Assistant **Media Source** root or subfolder. Examples: `media_source/snapshots`, `media_source/cameras/FrontDoor`.      |
| `folder_pattern`     | string    | `MM-DD-YY`            | How to convert the selected date into a folder path. Tokens: `YYYY`, `YY`, `MM`, `DD`. Supports nested paths like `YYYY/MM/DD`. |
| `file_pattern`       | regex str | `^(.+)$`              | **Caption regex** applied to the **full filename including extension**. Uses capture group 1.                                   |
| `file_time_regex`    | regex str | `(\d{2}:\d{2}:\d{2})` | **Sorting regex** on the **full filename**. The first capture group becomes the descending sort key.                            |
| `file_title_regex`   | regex str | `^(.+)$`              | **Fallback caption** applied to the **basename (no extension)** if `file_pattern` doesn’t match. Uses capture group 1.          |
| `thumb_height`       | number    | `72`                  | Thumbnail height in pixels.                                     |
| `thumb_gap`          | number    | `1`                   | Gap (px) between thumbnails.                                                                                                    |
| `preview_max_height` | number    | `420`                 | Max height (px) of the preview media. *(Editor may seed 480; omitted value falls back to 420 in-card.)*                         |
| `captions`           | boolean   | `true`                | Show captions (thumb + preview overlays).                                                                                       |
| `badges`             | boolean   | `true`                | Show 🖼 / ▶ badges on thumbnails and preview.                                                                                   |
| `show_images`        | boolean   | `true`                | Include image files.                                                                                                            |
| `show_videos`        | boolean   | `true`                | Include video files.                                                                                                            |
| `horizontal_layout`  | boolean   | `false`               | `true` = thumbnails left, preview right.                                                                                        |
| `sidebar_width`      | number    | `146`                 | Width (px) of the left thumbnail column in horizontal layout.                                                                   |
| `layout_gap`         | number    | `8`                   | Gap (px) between the thumb column and preview in horizontal layout.                                                             |

---

## Media directory setup

This card reads from **Local Media** (Home Assistant **Media Source**). Define your folders in `configuration.yaml` if you haven’t already:

```yaml
homeassistant:
  media_dirs:
    snapshots: /media/Snapshots
```

Then use `media_dir: media_source/snapshots` in the card config. Your folder structure should contain subfolders matching your `folder_pattern` (e.g., `08-07-25`) with media named like `05:53:24_08-07-25.jpg` or `.mp4`.

---

## Regex cheat sheet

* **Time (start of filename):** `^(\d{2}:\d{2}:\d{2})`
* **Time (anywhere), keep only the time:** `^.*?(\d{2}:\d{2}:\d{2}).*$`
* **Everything before first underscore:** `^([^_]+)`
* **Entire filename incl. extension:** `^(.+)$`

> The card uses **capture group 1** for both caption and sort key (where applicable).
