package handlers

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"net"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gosnmp/gosnmp"
)

type SNMPTarget struct {
	Host      string
	Port      uint16
	Community string
	Version   gosnmp.SnmpVersion
}

type HiosoONU struct {
	Index   string  `json:"index"`
	WebID   string  `json:"web_id"`
	Port    int     `json:"port"`
	ONUID   int     `json:"onu_id"`
	Name    string  `json:"name"`
	SN      string  `json:"sn"`
	Status  string  `json:"status"`
	TxPower float64 `json:"tx_power"`
	RxPower float64 `json:"rx_power"`
	Profile string  `json:"profile"`
}

type hiosoOIDProfile struct {
	Name    string
	NameOID string
	SNOID   string
	StatOID string
	TxOID   string
	RxOID   string
	Divider float64
}

type hiosoProfileCacheEntry struct {
	profile   *hiosoOIDProfile
	expiresAt time.Time
}

var hiosoProfileCache sync.Map

type portCacheEntry struct {
	onus     []HiosoONU
	profile  string
	cachedAt time.Time
}

var hiosoPortCache sync.Map // key: "host:community:port"
const hiosoPortCacheTTL = 20 * time.Second

var hiosoProfiles = []hiosoOIDProfile{
	{
		Name:    "HIOSO_GPON",
		NameOID: ".1.3.6.1.4.1.25355.3.3.1.1.1.2",
		SNOID:   ".1.3.6.1.4.1.25355.3.3.1.1.1.5",
		StatOID: ".1.3.6.1.4.1.25355.3.3.1.1.1.11",
		TxOID:   ".1.3.6.1.4.1.25355.3.3.1.1.4.1.2",
		RxOID:   ".1.3.6.1.4.1.25355.3.3.1.1.4.1.1",
		Divider: 100,
	},
	{
		Name:    "HIOSO_B",
		NameOID: ".1.3.6.1.4.1.3320.101.10.1.1.79",
		SNOID:   ".1.3.6.1.4.1.3320.101.10.1.1.3",
		StatOID: ".1.3.6.1.4.1.3320.101.10.1.1.26",
		TxOID:   ".1.3.6.1.4.1.3320.101.10.5.1.5",
		RxOID:   ".1.3.6.1.4.1.3320.101.10.5.1.6",
		Divider: 10,
	},
	{
		Name:    "HIOSO_C",
		NameOID: ".1.3.6.1.4.1.25355.3.2.6.3.2.1.37",
		SNOID:   ".1.3.6.1.4.1.25355.3.2.6.3.2.1.11",
		StatOID: ".1.3.6.1.4.1.25355.3.2.6.3.2.1.39",
		TxOID:   ".1.3.6.1.4.1.25355.3.2.6.14.2.1.4",
		RxOID:   ".1.3.6.1.4.1.25355.3.2.6.14.2.1.8",
		Divider: 1,
	},
	{
		Name:    "HIOSO_HA73",
		NameOID: ".1.3.6.1.4.1.34592.1.3.100.12.1.1.2",
		SNOID:   "",
		StatOID: ".1.3.6.1.4.1.34592.1.3.100.12.1.1.5",
		TxOID:   ".1.3.6.1.4.1.34592.1.3.100.12.1.1.13",
		RxOID:   ".1.3.6.1.4.1.34592.1.3.100.12.1.1.14",
		Divider: 10,
	},
}

var hiosoSNFallbacks = []string{
	".1.3.6.1.4.1.25355.3.2.10.1.1.2",
	".1.3.6.1.4.1.25355.3.2.1.2.1.2",
	".1.3.6.1.4.1.25355.3.2.6.1.1.18",
	".1.3.6.1.4.1.25355.3.2.6.3.2.1.12",
	".1.3.6.1.4.1.25355.3.2.6.1.1.2.1.6",
	".1.3.6.1.4.1.25355.3.3.1.1.1.5",
	".1.3.6.1.4.1.3320.101.10.1.1.3",
}

var hiosoStatusKeywords = []string{
	"Registered", "Offline", "Active", "Online", "Down", "Up", "Power", "Alarm",
}

var hiosoSignalRegex = regexp.MustCompile(`[-+]?\d*\.?\d+`)
var hiosoHexPairRegex = regexp.MustCompile(`(?i)^(?:[0-9a-f]{2}\s+){5}[0-9a-f]{2}$`)
var hiosoHex12Regex = regexp.MustCompile(`(?i)^[0-9a-f]{12}$`)
var hiosoHex16Regex = regexp.MustCompile(`(?i)^[0-9a-f]{16}$`)
var hiosoGponSNRegex = regexp.MustCompile(`^[A-Za-z0-9]{4}\d{8}$`)

func hiosoNewSNMPClient(target SNMPTarget, timeout time.Duration) *gosnmp.GoSNMP {
	return &gosnmp.GoSNMP{
		Target:         target.Host,
		Port:           target.Port,
		Community:      target.Community,
		Version:        target.Version,
		Timeout:        timeout,
		Retries:        2,
		MaxRepetitions: 50,
	}
}

func hiosoParseSNMPPort(raw string) uint16 {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 161
	}

	port, err := strconv.Atoi(trimmed)
	if err != nil || port < 1 || port > 65535 {
		return 161
	}

	return uint16(port)
}

func hiosoParseSNMPVersion(raw string) gosnmp.SnmpVersion {
	version := strings.ToLower(strings.TrimSpace(raw))
	switch version {
	case "1", "v1":
		return gosnmp.Version1
	case "2", "2c", "v2", "v2c", "":
		return gosnmp.Version2c
	default:
		return gosnmp.Version2c
	}
}

