package handlers

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"genieacs-backend/internal/db"
	"genieacs-backend/internal/services"
)

const (
	telegramLongPollTimeoutSec = 30
	telegramPerDomainMax       = 5
	telegramMessageMaxChars    = 3900
	telegramDetailPageSize     = 2
)

var telegramBotStartOnce sync.Once
var telegramCheckSessions sync.Map
var telegramTokenPattern = regexp.MustCompile(`^\d+:[A-Za-z0-9_-]{20,}$`)

const (
	telegramDomainAll = "all"
	telegramDomainACS = "acs"
	telegramDomainPPP = "ppp"
)

type telegramBot struct {
	token        string
	apiBase      string
	client       *http.Client
	allowedChats map[int64]struct{}
	offset       int64
}

type telegramGetUpdatesResponse struct {
	OK          bool             `json:"ok"`
	Result      []telegramUpdate `json:"result"`
	Description string           `json:"description"`
}

type telegramUpdate struct {
	UpdateID int64            `json:"update_id"`
	Message  *telegramMessage `json:"message"`
}

type telegramMessage struct {
	MessageID int64        `json:"message_id"`
	Chat      telegramChat `json:"chat"`
	Text      string       `json:"text"`
}

type telegramChat struct {
	ID int64 `json:"id"`
}

type telegramSendMessageRequest struct {
	ChatID                int64  `json:"chat_id"`
	Text                  string `json:"text"`
	DisableWebPagePreview bool   `json:"disable_web_page_preview"`
}

type telegramACSResult struct {
	DeviceID    string
	PPPoE       string
	Optical     string
	Status      string
	IP          string
	LastInform  string
	WLAN        string
	WLANPasswd  string
	VendorType  string
	Serial      string
	LastInformT time.Time
}

type telegramMikroTikResult struct {
	DeviceHost string
	Name       string
	Secret     string
	Profile    string
	Status     string
	IP         string
	Uptime     string
}

type telegramCheckSession struct {
	Domain    string
	Query     string
	Page      int
	UpdatedAt time.Time
}

type telegramCommand struct {
	Name   string
	Domain string
	Query  string
}

type telegramFatalError struct {
	message string
}

func (e *telegramFatalError) Error() string {
	return e.message
}

func newTelegramFatalError(format string, args ...interface{}) error {
	return &telegramFatalError{message: fmt.Sprintf(format, args...)}
}

func isTelegramFatalError(err error) bool {
	var fatalErr *telegramFatalError
	return errors.As(err, &fatalErr)
}

func StartTelegramBotFromEnv() {
	telegramBotStartOnce.Do(func() {
		enabledRaw := strings.TrimSpace(os.Getenv("TELEGRAM_BOT_ENABLED"))
		enabled, ok := parseBoolLike(enabledRaw)
		if !ok || !enabled {
			return
		}

		token := normalizeTelegramToken(os.Getenv("TELEGRAM_BOT_TOKEN"))
		if token == "" {
			log.Printf("[telegram] TELEGRAM_BOT_ENABLED=true but TELEGRAM_BOT_TOKEN is empty; bot not started")
			return
		}
		if !telegramTokenPattern.MatchString(token) {
			log.Printf("[telegram] TELEGRAM_BOT_TOKEN format invalid (expected <bot_id>:<token>); bot not started")
			return
		}

		bot := &telegramBot{
			token:        token,
			apiBase:      fmt.Sprintf("https://api.telegram.org/bot%s", token),
			client:       &http.Client{Timeout: 40 * time.Second},
			allowedChats: parseTelegramAllowedChats(os.Getenv("TELEGRAM_CHAT_IDS")),
			offset:       0,
		}

		go bot.run()
		if len(bot.allowedChats) > 0 {
			log.Printf("[telegram] bot polling started with %d allowed chat(s)", len(bot.allowedChats))
		} else {
			log.Printf("[telegram] bot polling started (no chat allowlist)")
		}
	})
}

func parseTelegramAllowedChats(raw string) map[int64]struct{} {
	allowed := make(map[int64]struct{})
	for _, part := range strings.Split(raw, ",") {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		chatID, err := strconv.ParseInt(trimmed, 10, 64)
		if err != nil {
			continue
		}
		allowed[chatID] = struct{}{}
	}

	return allowed
}

