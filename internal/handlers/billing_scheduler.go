package handlers

import (
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"genieacs-backend/internal/db"
	"genieacs-backend/internal/services"
)

var billingSchedulersStartOnce sync.Once

const (
	defaultBillingRecurringInterval = time.Hour
	defaultBillingOverdueInterval   = 30 * time.Minute
)

func StartBillingSchedulersFromEnv() {
	billingSchedulersStartOnce.Do(func() {
		enabledRaw := strings.TrimSpace(os.Getenv("BILLING_ENABLED"))
		enabled, ok := parseBoolLike(enabledRaw)
		if !ok || !enabled {
			return
		}

		recurringInterval := resolveBillingIntervalEnv("BILLING_RECURRING_INTERVAL", defaultBillingRecurringInterval)
		overdueInterval := resolveBillingIntervalEnv("BILLING_OVERDUE_INTERVAL", defaultBillingOverdueInterval)

		go runBillingRecurringLoop(recurringInterval)
		go runBillingOverdueLoop(overdueInterval)

		log.Printf("[billing] schedulers started recurring=%s overdue=%s", recurringInterval, overdueInterval)
	})
}

func resolveBillingIntervalEnv(envKey string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(envKey))
	if raw == "" {
		return fallback
	}

	parsed, err := time.ParseDuration(raw)
	if err != nil || parsed <= 0 {
		log.Printf("[billing] invalid %s=%q, fallback to %s", envKey, raw, fallback)
		return fallback
	}

	return parsed
}

func runBillingRecurringLoop(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		if s, _ := db.GetSettings([]string{"billing_enabled"}); s["billing_enabled"] != "false" {
			if result, err := services.GetBillingService().GenerateRecurringInvoices(time.Now().UTC()); err != nil {
				log.Printf("[billing] recurring run failed: %v", err)
			} else {
				log.Printf("[billing] recurring run generated=%d skipped=%d errors=%d", result.Generated, result.Skipped, len(result.Errors))
			}
		}

		<-ticker.C
	}
}

func runBillingOverdueLoop(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		if s, _ := db.GetSettings([]string{"billing_enabled"}); s["billing_enabled"] != "false" {
			if result, err := services.GetBillingService().RunOverdueChecker(time.Now().UTC()); err != nil {
				log.Printf("[billing] overdue run failed: %v", err)
			} else {
				log.Printf("[billing] overdue run marked_overdue=%d suspended=%d errors=%d", result.MarkedOverdue, result.Suspended, len(result.Errors))
			}
		}

		<-ticker.C
	}
}
