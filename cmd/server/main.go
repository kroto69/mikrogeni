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
	"genieacs-backend/internal/scheduler"
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
	scheduler.StartACSOfflineSummonScheduler()
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
			r.With(middleware.RequireRole("admin")).Post("/devices/{id}/reboot", handlers.RebootDevice)
			r.With(middleware.RequireRole("admin")).Post("/devices/{id}/config/wifi", handlers.ConfigureDeviceWiFi)
			r.With(middleware.RequireRole("admin")).Post("/devices/{id}/config/wan", handlers.ConfigureDeviceWAN)
			r.With(middleware.RequireRole("admin")).Post("/devices/{id}/config/security", handlers.ConfigureDeviceSecurity)
			r.With(middleware.RequireRole("admin")).Post("/devices/{id}/config/parameters", handlers.ConfigureDeviceParameters)
			r.Get("/tasks/{id}", handlers.GetTaskStatus)

			// Dashboard
			r.Get("/dashboard", handlers.GetDashboard)

			// Settings (admin-only)
			r.Route("/settings", func(r chi.Router) {
				r.Use(middleware.RequireRole("admin"))
				r.Get("/", handlers.GetSettings)
				r.Get("/hioso-olts", handlers.GetHiosoOLTProfiles)
				r.Post("/hioso-olts", handlers.CreateHiosoOLTProfile)
				r.Patch("/hioso-olts/{id}", handlers.UpdateHiosoOLTProfile)
				r.Delete("/hioso-olts/{id}", handlers.DeleteHiosoOLTProfile)
				r.Post("/hioso-olts/{id}/activate", handlers.ActivateHiosoOLTProfile)
				r.Get("/acs-learned-profiles", handlers.GetACSLearnedProfiles)
				r.Post("/acs-learned-profiles", handlers.UpsertACSLearnedProfile)
				r.Delete("/acs-learned-profiles", handlers.DeleteACSLearnedProfile)
				r.Post("/", handlers.UpdateSetting)
			})

			// User Management (admin-only)
			r.Route("/users", func(r chi.Router) {
				r.Use(middleware.RequireRole("admin"))
				r.Get("/", handlers.GetUsers)
				r.Post("/", handlers.CreateUser)
				r.Patch("/{id}", handlers.UpdateUser)
				r.Delete("/{id}", handlers.DeleteUser)
			})

			// Vendor & Tag
			r.Get("/vendors", handlers.GetVendors)
			r.With(middleware.RequireRole("admin")).Post("/vendors", handlers.CreateVendor)
			r.Get("/tags", handlers.GetTags)
			r.With(middleware.RequireRole("admin")).Post("/tags", handlers.CreateTag)

			// Bulk config (admin-only)
			r.With(middleware.RequireRole("admin")).Post("/config/wifi", handlers.ConfigureWiFi)
			r.With(middleware.RequireRole("admin")).Post("/config/wan", handlers.ConfigureWAN)
			r.With(middleware.RequireRole("admin")).Post("/config/security", handlers.ConfigureSecurity)

			// Monitoring
			r.Get("/check/wan", handlers.CheckWAN)
			r.Get("/check/gpon-epon", handlers.CheckGPONEPON)
			r.Get("/faults", handlers.GetFaults)
			r.With(middleware.RequireRole("admin")).Delete("/faults/{id}", handlers.DeleteFault)

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

			// PPP Secrets (write: admin-only)
			r.Get("/devices/{device_id}/ppp/secrets", handlers.GetMikroTikPPPSecrets)
			r.With(middleware.RequireRole("admin")).Post("/devices/{device_id}/ppp/secrets", handlers.CreateMikroTikPPPSecret)
			r.With(middleware.RequireRole("admin")).Patch("/devices/{device_id}/ppp/secrets/{secret_id}", handlers.UpdateMikroTikPPPSecret)
			r.With(middleware.RequireRole("admin")).Delete("/devices/{device_id}/ppp/secrets/{secret_id}", handlers.DeleteMikroTikPPPSecret)

			// PPP Profiles (write: admin-only)
			r.Get("/devices/{device_id}/ppp/profiles", handlers.GetMikroTikPPPProfiles)
			r.With(middleware.RequireRole("admin")).Post("/devices/{device_id}/ppp/profiles", handlers.CreateMikroTikPPPProfile)
			r.With(middleware.RequireRole("admin")).Patch("/devices/{device_id}/ppp/profiles/{profile_id}", handlers.UpdateMikroTikPPPProfile)
			r.With(middleware.RequireRole("admin")).Delete("/devices/{device_id}/ppp/profiles/{profile_id}", handlers.DeleteMikroTikPPPProfile)

			// Bulk & Tasks
			r.Post("/bulk/jobs", handlers.CreateMikroTikBulkJob)
			r.Get("/tasks/{id}", handlers.GetTaskStatus)
		})

		// ── Billing (admin-only) ──────────────────────────────────────────
		r.Route("/api/billing", func(r chi.Router) {
			r.Use(middleware.RequireRole("admin"))
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
		r.Route("/api/plugin/hioso", func(r chi.Router) {
			// Plugin control (enable/disable tanpa restart)
			r.Get("/status", handlers.HiosoStatusHandler)
			r.Post("/enable", handlers.HiosoEnableHandler)
			r.Post("/disable", handlers.HiosoDisableHandler)

			// OLT device CRUD
			r.Get("/devices", handlers.HiosoListDevicesHandler)
			r.Post("/devices", handlers.HiosoCreateDeviceHandler)
			r.Get("/devices/{device_id}", handlers.HiosoGetDeviceHandler)
			r.Patch("/devices/{device_id}", handlers.HiosoUpdateDeviceHandler)
			r.Delete("/devices/{device_id}", handlers.HiosoDeleteDeviceHandler)
			r.Post("/devices/{device_id}/test", handlers.HiosoTestDeviceHandler)

			// Per-device ONU data & actions
			r.Get("/devices/{device_id}/onu", handlers.HiosoFetchAllHandler)
			r.Get("/devices/{device_id}/onu/{index}", handlers.HiosoDetailHandler)
			r.Post("/devices/{device_id}/onu/{index}/rename", handlers.HiosoRenameHandler)
			r.Post("/devices/{device_id}/onu/{index}/reboot", handlers.HiosoRebootHandler)
			r.Get("/devices/{device_id}/health", handlers.HiosoHealthHandler)
			r.Get("/devices/{device_id}/ports", handlers.HiosoPortsHandler)
		})

// ZTE Plugin routes
	r.Route("/api/zte", func(r chi.Router) {
   			r.Post("/connections/test", handlers.TestZTEConnection)
    		r.Get("/connections", handlers.ListZTEConnections)
    		r.With(middleware.RequireRole("admin")).Post("/connections", handlers.CreateZTEConnection)
   		r.With(middleware.RequireRole("admin")).Patch("/connections/{id}", handlers.UpdateZTEConnection)
    		r.With(middleware.RequireRole("admin")).Delete("/connections/{id}", handlers.DeleteZTEConnection)
    		r.Post("/connections/{id}/health", handlers.HealthCheckZTE)
		})
r.HandleFunc("/api/zte/olt/{connId}/*", handlers.ForwardZTEProxy)

		})

	// Jalankan server
	addr := fmt.Sprintf(":%s", port)
	log.Printf("✓ Server mikrogeni berjalan di http://localhost:%s", port)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
