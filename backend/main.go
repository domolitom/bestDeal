package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/mux"
)

// Newsletter represents a supermarket newsletter/catalog
type Newsletter struct {
	ID          string    `json:"id"`
	Store       string    `json:"store"`
	Title       string    `json:"title"`
	ValidFrom   string    `json:"validFrom"`
	ValidUntil  string    `json:"validUntil"`
	CoverImage  string    `json:"coverImage"`
	Pages       []Page    `json:"pages"`
	LastUpdated time.Time `json:"lastUpdated"`
}

// Page represents a single page of a newsletter
type Page struct {
	PageNumber int    `json:"pageNumber"`
	ImageURL   string `json:"imageUrl"`
}

var newsletters []Newsletter

func main() {
	// Create router
	r := mux.NewRouter()

	// API routes
	api := r.PathPrefix("/api").Subrouter()
	api.HandleFunc("/newsletters", getNewsletters).Methods("GET")
	api.HandleFunc("/newsletters/{id}", getNewsletter).Methods("GET")
	api.HandleFunc("/scrape/{store}", scrapeStore).Methods("POST")
	api.HandleFunc("/stores", getStores).Methods("GET")

	// Serve newsletter images
	r.PathPrefix("/newsletters/").Handler(http.StripPrefix("/newsletters/", http.FileServer(http.Dir("../newsletters"))))

	// Serve static files (frontend)
	r.PathPrefix("/").Handler(http.FileServer(http.Dir("../frontend")))

	// Enable CORS for development
	handler := enableCORS(r)

	// Start server
	port := ":8080"
	log.Printf("Server starting on http://localhost%s", port)
	log.Fatal(http.ListenAndServe(port, handler))
}

// API Handlers
func getNewsletters(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(newsletters)
}

func getNewsletter(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	for _, newsletter := range newsletters {
		if newsletter.ID == id {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(newsletter)
			return
		}
	}

	http.Error(w, "Newsletter not found", http.StatusNotFound)
}

func scrapeStore(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	configName := vars["store"]

	log.Printf("Starting scraper for config: %s", configName)

	// Run the scraper in a goroutine since it might take a while
	go func() {
		configPath := fmt.Sprintf("configs/%s.json", configName)
		err := ScrapeAndDownloadFromConfig(configPath)
		if err != nil {
			log.Printf("Error scraping with config %s: %v", configName, err)
			return
		}

		log.Printf("Successfully scraped with config %s", configName)
	}()

	// Return immediately to avoid timeout
	response := map[string]interface{}{
		"message": fmt.Sprintf("Scraping with config %s started in background. This may take a few minutes.", configName),
		"status":  "processing",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func getStores(w http.ResponseWriter, r *http.Request) {
	configs, err := ListAvailableConfigs()
	if err != nil {
		http.Error(w, "Error loading configs", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"configs": configs,
	})
}

func scrapeLidl(w http.ResponseWriter, r *http.Request) {
	// Legacy endpoint - redirect to generic scraper
	vars := map[string]string{"store": "lidl"}
	r = mux.SetURLVars(r, vars)
	scrapeStore(w, r)
}

// CORS middleware
func enableCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}