func (b *telegramBot) isChatAllowed(chatID int64) bool {
	if len(b.allowedChats) == 0 {
		return true
	}
	_, ok := b.allowedChats[chatID]
	return ok
}

func (b *telegramBot) run() {
	for {
		if err := b.pollAndHandle(); err != nil {
			if isTelegramFatalError(err) {
				log.Printf("[telegram] fatal error: %v; bot polling stopped", err)
				return
			}
			log.Printf("[telegram] poll error: %v", err)
			time.Sleep(3 * time.Second)
		}
	}
}

func (b *telegramBot) pollAndHandle() error {
	endpoint := fmt.Sprintf("%s/getUpdates?timeout=%d&limit=50&offset=%d", b.apiBase, telegramLongPollTimeoutSec, b.offset)
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}

	resp, err := b.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message := fmt.Sprintf("telegram getUpdates status=%d body=%s", resp.StatusCode, truncateText(string(body), 500))
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusNotFound {
			return newTelegramFatalError("%s", message)
		}
		return fmt.Errorf("%s", message)
	}

	var payload telegramGetUpdatesResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return err
	}
	if !payload.OK {
		description := strings.TrimSpace(payload.Description)
		lowerDescription := strings.ToLower(description)
		if strings.Contains(lowerDescription, "not found") || strings.Contains(lowerDescription, "unauthorized") || strings.Contains(lowerDescription, "forbidden") {
			return newTelegramFatalError("telegram getUpdates not ok: %s", description)
		}
		return fmt.Errorf("telegram getUpdates not ok: %s", description)
	}

	for _, update := range payload.Result {
		if update.UpdateID >= b.offset {
			b.offset = update.UpdateID + 1
		}

		if update.Message == nil {
			continue
		}

		chatID := update.Message.Chat.ID
		if !b.isChatAllowed(chatID) {
			_ = b.sendMessage(chatID, "⛔ Chat ini belum diizinkan untuk akses bot backend.")
			continue
		}

		text := strings.TrimSpace(update.Message.Text)
		if text == "" {
			continue
		}

		command := parseTelegramCommand(text)

		switch command.Name {
		case "help":
			_ = b.sendMessage(chatID, telegramHelpText())
			continue
		case "status":
			_ = b.sendMessage(chatID, "✅ Bot aktif dan terhubung.\n\n"+telegramHelpText())
			continue
		case "next", "back", "refresh":
			reply, err := buildTelegramDetailReplyFromSession(chatID, command.Name)
			if err != nil {
				_ = b.sendMessage(chatID, fmt.Sprintf("❌ %v", err))
				continue
			}
			_ = b.sendMessage(chatID, reply)
			continue
		case "cari":
			reply, err := buildTelegramSummaryReply(command.Query, command.Domain)
			if err != nil {
				_ = b.sendMessage(chatID, fmt.Sprintf("❌ Gagal mencari data: %v", err))
				continue
			}
			_ = b.sendMessage(chatID, reply)
			continue
		case "cek":
			reply, err := buildTelegramDetailReply(chatID, command.Query, command.Domain, 1)
			if err != nil {
				_ = b.sendMessage(chatID, fmt.Sprintf("❌ Gagal cek detail: %v", err))
				continue
			}
			_ = b.sendMessage(chatID, reply)
			continue
		default:
			_ = b.sendMessage(chatID, telegramHelpText())
			continue
		}
	}

	return nil
}

func normalizeTelegramToken(raw string) string {
	token := strings.TrimSpace(raw)
	if len(token) >= 3 && strings.EqualFold(token[:3], "bot") {
		token = strings.TrimSpace(token[3:])
	}
	return token
}

