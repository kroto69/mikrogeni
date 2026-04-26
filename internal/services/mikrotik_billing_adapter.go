package services

import "strings"

type BillingMikroTikAdapter interface {
	Suspend(deviceID, pppSecretName string) error
	Restore(deviceID, pppSecretName string) error
}

type mikroTikBillingAdapter struct{}

func NewBillingMikroTikAdapter() BillingMikroTikAdapter {
	return &mikroTikBillingAdapter{}
}

func (a *mikroTikBillingAdapter) Suspend(deviceID, pppSecretName string) error {
	return GetMikroTikService().SetPPPSecretDisabled(strings.TrimSpace(deviceID), strings.TrimSpace(pppSecretName), true)
}

func (a *mikroTikBillingAdapter) Restore(deviceID, pppSecretName string) error {
	return GetMikroTikService().SetPPPSecretDisabled(strings.TrimSpace(deviceID), strings.TrimSpace(pppSecretName), false)
}