func hiosoResolveSNMPTarget(rawHost, rawPort string) (string, uint16, error) {
	host := strings.TrimSpace(rawHost)
	port := hiosoParseSNMPPort(rawPort)
	if host == "" {
		return "", 0, errors.New("host SNMP tidak valid")
	}

	if strings.HasPrefix(host, "http://") || strings.HasPrefix(host, "https://") {
		if parsed, err := url.Parse(host); err == nil && parsed.Host != "" {
			host = parsed.Host
		}
	}

	if splitHost, splitPort, err := net.SplitHostPort(host); err == nil {
		host = splitHost
		if parsedPort, parseErr := strconv.Atoi(splitPort); parseErr == nil && parsedPort >= 1 && parsedPort <= 65535 {
			port = uint16(parsedPort)
		}
	}

	host = strings.TrimSpace(strings.Trim(host, "[]"))
	if host == "" {
		return "", 0, errors.New("host SNMP tidak valid")
	}

	return host, port, nil
}

func hiosoEnsureScalarOID(oid string) string {
	trimmed := strings.TrimPrefix(strings.TrimSpace(oid), ".")
	if trimmed == "" {
		return ""
	}
	if strings.HasSuffix(trimmed, ".0") {
		return "." + trimmed
	}
	return "." + trimmed + ".0"
}

func hiosoHasMeaningfulSNMPValues(values map[string]string) bool {
	for _, raw := range values {
		if hiosoIsMeaningfulSNMPValue(raw) {
			return true
		}
	}

	return false
}

func hiosoIsMeaningfulSNMPValue(raw string) bool {
	value := strings.ToLower(strings.TrimSpace(raw))
	if value == "" {
		return false
	}
	if strings.Contains(value, "no such") || strings.Contains(value, "end of mib") {
		return false
	}

	return true
}

func hiosoFindProfileByName(name string) *hiosoOIDProfile {
	needle := strings.TrimSpace(strings.ToUpper(name))
	if needle == "" {
		return nil
	}

	for i := range hiosoProfiles {
		if strings.ToUpper(strings.TrimSpace(hiosoProfiles[i].Name)) == needle {
			profile := hiosoProfiles[i]
			return &profile
		}
	}

	return nil
}

// hiosoGetOrDetectProfile returns cached profile for host:community if valid,
// otherwise detects via SNMP and caches for 30 minutes.
func hiosoGetOrDetectProfile(target SNMPTarget) (*hiosoOIDProfile, error) {
	key := target.Host + ":" + target.Community
	if cached, ok := hiosoProfileCache.Load(key); ok {
		entry := cached.(*hiosoProfileCacheEntry)
		if time.Now().Before(entry.expiresAt) {
			return entry.profile, nil
		}
		hiosoProfileCache.Delete(key)
	}

	profile, err := hiosoDetectProfile(target)
	if err != nil {
		return nil, err
	}

	hiosoProfileCache.Store(key, &hiosoProfileCacheEntry{
		profile:   profile,
		expiresAt: time.Now().Add(30 * time.Minute),
	})
	return profile, nil
}

func hiosoDetectProfile(target SNMPTarget) (*hiosoOIDProfile, error) {
	type profileResult struct {
		profile *hiosoOIDProfile
		score   int
	}

	results := make([]profileResult, len(hiosoProfiles))
	var wg sync.WaitGroup

	for i := range hiosoProfiles {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			p := hiosoProfiles[idx]
			score := 0

			if values, err := hiosoSNMPWalk(target, p.NameOID); err == nil && hiosoHasMeaningfulSNMPValues(values) {
				score += 3
			}
			if values, err := hiosoSNMPWalk(target, p.SNOID); err == nil && hiosoHasMeaningfulSNMPValues(values) {
				score += 2
			}
			if values, err := hiosoSNMPWalk(target, p.StatOID); err == nil && hiosoHasMeaningfulSNMPValues(values) {
				score += 1
			}

			copyProfile := p
			results[idx] = profileResult{profile: &copyProfile, score: score}
		}(i)
	}
	wg.Wait()

	var best *hiosoOIDProfile
	bestScore := 0
	for _, r := range results {
		if r.score > bestScore {
			best = r.profile
			bestScore = r.score
		}
	}

	if best != nil && bestScore > 0 {
		return best, nil
	}

	if inferred := hiosoInferProfileFromSystemInfo(target); inferred != nil {
		return inferred, nil
	}

	return nil, errors.New("OLT tidak dikenali sebagai Hioso")
}

func hiosoInferProfileFromSystemInfo(target SNMPTarget) *hiosoOIDProfile {
	sysObjectValues, _ := hiosoSNMPWalk(target, ".1.3.6.1.2.1.1.2.0")
	sysDescrValues, _ := hiosoSNMPWalk(target, ".1.3.6.1.2.1.1.1.0")

	inferredName := hiosoInferProfileNameFromSystemText(
		strings.ToLower(strings.Join(mapsValues(sysObjectValues), " ")),
		strings.ToLower(strings.Join(mapsValues(sysDescrValues), " ")),
	)
	if inferredName != "" {
		return hiosoFindProfileByName(inferredName)
	}

	return nil
}

