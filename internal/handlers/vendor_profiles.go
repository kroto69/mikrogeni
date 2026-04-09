package handlers

import "genieacs-backend/internal/acsresolver"

type vendorParameterProfile = acsresolver.Profile
type vendorProfileResolution = acsresolver.Resolution

func resolveVendorProfile(vendor string, productClass string) vendorParameterProfile {
	return acsresolver.ResolveVendorProfile(vendor, productClass)
}

func resolveVendorProfileForDevice(device map[string]interface{}, vendor string, productClass string) vendorProfileResolution {
	return acsresolver.ResolveVendorProfileForDevice(device, vendor, productClass, acsresolver.StringExtractor{
		ExtractStringFromDevice: extractStringFromDevice,
		ExtractStringByPaths:    extractStringByPaths,
		ExtractValueByPath: func(device map[string]interface{}, path string) (interface{}, bool) {
			return extractValueByPath(device, path)
		},
		ExtractValueByKey: extractValueByKey,
	})
}

func allVendorProjectionPaths() []string {
	return acsresolver.AllVendorProjectionPaths()
}

func mergeStringLists(primary []string, secondary []string) []string {
	return acsresolver.MergeStringLists(primary, secondary)
}
