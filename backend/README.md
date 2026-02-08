# BestDeal Backend

A Go backend service that scrapes and downloads supermarket catalogs (currently supports Lidl Romania).

## Features

- **Web Scraping**: Uses chromedp (headless Chrome) to scrape JavaScript-rendered catalog pages
- **Image Downloading**: Downloads all catalog pages and cover images locally
- **REST API**: Serves catalog data as JSON
- **Static File Serving**: Serves downloaded images and frontend files
- **Persistent Storage**: Saves catalog data to JSON file

## Setup

1. **Install dependencies:**

```bash
go mod download
```

2. **Run the server:**

```bash
go run main.go scraper.go
```

The server will start on http://localhost:8080

## API Endpoints

### GET /api/newsletters

Returns all available newsletters/catalogs.

**Example:**

```bash
curl http://localhost:8080/api/newsletters
```

### GET /api/newsletters/{id}

Returns a specific newsletter by ID.

**Example:**

```bash
curl http://localhost:8080/api/newsletters/lidl-20260209
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
