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
	"sync"
	"time"

	"github.com/chromedp/chromedp"
)

// ScrapedCatalog represents a catalog scraped from a store
type ScrapedCatalog struct {
	Title      string
	ValidFrom  string
	ValidUntil string
	CoverImage string
	PageImages []string
}

// ScrapeAndDownload scrapes catalogs for a configured store
func ScrapeAndDownload(config *ScraperConfig) ([]Newsletter, error) {
	log.Printf("Starting %s scraper...", config.StoreName)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.Flag("headless", true),
		chromedp.Flag("disable-gpu", true),
		chromedp.Flag("no-sandbox", true),
	)

	allocCtx, cancel := chromedp.NewExecAllocator(ctx, opts...)
	defer cancel()

	ctx, cancel = chromedp.NewContext(allocCtx)
	defer cancel()

	var htmlContent string
	waitDuration := time.Duration(config.WaitTime) * time.Second

	err := chromedp.Run(ctx,
		chromedp.Navigate(config.CatalogListURL),
		chromedp.WaitReady("body"),
		chromedp.Sleep(waitDuration),
		chromedp.OuterHTML("html", &htmlContent),
	)

	if err != nil {
		return nil, fmt.Errorf("failed to scrape: %v", err)
	}

	catalogURLs := extractCatalogURLs(htmlContent, config)
	log.Printf("Found %d catalogs for %s", len(catalogURLs), config.StoreName)

	var newsletters []Newsletter
	maxCatalogs := config.MaxCatalogs
	if maxCatalogs == 0 {
		maxCatalogs = len(catalogURLs)
	}

	for i, url := range catalogURLs {
		if i >= maxCatalogs {
			break
		}

		log.Printf("Scraping %d/%d...", i+1, min(maxCatalogs, len(catalogURLs)))
		catalog, err := scrapeCatalogPages(ctx, url, config)
		if err != nil {
			log.Printf("Skip: %v", err)
			continue
		}

		newsletter, err := downloadCatalogImages(catalog, config)
		if err != nil {
			log.Printf("Skip: %v", err)
			continue
		}

		newsletters = append(newsletters, newsletter)
	}

	if err := saveNewslettersToFile(newsletters); err != nil {
		log.Printf("Warning: %v", err)
	}

	return newsletters, nil
}

func extractCatalogURLs(html string, config *ScraperConfig) []string {
	regex := regexp.MustCompile(config.Selectors.CatalogURLRegex)
	matches := regex.FindAllStringSubmatch(html, -1)

	var urls []string
	seen := make(map[string]bool)

	for _, match := range matches {
		if len(match) < 2 {
			continue
		}

		url := match[1]
		if !strings.HasPrefix(url, "http") {
			url = "https://www.lidl.ro" + url
		}

		url = regexp.MustCompile(`/ar/\d+`).ReplaceAllString(url, "")
		url = regexp.MustCompile(`/view/flyer/page/\d+`).ReplaceAllString(url, "")

		if !seen[url] && !strings.Contains(url, "reduceri") && strings.Contains(url, "perioada") {
			seen[url] = true
			urls = append(urls, url)
		}
	}

	return urls
}

func scrapeCatalogPages(ctx context.Context, baseURL string, config *ScraperConfig) (ScrapedCatalog, error) {
	var htmlContent string
	waitDuration := time.Duration(config.WaitTime) * time.Second

	// First load to get title and dates
	err := chromedp.Run(ctx,
		chromedp.Navigate(baseURL),
		chromedp.WaitReady("body"),
		chromedp.Sleep(waitDuration),
		chromedp.OuterHTML("html", &htmlContent),
	)

	if err != nil {
		return ScrapedCatalog{}, fmt.Errorf("failed to load catalog: %v", err)
	}

	catalog := ScrapedCatalog{
		Title:      extractTitle(htmlContent, config),
		ValidFrom:  time.Now().Format("2006-01-02"),
		ValidUntil: time.Now().AddDate(0, 0, 7).Format("2006-01-02"),
	}

	extractDates(&catalog, htmlContent)

	// Try to scrape page-by-page (for page-by-page viewers)
	seen := make(map[string]bool)
	emptyCount := 0
	for page := 1; page <= config.MaxPages; page++ {
		var imageURL string
		// Calculate page index based on config (0-indexed or 1-indexed)
		pageIndex := page - 1 + config.PageIndexStart
		pageURL := fmt.Sprintf("%s%s", baseURL, fmt.Sprintf(config.PageURLPattern, pageIndex))

		// Build JavaScript selector query from config
		selectorJS := buildSelectorJS(config.Selectors.PageImageSelector)

		err := chromedp.Run(ctx,
			chromedp.Navigate(pageURL),
			chromedp.Sleep(3*time.Second),
			chromedp.Evaluate(selectorJS, &imageURL),
		)

		if err != nil {
			log.Printf("Error on page %d: %v", page, err)
			emptyCount++
			if emptyCount >= 3 {
				break
			}
			continue
		}

		imageURL = strings.TrimSpace(imageURL)
		if imageURL == "" {
			log.Printf("Empty image URL on page %d (%s)", page, pageURL)
			emptyCount++
			if emptyCount >= 3 {
				break
			}
			continue
		}

		if !seen[imageURL] {
			seen[imageURL] = true
			catalog.PageImages = append(catalog.PageImages, imageURL)
			log.Printf("Found page %d: %s", page, imageURL[:min(80, len(imageURL))])
			emptyCount = 0 // Reset counter on success
		} else {
			log.Printf("Duplicate image on page %d, stopping", page)
			break
		}
	}

	// Fallback: try to get all images from single page
	if len(catalog.PageImages) == 0 {
		log.Println("Page-by-page scraping failed, trying single page approach...")
		var imageURLs []string

		err := chromedp.Run(ctx,
			chromedp.Navigate(baseURL),
			chromedp.WaitReady("body"),
			chromedp.Sleep(waitDuration),
			chromedp.Evaluate(`
				Array.from(document.querySelectorAll('img'))
					.map(img => img.src || img.dataset.src || img.getAttribute('data-src'))
					.filter(src => src && (src.includes('imgproxy.leaflets.schwarz') || src.includes('leaflets')))
			`, &imageURLs),
		)

		if err == nil {
			for _, imageURL := range imageURLs {
				imageURL = strings.TrimSpace(imageURL)
				if !seen[imageURL] && imageURL != "" {
					seen[imageURL] = true
					catalog.PageImages = append(catalog.PageImages, imageURL)
				}
			}
		}
	}

	if len(catalog.PageImages) > 0 {
		catalog.CoverImage = catalog.PageImages[0]
	}

	log.Printf("Found %d pages", len(catalog.PageImages))
	return catalog, nil
}

