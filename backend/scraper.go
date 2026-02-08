package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/chromedp/chromedp"
)

// ScrapedCatalog represents a catalog scraped from Lidl
type ScrapedCatalog struct {
	Title      string
	ValidFrom  string
	ValidUntil string
	CoverImage string
	PageImages []string
}

// ScrapeAndDownloadLidl scrapes Lidl catalogs and downloads all images
func ScrapeAndDownloadLidl() ([]Newsletter, error) {
	log.Println("Starting Lidl catalog scraper...")

	catalogURL := "https://www.lidl.ro/c/cataloage-online/s10019911"

	// Create context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	// Create chromedp context with headless browser
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.Flag("headless", true),
		chromedp.Flag("disable-gpu", true),
		chromedp.Flag("no-sandbox", true),
	)

	allocCtx, cancel := chromedp.NewExecAllocator(ctx, opts...)
	defer cancel()

	ctx, cancel = chromedp.NewContext(allocCtx, chromedp.WithLogf(log.Printf))
	defer cancel()

	// Variables to store scraped data
	var htmlContent string

	// Navigate and extract catalog links
	err := chromedp.Run(ctx,
		chromedp.Navigate(catalogURL),
		chromedp.WaitReady("body"),
		chromedp.Sleep(3*time.Second), // Wait for JavaScript to load
		chromedp.OuterHTML("html", &htmlContent),
	)

	if err != nil {
		return nil, fmt.Errorf("failed to scrape Lidl page: %v", err)
	}

	log.Printf("Found HTML content length: %d", len(htmlContent))

	// Extract catalog detail URLs
	catalogURLs := extractCatalogURLs(htmlContent)
	log.Printf("Found %d catalog URLs", len(catalogURLs))

	// Scrape each catalog
	var newsletters []Newsletter
	for i, catURL := range catalogURLs {
		if i >= 2 { // Limit to first 2 catalogs
			break
		}

		log.Printf("Scraping catalog %d: %s", i+1, catURL)
		catalog, err := scrapeCatalogPages(ctx, catURL)
		if err != nil {
			log.Printf("Error scraping catalog %s: %v", catURL, err)
			continue
		}

		newsletter, err := downloadCatalogImages(catalog)
		if err != nil {
			log.Printf("Error downloading catalog: %v", err)
			continue
		}

		newsletters = append(newsletters, newsletter)
	}

	// Save newsletters to JSON file
	if err := saveNewslettersToFile(newsletters); err != nil {
		log.Printf("Error saving newsletters: %v", err)
	}

	return newsletters, nil
}

// extractCatalogURLs extracts catalog detail page URLs from the main page
func extractCatalogURLs(htmlContent string) []string {
	// Look for catalog URLs - they can be relative or absolute
	catalogRegex := regexp.MustCompile(`href="((?:https://www\.lidl\.ro)?/l/ro/cataloage/[^"]+)"`)
	matches := catalogRegex.FindAllStringSubmatch(htmlContent, -1)

	var urls []string
	seen := make(map[string]bool)

	for _, match := range matches {
		if len(match) > 1 {
			url := match[1]
			// Add domain if not present
			if !strings.HasPrefix(url, "http") {
				url = "https://www.lidl.ro" + url
			}
			// Clean up URL - remove /ar/0 or /view/flyer/page/X if present
			url = regexp.MustCompile(`/ar/\d+`).ReplaceAllString(url, "")
			url = regexp.MustCompile(`/view/flyer/page/\d+`).ReplaceAllString(url, "")

			// Only include weekly catalogs, not special offers
			if !seen[url] && !strings.Contains(url, "reduceri") && strings.Contains(url, "perioada") {
				seen[url] = true
				urls = append(urls, url)
				log.Printf("Found catalog URL: %s", url)
			}
		}
	}

	return urls
}