func hiosoInferProfileNameFromSystemText(sysObjectText, sysDescrText string) string {
	sysObjectText = strings.ToLower(strings.TrimSpace(sysObjectText))
	sysDescrText = strings.ToLower(strings.TrimSpace(sysDescrText))

	if strings.Contains(sysObjectText, ".1.3.6.1.4.1.3320") {
		return "HIOSO_B"
	}
	if strings.Contains(sysObjectText, ".1.3.6.1.4.1.25355.3.3") {
		return "HIOSO_GPON"
	}
	if strings.Contains(sysObjectText, ".1.3.6.1.4.1.25355") {
		return "HIOSO_C"
	}

	if strings.Contains(sysDescrText, "hioso") {
		if strings.Contains(sysDescrText, "gpon") {
			return "HIOSO_GPON"
		}
		if strings.Contains(sysDescrText, "epon") {
			return "HIOSO_C"
		}
	}

	return ""
}

func mapsValues(data map[string]string) []string {
	if len(data) == 0 {
		return nil
	}

	result := make([]string, 0, len(data))
	for _, value := range data {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		result = append(result, trimmed)
	}

	return result
}

// hiosoSNMPWalk melakukan SNMP walk dan mengembalikan map index→value string.
func hiosoSNMPWalk(target SNMPTarget, oid string) (map[string]string, error) {
	baseOID := strings.TrimSpace(oid)
	if baseOID == "" {
		return nil, errors.New("OID kosong")
	}

	client := hiosoNewSNMPClient(target, 5*time.Second)
	if err := client.Connect(); err != nil {
		return nil, fmt.Errorf("gagal konek SNMP ke %s: %w", target.Host, err)
	}
	defer client.Conn.Close()

	results := make(map[string]string)
	walkHandler := func(pdu gosnmp.SnmpPDU) error {
		index := hiosoExtractIndex(pdu.Name, baseOID)
		if index == "" {
			trimmed := strings.TrimPrefix(strings.TrimPrefix(pdu.Name, "."), strings.TrimPrefix(baseOID, ".")+".")
			if trimmed != "" {
				index = trimmed
			} else {
				index = strings.TrimPrefix(pdu.Name, ".")
			}
		}
		results[index] = hiosoPDUToString(pdu)
		return nil
	}

	walkErr := client.BulkWalk(baseOID, walkHandler)
	if walkErr != nil {
		walkErr = client.Walk(baseOID, walkHandler)
	}

	if len(results) == 0 {
		scalarOID := hiosoEnsureScalarOID(baseOID)
		if scalarOID != "" {
			if packet, getErr := client.Get([]string{scalarOID}); getErr == nil && packet != nil && len(packet.Variables) > 0 {
				for _, variable := range packet.Variables {
					results["0"] = hiosoPDUToString(variable)
				}
				walkErr = nil
			}
		}
	}

	if walkErr != nil && len(results) == 0 {
		return nil, fmt.Errorf("SNMP walk gagal oid=%s: %w", baseOID, walkErr)
	}

	return results, nil
}

// hiosoSNMPSet melakukan SNMP SET OctetString ke OID target.
func hiosoSNMPSet(target SNMPTarget, oid, value string) error {
	oid = strings.TrimSpace(oid)
	if oid == "" {
		return errors.New("OID kosong")
	}

	client := hiosoNewSNMPClient(target, 3*time.Second)
	if err := client.Connect(); err != nil {
		return fmt.Errorf("gagal konek SNMP set ke %s: %w", target.Host, err)
	}
	defer client.Conn.Close()

	resp, err := client.Set([]gosnmp.SnmpPDU{{
		Name:  oid,
		Type:  gosnmp.OctetString,
		Value: value,
	}})
	if err != nil {
		return fmt.Errorf("SNMP set gagal: %w", err)
	}
	if resp == nil {
		return errors.New("SNMP set gagal: response nil")
	}
	if resp.Error != gosnmp.NoError {
		return fmt.Errorf("SNMP set ditolak agent: %s (index=%d)", resp.Error, resp.ErrorIndex)
	}

	return nil
}

