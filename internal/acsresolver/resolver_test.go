package acsresolver

import "testing"

func TestResolveVendorProfile_ZTE(t *testing.T) {
	profile := ResolveVendorProfile("ZTE", "F670L")
	if profile.Key != "zte" {
		t.Fatalf("expected zte profile, got %q", profile.Key)
	}

	foundWAN2 := false
	for _, path := range profile.ProjectionPaths {
		if path == "InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig.RXPower" {
			foundWAN2 = true
			break
		}
	}
	if !foundWAN2 {
		t.Fatalf("expected WANDevice.2 ZTE RX path in projection paths")
	}
}

func TestMergeStringLists_Deduplicates(t *testing.T) {
	merged := MergeStringLists([]string{"a", "b", "a"}, []string{"b", "c", ""})
	if len(merged) != 3 {
		t.Fatalf("expected 3 unique values, got %d: %#v", len(merged), merged)
	}
	if merged[0] != "a" || merged[1] != "b" || merged[2] != "c" {
		t.Fatalf("unexpected merge order/result: %#v", merged)
	}
}
