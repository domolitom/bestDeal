# Newsletters Storage

This folder contains scraped catalogs and their images.

## Structure

```
newsletters/
├── newsletters.json          # Metadata for all newsletters
└── lidl-YYYYMMDD/           # Catalog folder (one per catalog)
    ├── cover.jpg            # Cover image
    ├── page-01.jpg          # Page 1
    ├── page-02.jpg          # Page 2
    └── ...
```

## How it works

- Backend scraper saves images here
- Backend API serves images from here
- Frontend reads data via API
- In production, this can be replaced with shared storage (S3, PV, etc.)
