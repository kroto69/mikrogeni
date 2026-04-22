package acsresolver

import (
	"strings"
	"sync"

	"genieacs-backend/internal/db"
)

var learnedProfileCache sync.Map

func ResolveVendorProfile(vendor string, productClass string) Profile {
	if learnedProfile, ok := resolveLearnedVendorProfile(vendor, productClass); ok {
		return learnedProfile
	}

	vendorKey := strings.ToLower(strings.TrimSpace(vendor + " " + productClass))
	for _, profile := range vendorProfiles {
		for _, token := range profile.MatchTokens {
			if strings.Contains(vendorKey, strings.ToLower(strings.TrimSpace(token))) {
				return mergeProfile(defaultProfile, profile)
			}
		}
	}

	return defaultProfile
}

func ResolveVendorProfileForDevice(device map[string]interface{}, vendor string, productClass string, extractor StringExtractor) Resolution {
	staticProfile := ResolveVendorProfile(vendor, productClass)
	staticRawProfile, _ := rawProfileByKey(staticProfile.Key)
	if staticRawProfile.Key == "" {
		staticRawProfile = staticProfile
	}

	if staticProfile.Key != defaultProfile.Key && hasExplicitVendorMatch(vendor, staticRawProfile) {
		return Resolution{Profile: staticProfile, Source: "static"}
	}

	staticScore := scoreVendorProfileSignals(device, staticRawProfile, extractor)

	autoProfile, autoScore, ok := autoSummonVendorProfile(device, extractor)
	if !ok {
		return Resolution{Profile: staticProfile, Source: "static"}
	}

	if staticProfile.Key == defaultProfile.Key {
		cacheLearnedVendorProfile(vendor, productClass, autoProfile, autoScore)
		return Resolution{Profile: autoProfile, Source: "auto_summoned"}
	}

	if autoProfile.Key == staticProfile.Key {
		return Resolution{Profile: staticProfile, Source: "static"}
	}

	if autoScore >= staticScore+2 {
		cacheLearnedVendorProfile(vendor, productClass, autoProfile, autoScore)
		return Resolution{Profile: autoProfile, Source: "auto_summoned"}
	}

	return Resolution{Profile: staticProfile, Source: "static"}
}

type StringExtractor struct {
	ExtractStringFromDevice func(map[string]interface{}, []string) string
	ExtractStringByPaths    func(map[string]interface{}, []string) string
	ExtractValueByPath      func(map[string]interface{}, string) (interface{}, bool)
	ExtractValueByKey       func(interface{}, string) (interface{}, bool)
}

func resolveLearnedVendorProfile(vendor string, productClass string) (Profile, bool) {
	cacheKey := normalizeLearnedVendorCacheKey(vendor, productClass)
	if cacheKey == "|" {
		return Profile{}, false
	}

	if cached, ok := learnedProfileCache.Load(cacheKey); ok {
		if profile, ok := cached.(Profile); ok && profile.Key != "" {
			return profile, true
		}
	}

	profileKey, _, err := db.GetACSLearnedProfile(vendor, productClass)
	if err != nil || strings.TrimSpace(profileKey) == "" {
		return Profile{}, false
	}

	rawProfile, ok := rawProfileByKey(profileKey)
	if !ok {
		return Profile{}, false
	}

	merged := mergeProfile(defaultProfile, rawProfile)
	learnedProfileCache.Store(cacheKey, merged)
	return merged, true
}

func cacheLearnedVendorProfile(vendor string, productClass string, profile Profile, score int) {
	if strings.TrimSpace(profile.Key) == "" || strings.EqualFold(profile.Key, defaultProfile.Key) {
		return
	}
	cacheKey := normalizeLearnedVendorCacheKey(vendor, productClass)
	if cacheKey == "|" {
		return
	}
	merged := mergeProfile(defaultProfile, profile)
	learnedProfileCache.Store(cacheKey, merged)
	_ = db.UpsertACSLearnedProfile(vendor, productClass, profile.Key, score)
}

func normalizeLearnedVendorCacheKey(vendor string, productClass string) string {
	return strings.ToLower(strings.TrimSpace(vendor)) + "|" + strings.ToLower(strings.TrimSpace(productClass))
}

func hasExplicitVendorMatch(vendor string, profile Profile) bool {
	vendorKey := strings.ToLower(strings.TrimSpace(vendor))
	if vendorKey == "" {
		return false
	}

	profileKey := strings.ToLower(strings.TrimSpace(profile.Key))
	if profileKey != "" && strings.Contains(vendorKey, profileKey) {
		return true
	}

	for _, token := range profile.MatchTokens {
		trimmedToken := strings.ToLower(strings.TrimSpace(token))
		if trimmedToken == "" {
			continue
		}
		if strings.Contains(vendorKey, trimmedToken) {
			return true
		}
	}

	return false
}

func autoSummonVendorProfile(device map[string]interface{}, extractor StringExtractor) (Profile, int, bool) {
	bestScore := 0
	var bestProfile Profile

	for _, profile := range vendorProfiles {
		score := scoreVendorProfileSignals(device, profile, extractor)
		if score > bestScore {
			bestScore = score
			bestProfile = profile
		}
	}

	if bestScore < 3 {
		return Profile{}, 0, false
	}

	return mergeProfile(defaultProfile, bestProfile), bestScore, true
}

