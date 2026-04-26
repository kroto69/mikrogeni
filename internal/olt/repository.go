package olt

import (
	"context"
	"errors"
)

var ErrOLTNotFound = errors.New("olt not found")

type OLTRepository interface {
	Create(ctx context.Context, request AddOLTRequest) (*OLTDevice, error)
	GetByID(ctx context.Context, id string) (*OLTDevice, error)
	// List must return an empty slice ([]*OLTDevice{}), never nil, when no data exists.
	List(ctx context.Context) ([]*OLTDevice, error)
	UpdateStatus(ctx context.Context, id, status, errMsg string) error
	Delete(ctx context.Context, id string) error
}
