package handlers

import "testing"

func TestHiosoResolveSNMPTarget(t *testing.T) {
	tests := []struct {
		name     string
		host     string
		port     string
		wantHost string
		wantPort uint16
		wantErr  bool
	}{
		{
			name:     "plain host with default port",
			host:     "10.10.10.1",
			port:     "161",
			wantHost: "10.10.10.1",
			wantPort: 161,
		},
		{
			name:     "host with explicit port",
			host:     "10.10.10.1:1161",
			port:     "161",
			wantHost: "10.10.10.1",
			wantPort: 1161,
		},
		{
			name:     "url host with explicit port",
			host:     "http://10.10.10.1:2161",
			port:     "161",
			wantHost: "10.10.10.1",
			wantPort: 2161,
		},
		{
			name:    "empty host rejected",
			host:    "",
			port:    "161",
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			host, port, err := hiosoResolveSNMPTarget(tc.host, tc.port)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got none (host=%s port=%d)", host, port)
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if host != tc.wantHost {
				t.Fatalf("unexpected host: got %q want %q", host, tc.wantHost)
			}
			if port != tc.wantPort {
				t.Fatalf("unexpected port: got %d want %d", port, tc.wantPort)
			}
		})
	}
}

func TestHiosoHasMeaningfulSNMPValues(t *testing.T) {
	if hiosoHasMeaningfulSNMPValues(map[string]string{"1": "No Such Object available on this agent at this OID"}) {
		t.Fatal("expected no meaningful values for no-such-object response")
	}

	if hiosoHasMeaningfulSNMPValues(map[string]string{"1": "End of MIB View"}) {
		t.Fatal("expected no meaningful values for end-of-mib response")
	}

	if !hiosoHasMeaningfulSNMPValues(map[string]string{"1": "HIOSO EPON OLT"}) {
		t.Fatal("expected meaningful value for real sysDescr")
	}
}

func TestHiosoEnsureScalarOID(t *testing.T) {
	if got := hiosoEnsureScalarOID(".1.3.6.1.2.1.1.1"); got != ".1.3.6.1.2.1.1.1.0" {
		t.Fatalf("unexpected scalar oid conversion: %s", got)
	}

	if got := hiosoEnsureScalarOID("1.3.6.1.2.1.1.2.0"); got != ".1.3.6.1.2.1.1.2.0" {
		t.Fatalf("unexpected scalar oid conversion: %s", got)
	}
}

func TestHiosoRuntimeSettingsToSNMPTargetUsesResolver(t *testing.T) {
	tests := []struct {
		name      string
		settings  hiosoRuntimeSettings
		wantHost  string
		wantPort  uint16
	}{
		{
			name: "host contains explicit port",
			settings: hiosoRuntimeSettings{
				Host:      "10.10.10.1:2161",
				Port:      "161",
				Version:   "2c",
				Community: "public",
			},
			wantHost: "10.10.10.1",
			wantPort: 2161,
		},
		{
			name: "host is url with explicit port",
			settings: hiosoRuntimeSettings{
				Host:      "http://10.10.10.2:3161",
				Port:      "161",
				Version:   "2c",
				Community: "public",
			},
			wantHost: "10.10.10.2",
			wantPort: 3161,
		},
		{
			name: "invalid host keeps fallback parsing",
			settings: hiosoRuntimeSettings{
				Host:      "",
				Port:      "4321",
				Version:   "2c",
				Community: "public",
			},
			wantHost: "",
			wantPort: 4321,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			target := tc.settings.ToSNMPTarget()
			if target.Host != tc.wantHost {
				t.Fatalf("unexpected host: got %q want %q", target.Host, tc.wantHost)
			}
			if target.Port != tc.wantPort {
				t.Fatalf("unexpected port: got %d want %d", target.Port, tc.wantPort)
			}
		})
	}
}

func TestHiosoInferProfileNameFromSystemText(t *testing.T) {
	tests := []struct {
		name          string
		sysObjectText string
		sysDescrText  string
		want          string
	}{
		{
			name:          "detect hioso b from enterprise oid",
			sysObjectText: ".1.3.6.1.4.1.3320.101",
			want:          "HIOSO_B",
		},
		{
			name:          "detect hioso gpon from object oid",
			sysObjectText: ".1.3.6.1.4.1.25355.3.3.100",
			want:          "HIOSO_GPON",
		},
		{
			name:         "detect hioso gpon from sysdescr",
			sysDescrText: "hioso gpon olt",
			want:         "HIOSO_GPON",
		},
		{
			name:         "ambiguous hioso string does not force profile",
			sysDescrText: "hioso olt",
			want:         "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := hiosoInferProfileNameFromSystemText(tc.sysObjectText, tc.sysDescrText)
			if got != tc.want {
				t.Fatalf("unexpected inferred profile: got %q want %q", got, tc.want)
			}
		})
	}
}
