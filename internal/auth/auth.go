package auth

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

var (
	jwtSecret              string
	jwtExpiresIn           time.Duration
	refreshTokenExpiresIn  time.Duration
)

// Init initializes authentication configuration
func Init(secret string, expiresIn string, refreshExpiresIn string) error {
	jwtSecret = secret

	// Parse JWT expiry
	duration, err := time.ParseDuration(expiresIn)
	if err != nil {
		return fmt.Errorf("invalid JWT_EXPIRES_IN: %w", err)
	}
	jwtExpiresIn = duration

	// Parse refresh token expiry
	refreshDuration, err := time.ParseDuration(refreshExpiresIn)
	if err != nil {
		return fmt.Errorf("invalid REFRESH_TOKEN_EXPIRES_IN: %w", err)
	}
	refreshTokenExpiresIn = refreshDuration

	return nil
}

// GenerateTokens generates access and refresh tokens
func GenerateTokens(userID int, username, role string) (string, string, error) {
	// Create access token
	accessClaims := jwt.MapClaims{
		"user_id":  userID,
		"username": username,
		"role":     role,
		"exp":      time.Now().Add(jwtExpiresIn).Unix(),
		"iat":      time.Now().Unix(),
	}

	accessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims)
	accessTokenString, err := accessToken.SignedString([]byte(jwtSecret))
	if err != nil {
		return "", "", fmt.Errorf("failed to sign access token: %w", err)
	}

	// Create refresh token
	refreshClaims := jwt.MapClaims{
		"user_id":  userID,
		"username": username,
		"exp":      time.Now().Add(refreshTokenExpiresIn).Unix(),
		"iat":      time.Now().Unix(),
	}

	refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims)
	refreshTokenString, err := refreshToken.SignedString([]byte(jwtSecret))
	if err != nil {
		return "", "", fmt.Errorf("failed to sign refresh token: %w", err)
	}

	return accessTokenString, refreshTokenString, nil
}

// VerifyToken verifies a JWT token and returns claims
func VerifyToken(tokenString string) (jwt.MapClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, jwt.MapClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(jwtSecret), nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}

	return claims, nil
}

// HashPassword hashes a password using bcrypt
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return "", fmt.Errorf("failed to hash password: %w", err)
	}
	return string(hash), nil
}

// ComparePassword compares a password with a hash
func ComparePassword(hash, password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// ExtractUserID extracts user ID from claims
func ExtractUserID(claims jwt.MapClaims) (int, error) {
	userID, ok := claims["user_id"].(float64)
	if !ok {
		return 0, fmt.Errorf("user_id not found in claims")
	}
	return int(userID), nil
}

// ExtractUsername extracts username from claims
func ExtractUsername(claims jwt.MapClaims) (string, error) {
	username, ok := claims["username"].(string)
	if !ok {
		return "", fmt.Errorf("username not found in claims")
	}
	return username, nil
}

// ExtractRole extracts role from claims
func ExtractRole(claims jwt.MapClaims) (string, error) {
	role, ok := claims["role"].(string)
	if !ok {
		return "", fmt.Errorf("role not found in claims")
	}
	return role, nil
}