// FetchAllONU mengambil daftar ONU dari OLT menggunakan parallel SNMP walk.
// Hanya dijalankan saat request (on-demand), bukan polling.
func FetchAllONU(ctx context.Context, target SNMPTarget) ([]HiosoONU, string, error) {
	profile, err := hiosoGetOrDetectProfile(target)
	if err != nil {
		return nil, "", err
	}

	if ctx.Err() != nil {
		return nil, "", ctx.Err()
	}

	var (
		names    map[string]string
		sns      map[string]string
		statuses map[string]string
		txValues map[string]string
		rxValues map[string]string
		nameErr  error
	)

	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		names, nameErr = hiosoSNMPWalk(target, profile.NameOID)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		sns, _ = hiosoSNMPWalk(target, profile.SNOID)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		statuses, _ = hiosoSNMPWalk(target, profile.StatOID)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		txValues, _ = hiosoSNMPWalk(target, profile.TxOID)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		rxValues, _ = hiosoSNMPWalk(target, profile.RxOID)
	}()

	wg.Wait()

	if ctx.Err() != nil {
		return nil, "", ctx.Err()
	}

	if nameErr != nil {
		return nil, profile.Name, fmt.Errorf("gagal baca nama ONU: %w", nameErr)
	}
	if names == nil {
		names = make(map[string]string)
	}
	if sns == nil {
		sns = make(map[string]string)
	}

	for _, oid := range hiosoSNFallbacks {
		if hiosoHasMeaningfulSNMPValues(sns) {
			break
		}
		fallbackData, fallbackErr := hiosoSNMPWalk(target, oid)
		if fallbackErr != nil || len(fallbackData) == 0 {
			continue
		}
		for idx, val := range fallbackData {
			if !hiosoIsMeaningfulSNMPValue(val) {
				continue
			}
			if !hiosoIsMeaningfulSNMPValue(sns[idx]) {
				sns[idx] = val
			}
		}
	}

	indexSet := make(map[string]struct{})
	for idx := range names {
		indexSet[idx] = struct{}{}
	}
	for idx := range sns {
		indexSet[idx] = struct{}{}
	}
	for idx := range statuses {
		indexSet[idx] = struct{}{}
	}
	for idx := range txValues {
		indexSet[idx] = struct{}{}
	}
	for idx := range rxValues {
		indexSet[idx] = struct{}{}
	}

	indices := make([]string, 0, len(indexSet))
	for idx := range indexSet {
		if strings.TrimSpace(idx) == "" {
			continue
		}
		indices = append(indices, idx)
	}
	sort.Strings(indices)

	isGPON := strings.Contains(strings.ToUpper(profile.Name), "GPON")
	result := make([]HiosoONU, 0, len(indices))
	for _, idx := range indices {
		name := strings.TrimSpace(names[idx])
		sn := hiosoDecodeMacOrSN(sns[idx])
		status := hiosoParseStatus(statuses[idx], isGPON)
		tx := hiosoParseSignal(txValues[idx])
		rx := hiosoParseSignal(rxValues[idx])

		if hiosoIsGhost(name, sn, idx, tx, rx) {
			continue
		}

		port, onuID := hiosoParsePortAndID(idx)

		onu := HiosoONU{
			Index:   idx,
			WebID:   hiosoResolveWebID(idx),
			Port:    port,
			ONUID:   onuID,
			Name:    name,
			SN:      sn,
			Status:  status,
			TxPower: tx,
			RxPower: rx,
			Profile: profile.Name,
		}
		result = append(result, onu)
	}

	return result, profile.Name, nil
}

func FetchONUByPort(ctx context.Context, target SNMPTarget, port int) ([]HiosoONU, string, error) {
	profile, err := hiosoGetOrDetectProfile(target)
	if err != nil {
		return nil, "", err
	}

	if ctx.Err() != nil {
		return nil, "", ctx.Err()
	}

	portSuffix := fmt.Sprintf(".1.%d", port)
	nameOID := profile.NameOID + portSuffix
	snOID := profile.SNOID + portSuffix
	statOID := profile.StatOID + portSuffix
	txOID := profile.TxOID + portSuffix
	rxOID := profile.RxOID + portSuffix

	statusFallbacks, txFallbacks, rxFallbacks := hiosoGetFallbackOIDs(profile)

	names, nameErr := hiosoSNMPWalk(target, nameOID)
	if nameErr != nil {
		return nil, profile.Name, fmt.Errorf("gagal baca nama ONU: %w", nameErr)
	}

	time.Sleep(500 * time.Millisecond)

	var snFallbackPort []string
	for _, fb := range hiosoSNFallbacks {
		snFallbackPort = append(snFallbackPort, fb+portSuffix)
	}
	sns, _ := hiosoWalkWithFallback(target, snOID, snFallbackPort)

	time.Sleep(500 * time.Millisecond)

	statFallbackPort := make([]string, len(statusFallbacks))
	for i, fb := range statusFallbacks {
		statFallbackPort[i] = fb + portSuffix
	}
	statuses, _ := hiosoWalkWithFallback(target, statOID, statFallbackPort)

	time.Sleep(500 * time.Millisecond)

	txFallbackPort := make([]string, len(txFallbacks))
	for i, fb := range txFallbacks {
		txFallbackPort[i] = fb + portSuffix
	}
	txValues, _ := hiosoWalkWithFallback(target, txOID, txFallbackPort)

	time.Sleep(500 * time.Millisecond)

	rxFallbackPort := make([]string, len(rxFallbacks))
	for i, fb := range rxFallbacks {
		rxFallbackPort[i] = fb + portSuffix
	}
	rxValues, _ := hiosoWalkWithFallback(target, rxOID, rxFallbackPort)

	if names == nil {
		names = make(map[string]string)
	}
	if sns == nil {
		sns = make(map[string]string)
	}

	for _, oid := range hiosoSNFallbacks {
		if hiosoHasMeaningfulSNMPValues(sns) {
			break
		}
		fallbackData, fallbackErr := hiosoSNMPWalk(target, oid)
		if fallbackErr != nil || len(fallbackData) == 0 {
			continue
		}
		for idx, val := range fallbackData {
			if !hiosoIsMeaningfulSNMPValue(val) {
				continue
			}
			if !hiosoIsMeaningfulSNMPValue(sns[idx]) {
				sns[idx] = val
			}
		}
	}

	indexSet := make(map[string]struct{})
	for idx := range names {
		indexSet[idx] = struct{}{}
	}
	for idx := range sns {
		indexSet[idx] = struct{}{}
	}
	for idx := range statuses {
		indexSet[idx] = struct{}{}
	}
	for idx := range txValues {
		indexSet[idx] = struct{}{}
	}
	for idx := range rxValues {
		indexSet[idx] = struct{}{}
	}

	indices := make([]string, 0, len(indexSet))
	for idx := range indexSet {
		if strings.TrimSpace(idx) == "" {
			continue
		}
		indices = append(indices, idx)
	}
	sort.Strings(indices)

	isGPON := strings.Contains(strings.ToUpper(profile.Name), "GPON")
	result := make([]HiosoONU, 0, len(indices))
	for _, idx := range indices {
		name := strings.TrimSpace(names[idx])
		sn := hiosoDecodeMacOrSN(sns[idx])
		status := hiosoParseStatus(statuses[idx], isGPON)
		tx := hiosoParseSignalWithDivider(txValues[idx], profile.Divider)
		rx := hiosoParseSignalWithDivider(rxValues[idx], profile.Divider)
		robustIdx := hiosoExtractIndexRobust(idx, profile.NameOID+portSuffix)
		if robustIdx == "" {
			robustIdx = idx
		}

		if hiosoIsGhost(name, sn, robustIdx, tx, rx) {
			continue
		}

		onuPort, onuID := hiosoParsePortAndID(robustIdx)

		onu := HiosoONU{
			Index:   robustIdx,
			WebID:   hiosoResolveWebID(robustIdx),
			Port:    onuPort,
			ONUID:   onuID,
			Name:    name,
			SN:      sn,
			Status:  status,
			TxPower: tx,
			RxPower: rx,
			Profile: profile.Name,
		}
		result = append(result, onu)
	}

	if len(result) == 0 {
		allONUs, profileName, err := FetchAllONU(ctx, target)
		if err != nil {
			return nil, profileName, err
		}

		filtered := make([]HiosoONU, 0, len(allONUs))
		for _, onu := range allONUs {
			if onu.Port == port {
				filtered = append(filtered, onu)
			}
		}
		return filtered, profileName, nil
	}

	return result, profile.Name, nil
}

