package handlers

import (
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"time"
)

// hiosoWebLogin login ke web OLT dan mengembalikan cookie jar sesi.
func hiosoWebLogin(host, port, user, pass string) (http.CookieJar, error) {
	host = strings.TrimSpace(host)
	port = strings.TrimSpace(port)
	user = strings.TrimSpace(user)
	if host == "" || user == "" || strings.TrimSpace(pass) == "" {
		return nil, fmt.Errorf("parameter login web OLT tidak lengkap")
	}

	baseURL := hiosoBuildWebBaseURL(host, port)

	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, fmt.Errorf("gagal buat cookie jar: %w", err)
	}

	endpoint := baseURL + "/goform/login"
	form := url.Values{}
	form.Set("user", user)
	form.Set("pass", pass)
	form.Set("username", user)
	form.Set("password", pass)
	form.Set("submit", "Login")

	req, err := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("gagal buat request login: %w", err)
	}
	authBasic := base64.StdEncoding.EncodeToString([]byte(user + ":" + pass))
	req.Header.Set("Authorization", "Basic "+authBasic)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 10 * time.Second, Jar: jar}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("login web OLT gagal: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusFound {
		return nil, fmt.Errorf("login web OLT gagal status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	return jar, nil
}

func hiosoBuildWebBaseURL(host, port string) string {
	host = strings.TrimSpace(host)
	port = strings.TrimSpace(port)
	if host == "" {
		return ""
	}
	if port == "" {
		port = "80"
	}

	if strings.HasPrefix(host, "http://") || strings.HasPrefix(host, "https://") {
		parsed, err := url.Parse(host)
		if err == nil && parsed.Host != "" {
			if parsed.Port() == "" {
				parsed.Host = net.JoinHostPort(parsed.Hostname(), port)
			}
			parsed.Path = ""
			parsed.RawQuery = ""
			parsed.Fragment = ""
			return strings.TrimRight(parsed.String(), "/")
		}
	}

	if _, _, err := net.SplitHostPort(host); err == nil {
		return "http://" + host
	}

	return "http://" + net.JoinHostPort(host, port)
}

// HiosoRenameONU rename ONU. Prioritas SNMP, fallback ke Web API bila SNMP gagal.
func HiosoRenameONU(target SNMPTarget, webHost, webPort, index, newName, user, pass string) (string, error) {
	webHost = strings.TrimSpace(webHost)
	webPort = strings.TrimSpace(webPort)
	index = strings.TrimSpace(index)
	newName = hiosoTruncateName(strings.TrimSpace(newName), 31)

	if target.Host == "" || target.Community == "" || webHost == "" || index == "" || newName == "" {
		return "", fmt.Errorf("parameter rename ONU tidak lengkap")
	}

	var snmpErr error
	if profile, err := hiosoGetOrDetectProfile(target); err == nil {
		targetOID := strings.TrimSuffix(profile.NameOID, ".") + "." + strings.TrimPrefix(index, ".")
		if errSet := hiosoSNMPSet(target, targetOID, newName); errSet == nil {
			return "SNMP", nil
		} else {
			snmpErr = errSet
		}
	} else {
		snmpErr = err
	}

	jar, err := hiosoWebLogin(webHost, webPort, user, pass)
	if err != nil {
		if snmpErr != nil {
			return "", fmt.Errorf("SNMP gagal: %v; Web login gagal: %w", snmpErr, err)
		}
		return "", err
	}

	form := url.Values{}
	form.Set("onuId", hiosoResolveWebID(index))
	form.Set("onuName", newName)
	form.Set("onuOperation", "modifyOnu")

	endpoint := hiosoBuildWebBaseURL(webHost, webPort) + "/goform/setOnu"
	req, err := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("gagal buat request rename web: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 10 * time.Second, Jar: jar}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("rename via web gagal: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusFound {
		return "Web", nil
	}

	body, _ := io.ReadAll(resp.Body)
	if snmpErr != nil {
		return "", fmt.Errorf("SNMP gagal: %v; rename web gagal status=%d body=%s", snmpErr, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return "", fmt.Errorf("rename web gagal status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
}

// HiosoRebootONU reboot ONU lewat Web API (tidak ada SNMP OID reboot).
func HiosoRebootONU(host, port, index, user, pass string) error {
	host = strings.TrimSpace(host)
	port = strings.TrimSpace(port)
	index = strings.TrimSpace(index)
	if host == "" || index == "" || strings.TrimSpace(user) == "" || strings.TrimSpace(pass) == "" {
		return fmt.Errorf("parameter reboot ONU tidak lengkap")
	}

	jar, err := hiosoWebLogin(host, port, user, pass)
	if err != nil {
		return err
	}

	form := url.Values{}
	form.Set("onuId", hiosoResolveWebID(index))
	form.Set("onuName", "rebooter")
	form.Set("onuOperation", "rebootOp")

	endpoint := hiosoBuildWebBaseURL(host, port) + "/goform/setOnu"
	req, err := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return fmt.Errorf("gagal buat request reboot web: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 10 * time.Second, Jar: jar}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("reboot web gagal: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusFound {
		return nil
	}
	body, _ := io.ReadAll(resp.Body)
	return fmt.Errorf("reboot web gagal status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
}

func hiosoTruncateName(value string, maxLen int) string {
	trimmed := strings.TrimSpace(value)
	if maxLen <= 0 {
		return ""
	}
	runes := []rune(trimmed)
	if len(runes) <= maxLen {
		return trimmed
	}
	return string(runes[:maxLen])
}
