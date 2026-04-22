package handlers

import (
	"errors"
	"fmt"
	"log"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gosnmp/gosnmp"
)

// HiosoONU merepresentasikan data ONU yang dikirim ke frontend plugin.
type HiosoONU struct {
	Index   string  `json:"index"`
	WebID   string  `json:"web_id"`
	Name    string  `json:"name"`
	SN      string  `json:"sn"`
	Status  string  `json:"status"`
	TxPower float64 `json:"tx_power"`
	RxPower float64 `json:"rx_power"`
	Profile string  `json:"profile"`
}

type hiosoOIDProfile struct {
	Name, NameOID, SNOID, StatOID, TxOID, RxOID string
}

var hiosoProfiles = []hiosoOIDProfile{
	{
		Name:    "HIOSO_C",
		NameOID: ".1.3.6.1.4.1.25355.3.2.6.3.2.1.37",
		SNOID:   ".1.3.6.1.4.1.25355.3.2.6.3.2.1.11",
		StatOID: ".1.3.6.1.4.1.25355.3.2.6.3.2.1.39",
		TxOID:   ".1.3.6.1.4.1.25355.3.2.6.14.2.1.4",
		RxOID:   ".1.3.6.1.4.1.25355.3.2.6.14.2.1.8",
	},
	{
		Name:    "HIOSO_B",
		NameOID: ".1.3.6.1.4.1.3320.101.10.1.1.79",
		SNOID:   ".1.3.6.1.4.1.3320.101.10.1.1.3",
		StatOID: ".1.3.6.1.4.1.3320.101.10.1.1.26",
		TxOID:   ".1.3.6.1.4.1.3320.101.10.5.1.5",
		RxOID:   ".1.3.6.1.4.1.3320.101.10.5.1.6",
	},
	{
		Name:    "HIOSO_GPON",
		NameOID: ".1.3.6.1.4.1.25355.3.3.1.1.1.2",
		SNOID:   ".1.3.6.1.4.1.25355.3.3.1.1.1.5",
		StatOID: ".1.3.6.1.4.1.25355.3.3.1.1.1.11",
		TxOID:   ".1.3.6.1.4.1.25355.3.3.1.1.4.1.2",
		RxOID:   ".1.3.6.1.4.1.25355.3.3.1.1.4.1.1",
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

// hiosoSNMPWalk melakukan SNMP walk dan mengembalikan map index->value string.
func hiosoSNMPWalk(host, community, oid string) (map[string]string, error) {
	cfg := hiosoLoadRuntimeSettings()
	if strings.TrimSpace(host) == "" {
		host = cfg.Host
	}
	if strings.TrimSpace(community) == "" {
		community = cfg.Community
	}

	host = strings.TrimSpace(host)
	community = strings.TrimSpace(community)
	if host == "" || community == "" {
		return nil, errors.New("host/community SNMP tidak valid")
	}

	client := &gosnmp.GoSNMP{
		Target:    host,
		Port:      hiosoParseSNMPPort(cfg.Port),
		Community: community,
		Version:   hiosoParseSNMPVersion(cfg.Version),
		Timeout:   2 * time.Second,
		Retries:   2,
	}

	if err := client.Connect(); err != nil {
		return nil, fmt.Errorf("gagal konek SNMP ke %s: %w", host, err)
	}
	defer client.Conn.Close()

	results := make(map[string]string)
	baseOID := strings.TrimSpace(oid)
	walkErr := client.BulkWalk(baseOID, func(pdu gosnmp.SnmpPDU) error {
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
	})
	if walkErr != nil {
		return nil, fmt.Errorf("SNMP walk gagal oid=%s: %w", baseOID, walkErr)
	}

	return results, nil
}

// hiosoSNMPSet melakukan SNMP SET OctetString ke OID target.
func hiosoSNMPSet(host, community, oid, value string) error {
	cfg := hiosoLoadRuntimeSettings()
	if strings.TrimSpace(host) == "" {
		host = cfg.Host
	}
	if strings.TrimSpace(community) == "" {
		community = cfg.Community
	}

	host = strings.TrimSpace(host)
	community = strings.TrimSpace(community)
	oid = strings.TrimSpace(oid)
	if host == "" || community == "" || oid == "" {
		return errors.New("parameter SNMP set tidak lengkap")
	}

	client := &gosnmp.GoSNMP{
		Target:    host,
		Port:      hiosoParseSNMPPort(cfg.Port),
		Community: community,
		Version:   hiosoParseSNMPVersion(cfg.Version),
		Timeout:   2 * time.Second,
		Retries:   2,
	}

	if err := client.Connect(); err != nil {
		return fmt.Errorf("gagal konek SNMP set ke %s: %w", host, err)
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

// hiosoDetectProfile mendeteksi profil OID yang cocok berdasarkan NameOID pertama yang menghasilkan data.
func hiosoDetectProfile(host, community string) (*hiosoOIDProfile, error) {
	for i := range hiosoProfiles {
		profile := hiosoProfiles[i]
		values, err := hiosoSNMPWalk(host, community, profile.NameOID)
		if err != nil {
			continue
		}
		if len(values) > 0 {
			return &profile, nil
		}
	}

	return nil, errors.New("OLT tidak dikenali sebagai Hioso")
}

// hiosoExtractIndex memotong baseOID dari rawOID dan mengembalikan bagian index.
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

// hiosoParseSignal parsing nilai sinyal lalu scaling pintar sesuai aturan plugin.
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

	return math.Round(scaled*100) / 100
}

// hiosoDecodeMacOrSN normalisasi berbagai format serial/MAC ONU dari SNMP.
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

// hiosoParseStatus memetakan status mentah ONU ke nilai Up/Down/Offline.
func hiosoParseStatus(raw string, isGPON bool) string {
	text := strings.TrimSpace(raw)
	if text == "" {
		if isGPON {
			return "Down"
		}
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

// hiosoIsGhost menandai entri ONU kosong/palsu agar tidak dikirim ke frontend.
func hiosoIsGhost(name, sn string, tx, rx float64) bool {
	trimmedName := strings.TrimSpace(name)
	trimmedSN := strings.TrimSpace(sn)
	if tx == 0 && rx == 0 && trimmedName == "" && trimmedSN == "" {
		return true
	}
	if strings.Contains(strings.ToLower(trimmedName), "no such") {
		return true
	}
	return false
}

// hiosoResolveWebID mengubah index SNMP jadi format ID web OLT.
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

	return fmt.Sprintf("0/1/%d:%d", port, onu)
}

// FetchAllONU mengambil daftar ONU dari OLT berdasarkan profil Hioso yang terdeteksi.
func FetchAllONU(host, community string) ([]HiosoONU, string, error) {
	sysDescr, err := hiosoSNMPWalk(host, community, ".1.3.6.1.2.1.1.1")
	if err != nil {
		return nil, "", fmt.Errorf("OLT tidak reachable (sysDescr): %w", err)
	}
	if len(sysDescr) == 0 {
		return nil, "", errors.New("sysDescr kosong")
	}

	sysObjectID, objErr := hiosoSNMPWalk(host, community, ".1.3.6.1.2.1.1.2.0")
	if objErr == nil {
		log.Printf("[hioso] sysObjectID=%v", sysObjectID)
	} else {
		log.Printf("[hioso] sysObjectID walk gagal: %v", objErr)
	}

	profile, err := hiosoDetectProfile(host, community)
	if err != nil {
		return nil, "", err
	}

	names, err := hiosoSNMPWalk(host, community, profile.NameOID)
	if err != nil {
		return nil, profile.Name, fmt.Errorf("gagal baca nama ONU: %w", err)
	}

	sns, snErr := hiosoSNMPWalk(host, community, profile.SNOID)
	if snErr != nil {
		sns = make(map[string]string)
	}
	for _, oid := range hiosoSNFallbacks {
		if len(sns) > 0 {
			break
		}
		fallbackData, fallbackErr := hiosoSNMPWalk(host, community, oid)
		if fallbackErr != nil || len(fallbackData) == 0 {
			continue
		}
		for idx, val := range fallbackData {
			if strings.TrimSpace(sns[idx]) == "" {
				sns[idx] = val
			}
		}
	}

	statuses, _ := hiosoSNMPWalk(host, community, profile.StatOID)
	txValues, _ := hiosoSNMPWalk(host, community, profile.TxOID)
	rxValues, _ := hiosoSNMPWalk(host, community, profile.RxOID)

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

		if hiosoIsGhost(name, sn, tx, rx) {
			continue
		}

		onu := HiosoONU{
			Index:   idx,
			WebID:   hiosoResolveWebID(idx),
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

func hiosoPDUToString(pdu gosnmp.SnmpPDU) string {
	if pdu.Value == nil {
		return ""
	}

	switch v := pdu.Value.(type) {
	case string:
		return strings.TrimSpace(v)
	case []byte:
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
