package acsresolver

import (
	_ "embed"
	"fmt"
	"strings"
	"sync"

	"gopkg.in/yaml.v3"
)

//go:embed registry.yaml
var registryYAML []byte

type Profile struct {
	Key                  string   `yaml:"key"`
	MatchTokens          []string `yaml:"match_tokens"`
	PPPoEUsernameKeys    []string `yaml:"pppoe_username_keys"`
	PPPoEPasswordKeys    []string `yaml:"pppoe_password_keys"`
	WebAdminUsernamePath []string `yaml:"web_admin_username_path"`
	WebAdminPasswordPath []string `yaml:"web_admin_password_path"`
	WebUserPasswordPath  []string `yaml:"web_user_password_path"`
	WiFiPasswordKeys     []string `yaml:"wifi_password_keys"`
	ProjectionPaths      []string `yaml:"projection_paths"`
}

type Resolution struct {
	Profile Profile
	Source  string
}

type registryConfig struct {
	Default Profile   `yaml:"default"`
	Vendors []Profile `yaml:"vendors"`
}

var loadOnce sync.Once
var loadErr error
var defaultProfile Profile
var vendorProfiles []Profile

func init() {
	if err := loadRegistry(); err != nil {
		panic(fmt.Sprintf("failed to load ACS registry: %v", err))
	}
}

func loadRegistry() error {
	loadOnce.Do(func() {
		var cfg registryConfig
		if err := yaml.Unmarshal(registryYAML, &cfg); err != nil {
			loadErr = err
			return
		}

		cfg.Default = normalizeProfile(cfg.Default)
		if cfg.Default.Key == "" {
			cfg.Default.Key = "generic"
		}

		loadedProfiles := make([]Profile, 0, len(cfg.Vendors))
		seenKeys := map[string]struct{}{}
		for _, profile := range cfg.Vendors {
			normalized := normalizeProfile(profile)
			if normalized.Key == "" {
				loadErr = fmt.Errorf("registry vendor profile key is required")
				return
			}
			key := strings.ToLower(normalized.Key)
			if _, exists := seenKeys[key]; exists {
				loadErr = fmt.Errorf("duplicate registry vendor profile key: %s", normalized.Key)
				return
			}
			seenKeys[key] = struct{}{}
			loadedProfiles = append(loadedProfiles, normalized)
		}

		defaultProfile = cfg.Default
		vendorProfiles = loadedProfiles
	})

	return loadErr
}

func normalizeProfile(profile Profile) Profile {
	profile.Key = strings.TrimSpace(profile.Key)
	profile.MatchTokens = trimStringList(profile.MatchTokens)
	profile.PPPoEUsernameKeys = trimStringList(profile.PPPoEUsernameKeys)
	profile.PPPoEPasswordKeys = trimStringList(profile.PPPoEPasswordKeys)
	profile.WebAdminUsernamePath = trimStringList(profile.WebAdminUsernamePath)
	profile.WebAdminPasswordPath = trimStringList(profile.WebAdminPasswordPath)
	profile.WebUserPasswordPath = trimStringList(profile.WebUserPasswordPath)
	profile.WiFiPasswordKeys = trimStringList(profile.WiFiPasswordKeys)
	profile.ProjectionPaths = trimStringList(profile.ProjectionPaths)
	return profile
}

func trimStringList(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

func DefaultProfile() Profile { return defaultProfile }
func Profiles() []Profile {
	result := make([]Profile, len(vendorProfiles))
	copy(result, vendorProfiles)
	return result
}