func parseTelegramCommand(text string) telegramCommand {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return telegramCommand{Name: "help", Domain: telegramDomainAll}
	}

	fields := strings.Fields(trimmed)
	if len(fields) == 0 {
		return telegramCommand{Name: "help", Domain: telegramDomainAll}
	}

	first := strings.TrimPrefix(strings.ToLower(fields[0]), "/")
	first = strings.Split(first, "@")[0]
	args := []string{}
	if len(fields) > 1 {
		args = fields[1:]
	}

	if strings.HasPrefix(fields[0], "/") {
		switch first {
		case "start", "help", "menu":
			return telegramCommand{Name: "help", Domain: telegramDomainAll}
		case "status", "ping":
			return telegramCommand{Name: "status", Domain: telegramDomainAll}
		case "next", "lanjut":
			return telegramCommand{Name: "next", Domain: telegramDomainAll}
		case "back", "prev", "sebelum":
			return telegramCommand{Name: "back", Domain: telegramDomainAll}
		case "refresh", "reload":
			return telegramCommand{Name: "refresh", Domain: telegramDomainAll}
		case "cari", "search", "find":
			domain, query := extractTelegramDomainAndQuery(args)
			return telegramCommand{Name: "cari", Domain: domain, Query: query}
		case "cek":
			domain, query := extractTelegramDomainAndQuery(args)
			return telegramCommand{Name: "cek", Domain: domain, Query: query}
		default:
			return telegramCommand{Name: "help", Domain: telegramDomainAll}
		}
	}

	return telegramCommand{Name: "cari", Domain: telegramDomainAll, Query: trimmed}
}

func extractTelegramDomainAndQuery(args []string) (string, string) {
	if len(args) == 0 {
		return telegramDomainAll, ""
	}

	if domain := normalizeTelegramDomainToken(args[0]); domain != "" {
		return domain, strings.TrimSpace(strings.Join(args[1:], " "))
	}

	return telegramDomainAll, strings.TrimSpace(strings.Join(args, " "))
}

func normalizeTelegramDomainToken(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(strings.Trim(value, "/")))
	switch normalized {
	case "acs", "genieacs":
		return telegramDomainACS
	case "ppp", "mikrotik", "mtk":
		return telegramDomainPPP
	case "all", "semua":
		return telegramDomainAll
	default:
		return ""
	}
}

func telegramHelpText() string {
	return strings.Join([]string{
		"Menu bot:",
		"- /cari [acs|ppp] [keyword]  → list hasil (tanpa detail, tampil semua)",
		"- /cek [acs|ppp] [keyword]   → detail (2 data/page)",
		"- /next | /back | /refresh   → navigasi halaman hasil /cek",
		"- /help                      → bantuan",
		"Catatan:",
		"- Jika filter domain (acs/ppp) tidak diisi, bot cari semua domain.",
		"- Jika keyword kosong, bot tampilkan semua data sesuai domain.",
	}, "\n")
}

func buildTelegramSummaryReply(query string, domain string) (string, error) {
	acsResults, mikroTikResults, acsErr, mikroTikErr := runTelegramDomainSearch(query, domain, 0)
	if err := telegramDomainSearchError(domain, acsErr, mikroTikErr); err != nil {
		return "", err
	}

	return formatTelegramSummaryResults(query, domain, acsResults, mikroTikResults), nil
}

func buildTelegramDetailReply(chatID int64, query string, domain string, page int) (string, error) {
	acsResults, mikroTikResults, acsErr, mikroTikErr := runTelegramDomainSearch(query, domain, 0)
	if err := telegramDomainSearchError(domain, acsErr, mikroTikErr); err != nil {
		return "", err
	}

	normalizedDomain := domain
	if normalizedDomain == "" {
		normalizedDomain = telegramDomainAll
	}

	if page < 1 {
		page = 1
	}

	reply := formatTelegramDetailResults(query, normalizedDomain, acsResults, mikroTikResults, page)
	session := telegramCheckSession{
		Domain:    normalizedDomain,
		Query:     query,
		Page:      extractCurrentDetailPage(reply),
		UpdatedAt: time.Now().UTC(),
	}
	telegramCheckSessions.Store(chatID, session)

	return reply, nil
}

func buildTelegramDetailReplyFromSession(chatID int64, action string) (string, error) {
	stored, ok := telegramCheckSessions.Load(chatID)
	if !ok {
		return "", fmt.Errorf("belum ada sesi /cek. Jalankan /cek dulu")
	}

	session, ok := stored.(telegramCheckSession)
	if !ok {
		return "", fmt.Errorf("sesi /cek tidak valid. Jalankan /cek ulang")
	}

	nextPage := session.Page
	switch action {
	case "next":
		nextPage++
	case "back":
		nextPage--
	case "refresh":
	}
	if nextPage < 1 {
		nextPage = 1
	}

	return buildTelegramDetailReply(chatID, session.Query, session.Domain, nextPage)
}

