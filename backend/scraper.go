package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/chromedp/chromedp"
)

// ScrapeAndDownloadFromConfig scrapes a catalog based on config file
func ScrapeAndDownloadFromConfig(configPath string) error {
	config, err := LoadScraperConfig(configPath)
	if err != nil {
		return fmt.Errorf("failed to load config: %v", err)
	}

	log.Printf("Starting scraper for config: %s", config.ID)

	// Create output directory structure
	baseDir := filepath.Join("../newsletters", config.ID)
	pagesDir := filepath.Join(baseDir, "pages")

	if err := os.MkdirAll(pagesDir, 0755); err != nil {
		return fmt.Errorf("failed to create directories: %v", err)
	}

	// Create chromedp context
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Second)
	defer cancel()

	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.Flag("headless", true),
		chromedp.Flag("disable-gpu", true),
		chromedp.Flag("no-sandbox", true),
		chromedp.Flag("disable-cache", true),
		chromedp.Flag("disable-application-cache", true),
		chromedp.Flag("disk-cache-size", "0"),
		chromedp.WindowSize(800, 1200),
	)

	allocCtx, allocCancel := chromedp.NewExecAllocator(ctx, opts...)
	defer allocCancel()

	taskCtx, taskCancel := chromedp.NewContext(allocCtx)
	defer taskCancel()

	// Determine optimal viewport width for single-page rendering
	optimalWidth := determineOptimalViewportWidth(taskCtx, config.FirstPage)
	log.Printf("Using viewport width: %d (ensures single-page rendering)", optimalWidth)

	// Recreate context with optimal viewport size
	opts = append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.Flag("headless", true),
		chromedp.Flag("disable-gpu", true),
		chromedp.Flag("no-sandbox", true),
		chromedp.Flag("disable-cache", true),
		chromedp.Flag("disable-application-cache", true),
		chromedp.Flag("disk-cache-size", "0"),
		chromedp.WindowSize(optimalWidth, 1200),
	)

	allocCtx, allocCancel = chromedp.NewExecAllocator(ctx, opts...)
	defer allocCancel()

	taskCtx, taskCancel = chromedp.NewContext(allocCtx)
	defer taskCancel()

	// Extract cover image
	log.Printf("Extracting cover image from: %s", config.CoverImage)
	coverImageURL, err := extractImageFromPage(taskCtx, config.CoverImage)
	if err != nil {
		log.Printf("Warning: failed to extract cover image: %v", err)
	} else {
		coverPath := filepath.Join(baseDir, "cover-image.jpg")
		if err := downloadImage(coverImageURL, coverPath); err != nil {
			log.Printf("Warning: failed to download cover image: %v", err)
		} else {
			log.Printf("Downloaded cover image")
		}
	}

	// Parse page range from first_page and last_page URLs
	firstPageNum, err := extractPageNumber(config.FirstPage)
	if err != nil {
		return fmt.Errorf("failed to parse first page number: %v", err)
	}

	lastPageNum, err := extractPageNumber(config.LastPage)
	if err != nil {
		return fmt.Errorf("failed to parse last page number: %v", err)
	}

	log.Printf("Extracting pages %d to %d", firstPageNum, lastPageNum)

	for pageNum := firstPageNum; pageNum <= lastPageNum; pageNum++ {
		pageURL := buildPageURL(config.FirstPage, pageNum)
		log.Printf("Processing page %d/%d: %s", pageNum, lastPageNum, pageURL)

		imageURL, err := extractImageFromPage(taskCtx, pageURL)
		if err != nil {
			log.Printf("Warning: failed to extract image from page %d: %v", pageNum, err)
			continue
		}

		filename := fmt.Sprintf("page-%03d.jpg", pageNum)
		imagePath := filepath.Join(pagesDir, filename)

		if err := downloadImage(imageURL, imagePath); err != nil {
			log.Printf("Warning: failed to download page %d: %v", pageNum, err)
		} else {
			log.Printf("Downloaded page %d", pageNum)
		}

		// Small delay between pages to be respectful
		time.Sleep(500 * time.Millisecond)
	}
	log.Printf("Scraping complete for %s", config.ID)

	return nil
}

// extractPageNumber extracts the page number from a URL
func extractPageNumber(pageURL string) (int, error) {
	re := regexp.MustCompile(`/page/(\d+)`)
	matches := re.FindStringSubmatch(pageURL)
	if len(matches) < 2 {
		return 0, fmt.Errorf("page number not found in URL: %s", pageURL)
	}
	return strconv.Atoi(matches[1])
}

// buildPageURL builds a page URL for a specific page number
func buildPageURL(templateURL string, pageNum int) string {
	re := regexp.MustCompile(`/page/\d+`)
	return re.ReplaceAllString(templateURL, fmt.Sprintf("/page/%d", pageNum))
}

// determineOptimalViewportWidth tests different viewport widths to find the optimal size for single-page rendering
func determineOptimalViewportWidth(ctx context.Context, testPageURL string) int {
	testURL := buildPageURL(testPageURL, 2)
	widthsToTest := []int{600, 800, 1000, 1200, 1400, 1600, 1800, 2000}

	log.Printf("Testing viewport widths...")

	for _, width := range widthsToTest {
		imageCount := countCatalogImages(ctx, testURL, width)

		if imageCount == 1 {
			return width
		}

		if imageCount >= 2 {
			for i := len(widthsToTest) - 1; i >= 0; i-- {
				if widthsToTest[i] < width {
					return widthsToTest[i]
				}
			}
			return 600
		}
	}

	return 800
}