func downloadCatalogImages(catalog ScrapedCatalog, config *ScraperConfig) (Newsletter, error) {
	storeLower := strings.ToLower(config.StoreName)
	id := fmt.Sprintf("%s-%s", storeLower, strings.ReplaceAll(catalog.ValidFrom, "-", ""))
	dir := filepath.Join("../newsletters", id)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return Newsletter{}, err
	}

	log.Printf("Downloading %d images...", len(catalog.PageImages))

	if catalog.CoverImage != "" {
		downloadImage(catalog.CoverImage, dir, "cover.jpg")
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	var pages []Page
	sem := make(chan struct{}, 5)

	for i, url := range catalog.PageImages {
		if i >= config.MaxPages {
			break
		}

		wg.Add(1)
		go func(num int, imgURL string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			filename := fmt.Sprintf("page-%02d.jpg", num+1)
			if _, err := downloadImage(imgURL, dir, filename); err != nil {
				return
			}

			mu.Lock()
			pages = append(pages, Page{
				PageNumber: num + 1,
				ImageURL:   fmt.Sprintf("/newsletters/%s/%s", id, filename),
			})
			mu.Unlock()
		}(i, url)
	}

	wg.Wait()
	sortPages(pages)

	log.Printf("Downloaded %d pages", len(pages))
	return Newsletter{
		ID:          id,
		Store:       config.StoreName,
		Title:       catalog.Title,
		ValidFrom:   catalog.ValidFrom,
		ValidUntil:  catalog.ValidUntil,
		CoverImage:  fmt.Sprintf("/newsletters/%s/cover.jpg", id),
		Pages:       pages,
		LastUpdated: time.Now(),
	}, nil
}

func sortPages(pages []Page) {
	for i := range pages {
		for j := i + 1; j < len(pages); j++ {
			if pages[i].PageNumber > pages[j].PageNumber {
				pages[i], pages[j] = pages[j], pages[i]
			}
		}
	}
}

func extractTitle(html string, config *ScraperConfig) string {
	titleRegex := regexp.MustCompile(`<h1[^>]*>([^<]+)</h1>`)
	matches := titleRegex.FindStringSubmatch(html)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}
	return fmt.Sprintf("%s Catalog", config.StoreName)
}

func extractDates(catalog *ScrapedCatalog, html string) {
	dateRegex := regexp.MustCompile(`(\d{2})\.(\d{2})\.(\d{4})`)
	matches := dateRegex.FindAllStringSubmatch(html, 2)

	if len(matches) >= 2 {
		catalog.ValidFrom = fmt.Sprintf("%s-%s-%s", matches[0][3], matches[0][2], matches[0][1])
		catalog.ValidUntil = fmt.Sprintf("%s-%s-%s", matches[1][3], matches[1][2], matches[1][1])
	}
}

// buildSelectorJS creates a JavaScript expression to find images using comma-separated CSS selectors
func buildSelectorJS(selectorString string) string {
	selectors := strings.Split(selectorString, ",")
	var conditions []string
	for _, sel := range selectors {
		sel = strings.TrimSpace(sel)
		conditions = append(conditions, fmt.Sprintf(`document.querySelector('%s')`, sel))
	}
	return fmt.Sprintf(`
		(() => {
			const img = %s;
			return img ? img.src : '';
		})()
	`, strings.Join(conditions, " || "))
}

func downloadImage(url, dir, filename string) (string, error) {
	resp, err := http.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("status: %s", resp.Status)
	}

	path := filepath.Join(dir, filename)
	out, err := os.Create(path)
	if err != nil {
		return "", err
	}
	defer out.Close()

	if _, err = io.Copy(out, resp.Body); err != nil {
		return "", err
	}

	return path, nil
}

// saveNewslettersToFile saves newsletters to a JSON file
func saveNewslettersToFile(newsletters []Newsletter) error {
	data, err := json.MarshalIndent(newsletters, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile("../newsletters/newsletters.json", data, 0644)
}

// loadNewslettersFromFile loads newsletters from JSON file
func loadNewslettersFromFile() ([]Newsletter, error) {
	data, err := os.ReadFile("../newsletters/newsletters.json")
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