func runTelegramDomainSearch(query string, domain string, limit int) ([]telegramACSResult, []telegramMikroTikResult, error, error) {
	normalizedDomain := domain
	if normalizedDomain == "" {
		normalizedDomain = telegramDomainAll
	}

	switch normalizedDomain {
	case telegramDomainACS:
		acsResults, acsErr := searchACSForTelegram(query, limit)
		return acsResults, nil, acsErr, nil
	case telegramDomainPPP:
		mikroTikResults, mikroTikErr := searchMikroTikForTelegram(query, limit)
		return nil, mikroTikResults, nil, mikroTikErr
	default:
		acsResults, acsErr := searchACSForTelegram(query, limit)
		mikroTikResults, mikroTikErr := searchMikroTikForTelegram(query, limit)
		return acsResults, mikroTikResults, acsErr, mikroTikErr
	}
}

func telegramDomainSearchError(domain string, acsErr error, mikroTikErr error) error {
	normalizedDomain := domain
	if normalizedDomain == "" {
		normalizedDomain = telegramDomainAll
	}

	switch normalizedDomain {
	case telegramDomainACS:
		return acsErr
	case telegramDomainPPP:
		return mikroTikErr
	default:
		if acsErr != nil && mikroTikErr != nil {
			return fmt.Errorf("acs=%v; mikrotik=%v", acsErr, mikroTikErr)
		}
		return nil
	}
}

func telegramDomainLabel(domain string) string {
	switch domain {
	case telegramDomainACS:
		return "ACS"
	case telegramDomainPPP:
		return "PPP/MikroTik"
	default:
		return "ALL"
	}
}

func telegramQueryLabel(query string) string {
	trimmed := strings.TrimSpace(query)
	if trimmed == "" {
		return "*"
	}
	return trimmed
}

func formatTelegramSummaryResults(query string, domain string, acsResults []telegramACSResult, mikroTikResults []telegramMikroTikResult) string {
	total := len(acsResults) + len(mikroTikResults)
	if total == 0 {
		return fmt.Sprintf("📋 Hasil cari %q [%s]:\n\nTidak ada data yang cocok.", telegramQueryLabel(query), telegramDomainLabel(domain))
	}

	var builder strings.Builder
	builder.WriteString(fmt.Sprintf("📋 Hasil cari %q [%s] (%d found):\n\n", telegramQueryLabel(query), telegramDomainLabel(domain), total))

	seq := 1
	if len(acsResults) > 0 {
		builder.WriteString("ACS\n")
		for _, item := range acsResults {
			builder.WriteString(fmt.Sprintf("%d. %s | %s | %s | %s\n", seq, item.PPPoE, item.DeviceID, item.Status, item.IP))
			seq++
		}
	}

	if len(mikroTikResults) > 0 {
		if len(acsResults) > 0 {
			builder.WriteString("\n")
		}
		builder.WriteString("PPP/MikroTik\n")
		for _, item := range mikroTikResults {
			builder.WriteString(fmt.Sprintf("%d. %s | %s | %s | %s\n", seq, item.Name, item.Profile, item.Status, item.IP))
			seq++
		}
	}

	return truncateText(builder.String(), telegramMessageMaxChars)
}

type telegramDetailEntry struct {
	key      string
	acs      *telegramACSResult
	mikroTik *telegramMikroTikResult
}