// scrapeCatalogPages scrapes all pages from a specific catalog
func scrapeCatalogPages(ctx context.Context, catalogBaseURL string) (ScrapedCatalog, error) {
	catalog := ScrapedCatalog{
		PageImages: []string{},
	}

	// Extract title and dates from URL
	// Example: catalogul-saptamanal-pentru-perioada-02-02-08-02-2026
	urlPattern := regexp.MustCompile(`perioada-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{4})`)
	if matches := urlPattern.FindStringSubmatch(catalogBaseURL); len(matches) > 5 {
		catalog.ValidFrom = fmt.Sprintf("%s-%s-%s", matches[5], matches[2], matches[1])
		catalog.ValidUntil = fmt.Sprintf("%s-%s-%s", matches[5], matches[4], matches[3])
		catalog.Title = fmt.Sprintf("Catalogul săptămânal pentru perioada %s.%s-%s.%s.%s",
			matches[1], matches[2], matches[3], matches[4], matches[5])
	}

	log.Printf("Catalog: %s (%s to %s)", catalog.Title, catalog.ValidFrom, catalog.ValidUntil)

	// Loop through pages
	for pageNum := 1; pageNum <= 30; pageNum++ { // Max 30 pages
		pageURL := fmt.Sprintf("%s/view/flyer/page/%d", catalogBaseURL, pageNum)

		var htmlContent string
		err := chromedp.Run(ctx,
			chromedp.Navigate(pageURL),
			chromedp.Sleep(2*time.Second),
			chromedp.OuterHTML("html", &htmlContent),
		)

		if err != nil {
			log.Printf("Error loading page %d: %v", pageNum, err)
			break
		}

		// Extract image URL from page
		imgRegex := regexp.MustCompile(`https://imgproxy\.leaflets\.schwarz/[^"'\s]+/page-0*` + fmt.Sprintf("%d", pageNum) + `[^"'\s]*\.(?:jpg|png)`)
		imageURL := imgRegex.FindString(htmlContent)

		// Alternative: look for any large image
		if imageURL == "" {
			imgRegex2 := regexp.MustCompile(`https://imgproxy\.leaflets\.schwarz/[^"'\s]+(?:800|1200)[^"'\s]+\.(?:jpg|png)`)
			images := imgRegex2.FindAllString(htmlContent, -1)
			if len(images) > 0 {
				imageURL = images[0] // Take first large image
			}
		}

		if imageURL == "" {
			log.Printf("No image found on page %d, stopping", pageNum)
			break
		}

		log.Printf("Found page %d image: %s", pageNum, imageURL[:80]+"...")
		catalog.PageImages = append(catalog.PageImages, imageURL)
	}

	if len(catalog.PageImages) > 0 {
		catalog.CoverImage = catalog.PageImages[0]
	}

	return catalog, nil
}

// downloadCatalogImages downloads all images for a catalog and returns a Newsletter
func downloadCatalogImages(catalog ScrapedCatalog) (Newsletter, error) {
	// Create newsletter ID
	id := fmt.Sprintf("lidl-%s", strings.ReplaceAll(catalog.ValidFrom, "-", ""))

	// Create directory for this newsletter
	newsletterDir := filepath.Join("newsletters", id)
	if err := os.MkdirAll(newsletterDir, 0755); err != nil {
		return Newsletter{}, fmt.Errorf("failed to create directory: %v", err)
	}

	log.Printf("Downloading catalog %s to %s", id, newsletterDir)

	// Download cover image
	if catalog.CoverImage != "" {
		if _, err := downloadImage(catalog.CoverImage, newsletterDir, "cover.jpg"); err != nil {
			log.Printf("Error downloading cover image: %v", err)
		}
	}

	// Download all page images
	var pages []Page
	for i, imageURL := range catalog.PageImages {
		if i >= 20 { // Limit to 20 pages
			break
		}

		filename := fmt.Sprintf("page-%02d.jpg", i+1)
		_, err := downloadImage(imageURL, newsletterDir, filename)
		if err != nil {
			log.Printf("Error downloading page %d: %v", i+1, err)
			continue
		}

		pages = append(pages, Page{
			PageNumber: i + 1,
			ImageURL:   fmt.Sprintf("/newsletters/%s/%s", id, filename),
		})
	}

	newsletter := Newsletter{
		ID:          id,
		Store:       "Lidl",
		Title:       catalog.Title,
		ValidFrom:   catalog.ValidFrom,
		ValidUntil:  catalog.ValidUntil,
		CoverImage:  fmt.Sprintf("/newsletters/%s/cover.jpg", id),
		Pages:       pages,
		LastUpdated: time.Now(),
	}

	return newsletter, nil
}

// downloadImage downloads an image from URL and saves it locally
func downloadImage(url, dir, filename string) (string, error) {
	// Get the image
	resp, err := http.Get(url)
	if err != nil {
		return "", fmt.Errorf("failed to download image: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("bad status: %s", resp.Status)
	}

	// Create the file
	filepath := filepath.Join(dir, filename)
	out, err := os.Create(filepath)
	if err != nil {
		return "", fmt.Errorf("failed to create file: %v", err)
	}
	defer out.Close()

	// Copy the data
	_, err = io.Copy(out, resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to save image: %v", err)
	}

	log.Printf("Downloaded: %s", filepath)
	return filepath, nil
}

// saveNewslettersToFile saves newsletters to a JSON file
func saveNewslettersToFile(newsletters []Newsletter) error {
	data, err := json.MarshalIndent(newsletters, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile("newsletters/newsletters.json", data, 0644)
}

// loadNewslettersFromFile loads newsletters from JSON file
func loadNewslettersFromFile() ([]Newsletter, error) {
	data, err := os.ReadFile("newsletters/newsletters.json")
	if err != nil {
		if os.IsNotExist(err) {
			return []Newsletter{}, nil
		}
		return nil, err
	}

	var newsletters []Newsletter
	if err := json.Unmarshal(data, &newsletters); err != nil {
		return nil, err
	}

	return newsletters, nil
}