// FetchONUByIndex mengambil satu ONU berdasarkan index.
func FetchONUByIndex(ctx context.Context, target SNMPTarget, index string) (*HiosoONU, error) {
	index = strings.TrimSpace(index)
	if index == "" {
		return nil, errors.New("index ONU tidak valid")
	}

	if ctx.Err() != nil {
		return nil, ctx.Err()
	}

	onus, _, err := FetchAllONU(ctx, target)
	if err != nil {
		return nil, err
	}

	for _, onu := range onus {
		if strings.TrimSpace(onu.Index) == index {
			return &onu, nil
		}
	}

	return nil, fmt.Errorf("ONU dengan index %q tidak ditemukan", index)
}

func hiosoParsePortAndID(index string) (port int, onuID int) {
	trimmed := strings.TrimSpace(index)
	if trimmed == "" {
		return 0, 0
	}

	if strings.Contains(trimmed, ".") {
		parts := strings.Split(trimmed, ".")
		if len(parts) >= 2 {
			p, errP := strconv.Atoi(parts[len(parts)-2])
			o, errO := strconv.Atoi(parts[len(parts)-1])
			if errP == nil && errO == nil {
				if p > 0 && p <= 16 {
					return p, o
				}
			}
		}
	}

	v, err := strconv.Atoi(trimmed)
	if err != nil {
		return 0, 0
	}
	p := (v >> 16) & 0xFF
	o := v & 0xFF
	if p == 0 || p > 16 {
		p = (v >> 8) & 0xFF
	}
	if p == 0 {
		p = 1
	}
	if o < 0 {
		o = 0
	}
	return p, o
}

func hiosoExtractIndex(rawOID, baseOID string) string {
	raw := strings.TrimPrefix(strings.TrimSpace(rawOID), ".")
	base := strings.TrimPrefix(strings.TrimSpace(baseOID), ".")
	if raw == "" || base == "" {
		return ""
	}

	if raw == base {
		return ""
	}
	prefix := base + "."
	if strings.HasPrefix(raw, prefix) {
		return strings.TrimPrefix(raw, prefix)
	}

	return ""
}

func hiosoExtractIndexRobust(rawOID, baseOID string) string {
	raw := strings.TrimSpace(rawOID)
	base := strings.TrimSpace(baseOID)
	if raw == "" || base == "" {
		return ""
	}

	rawDot := raw
	if !strings.HasPrefix(rawDot, ".") {
		rawDot = "." + rawDot
	}
	baseDot := base
	if !strings.HasPrefix(baseDot, ".") {
		baseDot = "." + baseDot
	}

	if strings.HasPrefix(rawDot, baseDot+".") {
		return strings.TrimPrefix(rawDot, baseDot+".")
	}
	if rawDot == baseDot {
		return ""
	}

	rawParts := strings.Split(strings.Trim(raw, "."), ".")
	baseParts := strings.Split(strings.Trim(base, "."), ".")
	if len(baseParts) > 0 {
		lastAnchor := baseParts[len(baseParts)-1]
		found := -1
		for i := len(rawParts) - 1; i >= 0; i-- {
			if rawParts[i] == lastAnchor {
				found = i
				break
			}
		}
		if found != -1 && found+1 < len(rawParts) {
			return strings.Join(rawParts[found+1:], ".")
		}
	}

	return strings.TrimPrefix(strings.TrimPrefix(raw, base), ".")
}

func hiosoParentBranch(oid string) string {
	trimmed := strings.Trim(strings.TrimSpace(oid), ".")
	lastDot := strings.LastIndex(trimmed, ".")
	if lastDot <= 0 {
		return "." + trimmed
	}
	return "." + trimmed[:lastDot]
}