func formatTelegramDetailResults(query string, domain string, acsResults []telegramACSResult, mikroTikResults []telegramMikroTikResult, requestedPage int) string {
	entries := buildUnifiedTelegramDetailEntries(domain, acsResults, mikroTikResults)

	total := len(entries)
	if total == 0 {
		return fmt.Sprintf("📋 Detail cek %q [%s]:\n\nTidak ada data yang cocok.", telegramQueryLabel(query), telegramDomainLabel(domain))
	}

	totalPages := int(math.Ceil(float64(total) / float64(telegramDetailPageSize)))
	if totalPages < 1 {
		totalPages = 1
	}

	page := requestedPage
	if page < 1 {
		page = 1
	}
	if page > totalPages {
		page = totalPages
	}

	start := (page - 1) * telegramDetailPageSize
	end := start + telegramDetailPageSize
	if end > total {
		end = total
	}

	var builder strings.Builder
	builder.WriteString(fmt.Sprintf("📋 Detail cek %q [%s]\nPage %d/%d (total %d)\n\n", telegramQueryLabel(query), telegramDomainLabel(domain), page, totalPages, total))

	for idx := start; idx < end; idx++ {
		sequence := idx + 1
		entry := entries[idx]
		if entry.acs != nil && entry.mikroTik != nil {
			builder.WriteString("ACS + PPP/MikroTik\n")
		} else if entry.acs != nil {
			builder.WriteString("ACS\n")
		} else {
			builder.WriteString(fmt.Sprintf("PPP/MikroTik %s\n", dashIfEmpty(entry.mikroTik.DeviceHost)))
		}

		if entry.acs != nil {
			item := entry.acs
			builder.WriteString(fmt.Sprintf("%d. id         : %s\n", sequence, item.DeviceID))
			builder.WriteString(fmt.Sprintf("   👤 pppoe    : %s\n", item.PPPoE))
			builder.WriteString(fmt.Sprintf("   ├ 📶 optical : %s\n", item.Optical))
			builder.WriteString(fmt.Sprintf("   ├ ✅ Status  : %s\n", item.Status))
			builder.WriteString(fmt.Sprintf("   ├ 📍 IP      : %s\n", item.IP))
			builder.WriteString(fmt.Sprintf("   └ ⏱ last inform : %s\n", item.LastInform))
			builder.WriteString(fmt.Sprintf("   |- wlan : %s\n\tpasswd: %s\n", item.WLAN, item.WLANPasswd))
		}

		if entry.mikroTik != nil {
			item := entry.mikroTik
			if entry.acs == nil {
				builder.WriteString(fmt.Sprintf("%d. 👤 Name    : %s\n", sequence, item.Name))
				builder.WriteString(fmt.Sprintf("   ├ 🔑 Secret : `%s`\n", item.Secret))
				builder.WriteString(fmt.Sprintf("   ├ 📶 Profile : %s\n", item.Profile))
				builder.WriteString(fmt.Sprintf("   ├ ✅ Status  : %s\n", item.Status))
				builder.WriteString(fmt.Sprintf("   ├ 📍 IP      : %s\n", item.IP))
				builder.WriteString(fmt.Sprintf("   └ ⏱ Uptime  : %s\n", item.Uptime))
			} else {
				builder.WriteString(fmt.Sprintf("   ├ 🖥️ MikroTik : %s\n", dashIfEmpty(item.DeviceHost)))
				builder.WriteString(fmt.Sprintf("   ├ 👤 Name    : %s\n", item.Name))
				builder.WriteString(fmt.Sprintf("   ├ 🔑 Secret : `%s`\n", item.Secret))
				builder.WriteString(fmt.Sprintf("   ├ 📶 Profile : %s\n", item.Profile))
				builder.WriteString(fmt.Sprintf("   ├ ✅ Status  : %s\n", item.Status))
				builder.WriteString(fmt.Sprintf("   ├ 📍 IP      : %s\n", item.IP))
				builder.WriteString(fmt.Sprintf("   └ ⏱ Uptime  : %s\n", item.Uptime))
			}
		}

		if idx < end-1 {
			builder.WriteString("\n")
		}
	}

	builder.WriteString("\nNavigasi: /next | /back | /refresh")

	return truncateText(builder.String(), telegramMessageMaxChars)
}