// countCatalogImages counts how many catalog page images are rendered at a given viewport width
func countCatalogImages(ctx context.Context, pageURL string, viewportWidth int) int {
	var result string

	countJS := `
		(() => {
			const currentPages = document.querySelectorAll('.page--current img, [class*="page--current"] img');
			
			if (currentPages.length > 0) {
				const catalogImages = Array.from(currentPages).filter(img => {
					const width = img.naturalWidth || img.width || 0;
					const height = img.naturalHeight || img.height || 0;
					return img.complete && width > 500 && height > 500 && 
					       img.src && !img.src.includes('data:image') && 
					       !img.src.includes('rs:fit:400') && !img.src.includes('rs:fit:200');
				});
				return JSON.stringify({count: catalogImages.length, total: currentPages.length, method: 'page--current'});
			}
			
			const images = Array.from(document.querySelectorAll('img'));
			const catalogImages = images.filter(img => {
				if (img.closest('nav') || img.closest('aside') || img.closest('.cuprins') || 
				    img.closest('[class*="sidebar"]') || img.closest('[class*="thumbnail"]')) {
					return false;
				}
				
				const width = img.naturalWidth || img.width || 0;
				const height = img.naturalHeight || img.height || 0;
				return img.complete && width > 500 && height > 500 && 
				       img.src && !img.src.includes('data:image') && 
				       !img.src.includes('rs:fit:400') && !img.src.includes('rs:fit:200');
			});
			
			return JSON.stringify({count: catalogImages.length, total: images.length, method: 'fallback'});
		})()
	`

	testOpts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.Flag("headless", true),
		chromedp.Flag("disable-gpu", true),
		chromedp.Flag("no-sandbox", true),
		chromedp.WindowSize(viewportWidth, 1200),
	)

	testAllocCtx, testAllocCancel := chromedp.NewExecAllocator(context.Background(), testOpts...)
	defer testAllocCancel()

	testTaskCtx, testTaskCancel := chromedp.NewContext(testAllocCtx)
	defer testTaskCancel()

	err := chromedp.Run(testTaskCtx,
		chromedp.Navigate(pageURL),
		chromedp.WaitReady("body"),
		chromedp.Sleep(5*time.Second),
		chromedp.WaitVisible("img", chromedp.ByQuery),
		chromedp.Sleep(3*time.Second),
		chromedp.Evaluate(countJS, &result),
	)

	if err != nil {
		log.Printf("Error testing width %d: %v", viewportWidth, err)
		return 0
	}

	// Parse the JSON result
	var debugInfo struct {
		Count  int    `json:"count"`
		Total  int    `json:"total"`
		Method string `json:"method"`
	}
	if err := json.Unmarshal([]byte(result), &debugInfo); err != nil {
		return 0
	}

	return debugInfo.Count
}

// extractImageFromPage navigates to a page and extracts the main image URL
func extractImageFromPage(ctx context.Context, pageURL string) (string, error) {
	var result string

	selectorJS := `
		(() => {
			const currentPages = document.querySelectorAll('.page--current img, [class*="page--current"] img');
			
			if (currentPages.length > 0) {
				const catalogImages = Array.from(currentPages).filter(img => {
					const width = img.naturalWidth || img.width || 0;
					const height = img.naturalHeight || img.height || 0;
					return img.complete && width > 500 && height > 500 && 
					       img.src && !img.src.includes('data:image') && 
					       !img.src.includes('rs:fit:400') && !img.src.includes('rs:fit:200');
				});
				
				if (catalogImages.length > 0) {
					return JSON.stringify({success: true, url: catalogImages[0].src});
				}
			}
			
			const mainContainers = ['main', 'article', '.flyer-content'];
			let targetContainer = document.body;
			for (const selector of mainContainers) {
				const container = document.querySelector(selector);
				if (container) {
					targetContainer = container;
					break;
				}
			}
			
			const images = Array.from(targetContainer.querySelectorAll('img'));
			const catalogImages = images.filter(img => {
				if (img.closest('nav') || img.closest('aside') || img.closest('.cuprins') || 
				    img.closest('[class*="sidebar"]') || img.closest('[class*="thumbnail"]')) {
					return false;
				}
				
				const width = img.naturalWidth || img.width || 0;
				const height = img.naturalHeight || img.height || 0;
				return img.complete && width > 500 && height > 500 && 
				       img.src && !img.src.includes('data:image') && 
				       !img.src.includes('rs:fit:400') && !img.src.includes('rs:fit:200');
			});
			
			if (catalogImages.length > 0) {
				return JSON.stringify({success: true, url: catalogImages[0].src});
			}
			return JSON.stringify({success: false});
		})()
	`

	err := chromedp.Run(ctx,
		chromedp.Navigate(pageURL),
		chromedp.WaitReady("body"),
		chromedp.Sleep(3*time.Second),
		chromedp.Reload(),
		chromedp.Sleep(5*time.Second),
		chromedp.WaitVisible("img", chromedp.ByQuery),
		chromedp.Sleep(2*time.Second),
		chromedp.Evaluate(selectorJS, &result),
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
			baseURL := fmt.Sprintf("%s://%s", parsedURL.Scheme, parsedURL.Host)
			imageURL = baseURL + imageURL
		}
	}

	return imageURL, nil
}

// downloadImage downloads an image from URL to the specified path
func downloadImage(imageURL, filePath string) error {
	resp, err := http.Get(imageURL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, resp.Status)
	}

	out, err := os.Create(filePath)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}
