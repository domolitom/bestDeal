package main

import (
	"encoding/json"
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
	// Load newsletters from file, or initialize with sample data
	var err error
	newsletters, err = loadNewslettersFromFile()
	if err != nil {
		log.Printf("Error loading newsletters: %v", err)
		initializeSampleData()
	} else if len(newsletters) == 0 {
		initializeSampleData()
	}

	// Create router
	r := mux.NewRouter()

	// API routes
	api := r.PathPrefix("/api").Subrouter()
	api.HandleFunc("/newsletters", getNewsletters).Methods("GET")
	api.HandleFunc("/newsletters/{id}", getNewsletter).Methods("GET")
	api.HandleFunc("/scrape/lidl", scrapeLidl).Methods("POST")

	// Serve newsletter images
	r.PathPrefix("/newsletters/").Handler(http.StripPrefix("/newsletters/", http.FileServer(http.Dir("./newsletters"))))

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

func scrapeLidl(w http.ResponseWriter, r *http.Request) {
	// Scrape Lidl Romania catalogs and download images
	log.Println("Starting Lidl scraper and downloader...")

	// Run the scraper in a goroutine since it might take a while
	go func() {
		scrapedNewsletters, err := ScrapeAndDownloadLidl()
		if err != nil {
			log.Printf("Error scraping Lidl: %v", err)
			return
		}

		// Update the global newsletters
		if len(scrapedNewsletters) > 0 {
			newsletters = scrapedNewsletters
			log.Printf("Successfully updated %d newsletters", len(scrapedNewsletters))
		}
	}()

	// Return immediately to avoid timeout
	response := map[string]interface{}{
		"message": "Scraping started in background. This may take a few minutes.",
		"status":  "processing",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// Initialize with sample data based on Lidl Romania
func initializeSampleData() {
	newsletters = []Newsletter{
		{
			ID:         "lidl-2024-02-09",
			Store:      "Lidl",
			Title:      "Catalogul săptămânal pentru perioada 09.02-15.02.2026",
			ValidFrom:  "2026-02-09",
			ValidUntil: "2026-02-15",
			CoverImage: "https://imgproxy.leaflets.schwarz/IUn0tdP5z4dbGegAFQ81ZrhvCYiUc1mkcrHrr7YNpvE/rs:fit:400:400:1/g:no/czM6Ly9sZWFmbGV0cy9pbWFnZXMvMDE5YzBmNzQtNTQ2Mi03ZmVmLWE2OGUtMmQ3MTlkM2U5MWU2L3BhZ2UtMDFfMDk1ODg5ZGViZGQxOTFiZDVlMDhmM2VjNzFlYTNhM2YucG5n.jpg",
			Pages: []Page{
				{PageNumber: 1, ImageURL: "https://imgproxy.leaflets.schwarz/IUn0tdP5z4dbGegAFQ81ZrhvCYiUc1mkcrHrr7YNpvE/rs:fit:800:800:1/g:no/czM6Ly9sZWFmbGV0cy9pbWFnZXMvMDE5YzBmNzQtNTQ2Mi03ZmVmLWE2OGUtMmQ3MTlkM2U5MWU2L3BhZ2UtMDFfMDk1ODg5ZGViZGQxOTFiZDVlMDhmM2VjNzFlYTNhM2YucG5n.jpg"},
				{PageNumber: 2, ImageURL: "https://via.placeholder.com/800x1200/0050AA/FFFFFF?text=Page+2"},
				{PageNumber: 3, ImageURL: "https://via.placeholder.com/800x1200/0050AA/FFFFFF?text=Page+3"},
				{PageNumber: 4, ImageURL: "https://via.placeholder.com/800x1200/0050AA/FFFFFF?text=Page+4"},
			},
			LastUpdated: time.Now(),
		},
		{
			ID:         "lidl-2024-02-02",
			Store:      "Lidl",
			Title:      "Catalogul săptămânal pentru perioada 02.02-08.02.2026",
			ValidFrom:  "2026-02-02",
			ValidUntil: "2026-02-08",
			CoverImage: "https://imgproxy.leaflets.schwarz/M2tmlYyoczVIJPHXvI18R961hXrssjlhAt1txtEgJes/rs:fit:400:400:1/g:no/czM6Ly9sZWFmbGV0cy9pbWFnZXMvMDE5YmY5NzUtYTIzYy03ZTU1LWJkZWEtMjAxMzE3ZWM5NzE1L3BhZ2UtMDFfZjRmMjU5YjBmNzVmMTA5OGFhOThjNTE4YzRlZWEwMDQucG5n.jpg",
			Pages: []Page{
				{PageNumber: 1, ImageURL: "https://imgproxy.leaflets.schwarz/M2tmlYyoczVIJPHXvI18R961hXrssjlhAt1txtEgJes/rs:fit:800:800:1/g:no/czM6Ly9sZWFmbGV0cy9pbWFnZXMvMDE5YmY5NzUtYTIzYy03ZTU1LWJkZWEtMjAxMzE3ZWM5NzE1L3BhZ2UtMDFfZjRmMjU5YjBmNzVmMTA5OGFhOThjNTE4YzRlZWEwMDQucG5n.jpg"},
				{PageNumber: 2, ImageURL: "https://via.placeholder.com/800x1200/0050AA/FFFFFF?text=Page+2"},
			},
			LastUpdated: time.Now(),
		},
	}
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