func buildUnifiedTelegramDetailEntries(domain string, acsResults []telegramACSResult, mikroTikResults []telegramMikroTikResult) []telegramDetailEntry {
	switch domain {
	case telegramDomainACS:
		entries := make([]telegramDetailEntry, 0, len(acsResults))
		for _, item := range acsResults {
			itemCopy := item
			entries = append(entries, telegramDetailEntry{key: normalizeTelegramAccountKey(item.PPPoE), acs: &itemCopy})
		}
		return entries
	case telegramDomainPPP:
		entries := make([]telegramDetailEntry, 0, len(mikroTikResults))
		for _, item := range mikroTikResults {
			itemCopy := item
			entries = append(entries, telegramDetailEntry{key: normalizeTelegramAccountKey(item.Name), mikroTik: &itemCopy})
		}
		return entries
	}

	mikroTikBuckets := make(map[string][]telegramMikroTikResult, len(mikroTikResults))
	for _, item := range mikroTikResults {
		key := normalizeTelegramAccountKey(item.Name)
		mikroTikBuckets[key] = append(mikroTikBuckets[key], item)
	}

	entries := make([]telegramDetailEntry, 0, len(acsResults)+len(mikroTikResults))
	for _, acsItem := range acsResults {
		key := normalizeTelegramAccountKey(acsItem.PPPoE)
		acsCopy := acsItem
		entry := telegramDetailEntry{key: key, acs: &acsCopy}

		if bucket, ok := mikroTikBuckets[key]; ok && len(bucket) > 0 {
			mikroTikCopy := bucket[0]
			entry.mikroTik = &mikroTikCopy
			if len(bucket) == 1 {
				delete(mikroTikBuckets, key)
			} else {
				mikroTikBuckets[key] = bucket[1:]
			}
		}

		entries = append(entries, entry)
	}

	for _, mikroTikItem := range mikroTikResults {
		key := normalizeTelegramAccountKey(mikroTikItem.Name)
		bucket, ok := mikroTikBuckets[key]
		if !ok || len(bucket) == 0 {
			continue
		}

		mikroTikCopy := bucket[0]
		entries = append(entries, telegramDetailEntry{key: key, mikroTik: &mikroTikCopy})

		if len(bucket) == 1 {
			delete(mikroTikBuckets, key)
		} else {
			mikroTikBuckets[key] = bucket[1:]
		}
	}

	return entries
}

func normalizeTelegramAccountKey(value string) string {
	trimmed := strings.ToLower(strings.TrimSpace(value))
	if trimmed == "" {
		return ""
	}

	trimmed = strings.ReplaceAll(trimmed, " ", "")
	trimmed = strings.ReplaceAll(trimmed, "`", "")
	return trimmed
}

func extractCurrentDetailPage(message string) int {
	for _, line := range strings.Split(message, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "Page ") {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		pageInfo := strings.TrimSpace(parts[1])
		pagePart := strings.Split(pageInfo, "/")[0]
		page, err := strconv.Atoi(strings.TrimSpace(pagePart))
		if err == nil && page > 0 {
			return page
		}
	}

	return 1
}