func scoreVendorProfileSignals(device map[string]interface{}, profile Profile, extractor StringExtractor) int {
	if len(profile.MatchTokens) == 0 && profile.Key == "" {
		return 0
	}

	score := 0
	score += scoreCandidateSignals(device, profile.PPPoEUsernameKeys, 1, 2, extractor)
	score += scoreCandidateSignals(device, profile.PPPoEPasswordKeys, 1, 2, extractor)
	score += scorePathSignals(device, profile.WebAdminUsernamePath, 1, 2, extractor)
	score += scorePathSignals(device, profile.WebAdminPasswordPath, 2, 3, extractor)
	score += scorePathSignals(device, profile.WebUserPasswordPath, 1, 2, extractor)
	score += scoreCandidateSignals(device, profile.WiFiPasswordKeys, 1, 2, extractor)
	if hasAnyPath(device, profile.ProjectionPaths, extractor) {
		score += 1
	}

	return score
}

func scoreCandidateSignals(device map[string]interface{}, candidates []string, presenceWeight int, nonEmptyWeight int, extractor StringExtractor) int {
	score := 0
	if hasAnyCandidate(device, candidates, extractor) {
		score += presenceWeight
	}
	if extractor.ExtractStringFromDevice != nil && strings.TrimSpace(extractor.ExtractStringFromDevice(device, candidates)) != "" {
		score += nonEmptyWeight
	}
	return score
}

func scorePathSignals(device map[string]interface{}, paths []string, presenceWeight int, nonEmptyWeight int, extractor StringExtractor) int {
	score := 0
	if hasAnyPath(device, paths, extractor) {
		score += presenceWeight
	}
	if extractor.ExtractStringByPaths != nil && strings.TrimSpace(extractor.ExtractStringByPaths(device, paths)) != "" {
		score += nonEmptyWeight
	}
	return score
}

func hasAnyCandidate(device map[string]interface{}, candidates []string, extractor StringExtractor) bool {
	for _, candidate := range candidates {
		trimmed := strings.TrimSpace(candidate)
		if trimmed == "" {
			continue
		}

		if strings.Contains(trimmed, ".") {
			if extractor.ExtractValueByPath != nil {
				if _, ok := extractor.ExtractValueByPath(device, trimmed); ok {
					return true
				}
			}
			continue
		}

		if extractor.ExtractValueByKey != nil {
			if _, ok := extractor.ExtractValueByKey(device, trimmed); ok {
				return true
			}
		}
	}

	return false
}

func hasAnyPath(device map[string]interface{}, paths []string, extractor StringExtractor) bool {
	for _, path := range paths {
		trimmed := strings.TrimSpace(path)
		if trimmed == "" {
			continue
		}
		if extractor.ExtractValueByPath != nil {
			if _, ok := extractor.ExtractValueByPath(device, trimmed); ok {
				return true
			}
		}
	}

	return false
}

func rawProfileByKey(key string) (Profile, bool) {
	trimmed := strings.TrimSpace(strings.ToLower(key))
	for _, profile := range vendorProfiles {
		if strings.ToLower(strings.TrimSpace(profile.Key)) == trimmed {
			return profile, true
		}
	}

	if strings.ToLower(defaultProfile.Key) == trimmed {
		return Profile{}, true
	}

	return Profile{}, false
}

func mergeProfile(base Profile, override Profile) Profile {
	merged := base
	if override.Key != "" {
		merged.Key = override.Key
	}
	merged.MatchTokens = MergeStringLists(base.MatchTokens, override.MatchTokens)
	merged.PPPoEUsernameKeys = MergeStringLists(base.PPPoEUsernameKeys, override.PPPoEUsernameKeys)
	merged.PPPoEPasswordKeys = MergeStringLists(base.PPPoEPasswordKeys, override.PPPoEPasswordKeys)
	merged.WebAdminUsernamePath = MergeStringLists(base.WebAdminUsernamePath, override.WebAdminUsernamePath)
	merged.WebAdminPasswordPath = MergeStringLists(base.WebAdminPasswordPath, override.WebAdminPasswordPath)
	merged.WebUserPasswordPath = MergeStringLists(base.WebUserPasswordPath, override.WebUserPasswordPath)
	merged.WiFiPasswordKeys = MergeStringLists(base.WiFiPasswordKeys, override.WiFiPasswordKeys)
	merged.ProjectionPaths = MergeStringLists(base.ProjectionPaths, override.ProjectionPaths)
	return merged
}

func MergeStringLists(primary []string, secondary []string) []string {
	result := make([]string, 0, len(primary)+len(secondary))
	seen := make(map[string]struct{})

	appendList := func(list []string) {
		for _, value := range list {
			trimmed := strings.TrimSpace(value)
			if trimmed == "" {
				continue
			}
			if _, ok := seen[trimmed]; ok {
				continue
			}
			seen[trimmed] = struct{}{}
			result = append(result, trimmed)
		}
	}

	appendList(primary)
	appendList(secondary)

	return result
}

func AllVendorProjectionPaths() []string {
	paths := make([]string, 0, len(defaultProfile.ProjectionPaths))
	paths = append(paths, defaultProfile.ProjectionPaths...)
	for _, profile := range vendorProfiles {
		paths = MergeStringLists(paths, profile.ProjectionPaths)
	}
	return paths
}

func HasProfileKey(key string) bool {
	trimmed := strings.TrimSpace(strings.ToLower(key))
	if trimmed == "" {
		return false
	}
	if strings.ToLower(strings.TrimSpace(defaultProfile.Key)) == trimmed {
		return true
	}
	for _, profile := range vendorProfiles {
		if strings.ToLower(strings.TrimSpace(profile.Key)) == trimmed {
			return true
		}
	}
	return false
}

func ForgetLearnedProfile(vendor, productClass string) {
	learnedProfileCache.Delete(normalizeLearnedVendorCacheKey(vendor, productClass))
}
