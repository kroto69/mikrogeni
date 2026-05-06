package scheduler

import (
	"log"
	"time"

	"genieacs-backend/internal/db"
)

func StartHiosoHealthScheduler(checkFn func(deviceID string, host string, port uint16, community string, version string)) {
	go func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				log.Printf("[hioso-health-scheduler] panic recovered: %v", recovered)
				StartHiosoHealthScheduler(checkFn)
			}
		}()

		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()

		for range ticker.C {
			devices, err := db.ListHiosoOLTDevices()
			if err != nil {
				log.Printf("[hioso-health-scheduler] failed to list devices: %v", err)
				continue
			}

			for _, device := range devices {
				func(d db.HiosoOLTDeviceRecord) {
					defer func() {
						if recovered := recover(); recovered != nil {
							log.Printf("[hioso-health-scheduler] device panic recovered id=%s: %v", d.ID, recovered)
						}
					}()
					checkFn(d.ID, d.Host, uint16(d.Port), d.SNMPCommunity, d.SNMPVersion)
				}(device)
				time.Sleep(2 * time.Second)
			}

			log.Printf("[hioso-health-scheduler] checked %d devices", len(devices))
		}
	}()

	log.Printf("[hioso-health-scheduler] started, interval=5m")
}