func (b *telegramBot) sendMessage(chatID int64, text string) error {
	endpoint := fmt.Sprintf("%s/sendMessage", b.apiBase)
	body, err := json.Marshal(telegramSendMessageRequest{
		ChatID:                chatID,
		Text:                  truncateText(text, telegramMessageMaxChars),
		DisableWebPagePreview: true,
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := b.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("telegram sendMessage status=%d body=%s", resp.StatusCode, truncateText(string(respBody), 500))
	}

	return nil
}

func truncateText(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	if limit <= 3 {
		return text[:limit]
	}
	return text[:limit-3] + "..."
}

func buildTelegramSearchReply(query string) (string, error) {
	acsResults, acsErr := searchACSForTelegram(query, telegramPerDomainMax)
	mikroTikResults, mErr := searchMikroTikForTelegram(query, telegramPerDomainMax)

	if acsErr != nil && mErr != nil {
		return "", fmt.Errorf("acs=%v; mikrotik=%v", acsErr, mErr)
	}

	return formatTelegramResults(query, acsResults, mikroTikResults), nil
}

func searchACSForTelegram(query string, limit int) ([]telegramACSResult, error) {
	genieACSURL, err := getGenieACSURL()
	if err != nil {
		return nil, err
	}

	projection := []string{
		"_id",
		"_lastInform",
		"_deviceId._ProductClass",
		"_deviceId._SerialNumber",
		"_deviceId._Manufacturer",
		"_virtualParameters.pppoeUsername.value",
		"_virtualParameters.pppoeUsername2.value",
		"_virtualParameters.PPPoEUsername.value",
		"_virtualParameters.PPPoE Username.value",
		"_virtualParameters.pppoeIP.value",
		"_virtualParameters.IP PPPOE.value",
		"_virtualParameters.IPTR069.value",
		"_virtualParameters.IP TR069.value",
		"_virtualParameters.wifiPassword.value",
		"_virtualParameters.WlanPassword.value",
		"_virtualParameters.WiFiPassword.value",
		"_virtualParameters.WiFi Password.value",
		"_virtualParameters.SSIDPassword.value",
		"_virtualParameters.SSID Password.value",
		"_virtualParameters.RXPower.value",
		"_virtualParameters.rxPower.value",
		"_virtualParameters.OpticRxPower.value",
		"_virtualParameters.Optic Rx Power.value",
		"_virtualParameters.opticalRxPower.value",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration",
		"Device.WiFi.AccessPoint",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_HW_WANPONInterfaceConfig.RXPower",
	}
	projection = mergeStringLists(projection, allVendorProjectionPaths())

	devices, err := fetchGenieACSDevices(genieACSURL, projection, "")
	if err != nil {
		return nil, err
	}

	term := strings.ToLower(strings.TrimSpace(query))
	results := make([]telegramACSResult, 0, limit)

	for _, device := range devices {
		if term != "" && !strings.Contains(deviceSearchText(device), term) {
			continue
		}

		vendor := extractStringFromDevice(device, []string{"_Manufacturer", "Manufacturer", "vendor", "Vendor"})
		deviceType := extractStringFromDevice(device, []string{"_ProductClass", "ProductClass", "deviceModel", "Model"})
		vendorProfile := resolveVendorProfileForDevice(device, vendor, deviceType).Profile

		pppoe := dashIfEmpty(extractPPPoEUsername(device, vendorProfile.PPPoEUsernameKeys))
		ip := dashIfEmpty(firstNonEmpty(extractPPPoEIP(device), extractTR069IP(device)))

		optical := "-"
		if rxPower, ok := extractRXPowerFromDevice(device); ok {
			optical = fmt.Sprintf("%.2f", math.Round(rxPower*100)/100)
		}

		status := "Offline"
		lastInformText := "-"
		lastInformAt := time.Time{}
		if informedAt, ok := parseLastInform(device); ok {
			lastInformAt = informedAt
			if time.Since(informedAt) <= 24*time.Hour {
				status = "Active"
			}
			lastInformText = formatElapsedSince(informedAt)
		}

		wifiProfiles := extractWiFiProfiles(device, vendorProfile.WiFiPasswordKeys)
		activeWiFi := extractActiveWiFiProfiles(wifiProfiles)
		if len(activeWiFi) > 0 {
			wifiProfiles = activeWiFi
		}

		ssid := "-"
		wifiPassword := "-"
		if len(wifiProfiles) > 0 {
			ssid = dashIfEmpty(extractStringValue(wifiProfiles[0]["ssid"]))
			if value := strings.TrimSpace(extractStringValue(wifiProfiles[0]["password"])); value != "" {
				wifiPassword = value
			}
		}
		if wifiPassword == "-" {
			if virtualPassword := strings.TrimSpace(extractVirtualWiFiPassword(device)); virtualPassword != "" {
				wifiPassword = virtualPassword
			}
		}

		results = append(results, telegramACSResult{
			DeviceID:    dashIfEmpty(extractStringFromDevice(device, []string{"_id"})),
			Serial:      dashIfEmpty(extractStringFromDevice(device, []string{"_SerialNumber", "SerialNumber", "serialNumber"})),
			VendorType:  dashIfEmpty(strings.Trim(strings.TrimSpace(compactVendorName(vendor, vendorProfile.Key))+"/"+strings.TrimSpace(deviceType), "/")),
			PPPoE:       pppoe,
			Optical:     optical,
			Status:      status,
			IP:          ip,
			LastInform:  lastInformText,
			WLAN:        ssid,
			WLANPasswd:  wifiPassword,
			LastInformT: lastInformAt,
		})

		if limit > 0 && len(results) >= limit {
			break
		}
	}

	return results, nil
}

func searchMikroTikForTelegram(query string, limit int) ([]telegramMikroTikResult, error) {
	devices, err := db.ListMikroTikDevices("", "", 0)
	if err != nil {
		return nil, err
	}

	term := strings.ToLower(strings.TrimSpace(query))
	results := make([]telegramMikroTikResult, 0, limit)

	for _, device := range devices {
		secrets, err := services.GetMikroTikService().ListPPPSecrets(device.ID)
		if err != nil {
			continue
		}

		activeSessions, _ := services.GetMikroTikService().ListPPPActive(device.ID)
		activeByName := make(map[string]map[string]interface{}, len(activeSessions))
		for _, active := range activeSessions {
			name := normalizeTelegramAccountKey(extractStringValue(active["name"]))
			if name != "" {
				activeByName[name] = active
			}
		}

		for _, secret := range secrets {
			name := strings.TrimSpace(extractStringValue(secret["name"]))
			profile := strings.TrimSpace(extractStringValue(secret["profile"]))
			comment := strings.TrimSpace(extractStringValue(secret["comment"]))
			password := strings.TrimSpace(extractStringValue(secret["password"]))

			if term != "" {
				searchText := strings.ToLower(strings.Join([]string{name, profile, comment, device.Name, device.Host}, " "))
				if !strings.Contains(searchText, term) {
					continue
				}
			}

			status := "Offline"
			ip := "-"
			uptime := "-"
			if active, ok := activeByName[normalizeTelegramAccountKey(name)]; ok {
				status = "Active"
				ip = dashIfEmpty(extractStringValue(active["address"]))
				uptime = dashIfEmpty(formatMikroTikUptime(extractStringValue(active["uptime"])))
			}

			if password == "" {
				password = "-"
			}
			if profile == "" {
				profile = "-"
			}

			results = append(results, telegramMikroTikResult{
				DeviceHost: strings.TrimSpace(device.Host),
				Name:       dashIfEmpty(name),
				Secret:     password,
				Profile:    profile,
				Status:     status,
				IP:         ip,
				Uptime:     uptime,
			})

			if limit > 0 && len(results) >= limit {
				return results, nil
			}
		}
	}

	return results, nil
}

func formatElapsedSince(informedAt time.Time) string {
	delta := time.Since(informedAt)
	if delta < 0 {
		delta = 0
	}

	seconds := int64(delta.Seconds())
	hours := seconds / 3600
	seconds %= 3600
	minutes := seconds / 60
	seconds %= 60

	return fmt.Sprintf("%d Hr %d Min %d Sec", hours, minutes, seconds)
}

func formatTelegramResults(query string, acsResults []telegramACSResult, mikroTikResults []telegramMikroTikResult) string {
	total := len(acsResults) + len(mikroTikResults)
	if total == 0 {
		return fmt.Sprintf("📋 Results for %q:\n\nTidak ada data yang cocok.", query)
	}

	var builder strings.Builder
	builder.WriteString(fmt.Sprintf("📋 Results for %q (%d found):\n\n", query, total))

	sequence := 1
	if len(acsResults) > 0 {
		builder.WriteString("ACS\n")
		for _, item := range acsResults {
			builder.WriteString(fmt.Sprintf("%d. id         : %s\n", sequence, item.DeviceID))
			builder.WriteString(fmt.Sprintf("   👤 pppoe    : %s\n", item.PPPoE))
			builder.WriteString(fmt.Sprintf("   ├ 📶 optical : %s\n", item.Optical))
			builder.WriteString(fmt.Sprintf("   ├ ✅ Status  : %s\n", item.Status))
			builder.WriteString(fmt.Sprintf("   ├ 📍 IP      : %s\n", item.IP))
			builder.WriteString(fmt.Sprintf("   └ ⏱ last inform : %s\n", item.LastInform))
			builder.WriteString(fmt.Sprintf("   |- wlan : %s\n\tpasswd: %s\n", item.WLAN, item.WLANPasswd))
			sequence++
		}
	}

	if len(mikroTikResults) > 0 {
		if len(acsResults) > 0 {
			builder.WriteString("\n")
		}
		for _, item := range mikroTikResults {
			builder.WriteString(fmt.Sprintf("🖥️ MikroTik %s\n", dashIfEmpty(item.DeviceHost)))
			builder.WriteString(fmt.Sprintf("%d. 👤 Name    : %s\n", sequence, item.Name))
			builder.WriteString(fmt.Sprintf("   ├ 🔑 Secret : `%s`\n", item.Secret))
			builder.WriteString(fmt.Sprintf("   ├ 📶 Profile : %s\n", item.Profile))
			builder.WriteString(fmt.Sprintf("   ├ ✅ Status  : %s\n", item.Status))
			builder.WriteString(fmt.Sprintf("   ├ 📍 IP      : %s\n", item.IP))
			builder.WriteString(fmt.Sprintf("   └ ⏱ Uptime  : %s\n", item.Uptime))
			sequence++
		}
	}

	return truncateText(builder.String(), telegramMessageMaxChars)
}