func hiosoWalkWithFallback(target SNMPTarget, mainOID string, fallbacks []string) (map[string]string, error) {
	if mainOID == "" && len(fallbacks) == 0 {
		return nil, errors.New("OID kosong, tidak ada fallback")
	}

	if mainOID != "" {
		result, err := hiosoSNMPWalk(target, mainOID)
		if err == nil && len(result) > 0 {
			return result, nil
		}
	}

	for _, foid := range fallbacks {
		result, err := hiosoSNMPWalk(target, foid)
		if err == nil && len(result) > 0 {
			return result, nil
		}
	}

	return make(map[string]string), nil
}

func hiosoGetFallbackOIDs(profile *hiosoOIDProfile) (statusFallbacks, txFallbacks, rxFallbacks []string) {
	profileName := strings.ToUpper(strings.TrimSpace(profile.Name))
	switch profileName {
	case "HIOSO_C":
		pb := hiosoParentBranch(profile.NameOID)
		statusFallbacks = []string{pb + ".2", pb + ".5", pb + ".39"}
		txFallbacks = []string{pb + ".13", ".1.3.6.1.4.1.25355.3.2.6.1.1.1.1.9"}
		rxFallbacks = []string{pb + ".14", ".1.3.6.1.4.1.25355.3.2.6.1.1.1.1.10"}
	}
	return
}

func hiosoParseSignalWithDivider(raw string, divider float64) float64 {
	text := strings.TrimSpace(raw)
	if text == "" {
		return 0
	}

	numberText := hiosoSignalRegex.FindString(text)
	if numberText == "" {
		return 0
	}

	value, err := strconv.ParseFloat(numberText, 64)
	if err != nil {
		return 0
	}

	if divider > 0 {
		return math.Round(value/divider*100) / 100
	}

	return hiosoParseSignal(raw)
}

func hiosoParseSignal(raw string) float64 {
	text := strings.TrimSpace(raw)
	if text == "" {
		return 0
	}

	numberText := hiosoSignalRegex.FindString(text)
	if numberText == "" {
		return 0
	}

	value, err := strconv.ParseFloat(numberText, 64)
	if err != nil {
		return 0
	}

	abs := math.Abs(value)
	scaled := value
	if abs > 500 {
		scaled = value / 100
	} else if abs > 50 {
		scaled = value / 10
	}

	result := math.Round(scaled*100) / 100

	if math.Abs(result) > 50 && result != 0 {
		log.Printf("[hioso] signal out of range %.2f dBm (raw=%q)", result, raw)
		return 0
	}

	return result
}

func hiosoDecodeMacOrSN(raw string) string {
	cleaned := strings.TrimSpace(raw)
	cleaned = strings.Trim(cleaned, `"`)
	cleaned = strings.ReplaceAll(cleaned, "Hex-STRING:", "")
	cleaned = strings.ReplaceAll(cleaned, "HEX-STRING:", "")
	cleaned = strings.ReplaceAll(cleaned, "STRING:", "")
	cleaned = strings.TrimSpace(cleaned)
	if cleaned == "" {
		return ""
	}

	if hiosoHexPairRegex.MatchString(cleaned) {
		parts := strings.Fields(cleaned)
		for i := range parts {
			parts[i] = strings.ToUpper(parts[i])
		}
		return strings.Join(parts, ":")
	}

	hx := strings.ToUpper(strings.ReplaceAll(strings.ReplaceAll(cleaned, " ", ""), ":", ""))
	if hiosoHex12Regex.MatchString(hx) {
		pairs := make([]string, 0, 6)
		for i := 0; i < len(hx); i += 2 {
			pairs = append(pairs, hx[i:i+2])
		}
		return strings.Join(pairs, ":")
	}

	if hiosoHex16Regex.MatchString(hx) {
		decoded := make([]byte, 0, 8)
		valid := true
		for i := 0; i < len(hx); i += 2 {
			b, err := strconv.ParseUint(hx[i:i+2], 16, 8)
			if err != nil {
				valid = false
				break
			}
			decoded = append(decoded, byte(b))
		}
		if valid {
			printable := true
			for _, b := range decoded {
				if b < 32 || b > 126 {
					printable = false
					break
				}
			}
			if printable {
				return strings.TrimSpace(string(decoded))
			}
		}
	}

	if hiosoGponSNRegex.MatchString(cleaned) {
		return cleaned
	}

	return cleaned
}

func hiosoParseStatus(raw string, isGPON bool) string {
	text := strings.TrimSpace(raw)
	if text == "" {
		return "Down"
	}

	numberText := hiosoSignalRegex.FindString(text)
	if numberText != "" {
		if val, err := strconv.Atoi(strings.Split(numberText, ".")[0]); err == nil {
			if isGPON {
				switch val {
				case 2, 3, 4:
					return "Up"
				case 1:
					return "Offline"
				default:
					return "Down"
				}
			}
			switch val {
			case 1, 3, 4:
				return "Up"
			default:
				return "Down"
			}
		}
	}

	lower := strings.ToLower(text)
	if strings.Contains(lower, "offline") {
		return "Offline"
	}
	if strings.Contains(lower, "up") || strings.Contains(lower, "online") || strings.Contains(lower, "active") || strings.Contains(lower, "registered") {
		return "Up"
	}
	if strings.Contains(lower, "down") || strings.Contains(lower, "alarm") {
		return "Down"
	}

	for _, kw := range hiosoStatusKeywords {
		if strings.Contains(lower, strings.ToLower(kw)) {
			switch strings.ToLower(kw) {
			case "offline":
				return "Offline"
			case "up", "online", "active", "registered":
				return "Up"
			default:
				return "Down"
			}
		}
	}

	return "Down"
}

