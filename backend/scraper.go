package main

import (
	"context"
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
	)

	allocCtx, allocCancel := chromedp.NewExecAllocator(ctx, opts...)
	defer allocCancel()

	taskCtx, taskCancel := chromedp.NewContext(allocCtx)
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

	// Extract and download all page images (sequentially to avoid rate limiting)
	for pageNum := firstPageNum; pageNum <= lastPageNum; pageNum++ {
		pageURL := buildPageURL(config.FirstPage, pageNum)
		log.Printf("Processing page %d/%d: %s", pageNum-firstPageNum+1, lastPageNum-firstPageNum+1, pageURL)

		imageURL, err := extractImageFromPage(taskCtx, pageURL)
		if err != nil {
			log.Printf("Warning: failed to extract image from page %d: %v", pageNum, err)
			continue
		}

		filename := fmt.Sprintf("page-%03d.jpg", pageNum)
		imagePath := filepath.Join(pagesDir, filename)

		if err := downloadImage(imageURL, imagePath); err != nil {
			log.Printf("Warning: failed to download page %d: %v", pageNum, err)
			continue
		}

		log.Printf("Downloaded page %d", pageNum)

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

// extractImageFromPage navigates to a page and extracts the main image URL
func extractImageFromPage(ctx context.Context, pageURL string) (string, error) {
	var imageURL string

	// JavaScript to find the catalog image
	selectorJS := `
		(() => {
			// Try different selectors in order of specificity
			const selectors = [
				'img.flyer-image',
				'img[class*="flyer"]',
				'img[class*="catalog"]',
				'div.flyer-container img',
				'div[class*="flyer"] img',
				'div[class*="catalog"] img',
				'main img',
				'article img'
			];
			
			for (const selector of selectors) {
				try {
					const img = document.querySelector(selector);
					if (img && img.src) {
						return img.src;
					}
				} catch (e) {}
			}
			return '';
		})()
	`

	err := chromedp.Run(ctx,
		chromedp.Navigate(pageURL),
		chromedp.WaitReady("body"),
		chromedp.Sleep(4*time.Second),
		chromedp.Evaluate(selectorJS, &imageURL),
	)

	if err != nil {
		return "", err
	}

	imageURL = strings.TrimSpace(imageURL)
	if imageURL == "" {
		return "", fmt.Errorf("no image found on page")
	}

	// Ensure the URL is absolute
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
