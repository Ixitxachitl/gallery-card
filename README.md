### HACS (custom repo)
<img width="702" height="528" alt="image" src="https://github.com/user-attachments/assets/ec66d39a-14b0-44ff-8072-f738e6f4fdec" />

# 1) HACS → 3-dot menu → *Custom repositories* → URL of this repo → Type: Frontend → **Add**.&#x20;
# 2) Search **Gallery Card** in HACS → Install.

## Example
```yaml
type: custom:gallery-card
media_dir: media_source/snapshots
folder_pattern: MM-DD-YY
file_pattern: ^(\d{2}:\d{2}:\d{2})_.*\.[^.]+$
file_time_regex: (\d{2}:\d{2}:\d{2})
thumb_height: 46
thumb_gap: 1
preview_max_height: 420
captions: true
badges: true
