package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/go-chi/chi/v5"
	"github.com/joho/godotenv"

	"genieacs-backend/internal/auth"
	"genieacs-backend/internal/db"
	"genieacs-backend/internal/handlers"
	"genieacs-backend/internal/middleware"
)

func main() {
	// Muat environment variables dari file .env
	godotenv.Load()

	// Konfigurasi server
	port := os.Getenv("PORT")
	if port == "" {
		port = "1997"
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		log.Fatal("JWT_SECRET wajib diset di environment")
	}

	jwtExpiresIn := os.Getenv("JWT_EXPIRES_IN")
	if jwtExpiresIn == "" {
		jwtExpiresIn = "1h"
	}

	refreshTokenExpiresIn := os.Getenv("REFRESH_TOKEN_EXPIRES_IN")
	if refreshTokenExpiresIn == "" {
		refreshTokenExpiresIn = "168h"
	}

	// Inisialisasi database SQLite
	dbPath := filepath.Join(".", "database.sqlite")
	database, err := db.Init(dbPath)
	if err != nil {
		log.Fatalf("Gagal inisialisasi database: %v", err)
	}
	defer database.Close()

	// Inisialisasi auth (JWT)
	if err := auth.Init(jwtSecret, jwtExpiresIn, refreshTokenExpiresIn); err != nil {
		log.Fatalf("Gagal inisialisasi auth: %v", err)
	}

	// Jalankan background services
	handlers.StartTelegramBotFromEnv()
	handlers.StartACSAutoRefreshFromEnv()
	handlers.StartBillingSchedulersFromEnv()

	// Buat router chi
	r := chi.NewRouter()

	// Global middleware
	r.Use(middleware.CORSMiddleware)
	r.Use(middleware.JSONContentType)
	r.Use(middleware.RateLimitMiddleware)

	// ─── Public routes (tanpa auth) ───────────────────────────────────────────
	r.Post("/api/login", handlers.Login)
	r.Get("/api/health", handlers.HealthCheck)

	// ─── Protected routes (wajib JWT) ─────────────────────────────────────────
	r.Group(func(r chi.Router) {
		r.Use(middleware.AuthenticateToken)

		// ── ACS / GenieACS ──────────────────────────────────────────────────
		r.Route("/api/acs", func(r chi.Router) {
			// Device
			r.Get("/devices", handlers.GetDevices)
			r.Get("/devices/{id}", handlers.GetDeviceDetail)
			r.Post("/devices/refresh", handlers.RefreshACSDevices)
			r.Post("/devices/{id}/reboot", handlers.RebootDevice)
			r.Post("/devices/{id}/config/wifi", handlers.ConfigureDeviceWiFi)
			r.Post("/devices/{id}/config/wan", handlers.ConfigureDeviceWAN)
			r.Post("/devices/{id}/config/security", handlers.ConfigureDeviceSecurity)
			r.Post("/devices/{id}/config/parameters", handlers.ConfigureDeviceParameters)
			r.Get("/tasks/{id}", handlers.GetTaskStatus)

			// Dashboard
			r.Get("/dashboard", handlers.GetDashboard)

			// Settings
			r.Get("/settings", handlers.GetSettings)
			r.Get("/settings/hioso-olts", handlers.GetHiosoOLTProfiles)
			r.Post("/settings/hioso-olts", handlers.CreateHiosoOLTProfile)
			r.Patch("/settings/hioso-olts/{id}", handlers.UpdateHiosoOLTProfile)
			r.Delete("/settings/hioso-olts/{id}", handlers.DeleteHiosoOLTProfile)
			r.Post("/settings/hioso-olts/{id}/activate", handlers.ActivateHiosoOLTProfile)
			r.Get("/settings/acs-learned-profiles", handlers.GetACSLearnedProfiles)
			r.Post("/settings/acs-learned-profiles", handlers.UpsertACSLearnedProfile)
			r.Delete("/settings/acs-learned-profiles", handlers.DeleteACSLearnedProfile)
			r.Post("/settings", handlers.UpdateSetting)

			// User Management
			r.Get("/users", handlers.GetUsers)
			r.Post("/users", handlers.CreateUser)
			r.Patch("/users/{id}", handlers.UpdateUser)
			r.Delete("/users/{id}", handlers.DeleteUser)

			// Vendor & Tag
			r.Get("/vendors", handlers.GetVendors)
			r.Post("/vendors", handlers.CreateVendor)
			r.Get("/tags", handlers.GetTags)
			r.Post("/tags", handlers.CreateTag)

			// Bulk config
			r.Post("/config/wifi", handlers.ConfigureWiFi)
			r.Post("/config/wan", handlers.ConfigureWAN)
			r.Post("/config/security", handlers.ConfigureSecurity)

			// Monitoring
			r.Get("/check/wan", handlers.CheckWAN)
			r.Get("/check/gpon-epon", handlers.CheckGPONEPON)
			r.Get("/faults", handlers.GetFaults)
			r.Delete("/faults/{id}", handlers.DeleteFault)

			// Portal & Search
			r.Post("/portal/validate-accesscode", handlers.ValidateAccessCode)
			r.Get("/search", handlers.SearchDevice)
		})

		// ── MikroTik ────────────────────────────────────────────────────────
		r.Route("/api/mikrotik", func(r chi.Router) {
			r.Get("/devices", handlers.GetMikroTikDevices)
			r.Post("/devices", handlers.CreateMikroTikDevice)
			r.Get("/devices/{device_id}", handlers.GetMikroTikDevice)
			r.Patch("/devices/{device_id}", handlers.UpdateMikroTikDevice)
			r.Delete("/devices/{device_id}", handlers.DeleteMikroTikDevice)
			r.Post("/devices/{device_id}/test-connection", handlers.TestMikroTikConnection)
			r.Post("/devices/{device_id}/sync", handlers.SyncMikroTikDevice)

			// Interfaces
			r.Get("/devices/{device_id}/interfaces", handlers.GetMikroTikInterfaces)
			r.Get("/devices/{device_id}/interfaces/{interface_id}/traffic", handlers.GetMikroTikInterfaceTraffic)
			r.Patch("/devices/{device_id}/interfaces/{interface_id}", handlers.UpdateMikroTikInterface)

			// PPP Active
			r.Get("/devices/{device_id}/ppp/active", handlers.GetMikroTikPPPActive)
			r.Delete("/devices/{device_id}/ppp/active/{session_id}", handlers.KickMikroTikPPPActive)
			r.Post("/devices/{device_id}/ppp/active/kick", handlers.KickMikroTikPPPActiveBulk)

			// PPP Secrets
			r.Get("/devices/{device_id}/ppp/secrets", handlers.GetMikroTikPPPSecrets)
			r.Post("/devices/{device_id}/ppp/secrets", handlers.CreateMikroTikPPPSecret)
			r.Patch("/devices/{device_id}/ppp/secrets/{secret_id}", handlers.UpdateMikroTikPPPSecret)
			r.Delete("/devices/{device_id}/ppp/secrets/{secret_id}", handlers.DeleteMikroTikPPPSecret)

			// PPP Profiles
			r.Get("/devices/{device_id}/ppp/profiles", handlers.GetMikroTikPPPProfiles)
			r.Post("/devices/{device_id}/ppp/profiles", handlers.CreateMikroTikPPPProfile)
			r.Patch("/devices/{device_id}/ppp/profiles/{profile_id}", handlers.UpdateMikroTikPPPProfile)
			r.Delete("/devices/{device_id}/ppp/profiles/{profile_id}", handlers.DeleteMikroTikPPPProfile)

			// Bulk & Tasks
			r.Post("/bulk/jobs", handlers.CreateMikroTikBulkJob)
			r.Get("/tasks/{id}", handlers.GetTaskStatus)
		})

		// ── Billing ─────────────────────────────────────────────────────────
		r.Route("/api/billing", func(r chi.Router) {
			r.Get("/service-plans", handlers.GetBillingServicePlans)
			r.Post("/service-plans", handlers.CreateBillingServicePlan)

			r.Get("/customers", handlers.GetBillingCustomers)
			r.Post("/customers", handlers.CreateBillingCustomer)

			r.Get("/invoices", handlers.GetBillingInvoices)
			r.Post("/invoices/{invoice_id}/payments", handlers.CreateBillingPayment)

			r.Get("/payments", handlers.GetBillingPayments)

			r.Post("/jobs/recurring/run", handlers.RunRecurringBillingNow)
			r.Post("/jobs/overdue/run", handlers.RunOverdueCheckerNow)
		})

		// ── Plugin: Hioso OLT ────────────────────────────────────────────────
		// Handler diimplementasi di internal/handlers/hioso_plugin.go
		r.Route("/api/plugin/hioso", func(r chi.Router) {
			// Tetap eksplisit sesuai kontrak plugin, walau sudah berada di protected group.
			r.Use(middleware.AuthenticateToken)

			// Plugin control (enable/disable tanpa restart)
			r.Get("/status", handlers.HiosoStatusHandler)
			r.Post("/enable", handlers.HiosoEnableHandler)
			r.Post("/disable", handlers.HiosoDisableHandler)

			// OLT health check
			r.Get("/health", handlers.HiosoHealthHandler)

			// ONU data & aksi
			r.Get("/onu", handlers.HiosoFetchAllHandler)
			r.Get("/onu/{index}", handlers.HiosoDetailHandler)
			r.Post("/onu/{index}/rename", handlers.HiosoRenameHandler)
			r.Post("/onu/{index}/reboot", handlers.HiosoRebootHandler)

			// Port list
			r.Get("/ports", handlers.HiosoPortsHandler)
		})

		})

	// Jalankan server
	addr := fmt.Sprintf(":%s", port)
	log.Printf("✓ Server mikrogeni berjalan di http://localhost:%s", port)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
