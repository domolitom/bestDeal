# BestDeal Backend

A generic Go scraper service that downloads catalog images based on simple JSON configuration files.

## Features

- **Generic Image Scraping**: Extracts images from catalog viewer pages using chromedp
- **Config-Based**: All scraping logic is driven by simple JSON config files
- **Organized Output**: Creates folders with cover images and page images
- **REST API**: Serves catalog images and provides scraping endpoints

## Config File Format

Each config file in `configs/` defines what to scrape:

```json
{
  "id": "lidl-09-02-15-02-2026",
  "cover_image": "https://example.com/catalog/page/1",
  "first_page": "https://example.com/catalog/page/1",
  "last_page": "https://example.com/catalog/page/80"
}
```

The scraper will:

1. Extract the image from the `cover_image` URL and save as `cover-image.jpg`
2. Extract images from all pages between `first_page` and `last_page`
3. Save everything to `newsletters/{id}/` folder

## Setup

1. **Install dependencies:**

```bash
go mod download
```

2. **Run the server:**

```bash
go run *.go
```

The server will start on http://localhost:8080

## Manual Scraping

To scrape a specific config:

```bash
# Use the API endpoint
curl -X POST http://localhost:8080/api/scrape/lidl-09-02-15-02-2026
```

## Output Structure

```
newsletters/
  lidl-09-02-15-02-2026/
    cover-image.jpg
    pages/
      page-001.jpg
      page-002.jpg
      ...
      page-080.jpg
```

## API Endpoints

### POST /api/scrape/{config-name}

Triggers scraping for a specific config file (without .json extension).

**Example:**

```bash
curl -X POST http://localhost:8080/api/scrape/lidl-09-02-15-02-2026
```

### GET /api/stores

Returns all available config files.

**Example:**

```bash
curl http://localhost:8080/api/stores
```

### POST /api/scrape/lidl

Triggers the Lidl scraper to download new catalogs.

**Example:**

```bash
curl -X POST http://localhost:8080/api/scrape/lidl
```

This will:

1. Navigate to Lidl's catalog page
2. Extract all catalog image URLs
3. Download cover and page images to `newsletters/{catalog-id}/`
4. Save metadata to `newsletters/newsletters.json`
5. Update the in-memory newsletter list

**Note:** Scraping runs in the background and may take 1-2 minutes.

## Directory Structure

```
backend/
├── main.go              # Main server and API handlers
├── scraper.go           # Scraping and downloading logic
├── newsletters/         # Downloaded catalogs (auto-created)
│   ├── newsletters.json # Catalog metadata
│   ├── lidl-20260209/   # Individual catalog folders
│   │   ├── cover.jpg    # Cover image
│   │   ├── page-01.jpg  # Page images
│   │   ├── page-02.jpg
│   │   └── ...
│   └── ...
└── go.mod
```

## How It Works

1. **Scraping**: The scraper uses chromedp to load Lidl's catalog page with JavaScript rendering
2. **Parsing**: Extracts image URLs and date information using regex patterns
3. **Downloading**: Downloads each image (max 20 pages per catalog) to local storage
4. **Serving**: Images are served via `/newsletters/{id}/{filename}` endpoint
5. **Frontend**: HTML pages fetch data from API and display images

## Testing

1. Start the server:

```bash
go run main.go scraper.go
```

2. Open browser to http://localhost:8080

3. Trigger scraping:

```bash
curl -X POST http://localhost:8080/api/scrape/lidl
```

4. Check the logs for progress

5. Refresh the homepage to see new catalogs

## Troubleshooting

**Problem**: Chromedp fails to start

- Make sure Chrome/Chromium is installed on your system
- On macOS: `brew install chromium` (optional, chromedp can download it automatically)

**Problem**: Images not downloading

- Check internet connection
- Verify Lidl website is accessible
- Check logs for specific error messages

**Problem**: Port 8080 already in use

- Change the port in main.go: `port := ":8081"`
- Or kill the process using port 8080

## Future Enhancements

- [ ] Add support for more supermarkets (Kaufland, Penny, etc.)
- [ ] Implement periodic auto-scraping with cron jobs
- [ ] Add image optimization/compression
- [ ] Implement catalog search functionality
- [ ] Add product detection with OCR