func hiosoIsGhost(name, sn, index string, tx, rx float64) bool {
	trimmedName := strings.TrimSpace(name)
	trimmedSN := strings.TrimSpace(sn)

	if tx == 0 && rx == 0 && trimmedName == "" && trimmedSN == "" {
		return true
	}
	if strings.Contains(strings.ToLower(trimmedName), "no such") {
		return true
	}

	lowerName := strings.ToLower(trimmedName)
	for _, g := range []string{"public", "internal", "private", "all", "grpcomm"} {
		if strings.Contains(lowerName, g) {
			return true
		}
	}

	if len(index) > 20 {
		return true
	}
	if strings.Count(index, ".") > 5 {
		return true
	}

	return false
}

func hiosoResolveWebID(index string) string {
	trimmed := strings.TrimSpace(index)
	if trimmed == "" {
		return "0/1/1:0"
	}

	if strings.Contains(trimmed, ".") {
		parts := strings.Split(trimmed, ".")
		if len(parts) >= 3 {
			port, errPort := strconv.Atoi(parts[len(parts)-2])
			onu, errONU := strconv.Atoi(parts[len(parts)-1])
			if errPort == nil && errONU == nil {
				if port <= 0 {
					port = 1
				}
				if onu < 0 {
					onu = 0
				}
				if port > 8 {
					log.Printf("[hioso] port out of range in webID: port=%d onu=%d index=%s", port, onu, trimmed)
					port = 1
				}
				return fmt.Sprintf("0/1/%d:%d", port, onu)
			}
		}
	}

	v, err := strconv.Atoi(trimmed)
	if err != nil {
		return fmt.Sprintf("0/1/1:%s", trimmed)
	}

	port := (v >> 16) & 0xFF
	onu := v & 0xFF
	if port == 0 || port > 8 {
		port = (v >> 8) & 0xFF
	}
	if port == 0 {
		port = 1
	}
	if port > 8 {
		log.Printf("[hioso] port out of range in webID: port=%d onu=%d index=%s", port, onu, trimmed)
		port = 1
	}

	return fmt.Sprintf("0/1/%d:%d", port, onu)
}

func hiosoPDUToString(pdu gosnmp.SnmpPDU) string {
	if pdu.Value == nil {
		return ""
	}

	switch v := pdu.Value.(type) {
	case string:
		return strings.TrimSpace(v)
	case []byte:
		printable := true
		for _, b := range v {
			if b < 32 || b > 126 {
				printable = false
				break
			}
		}
		if printable && len(v) > 0 {
			return strings.TrimSpace(string(v))
		}
		parts := make([]string, 0, len(v))
		for _, b := range v {
			parts = append(parts, fmt.Sprintf("%02X", b))
		}
		if len(parts) > 0 {
			return strings.Join(parts, " ")
		}
		return strings.TrimSpace(string(v))
	case int:
		return strconv.Itoa(v)
	case int64:
		return strconv.FormatInt(v, 10)
	case uint:
		return strconv.FormatUint(uint64(v), 10)
	case uint64:
		return strconv.FormatUint(v, 10)
	case float32:
		return strconv.FormatFloat(float64(v), 'f', -1, 64)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", pdu.Value))
	}
}

func hiosoNewSNMPClientOptimized(target SNMPTarget) *gosnmp.GoSNMP {
	return &gosnmp.GoSNMP{
		Target:                target.Host,
		Port:                  target.Port,
		Community:             target.Community,
		Version:               target.Version,
		Timeout:               10 * time.Second,
		Retries:               5,
		MaxRepetitions:        20,
		UseUnconnectedUDPSocket: true,
	}
}

func hiosoGetProfileOptimized(target SNMPTarget) (*hiosoOIDProfile, error) {
	cacheKey := "optimized:" + target.Host + ":" + target.Community
	if cached, ok := hiosoProfileCache.Load(cacheKey); ok {
		entry := cached.(*hiosoProfileCacheEntry)
		if time.Now().Before(entry.expiresAt) {
			return entry.profile, nil
		}
		hiosoProfileCache.Delete(cacheKey)
	}

	hiosoC := hiosoFindProfileByName("HIOSO_C")
	if hiosoC != nil {
		values, err := hiosoSNMPWalk(target, hiosoC.NameOID)
		if err == nil && len(values) > 0 {
			hiosoProfileCache.Store(cacheKey, &hiosoProfileCacheEntry{
				profile:   hiosoC,
				expiresAt: time.Now().Add(2 * time.Hour),
			})
			log.Printf("[hioso] profile optimized fast-path: HIOSO_C host=%s", target.Host)
			return hiosoC, nil
		}
	}

	profile, err := hiosoGetOrDetectProfile(target)
	if err != nil {
		return nil, err
	}

	hiosoProfileCache.Store(cacheKey, &hiosoProfileCacheEntry{
		profile:   profile,
		expiresAt: time.Now().Add(2 * time.Hour),
	})
	log.Printf("[hioso] profile optimized fallback: %s host=%s", profile.Name, target.Host)
	return profile, nil
}

