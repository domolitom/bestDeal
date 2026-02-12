package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// ScraperConfig defines the configuration for a store scraper
type ScraperConfig struct {
	StoreName      string           `json:"storeName"`
	CatalogListURL string           `json:"catalogListUrl"`
	URLPattern     string           `json:"urlPattern"`
	PageURLPattern string           `json:"pageUrlPattern"` // e.g., "/ar/%d" or "/view/flyer/page/%d"
	PageIndexStart int              `json:"pageIndexStart"` // 0 for 0-indexed, 1 for 1-indexed
	Selectors      ScraperSelectors `json:"selectors"`
	WaitTime       int              `json:"waitTime"` // seconds
	MaxCatalogs    int              `json:"maxCatalogs"`
	MaxPages       int              `json:"maxPages"`
}

// ScraperSelectors defines CSS selectors and patterns for scraping
type ScraperSelectors struct {
	CatalogURLRegex   string `json:"catalogUrlRegex"`
	TitleSelector     string `json:"titleSelector"`
	DateFormat        string `json:"dateFormat"`
	PageImageRegex    string `json:"pageImageRegex"`
	PageImageSelector string `json:"pageImageSelector"` // JavaScript selector for finding page images
}

// LoadScraperConfig loads the scraper configuration for a specific store
func LoadScraperConfig(storeName string) (*ScraperConfig, error) {
	configPath := filepath.Join("configs", storeName+".json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, err
	}

	var config ScraperConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, err
	}

	return &config, nil
}

// ListAvailableStores returns all configured stores
func ListAvailableStores() ([]string, error) {
	files, err := os.ReadDir("configs")
	if err != nil {
		return nil, err
	}

	var stores []string
	for _, file := range files {
		if !file.IsDir() && filepath.Ext(file.Name()) == ".json" {
			storeName := file.Name()[:len(file.Name())-5] // remove .json
			stores = append(stores, storeName)
		}
	}

	return stores, nil
}
