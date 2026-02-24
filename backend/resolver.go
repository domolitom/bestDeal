package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/chromedp/chromedp"
)

// Manifest is the bridge between resolver and downloader.
// The resolver writes it; the downloader reads it.
type Manifest struct {
	ID            string         `json:"id"`
	Store         string         `json:"store"`
	CoverImageURL string         `json:"cover_image_url"`
	Pages         []ManifestPage `json:"pages"`
}

// ManifestPage holds the resolved image URL for a single catalog page.
type ManifestPage struct {
	Number   int    `json:"number"`
	ImageURL string `json:"image_url"`
}

// imageExtractionJS finds the main catalog image on the current page.
const imageExtractionJS = `
	(() => {
		// Prefer images inside the current-page container
		const currentPages = document.querySelectorAll('.page--current img, [class*="page--current"] img');
		const candidates = currentPages.length > 0
			? Array.from(currentPages)
			: Array.from(document.querySelectorAll('img')).filter(img =>
				!img.closest('nav') && !img.closest('aside') &&
				!img.closest('.cuprins') && !img.closest('[class*="sidebar"]') &&
				!img.closest('[class*="thumbnail"]'));

		const good = candidates.filter(img => {
			const w = img.naturalWidth || img.width || 0;
			const h = img.naturalHeight || img.height || 0;
			return img.complete && w > 500 && h > 500 &&
				img.src && !img.src.includes('data:image') &&
				!img.src.includes('rs:fit:400') && !img.src.includes('rs:fit:200');
		});

		if (good.length > 0) {
			return JSON.stringify({success: true, url: good[0].src});
		}
		return JSON.stringify({success: false});
	})()
`

// ResolveManifest creates a manifest.json for a given scraper config.
// It launches a headless browser, visits every page URL, and extracts direct image URLs.
func ResolveManifest(configPath string) (*Manifest, error) {
	config, err := LoadScraperConfig(configPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load config: %v", err)
	}

	log.Printf("[resolver] starting for %s", config.ID)

	firstPageNum, err := extractPageNumber(config.FirstPage)
	if err != nil {
		return nil, fmt.Errorf("failed to parse first page number: %v", err)
	}
	lastPageNum, err := extractPageNumber(config.LastPage)
	if err != nil {
		return nil, fmt.Errorf("failed to parse last page number: %v", err)
	}

	// Fixed 800px viewport — reliable single-page rendering on mobile-optimized viewers.
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Second)
	defer cancel()

	taskCtx, taskCancel := createBrowserContext(ctx, 800, 1200)
	defer taskCancel()

	// Derive store name from config ID (e.g. "lidl-09-02-15-02-2026" → "lidl")
	store := config.ID
	if idx := strings.Index(config.ID, "-"); idx > 0 {
		store = config.ID[:idx]
	}

	manifest := &Manifest{
		ID:    config.ID,
		Store: store,
	}

	// Resolve cover image
	log.Printf("[resolver] resolving cover image: %s", config.CoverImage)
	coverURL, err := extractImageFromPage(taskCtx, config.CoverImage)
	if err != nil {
		log.Printf("[resolver] warning: cover image failed: %v", err)
	} else {
		manifest.CoverImageURL = coverURL
	}

	// Resolve each page
	log.Printf("[resolver] resolving pages %d–%d", firstPageNum, lastPageNum)
	for pageNum := firstPageNum; pageNum <= lastPageNum; pageNum++ {
		pageURL := buildPageURL(config.FirstPage, pageNum)
		log.Printf("[resolver] page %d/%d: %s", pageNum, lastPageNum, pageURL)

		imageURL, err := extractImageFromPage(taskCtx, pageURL)
		if err != nil {
			log.Printf("[resolver] warning: page %d failed: %v", pageNum, err)
			continue
		}

		manifest.Pages = append(manifest.Pages, ManifestPage{
			Number:   pageNum,
			ImageURL: imageURL,
		})

		// Small delay between pages to be respectful
		time.Sleep(500 * time.Millisecond)
	}

	// Write manifest to disk
	baseDir := filepath.Join("../newsletters", config.ID)
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create directory: %v", err)
	}

	manifestPath := filepath.Join(baseDir, "manifest.json")
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal manifest: %v", err)
	}
	if err := os.WriteFile(manifestPath, data, 0644); err != nil {
		return nil, fmt.Errorf("failed to write manifest: %v", err)
	}

	log.Printf("[resolver] manifest written to %s (%d pages resolved)", manifestPath, len(manifest.Pages))
	return manifest, nil
}

// --- helpers ---

// createBrowserContext creates a chromedp context with the specified viewport size.
func createBrowserContext(ctx context.Context, width, height int) (context.Context, context.CancelFunc) {
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.Flag("headless", true),
		chromedp.Flag("disable-gpu", true),
		chromedp.Flag("no-sandbox", true),
		chromedp.Flag("disable-cache", true),
		chromedp.Flag("disable-application-cache", true),
		chromedp.Flag("disk-cache-size", "0"),
		chromedp.WindowSize(width, height),
	)

	allocCtx, allocCancel := chromedp.NewExecAllocator(ctx, opts...)
	taskCtx, taskCancel := chromedp.NewContext(allocCtx)

	cancelFunc := func() {
		taskCancel()
		allocCancel()
	}

	return taskCtx, cancelFunc
}

// extractImageFromPage navigates to a page and extracts the main image URL.
func extractImageFromPage(ctx context.Context, pageURL string) (string, error) {
	var result string

	err := chromedp.Run(ctx,
		chromedp.Navigate(pageURL),
		chromedp.WaitReady("body"),
		chromedp.WaitVisible("img", chromedp.ByQuery),
		chromedp.Sleep(3*time.Second),
		chromedp.Evaluate(imageExtractionJS, &result),
	)
	if err != nil {
		return "", err
	}

	var extractResult struct {
		Success bool   `json:"success"`
		URL     string `json:"url"`
	}
	if err := json.Unmarshal([]byte(result), &extractResult); err != nil || !extractResult.Success {
		return "", fmt.Errorf("no image found on page")
	}

	imageURL := extractResult.URL
	if !strings.HasPrefix(imageURL, "http") {
		parsedURL, err := url.Parse(pageURL)
		if err == nil {
			imageURL = fmt.Sprintf("%s://%s%s", parsedURL.Scheme, parsedURL.Host, imageURL)
		}
	}

	return imageURL, nil
}

// extractPageNumber extracts the page number from a URL like ".../page/42".
func extractPageNumber(pageURL string) (int, error) {
	re := regexp.MustCompile(`/page/(\d+)`)
	matches := re.FindStringSubmatch(pageURL)
	if len(matches) < 2 {
		return 0, fmt.Errorf("page number not found in URL: %s", pageURL)
	}
	return strconv.Atoi(matches[1])
}

// buildPageURL replaces the page number in a template URL.
func buildPageURL(templateURL string, pageNum int) string {
	re := regexp.MustCompile(`/page/\d+`)
	return re.ReplaceAllString(templateURL, fmt.Sprintf("/page/%d", pageNum))
}