func fetchONUByPortInternal(ctx context.Context, target SNMPTarget, port int) ([]HiosoONU, string, error) {
	profile, err := hiosoGetProfileOptimized(target)
	if err != nil {
		return nil, "", err
	}

	if ctx.Err() != nil {
		return nil, "", ctx.Err()
	}

	portSuffix := ".1." + strconv.Itoa(port)
	nameOID := profile.NameOID + portSuffix
	snOID := profile.SNOID + portSuffix
	statOID := profile.StatOID + portSuffix
	txOID := profile.TxOID + portSuffix
	rxOID := profile.RxOID + portSuffix

	statusFallbacks, txFallbacks, rxFallbacks := hiosoGetFallbackOIDs(profile)

	snFallbackPort := make([]string, len(hiosoSNFallbacks))
	for i, fb := range hiosoSNFallbacks {
		snFallbackPort[i] = fb + portSuffix
	}
	statFallbackPort := make([]string, len(statusFallbacks))
	for i, fb := range statusFallbacks {
		statFallbackPort[i] = fb + portSuffix
	}
	txFallbackPort := make([]string, len(txFallbacks))
	for i, fb := range txFallbacks {
		txFallbackPort[i] = fb + portSuffix
	}
	rxFallbackPort := make([]string, len(rxFallbacks))
	for i, fb := range rxFallbacks {
		rxFallbackPort[i] = fb + portSuffix
	}

	names, nameErr := hiosoSNMPWalk(target, nameOID)
	if nameErr != nil {
		return nil, profile.Name, fmt.Errorf("gagal baca nama ONU: %w", nameErr)
	}

	time.Sleep(300 * time.Millisecond)

	sns, _ := hiosoWalkWithFallback(target, snOID, snFallbackPort)

	time.Sleep(300 * time.Millisecond)

	statuses, _ := hiosoWalkWithFallback(target, statOID, statFallbackPort)

	time.Sleep(300 * time.Millisecond)

	txValues, _ := hiosoWalkWithFallback(target, txOID, txFallbackPort)

	time.Sleep(300 * time.Millisecond)

	rxValues, _ := hiosoWalkWithFallback(target, rxOID, rxFallbackPort)

	if names == nil {
		names = make(map[string]string)
	}
	if sns == nil {
		sns = make(map[string]string)
	}

	for _, oid := range hiosoSNFallbacks {
		if hiosoHasMeaningfulSNMPValues(sns) {
			break
		}
		fallbackData, fallbackErr := hiosoSNMPWalk(target, oid)
		if fallbackErr != nil || len(fallbackData) == 0 {
			continue
		}
		for idx, val := range fallbackData {
			if !hiosoIsMeaningfulSNMPValue(val) {
				continue
			}
			if !hiosoIsMeaningfulSNMPValue(sns[idx]) {
				sns[idx] = val
			}
		}
	}

	indexSet := make(map[string]struct{})
	for idx := range names {
		indexSet[idx] = struct{}{}
	}
	for idx := range sns {
		indexSet[idx] = struct{}{}
	}
	for idx := range statuses {
		indexSet[idx] = struct{}{}
	}
	for idx := range txValues {
		indexSet[idx] = struct{}{}
	}
	for idx := range rxValues {
		indexSet[idx] = struct{}{}
	}

	indices := make([]string, 0, len(indexSet))
	for idx := range indexSet {
		if strings.TrimSpace(idx) == "" {
			continue
		}
		indices = append(indices, idx)
	}
	sort.Strings(indices)

	isGPON := strings.Contains(strings.ToUpper(profile.Name), "GPON")
	result := make([]HiosoONU, 0, len(indices))
	for _, idx := range indices {
		name := strings.TrimSpace(names[idx])
		sn := hiosoDecodeMacOrSN(sns[idx])
		status := hiosoParseStatus(statuses[idx], isGPON)
		tx := hiosoParseSignalWithDivider(txValues[idx], profile.Divider)
		rx := hiosoParseSignalWithDivider(rxValues[idx], profile.Divider)
		robustIdx := hiosoExtractIndexRobust(idx, profile.NameOID+portSuffix)
		if robustIdx == "" {
			robustIdx = idx
		}

		if hiosoIsGhost(name, sn, robustIdx, tx, rx) {
			continue
		}

		onuPort, onuID := hiosoParsePortAndID(robustIdx)

		onu := HiosoONU{
			Index:   robustIdx,
			WebID:   hiosoResolveWebID(robustIdx),
			Port:    onuPort,
			ONUID:   onuID,
			Name:    name,
			SN:      sn,
			Status:  status,
			TxPower: tx,
			RxPower: rx,
			Profile: profile.Name,
		}
		result = append(result, onu)
	}

	log.Printf("[hioso] fetchONUByPortInternal port=%d profile=%s found=%d", port, profile.Name, len(result))
	return result, profile.Name, nil
}

func FetchONUByPortCached(ctx context.Context, target SNMPTarget, port int, force bool) ([]HiosoONU, string, error) {
	cacheKey := fmt.Sprintf("%s:%s:%d", target.Host, target.Community, port)

	if !force {
		if cached, ok := hiosoPortCache.Load(cacheKey); ok {
			entry := cached.(*portCacheEntry)
			if time.Since(entry.cachedAt) < hiosoPortCacheTTL {
				log.Printf("[hioso] cache hit port=%d host=%s", port, target.Host)
				return entry.onus, entry.profile, nil
			}
			hiosoPortCache.Delete(cacheKey)
		}
	}

	onus, profileName, err := fetchONUByPortInternal(ctx, target, port)
	if err != nil {
		return nil, "", err
	}

	hiosoPortCache.Store(cacheKey, &portCacheEntry{
		onus:     onus,
		profile:  profileName,
		cachedAt: time.Now(),
	})

	return onus, profileName, nil
}
