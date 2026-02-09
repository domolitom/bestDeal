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

// ScrapedCatalog represents a catalog scraped from Lidl
type ScrapedCatalog struct {
	Title      string
	ValidFrom  string
	ValidUntil string
	CoverImage string
	PageImages []string
}

func ScrapeAndDownloadLidl() ([]Newsletter, error) {
	log.Println("Starting Lidl scraper...")

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
	err := chromedp.Run(ctx,
		chromedp.Navigate("https://www.lidl.ro/c/cataloage-online/s10019911"),
		chromedp.WaitReady("body"),
		chromedp.Sleep(3*time.Second),
		chromedp.OuterHTML("html", &htmlContent),
	)

	if err != nil {
		return nil, fmt.Errorf("failed to scrape: %v", err)
	}

	catalogURLs := extractCatalogURLs(htmlContent)
	log.Printf("Found %d catalogs", len(catalogURLs))

	var newsletters []Newsletter
	for i, url := range catalogURLs {
		if i >= 2 {
			break
		}

		log.Printf("Scraping %d/%d...", i+1, min(2, len(catalogURLs)))
		catalog, err := scrapeCatalogPages(ctx, url)
		if err != nil {
			log.Printf("Skip: %v", err)
			continue
		}

		newsletter, err := downloadCatalogImages(catalog)
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

func extractCatalogURLs(html string) []string {
	regex := regexp.MustCompile(`href="((?:https://www\.lidl\.ro)?/l/ro/cataloage/[^"]+)"`)
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

func scrapeCatalogPages(ctx context.Context, baseURL string) (ScrapedCatalog, error) {
	catalog := ScrapedCatalog{PageImages: []string{}}

	pattern := regexp.MustCompile(`perioada-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{4})`)
	if m := pattern.FindStringSubmatch(baseURL); len(m) > 5 {
		catalog.ValidFrom = fmt.Sprintf("%s-%s-%s", m[5], m[2], m[1])
		catalog.ValidUntil = fmt.Sprintf("%s-%s-%s", m[5], m[4], m[3])
		catalog.Title = fmt.Sprintf("Catalogul săptămânal pentru perioada %s.%s-%s.%s.%s",
			m[1], m[2], m[3], m[4], m[5])
	}

	for page := 1; page <= 30; page++ {
		var imageURL string
		err := chromedp.Run(ctx,
			chromedp.Navigate(fmt.Sprintf("%s/view/flyer/page/%d", baseURL, page)),
			chromedp.WaitVisible(`img[src*="imgproxy.leaflets.schwarz"]`, chromedp.ByQuery),
			chromedp.Evaluate(`document.querySelector('img[src*="imgproxy.leaflets.schwarz"]')?.src || ''`, &imageURL),
		)

		if err != nil || imageURL == "" {
			break
		}

		catalog.PageImages = append(catalog.PageImages, imageURL)
	}

	if len(catalog.PageImages) > 0 {
		catalog.CoverImage = catalog.PageImages[0]
	}

	log.Printf("Found %d pages", len(catalog.PageImages))
	return catalog, nil
}

func downloadCatalogImages(catalog ScrapedCatalog) (Newsletter, error) {
	id := fmt.Sprintf("lidl-%s", strings.ReplaceAll(catalog.ValidFrom, "-", ""))
	dir := filepath.Join("newsletters", id)
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
		if i >= 20 {
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
		Store:       "Lidl",
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
